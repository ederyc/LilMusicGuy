import type { SpectrumSource } from '../types';

/**
 * Fake "podcast": spectrum frames of a voice talking, with no audio. Syllables (~4–5 a
 * second) have a gliding pitch with harmonics shaped by two formants; words come in
 * phrases with short pauses between them and longer ones between sentences. Optionally
 * a quiet music bed underneath, like a video's background track.
 */
export class SimulatedTalk implements SpectrumSource {
  readonly binCount: number;
  readonly binHz: number;
  level = 0.8;
  /** 0..1 background music under the voice. */
  bed = 0;

  private rand: () => number;
  private startTime: number | null = null;
  /** Precomputed timeline of syllables: [start, end, pitch, f1, f2]. */
  private syllables: [number, number, number, number, number][] = [];
  private cursor = 0;

  constructor(opts: { sampleRate?: number; fftSize?: number; seed?: number; bed?: number } = {}) {
    const fftSize = opts.fftSize ?? 2048;
    this.binCount = fftSize / 2;
    this.binHz = (opts.sampleRate ?? 48000) / fftSize;
    this.rand = mulberry32(opts.seed ?? 7);
    this.bed = opts.bed ?? 0;
  }

  /** Extend the timeline of syllables up to `until` seconds. */
  private plan(until: number): void {
    let t = this.syllables.length ? this.syllables[this.syllables.length - 1][1] : 0.3;
    const r = this.rand;
    while (t < until) {
      // a phrase: 4–12 syllables, then a pause
      const n = 4 + Math.floor(r() * 9);
      const basePitch = 105 + r() * 60;
      for (let i = 0; i < n; i++) {
        const len = 0.11 + r() * 0.13;
        const vowel = r();
        this.syllables.push([t, t + len, basePitch * (0.9 + 0.25 * r()), 450 + 350 * vowel, 1100 + 1200 * (1 - vowel) * r() + 300]);
        t += len + (r() < 0.25 ? 0.08 + r() * 0.12 : 0.02 + r() * 0.04); // the odd gap between words
      }
      t += r() < 0.3 ? 0.6 + r() * 0.6 : 0.25 + r() * 0.3; // between sentences / phrases
    }
  }

  read(out: Uint8Array, time: number): void {
    if (this.startTime === null) this.startTime = time;
    const t = time - this.startTime;
    this.plan(t + 2);
    while (this.cursor < this.syllables.length - 1 && this.syllables[this.cursor][1] < t - 0.1) this.cursor++;

    // Envelope of the current syllable (attack/decay), 0 in pauses.
    let amp = 0;
    let pitch = 120;
    let f1 = 600;
    let f2 = 1500;
    for (let k = this.cursor; k < Math.min(this.syllables.length, this.cursor + 3); k++) {
      const [a, b, p, F1, F2] = this.syllables[k];
      if (t >= a && t <= b) {
        const u = (t - a) / (b - a);
        amp = Math.sin(Math.PI * u) ** 0.6;
        pitch = p * (1.05 - 0.1 * u); // falls a little through the syllable
        f1 = F1;
        f2 = F2;
      }
    }

    const width = this.binHz * 1.3;
    const n = Math.min(out.length, this.binCount);
    for (let i = 0; i < n; i++) {
      const f = i * this.binHz;
      let v = 0.0015 + this.rand() * 0.001; // room noise
      if (amp > 0 && f > 80) {
        // harmonics of the pitch, shaped by two formants and a gentle roll-off
        const h = f / pitch;
        const nearest = Math.round(h);
        const harmonic = nearest >= 1 ? Math.exp(-(((f - nearest * pitch) / width) ** 2)) : 0;
        const formants = Math.exp(-(((f - f1) / 260) ** 2)) + 0.7 * Math.exp(-(((f - f2) / 380) ** 2)) + 0.12;
        const rolloff = 1 / (1 + f / 4000);
        v += amp * (0.85 * harmonic + 0.04) * formants * rolloff;
        // breathy/fricative noise in the highs
        if (f > 2500 && f < 8000) v += amp * 0.08 * this.rand();
      }
      if (this.bed > 0 && f > 35) v += this.bed * 0.05 * Math.max(0, 1 - Math.log2(Math.max(f, 40) / 40) / 9);
      v *= this.level;
      // Like a real analyser: bytes are decibels (-70..0 dB here), not linear amplitude.
      out[i] = Math.max(0, Math.min(255, Math.round((255 * (20 * Math.log10(v + 1e-6) + 70)) / 70)));
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
