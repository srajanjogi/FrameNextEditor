const ffmpeg = require("fluent-ffmpeg");

/**
 * Gets video metadata using ffprobe
 * @param {string} videoPath - Path to video file
 * @returns {Promise<Object>} Video metadata
 */
function getVideoMetadata(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata);
    });
  });
}

/**
 * Detects if video has audio stream
 * @param {Object} metadata - Video metadata from ffprobe
 * @returns {boolean} True if video has audio
 */
function hasAudioStream(metadata) {
  return (metadata.streams || []).some(s => s.codec_type === 'audio');
}

/**
 * Gets frame rate from video metadata
 * @param {Object} metadata - Video metadata from ffprobe
 * @returns {number} Frame rate (fps)
 */
function getFrameRate(metadata) {
  const videoStream = (metadata.streams || []).find(s => s.codec_type === 'video');
  if (!videoStream) return 30; // Default
  
  let fps = 30;
  
  // Try r_frame_rate first
  if (videoStream.r_frame_rate) {
    const parts = videoStream.r_frame_rate.split('/');
    if (parts.length === 2 && parseFloat(parts[1]) > 0) {
      fps = parseFloat(parts[0]) / parseFloat(parts[1]);
    }
  }
  
  // Try avg_frame_rate if r_frame_rate didn't work
  if ((!fps || fps <= 0 || fps > 120) && videoStream.avg_frame_rate) {
    const parts = videoStream.avg_frame_rate.split('/');
    if (parts.length === 2 && parseFloat(parts[1]) > 0) {
      const avgFps = parseFloat(parts[0]) / parseFloat(parts[1]);
      if (avgFps > 0 && avgFps <= 120) {
        fps = avgFps;
      }
    }
  }
  
  // Fallback: calculate from nb_frames / duration
  if ((!fps || fps <= 0 || fps > 120) && videoStream.nb_frames && metadata.format.duration) {
    const calculatedFps = videoStream.nb_frames / parseFloat(metadata.format.duration);
    if (calculatedFps > 0 && calculatedFps <= 120) {
      fps = calculatedFps;
    }
  }
  
  // Clamp to reasonable range
  return Math.max(1, Math.min(120, Math.round(fps * 100) / 100));
}

/**
 * Gets video properties (width, height, fps) from metadata
 * @param {Object} metadata - Video metadata from ffprobe
 * @returns {Object} Video properties
 */
function getVideoProperties(metadata) {
  const videoStream = (metadata.streams || []).find(s => s.codec_type === 'video');
  return {
    width: videoStream?.width || 1920,
    height: videoStream?.height || 1080,
    fps: getFrameRate(metadata)
  };
}

module.exports = {
  getVideoMetadata,
  hasAudioStream,
  getFrameRate,
  getVideoProperties
};


