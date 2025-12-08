import { useState } from "react";

const PX_PER_SEC = 50; // timeline scale

export default function App() {
  const [videoSrc, setVideoSrc] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);

  const [clip, setClip] = useState({
    start: 0,
    duration: 5
  });

  const [drag, setDrag] = useState(null); // "left" | "right" | null

  // PICK VIDEO ───────────────
  async function pickVideo() {
    const res = await window.api.pickVideo();
    if (!res) return;

    // Load video path directly (NO BASE64)
    setVideoSrc("file://" + res.videoPath);
  }

  // When metadata loads of video
  function onLoadedMetadata(e) {
    const dur = e.target.duration;
    setVideoDuration(dur);

    setClip({
      start: 0,
      duration: Math.min(dur, 5) // default 5 seconds or full video
    });
  }

  // DRAG HANDLES ───────────────
  function handleMove(e) {
    if (!drag) return;

    const timeline = document
      .getElementById("timeline")
      .getBoundingClientRect();

    const t = (e.clientX - timeline.left) / PX_PER_SEC; // convert px → sec

    setClip(prev => {
      if (drag === "left") {
        const newStart = Math.min(t, prev.start + prev.duration - 0.2);

        return {
          start: Math.max(0, newStart),
          duration: prev.start + prev.duration - newStart
        };
      }

      if (drag === "right") {
        const newEnd = Math.max(prev.start + 0.2, t);

        return {
          ...prev,
          duration: Math.min(newEnd - prev.start, videoDuration - prev.start)
        };
      }

      return prev;
    });
  }

  // TRIM VIDEO (send to Electron) ───────────────
  async function trimVideo() {
    const start = clip.start;
    const end = clip.start + clip.duration;

    const saved = await window.api.trimVideo(start, end);
    if (saved) alert("Trimmed video saved:\n" + saved);
  }

  return (
    <div
      style={{ padding: 20 }}
      onMouseMove={handleMove}
      onMouseUp={() => setDrag(null)}
    >
      <h1 style={{ marginBottom: 15 }}>Simple Video Trimmer</h1>

      <button onClick={pickVideo}>Select Video</button>

      {videoSrc && (
        <>
          <br />

          {/* VIDEO PLAYER */}
          <video
            src={videoSrc}
            width={700}
            controls
            onLoadedMetadata={onLoadedMetadata}
            style={{ marginTop: 20 }}
          />

          {/* TIMELINE */}
          <h3 style={{ marginTop: 25 }}>Timeline</h3>

          <div
            id="timeline"
            style={{
              width: 900,
              height: 60,
              background: "#ddd",
              marginTop: 10,
              position: "relative"
            }}
          >
            {/* GREEN CLIP BOX */}
            <div
              style={{
                position: "absolute",
                left: clip.start * PX_PER_SEC,
                width: clip.duration * PX_PER_SEC,
                height: "100%",
                background: "lightgreen",
                border: "2px solid green",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                boxSizing: "border-box"
              }}
            >
              {/* TIME LABEL */}
              <div
                style={{
                  position: "absolute",
                  top: -25,
                  background: "black",
                  color: "white",
                  padding: "3px 6px",
                  borderRadius: 4,
                  fontSize: 12
                }}
              >
                {clip.start.toFixed(2)}s — {(clip.start + clip.duration).toFixed(2)}s
              </div>

              {/* LEFT HANDLE */}
              <div
                onMouseDown={() => setDrag("left")}
                style={{
                  width: 10,
                  height: "100%",
                  background: "green",
                  cursor: "ew-resize"
                }}
              />

              {/* Middle text */}
              <div style={{ flex: 1, textAlign: "center" }}>CLIP</div>

              {/* RIGHT HANDLE */}
              <div
                onMouseDown={() => setDrag("right")}
                style={{
                  width: 10,
                  height: "100%",
                  background: "green",
                  cursor: "ew-resize"
                }}
              />
            </div>
          </div>

          {/* INFO */}
          <p style={{ marginTop: 10 }}>
            Start: {clip.start.toFixed(2)}s &nbsp;|&nbsp;
            End: {(clip.start + clip.duration).toFixed(2)}s
          </p>

          {/* TRIM BUTTON */}
          <button onClick={trimVideo} style={{ marginTop: 10 }}>
            Trim Video ✂
          </button>
        </>
      )}
    </div>
  );
}
