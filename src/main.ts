import * as THREE from 'three';
import { AudioEngine, type PlaybackSource } from './audio/AudioEngine';
import { FeatureExtractor } from './audio/FeatureExtractor';
import { FileTrack } from './audio/sources/FileTrack';
import { MicInput } from './audio/sources/MicInput';
import { SIM_STYLES, SimulatedSource, type SimStyleName } from './audio/sources/SimulatedSource';
import { SynthTrack } from './audio/sources/SynthTrack';
import { SystemAudio } from './audio/sources/SystemAudio';
import { SILENT_FEATURES, type AudioFeatures, type SpectrumSource } from './audio/types';
import { VIBE_NAMES, VibeDetector, type VibeTraits } from './audio/VibeDetector';
import { ACCESSORIES } from './character/accessories';
import { Body } from './character/Body';
import { Dancer, MOVES } from './character/Dancer';
import { DEFAULT_COLORS, LilGuy, type LilGuyColors, type SlotName } from './character/LilGuy';
import { PROPS, type Prop } from './scene/props';
import { Zzz } from './scene/Zzz';

// ?desktop=1: running inside the desktop app (transparent window, no test bench).
const params = new URLSearchParams(location.search);
const desktop = params.get('desktop') === '1';
if (desktop) document.body.classList.add('desktop');

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const stage = document.getElementById('stage')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);

scene.add(new THREE.HemisphereLight('#ffffff', '#b8b5d6', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 1.8);
sun.position.set(2, 4, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -1.5;
sun.shadow.camera.right = sun.shadow.camera.top = 1.5;
sun.shadow.radius = 6;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.ShadowMaterial({ opacity: 0.18 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// A ring on the floor around his home that pulses on each detected beat.
const ringMat = new THREE.MeshBasicMaterial({ color: '#6c5ce7', transparent: true, opacity: 0 });
const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 64), ringMat);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.002;
scene.add(ring);
// On the desktop the floor is the top of the dock, seen edge-on: no floor effects.
ground.visible = ring.visible = !desktop;

const guy = new LilGuy();
scene.add(guy.object);
const dancer = new Dancer();
const body = new Body(guy.rig);
const zzz = new Zzz();
scene.add(zzz.object);
for (const k of ['sitAfter', 'napAfter'] as const) {
  if (params.get(k)) dancer[k] = Number(params.get(k));
}

// His home prop: he stands on top of it, sits on its front edge, naps there.
let prop: Prop = PROPS[0].build();
let ringScale = 1;
function setProp(id: string) {
  const def = PROPS.find((p) => p.id === id) ?? PROPS[0];
  scene.remove(prop.object);
  prop = def.build();
  scene.add(prop.object);
  guy.object.position.y = prop.top;
  body.seatEdge = prop.frontEdge;
  ringScale = Math.max(1, (prop.width * 0.75) / 0.5);
  ground.scale.setScalar(Math.max(0.9, prop.width));
  propSelect.value = def.id;
  frameCamera();
}

/** Fit him and his prop in view (with room for jumps and raised arms). */
function frameCamera() {
  const height = prop.top + 1.9;
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  if (desktop) {
    // Looking down a little, placed so the front of the prop's base sits exactly on the
    // window's bottom edge (which the desktop app lines up with the top of the dock).
    const pitch = 0.14;
    const below = Math.tan(pitch + halfFov); // slope of the bottom edge of the view
    const above = Math.tan(halfFov - pitch); // slope of the top edge
    const z = (height + prop.frontEdge * below) / (above + below);
    camera.position.set(0, below * (z - prop.frontEdge), z);
    camera.rotation.set(-pitch, 0, 0);
  } else {
    const narrow = camera.aspect < 0.8 ? 1.3 : 1; // pull back so he clears the panel on phones
    const d = ((height * 0.62) / Math.tan(halfFov)) * narrow;
    camera.position.set(0, height * 0.62, d);
    camera.lookAt(0, height * 0.45, 0);
  }
  camera.updateProjectionMatrix();
}

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  frameCamera();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
type Mode = 'off' | 'simulated' | 'synth' | 'file' | 'mic' | 'system';

const extractor = new FeatureExtractor();
const vibeDetector = new VibeDetector();
const simulated = new SimulatedSource();
const synth = new SynthTrack();
let engine: AudioEngine | null = null;
let playback: PlaybackSource | null = null;
let mode: Mode = 'off';
let spectrumSource: SpectrumSource | null = null;
let spectrum = new Uint8Array(1024);

function getEngine(): AudioEngine {
  engine ??= new AudioEngine();
  engine.setVolume(Number(volumeInput.value) / 100);
  return engine;
}

async function setMode(next: Mode, file?: File) {
  playback?.stop();
  playback = null;
  spectrumSource = null;
  extractor.reset();
  vibeDetector.reset();

  try {
    if (next === 'simulated') {
      simulated.playing = true;
      spectrumSource = simulated;
    } else if (next !== 'off') {
      const eng = getEngine();
      await eng.resume();
      const p: PlaybackSource =
        next === 'synth' ? synth
        : next === 'mic' ? new MicInput(deviceSelect.value || undefined)
        : next === 'system' ? new SystemAudio()
        : new FileTrack(file!);
      // e.g. "Stop sharing" in the browser's own bar, or the input device unplugged
      p.onEnded = () => {
        if (playback !== p) return;
        void setMode('off').then(() => (hint.textContent = next === 'system' ? 'Sharing stopped.' : 'The input went away.'));
      };
      playback = p;
      await p.start(eng);
      spectrumSource = eng;
      if (next === 'mic') void refreshDevices(); // labels only show once there's permission
    }
    mode = next;
  } catch (err) {
    console.error(err);
    hint.textContent = `Couldn't start: ${(err as Error).message}`;
    mode = 'off';
    playback = null;
    spectrumSource = null;
  }

  if (spectrumSource && spectrum.length !== spectrumSource.binCount) {
    spectrum = new Uint8Array(spectrumSource.binCount);
  }
  updateControls(file);
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const hint = $('source-hint');
const fileInput = $<HTMLInputElement>('file-input');
const bpmInput = $<HTMLInputElement>('bpm');
const levelInput = $<HTMLInputElement>('level');
const volumeInput = $<HTMLInputElement>('volume');
const styleSelect = $<HTMLSelectElement>('sim-style');
const danceSelect = $<HTMLSelectElement>('dance');
const propSelect = $<HTMLSelectElement>('prop');
const deviceSelect = $<HTMLSelectElement>('input-device');

const HINTS: Record<Mode, string> = {
  off: 'Pick a source to get him moving.',
  simulated: 'Fake spectrum data, no sound. Tests the dance logic only.',
  synth: 'A generated beat played for real and analysed live.',
  file: 'Playing your file on loop.',
  mic: 'Listening to the input. Pick a loopback device (like BlackHole) to hear everything your computer plays.',
  system: 'Listening to what you shared. Stop sharing from the browser bar, or press Stop.',
};

function updateControls(file?: File) {
  document.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((b) => {
    b.classList.toggle('active', b.dataset.source === mode);
  });
  if (!hint.textContent?.startsWith("Couldn't")) {
    hint.textContent = mode === 'file' && file ? `Playing “${file.name}” on loop.` : HINTS[mode];
  }
  window.lilguy?.status({ mode, text: hint.textContent ?? '' });
  // Tempo also drives a picked dance when nothing's playing.
  $('bpm-row').hidden = !(mode === 'simulated' || mode === 'synth' || (mode === 'off' && danceSelect.value !== ''));
  $('level-row').hidden = mode !== 'simulated';
  $('volume-row').hidden = !(mode === 'synth' || mode === 'file');
  $('style-row').hidden = mode !== 'simulated';
  $('device-row').hidden = mode !== 'mic';
}

document.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((btn) => {
  btn.addEventListener('click', () => {
    hint.textContent = '';
    const src = btn.dataset.source as Mode;
    if (src === 'file') fileInput.click();
    else void setMode(src);
  });
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void setMode('file', file);
  fileInput.value = '';
});

// Computer audio needs screen sharing with audio (Chrome / Edge).
const systemBtn = document.querySelector<HTMLButtonElement>('[data-source="system"]')!;
if (!SystemAudio.supported) {
  systemBtn.disabled = true;
  systemBtn.title = "This browser can't share audio. Try Chrome or Edge, or use a loopback input device.";
}

async function refreshDevices() {
  const devices = await MicInput.devices();
  const keep = deviceSelect.value;
  deviceSelect.replaceChildren(new Option('Default microphone', ''));
  devices.forEach((d, i) => deviceSelect.add(new Option(d.label || `Input ${i + 1}`, d.deviceId)));
  if ([...deviceSelect.options].some((o) => o.value === keep)) deviceSelect.value = keep;
}
deviceSelect.addEventListener('change', () => {
  if (mode === 'mic') void setMode('mic');
});
void refreshDevices();

for (const [name, style] of Object.entries(SIM_STYLES)) styleSelect.add(new Option(style.label, name));
styleSelect.addEventListener('change', () => applyStyle(styleSelect.value as SimStyleName));
function applyStyle(name: SimStyleName) {
  simulated.setStyle(name);
  styleSelect.value = name;
  bpmInput.value = String(simulated.bpm);
  levelInput.value = String(Math.round(simulated.level * 100));
  bpmInput.dispatchEvent(new Event('input'));
  levelInput.dispatchEvent(new Event('input'));
  // a new style is a new song: let him listen afresh
  extractor.reset();
  vibeDetector.reset();
}

danceSelect.add(new Option('Auto (follow the music)', ''));
for (const m of MOVES) danceSelect.add(new Option(m.name, m.name));
danceSelect.addEventListener('change', () => {
  dancer.force(MOVES.find((m) => m.name === danceSelect.value) ?? null);
  updateControls();
});

const bindRange = (input: HTMLInputElement, out: string, apply: (v: number) => void) => {
  const update = () => {
    $(out).textContent = input.value;
    apply(Number(input.value));
  };
  input.addEventListener('input', update);
  update();
};
bindRange(bpmInput, 'bpm-out', (v) => {
  simulated.bpm = v;
  synth.bpm = v;
});
bindRange(levelInput, 'level-out', (v) => (simulated.level = v / 100));
bindRange(volumeInput, 'volume-out', (v) => engine?.setVolume(v / 100));

// Customization
document.querySelectorAll<HTMLInputElement>('[data-color]').forEach((input) => {
  const key = input.dataset.color as keyof LilGuyColors;
  input.value = DEFAULT_COLORS[key];
  input.addEventListener('input', () => guy.setColors({ [key]: input.value }));
});

const equippedBySlot: Partial<Record<SlotName, string>> = {};
const accessoryBox = $('accessories');
for (const acc of ACCESSORIES) {
  const btn = document.createElement('button');
  btn.textContent = acc.name;
  btn.dataset.accessory = acc.id;
  btn.addEventListener('click', () => {
    if (equippedBySlot[acc.slot] === acc.id) {
      guy.unequip(acc.slot);
      delete equippedBySlot[acc.slot];
    } else {
      guy.equip(acc.slot, acc.build());
      equippedBySlot[acc.slot] = acc.id;
    }
    accessoryBox.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.classList.toggle('active', Object.values(equippedBySlot).includes(b.dataset.accessory!));
    });
  });
  accessoryBox.appendChild(btn);
}
// Start with headphones on: he's a music guy.
(accessoryBox.querySelector('[data-accessory="headphones"]') as HTMLButtonElement).click();

updateControls();

for (const p of PROPS) propSelect.add(new Option(p.name, p.id));
propSelect.addEventListener('change', () => setProp(propSelect.value));
setProp(params.get('prop') ?? PROPS[0].id);

// URL shortcuts for quick testing, e.g. ?source=simulated&style=lofi&bpm=128
// (in a browser only simulated can autostart; real audio needs a click first).
if (params.get('ui') === '0') $('panel').hidden = true; // just him, no test bench
const styleParam = params.get('style');
if (styleParam && styleParam in SIM_STYLES) applyStyle(styleParam as SimStyleName);
if (params.get('bpm')) {
  bpmInput.value = params.get('bpm')!;
  bpmInput.dispatchEvent(new Event('input'));
}
const sourceParam = params.get('source');
if (sourceParam === 'simulated' || sourceParam === 'demo') void setMode('simulated');
else if (desktop && (sourceParam === 'system' || sourceParam === 'mic')) void setMode(sourceParam);
const moveParam = params.get('move');
if (moveParam && MOVES.some((m) => m.name === moveParam)) {
  danceSelect.value = moveParam;
  danceSelect.dispatchEvent(new Event('change'));
}
// ?at=<seconds>: simulate that long, then hold still on that frame (for screenshots).
const freezeAt = params.get('at') ? Number(params.get('at')) : null;

// ---------------------------------------------------------------------------
// Desktop app bridge (see electron/): the menu-bar menu sends commands here.
// ---------------------------------------------------------------------------
window.lilguy?.onCommand((cmd) => {
  if (cmd.type === 'source') {
    hint.textContent = '';
    void setMode(cmd.value === 'demo' ? 'simulated' : cmd.value);
  } else if (cmd.type === 'prop') {
    setProp(cmd.value);
  }
});

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const beatDot = $('beat-dot');
const meters = { bass: $('m-bass'), mid: $('m-mid'), treble: $('m-treble'), intensity: $('m-intensity') };
const bpmDetected = $('bpm-detected');
const moveLabel = $('move');
const vibeLabel = $('vibe');
const vibeSub = $('vibe-sub');
const traitMeters = Object.fromEntries(
  (['energy', 'punch', 'bass', 'bright', 'noisy', 'swing'] as const).map((k) => [k, $(`t-${k}`)]),
) as Partial<Record<keyof VibeTraits, HTMLElement>>;
const VIBE_LABELS = Object.fromEntries(VIBE_NAMES.map((v) => [v, v[0].toUpperCase() + v.slice(1)]));
let beatFlashUntil = 0;
let ringPulse = 0;
let lastNow = performance.now();
let frozen = false;

/**
 * A picked dance with no music playing still needs a beat: fake a steady one at the
 * Tempo slider so he can show the move off on its own.
 */
function metronome(t: number): AudioFeatures {
  const bpm = Number(bpmInput.value);
  return { ...SILENT_FEATURES, time: t, bpm, beat: (t * bpm) / 60, energy: 0.32, bass: 0.6, mid: 0.4, treble: 0.3, active: true };
}

const headTop = new THREE.Vector3();
const ZZZ_OFFSET = new THREE.Vector3(0.14, 0.6, 0.05);

function step(t: number, dt: number) {
  // With no source we feed silence, so he eases back into his idle animation.
  if (spectrumSource) spectrumSource.read(spectrum, t);
  else spectrum.fill(0);
  let features: AudioFeatures = extractor.process(spectrum, spectrumSource?.binHz ?? 23.4375, t);
  if (!spectrumSource && danceSelect.value) features = metronome(t);

  const vibe = vibeDetector.process(spectrum, spectrumSource?.binHz ?? 23.4375, features);
  const pose = dancer.update(features, vibe, dt);
  body.update(pose, dt);
  body.apply();
  prop.update(features, dt);
  zzz.update(guy.rig.head.getWorldPosition(headTop).add(ZZZ_OFFSET), dancer.sleepiness, dt);
  return { features, vibe };
}

function frame(now: number) {
  const t = now / 1000;
  const dt = Math.max(0, Math.min((now - lastNow) / 1000, 0.1));
  lastNow = now;

  if (freezeAt !== null) {
    if (!frozen) {
      for (let st = 0; st < freezeAt; st += 1 / 60) step(st, 1 / 60);
      frozen = true;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
    return;
  }
  const { features, vibe } = step(t, dt);

  if (features.isBeat) {
    ringPulse = 0.4 + 0.6 * features.beatStrength;
    beatFlashUntil = now + 90;
  }
  ringPulse *= Math.exp(-dt * 6);
  ring.scale.setScalar(ringScale * (1 + (1 - ringPulse) * 0.25));
  ringMat.opacity = ringPulse * 0.6;

  beatDot.classList.toggle('on', now < beatFlashUntil);
  bpmDetected.textContent = features.bpm ? Math.round(features.bpm).toString() : '–';
  moveLabel.textContent = dancer.label;

  if (vibe.listening) {
    vibeLabel.textContent = 'Listening…';
    vibeSub.textContent = vibe.candidate ? `sounds ${VIBE_LABELS[vibe.candidate].toLowerCase()} so far` : '';
  } else if (vibe.name) {
    vibeLabel.textContent = VIBE_LABELS[vibe.name];
    const switching = vibe.candidate && vibe.candidate !== vibe.name ? ` · hearing ${VIBE_LABELS[vibe.candidate].toLowerCase()}…` : '';
    vibeSub.textContent = `${Math.round(vibe.confidence * 100)}% sure, then ${VIBE_LABELS[vibe.next!].toLowerCase()}${switching}`;
  } else {
    vibeLabel.textContent = '–';
    vibeSub.textContent = '';
  }
  for (const [k, el] of Object.entries(traitMeters)) el!.style.width = `${vibe.traits[k as keyof VibeTraits] * 100}%`;
  meters.bass.style.width = `${features.bass * 100}%`;
  meters.mid.style.width = `${features.mid * 100}%`;
  meters.treble.style.width = `${features.treble * 100}%`;
  meters.intensity.style.width = `${dancer.intensity * 100}%`;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
