import type { AudioFeatures } from './types';

const BASS: [number, number] = [30, 180];
const MID: [number, number] = [180, 2000];
const TREBLE: [number, number] = [2000, 12000];

/** Seconds of onset history used for the adaptive beat threshold. */
const HISTORY_SECONDS = 1.0;
/** Minimum time between beats (caps detection at 240 BPM). */
const MIN_BEAT_GAP = 0.25;
/** Onset must exceed mean + K * stddev of recent history... */
const THRESHOLD_K = 1.5;
/** ...and at least this much absolute flux (filters noise floor). */
const MIN_FLUX = 0.04;
/** Tempo range we fold detected intervals into. */
const MIN_BPM = 70;
const MAX_BPM = 180;
/** Energy below this counts as silence. */
const SILENCE_ENERGY = 0.03;
/** How long without sound before we call it "stopped". */
const SILENCE_HOLD = 1.5;

/**
 * Turns raw spectrum frames into musical features: band levels, beat onsets,
 * tempo, and a smooth beat clock.
 *
 * Beat detection uses spectral flux in the bass band (how much the low end
 * *increased* since last frame) against an adaptive threshold. That reacts to
 * kick drums while ignoring sustained bass lines.
 *
 * Pure logic, no Web Audio dependency, so it is unit-testable.
 */
export class FeatureExtractor {
  private prevSpectrum: Float32Array | null = null;
  private fluxHistory: { t: number; v: number }[] = [];
  private beatTimes: number[] = [];
  private lastBeatTime = -Infinity;
  private lastTime: number | null = null;
  private lastLoudTime = -Infinity;
  private bpm = 0;
  private clock = 0;
  private smooth = { energy: 0, bass: 0, mid: 0, treble: 0 };

  reset(): void {
    this.prevSpectrum = null;
    this.fluxHistory = [];
    this.beatTimes = [];
    this.lastBeatTime = -Infinity;
    this.lastTime = null;
    this.lastLoudTime = -Infinity;
    this.bpm = 0;
    this.clock = 0;
    this.smooth = { energy: 0, bass: 0, mid: 0, treble: 0 };
  }

  process(spectrum: Uint8Array, binHz: number, time: number): AudioFeatures {
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(time - this.lastTime, 0.1));
    this.lastTime = time;

    const bass = bandAverage(spectrum, binHz, BASS);
    const mid = bandAverage(spectrum, binHz, MID);
    const treble = bandAverage(spectrum, binHz, TREBLE);
    const energy = bandAverage(spectrum, binHz, [BASS[0], TREBLE[1]]);

    // --- Onset (beat) detection -------------------------------------------
    const flux = this.bassFlux(spectrum, binHz);

    const history = this.fluxHistory;
    while (history.length && time - history[0].t > HISTORY_SECONDS) history.shift();

    let isBeat = false;
    let beatStrength = 0;
    if (history.length >= 10) {
      let mean = 0;
      for (const h of history) mean += h.v;
      mean /= history.length;
      let variance = 0;
      for (const h of history) variance += (h.v - mean) ** 2;
      const std = Math.sqrt(variance / history.length);
      const threshold = Math.max(MIN_FLUX, mean + THRESHOLD_K * std);

      if (flux > threshold && time - this.lastBeatTime > MIN_BEAT_GAP) {
        isBeat = true;
        beatStrength = clamp01((flux - threshold) / (threshold + 0.05) + 0.3);
        this.registerBeat(time);
      }
    }
    history.push({ t: time, v: flux });

    // --- Beat clock ---------------------------------------------------------
    if (this.bpm > 0) this.clock += (dt * this.bpm) / 60;
    if (isBeat) {
      if (this.bpm > 0) {
        // Phase-lock: pull the clock halfway toward the nearest whole beat.
        const error = this.clock - Math.round(this.clock);
        this.clock -= error * 0.5;
      } else {
        this.clock = Math.floor(this.clock) + 1;
      }
    }

    // --- Activity / silence -------------------------------------------------
    if (energy > SILENCE_ENERGY) this.lastLoudTime = time;
    const active = time - this.lastLoudTime < SILENCE_HOLD;
    if (!active && time - this.lastLoudTime > 3) {
      // Long silence: forget tempo so the next song starts fresh.
      this.beatTimes = [];
      this.bpm = 0;
    }

    // --- Smoothed levels for visuals ---------------------------------------
    const k = dt === 0 ? 1 : 1 - Math.exp(-dt * 12);
    this.smooth.energy += (energy - this.smooth.energy) * k;
    this.smooth.bass += (bass - this.smooth.bass) * k;
    this.smooth.mid += (mid - this.smooth.mid) * k;
    this.smooth.treble += (treble - this.smooth.treble) * k;

    return {
      time,
      ...this.smooth,
      isBeat,
      beatStrength,
      bpm: this.bpm,
      beat: this.clock,
      active,
    };
  }

  private bassFlux(spectrum: Uint8Array, binHz: number): number {
    const lo = Math.max(1, Math.floor(BASS[0] / binHz));
    const hi = Math.min(spectrum.length - 1, Math.ceil(BASS[1] / binHz));
    if (!this.prevSpectrum || this.prevSpectrum.length !== spectrum.length) {
      this.prevSpectrum = new Float32Array(spectrum.length);
      for (let i = 0; i < spectrum.length; i++) this.prevSpectrum[i] = spectrum[i];
      return 0;
    }
    let sum = 0;
    for (let i = lo; i <= hi; i++) {
      const d = spectrum[i] - this.prevSpectrum[i];
      if (d > 0) sum += d;
    }
    for (let i = 0; i < spectrum.length; i++) this.prevSpectrum[i] = spectrum[i];
    return sum / 255 / (hi - lo + 1);
  }

  private registerBeat(time: number): void {
    this.lastBeatTime = time;
    this.beatTimes.push(time);
    if (this.beatTimes.length > 16) this.beatTimes.shift();

    const intervals: number[] = [];
    for (let i = 1; i < this.beatTimes.length; i++) {
      let iv = this.beatTimes[i] - this.beatTimes[i - 1];
      if (iv <= 0 || iv > 2) continue;
      // Fold into the preferred tempo range (handles missed / doubled beats).
      while (iv < 60 / MAX_BPM) iv *= 2;
      while (iv > 60 / MIN_BPM) iv /= 2;
      intervals.push(iv);
    }
    if (intervals.length < 3) return;

    const estimate = 60 / median(intervals);
    this.bpm = this.bpm === 0 ? estimate : this.bpm + (estimate - this.bpm) * 0.3;
  }
}

function bandAverage(spectrum: Uint8Array, binHz: number, [fLo, fHi]: [number, number]): number {
  const lo = Math.max(0, Math.floor(fLo / binHz));
  const hi = Math.min(spectrum.length - 1, Math.ceil(fHi / binHz));
  if (hi < lo) return 0;
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += spectrum[i];
  return sum / 255 / (hi - lo + 1);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
