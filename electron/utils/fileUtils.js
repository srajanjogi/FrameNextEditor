const fs = require("fs");
const path = require("path");

/**
 * Ensures a directory exists, creates it if it doesn't
 * @param {string} dirPath - Directory path
 * @throws {Error} If directory cannot be created
 */
function ensureDirectoryExists(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (err) {
    console.error("Directory creation error:", err);
    throw err;
  }
}

/**
 * Prepares output file path (ensures .mp4 extension and directory exists)
 * @param {string} filePath - Original file path
 * @returns {string} Prepared file path
 */
function prepareOutputPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error(`Invalid file path: expected string, got ${typeof filePath}`);
  }
  filePath = filePath.replace(/[. ]+$/, "");
  if (!filePath.toLowerCase().endsWith(".mp4")) {
    filePath = filePath + ".mp4";
  }
  
  // Normalize for Windows
  if (process.platform === 'win32') {
    filePath = path.normalize(filePath);
  }
  
  const folder = path.dirname(filePath);
  ensureDirectoryExists(folder);
  
  // Test write permissions
  const testFile = path.join(folder, `.test_${Date.now()}.tmp`);
  try {
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
  } catch (testErr) {
    throw new Error(`Cannot write to directory: ${folder}. Please check permissions.`);
  }
  
  return filePath;
}

/**
 * Cleans up temporary files
 * @param {string[]} tempFiles - Array of temp file paths
 */
function cleanupTempFiles(tempFiles) {
  tempFiles.forEach(tempFile => {
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch (e) {
      console.error("Error deleting temp file:", e);
    }
  });
}

module.exports = {
  ensureDirectoryExists,
  prepareOutputPath,
  cleanupTempFiles
};


