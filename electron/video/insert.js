const ffmpeg = require("fluent-ffmpeg");
const { normalizePath } = require("../utils/pathUtils");
const { getVideoMetadata, hasAudioStream, getVideoProperties } = require("../utils/videoUtils");

/**
 * Inserts a video into another video at specified position
 * @param {string} mainVideo - Main video path
 * @param {string} insertVideoPath - Video to insert
 * @param {number} position - Insert position in seconds
 * @param {number} duration - Duration of insert in seconds
 * @param {Object} trimInfo - Trim info {start, end} if trim is active
 * @param {string} outputPath - Output file path
 * @param {string} mode - Insert mode: 'sequential' (extends timeline) or 'overlapping' (overlays, keeps base duration)
 * @returns {Promise<string>} Path to output video
 */
async function insertVideo(mainVideo, insertVideoPath, position, duration, trimInfo, outputPath, mode = 'sequential') {
  insertVideoPath = normalizePath(insertVideoPath);
  
  const mainMeta = await getVideoMetadata(mainVideo);
  const insMeta = await getVideoMetadata(insertVideoPath);
  
  const mainDur = Number(mainMeta.format.duration) || 0;
  const insDur = Number(insMeta.format.duration) || duration;
  
  // Calculate working range (consider trim if present)
  const trimStart = trimInfo?.start ?? 0;
  const trimEnd = trimInfo?.end ?? null;
  const hasTrim = trimEnd !== null && trimEnd > trimStart;
  
  let workingStart = 0;
  let workingEnd = mainDur;
  let relativeInsertPos = position;
  
  if (hasTrim) {
    workingStart = Math.max(0, Math.min(trimStart, mainDur));
    workingEnd = Math.max(workingStart, Math.min(trimEnd, mainDur));
    relativeInsertPos = Math.max(0, Math.min(position, workingEnd - workingStart));
  } else {
    relativeInsertPos = Math.min(position, mainDur);
  }
  
  const safePos = relativeInsertPos;
  const safeDur = Math.min(duration, insDur);
  const mainHasA = hasAudioStream(mainMeta);
  const insHasA = hasAudioStream(insMeta);
  const props = getVideoProperties(mainMeta);
  const isOverlapping = mode === 'overlapping';
  
  // Build FFmpeg filters
  const filters = [];
  const absInsertPos = workingStart + safePos;
  const absWorkingEnd = workingEnd;
  
  if (isOverlapping) {
    // OVERLAPPING MODE: Replace base video segment with insert video (cut and replace)
    // Keep base video duration unchanged - insert replaces base during the period
    // Example: Base 40s, insert at 5s for 10s duration
    // Result: Base 0-5s, Insert 5-15s, Base 15-40s (total 40s)
    
    const baseDuration = absWorkingEnd - workingStart;
    const insertStartTime = absInsertPos - workingStart;
    const insertEndTime = Math.min(insertStartTime + safeDur, baseDuration);
    const insertDuration = insertEndTime - insertStartTime;
    
    // Part 1: Base video before insert (0 to insertStartTime)
    if (insertStartTime > 0.1) {
      filters.push(`[0:v]trim=start=${workingStart}:end=${absInsertPos},setpts=PTS-STARTPTS,fps=${props.fps},scale=${props.width}:${props.height}:force_original_aspect_ratio=decrease,pad=${props.width}:${props.height}:-1:-1:color=black[v0]`);
      if (mainHasA) {
        filters.push(`[0:a]atrim=start=${workingStart}:end=${absInsertPos},asetpts=PTS-STARTPTS[a0]`);
      } else {
        filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${insertStartTime},asetpts=PTS-STARTPTS[a0]`);
      }
    }
    
    // Part 2: Insert video (replaces base during insertStartTime to insertEndTime)
    filters.push(`[1:v]trim=start=0:end=${insertDuration},setpts=PTS-STARTPTS,fps=${props.fps},scale=${props.width}:${props.height}:force_original_aspect_ratio=decrease,pad=${props.width}:${props.height}:-1:-1:color=black[v1]`);
    if (insHasA) {
      filters.push(`[1:a]atrim=start=0:end=${insertDuration},asetpts=PTS-STARTPTS[a1]`);
    } else {
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${insertDuration},asetpts=PTS-STARTPTS[a1]`);
    }
    
    // Part 3: Base video after insert (insertEndTime to baseDuration)
    const remainingDuration = baseDuration - insertEndTime;
    if (remainingDuration > 0.1) {
      // Calculate absolute position where base video resumes (skip the insert duration)
      const baseResumePos = absInsertPos + insertDuration;
      filters.push(`[0:v]trim=start=${baseResumePos}:end=${absWorkingEnd},setpts=PTS-STARTPTS,fps=${props.fps},scale=${props.width}:${props.height}:force_original_aspect_ratio=decrease,pad=${props.width}:${props.height}:-1:-1:color=black[v2]`);
      if (mainHasA) {
        filters.push(`[0:a]atrim=start=${baseResumePos}:end=${absWorkingEnd},asetpts=PTS-STARTPTS[a2]`);
      } else {
        filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${remainingDuration},asetpts=PTS-STARTPTS[a2]`);
      }
      
      // Concatenate all three parts
      if (insertStartTime > 0.1) {
        filters.push(`[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[outv][outa]`);
      } else {
        filters.push(`[v1][a1][v2][a2]concat=n=2:v=1:a=1[outv][outa]`);
      }
    } else {
      // No remaining base video after insert
      if (insertStartTime > 0.1) {
        filters.push(`[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]`);
      } else {
        filters.push(`[v1][a1]concat=n=1:v=1:a=1[outv][outa]`);
      }
    }
    
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(mainVideo)
        .input(insertVideoPath)
        .complexFilter(filters)
        .outputOptions([
          '-map', '[outv]',
          '-map', '[outa]',
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '23',
          '-r', String(props.fps),
          '-c:a', 'aac',
          '-b:a', '192k'
        ])
        .output(outputPath)
        .on('end', () => {
          console.log("Overlapping insert completed:", outputPath, "Duration:", baseDuration);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error("Overlapping insert error:", err);
          reject(err);
        })
        .run();
    });
  } else {
    // SEQUENTIAL MODE: Concatenate parts (original behavior)
    // Part 1: Main video before insert
    if (safePos > 0.1) {
      filters.push(`[0:v]trim=start=${workingStart}:end=${absInsertPos},setpts=PTS-STARTPTS,fps=${props.fps},scale=${props.width}:${props.height}:force_original_aspect_ratio=decrease,pad=${props.width}:${props.height}:-1:-1:color=black[v0]`);
      if (mainHasA) {
        filters.push(`[0:a]atrim=start=${workingStart}:end=${absInsertPos},asetpts=PTS-STARTPTS[a0]`);
      } else {
        filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${safePos},asetpts=PTS-STARTPTS[a0]`);
      }
    }
    
    // Part 2: Insert video
    filters.push(`[1:v]trim=start=0:end=${safeDur},setpts=PTS-STARTPTS,fps=${props.fps},scale=${props.width}:${props.height}:force_original_aspect_ratio=decrease,pad=${props.width}:${props.height}:-1:-1:color=black[v1]`);
    if (insHasA) {
      filters.push(`[1:a]atrim=start=0:end=${safeDur},asetpts=PTS-STARTPTS[a1]`);
    } else {
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${safeDur},asetpts=PTS-STARTPTS[a1]`);
    }
    
    // Part 3: Main video after insert
    const remainingInWorkingRange = absWorkingEnd - absInsertPos;
    if (remainingInWorkingRange > 0.1) {
      filters.push(`[0:v]trim=start=${absInsertPos}:end=${absWorkingEnd},setpts=PTS-STARTPTS,fps=${props.fps},scale=${props.width}:${props.height}:force_original_aspect_ratio=decrease,pad=${props.width}:${props.height}:-1:-1:color=black[v2]`);
      if (mainHasA) {
        filters.push(`[0:a]atrim=start=${absInsertPos}:end=${absWorkingEnd},asetpts=PTS-STARTPTS[a2]`);
      } else {
        filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${remainingInWorkingRange},asetpts=PTS-STARTPTS[a2]`);
      }
      
      if (safePos > 0.1) {
        filters.push(`[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[outv][outa]`);
      } else {
        filters.push(`[v1][a1][v2][a2]concat=n=2:v=1:a=1[outv][outa]`);
      }
    } else {
      if (safePos > 0.1) {
        filters.push(`[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]`);
      } else {
        filters.push(`[v1][a1]concat=n=1:v=1:a=1[outv][outa]`);
      }
    }
    
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(mainVideo)
        .input(insertVideoPath)
        .complexFilter(filters)
        .outputOptions([
          '-map', '[outv]',
          '-map', '[outa]',
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '23',
          '-r', String(props.fps),
          '-c:a', 'aac',
          '-b:a', '192k',
          '-shortest'
        ])
        .output(outputPath)
        .on('end', () => {
          console.log("Sequential insert completed:", outputPath);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error("Sequential insert error:", err);
          reject(err);
        })
        .run();
    });
  }
}

module.exports = { insertVideo };



