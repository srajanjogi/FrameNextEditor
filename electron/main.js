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

  // Normalize file path for Windows
  if (process.platform === 'win32') {
    filePath = path.normalize(filePath);
  }

  const folder = path.dirname(filePath);
  try {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    // Ensure the file path is writable by checking if we can create a test file
    const testFile = path.join(folder, `.test_${Date.now()}.tmp`);
    try {
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
    } catch (testErr) {
      throw new Error(`Cannot write to directory: ${folder}. Please check permissions.`);
    }
  } catch (err) {
    console.error("Folder creation/access error:", err);
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
    
    // Helper function to normalize file paths
    const normalizePath = (filePath) => {
      let normalized = filePath.replace(/^file:\/\//, "");
      if (process.platform === 'win32') {
        normalized = normalized.replace(/^\/+/, "");
      }
      if (!path.isAbsolute(normalized)) {
        normalized = path.resolve(normalized);
      }
      return normalized;
    };

    // Pipeline approach: Process features sequentially using temp files when needed
    // Step 1: Merge videos (if present) -> temp1
    // Step 2: Trim (if present) -> temp2 (or use temp1/mainVideo)
    // Step 3: Insert (if present) -> temp3 (or use temp2/mainVideo)
    // Step 4: Speed + Audio -> final output

    const processPipeline = async () => {
      let currentVideo = mainVideo;
      const tempFiles = [];
      
      try {
        // STEP 1: Merge videos if present
        if (features.merge && Array.isArray(features.merge) && features.merge.length > 0) {
          console.log("Step 1: Merging videos...");
          const tempMergeFile = path.join(folder, `temp_merge_${Date.now()}.mp4`);
          tempFiles.push(tempMergeFile);
          
          const tempConcatFile = path.join(folder, `temp_concat_${Date.now()}.txt`);
          tempFiles.push(tempConcatFile);
          
          const videoList = [currentVideo];
          features.merge.forEach(v => {
            const normalizedPath = normalizePath(v.path);
            if (fs.existsSync(normalizedPath)) {
              videoList.push(normalizedPath);
            }
          });
          
          const listContent = videoList.map(v => {
            const normalizedPath = v.replace(/\\/g, '/');
            return `file '${normalizedPath}'`;
          }).join('\n');
          
          fs.writeFileSync(tempConcatFile, listContent, 'utf8');
          
          await new Promise((mergeResolve, mergeReject) => {
            ffmpeg()
              .input(tempConcatFile)
              .inputOptions(['-f', 'concat', '-safe', '0'])
              .outputOptions(['-c', 'copy'])
              .output(tempMergeFile)
              .on('end', () => {
                console.log("Merge completed:", tempMergeFile);
                currentVideo = tempMergeFile;
                mergeResolve();
              })
              .on('error', (err) => {
                console.error("Merge error:", err);
                mergeReject(err);
              })
              .run();
          });
        }

        // STEP 2: Trim if present (but not if insert will handle it)
        const hasInsert = features.insert && features.insert.video && typeof features.insert.video === 'string';
        if (features.trim && !hasInsert && 
            features.trim.start !== undefined && 
            features.trim.end !== undefined &&
            typeof features.trim.start === 'number' &&
            typeof features.trim.end === 'number' &&
            features.trim.start >= 0 &&
            features.trim.end > features.trim.start) {
          console.log("Step 2: Trimming video...");
          const tempTrimFile = path.join(folder, `temp_trim_${Date.now()}.mp4`);
          tempFiles.push(tempTrimFile);
          
          await new Promise((trimResolve, trimReject) => {
            ffmpeg(currentVideo)
              .setStartTime(features.trim.start)
              .setDuration(features.trim.end - features.trim.start)
              .output(tempTrimFile)
              .on('end', () => {
                console.log("Trim completed:", tempTrimFile);
                currentVideo = tempTrimFile;
                trimResolve();
              })
              .on('error', (err) => {
                console.error("Trim error:", err);
                trimReject(err);
              })
              .run();
          });
        }

        // STEP 3: Insert video if present
        if (hasInsert) {
          console.log("Step 3: Inserting video...");
          const tempInsertFile = path.join(folder, `temp_insert_${Date.now()}.mp4`);
          tempFiles.push(tempInsertFile);
          
          let insertVideoPath = normalizePath(features.insert.video);
          if (!fs.existsSync(insertVideoPath)) {
            throw new Error(`Insert video file not found: ${insertVideoPath}`);
          }

          // Check if trim is active - if so, work only with trimmed portion
          const trimStart = features.trim && features.trim.start !== undefined ? Number(features.trim.start) : 0;
          const trimEnd = features.trim && features.trim.end !== undefined ? Number(features.trim.end) : null;
          const hasTrim = trimEnd !== null && trimEnd > trimStart;

          const insertPos = Math.max(0, Number(features.insert.position) || 0);
          const insertDurRequested = Math.max(0.1, Number(features.insert.seconds) || 5);

          await new Promise((insertResolve, insertReject) => {
            ffmpeg.ffprobe(currentVideo, (err, mainMeta) => {
              if (err) return insertReject(err);
              ffmpeg.ffprobe(insertVideoPath, (err2, insMeta) => {
                if (err2) return insertReject(err2);

                const mainDur = Number(mainMeta.format.duration) || 0;
                const insDur = Number(insMeta.format.duration) || insertDurRequested;
                
                // If trim is active, work only within trimmed portion
                let workingStart = 0;
                let workingEnd = mainDur;
                let relativeInsertPos = insertPos;
                
                if (hasTrim) {
                  workingStart = Math.max(0, Math.min(trimStart, mainDur));
                  workingEnd = Math.max(workingStart, Math.min(trimEnd, mainDur));
                  relativeInsertPos = Math.max(0, Math.min(insertPos, workingEnd - workingStart));
                  console.log(`Trim active: working with ${workingStart}s to ${workingEnd}s, insert at relative position ${relativeInsertPos}s`);
                } else {
                  relativeInsertPos = Math.min(insertPos, mainDur);
                }
                
                const safePos = relativeInsertPos;
                const safeDur = Math.min(insertDurRequested, insDur);

                const mainHasA = (mainMeta.streams || []).some(s => s.codec_type === 'audio');
                const insHasA = (insMeta.streams || []).some(s => s.codec_type === 'audio');

                // Get video properties for normalization
                const mainVideoStream = (mainMeta.streams || []).find(s => s.codec_type === 'video');

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
                mainFpsNum = Math.max(1, Math.min(60, Math.round(mainFpsNum * 100) / 100));

                // Build filters with normalization (no speed here - will apply later)
                const filters = [];
                const absInsertPos = workingStart + safePos;
                const absWorkingEnd = workingEnd;
                
                // Part 1: Main video before insert
                if (safePos > 0.1) {
                  filters.push(`[0:v]trim=start=${workingStart}:end=${absInsertPos},setpts=PTS-STARTPTS,fps=${mainFpsNum},scale=${mainWidth}:${mainHeight}:force_original_aspect_ratio=decrease,pad=${mainWidth}:${mainHeight}:-1:-1:color=black[v0]`);
                  if (mainHasA) {
                    filters.push(`[0:a]atrim=start=${workingStart}:end=${absInsertPos},asetpts=PTS-STARTPTS[a0]`);
                  } else {
                    filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${safePos},asetpts=PTS-STARTPTS[a0]`);
                  }
                }

                // Part 2: Insert video
                filters.push(`[1:v]trim=start=0:end=${safeDur},setpts=PTS-STARTPTS,fps=${mainFpsNum},scale=${mainWidth}:${mainHeight}:force_original_aspect_ratio=decrease,pad=${mainWidth}:${mainHeight}:-1:-1:color=black[v1]`);
                if (insHasA) {
                  filters.push(`[1:a]atrim=start=0:end=${safeDur},asetpts=PTS-STARTPTS[a1]`);
                } else {
                  filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${safeDur},asetpts=PTS-STARTPTS[a1]`);
                }

                // Part 3: Main video after insert
                const remainingInWorkingRange = absWorkingEnd - absInsertPos;
                if (remainingInWorkingRange > 0.1) {
                  filters.push(`[0:v]trim=start=${absInsertPos}:end=${absWorkingEnd},setpts=PTS-STARTPTS,fps=${mainFpsNum},scale=${mainWidth}:${mainHeight}:force_original_aspect_ratio=decrease,pad=${mainWidth}:${mainHeight}:-1:-1:color=black[v2]`);
                  if (mainHasA) {
                    filters.push(`[0:a]atrim=start=${absInsertPos}:end=${absWorkingEnd},asetpts=PTS-STARTPTS[a2]`);
                  } else {
                    filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${remainingInWorkingRange},asetpts=PTS-STARTPTS[a2]`);
                  }
                  
                  if (safePos > 0.1) {
                    filters.push(`[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[outv][outa]`);
                  } else {
                    filters.push(`[v1][a1][v2][a2]concat=n=2:v=1:a=1[outv][outa]`);
                  }
                } else {
                  if (safePos > 0.1) {
                    filters.push(`[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]`);
                  } else {
                    filters.push(`[v1][a1]concat=n=1:v=1:a=1[outv][outa]`);
                  }
                }

                ffmpeg()
                  .input(currentVideo)
                  .input(insertVideoPath)
                  .complexFilter(filters)
                  .outputOptions([
                    '-map', '[outv]',
                    '-map', '[outa]',
                    '-c:v', 'libx264',
                    '-preset', 'medium',
                    '-crf', '23',
                    '-r', String(mainFpsNum), // Explicitly set frame rate for concatenated video
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-shortest'
                  ])
                  .output(tempInsertFile)
                  .on('end', () => {
                    console.log("Insert completed:", tempInsertFile);
                    currentVideo = tempInsertFile;
                    insertResolve();
                  })
                  .on('error', (err) => {
                    console.error("Insert error:", err);
                    insertReject(err);
                  })
                  .run();
              });
            });
          });
        }

        // STEP 4: Apply speed and audio to final output
        console.log("Step 4: Applying speed and audio...");
        const hasSpeed = features.speed && features.speed !== 1.0;
        const hasAudio = features.audio && typeof features.audio === 'string';
        const speedValue = hasSpeed ? Number(features.speed) : 1.0;
        
        // Check if current video has audio and get frame rate
        let videoHasAudio = false;
        let originalFps = 30; // Default fps
        try {
          const meta = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(currentVideo, (err, metadata) => {
              if (err) reject(err);
              else resolve(metadata);
            });
          });
          videoHasAudio = (meta.streams || []).some(s => s.codec_type === 'audio');
          
          // Get original frame rate - try both r_frame_rate and avg_frame_rate
          const videoStream = (meta.streams || []).find(s => s.codec_type === 'video');
          if (videoStream) {
            // Try r_frame_rate first
            if (videoStream.r_frame_rate) {
              const parts = videoStream.r_frame_rate.split('/');
              if (parts.length === 2 && parseFloat(parts[1]) > 0) {
                originalFps = parseFloat(parts[0]) / parseFloat(parts[1]);
              }
            }
            // If r_frame_rate didn't work or seems wrong, try avg_frame_rate
            if ((!originalFps || originalFps <= 0 || originalFps > 120) && videoStream.avg_frame_rate) {
              const parts = videoStream.avg_frame_rate.split('/');
              if (parts.length === 2 && parseFloat(parts[1]) > 0) {
                const avgFps = parseFloat(parts[0]) / parseFloat(parts[1]);
                if (avgFps > 0 && avgFps <= 120) {
                  originalFps = avgFps;
                }
              }
            }
            // Fallback: use nb_frames / duration if available
            if ((!originalFps || originalFps <= 0 || originalFps > 120) && videoStream.nb_frames && meta.format.duration) {
              const calculatedFps = videoStream.nb_frames / parseFloat(meta.format.duration);
              if (calculatedFps > 0 && calculatedFps <= 120) {
                originalFps = calculatedFps;
              }
            }
          }
          // Ensure fps is reasonable
          originalFps = Math.max(1, Math.min(120, Math.round(originalFps * 100) / 100));
          console.log("Video has audio:", videoHasAudio, "Original FPS:", originalFps);
        } catch (err) {
          console.warn("Could not probe video, assuming it has audio:", err);
          videoHasAudio = true; // Assume it has audio to be safe
        }
        
        let command = ffmpeg(currentVideo);

        // Apply trim if not already applied (and insert not present)
        if (features.trim && !hasInsert && 
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

        // Handle different combinations: speed + audio, speed only, audio only, or neither
        if (hasSpeed && hasAudio) {
          // Both speed and audio replacement: Use complex filters to apply speed to replacement audio
          let audioPath = normalizePath(features.audio);
          if (fs.existsSync(audioPath)) {
            command = command.input(audioPath);
            
            // Build filters: speed for video, speed for replacement audio
            const filters = [];
            const outputFps = originalFps * speedValue;
            filters.push(`[0:v]setpts=${1/speedValue}*PTS,fps=${outputFps}[v]`);
            
            // Apply speed to replacement audio
            if (speedValue > 2) {
              const tempo1 = 2.0;
              const tempo2 = speedValue / 2.0;
              filters.push(`[1:a]atempo=${tempo1},atempo=${tempo2}[a]`);
            } else {
              filters.push(`[1:a]atempo=${speedValue}[a]`);
            }
            
            command = command
              .complexFilter(filters)
              .outputOptions([
                '-map', '[v]',
                '-map', '[a]',
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
                '-r', String(outputFps), // Explicitly set output frame rate
                '-c:a', 'aac',
                '-b:a', '192k',
                '-shortest'
              ]);
          } else {
            console.warn(`Audio file not found: ${audioPath}, using original audio with speed`);
            // Fallback: apply speed to original audio (if video has audio)
            if (videoHasAudio) {
              const outputFps = originalFps * speedValue;
              if (speedValue > 2) {
                const tempo1 = 2.0;
                const tempo2 = speedValue / 2.0;
                command = command
                  .videoFilters(`setpts=${1/speedValue}*PTS,fps=${outputFps}`)
                  .audioFilters(`atempo=${tempo1},atempo=${tempo2}`);
              } else {
                command = command
                  .videoFilters(`setpts=${1/speedValue}*PTS,fps=${outputFps}`)
                  .audioFilters(`atempo=${speedValue}`);
              }
              command = command.outputOptions([
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
                '-r', String(outputFps), // Explicitly set output frame rate
                '-c:a', 'aac',
                '-b:a', '192k'
              ]);
            } else {
              // Video has no audio, just apply speed to video
              const outputFps = originalFps * speedValue;
              command = command
                .videoFilters(`setpts=${1/speedValue}*PTS,fps=${outputFps}`)
                .outputOptions([
                  '-c:v', 'libx264',
                  '-preset', 'medium',
                  '-crf', '23',
                  '-r', String(outputFps), // Explicitly set output frame rate
                  '-an'
                ]);
            }
          }
        } else if (hasSpeed) {
          // Only speed: Use complex filters to ensure audio is properly processed (especially for concatenated audio from insert)
          const outputFps = originalFps * speedValue;
          console.log(`Applying speed: ${speedValue}x, Original FPS: ${originalFps}, Output FPS: ${outputFps}`);
          
          if (videoHasAudio) {
            const filters = [];
            // Apply speed to video: setpts changes timestamps, fps ensures correct output frame rate
            // Note: fps filter should come after setpts to maintain frame rate
            filters.push(`[0:v]setpts=${1/speedValue}*PTS,fps=${outputFps}[v]`);
            
            // Apply speed to audio - use complex filters to ensure it works with concatenated audio
            if (speedValue > 2) {
              const tempo1 = 2.0;
              const tempo2 = speedValue / 2.0;
              filters.push(`[0:a]atempo=${tempo1},atempo=${tempo2}[a]`);
            } else {
              filters.push(`[0:a]atempo=${speedValue}[a]`);
            }
            
            console.log("Speed filters:", filters);
            
            command = command
              .complexFilter(filters)
              .outputOptions([
                '-map', '[v]',
                '-map', '[a]',
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
                '-r', String(outputFps), // Explicitly set output frame rate
                '-c:a', 'aac',
                '-b:a', '192k'
              ]);
          } else {
            // Video has no audio, only apply speed to video
            console.log("Applying speed to video only (no audio)");
            command = command
              .videoFilters(`setpts=${1/speedValue}*PTS,fps=${outputFps}`)
              .outputOptions([
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
                '-r', String(outputFps), // Explicitly set output frame rate
                '-an' // No audio output
              ]);
          }
        } else if (hasAudio) {
          // Only audio replacement: No speed, just replace audio
          let audioPath = normalizePath(features.audio);
          if (fs.existsSync(audioPath)) {
            command = command
              .input(audioPath)
              .outputOptions([
                '-map', '0:v:0',
                '-map', '1:a:0',
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-shortest'
              ]);
          } else {
            console.warn(`Audio file not found: ${audioPath}, using original audio`);
            command = command.outputOptions(['-c', 'copy']);
          }
        } else {
          // No speed, no audio - just copy
          command = command.outputOptions(['-c', 'copy']);
        }

        // Execute final export
        command
          .output(filePath)
          .on("start", (cl) => console.log("FFmpeg command:", cl))
          .on("progress", (p) => p.percent && console.log(`Processing: ${Math.round(p.percent)}% done`))
          .on("end", () => {
            console.log("Video exported:", filePath);
            // Clean up temp files
            tempFiles.forEach(tempFile => {
              try {
                if (fs.existsSync(tempFile)) {
                  fs.unlinkSync(tempFile);
                }
              } catch (e) {
                console.error("Error deleting temp file:", e);
              }
            });
            resolve(filePath);
          })
          .on("error", (e) => {
            console.error("FFmpeg error:", e);
            // Clean up temp files on error
            tempFiles.forEach(tempFile => {
              try {
                if (fs.existsSync(tempFile)) {
                  fs.unlinkSync(tempFile);
                }
              } catch (err) {
                console.error("Error deleting temp file:", err);
              }
            });
            reject(e);
          })
          .run();
      } catch (error) {
        // Clean up temp files on error
        tempFiles.forEach(tempFile => {
          try {
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
          } catch (e) {
            console.error("Error deleting temp file:", e);
          }
        });
        reject(error);
      }
    };

    // Start the pipeline
    processPipeline();
  });
});

/* -------------------------
   GENERATE PREVIEW WITH ALL FEATURES
   (Lower quality, faster processing for preview)
--------------------------*/
ipcMain.handle("generate-preview", async (_, features, mainVideoPathParam = null) => {
  console.log("generate-preview handler called");
  // Use the main video path from parameter, or fall back to stored path
  let mainVideo = mainVideoPathParam || mainVideoPath || selectedVideoPath;
  if (!mainVideo) {
    throw new Error("No main video selected");
  }
  
  // Normalize main video path
  if (mainVideo.startsWith("file://")) {
    mainVideo = mainVideo.replace("file://", "");
  }
  if (process.platform === 'win32' && mainVideo.startsWith("/")) {
    mainVideo = mainVideo.replace(/^\/+/, "");
  }
  if (!path.isAbsolute(mainVideo)) {
    mainVideo = path.resolve(mainVideo);
  }
  if (!fs.existsSync(mainVideo)) {
    throw new Error(`Main video file not found: ${mainVideo}`);
  }

  // Create temp preview file
  const tempDir = path.join(require('os').tmpdir(), 'videoeditor_preview');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const previewFile = path.join(tempDir, `preview_${Date.now()}.mp4`);

  // Helper function to normalize file paths
  const normalizePath = (filePath) => {
    let normalized = filePath.replace(/^file:\/\//, "");
    if (process.platform === 'win32') {
      normalized = normalized.replace(/^\/+/, "");
    }
    if (!path.isAbsolute(normalized)) {
      normalized = path.resolve(normalized);
    }
    return normalized;
  };

  return new Promise((resolve, reject) => {
    const processPreview = async () => {
      let currentVideo = mainVideo;
      const tempFiles = [];
      
      try {
        // STEP 1: Merge videos if present
        if (features.merge && Array.isArray(features.merge) && features.merge.length > 0) {
          const tempMergeFile = path.join(tempDir, `temp_merge_${Date.now()}.mp4`);
          tempFiles.push(tempMergeFile);
          const tempConcatFile = path.join(tempDir, `temp_concat_${Date.now()}.txt`);
          tempFiles.push(tempConcatFile);
          
          const videoList = [currentVideo];
          features.merge.forEach(v => {
            const normalizedPath = normalizePath(v.path);
            if (fs.existsSync(normalizedPath)) {
              videoList.push(normalizedPath);
            }
          });
          
          const listContent = videoList.map(v => {
            const normalizedPath = v.replace(/\\/g, '/');
            return `file '${normalizedPath}'`;
          }).join('\n');
          
          fs.writeFileSync(tempConcatFile, listContent, 'utf8');
          
          await new Promise((mergeResolve, mergeReject) => {
            ffmpeg()
              .input(tempConcatFile)
              .inputOptions(['-f', 'concat', '-safe', '0'])
              .outputOptions(['-c', 'copy'])
              .output(tempMergeFile)
              .on('end', () => {
                currentVideo = tempMergeFile;
                mergeResolve();
              })
              .on('error', mergeReject)
              .run();
          });
        }

        // STEP 2: Trim if present (but not if insert will handle it)
        const hasInsert = features.insert && features.insert.video && typeof features.insert.video === 'string';
        if (features.trim && !hasInsert && 
            features.trim.start !== undefined && 
            features.trim.end !== undefined &&
            typeof features.trim.start === 'number' &&
            typeof features.trim.end === 'number' &&
            features.trim.start >= 0 &&
            features.trim.end > features.trim.start) {
          const tempTrimFile = path.join(tempDir, `temp_trim_${Date.now()}.mp4`);
          tempFiles.push(tempTrimFile);
          
          await new Promise((trimResolve, trimReject) => {
            ffmpeg(currentVideo)
              .setStartTime(features.trim.start)
              .setDuration(features.trim.end - features.trim.start)
              .output(tempTrimFile)
              .on('end', () => {
                currentVideo = tempTrimFile;
                trimResolve();
              })
              .on('error', trimReject)
              .run();
          });
        }

        // STEP 3: Insert video if present (simplified for preview - use same logic as export)
        if (hasInsert) {
          const tempInsertFile = path.join(tempDir, `temp_insert_${Date.now()}.mp4`);
          tempFiles.push(tempInsertFile);
          let insertVideoPath = normalizePath(features.insert.video);
          
          if (!fs.existsSync(insertVideoPath)) {
            throw new Error(`Insert video file not found: ${insertVideoPath}`);
          }

          const trimStart = features.trim && features.trim.start !== undefined ? Number(features.trim.start) : 0;
          const trimEnd = features.trim && features.trim.end !== undefined ? Number(features.trim.end) : null;
          const hasTrim = trimEnd !== null && trimEnd > trimStart;
          const insertPos = Math.max(0, Number(features.insert.position) || 0);
          const insertDurRequested = Math.max(0.1, Number(features.insert.seconds) || 5);

          await new Promise((insertResolve, insertReject) => {
            ffmpeg.ffprobe(currentVideo, (err, mainMeta) => {
              if (err) return insertReject(err);
              ffmpeg.ffprobe(insertVideoPath, (err2, insMeta) => {
                if (err2) return insertReject(err2);

                const mainDur = Number(mainMeta.format.duration) || 0;
                const insDur = Number(insMeta.format.duration) || insertDurRequested;
                let workingStart = 0;
                let workingEnd = mainDur;
                let relativeInsertPos = insertPos;
                
                if (hasTrim) {
                  workingStart = Math.max(0, Math.min(trimStart, mainDur));
                  workingEnd = Math.max(workingStart, Math.min(trimEnd, mainDur));
                  relativeInsertPos = Math.max(0, Math.min(insertPos, workingEnd - workingStart));
                } else {
                  relativeInsertPos = Math.min(insertPos, mainDur);
                }
                
                const safePos = relativeInsertPos;
                const safeDur = Math.min(insertDurRequested, insDur);
                const mainHasA = (mainMeta.streams || []).some(s => s.codec_type === 'audio');
                const insHasA = (insMeta.streams || []).some(s => s.codec_type === 'audio');
                const mainVideoStream = (mainMeta.streams || []).find(s => s.codec_type === 'video');
                const mainWidth = mainVideoStream?.width || 1920;
                const mainHeight = mainVideoStream?.height || 1080;
                let mainFpsNum = 30;
                if (mainVideoStream?.r_frame_rate) {
                  const parts = mainVideoStream.r_frame_rate.split('/');
                  if (parts.length === 2 && parseFloat(parts[1]) > 0) {
                    mainFpsNum = parseFloat(parts[0]) / parseFloat(parts[1]);
                  }
                }
                mainFpsNum = Math.max(1, Math.min(60, Math.round(mainFpsNum * 100) / 100));

                const filters = [];
                const absInsertPos = workingStart + safePos;
                const absWorkingEnd = workingEnd;
                
                if (safePos > 0.1) {
                  filters.push(`[0:v]trim=start=${workingStart}:end=${absInsertPos},setpts=PTS-STARTPTS,fps=${mainFpsNum},scale=${mainWidth}:${mainHeight}:force_original_aspect_ratio=decrease,pad=${mainWidth}:${mainHeight}:-1:-1:color=black[v0]`);
                  if (mainHasA) {
                    filters.push(`[0:a]atrim=start=${workingStart}:end=${absInsertPos},asetpts=PTS-STARTPTS[a0]`);
                  } else {
                    filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${safePos},asetpts=PTS-STARTPTS[a0]`);
                  }
                }

                filters.push(`[1:v]trim=start=0:end=${safeDur},setpts=PTS-STARTPTS,fps=${mainFpsNum},scale=${mainWidth}:${mainHeight}:force_original_aspect_ratio=decrease,pad=${mainWidth}:${mainHeight}:-1:-1:color=black[v1]`);
                if (insHasA) {
                  filters.push(`[1:a]atrim=start=0:end=${safeDur},asetpts=PTS-STARTPTS[a1]`);
                } else {
                  filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${safeDur},asetpts=PTS-STARTPTS[a1]`);
                }

                const remainingInWorkingRange = absWorkingEnd - absInsertPos;
                if (remainingInWorkingRange > 0.1) {
                  filters.push(`[0:v]trim=start=${absInsertPos}:end=${absWorkingEnd},setpts=PTS-STARTPTS,fps=${mainFpsNum},scale=${mainWidth}:${mainHeight}:force_original_aspect_ratio=decrease,pad=${mainWidth}:${mainHeight}:-1:-1:color=black[v2]`);
                  if (mainHasA) {
                    filters.push(`[0:a]atrim=start=${absInsertPos}:end=${absWorkingEnd},asetpts=PTS-STARTPTS[a2]`);
                  } else {
                    filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${remainingInWorkingRange},asetpts=PTS-STARTPTS[a2]`);
                  }
                  
                  if (safePos > 0.1) {
                    filters.push(`[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[outv][outa]`);
                  } else {
                    filters.push(`[v1][a1][v2][a2]concat=n=2:v=1:a=1[outv][outa]`);
                  }
                } else {
                  if (safePos > 0.1) {
                    filters.push(`[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]`);
                  } else {
                    filters.push(`[v1][a1]concat=n=1:v=1:a=1[outv][outa]`);
                  }
                }

                ffmpeg()
                  .input(currentVideo)
                  .input(insertVideoPath)
                  .complexFilter(filters)
                  .outputOptions([
                    '-map', '[outv]',
                    '-map', '[outa]',
                    '-c:v', 'libx264',
                    '-preset', 'ultrafast', // Fast preset for preview
                    '-crf', '28', // Lower quality for faster encoding
                    '-r', String(mainFpsNum),
                    '-c:a', 'aac',
                    '-b:a', '128k', // Lower bitrate for preview
                    '-shortest'
                  ])
                  .output(tempInsertFile)
                  .on('end', () => {
                    currentVideo = tempInsertFile;
                    insertResolve();
                  })
                  .on('error', insertReject)
                  .run();
              });
            });
          });
        }

        // STEP 4: Apply speed and audio to final preview
        const hasSpeed = features.speed && features.speed !== 1.0;
        const hasAudio = features.audio && typeof features.audio === 'string';
        const speedValue = hasSpeed ? Number(features.speed) : 1.0;
        
        let videoHasAudio = false;
        let originalFps = 30;
        try {
          const meta = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(currentVideo, (err, metadata) => {
              if (err) reject(err);
              else resolve(metadata);
            });
          });
          videoHasAudio = (meta.streams || []).some(s => s.codec_type === 'audio');
          const videoStream = (meta.streams || []).find(s => s.codec_type === 'video');
          if (videoStream) {
            if (videoStream.r_frame_rate) {
              const parts = videoStream.r_frame_rate.split('/');
              if (parts.length === 2 && parseFloat(parts[1]) > 0) {
                originalFps = parseFloat(parts[0]) / parseFloat(parts[1]);
              }
            }
            if ((!originalFps || originalFps <= 0 || originalFps > 120) && videoStream.avg_frame_rate) {
              const parts = videoStream.avg_frame_rate.split('/');
              if (parts.length === 2 && parseFloat(parts[1]) > 0) {
                const avgFps = parseFloat(parts[0]) / parseFloat(parts[1]);
                if (avgFps > 0 && avgFps <= 120) {
                  originalFps = avgFps;
                }
              }
            }
          }
          originalFps = Math.max(1, Math.min(120, Math.round(originalFps * 100) / 100));
        } catch (err) {
          videoHasAudio = true;
        }
        
        let command = ffmpeg(currentVideo);
        const outputFps = originalFps * speedValue;

        if (hasSpeed && hasAudio) {
          let audioPath = normalizePath(features.audio);
          if (fs.existsSync(audioPath)) {
            command = command.input(audioPath);
            const filters = [];
            filters.push(`[0:v]setpts=${1/speedValue}*PTS,fps=${outputFps}[v]`);
            if (speedValue > 2) {
              const tempo1 = 2.0;
              const tempo2 = speedValue / 2.0;
              filters.push(`[1:a]atempo=${tempo1},atempo=${tempo2}[a]`);
            } else {
              filters.push(`[1:a]atempo=${speedValue}[a]`);
            }
            command = command
              .complexFilter(filters)
              .outputOptions([
                '-map', '[v]',
                '-map', '[a]',
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-crf', '28',
                '-r', String(outputFps),
                '-c:a', 'aac',
                '-b:a', '128k',
                '-shortest'
              ]);
          }
        } else if (hasSpeed) {
          if (videoHasAudio) {
            const filters = [];
            filters.push(`[0:v]setpts=${1/speedValue}*PTS,fps=${outputFps}[v]`);
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
                '-preset', 'ultrafast',
                '-crf', '28',
                '-r', String(outputFps),
                '-c:a', 'aac',
                '-b:a', '128k'
              ]);
          } else {
            command = command
              .videoFilters(`setpts=${1/speedValue}*PTS,fps=${outputFps}`)
              .outputOptions([
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-crf', '28',
                '-r', String(outputFps),
                '-an'
              ]);
          }
        } else if (hasAudio) {
          let audioPath = normalizePath(features.audio);
          if (fs.existsSync(audioPath)) {
            command = command
              .input(audioPath)
              .outputOptions([
                '-map', '0:v:0',
                '-map', '1:a:0',
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-shortest'
              ]);
          }
        } else {
          command = command.outputOptions(['-c', 'copy']);
        }

        command
          .output(previewFile)
          .on('end', () => {
            // Clean up temp files
            tempFiles.forEach(tempFile => {
              try {
                if (fs.existsSync(tempFile)) {
                  fs.unlinkSync(tempFile);
                }
              } catch (e) {
                console.error("Error deleting temp file:", e);
              }
            });
            resolve(previewFile);
          })
          .on('error', (e) => {
            tempFiles.forEach(tempFile => {
              try {
                if (fs.existsSync(tempFile)) {
                  fs.unlinkSync(tempFile);
                }
              } catch (err) {
                console.error("Error deleting temp file:", err);
              }
            });
            reject(e);
          })
          .run();
      } catch (error) {
        tempFiles.forEach(tempFile => {
          try {
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
          } catch (e) {
            console.error("Error deleting temp file:", e);
          }
        });
        reject(error);
      }
    };

    processPreview();
  });
});

app.whenReady().then(createWindow);
