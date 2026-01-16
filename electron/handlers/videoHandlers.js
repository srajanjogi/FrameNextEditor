const { dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const { normalizeMainVideoPath } = require("../utils/pathUtils");
const { prepareOutputPath } = require("../utils/fileUtils");
const { processVideoPipeline } = require("../video/pipeline");
const { getMainVideoPath } = require("./fileHandlers");

/**
 * Trim video handler
 */
async function handleTrimVideo(_, { start, end }) {
  const result = await dialog.showSaveDialog({
    title: "Save Trimmed Video",
    defaultPath: "trimmed.mp4",
    filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
  });

  // Handle both old API (string) and new API (object) formats
  let filePath = null;
  if (typeof result === 'string') {
    // Old API: returns string directly
    filePath = result;
  } else if (result && typeof result === 'object') {
    // New API: returns object with canceled and filePath
    if (result.canceled || !result.filePath) {
      return null;
    }
    filePath = result.filePath;
  } else {
    return null;
  }

  // Ensure filePath is a string
  if (!filePath || typeof filePath !== 'string') {
    throw new Error(`Invalid file path from dialog: expected string, got ${typeof filePath}`);
  }

  filePath = prepareOutputPath(filePath);

  const mainVideo = getMainVideoPath();
  if (!mainVideo) {
    throw new Error("No video selected");
  }

  return new Promise((resolve, reject) => {
    ffmpeg(mainVideo)
      .setStartTime(start)
      .setDuration(end - start)
      .output(filePath)
      .on("end", () => {
        console.log("Trim saved:", filePath);
        resolve(filePath);
      })
      .on("error", (err) => {
        console.error("FFmpeg error:", err);
        reject(err);
      })
      .run();
  });
}

/**
 * Export video with all features
 */
async function handleExportVideo(_, features, mainVideoPathParam = null) {
  // Get and normalize main video path first (needed for dialog default path)
  let mainVideo = mainVideoPathParam || getMainVideoPath();
  if (!mainVideo) {
    throw new Error("No main video selected");
  }

  mainVideo = normalizeMainVideoPath(mainVideo);
  
  if (!fs.existsSync(mainVideo)) {
    throw new Error(`Main video file not found: ${mainVideo}`);
  }

  // Build a default filename in the same folder as the main video
  const mainDir = path.dirname(mainVideo);
  const mainName = path.parse(mainVideo).name;
  const defaultOutput = path.join(mainDir, `${mainName}_edited.mp4`);

  const result = await dialog.showSaveDialog({
    title: "Save Edited Video",
    defaultPath: defaultOutput,
    filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
  });

  // Handle both old API (string) and new API (object) formats
  let filePath = null;
  if (typeof result === 'string') {
    // Old API: returns string directly
    filePath = result;
  } else if (result && typeof result === 'object') {
    // New API: returns object with canceled and filePath
    if (result.canceled || !result.filePath) {
      return null;
    }
    filePath = result.filePath;
  } else {
    return null;
  }

  // Ensure filePath is a string
  if (!filePath || typeof filePath !== 'string') {
    throw new Error(`Invalid file path from dialog: expected string, got ${typeof filePath}`);
  }

  filePath = prepareOutputPath(filePath);

  console.log("Export features received:", JSON.stringify(features, null, 2));
  console.log("Main video path:", mainVideo);

  // Process through pipeline
  return await processVideoPipeline(mainVideo, features, filePath, { isPreview: false });
}

/**
 * Generate preview with all features
 */
async function handleGeneratePreview(_, features, mainVideoPathParam = null) {
  // Get main video path
  let mainVideo = mainVideoPathParam || getMainVideoPath();
  if (!mainVideo) {
    throw new Error("No main video selected");
  }

  // Normalize main video path
  mainVideo = normalizeMainVideoPath(mainVideo);
  
  if (!fs.existsSync(mainVideo)) {
    throw new Error(`Main video file not found: ${mainVideo}`);
  }

  // Create temp preview file using the same path preparation as export
  const os = require('os');
  const tempDir = path.join(os.tmpdir(), 'videoeditor_preview');
  
  // Ensure directory exists
  if (!fs.existsSync(tempDir)) {
    try {
      fs.mkdirSync(tempDir, { recursive: true });
    } catch (dirErr) {
      console.error("Error creating preview directory:", dirErr);
      throw new Error(`Failed to create preview directory: ${tempDir}`);
    }
  }
  
  // Create preview file path - use prepareOutputPath to ensure proper formatting
  let previewFile = path.join(tempDir, `preview_${Date.now()}.mp4`);
  previewFile = prepareOutputPath(previewFile);
  
  console.log("Preview file path:", previewFile);

  console.log("generate-preview handler called");
  console.log("Preview features:", JSON.stringify(features, null, 2));

  // Process through pipeline with preview options
  return await processVideoPipeline(mainVideo, features, previewFile, { isPreview: true });
}

module.exports = {
  handleTrimVideo,
  handleExportVideo,
  handleGeneratePreview
};


