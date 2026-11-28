import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const RATE = 48000;

/**
 * Offline copy of the Web Audio AnalyserNode (fftSize 2048, smoothing 0.2, -100..-30 dB),
 * so tests can feed real audio through the same byte spectra the app sees.
 * Calls `frame(bytes, time)` at 60 fps.
 */
export function analyse(pcm: Float32Array, frame: (bytes: Uint8Array, time: number) => void, fftSize = 2048, smoothing = 0.2) {
  const n = fftSize;
  const win = new Float32Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n);
  const smoothed = new Float32Array(n / 2);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const bytes = new Uint8Array(n / 2);
  const hop = RATE / 60;
  for (let f = 0; Math.round(f * hop) + n <= pcm.length; f++) {
    const start = Math.round(f * hop);
    const end = start + n;
    for (let i = 0; i < n; i++) {
      re[i] = pcm[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < n / 2; k++) {
      const mag = Math.hypot(re[k], im[k]) / n;
      smoothed[k] = smoothing * smoothed[k] + (1 - smoothing) * mag;
      const db = 20 * Math.log10(smoothed[k] + 1e-12);
      bytes[k] = Math.max(0, Math.min(255, Math.floor((255 / 70) * (db + 100))));
    }
    frame(bytes, end / RATE);
  }
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/** Speech from the macOS `say` command (null where it isn't available). */
export function sayPcm(text: string, voice?: string): Float32Array | null {
  if (process.platform !== 'darwin') return null;
  const dir = mkdtempSync(join(tmpdir(), 'lmg-say-'));
  try {
    const file = join(dir, 'speech.wav');
    const args = ['-o', file, '--file-format=WAVE', `--data-format=LEI16@${RATE}`];
    if (voice) args.push('-v', voice);
    execFileSync('say', [...args, text]);
    return readWav16(readFileSync(file));
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readWav16(buf: Buffer): Float32Array {
  let off = 12;
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      const out = new Float32Array(size / 2);
      for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(off + 8 + i * 2) / 32768;
      return out;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

/** Seeded noise. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

export interface SongOptions {
  seconds: number;
  bpm?: number;
  drums?: boolean;
  /** Sustained sung melody on top. */
  vocals?: boolean;
  /** Piano-like decaying chords instead of sustained pads. */
  piano?: boolean;
  gain?: number;
}

/** Synthesized music: kick/snare/hats, bass, chords, optional sung melody. */
export function songPcm(o: SongOptions): Float32Array {
  const bpm = o.bpm ?? 110;
  const beat = 60 / bpm;
  const out = new Float32Array(Math.round(o.seconds * RATE));
  const noise = rng(3);
  const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [261.6, 329.6, 392], [196, 246.9, 293.7]];
  const roots = [55, 43.65, 65.41, 49];
  const melody = [440, 392, 349.2, 392, 523.3, 493.9, 440, 392];
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const b = t / beat;
    const bar = Math.floor(b / 4) % 4;
    const tb = (b % 1) * beat; // seconds since the beat
    let v = 0;
    if (o.drums !== false) {
      v += 0.6 * Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-tb * 30)) * tb) * Math.exp(-tb * 9); // kick every beat
      const off = Math.floor(b) % 2 === 1 ? Math.exp(-tb * 18) : 0;
      v += 0.25 * noise() * off; // snare on 2 and 4
      const th = ((b * 2) % 1) * (beat / 2);
      v += 0.06 * noise() * Math.exp(-th * 60); // hats on eighths
    }
    const root = roots[bar];
    for (let h = 1; h <= 4; h++) v += (0.18 / h) * Math.sin(2 * Math.PI * root * h * t);
    const chordEnv = o.piano ? Math.exp(-((b % 2) * beat) * 1.8) : 1;
    for (const f of chords[bar]) for (let h = 1; h <= 5; h++) v += ((0.06 * chordEnv) / h ** 1.3) * Math.sin(2 * Math.PI * f * h * t);
    if (o.vocals) {
      const note = melody[Math.floor(b / 2) % melody.length];
      const f0 = note / 2 * (1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t)); // vibrato
      const phraseOn = (b % 16) < 14 ? 1 : 0; // a breath every 4 bars
      for (let h = 1; h <= 10; h++) {
        const fh = f0 * h;
        const form = Math.exp(-(((fh - 700) / 300) ** 2)) + 0.6 * Math.exp(-(((fh - 1800) / 500) ** 2)) + 0.1;
        v += 0.12 * phraseOn * form * Math.sin(2 * Math.PI * fh * t) / h ** 0.5;
      }
    }
    out[i] = v * (o.gain ?? 0.5);
  }
  return out;
}

export function mix(a: Float32Array, b: Float32Array, gainB: number): Float32Array {
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) + gainB * (b[i] ?? 0);
  return out;
}
