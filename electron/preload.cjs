// Bridge between the desktop app (main.cjs) and the page, exposed as `window.lilguy`.
// The page gets exactly these three functions, nothing else from Electron or Node.
// Everything crossing here is checked, in both directions.
const { contextBridge, ipcRenderer } = require('electron');

const SOURCES = ['system', 'mic', 'demo', 'off'];
const CUES = ['laugh', 'question', 'greeting', 'music', 'wow'];
const MAX_SAMPLES = 16000 * 15;

function validCommand(cmd) {
  if (!cmd || typeof cmd !== 'object') return false;
  switch (cmd.type) {
    case 'source':
      return SOURCES.includes(cmd.value);
    case 'prop':
      return typeof cmd.value === 'string' && /^[a-z]{1,20}$/.test(cmd.value);
    case 'understand':
      return typeof cmd.value === 'boolean';
    case 'cue':
      return CUES.includes(cmd.value);
    default:
      return false;
  }
}

contextBridge.exposeInMainWorld('lilguy', {
  onCommand: (cb) =>
    ipcRenderer.on('lilguy:command', (_event, cmd) => {
      if (validCommand(cmd)) cb({ type: cmd.type, value: cmd.value });
    }),
  status: (s) => {
    if (!s || typeof s !== 'object') return;
    ipcRenderer.send('lilguy:status', { mode: String(s.mode).slice(0, 20), text: String(s.text).slice(0, 80) });
  },
  hear: (samples) => {
    if (!(samples instanceof Float32Array) || samples.length === 0 || samples.length > MAX_SAMPLES) return;
    ipcRenderer.send('lilguy:audio', samples);
  },
});
