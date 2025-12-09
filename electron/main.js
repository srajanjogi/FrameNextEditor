const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

let selectedVideoPath = null;
let mainVideoPath = null;

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
ipcMain.handle("pick-video", async (_, isInsertVideo = false) => {
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
});

/* -------------------------
   PICK AUDIO (audio files)
--------------------------*/
ipcMain.handle("pick-audio", async () => {
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
    const mainVideo = mainVideoPath || selectedVideoPath;
    if (!mainVideo) {
      reject(new Error("No video selected"));
      return;
    }
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
});

/* -------------------------
   EXPORT VIDEO WITH ALL FEATURES
--------------------------*/
ipcMain.handle("export-video", async (_, features, mainVideoPathParam = null) => {
  let { filePath } = await dialog.showSaveDialog({
    title: "Save Edited Video",
    defaultPath: "edited_video.mp4",
    filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
  });

  if (!filePath) return null;

  filePath = filePath.replace(/[. ]+$/, "");
  if (!filePath.toLowerCase().endsWith(".mp4")) {
    filePath = filePath + ".mp4";
  }

  const folder = path.dirname(filePath);
  try {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
  } catch (err) {
    console.error("Folder creation error:", err);
    throw err;
  }

  return new Promise((resolve, reject) => {
    console.log("Export features received:", JSON.stringify(features, null, 2));
    
    // Use the main video path from parameter, or fall back to stored path
    let mainVideo = mainVideoPathParam || mainVideoPath || selectedVideoPath;
    if (!mainVideo) {
      reject(new Error("No main video selected"));
      return;
    }
    
    // Normalize main video path (remove file:// if present)
    if (mainVideo.startsWith("file://")) {
      mainVideo = mainVideo.replace("file://", "");
    }
    
    // Handle Windows paths
    if (process.platform === 'win32' && mainVideo.startsWith("/")) {
      mainVideo = mainVideo.replace(/^\/+/, "");
    }
    
    // Ensure path is absolute
    if (!path.isAbsolute(mainVideo)) {
      mainVideo = path.resolve(mainVideo);
    }
    
    // Validate main video exists
    if (!fs.existsSync(mainVideo)) {
      reject(new Error(`Main video file not found: ${mainVideo}`));
      return;
    }
    
    console.log("Main video path:", mainVideo);
    
    let command;

    // Explicitly check: if only trim is active, use simple trim path
    const hasOnlyTrim = features.trim && 
                       !features.merge && 
                       !features.insert && 
                       !features.audio && 
                       (!features.speed || features.speed === 1.0);

    // Handle insert video (position + duration)
    if (features.insert && features.insert.video && typeof features.insert.video === 'string') {
      let insertVideoPath = features.insert.video.replace(/^file:\/\//, "");
      if (process.platform === 'win32') {
        insertVideoPath = insertVideoPath.replace(/^\/+/, "");
      }
      if (!path.isAbsolute(insertVideoPath)) {
        insertVideoPath = path.resolve(insertVideoPath);
      }
      if (!fs.existsSync(insertVideoPath)) {
        reject(new Error(`Insert video file not found: ${insertVideoPath}`));
        return;
      }

      // Check if trim is active - if so, work only with trimmed portion
      const trimStart = features.trim && features.trim.start !== undefined ? Number(features.trim.start) : 0;
      const trimEnd = features.trim && features.trim.end !== undefined ? Number(features.trim.end) : null;
      const hasTrim = trimEnd !== null && trimEnd > trimStart;

      const insertPos = Math.max(0, Number(features.insert.position) || 0);
      const insertDurRequested = Math.max(0.1, Number(features.insert.seconds) || 5);

      ffmpeg.ffprobe(mainVideo, (err, mainMeta) => {
        if (err) return reject(err);
        ffmpeg.ffprobe(insertVideoPath, (err2, insMeta) => {
          if (err2) return reject(err2);

          const mainDur = Number(mainMeta.format.duration) || 0;
          const insDur = Number(insMeta.format.duration) || insertDurRequested;
          
          // If trim is active, work only within trimmed portion
          let workingStart = 0;
          let workingEnd = mainDur;
          let relativeInsertPos = insertPos;
          
          if (hasTrim) {
            workingStart = Math.max(0, Math.min(trimStart, mainDur));
            workingEnd = Math.max(workingStart, Math.min(trimEnd, mainDur));
            // Insert position is relative to trim start
            relativeInsertPos = Math.max(0, Math.min(insertPos, workingEnd - workingStart));
            console.log(`Trim active: working with ${workingStart}s to ${workingEnd}s, insert at relative position ${relativeInsertPos}s`);
          } else {
            relativeInsertPos = Math.min(insertPos, mainDur);
          }
          
          const safePos = relativeInsertPos;
          const safeDur = Math.min(insertDurRequested, insDur);
          const workingDuration = workingEnd - workingStart;

          const mainHasA = (mainMeta.streams || []).some(s => s.codec_type === 'audio');
          const insHasA = (insMeta.streams || []).some(s => s.codec_type === 'audio');

          // Get video properties for normalization
          const mainVideoStream = (mainMeta.streams || []).find(s => s.codec_type === 'video');
          const insertVideoStream = (insMeta.streams || []).find(s => s.codec_type === 'video');

          // Get resolution and frame rate from main video (use as standard)
          const mainWidth = mainVideoStream?.width || 1920;
          const mainHeight = mainVideoStream?.height || 1080;
          
          // Parse frame rate safely
          let mainFpsNum = 30;
          if (mainVideoStream?.r_frame_rate) {
            const parts = mainVideoStream.r_frame_rate.split('/');
            if (parts.length === 2 && parseFloat(parts[1]) > 0) {
              mainFpsNum = parseFloat(parts[0]) / parseFloat(parts[1]);
            }
          }
          mainFpsNum = Math.max(1, Math.min(60, Math.round(mainFpsNum * 100) / 100)); // Clamp between 1-60fps

          console.log("Video properties:", {
            main: `${mainWidth}x${mainHeight} @ ${mainFpsNum}fps`,
            mainHasAudio: mainHasA,
            insertHasAudio: insHasA
          });

          // Build filters with normalization
          // Work only with the trimmed portion (or full video if no trim)
          const filters = [];
          
          // Calculate absolute positions in original video
          const absInsertPos = workingStart + safePos;
          const absWorkingEnd = workingEnd;
          
          // Part 1: Main video before insert (within working range, only if position > 0)
          if (safePos > 0.1) {
            filters.push(`[0:v]trim=start=${workingStart}:end=${absInsertPos},setpts=PTS-STARTPTS,fps=${mainFpsNum},scale=${mainWidth}:${mainHeight}:force_original_aspect_ratio=decrease,pad=${mainWidth}:${mainHeight}:-1:-1:color=black[v0]`);
            
            // Audio for part 1
            if (mainHasA) {
              filters.push(`[0:a]atrim=start=${workingStart}:end=${absInsertPos},asetpts=PTS-STARTPTS[a0]`);
            } else {
              filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${safePos},asetpts=PTS-STARTPTS[a0]`);
            }
          }

          // Part 2: Insert video (normalize to match main video properties)
          filters.push(`[1:v]trim=start=0:end=${safeDur},setpts=PTS-STARTPTS,fps=${mainFpsNum},scale=${mainWidth}:${mainHeight}:force_original_aspect_ratio=decrease,pad=${mainWidth}:${mainHeight}:-1:-1:color=black[v1]`);

          // Audio for part 2
          if (insHasA) {
            filters.push(`[1:a]atrim=start=0:end=${safeDur},asetpts=PTS-STARTPTS[a1]`);
          } else {
            filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${safeDur},asetpts=PTS-STARTPTS[a1]`);
          }

          // Part 3: Main video after insert (within working range, if there's remaining video)
          const remainingInWorkingRange = absWorkingEnd - absInsertPos;
          if (remainingInWorkingRange > 0.1) {
            filters.push(`[0:v]trim=start=${absInsertPos}:end=${absWorkingEnd},setpts=PTS-STARTPTS,fps=${mainFpsNum},scale=${mainWidth}:${mainHeight}:force_original_aspect_ratio=decrease,pad=${mainWidth}:${mainHeight}:-1:-1:color=black[v2]`);
            
            // Audio for part 3
            if (mainHasA) {
              filters.push(`[0:a]atrim=start=${absInsertPos}:end=${absWorkingEnd},asetpts=PTS-STARTPTS[a2]`);
            } else {
              filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${remainingInWorkingRange},asetpts=PTS-STARTPTS[a2]`);
            }
            
            // Concatenate all three parts
            if (safePos > 0.1) {
              filters.push(`[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[outv][outa]`);
            } else {
              // Insert at start of working range, only two parts
              filters.push(`[v1][a1][v2][a2]concat=n=2:v=1:a=1[outv][outa]`);
            }
          } else {
            // Only two parts (before insert + insert, or just insert)
            if (safePos > 0.1) {
              filters.push(`[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]`);
            } else {
              // Only insert video (within working range)
              filters.push(`[v1][a1]concat=n=1:v=1:a=1[outv][outa]`);
            }
          }

          console.log("FFmpeg filters (insert with normalization):", filters);

          command = ffmpeg()
            .input(mainVideo)
            .input(insertVideoPath)
            .complexFilter(filters)
            .outputOptions([
              '-map', '[outv]', 
              '-map', '[outa]', 
              '-c:v', 'libx264', 
              '-preset', 'medium',
              '-crf', '23',
              '-c:a', 'aac', 
              '-b:a', '192k',
              '-shortest'
            ]);

          command
            .output(filePath)
            .on("start", (cl) => console.log("FFmpeg command:", cl))
            .on("progress", (p) => p.percent && console.log(`Processing: ${Math.round(p.percent)}% done`))
            .on("end", () => {
              console.log("Video exported:", filePath);
              resolve(filePath);
            })
            .on("error", (e) => {
              console.error("FFmpeg error:", e);
              reject(e);
            })
            .run();
        });
      });
      return;
    }

    // Handle merge videos first (requires different approach)
    if (!hasOnlyTrim && features.merge && Array.isArray(features.merge) && features.merge.length > 0) {
      const tempFile = path.join(folder, `temp_${Date.now()}.txt`);
      const videoList = [mainVideo];
      features.merge.forEach(v => videoList.push(v.path));
      
      // Create concat file
      const listContent = videoList.map(v => {
        const normalizedPath = v.replace(/\\/g, '/');
        return `file '${normalizedPath}'`;
      }).join('\n');
      
      fs.writeFileSync(tempFile, listContent, 'utf8');
      
      command = ffmpeg()
        .input(tempFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy']);
      
      // Clean up temp file after processing
      const cleanup = () => {
        try {
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
        } catch (e) {
          console.error("Error deleting temp file:", e);
        }
      };
      
      command.on('end', cleanup);
      command.on('error', cleanup);
    }
    // Handle simple cases: trim, speed, audio (no complex filters)
    else {
      // For trim-only, use the exact same approach as the standalone trim function
      if (hasOnlyTrim && features.trim) {
        console.log(`Trimming video only: ${features.trim.start}s to ${features.trim.end}s`);
        command = ffmpeg(mainVideo)
          .setStartTime(features.trim.start)
          .setDuration(features.trim.end - features.trim.start);
      } else {
        command = ffmpeg(mainVideo);

        // Handle trim feature
        if (features.trim && 
            features.trim.start !== undefined && 
            features.trim.end !== undefined &&
            typeof features.trim.start === 'number' &&
            typeof features.trim.end === 'number' &&
            features.trim.start >= 0 &&
            features.trim.end > features.trim.start) {
          console.log(`Trimming video: ${features.trim.start}s to ${features.trim.end}s`);
          command = command
            .setStartTime(features.trim.start)
            .setDuration(features.trim.end - features.trim.start);
        }

        // Handle speed control
        if (features.speed && features.speed !== 1.0) {
          // For speed > 2x, we need to chain atempo filters
          if (features.speed > 2) {
            const tempo1 = 2.0;
            const tempo2 = features.speed / 2.0;
            command = command
              .videoFilters(`setpts=${1/features.speed}*PTS`)
              .audioFilters(`atempo=${tempo1},atempo=${tempo2}`);
          } else {
            command = command
              .videoFilters(`setpts=${1/features.speed}*PTS`)
              .audioFilters(`atempo=${features.speed}`);
          }
        }

        // Handle audio replacement/addition
        if (features.audio) {
          let audioPath = features.audio.replace(/^file:\/\//, "");
          // Handle Windows paths
          if (process.platform === 'win32') {
            audioPath = audioPath.replace(/^\//, "");
          }
          command = command
            .input(audioPath)
            .outputOptions([
              '-map', '0:v:0',
              '-map', '1:a:0',
              '-c:v', 'copy',
              '-c:a', 'aac',
              '-shortest'
            ]);
        }
      }
    }

    command
      .output(filePath)
      .on("start", (commandLine) => {
        console.log("FFmpeg command:", commandLine);
      })
      .on("progress", (progress) => {
        if (progress.percent) {
          console.log("Processing: " + Math.round(progress.percent) + "% done");
        }
      })
      .on("end", () => {
        console.log("Video exported:", filePath);
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
