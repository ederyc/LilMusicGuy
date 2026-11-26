import type { SpectrumSource } from '../types';

/**
 * A style of fake music. Patterns are 16 sixteenth-note steps (one bar); levels are 0..1.
 * Each preset is a cartoon of a genre: enough of its fingerprint (tempo, drum pattern,
 * brightness, distortion, bass weight) for the vibe detector to tell them apart.
 */
export interface SimStyle {
  label: string;
  bpm: number;
  level: number;
  kick: number[];
  kickLevel: number;
  snare: number[];
  snareLevel: number;
  hat: number[];
  hatLevel: number;
  /** Mid-range stabs (keys, guitar chops, claps) on these steps. */
  stab: number[];
  stabLevel: number;
  /** Sustained bass tone; `boom` makes it swell on every kick like an 808. */
  bassLevel: number;
  boom: boolean;
  /** Sustained chord tones; `bright` is how slowly their harmonics fall off (0..1). */
  chordLevel: number;
  bright: number;
  /** Broadband noise across the mids and highs, like distorted guitars. */
  wash: number;
  /** The dense, smooth bed of everything else in a mix (reverb, pads, vocals), 0..1. */
  bed: number;
}

const steps = (...s: number[]) => s;
const every = (n: number, offset = 0) => Array.from({ length: 16 / n }, (_, i) => i * n + offset);

export const SIM_STYLES = {
  house: {
    label: 'House',
    bpm: 124, level: 0.85,
    kick: every(4), kickLevel: 0.6,
    snare: steps(4, 12), snareLevel: 0.45,
    hat: every(2), hatLevel: 0.45,
    stab: [], stabLevel: 0,
    bassLevel: 0.35, boom: false,
    chordLevel: 0.3, bright: 0.55,
    wash: 0.05,
    bed: 0.16,
  },
  lofi: {
    label: 'Lo-fi',
    bpm: 82, level: 0.55,
    kick: steps(0, 7, 10), kickLevel: 0.45,
    snare: steps(4, 12), snareLevel: 0.25,
    hat: every(2), hatLevel: 0.12,
    stab: [], stabLevel: 0,
    bassLevel: 0.3, boom: false,
    chordLevel: 0.4, bright: 0.2,
    wash: 0,
    bed: 0.16,
  },
  funk: {
    label: 'Funk',
    bpm: 104, level: 0.75,
    kick: steps(0, 3, 8, 10), kickLevel: 0.55,
    snare: steps(4, 12), snareLevel: 0.4,
    hat: every(1), hatLevel: 0.22,
    stab: steps(1, 3, 6, 9, 11, 14), stabLevel: 0.55,
    bassLevel: 0.35, boom: false,
    chordLevel: 0.2, bright: 0.5,
    wash: 0.02,
    bed: 0.16,
  },
  trap: {
    label: 'Hip-hop / trap',
    bpm: 76, level: 0.8,
    kick: steps(0, 6, 8, 11), kickLevel: 0.65,
    snare: steps(8), snareLevel: 0.5,
    hat: every(1), hatLevel: 0.25,
    stab: [], stabLevel: 0,
    bassLevel: 0.75, boom: true,
    chordLevel: 0.15, bright: 0.3,
    wash: 0,
    bed: 0.16,
  },
  rock: {
    label: 'Rock',
    bpm: 150, level: 0.9,
    kick: steps(0, 8, 10), kickLevel: 0.55,
    snare: steps(4, 12), snareLevel: 0.6,
    hat: every(2), hatLevel: 0.35,
    stab: [], stabLevel: 0,
    bassLevel: 0.3, boom: false,
    chordLevel: 0.15, bright: 0.85,
    wash: 0.55,
    bed: 0.16,
  },
  ballad: {
    label: 'Ballad',
    bpm: 72, level: 0.35,
    kick: [], kickLevel: 0,
    snare: [], snareLevel: 0,
    hat: [], hatLevel: 0,
    stab: [], stabLevel: 0,
    bassLevel: 0.2, boom: false,
    chordLevel: 0.5, bright: 0.35,
    wash: 0,
    bed: 0.16,
  },
} satisfies Record<string, SimStyle>;

export type SimStyleName = keyof typeof SIM_STYLES;

/** Chord tones (Hz) per bar: Am, F, C, G. */
const CHORDS = [
  [220, 261.6, 329.6],
  [174.6, 220, 261.6],
  [261.6, 329.6, 392],
  [196, 246.9, 293.7],
];
const BASS_ROOTS = [55, 43.65, 65.41, 49];

/**
 * Fake "music" with no audio at all: synthesizes spectrum frames from a style preset
 * (drum hits, a bass tone, chord tones with harmonics, distortion noise). Deterministic
 * given a seed, so it powers both the in-app "Simulated" mode and the unit tests.
 */
export class SimulatedSource implements SpectrumSource {
  readonly binCount: number;
  readonly binHz: number;

  bpm: number;
  /** 0..1 loudness multiplier. */
  level: number;
  playing = true;

  private style: SimStyle;
  private rand: () => number;
  private startTime: number | null = null;

  constructor(opts: { sampleRate?: number; fftSize?: number; seed?: number; style?: SimStyleName } = {}) {
    const sampleRate = opts.sampleRate ?? 48000;
    const fftSize = opts.fftSize ?? 2048;
    this.binCount = fftSize / 2;
    this.binHz = sampleRate / fftSize;
    this.rand = mulberry32(opts.seed ?? 1);
    this.style = SIM_STYLES[opts.style ?? 'house'];
    this.bpm = this.style.bpm;
    this.level = this.style.level;
  }

  /** Switch style; also resets tempo and loudness to the style's own. */
  setStyle(name: SimStyleName): void {
    this.style = SIM_STYLES[name];
    this.bpm = this.style.bpm;
    this.level = this.style.level;
  }

  read(out: Uint8Array, time: number): void {
    if (this.startTime === null) this.startTime = time;
    if (!this.playing || this.level <= 0) {
      out.fill(0);
      return;
    }

    const s = this.style;
    const t = time - this.startTime;
    const stepDur = 60 / this.bpm / 4;
    const stepPos = t / stepDur;
    const bar = Math.floor(stepPos / 16);

    // Time since the most recent hit in a pattern, in seconds (Infinity if none).
    const since = (pattern: number[]) => {
      if (!pattern.length) return Infinity;
      const cur = Math.floor(stepPos);
      for (let back = 0; back < 16; back++) {
        const st = cur - back;
        if (pattern.includes(((st % 16) + 16) % 16)) return (stepPos - st) * stepDur;
      }
      return Infinity;
    };
    const kick = s.kickLevel * Math.exp(-since(s.kick) / 0.07);
    const snare = s.snareLevel * Math.exp(-since(s.snare) / 0.09);
    const hat = s.hatLevel * Math.exp(-since(s.hat) / 0.03);
    const stab = s.stabLevel * Math.exp(-since(s.stab) / 0.06);
    const boom = s.boom ? 0.35 + 0.65 * Math.exp(-since(s.kick) / 0.4) : 1;

    const root = BASS_ROOTS[bar % BASS_ROOTS.length];
    const chord = CHORDS[bar % CHORDS.length];
    const width = this.binHz * 1.2;
    const peak = (f: number, at: number) => Math.exp(-(((f - at) / width) ** 2));

    const n = Math.min(out.length, this.binCount);
    for (let i = 0; i < n; i++) {
      const f = i * this.binHz;
      let v = 0.03 + this.rand() * 0.03; // noise floor
      if (f >= 30) {
        // the mix's bed: falls off toward the highs, more slowly in bright styles
        const tilt = 1 - (1 - 0.5 * s.bright) * (Math.log2(Math.max(f, 60) / 60) / 8);
        v += s.bed * Math.max(0, tilt) * (0.9 + 0.1 * this.rand());
        if (f < 150) v += kick;
        // bass tone and its first harmonics
        for (let h = 1; h <= 4; h++) v += (s.bassLevel * boom * peak(f, root * h)) / h;
        // chord tones with harmonics; dark styles lose their upper harmonics fast
        for (const note of chord) {
          let amp = s.chordLevel * 1.5;
          for (let h = 1; h <= 12 && note * h < 12000; h++) {
            v += amp * peak(f, note * h);
            amp *= 0.25 + 0.65 * s.bright;
          }
        }
        if (f > 150 && f < 5000) v += snare * (0.5 + 0.5 * this.rand()) * (1 - f / 6000);
        if (f > 400 && f < 3000) v += stab * (0.6 + 0.4 * this.rand());
        if (f > 6000 && f < 14000) v += hat * (0.6 + 0.4 * this.rand());
        if (f > 200 && f < 10000) v += s.wash * (0.92 + 0.08 * this.rand()) * (1 - f / 14000);
      }
      v *= this.level;
      out[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    for (let i = n; i < out.length; i++) out[i] = 0;
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
