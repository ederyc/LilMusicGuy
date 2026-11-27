// Lil Music Guy desktop app.
//
// Wallpaper mode (the default): a small transparent window in the bottom-right corner of
// the screen, at the desktop level, behind every other window. His prop sits on the top
// edge of the dock / taskbar. It can't be clicked, so he's controlled from the menu bar.
//
// Buddy mode (on top of windows, interactive) comes next.

const { app, BrowserWindow, Menu, Tray, desktopCapturer, ipcMain, nativeImage, screen, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = { width: 300, height: 440 };
const MARGIN_RIGHT = 40;
const DIST = path.join(__dirname, '..', 'dist', 'index.html');
const DEV_URL = process.env.LMG_DEV_URL; // e.g. http://localhost:5173 while running `npm run dev`
const DEBUG = !!process.env.LMG_DEBUG; // log the page's console here

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

// --- Settings ----------------------------------------------------------------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { source: 'system', prop: 'speaker' };
function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    /* first run */
  }
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Could not save settings', err);
  }
}

// --- Windows -----------------------------------------------------------------
let guyWindow = null;
let benchWindow = null;
let tray = null;
let status = { mode: 'off', text: 'Starting…' };

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
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false, // keep dancing when nothing's focused
    },
  });
  guyWindow.setIgnoreMouseEvents(true);
  guyWindow.setVisibleOnAllWorkspaces(true);
  placeGuy();
  // LMG_SOURCE overrides the saved source for this run only (e.g. `demo` while testing).
  load(guyWindow, { desktop: '1', source: process.env.LMG_SOURCE || settings.source, prop: settings.prop });
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
  benchWindow = new BrowserWindow({ width: 1200, height: 800, title: 'Lil Music Guy: test bench' });
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

// --- App -------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(() => {
  loadSettings();
  if (process.platform === 'darwin') app.dock?.hide(); // a menu-bar app, no dock icon

  // "Computer audio": the page asks for a screen share; we grant the main screen with
  // system audio (loopback). The video is never used. macOS asks for Screen Recording
  // and System Audio Recording permission the first time.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : null))
      .catch(() => callback(null));
  });

  ipcMain.on('lilguy:status', (_event, s) => {
    status = s;
    refreshTray();
  });

  tray = new Tray(trayIcon());
  if (process.platform === 'darwin') tray.setTitle('♪');
  refreshTray();

  createGuyWindow();
  screen.on('display-metrics-changed', placeGuy); // dock moved / resized, display changed
  screen.on('display-added', placeGuy);
  screen.on('display-removed', placeGuy);
});

app.on('window-all-closed', () => {
  /* stay running in the menu bar */
});
