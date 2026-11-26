import type { AudioFeatures } from './types';

export type VibeName = 'mellow' | 'chill' | 'groovy' | 'bouncy' | 'hype' | 'headbang';
export const VIBE_NAMES: VibeName[] = ['mellow', 'chill', 'groovy', 'bouncy', 'hype', 'headbang'];

/** What the detector hears, each 0..1, smoothed over the last several seconds. */
export interface VibeTraits {
  /** Calm → hype: loudness, tempo and how busy the sound is. */
  energy: number;
  /** How clear and strong the beat is. */
  punch: number;
  /** How much of the sound is bass. */
  bass: number;
  /** Where the sound sits: dark and warm (0) → bright and crisp (1). */
  bright: number;
  /** Clean tones (0) → noisy, distorted wash (1). */
  noisy: number;
  /** How much the mids hit off the beat (syncopation). */
  swing: number;
  /** Tempo, 70 → 180 BPM mapped to 0..1. */
  tempo: number;
}

export interface Vibe {
  /** The vibe he's committed to, or null before the first song / after a long silence. */
  name: VibeName | null;
  /** The runner-up, for mixing in a few of its moves. */
  next: VibeName | null;
  /** 0..0.5: how close the runner-up is (0.5 = a tie). */
  blend: number;
  /** 0..1: how clearly the committed vibe beats the runner-up. */
  confidence: number;
  /** True for the first few seconds of a song, while he's still making up his mind. */
  listening: boolean;
  /** This moment's best guess (may not be committed yet). */
  candidate: VibeName | null;
  traits: VibeTraits;
}

/**
 * Where each vibe sits among the traits. Tuned against the SimulatedSource styles
 * (see tests/VibeDetector.test.ts); real music will want tuning from the test bench readout.
 */
export const VIBE_PROTOTYPES: Record<VibeName, VibeTraits> = {
  mellow:   { energy: 0.12, punch: 0.05, bass: 0.45, bright: 0.4,  noisy: 0.5,  swing: 0.1,  tempo: 0.2 },
  chill:    { energy: 0.22, punch: 0.7,  bass: 0.55, bright: 0.45, noisy: 0.35, swing: 0.5,  tempo: 0.25 },
  groovy:   { energy: 0.35, punch: 0.3,  bass: 0.55, bright: 0.65, noisy: 0.75, swing: 0.9,  tempo: 0.4 },
  bouncy:   { energy: 0.32, punch: 0.5,  bass: 0.9,  bright: 0.65, noisy: 0.85, swing: 0.6,  tempo: 0.35 },
  hype:     { energy: 0.45, punch: 0.95, bass: 0.6,  bright: 0.6,  noisy: 0.3,  swing: 0.2,  tempo: 0.5 },
  headbang: { energy: 0.75, punch: 0.9,  bass: 0.15, bright: 0.85, noisy: 0.7,  swing: 0.25, tempo: 0.75 },
};

/** How much each trait counts when comparing against the prototypes. */
const WEIGHTS: VibeTraits = { energy: 1.4, punch: 1.1, bass: 1.2, bright: 0.9, noisy: 1, swing: 0.6, tempo: 0.6 };

/** Seconds of sound before he commits to a first vibe... */
const MIN_LISTEN = 3.5;
/** ...unless the tempo still isn't known, in which case he waits up to this long. */
const MAX_LISTEN = 8;
/** What tempo and swing read as when there's no beat to measure them by. */
const NO_BEAT = { tempo: 0.15, swing: 0.1 };
/** A different vibe has to be the best guess for this long before he switches. */
const SWITCH_HOLD = 5;
/** Silence this long means the song is over: forget the vibe. */
const FORGET_AFTER = 3;
/** Time constant of the trait averages. */
const SMOOTH_SECONDS = 3;

/** Raw measurement ranges mapped onto 0..1 traits. */
const BRIGHT_RANGE = [Math.log2(400), Math.log2(3000)];
const CONTRAST_RANGE = [8, 22]; // dB: below 8 reads fully noisy, above 22 fully clean
const BASS_RANGE = [0.5, 0.85];

const BASS = [30, 180];
const MID = [180, 2000];
const SPECTRAL = [150, 12000];
const CONTRAST_BANDS = [[250, 500], [500, 1000], [1000, 2000], [2000, 4000], [4000, 8000]];

/**
 * Listens for the *feel* of the music rather than just the beat. Each frame it measures a
 * few traits from the spectrum and the beat features, smooths them over a few seconds,
 * and picks the vibe whose prototype is nearest. To keep him from flip-flopping it waits
 * a few seconds at the start of a song ("listening"), then only switches when a new vibe
 * has been the clear best guess for a while.
 *
 * Pure logic, no Web Audio dependency, so it is unit-testable.
 */
export class VibeDetector {
  private traits: VibeTraits = blankTraits();
  private prev: Float32Array | null = null;
  private lastTime: number | null = null;
  private soundSince: number | null = null;
  private silentSince: number | null = null;
  private committed: VibeName | null = null;
  private challenger: VibeName | null = null;
  private challengerSince = 0;
  private beats: { t: number; s: number }[] = [];
  /** Mid-band onset energy per sixteenth of the beat (on, e, and, a). */
  private phaseBins = [0, 0, 0, 0];
  private warm = false;
  private tempoSince: number | null = null;
  private tempoRef = 0;
  /** Last frame's raw measurements, before mapping to 0..1 (for tuning). */
  raw: ReturnType<VibeDetector['measure']> | null = null;

  reset(): void {
    this.traits = blankTraits();
    this.prev = null;
    this.lastTime = null;
    this.soundSince = null;
    this.silentSince = null;
    this.committed = null;
    this.challenger = null;
    this.beats = [];
    this.phaseBins = [0, 0, 0, 0];
    this.warm = false;
    this.tempoSince = null;
    this.tempoRef = 0;
  }

  process(spectrum: Uint8Array, binHz: number, f: AudioFeatures): Vibe {
    const t = f.time;
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(t - this.lastTime, 0.1));
    this.lastTime = t;

    // --- song boundaries ----------------------------------------------------
    if (f.active) {
      this.silentSince = null;
      this.soundSince ??= t;
    } else {
      this.silentSince ??= t;
      if (t - this.silentSince > FORGET_AFTER) {
        const keep = this.lastTime;
        this.reset();
        this.lastTime = keep;
      }
      this.prev = null;
      return this.result(null, null, false);
    }

    // --- per-frame measurements ---------------------------------------------
    const m = this.measure(spectrum, binHz);
    this.raw = m;

    if (f.isBeat) this.beats.push({ t, s: f.beatStrength });
    while (this.beats.length && t - this.beats[0].t > 8) this.beats.shift();

    // A beat counts as alive if one was heard recently. Without one, tempo and syncopation
    // are leftovers from the last song (the extractor keeps its tempo until silence).
    const beatAlive = f.bpm > 0 && this.beats.length > 0 && t - this.beats[this.beats.length - 1].t < 3;
    // The tempo is steady once it has stayed within 3% for a moment.
    if (!beatAlive) {
      this.tempoRef = 0;
      this.tempoSince = null;
    } else if (Math.abs(f.bpm - this.tempoRef) > this.tempoRef * 0.03) {
      this.tempoRef = f.bpm;
      this.tempoSince = t;
    }
    const tempoSteady = this.tempoSince !== null && t - this.tempoSince > 1.5;

    // Average quickly while listening so the first guess is a good one, slowly after.
    const tau = this.committed === null ? SMOOTH_SECONDS / 2 : SMOOTH_SECONDS;
    const k = dt === 0 ? 0 : 1 - Math.exp(-dt / tau);
    const fast = dt === 0 ? 0 : 1 - Math.exp(-dt / 0.5);

    // Where in the beat the mids hit only means something once the tempo is steady;
    // readings from before that are thrown away.
    if (!tempoSteady) {
      this.phaseBins.fill(0);
    } else {
      const phase = f.beat - Math.floor(f.beat);
      const bin = Math.floor(((phase + 0.125) % 1) * 4);
      for (let i = 0; i < 4; i++) this.phaseBins[i] *= 1 - fast * 0.1;
      this.phaseBins[bin] += m.midFlux;
    }

    const drive = clamp01(f.energy * 2.5);
    const tempo = beatAlive ? clamp01((f.bpm - 70) / 110) : NO_BEAT.tempo;
    const busy = clamp01(m.flux * 18);
    const target: VibeTraits = {
      energy: clamp01(0.55 * drive + 0.25 * tempo + 0.2 * busy),
      punch: this.punch(t, f.bpm),
      // half how bass-heavy the balance is, half how much bass there actually is
      bass: 0.5 * clamp01((m.bassShare - BASS_RANGE[0]) / (BASS_RANGE[1] - BASS_RANGE[0])) + 0.5 * clamp01(f.bass * 2),
      bright: clamp01((m.centroid - BRIGHT_RANGE[0]) / (BRIGHT_RANGE[1] - BRIGHT_RANGE[0])),
      noisy: clamp01((CONTRAST_RANGE[1] - m.contrast) / (CONTRAST_RANGE[1] - CONTRAST_RANGE[0])),
      swing: tempoSteady ? this.swing() : beatAlive ? this.traits.swing : NO_BEAT.swing,
      tempo,
    };

    if (!this.warm) {
      this.traits = target; // first frame of a song: start from what we hear
      this.warm = true;
    } else {
      for (const key of Object.keys(target) as (keyof VibeTraits)[]) {
        this.traits[key] += (target[key] - this.traits[key]) * k;
      }
    }

    // --- decide -------------------------------------------------------------
    const ranked = rank(this.traits);
    const best = ranked[0];
    const heard = t - (this.soundSince ?? t);
    // Commit once he's heard enough and the beat (if there is one) has been steady a moment.
    const listening = this.committed === null && heard < MAX_LISTEN && (heard < MIN_LISTEN || !tempoSteady);

    if (!listening) {
      if (this.committed === null) {
        this.committed = best.name;
      } else if (best.name !== this.committed) {
        if (this.challenger !== best.name) {
          this.challenger = best.name;
          this.challengerSince = t;
        } else if (t - this.challengerSince > SWITCH_HOLD) {
          this.committed = best.name;
          this.challenger = null;
        }
      } else {
        this.challenger = null;
      }
    }

    return this.result(best.name, ranked, listening);
  }

  private result(candidate: VibeName | null, ranked: Ranked[] | null, listening: boolean): Vibe {
    let next: VibeName | null = null;
    let blend = 0;
    let confidence = 0;
    if (ranked && this.committed) {
      const mine = ranked.find((r) => r.name === this.committed)!;
      const other = ranked.find((r) => r.name !== this.committed)!;
      next = other.name;
      const gap = other.d - mine.d;
      confidence = clamp01(gap / 0.15);
      blend = 0.5 * clamp01(1 - gap / 0.12);
    }
    return { name: this.committed, next, blend, confidence, listening, candidate, traits: { ...this.traits } };
  }

  /**
   * Spectrum stats for this frame. The analyser's bytes are already in decibels, which is
   * what these want: brightness and contrast are judged on the dB picture, like an ear would.
   */
  private measure(spectrum: Uint8Array, binHz: number) {
    const n = spectrum.length;
    const prev = this.prev && this.prev.length === n ? this.prev : null;
    const bin = (hz: number) => Math.max(1, Math.min(n - 1, Math.round(hz / binHz)));

    let bass = 0, bassCount = 0, all = 0, allCount = 0, flux = 0, midFlux = 0, midCount = 0;
    for (let i = 1; i < n; i++) {
      const f = i * binHz;
      const b = spectrum[i] / 255;
      const inRange = f >= BASS[0] && f < SPECTRAL[1];
      if (inRange) {
        all += b;
        allCount++;
        if (f < BASS[1]) {
          bass += b;
          bassCount++;
        }
      }
      if (f >= MID[0] && f < MID[1]) midCount++;
      if (prev) {
        const d = b - prev[i];
        if (d > 0 && inRange) flux += d;
        if (d > 0 && f >= MID[0] && f < MID[1]) midFlux += d;
      }
    }
    if (!this.prev || this.prev.length !== n) this.prev = new Float32Array(n);
    for (let i = 0; i < n; i++) this.prev[i] = spectrum[i] / 255;

    // Brightness: where the sound sits above its own noise floor, on a log-frequency scale.
    const lo = bin(SPECTRAL[0]), hi = bin(SPECTRAL[1]);
    const floor = quantile(spectrum, lo, hi, 0.2);
    let w = 0, wlog = 0;
    for (let i = lo; i <= hi; i++) {
      const x = spectrum[i] - floor;
      if (x > 0) {
        w += x;
        wlog += x * Math.log2(i * binHz);
      }
    }

    // Spectral contrast: peaks vs valleys in each octave, in dB. Clean tones stand far above
    // the gaps between them; distortion and noise fill the gaps in.
    let cSum = 0, cW = 0;
    for (const [fLo, fHi] of CONTRAST_BANDS) {
      const a = bin(fLo), z = bin(fHi);
      const top = topMean(spectrum, a, z, 3);
      const bottom = quantile(spectrum, a, z, 0.2);
      // octaves with nothing in them aren't "noisy", just empty: weigh by how loud they are
      const weight = Math.max(0, top - floor) ** 2;
      cSum += ((top - bottom) / 255) * 70 * weight;
      cW += weight;
    }

    const bassAvg = bassCount ? bass / bassCount : 0;
    const allAvg = allCount ? all / allCount : 0;
    return {
      /** log2(Hz) of the spectral centroid above the floor */
      centroid: w > 0 ? wlog / w : Math.log2(1000),
      /** dB between peaks and valleys, averaged over octaves */
      contrast: cW > 0 ? cSum / cW : 0,
      /** bass level relative to the whole spectrum: 0.5 = no louder than average */
      bassShare: bassAvg + allAvg > 0 ? bassAvg / (bassAvg + allAvg) : 0,
      flux: allCount ? flux / allCount : 0,
      midFlux: midCount ? midFlux / midCount : 0,
    };
  }

  /** Beat clarity: strong detected beats arriving where the tempo says they should. */
  private punch(t: number, bpm: number): number {
    if (this.beats.length < 3 || bpm === 0) return 0;
    const period = 60 / bpm;
    let onGrid = 0;
    for (let i = 1; i < this.beats.length; i++) {
      const iv = (this.beats[i].t - this.beats[i - 1].t) / period;
      if (Math.abs(iv - Math.round(iv)) < 0.15 && Math.round(iv) >= 1) onGrid++;
    }
    const regular = onGrid / (this.beats.length - 1);
    const strength = this.beats.reduce((a, b) => a + b.s, 0) / this.beats.length;
    const span = Math.min(8, t - this.beats[0].t + period);
    const coverage = clamp01(this.beats.length / (span / period) / 0.6);
    return clamp01(regular * coverage * (0.4 + 0.8 * strength));
  }

  /** Syncopation: share of mid-band hits landing on the "e" and "a" sixteenths. */
  private swing(): number {
    const [on, e, and, a] = this.phaseBins;
    const total = on + e + and + a;
    if (total < 1e-3) return this.traits.swing;
    return clamp01(((e + a) / total - 0.2) / 0.3);
  }
}

interface Ranked {
  name: VibeName;
  d: number;
}

/** Vibes sorted nearest first, by weighted distance to each prototype. */
export function rank(traits: VibeTraits): Ranked[] {
  let wsum = 0;
  for (const w of Object.values(WEIGHTS)) wsum += w;
  return VIBE_NAMES.map((name) => {
    const p = VIBE_PROTOTYPES[name];
    let d = 0;
    for (const key of Object.keys(WEIGHTS) as (keyof VibeTraits)[]) {
      d += WEIGHTS[key] * (traits[key] - p[key]) ** 2;
    }
    return { name, d: Math.sqrt(d / wsum) };
  }).sort((a, b) => a.d - b.d);
}

/** The q-quantile (0..1) of spectrum[lo..hi]. */
function quantile(spectrum: Uint8Array, lo: number, hi: number, q: number): number {
  const part = Array.from(spectrum.subarray(lo, hi + 1)).sort((a, b) => a - b);
  return part.length ? part[Math.min(part.length - 1, Math.floor(q * part.length))] : 0;
}

/** Mean of the k largest values in spectrum[lo..hi]. */
function topMean(spectrum: Uint8Array, lo: number, hi: number, k: number): number {
  const part = Array.from(spectrum.subarray(lo, hi + 1)).sort((a, b) => b - a).slice(0, k);
  return part.length ? part.reduce((a, b) => a + b, 0) / part.length : 0;
}

function blankTraits(): VibeTraits {
  return { energy: 0, punch: 0, bass: 0, bright: 0, noisy: 0, swing: 0, tempo: 0.3 };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
