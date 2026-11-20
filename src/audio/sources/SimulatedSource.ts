import type { SpectrumSource } from '../types';

/**
 * Fake "music" with no audio at all: synthesizes spectrum frames that look
 * like a four-on-the-floor track (kick every beat, snare on 2 & 4, hi-hats on
 * eighths, sustained bassline). Deterministic given a seed, so it powers both
 * the in-app "Simulated" mode and the unit tests.
 */
export class SimulatedSource implements SpectrumSource {
  readonly binCount: number;
  readonly binHz: number;

  bpm = 120;
  /** 0..1 loudness multiplier. */
  level = 0.8;
  playing = true;

  private rand: () => number;
  private startTime: number | null = null;

  constructor(opts: { sampleRate?: number; fftSize?: number; seed?: number } = {}) {
    const sampleRate = opts.sampleRate ?? 48000;
    const fftSize = opts.fftSize ?? 2048;
    this.binCount = fftSize / 2;
    this.binHz = sampleRate / fftSize;
    this.rand = mulberry32(opts.seed ?? 1);
  }

  read(out: Uint8Array, time: number): void {
    if (this.startTime === null) this.startTime = time;
    if (!this.playing || this.level <= 0) {
      out.fill(0);
      return;
    }

    const t = time - this.startTime;
    const period = 60 / this.bpm;
    const beatPos = t / period;
    const beatIndex = Math.floor(beatPos);
    const sinceBeat = (beatPos - beatIndex) * period;
    const eighthPos = beatPos * 2;
    const sinceEighth = (eighthPos - Math.floor(eighthPos)) * (period / 2);

    const kick = Math.exp(-sinceBeat / 0.07);
    const snare = beatIndex % 2 === 1 ? Math.exp(-sinceBeat / 0.09) : 0;
    const hat = Math.exp(-sinceEighth / 0.03);
    const bassline = 0.5 + 0.1 * Math.sin(t * 2);

    const n = Math.min(out.length, this.binCount);
    for (let i = 0; i < n; i++) {
      const f = i * this.binHz;
      let v: number;
      if (f < 30) v = 0;
      else if (f < 180) v = 0.45 * bassline + 0.55 * kick;
      else if (f < 2000) v = (0.25 + 0.5 * snare) * (1 - f / 4000);
      else if (f < 12000) v = 0.12 + 0.45 * hat + 0.25 * snare;
      else v = 0.02;
      v = v * this.level + (this.rand() - 0.5) * 0.06;
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
