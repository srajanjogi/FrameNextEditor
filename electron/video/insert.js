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
 * @returns {Promise<string>} Path to output video
 */
async function insertVideo(mainVideo, insertVideoPath, position, duration, trimInfo, outputPath) {
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
  
  // Build FFmpeg filters
  const filters = [];
  const absInsertPos = workingStart + safePos;
  const absWorkingEnd = workingEnd;
  
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
        console.log("Insert completed:", outputPath);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error("Insert error:", err);
        reject(err);
      })
      .run();
  });
}

module.exports = { insertVideo };


