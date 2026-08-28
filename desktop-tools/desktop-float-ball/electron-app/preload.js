const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  startBackend: () => ipcRenderer.invoke("backend:start"),
  stopBackend: () => ipcRenderer.invoke("backend:stop"),
  getBackendStatus: () => ipcRenderer.invoke("backend:status"),
  getLauncherState: () => ipcRenderer.invoke("launcher:get-state"),
  setLauncherBallPosition: (payload) => ipcRenderer.invoke("launcher:set-ball-position", payload),
  setSelectionSuspended: (payload) => ipcRenderer.invoke("selection:set-suspended", payload),
  snapLauncherIfNearEdge: () => ipcRenderer.invoke("launcher:snap-if-near-edge"),
  expandLauncherBall: () => ipcRenderer.invoke("launcher:expand-ball"),
  setLauncherMenuOpen: (open) => ipcRenderer.invoke("launcher:set-menu-open", open),
  quitApp: () => ipcRenderer.invoke("app:quit"),
  onBackendStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("backend-status", listener);
    return () => ipcRenderer.removeListener("backend-status", listener);
  },
  onLauncherState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("launcher-state", listener);
    return () => ipcRenderer.removeListener("launcher-state", listener);
  },
  onBubbleData: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("bubble-data", listener);
    return () => ipcRenderer.removeListener("bubble-data", listener);
  },
  onGrammarData: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("grammar-data", listener);
    return () => ipcRenderer.removeListener("grammar-data", listener);
  },
  lookupWord: (payload) => ipcRenderer.invoke("word:lookup", payload),
  onWordLookupResult: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("word-lookup-result", listener);
    return () => ipcRenderer.removeListener("word-lookup-result", listener);
  },
  // bubble-data may be emitted multiple times for same bubble id:
  // pending first, then done payload update.
  closeBubble: () => ipcRenderer.invoke("bubble:close"),
});
