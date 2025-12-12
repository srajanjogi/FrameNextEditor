const { dialog } = require("electron");

let selectedVideoPath = null;
let mainVideoPath = null;

/**
 * Pick video file
 */
async function handlePickVideo(_, isInsertVideo = false) {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Videos", extensions: ["mp4", "mov", "mkv"] }]
  });

  if (result.canceled) return null;

  const videoPath = result.filePaths[0];
  
  // Only update mainVideoPath if this is NOT an insert video picker
  if (!isInsertVideo) {
    mainVideoPath = videoPath;
    selectedVideoPath = videoPath;
  }

  return {
    videoPath: videoPath
  };
}

/**
 * Pick audio file
 */
async function handlePickAudio() {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "Audio Files", extensions: ["mp3", "wav", "aac", "m4a", "ogg", "flac", "wma", "opus", "mp2", "mp1", "3gp", "amr", "au", "ra"] },
        { name: "MP3", extensions: ["mp3"] },
        { name: "WAV", extensions: ["wav"] },
        { name: "AAC", extensions: ["aac", "m4a"] },
        { name: "OGG", extensions: ["ogg", "oga"] },
        { name: "FLAC", extensions: ["flac"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }

    const audioPath = result.filePaths[0];
    console.log("Selected audio file:", audioPath);

    return {
      audioPath: audioPath
    };
  } catch (error) {
    console.error("Error picking audio file:", error);
    return null;
  }
}

/**
 * Get main video path (for use in other handlers)
 */
function getMainVideoPath() {
  return mainVideoPath || selectedVideoPath;
}

module.exports = {
  handlePickVideo,
  handlePickAudio,
  getMainVideoPath
};


