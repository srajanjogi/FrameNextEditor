const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

// Setup FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// Import handlers
const { handlePickVideo, handlePickAudio } = require("./handlers/fileHandlers");
const { handleTrimVideo, handleExportVideo, handleGeneratePreview } = require("./handlers/videoHandlers");

/**
 * Create main application window
 */
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      webSecurity: false
    }
  });

  win.loadURL("http://localhost:5174");
}

// Register IPC handlers
ipcMain.handle("pick-video", handlePickVideo);
ipcMain.handle("pick-audio", handlePickAudio);
ipcMain.handle("trim-video", handleTrimVideo);
ipcMain.handle("export-video", handleExportVideo);
ipcMain.handle("generate-preview", handleGeneratePreview);

// App lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
