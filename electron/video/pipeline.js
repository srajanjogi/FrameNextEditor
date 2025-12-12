const path = require("path");
const { mergeVideos } = require("./merge");
const { trimVideo } = require("./trim");
const { insertVideo } = require("./insert");
const { applySpeed } = require("./speed");
const { replaceAudio, applySpeedWithAudio } = require("./audio");
const { normalizePath } = require("../utils/pathUtils");
const { cleanupTempFiles } = require("../utils/fileUtils");

/**
 * Processes video through the editing pipeline
 * @param {string} mainVideo - Main video path
 * @param {Object} features - Features object with trim, merge, insert, speed, audio
 * @param {string} outputPath - Final output path
 * @param {Object} options - Processing options (for preview vs export)
 * @returns {Promise<string>} Path to final output
 */
async function processVideoPipeline(mainVideo, features, outputPath, options = {}) {
  const isPreview = options.isPreview || false;
  const encodingOptions = {
    preset: isPreview ? 'ultrafast' : 'medium',
    crf: isPreview ? '28' : '23',
    audioBitrate: isPreview ? '128k' : '192k'
  };
  
  let currentVideo = mainVideo;
  const tempFiles = [];
  const tempDir = path.dirname(outputPath);
  
  try {
    // STEP 1: Trim and/or insert video (structural changes to main video)
    const hasInsert = features.insert && features.insert.video && typeof features.insert.video === 'string';
    
    // STEP 1a: Trim if present (but not if insert will handle it)
    if (features.trim && !hasInsert && 
        features.trim.start !== undefined && 
        features.trim.end !== undefined &&
        typeof features.trim.start === 'number' &&
        typeof features.trim.end === 'number' &&
        features.trim.start >= 0 &&
        features.trim.end > features.trim.start) {
      console.log("Step 1a: Trimming main video...");
      const tempTrimFile = path.join(tempDir, `temp_trim_${Date.now()}.mp4`);
      tempFiles.push(tempTrimFile);
      
      await trimVideo(currentVideo, features.trim.start, features.trim.end, tempTrimFile);
      currentVideo = tempTrimFile;
    }
    
    // STEP 1b: Insert video if present
    if (hasInsert) {
      console.log("Step 1b: Inserting video into main video...");
      const tempInsertFile = path.join(tempDir, `temp_insert_${Date.now()}.mp4`);
      tempFiles.push(tempInsertFile);
      
      const trimInfo = features.trim ? {
        start: features.trim.start,
        end: features.trim.end
      } : null;
      
      await insertVideo(
        currentVideo,
        features.insert.video,
        features.insert.position || 0,
        features.insert.seconds || 5,
        trimInfo,
        tempInsertFile
      );
      currentVideo = tempInsertFile;
    }
    
    // STEP 2: Merge trimmed/inserted main video with merge videos (if present)
    // This happens BEFORE applying effects so effects can be applied to the entire merged result
    const hasMerge = features.merge && Array.isArray(features.merge) && features.merge.length > 0;
    const hasSpeed = features.speed && features.speed !== 1.0;
    const hasAudio = features.audio && typeof features.audio === 'string';
    const speedValue = hasSpeed ? Number(features.speed) : 1.0;
    
    if (hasMerge) {
      console.log("Step 2: Merging trimmed main video with additional videos...");
      // Merge to a temp file first, then apply effects to the merged result
      const tempMergeFile = path.join(tempDir, `temp_merge_${Date.now()}.mp4`);
      tempFiles.push(tempMergeFile);
      
      await mergeVideos(currentVideo, features.merge, tempMergeFile);
      currentVideo = tempMergeFile;
    }
    
    // STEP 3: Apply effects (speed, audio) to the entire video (trimmed + merged)
    // This ensures effects are applied to both the trimmed base video AND merged videos
    const effectsOutputPath = outputPath;
    
    if (hasSpeed && hasAudio) {
      // Both speed and audio
      console.log("Step 3: Applying speed and audio replacement to entire video (trimmed + merged)...");
      await applySpeedWithAudio(
        currentVideo,
        features.audio,
        speedValue,
        effectsOutputPath,
        encodingOptions
      );
    } else if (hasSpeed) {
      // Only speed
      console.log("Step 3: Applying speed to entire video (trimmed + merged)...");
      await applySpeed(currentVideo, speedValue, effectsOutputPath, encodingOptions);
    } else if (hasAudio) {
      // Only audio replacement
      console.log("Step 3: Replacing audio in entire video (trimmed + merged)...");
      await replaceAudio(currentVideo, features.audio, effectsOutputPath, encodingOptions);
    } else {
      // No speed, no audio - just copy
      console.log("Step 3: Copying video (no speed/audio)...");
      const ffmpeg = require("fluent-ffmpeg");
      await new Promise((resolve, reject) => {
        ffmpeg(currentVideo)
          .outputOptions(['-c', 'copy'])
          .output(effectsOutputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
    }
    
    return outputPath;
  } catch (error) {
    cleanupTempFiles(tempFiles);
    throw error;
  } finally {
    cleanupTempFiles(tempFiles);
  }
}

module.exports = { processVideoPipeline };

