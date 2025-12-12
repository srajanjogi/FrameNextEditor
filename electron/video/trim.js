const ffmpeg = require("fluent-ffmpeg");

/**
 * Trims a video to specified time range
 * @param {string} videoPath - Input video path
 * @param {number} start - Start time in seconds
 * @param {number} end - End time in seconds
 * @param {string} outputPath - Output file path
 * @returns {Promise<string>} Path to trimmed video
 */
async function trimVideo(videoPath, start, end, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .setStartTime(start)
      .setDuration(end - start)
      .output(outputPath)
      .on('end', () => {
        console.log("Trim completed:", outputPath);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error("Trim error:", err);
        reject(err);
      })
      .run();
  });
}

module.exports = { trimVideo };


