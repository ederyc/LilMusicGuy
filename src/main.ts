import * as THREE from 'three';
import { AudioEngine, type PlaybackSource } from './audio/AudioEngine';
import { FeatureExtractor } from './audio/FeatureExtractor';
import { FileTrack } from './audio/sources/FileTrack';
import { MicInput } from './audio/sources/MicInput';
import { SIM_STYLES, SimulatedSource, type SimStyleName } from './audio/sources/SimulatedSource';
import { SimulatedTalk } from './audio/sources/SimulatedTalk';
import { SpeechDetector } from './audio/SpeechDetector';
import { SpeechTap } from './audio/SpeechTap';
import { SynthTrack } from './audio/sources/SynthTrack';
import { SystemAudio } from './audio/sources/SystemAudio';
import { SILENT_FEATURES, type AudioFeatures, type SpectrumSource } from './audio/types';
import { VIBE_NAMES, VibeDetector, type VibeTraits } from './audio/VibeDetector';
import { ACCESSORIES } from './character/accessories';
import { Body } from './character/Body';
import { Dancer, MOVES, type Cue, type Posture } from './character/Dancer';
import { DEFAULT_COLORS, LilGuy, type LilGuyColors, type SlotName } from './character/LilGuy';
import { setOutlineViewport } from './render/toon';
import { ContactShadow } from './scene/ContactShadow';
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
// Neutral keeps the brand colors true and only rolls off the brightest highlights.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);

// A warm key light from upper right does the shading; a soft cool sky/bounce fills the
// shadow side so it stays colorful instead of going grey. (The rim light lives in the
// toon shader, see render/toon.ts.)
scene.add(new THREE.HemisphereLight('#f3efff', '#9d94c8', 1.15));
const sun = new THREE.DirectionalLight('#fff3e6', 2.4);
sun.position.set(2, 3.2, 4.2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -1.5;
sun.shadow.camera.right = sun.shadow.camera.top = 1.5;
sun.shadow.radius = 6;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
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
const contact = new ContactShadow();
scene.add(contact.object);
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
  setOutlineViewport(renderer);
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
const speech = new SpeechDetector();
/** Simulated talking (podcast / video), with or without a background track. */
const TALK_STYLES = { talk: { label: 'Podcast / video (talking)', bed: 0 }, talkbed: { label: 'Video with background music', bed: 0.6 } };
type TalkStyleName = keyof typeof TALK_STYLES;
const simTalk = new SimulatedTalk();
let talkStyle: TalkStyleName | null = null;
/** A reaction cue waiting to be handed to the dancer (from transcribed words). */
let pendingCue: Cue | null = null;
/**
 * Desktop app only, when the user turns on "understand speech": hands audio of people
 * talking to the on-device transcriber. Never runs in a plain browser.
 */
let understandSpeech = desktop && params.get('understand') === '1';
const speechTap = new SpeechTap((samples) => window.lilguy?.hear(samples));
function syncSpeechTap() {
  const want = understandSpeech && !!window.lilguy && !!engine && spectrumSource === engine;
  if (want && !speechTap.running) void speechTap.start(engine!).catch((err) => console.error('speech tap', err));
  else if (!want && speechTap.running) speechTap.stop();
}
const synth = new SynthTrack();
let engine: AudioEngine | null = null;
let playback: PlaybackSource | null = null;
let mode: Mode = 'off';
let spectrumSource: SpectrumSource | null = null;
let spectrum = new Uint8Array(1024);

/** The audio engine, with an output device only if this source plays sound. */
async function getEngine(output: boolean): Promise<AudioEngine> {
  if (engine && engine.output !== output) {
    speechTap.stop();
    engine.close();
    engine = null;
  }
  engine ??= new AudioEngine(output);
  engine.setVolume(Number(volumeInput.value) / 100);
  await engine.resume();
  return engine;
}

/** For the "connected but hearing nothing" check on capture sources. */
let listeningSince = 0;
let heardSomething = false;

async function setMode(next: Mode, file?: File) {
  playback?.stop();
  playback = null;
  spectrumSource = null;
  extractor.reset();
  vibeDetector.reset();
  speech.reset();

  try {
    if (next === 'simulated') {
      simulated.playing = true;
      spectrumSource = talkStyle ? simTalk : simulated;
    } else if (next !== 'off') {
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
      // Capture first, while the click still counts; then the (possibly slow) device.
      // Each step says what it's doing, so if one stalls you can see which.
      const steps = performance.now();
      const say = (text: string) => {
        if (playback !== p) return;
        hint.textContent = text;
        console.info(`[audio] ${text} (${Math.round(performance.now() - steps)} ms)`);
      };
      if (p.acquire) {
        say(
          next === 'system'
            ? 'Waiting for you to pick what to share: choose Entire Screen and turn on "Also share system audio".'
            : 'Waiting for permission to use the input…',
        );
        // Chrome on macOS can hang inside its own system-audio capture after you click
        // Share (seen with Bluetooth headphones). We can't cancel it, but we can say so.
        const stuck = window.setTimeout(
          () =>
            say(
              next === 'system'
                ? "Still waiting on Chrome. If you've already clicked Share, Chrome's system-audio capture is stuck (it happens on Macs, especially with Bluetooth headphones). Try: share a browser tab playing music instead, switch your Mac's output to the built-in speakers, or use the desktop app (npm run desktop), which hears everything."
                : 'Still waiting for the input. Check for a permission prompt.',
            ),
          next === 'system' ? 15000 : 10000,
        );
        try {
          await p.acquire();
        } finally {
          clearTimeout(stuck);
        }
      }
      if (playback !== p) {
        p.stop(); // switched to something else meanwhile
        return;
      }
      say('Got it. Starting the audio engine…');
      const eng = await getEngine(!p.listenOnly);
      say('Connecting…');
      await p.start(eng);
      spectrumSource = eng;
      hint.textContent = '';
      listeningSince = performance.now();
      heardSomething = false;
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
  syncSpeechTap();
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
const talkMeter = $('m-talk');
const deviceSelect = $<HTMLSelectElement>('input-device');

const HINTS: Record<Mode, string> = {
  off: 'Pick a source to get him moving.',
  simulated: 'Fake spectrum data, no sound. Tests the dance logic only.',
  synth: 'A generated beat played for real and analysed live.',
  file: 'Playing your file on loop.',
  mic: 'Listening to the input. Pick a loopback device (like BlackHole) to hear everything your computer plays.',
  system: 'Listening to what you shared. Stop sharing from the browser bar, or press Stop.',
};

/**
 * Capture sources can "work" and still deliver pure silence (macOS permission off, system
 * audio not ticked in the picker). Say so instead of leaving him sitting there.
 */
function checkHearing(now: number) {
  if ((mode !== 'system' && mode !== 'mic') || heardSomething) return;
  if (spectrum.some((v) => v > 0)) {
    heardSomething = true;
    if (hint.textContent?.startsWith('Connected, but')) hint.textContent = HINTS[mode];
    return;
  }
  if (now - listeningSince > 4000 && !hint.textContent?.startsWith('Connected, but')) {
    hint.textContent =
      mode === 'system'
        ? 'Connected, but no sound is coming through. Is music playing? Check that "Also share system audio" was on, and that Chrome is allowed under System Settings → Privacy & Security → Screen & System Audio Recording (then quit and reopen Chrome).'
        : "Connected, but the input is silent. Check the input device and that it's not muted.";
    console.warn('[audio] capture is delivering silence');
  }
}

function updateControls(file?: File) {
  document.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((b) => {
    b.classList.toggle('active', b.dataset.source === mode);
  });
  if (!hint.textContent?.startsWith("Couldn't") && !hint.textContent?.startsWith('Connected, but')) {
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
for (const [name, style] of Object.entries(TALK_STYLES)) styleSelect.add(new Option(style.label, name));
styleSelect.addEventListener('change', () => applyStyle(styleSelect.value as SimStyleName | TalkStyleName));
function applyStyle(name: SimStyleName | TalkStyleName) {
  styleSelect.value = name;
  speech.reset();
  if (name in TALK_STYLES) {
    talkStyle = name as TalkStyleName;
    simTalk.bed = TALK_STYLES[talkStyle].bed;
    if (mode === 'simulated') spectrumSource = simTalk;
    extractor.reset();
    vibeDetector.reset();
    return;
  }
  talkStyle = null;
  if (mode === 'simulated') spectrumSource = simulated;
  simulated.setStyle(name as SimStyleName);
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
const postureSelect = $<HTMLSelectElement>('posture');
for (const [value, label] of [['', 'Auto (follow the music)'], ['stand', 'Stand'], ['sit', 'Sit & vibe'], ['lounge', 'Lounge']]) {
  postureSelect.add(new Option(label, value));
}
postureSelect.addEventListener('change', () => dancer.forcePosture((postureSelect.value || null) as Posture | null));

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
bindRange(levelInput, 'level-out', (v) => {
  simulated.level = v / 100;
  simTalk.level = v / 100;
});
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
if (styleParam && (styleParam in SIM_STYLES || styleParam in TALK_STYLES)) applyStyle(styleParam as SimStyleName | TalkStyleName);
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
const postureParam = params.get('posture');
if (postureParam && ['stand', 'sit', 'lounge'].includes(postureParam)) {
  postureSelect.value = postureParam;
  postureSelect.dispatchEvent(new Event('change'));
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
  } else if (cmd.type === 'understand') {
    understandSpeech = cmd.value;
    syncSpeechTap();
  } else if (cmd.type === 'cue') {
    pendingCue = cmd.value;
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

  const binHz = spectrumSource?.binHz ?? 23.4375;
  const vibe = vibeDetector.process(spectrum, binHz, features);
  const heard = speech.process(spectrum, binHz, t, features.active && !!spectrumSource);
  if (speechTap.running) speechTap.update(heard.talk > 0.6, heard.speaking, dt);
  const pose = dancer.update(features, vibe, dt, { talk: heard.talk, speaking: heard.speaking, cue: pendingCue });
  pendingCue = null;
  body.update(pose, dt);
  body.apply();
  prop.update(features, dt);
  contact.object.visible = !(desktop && prop.id === 'none');
  contact.update(guy.rig, prop.top, prop.frontEdge);
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
  talkMeter.style.width = `${speech.current.talk * 100}%`;
  checkHearing(now);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
