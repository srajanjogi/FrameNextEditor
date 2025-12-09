const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  pickVideo: (isInsertVideo) => ipcRenderer.invoke("pick-video", isInsertVideo),
  pickAudio: () => ipcRenderer.invoke("pick-audio"),
  trimVideo: (start, end) =>
    ipcRenderer.invoke("trim-video", { start, end }),
  exportVideo: (features, mainVideoPath) =>
    ipcRenderer.invoke("export-video", features, mainVideoPath)
});
