import { useState, useEffect, useRef } from "react";
import "./App.css";

const PX_PER_SEC = 50;

const EDITING_OPTIONS = [
  { id: "trim", icon: "✂️", label: "Trim Video", description: "Cut and trim your video" },
  { id: "merge", icon: "🔗", label: "Merge Videos", description: "Combine multiple videos" },
  { id: "insert", icon: "➕", label: "Insert Video", description: "Insert video in between" },
  { id: "speed", icon: "⚡", label: "Speed Control", description: "Change playback speed" },
  { id: "audio", icon: "🎵", label: "Add Audio", description: "Add audio track to video" }
];

export default function App() {
  const [videoSrc, setVideoSrc] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [clip, setClip] = useState({ start: 0, duration: 5 });
  const [drag, setDrag] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewVideoSrc, setPreviewVideoSrc] = useState(null);
  const timelineRef = useRef(null);
  const [activeOption, setActiveOption] = useState("trim");
  
  // Merge videos state
  const [mergeVideos, setMergeVideos] = useState([]);
  
  // Insert video state
  const [insertPosition, setInsertPosition] = useState(0);
  const [insertVideoSrc, setInsertVideoSrc] = useState(null);
  const [insertVideoDuration, setInsertVideoDuration] = useState(0);
  const [insertSeconds, setInsertSeconds] = useState(5);
  const [insertMode, setInsertMode] = useState("sequential"); // "sequential" or "overlapping"
  
  // Speed control state
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  
  // Audio state
  const [audioSrc, setAudioSrc] = useState(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioPlacement, setAudioPlacement] = useState("audio_priority"); // "audio_priority", "video_priority", "custom"
  const [audioStartTime, setAudioStartTime] = useState(0);
  const [audioEndTime, setAudioEndTime] = useState(0);
  const [audioTrimStart, setAudioTrimStart] = useState(0);
  const [audioTrimEnd, setAudioTrimEnd] = useState(0);

  async function pickVideo() {
    const res = await window.api.pickVideo();
    if (!res) return;
    setVideoSrc("file://" + res.videoPath);
    setShowPreview(true);
  }

  function onLoadedMetadata(e) {
    const dur = e.target.duration;
    if (dur && dur > 0) {
      setVideoDuration(dur);
      setClip({ start: 0, duration: Math.min(dur, 5) });
    }
  }

  useEffect(() => {
    if (videoDuration > 0) {
      setClip(prev => {
        const maxStart = Math.max(0, videoDuration - 0.2);
        const clampedStart = Math.min(prev.start, maxStart);
        const maxDuration = videoDuration - clampedStart;
        const clampedDuration = Math.min(prev.duration, maxDuration);
        return {
          start: clampedStart,
          duration: Math.max(0.2, clampedDuration)
        };
      });
    }
  }, [videoDuration]);

  useEffect(() => {
    if (videoSrc) {
      setShowPreview(true);
    }
  }, [videoSrc]);

  function handleMove(e) {
    if (!drag || videoDuration === 0) return;
    const timeline = timelineRef.current?.getBoundingClientRect();
    if (!timeline || timeline.width === 0) return;

    const proportion = (e.clientX - timeline.left) / timeline.width;
    const rawTime = proportion * videoDuration;
    const clampedTime = Math.max(0, Math.min(rawTime, videoDuration));

    setClip(prev => {
      if (drag === "left") {
        const newStart = Math.min(clampedTime, prev.start + prev.duration - 0.2);
        const finalStart = Math.max(0, newStart);
        return {
          start: finalStart,
          duration: prev.start + prev.duration - finalStart
        };
      }
      if (drag === "right") {
        const newEnd = Math.max(prev.start + 0.2, clampedTime);
        const maxEnd = Math.min(newEnd, videoDuration);
        return {
          ...prev,
          duration: maxEnd - prev.start
        };
      }
      return prev;
    });
  }

  async function pickMergeVideo() {
    const res = await window.api.pickVideo();
    if (!res) return;
    setMergeVideos(prev => [...prev, { path: res.videoPath, name: res.videoPath.split(/[/\\]/).pop() }]);
  }

  async function pickInsertVideo() {
    const res = await window.api.pickVideo(true); // Pass true to indicate this is an insert video
    if (!res) return;
    setInsertVideoSrc("file://" + res.videoPath);
  }

  async function pickAudio() {
    try {
      const res = await window.api.pickAudio();
      if (!res || !res.audioPath) {
        console.log("No audio file selected");
        return;
      }
      // Use same format as video paths
      setAudioSrc("file://" + res.audioPath);
      console.log("Audio selected:", res.audioPath);
    } catch (error) {
      console.error("Error picking audio:", error);
      alert(`Error selecting audio file: ${error.message}`);
    }
  }

  function onAudioLoadedMetadata(e) {
    const dur = e.target.duration;
    if (dur && dur > 0) {
      setAudioDuration(dur);
      setAudioTrimEnd(dur);
      setAudioEndTime(Math.min(dur, clip.duration || dur));
    }
  }

  function onInsertVideoMetadata(e) {
    const dur = e.target.duration;
    if (dur && dur > 0) {
      setInsertVideoDuration(dur);
      setInsertSeconds(Math.min(dur, 5));
    }
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(2);
    if (mins > 0) {
      return `${mins}:${String(secs).padStart(5, '0')}`;
    }
    return `${secs}s`;
  }

  function handleEditOption(optionId) {
    setActiveOption(optionId);
  }

  function getFeatures() {
    return {
      trim: { start: clip.start, end: clip.start + clip.duration },
      merge: mergeVideos.length > 0 ? mergeVideos : null,
      insert: insertVideoSrc ? { 
        position: insertPosition, 
        seconds: insertSeconds, 
        video: insertVideoSrc,
        mode: insertMode
      } : null,
      speed: playbackSpeed !== 1.0 ? playbackSpeed : null,
      audio: audioSrc ? {
        path: audioSrc,
        placement: audioPlacement,
        priority: audioPlacement === "audio_priority" ? "audio" : (audioPlacement === "video_priority" ? "video" : null),
        startTime: audioPlacement === "custom" ? audioStartTime : 0,
        endTime: audioPlacement === "custom" ? audioEndTime : (audioPlacement === "audio_priority" ? Math.max(audioDuration, clip.duration) : clip.duration),
        trimStart: 0, // No trimming - use full audio
        trimEnd: audioDuration, // Use full audio duration
        videoDuration: clip.duration,
        audioDuration: audioDuration
      } : null
    };
  }

  function calculateFinalDuration() {
    if (!videoDuration) return 0;
    
    // Start with trimmed base clip duration
    let finalDuration = clip.duration;
    
    // Add merge videos duration (sequential merge)
    // Note: This is an approximation - actual merge duration depends on backend processing
    if (mergeVideos.length > 0) {
      // For now, we'll show base duration + note that merge clips will be added
      // Actual calculation would require metadata from merge videos
      finalDuration = clip.duration; // Base trimmed duration
      // Merge videos will extend this, but we can't calculate without their durations
    }
    
    // For insert: depends on mode (sequential extends, overlapping doesn't)
    if (insertVideoSrc) {
      if (insertMode === "sequential") {
        finalDuration = clip.duration + insertSeconds; // Sequential insert extends duration
      } else {
        finalDuration = clip.duration; // Overlapping doesn't extend
      }
    }
    
    return finalDuration;
  }

  async function generatePreview() {
    if (!videoSrc) {
      alert("Please select a video first");
      return;
    }

    setIsGeneratingPreview(true);
    try {
      const features = getFeatures();

      // Validation: Check overlapping insert doesn't exceed base clip length
      if (features.insert && features.insert.mode === "overlapping") {
        const insertEnd = features.insert.position + features.insert.seconds;
        if (insertEnd > clip.duration) {
          alert(`⚠️ Warning: Overlapping insert extends beyond Base Clip length.\n\nInsert ends at ${formatTime(insertEnd)} but Base Clip is only ${formatTime(clip.duration)}.\n\nThe insert will be trimmed to fit within the Base Clip.`);
        }
      }

      // Check if at least one feature is active
      const hasFeatures = features.trim || features.merge || features.insert || 
                         (features.speed && features.speed !== 1.0) || features.audio;
      
      if (!hasFeatures) {
        alert("Please configure at least one editing feature before generating preview.");
        setIsGeneratingPreview(false);
        return;
      }

      // Extract main video path from videoSrc (remove "file://" prefix)
      let mainVideoPath = videoSrc;
      if (mainVideoPath && mainVideoPath.startsWith("file://")) {
        mainVideoPath = mainVideoPath.replace("file://", "");
      }
      
      // Generate preview with all features
      const previewPath = await window.api.generatePreview(features, mainVideoPath);
      if (previewPath) {
        setPreviewVideoSrc("file://" + previewPath);
        setShowPreview(true);
      }
    } catch (error) {
      console.error("Preview error:", error);
      alert(`❌ Error generating preview: ${error.message}\n\nPlease check the console for details.`);
    } finally {
      setIsGeneratingPreview(false);
    }
  }

  function clearPreview() {
    setPreviewVideoSrc(null);
    setShowPreview(false);
  }

  async function exportAllFeatures() {
    if (!videoSrc) {
      alert("Please select a video first");
      return;
    }

    setIsExporting(true);
    try {
      const features = getFeatures();

      // Validation: Check overlapping insert doesn't exceed base clip length
      if (features.insert && features.insert.mode === "overlapping") {
        const insertEnd = features.insert.position + features.insert.seconds;
        if (insertEnd > clip.duration) {
          const proceed = confirm(`⚠️ Warning: Overlapping insert extends beyond Base Clip length.\n\nInsert ends at ${formatTime(insertEnd)} but Base Clip is only ${formatTime(clip.duration)}.\n\nThe insert will be trimmed to fit within the Base Clip.\n\nDo you want to continue?`);
          if (!proceed) {
            setIsExporting(false);
            return;
          }
        }
      }

      // Check if at least one feature is active
      const hasFeatures = features.trim || features.merge || features.insert || 
                         (features.speed && features.speed !== 1.0) || features.audio;
      
      if (!hasFeatures) {
        alert("Please configure at least one editing feature before exporting.");
        setIsExporting(false);
        return;
      }

      // Extract main video path from videoSrc (remove "file://" prefix)
      let mainVideoPath = videoSrc;
      if (mainVideoPath && mainVideoPath.startsWith("file://")) {
        mainVideoPath = mainVideoPath.replace("file://", "");
      }
      
      // Export with all features, passing the main video path
      const saved = await window.api.exportVideo(features, mainVideoPath);
      if (saved) {
        alert(`✅ Video exported successfully with all features!\n\nSaved at:\n${saved}`);
      } else {
        alert("Export cancelled by user");
      }
    } catch (error) {
      console.error("Export error:", error);
      alert(`❌ Error exporting video: ${error.message}\n\nPlease check the console for details.`);
    } finally {
      setIsExporting(false);
    }
  }

  const canOpenPreview = Boolean(videoSrc);

  return (
    <div className="app" onMouseMove={handleMove} onMouseUp={() => setDrag(null)}>
      <div className="container">
        <div className="sidebar">
          <div className="file-picker" onClick={pickVideo}>
            <div style={{ marginBottom: '8px', fontSize: '12px', fontWeight: 'bold', color: '#2196F3' }}>
              📹 Base Clip
            </div>
            {!videoSrc ? (
              <div className="file-picker-empty">
                <div className="upload-icon">📁</div>
                <p>Click to select video</p>
                <span>MP4, MOV, MKV</span>
              </div>
            ) : (
              <div className="file-picker-loaded">
                <video src={videoSrc} controls />
                <button className="change-video-btn" onClick={(e) => { e.stopPropagation(); pickVideo(); }}>
                  Change Video
                </button>
              </div>
            )}
          </div>

          <div className="editing-options">
            <h3 className="editing-options-title">Editing Options</h3>
            {EDITING_OPTIONS.map((option) => (
              <div
                key={option.id}
                className={`editing-option ${activeOption === option.id ? "active" : ""}`}
                onClick={() => handleEditOption(option.id)}
              >
                <div className="editing-option-icon">{option.icon}</div>
                <div className="editing-option-content">
                  <div className="editing-option-label">{option.label}</div>
                  <div className="editing-option-description">{option.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="main-content">
          <div className={`preview-card ${!canOpenPreview ? "preview-card-disabled" : ""}`}>
            {!canOpenPreview ? (
              <div className="preview-placeholder">
                <div className="preview-icon">🎥</div>
                <h2>No video selected</h2>
                <p>Select a video from the left panel to get started</p>
              </div>
            ) : (
              <div className="all-features-container">
                {/* Preview Section */}
                <div className="preview-section-compact">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h2>Preview</h2>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      {previewVideoSrc ? (
                        <button 
                          className="feature-btn-small" 
                          onClick={clearPreview}
                          style={{ fontSize: '12px', padding: '5px 10px' }}
                        >
                          Show Original
                        </button>
                      ) : (
                        <button 
                          className="feature-btn-small" 
                          onClick={generatePreview}
                          disabled={isGeneratingPreview}
                          style={{ fontSize: '12px', padding: '5px 10px' }}
                        >
                          {isGeneratingPreview ? "⏳ Generating..." : "🎬 Generate Preview"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="video-wrapper-compact" style={{ position: 'relative' }}>
                    <video
                      src={previewVideoSrc || videoSrc}
                      controls
                      onLoadedMetadata={previewVideoSrc ? undefined : onLoadedMetadata}
                      className="preview-video-compact"
                    />
                    {previewVideoSrc && (
                      <div style={{ 
                        position: 'absolute', 
                        top: '10px', 
                        left: '10px', 
                        background: 'rgba(0,0,0,0.7)', 
                        color: 'white', 
                        padding: '5px 10px', 
                        borderRadius: '4px',
                        fontSize: '12px',
                        zIndex: 10,
                        pointerEvents: 'none'
                      }}>
                        Preview with all effects
                      </div>
                    )}
                  </div>
                </div>

                {/* Timeline Section */}
                <div className="timeline-section-compact">
                  <div className="timeline-header-compact">
                    <h3>Timeline</h3>
                    <div className="time-info-compact">
                      <span>Start: {formatTime(clip.start)}</span>
                      <span>End: {formatTime(clip.start + clip.duration)}</span>
                    </div>
                  </div>
                  <div style={{ 
                    marginTop: '8px', 
                    padding: '8px', 
                    backgroundColor: '#f0f0f0', 
                    borderRadius: '4px',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    color: '#2196F3'
                  }}>
                    📊 Final Video Duration: {formatTime(calculateFinalDuration())}
                  </div>
                  <div 
                    id="timeline" 
                    ref={timelineRef}
                    className="timeline-compact"
                    onClick={(e) => {
                      if (activeOption === "insert" && videoDuration > 0) {
                        const timeline = timelineRef.current?.getBoundingClientRect();
                        if (timeline) {
                          const proportion = (e.clientX - timeline.left) / timeline.width;
                          const newPosition = Math.max(0, Math.min(proportion * videoDuration, videoDuration));
                          setInsertPosition(newPosition);
                        }
                      }
                    }}
                    style={{ cursor: activeOption === "insert" ? "pointer" : "default" }}
                  >
                    <div
                      className="clip-selection"
                      style={{
                        left: videoDuration ? `${(clip.start / videoDuration) * 100}%` : "0%",
                        width: videoDuration ? `${(clip.duration / videoDuration) * 100}%` : "0%"
                      }}
                    >
                      <div className="clip-handle clip-handle-left"
                        onMouseDown={(e) => { e.stopPropagation(); setDrag("left"); }}
                      />
                      <div className="clip-content">CLIP</div>
                      <div className="clip-handle clip-handle-right"
                        onMouseDown={(e) => { e.stopPropagation(); setDrag("right"); }}
                      />
                    </div>
                    {activeOption === "insert" && videoDuration > 0 && (
                      <div
                        className="insert-marker"
                        style={{
                          left: `${(insertPosition / videoDuration) * 100}%`
                        }}
                      >
                        <div className="insert-marker-line"></div>
                      </div>
                    )}
                  </div>
                </div>

                {/* All Features in Compact Tabs */}
                <div className="features-tabs">
                  {/* Trim Feature */}
                  <div className={`feature-tab ${activeOption === "trim" ? "active" : ""}`}>
                    <div className="feature-header">
                      <span className="feature-icon">✂️</span>
                      <span className="feature-title">Trim</span>
                    </div>
                    {activeOption === "trim" && (
                      <div className="feature-content">
                        <div className="feature-info">Selected: {formatTime(clip.start)} - {formatTime(clip.start + clip.duration)}</div>
                      </div>
                    )}
                  </div>

                  {/* Merge Feature */}
                  <div className={`feature-tab ${activeOption === "merge" ? "active" : ""}`}>
                    <div className="feature-header">
                      <span className="feature-icon">🔗</span>
                      <span className="feature-title">Merge</span>
                      {mergeVideos.length > 0 && <span className="feature-badge">{mergeVideos.length}</span>}
                    </div>
                    {activeOption === "merge" && (
                      <div className="feature-content">
                        <div style={{ marginBottom: '10px', fontSize: '11px', color: '#666', fontWeight: 'bold' }}>
                          🎬 Insert Clips (will be merged sequentially)
                        </div>
                        <button className="feature-btn-small" onClick={pickMergeVideo}>
                          + Add Insert Clip
                        </button>
                        {mergeVideos.length > 0 && (
                          <div className="merge-list-compact">
                            {mergeVideos.map((v, i) => (
                              <div key={i} className="merge-item-compact">
                                {v.name}
                                <button className="remove-btn-small" onClick={() => setMergeVideos(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Insert Feature */}
                  <div className={`feature-tab ${activeOption === "insert" ? "active" : ""}`}>
                    <div className="feature-header">
                      <span className="feature-icon">➕</span>
                      <span className="feature-title">Insert</span>
                      {insertVideoSrc && <span className="feature-badge">✓</span>}
                    </div>
                    {activeOption === "insert" && (
                      <div className="feature-content">
                        <div style={{ marginBottom: '10px', fontSize: '11px', color: '#666', fontWeight: 'bold' }}>
                          🎬 Insert Clip
                        </div>
                        <div style={{ marginBottom: '10px' }}>
                          <label style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '5px', display: 'block' }}>
                            Insert Mode:
                          </label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <button
                              className={`preset-btn-small ${insertMode === "sequential" ? 'active' : ''}`}
                              onClick={() => setInsertMode("sequential")}
                              style={{ width: '100%', textAlign: 'left', padding: '5px 10px' }}
                            >
                              ➡️ Sequential Insert (extends timeline)
                            </button>
                            <button
                              className={`preset-btn-small ${insertMode === "overlapping" ? 'active' : ''}`}
                              onClick={() => setInsertMode("overlapping")}
                              style={{ width: '100%', textAlign: 'left', padding: '5px 10px' }}
                            >
                              🔀 Overlapping Insert (overlays base clip)
                            </button>
                          </div>
                          <div style={{ fontSize: '10px', color: '#666', marginTop: '5px', fontStyle: 'italic' }}>
                            {insertMode === "sequential" 
                              ? "Insert clip will push base timeline forward. Final duration = Base + Insert"
                              : "Insert clip will overlay base clip. Final duration = Base Clip duration"}
                          </div>
                        </div>
                        <div className="feature-row">
                          <label>Position:</label>
                          <input
                            type="number"
                            min="0"
                            max={videoDuration}
                            step="0.1"
                            value={insertPosition}
                            onChange={(e) => setInsertPosition(Math.max(0, Math.min(parseFloat(e.target.value) || 0, videoDuration)))}
                            className="feature-input-small"
                          />
                          <span className="feature-unit">s</span>
                        </div>
                        <div className="feature-row">
                          <label>Duration:</label>
                          <input
                            type="number"
                            min="0.1"
                            max={insertVideoDuration || 1000}
                            step="0.1"
                            value={insertSeconds}
                            onChange={(e) => {
                              const newDuration = Math.max(0.1, Math.min(parseFloat(e.target.value) || 0.1, insertVideoDuration || 1000));
                              setInsertSeconds(newDuration);
                              // Validate overlapping mode
                              if (insertMode === "overlapping" && insertPosition + newDuration > clip.duration) {
                                // Will show warning in validation
                              }
                            }}
                            className="feature-input-small"
                          />
                          <span className="feature-unit">s</span>
                        </div>
                        {insertMode === "overlapping" && insertPosition + insertSeconds > clip.duration && (
                          <div style={{ 
                            marginTop: '5px', 
                            padding: '5px', 
                            backgroundColor: '#ffebee', 
                            color: '#c62828', 
                            borderRadius: '4px',
                            fontSize: '11px'
                          }}>
                            ⚠️ Warning: Insert extends beyond Base Clip length
                          </div>
                        )}
                        {!insertVideoSrc ? (
                          <button className="feature-btn-small" onClick={pickInsertVideo}>
                            + Select Insert Clip
                          </button>
                        ) : (
                          <div className="feature-video-selected">
                            Insert Clip selected
                            <button className="change-btn-small" onClick={pickInsertVideo}>Change</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Speed Feature */}
                  <div className={`feature-tab ${activeOption === "speed" ? "active" : ""}`}>
                    <div className="feature-header">
                      <span className="feature-icon">⚡</span>
                      <span className="feature-title">Speed</span>
                      {playbackSpeed !== 1.0 && <span className="feature-badge">{playbackSpeed}x</span>}
                    </div>
                    {activeOption === "speed" && (
                      <div className="feature-content">
                        <div className="speed-display-compact">{playbackSpeed}x</div>
                        <input
                          type="range"
                          min="0.25"
                          max="4"
                          step="0.25"
                          value={playbackSpeed}
                          onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                          className="speed-slider-compact"
                        />
                        <div className="speed-presets-compact">
                          <button className={`preset-btn-small ${playbackSpeed === 0.5 ? 'active' : ''}`} onClick={() => setPlaybackSpeed(0.5)}>0.5x</button>
                          <button className={`preset-btn-small ${playbackSpeed === 1.0 ? 'active' : ''}`} onClick={() => setPlaybackSpeed(1.0)}>1x</button>
                          <button className={`preset-btn-small ${playbackSpeed === 1.5 ? 'active' : ''}`} onClick={() => setPlaybackSpeed(1.5)}>1.5x</button>
                          <button className={`preset-btn-small ${playbackSpeed === 2.0 ? 'active' : ''}`} onClick={() => setPlaybackSpeed(2.0)}>2x</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Audio Feature */}
                  <div className={`feature-tab ${activeOption === "audio" ? "active" : ""}`}>
                    <div className="feature-header">
                      <span className="feature-icon">🎵</span>
                      <span className="feature-title">Audio</span>
                      {audioSrc && <span className="feature-badge">✓</span>}
                    </div>
                    {activeOption === "audio" && (
                      <div className="feature-content">
                        {!audioSrc ? (
                          <button 
                            className="feature-btn-small" 
                            onClick={(e) => {
                              e.stopPropagation();
                              pickAudio();
                            }}
                          >
                            + Select Audio
                          </button>
                        ) : (
                          <>
                            <div className="feature-video-selected" style={{ marginBottom: '10px' }}>
                              Audio selected
                              <button 
                                className="change-btn-small" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  pickAudio();
                                }}
                              >
                                Change
                              </button>
                            </div>
                            {audioSrc && (
                              <audio 
                                src={audioSrc} 
                                onLoadedMetadata={onAudioLoadedMetadata}
                                style={{ display: 'none' }}
                              />
                            )}
                            <div style={{ marginBottom: '10px' }}>
                              <label style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '5px', display: 'block' }}>
                                Audio/Video Priority:
                              </label>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <button
                                  className={`preset-btn-small ${audioPlacement === "audio_priority" ? 'active' : ''}`}
                                  onClick={() => {
                                    setAudioPlacement("audio_priority");
                                    setAudioStartTime(0);
                                    // If audio is longer, video will loop; if shorter, audio will repeat
                                    setAudioEndTime(Math.max(audioDuration, clip.duration));
                                  }}
                                  style={{ width: '100%', textAlign: 'left', padding: '5px 10px' }}
                                >
                                  🎵 Audio Priority (video loops if audio is longer)
                                </button>
                                <button
                                  className={`preset-btn-small ${audioPlacement === "video_priority" ? 'active' : ''}`}
                                  onClick={() => {
                                    setAudioPlacement("video_priority");
                                    setAudioStartTime(0);
                                    // If video is longer, audio will repeat; if shorter, audio will be trimmed
                                    setAudioEndTime(clip.duration);
                                  }}
                                  style={{ width: '100%', textAlign: 'left', padding: '5px 10px' }}
                                >
                                  🎬 Video Priority (audio repeats/trims to video length)
                                </button>
                                <button
                                  className={`preset-btn-small ${audioPlacement === "custom" ? 'active' : ''}`}
                                  onClick={() => setAudioPlacement("custom")}
                                  style={{ width: '100%', textAlign: 'left', padding: '5px 10px' }}
                                >
                                  ⚙️ Custom Placement
                                </button>
                              </div>
                              {audioPlacement === "audio_priority" && (
                                <div style={{ fontSize: '10px', color: '#666', marginTop: '5px', fontStyle: 'italic' }}>
                                  Video will loop/repeat until audio ends
                                </div>
                              )}
                              {audioPlacement === "video_priority" && (
                                <div style={{ fontSize: '10px', color: '#666', marginTop: '5px', fontStyle: 'italic' }}>
                                  Audio will repeat or trim to match video length
                                </div>
                              )}
                            </div>
                            {audioPlacement === "custom" && (
                              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div className="feature-row">
                                  <label>Start Time:</label>
                                  <input
                                    type="number"
                                    min="0"
                                    max={clip.duration}
                                    step="0.1"
                                    value={audioStartTime}
                                    onChange={(e) => {
                                      const val = Math.max(0, Math.min(parseFloat(e.target.value) || 0, clip.duration));
                                      setAudioStartTime(val);
                                      if (val >= audioEndTime) {
                                        setAudioEndTime(Math.min(val + audioDuration, clip.duration));
                                      }
                                    }}
                                    className="feature-input-small"
                                  />
                                  <span className="feature-unit">s</span>
                                </div>
                                <div className="feature-row">
                                  <label>End Time:</label>
                                  <input
                                    type="number"
                                    min={audioStartTime}
                                    max={clip.duration}
                                    step="0.1"
                                    value={audioEndTime}
                                    onChange={(e) => {
                                      const val = Math.max(audioStartTime, Math.min(parseFloat(e.target.value) || audioStartTime, clip.duration));
                                      setAudioEndTime(val);
                                    }}
                                    className="feature-input-small"
                                  />
                                  <span className="feature-unit">s</span>
                                </div>
                              </div>
                            )}
                            {audioDuration > 0 && (
                              <div style={{ marginTop: '15px', padding: '10px', backgroundColor: '#e3f2fd', borderRadius: '4px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '5px', display: 'block', color: '#1976d2' }}>
                                  🎵 Audio Information:
                                </div>
                                <div style={{ fontSize: '13px', color: '#333', fontWeight: '600' }}>
                                  Total Audio Duration: {formatTime(audioDuration)}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Preview and Export Buttons */}
                <div className="actions-unified" style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                  <button
                    className="feature-btn-small"
                    onClick={generatePreview}
                    disabled={isGeneratingPreview || isExporting}
                    style={{ 
                      padding: '10px 20px', 
                      fontSize: '14px',
                      backgroundColor: previewVideoSrc ? '#4CAF50' : '#2196F3',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: (isGeneratingPreview || isExporting) ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {isGeneratingPreview ? "⏳ Generating Preview..." : previewVideoSrc ? "🔄 Regenerate Preview" : "🎬 Generate Preview"}
                  </button>
                  <button
                    className="export-btn-unified"
                    onClick={exportAllFeatures}
                    disabled={isExporting || isGeneratingPreview}
                  >
                    {isExporting ? "⏳ Exporting All Features..." : "💾 Export Video with All Features"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
