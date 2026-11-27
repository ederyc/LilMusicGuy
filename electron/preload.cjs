// Bridge between the desktop app (main.cjs) and the page. Exposed as `window.lilguy`.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lilguy', {
  onCommand: (cb) => ipcRenderer.on('lilguy:command', (_event, cmd) => cb(cmd)),
  status: (s) => ipcRenderer.send('lilguy:status', s),
});
