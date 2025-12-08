const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

let selectedVideoPath = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      webSecurity: false
    }
  });

  win.loadURL("http://localhost:5173");
}

/* -------------------------
   PICK VIDEO (simple path)
--------------------------*/
ipcMain.handle("pick-video", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Videos", extensions: ["mp4", "mov", "mkv"] }]
  });

  if (result.canceled) return null;

  selectedVideoPath = result.filePaths[0];

  return {
    videoPath: selectedVideoPath
  };
});

/* -------------------------
      TRIM VIDEO
   (Safe, error-proof)
--------------------------*/
ipcMain.handle("trim-video", async (_, { start, end }) => {
  let { filePath } = await dialog.showSaveDialog({
    title: "Save Trimmed Video",
    defaultPath: "trimmed.mp4",
    filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
  });

  if (!filePath) return null;

  filePath = filePath.replace(/[. ]+$/, "");

  /* 🔥 FIX 2: Force .mp4 extension */
  if (!filePath.toLowerCase().endsWith(".mp4")) {
    filePath = filePath + ".mp4";
  }

  /* 🔥 FIX 3: Ensure directory exists */
  const folder = path.dirname(filePath);
  try {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
  } catch (err) {
    console.error("Folder creation error:", err);
    throw err;
  }

  /* 🔥 FIX 4: FFmpeg trim safely */
  return new Promise((resolve, reject) => {
    ffmpeg(selectedVideoPath)
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
});

app.whenReady().then(createWindow);
