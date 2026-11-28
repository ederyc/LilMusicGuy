// Lil Music Guy desktop app.
//
// Wallpaper mode (the default): a small transparent window in the bottom-right corner of
// the screen, at the desktop level, behind every other window. His prop sits on the top
// edge of the dock / taskbar. It can't be clicked, so he's controlled from the menu bar.
//
// Buddy mode (on top of windows, interactive) comes next.
//
// Security and privacy (see SECURITY.md):
// - The page runs sandboxed with no Node access; it only gets the three functions in
//   preload.cjs, and every message across that bridge is checked.
// - The app makes no network requests. Anything that isn't one of its own files is
//   blocked, and the page can't navigate anywhere or open windows.
// - Audio is analysed in memory and never recorded or saved. Speech understanding is off
//   by default, runs on this machine only (transcriber.cjs), and the words never leave
//   that process.
// - Only the microphone / system-audio permissions are granted, and only to our own page.

const { app, BrowserWindow, Menu, Tray, desktopCapturer, ipcMain, nativeImage, screen, session, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SIZE = { width: 300, height: 440 };
const MARGIN_RIGHT = 40;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const DIST = path.join(DIST_DIR, 'index.html');
const DEV_URL = process.env.LMG_DEV_URL; // e.g. http://localhost:5173 while running `npm run dev`
const DEBUG = !!process.env.LMG_DEBUG; // log the page's console here
const MODELS_DIR = app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, '..', 'models');
const MODEL_FILE = path.join(MODELS_DIR, 'onnx-community', 'whisper-tiny.en', 'config.json');

const SOURCES = [
  { id: 'system', label: 'Computer audio' },
  { id: 'mic', label: 'Microphone' },
  { id: 'demo', label: 'Demo beat (no sound)' },
  { id: 'off', label: 'Off' },
];
const PROPS = [
  { id: 'speaker', label: 'Speaker' },
  { id: 'crate', label: 'Record crate' },
  { id: 'none', label: 'Nothing' },
];

// --- Trusted locations -------------------------------------------------------------
/** Is this URL our own page (the built app on disk, or the dev server while developing)? */
function isOurPage(url) {
  try {
    const u = new URL(url);
    if (DEV_URL && u.origin === new URL(DEV_URL).origin) return true;
    return u.protocol === 'file:' && u.pathname === pathToFileURL(DIST).pathname;
  } catch {
    return false;
  }
}

/** May the page load this? Our own files and the dev server only; never the internet. */
function isAllowedRequest(url) {
  try {
    const u = new URL(url);
    if (['devtools:', 'data:', 'blob:'].includes(u.protocol)) return true;
    if (u.protocol === 'file:') {
      const file = path.normalize(decodeURIComponent(u.pathname));
      return file === DIST_DIR || file.startsWith(DIST_DIR + path.sep);
    }
    if (DEV_URL) {
      const dev = new URL(DEV_URL);
      if ((u.protocol === 'http:' || u.protocol === 'ws:') && u.host === dev.host) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function fromOurPage(event) {
  return isOurPage(event.senderFrame?.url ?? '');
}

// --- Settings ----------------------------------------------------------------
// LMG_USER_DATA: keep settings in another folder (tests / trying things without touching
// your real settings).
if (process.env.LMG_USER_DATA) app.setPath('userData', path.resolve(process.env.LMG_USER_DATA));
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { source: 'system', prop: 'speaker', understandSpeech: false };
function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    // Only take values we know; ignore anything else in the file.
    if (SOURCES.some((s) => s.id === saved.source)) settings.source = saved.source;
    if (PROPS.some((p) => p.id === saved.prop)) settings.prop = saved.prop;
    if (typeof saved.understandSpeech === 'boolean') settings.understandSpeech = saved.understandSpeech;
  } catch {
    /* first run */
  }
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true, mode: 0o700 });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error('Could not save settings', err);
  }
}

// --- Speech understanding (on-device, opt-in) ----------------------------------------
let transcriber = null;
let transcriberState = 'off'; // off | loading | ready | error
const haveModel = () => fs.existsSync(MODEL_FILE);

function startTranscriber() {
  if (transcriber || !haveModel()) return;
  transcriberState = 'loading';
  transcriber = utilityProcess.fork(path.join(__dirname, 'transcriber.cjs'), [], {
    serviceName: 'Lil Music Guy speech (on-device)',
    stdio: DEBUG ? 'inherit' : 'ignore',
  });
  transcriber.postMessage({ type: 'init', modelsDir: MODELS_DIR });
  transcriber.on('message', (msg) => {
    if (msg?.type === 'ready') transcriberState = 'ready';
    else if (msg?.type === 'error') {
      transcriberState = 'error';
      if (DEBUG) console.log('[speech] error:', msg.message);
    } else if (msg?.type === 'heard') {
      if (DEBUG) console.log(`[speech] heard ${msg.words} words → ${msg.cue ?? 'no reaction'}`); // never the words
      if (msg.cue) send({ type: 'cue', value: msg.cue });
    }
    refreshTray();
  });
  transcriber.on('exit', () => {
    transcriber = null;
    if (transcriberState !== 'off') transcriberState = settings.understandSpeech ? 'error' : 'off';
    refreshTray();
  });
}

function stopTranscriber() {
  transcriberState = 'off';
  transcriber?.kill();
  transcriber = null;
}

function setUnderstandSpeech(on) {
  settings.understandSpeech = on && haveModel();
  saveSettings();
  if (settings.understandSpeech) startTranscriber();
  else stopTranscriber();
  send({ type: 'understand', value: settings.understandSpeech });
  refreshTray();
}

// --- Windows -----------------------------------------------------------------
let guyWindow = null;
let benchWindow = null;
let tray = null;
let status = { mode: 'off', text: 'Starting…' };

/** Locked-down settings for every page we show. */
const SAFE_WEB_PREFERENCES = {
  preload: path.join(__dirname, 'preload.cjs'),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  spellcheck: false,
  devTools: !app.isPackaged,
};

function load(win, query) {
  if (DEV_URL) return win.loadURL(`${DEV_URL}/?${new URLSearchParams(query)}`);
  return win.loadFile(DIST, { query });
}

function placeGuy() {
  if (!guyWindow) return;
  const { workArea } = screen.getPrimaryDisplay();
  guyWindow.setBounds({
    x: Math.round(workArea.x + workArea.width - SIZE.width - MARGIN_RIGHT),
    y: Math.round(workArea.y + workArea.height - SIZE.height), // bottom edge = top of the dock
    width: SIZE.width,
    height: SIZE.height,
  });
}

function createGuyWindow() {
  guyWindow = new BrowserWindow({
    ...SIZE,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    // macOS / Linux: live at the desktop level, behind all windows, like a wallpaper.
    ...(process.platform === 'win32' ? {} : { type: 'desktop' }),
    webPreferences: {
      ...SAFE_WEB_PREFERENCES,
      backgroundThrottling: false, // keep dancing when nothing's focused
    },
  });
  guyWindow.setIgnoreMouseEvents(true);
  guyWindow.setVisibleOnAllWorkspaces(true);
  placeGuy();
  // LMG_SOURCE overrides the saved source for this run only (e.g. `demo` while testing).
  load(guyWindow, {
    desktop: '1',
    source: process.env.LMG_SOURCE || settings.source,
    prop: settings.prop,
    understand: settings.understandSpeech ? '1' : '0',
  });
  if (DEBUG) {
    guyWindow.webContents.on('console-message', (e) => console.log(`[page] ${e.message}`));
    guyWindow.webContents.on('did-finish-load', () => console.log('[app] page loaded'));
    setTimeout(async () => {
      console.log('[app] bounds', JSON.stringify(guyWindow.getBounds()), 'visible', guyWindow.isVisible());
      console.log('[app] workArea', JSON.stringify(screen.getPrimaryDisplay().workArea));
      if (process.env.LMG_SNAPSHOT) {
        fs.writeFileSync(process.env.LMG_SNAPSHOT, (await guyWindow.webContents.capturePage()).toPNG());
        console.log('[app] snapshot saved');
      }
    }, 6000);
  }
  guyWindow.once('ready-to-show', () => guyWindow.showInactive());
  // He shares the desktop layer with the wallpaper. If macOS ever re-stacks that layer
  // (wallpaper change, Space switch), bring him back in front of it. This only reorders
  // within the desktop layer; he stays behind every normal window.
  const keepInFront = setInterval(() => guyWindow?.moveTop(), 5000);
  guyWindow.on('closed', () => clearInterval(keepInFront));
  guyWindow.on('closed', () => (guyWindow = null));
}

function openTestBench() {
  if (benchWindow) return benchWindow.focus();
  benchWindow = new BrowserWindow({ width: 1200, height: 800, title: 'Lil Music Guy: test bench', webPreferences: SAFE_WEB_PREFERENCES });
  load(benchWindow, {});
  benchWindow.on('closed', () => (benchWindow = null));
}

function send(cmd) {
  guyWindow?.webContents.send('lilguy:command', cmd);
}

// --- Menu bar ------------------------------------------------------------------
function trayIcon() {
  if (process.platform === 'darwin') return nativeImage.createEmpty(); // a ♪ title instead
  // Elsewhere: a small purple dot.
  const n = 16;
  const buf = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const inside = (x - 7.5) ** 2 + (y - 7.5) ** 2 < 36;
      buf.set(inside ? [0xe7, 0x5c, 0x6c, 0xff] : [0, 0, 0, 0], (y * n + x) * 4); // BGRA
    }
  }
  return nativeImage.createFromBitmap(buf, { width: n, height: n });
}

function speechMenuItem() {
  if (!haveModel()) {
    return { label: 'Understand speech: run "npm run models" first', enabled: false };
  }
  const state = { loading: ' (starting…)', error: ' (not working, try toggling)', ready: '', off: '' }[transcriberState] ?? '';
  return {
    label: `Understand speech, on this computer only${state}`,
    toolTip: 'Lets him react to what people say in videos and podcasts. Runs entirely on this computer; nothing is saved or sent anywhere.',
    type: 'checkbox',
    checked: settings.understandSpeech,
    click: (item) => setUnderstandSpeech(item.checked),
  };
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'Lil Music Guy', enabled: false },
    { label: status.text || 'Idle', enabled: false },
    { type: 'separator' },
    {
      label: 'Listen to',
      submenu: SOURCES.map((s) => ({
        label: s.label,
        type: 'radio',
        checked: settings.source === s.id,
        click: () => {
          settings.source = s.id;
          saveSettings();
          send({ type: 'source', value: s.id });
        },
      })),
    },
    speechMenuItem(),
    {
      label: 'Home',
      submenu: PROPS.map((p) => ({
        label: p.label,
        type: 'radio',
        checked: settings.prop === p.id,
        click: () => {
          settings.prop = p.id;
          saveSettings();
          send({ type: 'prop', value: p.id });
        },
      })),
    },
    {
      label: 'Mode',
      submenu: [
        { label: 'Wallpaper (behind your windows)', type: 'radio', checked: true },
        { label: 'Buddy (on top, interactive): coming soon', type: 'radio', enabled: false },
      ],
    },
    { type: 'separator' },
    { label: 'Open test bench…', click: openTestBench },
    { label: 'Reload him', click: () => guyWindow?.reload() },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(buildMenu());
  tray.setToolTip(`Lil Music Guy: ${status.text}`);
}

// --- Lockdown (applies to every window and web page the app creates) ------------------
app.enableSandbox();

app.on('web-contents-created', (_event, contents) => {
  // No navigating away from our page, no popups, no embedded web views.
  contents.on('will-navigate', (e, url) => {
    if (!isOurPage(url)) e.preventDefault();
  });
  contents.on('will-redirect', (e, url) => {
    if (!isOurPage(url)) e.preventDefault();
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

function lockDownSession(ses) {
  // The network kill switch: only our own files (and the dev server when developing).
  ses.webRequest.onBeforeRequest((details, callback) => {
    const ok = isAllowedRequest(details.url);
    if (!ok && DEBUG) console.log('[security] blocked a request to', details.url.split(/[?#]/)[0].slice(0, 120));
    callback({ cancel: !ok });
  });

  // Permissions: the microphone (and screen-share for system audio) for our page only.
  const ALLOWED = new Set(['media', 'display-capture']);
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const ok =
      ALLOWED.has(permission) &&
      isOurPage(details.requestingUrl) &&
      (permission !== 'media' || (details.mediaTypes ?? []).every((t) => t === 'audio'));
    if (!ok && DEBUG) console.log('[security] denied permission', permission);
    callback(ok);
  });
  // (Checks only carry an origin, not the full URL. Our windows can't navigate anywhere
  // else, so a file:// origin can only be our page.)
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (!ALLOWED.has(permission)) return false;
    if (String(requestingOrigin).startsWith('file://')) return true;
    return !!DEV_URL && requestingOrigin === new URL(DEV_URL).origin;
  });
  ses.setDevicePermissionHandler(() => false); // no USB / HID / serial / Bluetooth devices

  // "Computer audio": the page asks for a screen share; we grant the main screen with
  // system audio (loopback). The page disables the video track straight away and never
  // reads it. macOS asks for Screen Recording / System Audio Recording permission once.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const origin = request.frame?.url ?? request.securityOrigin ?? '';
    if (!isOurPage(origin) || !request.audioRequested) {
      if (DEBUG) console.log('[security] denied a screen-share request');
      return callback({});
    }
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
      .catch(() => callback({}));
  });
}

// --- App -------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(() => {
  loadSettings();
  if (process.platform === 'darwin') app.dock?.hide(); // a menu-bar app, no dock icon
  lockDownSession(session.defaultSession);

  ipcMain.on('lilguy:status', (event, s) => {
    if (!fromOurPage(event) || !s || typeof s !== 'object') return;
    status = { mode: String(s.mode).slice(0, 20), text: String(s.text).slice(0, 80) };
    refreshTray();
  });
  ipcMain.on('lilguy:audio', (event, samples) => {
    // Speech audio for the transcriber: only from our page, only when the user turned
    // it on, only sane sizes. Passed straight through, never stored.
    if (!fromOurPage(event) || !settings.understandSpeech || !transcriber) return;
    if (!(samples instanceof Float32Array) || samples.length === 0 || samples.length > 16000 * 15) return;
    transcriber.postMessage({ type: 'audio', samples });
  });

  tray = new Tray(trayIcon());
  if (process.platform === 'darwin') tray.setTitle('♪');
  if (settings.understandSpeech && !haveModel()) settings.understandSpeech = false;
  if (settings.understandSpeech) startTranscriber();
  refreshTray();

  createGuyWindow();
  screen.on('display-metrics-changed', placeGuy); // dock moved / resized, display changed
  screen.on('display-added', placeGuy);
  screen.on('display-removed', placeGuy);
});

app.on('window-all-closed', () => {
  /* stay running in the menu bar */
});
app.on('before-quit', stopTranscriber);
