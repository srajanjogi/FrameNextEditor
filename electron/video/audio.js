const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { normalizePath } = require("../utils/pathUtils");
const { ensureDirectoryExists } = require("../utils/fileUtils");

/**
 * Replaces audio track in video
 * @param {string} videoPath - Input video path
 * @param {string} audioPath - Audio file path to use
 * @param {string} outputPath - Output file path
 * @param {Object} options - Encoding options
 * @returns {Promise<string>} Path to output video
 */
async function replaceAudio(videoPath, audioPath, outputPath, options = {}) {
  // Normalize all paths
  videoPath = normalizePath(videoPath);
  audioPath = normalizePath(audioPath);
  outputPath = normalizePath(outputPath);
  const audioBitrate = options.audioBitrate || '192k';
  
  // Handle audio trimming if provided
  const trimStart = options.trimStart || 0;
  const trimEnd = options.trimEnd || null;
  const hasTrim = trimEnd !== null && trimEnd > trimStart;
  
  // Get priority and durations
  const priority = options.priority; // "audio" or "video"
  const placement = options.placement; // "audio_priority", "video_priority", "custom"
  const startTime = options.startTime || 0;
  const endTime = options.endTime || null;
  const videoDuration = options.videoDuration || null;
  const audioDuration = options.audioDuration || null;
  
  const { getVideoMetadata, hasAudioStream } = require("../utils/videoUtils");
  const videoMeta = await getVideoMetadata(videoPath);
  const actualVideoDuration = Number(videoMeta.format.duration) || videoDuration || 0;
  const videoHasAudio = hasAudioStream(videoMeta);
  
  // Get actual audio duration if not provided
  let actualAudioDuration = audioDuration;
  if (!actualAudioDuration) {
    const ffprobe = require('fluent-ffmpeg').ffprobe;
    try {
      const audioMeta = await new Promise((resolve, reject) => {
        ffprobe(audioPath, (err, metadata) => {
          if (err) reject(err);
          else resolve(metadata);
        });
      });
      actualAudioDuration = Number(audioMeta.format.duration) || 0;
    } catch (e) {
      console.warn("Could not get audio duration:", e);
      actualAudioDuration = audioDuration || 0;
    }
  }
  
  const filters = [];
  let videoFilters = [];
  let audioFilters = [];
  let outputDuration = null;
  
  // Apply audio trimming if needed
  const trimmedAudioDuration = hasTrim ? (trimEnd - trimStart) : actualAudioDuration;
  
  // Handle custom placement
  if (placement === "custom" && endTime !== null && endTime > startTime) {
    console.log("Custom placement: startTime:", startTime, "endTime:", endTime);
    outputDuration = actualVideoDuration;
    videoFilters.push(`[0:v]copy[v]`);
    
    const customStart = Math.max(0, Math.min(startTime, actualVideoDuration));
    const customEnd = Math.max(customStart, Math.min(endTime, actualVideoDuration));
    const customDuration = customEnd - customStart;
    
    // Build 3 audio segments for custom placement
    const audioSegments = [];
    let segmentCount = 0;
    
    // Segment 1: Before custom placement (0 to startTime)
    if (customStart > 0.1) {
      if (videoHasAudio) {
        filters.push(`[0:a]atrim=start=0:end=${customStart},asetpts=PTS-STARTPTS[a_before]`);
        audioSegments.push('a_before');
      } else {
        filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${customStart},asetpts=PTS-STARTPTS[a_before]`);
        audioSegments.push('a_before');
      }
      segmentCount++;
    }
    
    // Segment 2: Custom placement (inserted audio from startTime to endTime)
    if (customDuration > 0.1) {
      let insertedAudioFilter = `[1:a]`;
      if (hasTrim) {
        insertedAudioFilter += `atrim=start=${trimStart}:end=${trimEnd},`;
      }
      
      // If inserted audio is shorter than custom duration, loop it
      if (trimmedAudioDuration < customDuration) {
        insertedAudioFilter += `aloop=loop=-1:size=2147483647:start=0,`;
      }
      insertedAudioFilter += `atrim=start=0:end=${customDuration},asetpts=PTS-STARTPTS[a_during]`;
      filters.push(insertedAudioFilter);
      audioSegments.push('a_during');
      segmentCount++;
    }
    
    // Segment 3: After custom placement (endTime to video end)
    if (customEnd < actualVideoDuration - 0.1) {
      const afterDuration = actualVideoDuration - customEnd;
      if (videoHasAudio) {
        filters.push(`[0:a]atrim=start=${customEnd}:end=${actualVideoDuration},asetpts=PTS-STARTPTS[a_after]`);
        audioSegments.push('a_after');
      } else {
        filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${afterDuration},asetpts=PTS-STARTPTS[a_after]`);
        audioSegments.push('a_after');
      }
      segmentCount++;
    }
    
    // Concatenate all audio segments
    if (segmentCount > 1) {
      filters.push(`[${audioSegments.join('][')}]concat=n=${segmentCount}:v=0:a=1[a]`);
    } else if (segmentCount === 1) {
      filters.push(`[${audioSegments[0]}]copy[a]`);
    } else {
      // No segments (shouldn't happen, but handle it)
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${actualVideoDuration},asetpts=PTS-STARTPTS[a]`);
    }
    
  } else if (priority === "audio") {
    // Audio priority: Video loops if audio is longer
    if (trimmedAudioDuration > actualVideoDuration) {
      // Audio is longer - loop video to match audio duration
      outputDuration = trimmedAudioDuration;
      
      // Use loop filter to repeat video; size must be positive (number of frames in loop buffer)
      // We use a large size so it effectively loops for the whole duration, and -t cuts at outputDuration
      videoFilters.push(`[0:v]loop=loop=-1:size=32767:start=0,setpts=N/(FRAME_RATE*TB)[v]`);
      
      // Audio: use trimmed audio
      if (hasTrim) {
        audioFilters.push(`[1:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS[a]`);
      } else {
        audioFilters.push(`[1:a]asetpts=PTS-STARTPTS[a]`);
      }
    } else {
      // Audio is shorter or equal - trim video to audio duration (audio priority)
      outputDuration = trimmedAudioDuration;
      
      // Trim video to match audio duration - need to re-encode when trimming
      videoFilters.push(`[0:v]trim=start=0:end=${trimmedAudioDuration},setpts=PTS-STARTPTS[v]`);
      
      // Audio: use trimmed audio (no repeating needed since video is trimmed to audio)
      if (hasTrim) {
        audioFilters.push(`[1:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS[a]`);
      } else {
        audioFilters.push(`[1:a]asetpts=PTS-STARTPTS[a]`);
      }
    }
  } else if (priority === "video") {
    // Video priority: Audio repeats or trims to match video
    outputDuration = actualVideoDuration;
    videoFilters.push(`[0:v]copy[v]`);
    
    if (trimmedAudioDuration < actualVideoDuration) {
      // Audio is shorter - repeat audio to match video (loop, cut by -t)
      // size must be positive, so use a large value
      if (hasTrim) {
        audioFilters.push(`[1:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS,aloop=loop=-1:size=2147483647:start=0[a]`);
      } else {
        audioFilters.push(`[1:a]aloop=loop=-1:size=2147483647:start=0[a]`);
      }
    } else {
      // Audio is longer - trim to video duration
      if (hasTrim) {
        audioFilters.push(`[1:a]atrim=start=${trimStart}:end=${trimStart + actualVideoDuration},asetpts=PTS-STARTPTS[a]`);
      } else {
        audioFilters.push(`[1:a]atrim=start=0:end=${actualVideoDuration},asetpts=PTS-STARTPTS[a]`);
      }
    }
  } else {
    // No priority specified - use shortest (default behavior)
    outputDuration = Math.min(actualVideoDuration, trimmedAudioDuration);
    videoFilters.push(`[0:v]copy[v]`);
    if (hasTrim) {
      audioFilters.push(`[1:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS[a]`);
    } else {
      audioFilters.push(`[1:a]asetpts=PTS-STARTPTS[a]`);
    }
  }
  
  // Combine filters
  if (videoFilters.length > 0) {
    filters.push(...videoFilters);
  }
  if (audioFilters.length > 0) {
    filters.push(...audioFilters);
  }
  
  return new Promise((resolve, reject) => {
    const ffmpegCommand = ffmpeg(videoPath)
      .input(audioPath);
    
    if (filters.length > 0) {
      ffmpegCommand.complexFilter(filters);
    }
    
    const needsVideoReencode = filters.some(f => f.includes('loop') || f.includes('trim'));
    const outputOptions = [
      '-map', filters.length > 0 ? '[v]' : '0:v:0',
      '-map', filters.length > 0 ? '[a]' : '1:a:0',
      '-c:v', needsVideoReencode ? 'libx264' : 'copy',
      '-c:a', 'aac',
      '-b:a', audioBitrate
    ];
    
    if (needsVideoReencode) {
      outputOptions.push('-preset', 'medium', '-crf', '23');
      // Get video FPS for re-encoding
      const { getFrameRate } = require("../utils/videoUtils");
      const fps = getFrameRate(videoMeta);
      if (fps) {
        outputOptions.push('-r', String(fps));
      }
    }
    
    if (outputDuration) {
      outputOptions.push('-t', String(outputDuration));
    } else {
      outputOptions.push('-shortest');
    }
    
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    ensureDirectoryExists(outputDir);
    
    ffmpegCommand
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', () => {
        console.log("Audio replaced:", outputPath, "Duration:", outputDuration);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error("Audio replacement error:", err);
        reject(err);
      })
      .run();
  });
}

/**
 * Applies speed to video and replaces audio simultaneously
 * @param {string} videoPath - Input video path
 * @param {string} audioPath - Audio file path
 * @param {number} speedValue - Speed multiplier
 * @param {string} outputPath - Output file path
 * @param {Object} options - Encoding options
 * @returns {Promise<string>} Path to output video
 */
async function applySpeedWithAudio(videoPath, audioPath, speedValue, outputPath, options = {}) {
  // Normalize all paths
  videoPath = normalizePath(videoPath);
  audioPath = normalizePath(audioPath);
  outputPath = normalizePath(outputPath);
  const preset = options.preset || 'medium';
  const crf = options.crf || '23';
  const audioBitrate = options.audioBitrate || '192k';
  
  // Handle audio trimming if provided
  const trimStart = options.trimStart || 0;
  const trimEnd = options.trimEnd || null;
  const hasTrim = trimEnd !== null && trimEnd > trimStart;
  
  // Handle custom placement
  const placement = options.placement;
  const startTime = options.startTime || 0;
  const endTime = options.endTime || null;
  
  const { getVideoMetadata, getFrameRate, hasAudioStream } = require("../utils/videoUtils");
  const meta = await getVideoMetadata(videoPath);
  const originalFps = getFrameRate(meta);
  const outputFps = originalFps * speedValue;
  const videoHasAudio = hasAudioStream(meta);
  const originalVideoDuration = Number(meta.format.duration) || 0;
  const speedAdjustedDuration = originalVideoDuration / speedValue;
  
  // Handle custom placement with speed
  // Note: startTime/endTime refer to the speed-adjusted output timeline
  if (placement === "custom" && endTime !== null && endTime > startTime && videoHasAudio) {
    console.log("Custom placement with speed - startTime:", startTime, "endTime:", endTime, "speed:", speedValue);
    // For now, fall back to standard behavior - custom placement with speed is complex
    // TODO: Implement proper custom placement with speed adjustment
    console.warn("Custom placement with speed is not fully implemented yet, using standard behavior");
  }
  
  const filters = [];
  filters.push(`[0:v]setpts=${1/speedValue}*PTS,fps=${outputFps}[v]`);
  
  // Apply audio trimming first, then speed
  if (hasTrim) {
    // Trim audio first, then apply speed
    if (speedValue > 2) {
      const tempo1 = 2.0;
      const tempo2 = speedValue / 2.0;
      filters.push(`[1:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS,atempo=${tempo1},atempo=${tempo2}[a]`);
    } else {
      filters.push(`[1:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS,atempo=${speedValue}[a]`);
    }
  } else {
    // Apply speed to replacement audio without trimming
    if (speedValue > 2) {
      const tempo1 = 2.0;
      const tempo2 = speedValue / 2.0;
      filters.push(`[1:a]atempo=${tempo1},atempo=${tempo2}[a]`);
    } else {
      filters.push(`[1:a]atempo=${speedValue}[a]`);
    }
  }
  
  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  ensureDirectoryExists(outputDir);
  
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .input(audioPath)
      .complexFilter(filters)
      .outputOptions([
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', 'libx264',
        '-preset', preset,
        '-crf', crf,
        '-r', String(outputFps),
        '-c:a', 'aac',
        '-b:a', audioBitrate,
        '-shortest'
      ])
      .output(outputPath)
      .on('end', () => {
        console.log("Speed + Audio applied:", outputPath);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error("Speed + Audio error:", err);
        reject(err);
      })
      .run();
  });
}

/**
 * Mixes video audio and inserted audio track
 * @param {string} videoPath - Input video path (with audio)
 * @param {string} audioPath - Audio file path to mix
 * @param {string} outputPath - Output file path
 * @param {Object} options - Encoding options
 * @returns {Promise<string>} Path to output video
 */
async function mixAudio(videoPath, audioPath, outputPath, options = {}) {
  // Normalize all paths
  videoPath = normalizePath(videoPath);
  audioPath = normalizePath(audioPath);
  outputPath = normalizePath(outputPath);
  
  const audioBitrate = options.audioBitrate || '192k';
  const mainAudioVolume = options.mainAudioVolume !== undefined ? options.mainAudioVolume : 1.0;
  const backgroundAudioVolume = options.backgroundAudioVolume !== undefined ? options.backgroundAudioVolume : 0.5;
  const mainAudioIsVideo = options.mainAudioIsVideo !== undefined ? options.mainAudioIsVideo : true;
  
  console.log("Mixing audio - mainAudioIsVideo:", mainAudioIsVideo, "mainVolume:", mainAudioVolume, "bgVolume:", backgroundAudioVolume);
  console.log("mixAudio paths - videoPath:", videoPath, "audioPath:", audioPath, "outputPath:", outputPath);
  
  const { getVideoMetadata, hasAudioStream } = require("../utils/videoUtils");
  const videoMeta = await getVideoMetadata(videoPath);
  const videoHasAudio = hasAudioStream(videoMeta);
  const videoDuration = Number(videoMeta.format.duration) || 0;

  if (!videoHasAudio) {
    // If video has no audio, just replace with inserted audio
    return replaceAudio(videoPath, audioPath, outputPath, options);
  }

  // Get audio duration
  const ffprobe = require('fluent-ffmpeg').ffprobe;
  let audioDuration = 0;
  try {
    const audioMeta = await new Promise((resolve, reject) => {
      ffprobe(audioPath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata);
      });
    });
    audioDuration = Number(audioMeta.format.duration) || 0;
  } catch (e) {
    console.warn("Could not get audio duration:", e);
  }

  // Handle custom placement for mixing
  const placement = options.placement;
  const startTime = options.startTime || 0;
  const endTime = options.endTime || null;
  const trimStart = options.trimStart || 0;
  const trimEnd = options.trimEnd || null;
  const hasTrim = trimEnd !== null && trimEnd > trimStart;
  const trimmedAudioDuration = hasTrim ? (trimEnd - trimStart) : audioDuration;

  // Custom placement: mix audio only during specified time range
  if (placement === "custom" && endTime !== null && endTime > startTime) {
    console.log("Custom placement mixing: startTime:", startTime, "endTime:", endTime);
    const customStart = Math.max(0, Math.min(startTime, videoDuration));
    const customEnd = Math.max(customStart, Math.min(endTime, videoDuration));
    const customDuration = customEnd - customStart;
    
    const filters = [];
    const audioSegments = [];
    let segmentCount = 0;
    
    // Segment 1: Before custom placement - original video audio only
    if (customStart > 0.1) {
      filters.push(`[0:a]atrim=start=0:end=${customStart},asetpts=PTS-STARTPTS[a_before]`);
      audioSegments.push('a_before');
      segmentCount++;
    }
    
    // Segment 2: During custom placement - mix video audio with inserted audio
    if (customDuration > 0.1) {
      // Video audio segment for mixing
      filters.push(`[0:a]atrim=start=${customStart}:end=${customEnd},asetpts=PTS-STARTPTS[video_seg]`);
      
      // Inserted audio segment - loop if needed
      let insertedAudioFilter = `[1:a]`;
      if (hasTrim) {
        insertedAudioFilter += `atrim=start=${trimStart}:end=${trimEnd},`;
      }
      if (trimmedAudioDuration < customDuration) {
        insertedAudioFilter += `aloop=loop=-1:size=2147483647:start=0,`;
      }
      insertedAudioFilter += `atrim=start=0:end=${customDuration},asetpts=PTS-STARTPTS[inserted_seg]`;
      filters.push(insertedAudioFilter);
      
      // Normalize both
      filters.push(`[video_seg]aformat=sample_rates=44100:channel_layouts=stereo[video_norm]`);
      filters.push(`[inserted_seg]aformat=sample_rates=44100:channel_layouts=stereo[inserted_norm]`);
      
      // Apply volume based on which is main
      if (mainAudioIsVideo) {
        filters.push(`[video_norm]volume=${mainAudioVolume}[main_audio]`);
        filters.push(`[inserted_norm]volume=${backgroundAudioVolume}[bg_audio]`);
      } else {
        filters.push(`[inserted_norm]volume=${mainAudioVolume}[main_audio]`);
        filters.push(`[video_norm]volume=${backgroundAudioVolume}[bg_audio]`);
      }
      
      // Mix during segment
      filters.push(`[main_audio][bg_audio]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a_during]`);
      audioSegments.push('a_during');
      segmentCount++;
    }
    
    // Segment 3: After custom placement - original video audio only
    if (customEnd < videoDuration - 0.1) {
      filters.push(`[0:a]atrim=start=${customEnd}:end=${videoDuration},asetpts=PTS-STARTPTS[a_after]`);
      audioSegments.push('a_after');
      segmentCount++;
    }
    
    // Concatenate all segments
    if (segmentCount > 1) {
      filters.push(`[${audioSegments.join('][')}]concat=n=${segmentCount}:v=0:a=1[mixed_audio]`);
    } else if (segmentCount === 1) {
      filters.push(`[${audioSegments[0]}]copy[mixed_audio]`);
    } else {
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${videoDuration},asetpts=PTS-STARTPTS[mixed_audio]`);
    }
    
    filters.push(`[0:v]copy[v]`);
    
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    ensureDirectoryExists(outputDir);
    
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .input(audioPath)
        .complexFilter(filters)
        .outputOptions([
          '-map', '[v]',
          '-map', '[mixed_audio]',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', audioBitrate
        ])
        .output(outputPath)
        .on('end', () => {
          console.log("Audio mixed with custom placement:", outputPath);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error("Audio mixing error:", err);
          reject(err);
        })
        .run();
    });
  }

  // Standard mixing (no custom placement)
  const filters = [];
  const maxDuration = Math.max(videoDuration, audioDuration);
  
  // Process video audio - loop if shorter, otherwise just trim
  if (videoDuration < audioDuration) {
    // Loop video audio if it's shorter than inserted audio
    filters.push(`[0:a]aloop=loop=-1:size=2147483647:start=0,atrim=start=0:end=${maxDuration},asetpts=PTS-STARTPTS[video_audio]`);
  } else {
    // Video audio is longer or equal - just trim to max duration
    filters.push(`[0:a]atrim=start=0:end=${maxDuration},asetpts=PTS-STARTPTS[video_audio]`);
  }
  
  // Process inserted audio - loop if shorter, otherwise just trim
  if (audioDuration < videoDuration) {
    // Loop inserted audio if it's shorter than video
    filters.push(`[1:a]aloop=loop=-1:size=2147483647:start=0,atrim=start=0:end=${maxDuration},asetpts=PTS-STARTPTS[inserted_audio]`);
  } else {
    // Inserted audio is longer or equal - just trim to max duration
    filters.push(`[1:a]atrim=start=0:end=${maxDuration},asetpts=PTS-STARTPTS[inserted_audio]`);
  }
  
  // Normalize both audio streams to same format (sample rate and channels)
  filters.push(`[video_audio]aformat=sample_rates=44100:channel_layouts=stereo[video_norm]`);
  filters.push(`[inserted_audio]aformat=sample_rates=44100:channel_layouts=stereo[inserted_norm]`);
  
  // Apply volume based on which is main
  // mainAudioIsVideo = true means video audio is main, inserted is background
  // mainAudioIsVideo = false means inserted audio is main, video is background
  if (mainAudioIsVideo) {
    // Video audio is MAIN (louder), inserted audio is BACKGROUND (quieter)
    // Use volume filter with explicit dB calculation to ensure background is audible
    const mainVolDb = 20 * Math.log10(mainAudioVolume);
    const bgVolDb = 20 * Math.log10(backgroundAudioVolume);
    filters.push(`[video_norm]volume=${mainAudioVolume}[main_audio]`);
    filters.push(`[inserted_norm]volume=${backgroundAudioVolume}[bg_audio]`);
    console.log("Video audio is MAIN at volume", mainAudioVolume, "(" + mainVolDb.toFixed(2) + "dB)", "Inserted audio is BACKGROUND at volume", backgroundAudioVolume, "(" + bgVolDb.toFixed(2) + "dB)");
  } else {
    // Inserted audio is MAIN (louder), video audio is BACKGROUND (quieter)
    const mainVolDb = 20 * Math.log10(mainAudioVolume);
    const bgVolDb = 20 * Math.log10(backgroundAudioVolume);
    filters.push(`[inserted_norm]volume=${mainAudioVolume}[main_audio]`);
    filters.push(`[video_norm]volume=${backgroundAudioVolume}[bg_audio]`);
    console.log("Inserted audio is MAIN at volume", mainAudioVolume, "(" + mainVolDb.toFixed(2) + "dB)", "Video audio is BACKGROUND at volume", backgroundAudioVolume, "(" + bgVolDb.toFixed(2) + "dB)");
  }
  
  // Mix the two audio tracks - DON'T use normalize, and ensure both inputs are mixed properly
  // Use dropout_transition=0 to avoid fading, and ensure both tracks play simultaneously
  filters.push(`[main_audio][bg_audio]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[mixed_audio]`);
  
  // Video filter - just copy video stream
  filters.push(`[0:v]copy[v]`);

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  ensureDirectoryExists(outputDir);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .input(audioPath)
      .complexFilter(filters)
      .outputOptions([
        '-map', '[v]',
        '-map', '[mixed_audio]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', audioBitrate
      ])
      .output(outputPath)
      .on('end', () => {
        console.log("Audio mixed successfully:", outputPath);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error("Audio mixing error:", err);
        reject(err);
      })
      .run();
  });
}

/**
 * Applies speed and mixes audio simultaneously
 * @param {string} videoPath - Input video path
 * @param {string} audioPath - Audio file path
 * @param {number} speedValue - Speed multiplier
 * @param {string} outputPath - Output file path
 * @param {Object} options - Encoding options
 * @returns {Promise<string>} Path to output video
 */
async function applySpeedWithMixedAudio(videoPath, audioPath, speedValue, outputPath, options = {}) {
  // Normalize all paths
  videoPath = normalizePath(videoPath);
  audioPath = normalizePath(audioPath);
  outputPath = normalizePath(outputPath);
  const preset = options.preset || 'medium';
  const crf = options.crf || '23';
  const audioBitrate = options.audioBitrate || '192k';
  const mainAudioVolume = options.mainAudioVolume !== undefined ? options.mainAudioVolume : 1.0;
  const backgroundAudioVolume = options.backgroundAudioVolume !== undefined ? options.backgroundAudioVolume : 0.5;
  const mainAudioIsVideo = options.mainAudioIsVideo !== undefined ? options.mainAudioIsVideo : true;
  
  console.log("Mixing audio with speed - mainAudioIsVideo:", mainAudioIsVideo, "mainVolume:", mainAudioVolume, "bgVolume:", backgroundAudioVolume);
  
  const { getVideoMetadata, getFrameRate, hasAudioStream } = require("../utils/videoUtils");
  const meta = await getVideoMetadata(videoPath);
  const videoHasAudio = hasAudioStream(meta);
  const originalFps = getFrameRate(meta);
  const outputFps = originalFps * speedValue;
  const videoDuration = Number(meta.format.duration) || 0;
  
  if (!videoHasAudio) {
    return applySpeedWithAudio(videoPath, audioPath, speedValue, outputPath, options);
  }
  
  // Get audio duration
  const ffprobe = require('fluent-ffmpeg').ffprobe;
  let audioDuration = 0;
  try {
    const audioMeta = await new Promise((resolve, reject) => {
      ffprobe(audioPath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata);
      });
    });
    audioDuration = Number(audioMeta.format.duration) || 0;
  } catch (e) {
    console.warn("Could not get audio duration:", e);
  }
  
  const filters = [];
  
  // Video speed filter
  filters.push(`[0:v]setpts=${1/speedValue}*PTS,fps=${outputFps}[v]`);
  
  // Process video audio with speed
  const speedVideoDuration = videoDuration / speedValue;
  const speedAudioDuration = audioDuration / speedValue;
  const maxDuration = Math.max(speedVideoDuration, speedAudioDuration);
  
  // Always process video audio through a filter chain
  let videoAudioLabel = '[video_audio]';
  if (speedAudioDuration < speedVideoDuration) {
    // Loop video audio if it's shorter
    if (speedValue > 2) {
      const tempo1 = 2.0;
      const tempo2 = speedValue / 2.0;
      filters.push(`[0:a]atempo=${tempo1},atempo=${tempo2},aloop=loop=-1:size=2147483647:start=0,atrim=start=0:end=${maxDuration},asetpts=PTS-STARTPTS[video_audio]`);
    } else {
      filters.push(`[0:a]atempo=${speedValue},aloop=loop=-1:size=2147483647:start=0,atrim=start=0:end=${maxDuration},asetpts=PTS-STARTPTS[video_audio]`);
    }
  } else {
    // Just apply speed
    if (speedValue > 2) {
      const tempo1 = 2.0;
      const tempo2 = speedValue / 2.0;
      filters.push(`[0:a]atempo=${tempo1},atempo=${tempo2},atrim=start=0:end=${maxDuration},asetpts=PTS-STARTPTS[video_audio]`);
    } else {
      filters.push(`[0:a]atempo=${speedValue},atrim=start=0:end=${maxDuration},asetpts=PTS-STARTPTS[video_audio]`);
    }
  }
  
  // Always process inserted audio through a filter chain
  let insertedAudioLabel = '[inserted_audio]';
  if (speedAudioDuration > speedVideoDuration) {
    // Loop inserted audio if it's shorter
    if (speedValue > 2) {
      const tempo1 = 2.0;
      const tempo2 = speedValue / 2.0;
      filters.push(`[1:a]atempo=${tempo1},atempo=${tempo2},aloop=loop=-1:size=2147483647:start=0,atrim=start=0:end=${maxDuration},asetpts=PTS-STARTPTS[inserted_audio]`);
    } else {
      filters.push(`[1:a]atempo=${speedValue},aloop=loop=-1:size=2147483647:start=0,atrim=start=0:end=${maxDuration},asetpts=PTS-STARTPTS[inserted_audio]`);
    }
  } else {
    // Just apply speed
    if (speedValue > 2) {
      const tempo1 = 2.0;
      const tempo2 = speedValue / 2.0;
      filters.push(`[1:a]atempo=${tempo1},atempo=${tempo2},atrim=start=0:end=${maxDuration},asetpts=PTS-STARTPTS[inserted_audio]`);
    } else {
      filters.push(`[1:a]atempo=${speedValue},atrim=start=0:end=${maxDuration},asetpts=PTS-STARTPTS[inserted_audio]`);
    }
  }
  
  // Normalize both audio streams to same format before mixing
  filters.push(`[video_audio]aformat=sample_rates=44100:channel_layouts=stereo[video_norm]`);
  filters.push(`[inserted_audio]aformat=sample_rates=44100:channel_layouts=stereo[inserted_norm]`);
  
  // Apply volume based on which is main
  // mainAudioIsVideo = true means video audio is main, inserted is background
  // mainAudioIsVideo = false means inserted audio is main, video is background
  if (mainAudioIsVideo) {
    // Video audio is MAIN (louder), inserted audio is BACKGROUND (quieter)
    filters.push(`[video_norm]volume=${mainAudioVolume}[main_audio]`);
    filters.push(`[inserted_norm]volume=${backgroundAudioVolume}[bg_audio]`);
    console.log("Video audio is MAIN at volume", mainAudioVolume, "Inserted audio is BACKGROUND at volume", backgroundAudioVolume);
  } else {
    // Inserted audio is MAIN (louder), video audio is BACKGROUND (quieter)
    filters.push(`[inserted_norm]volume=${mainAudioVolume}[main_audio]`);
    filters.push(`[video_norm]volume=${backgroundAudioVolume}[bg_audio]`);
    console.log("Inserted audio is MAIN at volume", mainAudioVolume, "Video audio is BACKGROUND at volume", backgroundAudioVolume);
  }
  
  // Mix the two audio tracks - DON'T use normalize, and ensure both inputs are mixed properly
  // Use dropout_transition=0 to avoid fading, and ensure both tracks play simultaneously
  filters.push(`[main_audio][bg_audio]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[mixed_audio]`);

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  ensureDirectoryExists(outputDir);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .input(audioPath)
      .complexFilter(filters)
      .outputOptions([
        '-map', '[v]',
        '-map', '[mixed_audio]',
        '-c:v', 'libx264',
        '-preset', preset,
        '-crf', crf,
        '-r', String(outputFps),
        '-c:a', 'aac',
        '-b:a', audioBitrate,
        '-t', String(maxDuration)
      ])
      .output(outputPath)
      .on('end', () => {
        console.log("Speed + Mixed Audio applied:", outputPath);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error("Speed + Mixed Audio error:", err);
        reject(err);
      })
      .run();
  });
}

module.exports = { replaceAudio, applySpeedWithAudio, mixAudio, applySpeedWithMixedAudio };



