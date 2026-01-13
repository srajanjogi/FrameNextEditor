const ffmpeg = require("fluent-ffmpeg");
const { normalizePath } = require("../utils/pathUtils");

/**
 * Replaces audio track in video
 * @param {string} videoPath - Input video path
 * @param {string} audioPath - Audio file path to use
 * @param {string} outputPath - Output file path
 * @param {Object} options - Encoding options
 * @returns {Promise<string>} Path to output video
 */
async function replaceAudio(videoPath, audioPath, outputPath, options = {}) {
  audioPath = normalizePath(audioPath);
  const audioBitrate = options.audioBitrate || '192k';
  
  // Handle audio trimming if provided
  const trimStart = options.trimStart || 0;
  const trimEnd = options.trimEnd || null;
  const hasTrim = trimEnd !== null && trimEnd > trimStart;
  
  // Get priority and durations
  const priority = options.priority; // "audio" or "video"
  const videoDuration = options.videoDuration || null;
  const audioDuration = options.audioDuration || null;
  
  const { getVideoMetadata } = require("../utils/videoUtils");
  const videoMeta = await getVideoMetadata(videoPath);
  const actualVideoDuration = Number(videoMeta.format.duration) || videoDuration || 0;
  
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
  
  if (priority === "audio") {
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
  audioPath = normalizePath(audioPath);
  const preset = options.preset || 'medium';
  const crf = options.crf || '23';
  const audioBitrate = options.audioBitrate || '192k';
  
  // Handle audio trimming if provided
  const trimStart = options.trimStart || 0;
  const trimEnd = options.trimEnd || null;
  const hasTrim = trimEnd !== null && trimEnd > trimStart;
  
  const { getVideoMetadata, getFrameRate } = require("../utils/videoUtils");
  const meta = await getVideoMetadata(videoPath);
  const originalFps = getFrameRate(meta);
  const outputFps = originalFps * speedValue;
  
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

module.exports = { replaceAudio, applySpeedWithAudio };



