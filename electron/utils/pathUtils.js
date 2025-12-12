const path = require("path");

/**
 * Normalizes a file path for cross-platform compatibility
 * @param {string} filePath - The file path to normalize
 * @returns {string} Normalized absolute path
 */
function normalizePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error(`Invalid file path: expected string, got ${typeof filePath}`);
  }
  let normalized = filePath.replace(/^file:\/\//, "");
  if (process.platform === 'win32') {
    normalized = normalized.replace(/^\/+/, "");
  }
  if (!path.isAbsolute(normalized)) {
    normalized = path.resolve(normalized);
  }
  return normalized;
}

/**
 * Normalizes main video path from frontend
 * @param {string} mainVideo - Video path (may have file:// prefix)
 * @returns {string} Normalized path
 */
function normalizeMainVideoPath(mainVideo) {
  if (!mainVideo || typeof mainVideo !== 'string') {
    throw new Error(`Invalid main video path: expected string, got ${typeof mainVideo}`);
  }
  if (mainVideo.startsWith("file://")) {
    mainVideo = mainVideo.replace("file://", "");
  }
  if (process.platform === 'win32' && mainVideo.startsWith("/")) {
    mainVideo = mainVideo.replace(/^\/+/, "");
  }
  if (!path.isAbsolute(mainVideo)) {
    mainVideo = path.resolve(mainVideo);
  }
  return mainVideo;
}

module.exports = {
  normalizePath,
  normalizeMainVideoPath
};


