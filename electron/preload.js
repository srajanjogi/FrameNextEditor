const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  pickVideo: () => ipcRenderer.invoke("pick-video"),
  trimVideo: (start, end) =>
    ipcRenderer.invoke("trim-video", { start, end })
});
