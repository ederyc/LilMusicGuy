import * as THREE from 'three';
import { AudioEngine, type PlaybackSource } from './audio/AudioEngine';
import { FeatureExtractor } from './audio/FeatureExtractor';
import { FileTrack } from './audio/sources/FileTrack';
import { MicInput } from './audio/sources/MicInput';
import { SimulatedSource } from './audio/sources/SimulatedSource';
import { SynthTrack } from './audio/sources/SynthTrack';
import type { AudioFeatures, SpectrumSource } from './audio/types';
import { ACCESSORIES } from './character/accessories';
import { Dancer } from './character/Dancer';
import { DEFAULT_COLORS, LilGuy, type LilGuyColors, type SlotName } from './character/LilGuy';

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
camera.position.set(0, 1.1, 4.4);
camera.lookAt(0, 0.78, 0);

scene.add(new THREE.HemisphereLight('#ffffff', '#b8b5d6', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 1.8);
sun.position.set(2, 4, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -1.5;
sun.shadow.camera.right = sun.shadow.camera.top = 1.5;
sun.shadow.radius = 6;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), new THREE.ShadowMaterial({ opacity: 0.18 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// A ring under his feet that pulses on each detected beat.
const ringMat = new THREE.MeshBasicMaterial({ color: '#6c5ce7', transparent: true, opacity: 0 });
const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 64), ringMat);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.002;
scene.add(ring);

const guy = new LilGuy();
scene.add(guy.object);
const dancer = new Dancer();

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // On narrow screens, pull back so he stays fully in frame above the panel.
  camera.position.z = w / h < 0.8 ? 5.8 : 4.4;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
type Mode = 'off' | 'simulated' | 'synth' | 'file' | 'mic';

const extractor = new FeatureExtractor();
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

  try {
    if (next === 'simulated') {
      simulated.playing = true;
      spectrumSource = simulated;
    } else if (next !== 'off') {
      const eng = getEngine();
      await eng.resume();
      playback = next === 'synth' ? synth : next === 'mic' ? new MicInput() : new FileTrack(file!);
      await playback.start(eng);
      spectrumSource = eng;
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

const HINTS: Record<Mode, string> = {
  off: 'Pick a source to get him moving.',
  simulated: 'Fake spectrum data, no sound. Tests the dance logic only.',
  synth: 'A generated beat played for real and analysed live.',
  file: 'Playing your file on loop.',
  mic: 'Listening through the mic. Play music out loud nearby.',
};

function updateControls(file?: File) {
  document.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((b) => {
    b.classList.toggle('active', b.dataset.source === mode);
  });
  if (!hint.textContent?.startsWith("Couldn't")) {
    hint.textContent = mode === 'file' && file ? `Playing “${file.name}” on loop.` : HINTS[mode];
  }
  $('bpm-row').hidden = !(mode === 'simulated' || mode === 'synth');
  $('level-row').hidden = mode !== 'simulated';
  $('volume-row').hidden = !(mode === 'synth' || mode === 'file');
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

// URL shortcuts for quick testing, e.g. ?source=simulated&bpm=128
// (only simulated can autostart; real audio needs a click per browser rules).
const params = new URLSearchParams(location.search);
if (params.get('bpm')) {
  bpmInput.value = params.get('bpm')!;
  bpmInput.dispatchEvent(new Event('input'));
}
if (params.get('source') === 'simulated') void setMode('simulated');

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const beatDot = $('beat-dot');
const meters = { bass: $('m-bass'), mid: $('m-mid'), treble: $('m-treble'), intensity: $('m-intensity') };
const bpmDetected = $('bpm-detected');
const moveLabel = $('move');
let beatFlashUntil = 0;
let ringPulse = 0;
let lastNow = performance.now();

function frame(now: number) {
  const t = now / 1000;
  const dt = Math.max(0, Math.min((now - lastNow) / 1000, 0.1));
  lastNow = now;

  // With no source we feed silence, so he eases back into his idle animation.
  if (spectrumSource) spectrumSource.read(spectrum, t);
  else spectrum.fill(0);
  const features: AudioFeatures = extractor.process(spectrum, spectrumSource?.binHz ?? 23.4375, t);

  const pose = dancer.update(features, dt);
  dancer.apply(guy.rig, pose);

  if (features.isBeat) {
    ringPulse = 0.4 + 0.6 * features.beatStrength;
    beatFlashUntil = now + 90;
  }
  ringPulse *= Math.exp(-dt * 6);
  ring.scale.setScalar(1 + (1 - ringPulse) * 0.25);
  ringMat.opacity = ringPulse * 0.6;

  beatDot.classList.toggle('on', now < beatFlashUntil);
  bpmDetected.textContent = features.bpm ? Math.round(features.bpm).toString() : '–';
  moveLabel.textContent = dancer.intensity > 0.15 ? dancer.currentMove.name : 'Idle';
  meters.bass.style.width = `${features.bass * 100}%`;
  meters.mid.style.width = `${features.mid * 100}%`;
  meters.treble.style.width = `${features.treble * 100}%`;
  meters.intensity.style.width = `${dancer.intensity * 100}%`;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
