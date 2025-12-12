const ffmpeg = require("fluent-ffmpeg");
const { getVideoMetadata, hasAudioStream, getFrameRate } = require("../utils/videoUtils");

/**
 * Applies speed effect to video
 * @param {string} videoPath - Input video path
 * @param {number} speedValue - Speed multiplier (e.g., 2.0 for 2x speed)
 * @param {string} outputPath - Output file path
 * @param {Object} options - Encoding options {preset, crf, audioBitrate}
 * @returns {Promise<string>} Path to output video
 */
async function applySpeed(videoPath, speedValue, outputPath, options = {}) {
  const preset = options.preset || 'medium';
  const crf = options.crf || '23';
  const audioBitrate = options.audioBitrate || '192k';
  
  // Get video metadata
  const meta = await getVideoMetadata(videoPath);
  const videoHasAudio = hasAudioStream(meta);
  const originalFps = getFrameRate(meta);
  const outputFps = originalFps * speedValue;
  
  let command = ffmpeg(videoPath);
  
  if (videoHasAudio) {
    const filters = [];
    filters.push(`[0:v]setpts=${1/speedValue}*PTS,fps=${outputFps}[v]`);
    
    // Apply speed to audio
    if (speedValue > 2) {
      const tempo1 = 2.0;
      const tempo2 = speedValue / 2.0;
      filters.push(`[0:a]atempo=${tempo1},atempo=${tempo2}[a]`);
    } else {
      filters.push(`[0:a]atempo=${speedValue}[a]`);
    }
    
    command = command
      .complexFilter(filters)
      .outputOptions([
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', 'libx264',
        '-preset', preset,
        '-crf', crf,
        '-r', String(outputFps),
        '-c:a', 'aac',
        '-b:a', audioBitrate
      ]);
  } else {
    command = command
      .videoFilters(`setpts=${1/speedValue}*PTS,fps=${outputFps}`)
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', preset,
        '-crf', crf,
        '-r', String(outputFps),
        '-an'
      ]);
  }
  
  return new Promise((resolve, reject) => {
    command
      .output(outputPath)
      .on('end', () => {
        console.log("Speed applied:", outputPath);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error("Speed error:", err);
        reject(err);
      })
      .run();
  });
}

module.exports = { applySpeed };


