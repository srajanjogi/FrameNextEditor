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
  
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .input(audioPath)
      .outputOptions([
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', audioBitrate,
        '-shortest'
      ])
      .output(outputPath)
      .on('end', () => {
        console.log("Audio replaced:", outputPath);
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
  
  const { getVideoMetadata, getFrameRate } = require("../utils/videoUtils");
  const meta = await getVideoMetadata(videoPath);
  const originalFps = getFrameRate(meta);
  const outputFps = originalFps * speedValue;
  
  const filters = [];
  filters.push(`[0:v]setpts=${1/speedValue}*PTS,fps=${outputFps}[v]`);
  
  // Apply speed to replacement audio
  if (speedValue > 2) {
    const tempo1 = 2.0;
    const tempo2 = speedValue / 2.0;
    filters.push(`[1:a]atempo=${tempo1},atempo=${tempo2}[a]`);
  } else {
    filters.push(`[1:a]atempo=${speedValue}[a]`);
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


