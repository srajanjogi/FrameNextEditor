const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const { normalizePath } = require("../utils/pathUtils");
const { getVideoMetadata, hasAudioStream, getVideoProperties } = require("../utils/videoUtils");

/**
 * Merges multiple videos into one
 * Normalizes all videos to match main video properties (resolution, fps, codec)
 * @param {string} mainVideo - Main video path (already trimmed if trim was applied)
 * @param {Array} mergeVideos - Array of video objects with path property
 * @param {string} outputPath - Output file path
 * @returns {Promise<string>} Path to merged video
 */
async function mergeVideos(mainVideo, mergeVideos, outputPath) {
  const tempDir = path.dirname(outputPath);
  const tempFiles = [];
  
  try {
    // Get main video properties to normalize all videos to match
    const mainMeta = await getVideoMetadata(mainVideo);
    const props = getVideoProperties(mainMeta);
    const mainDuration = Number(mainMeta.format.duration) || 0;
    
    console.log(`Merging videos - Target properties: ${props.width}x${props.height} @ ${props.fps}fps`);
    console.log(`Main video duration: ${mainDuration}s`);
    
    // Step 1: Normalize main video to common format
    const normalizedMain = path.join(tempDir, `normalized_main_${Date.now()}.mp4`);
    tempFiles.push(normalizedMain);
    
    await normalizeVideo(mainVideo, normalizedMain, props, mainDuration);
    console.log("Main video normalized");
    
    // Step 2: Normalize all merge videos to common format
    const normalizedMergeVideos = [];
    for (let i = 0; i < mergeVideos.length; i++) {
      const v = mergeVideos[i];
      const normalizedPath = normalizePath(v.path);
      if (fs.existsSync(normalizedPath)) {
        const mergeMeta = await getVideoMetadata(normalizedPath);
        const mergeDuration = Number(mergeMeta.format.duration) || 0;
        const normalizedMerge = path.join(tempDir, `normalized_merge_${i}_${Date.now()}.mp4`);
        tempFiles.push(normalizedMerge);
        
        await normalizeVideo(normalizedPath, normalizedMerge, props, mergeDuration);
        normalizedMergeVideos.push(normalizedMerge);
        console.log(`Merge video ${i + 1} normalized: ${mergeDuration}s`);
      }
    }
    
    // Step 3: Use concat demuxer to merge all normalized videos
    const allVideos = [normalizedMain, ...normalizedMergeVideos];
    const concatFile = path.join(tempDir, `concat_${Date.now()}.txt`);
    tempFiles.push(concatFile);
    
    // Create concat file
    const concatContent = allVideos.map(videoPath => {
      // Escape single quotes and use forward slashes for paths
      const escapedPath = videoPath.replace(/\\/g, '/').replace(/'/g, "\\'");
      return `file '${escapedPath}'`;
    }).join('\n');
    
    fs.writeFileSync(concatFile, concatContent, 'utf8');
    console.log(`Created concat file with ${allVideos.length} videos`);
    
    // Use concat demuxer (requires same codec/properties, which we've normalized)
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          '-c', 'copy', // Use copy since all videos are now same format
          '-avoid_negative_ts', 'make_zero'
        ])
        .output(outputPath)
        .on('end', () => {
          console.log("Merge completed:", outputPath);
          console.log(`Merged ${allVideos.length} videos successfully`);
          resolve();
        })
        .on('error', (err) => {
          console.error("Merge error:", err);
          console.error("Error details:", err.message);
          reject(err);
        })
        .run();
    });
    
    return outputPath;
  } catch (error) {
    console.error("Error in mergeVideos:", error);
    throw error;
  } finally {
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
  }
}

/**
 * Normalizes a video to match target properties (resolution, fps, codec)
 * @param {string} inputPath - Input video path
 * @param {string} outputPath - Output video path
 * @param {Object} targetProps - Target properties {width, height, fps}
 * @param {number} duration - Video duration in seconds
 */
async function normalizeVideo(inputPath, outputPath, targetProps, duration) {
  const meta = await getVideoMetadata(inputPath);
  const hasAudio = hasAudioStream(meta);
  
  const filters = [];
  
  // Video filter: normalize to target properties
  filters.push(`[0:v]scale=${targetProps.width}:${targetProps.height}:force_original_aspect_ratio=decrease,pad=${targetProps.width}:${targetProps.height}:-1:-1:color=black,fps=${targetProps.fps}[v]`);
  
  // Audio filter: normalize audio or generate silent audio
  if (hasAudio) {
    filters.push(`[0:a]aformat=sample_rates=44100:channel_layouts=stereo[a]`);
  } else {
    filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=start=0:end=${duration}[a]`);
  }
  
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .complexFilter(filters)
      .outputOptions([
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-r', String(targetProps.fps),
        '-c:a', 'aac',
        '-b:a', '192k',
        '-pix_fmt', 'yuv420p',
        '-t', String(duration) // Limit to exact duration
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => {
        console.error(`Error normalizing video ${inputPath}:`, err);
        reject(err);
      })
      .run();
  });
}

module.exports = { mergeVideos };


