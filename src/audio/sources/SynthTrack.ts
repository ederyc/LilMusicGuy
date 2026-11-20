import type { AudioEngine, PlaybackSource } from '../AudioEngine';

const LOOKAHEAD = 0.12; // seconds of audio scheduled ahead
const TICK_MS = 25;

/** Bass roots per bar (Am – F – C – G). */
const ROOTS = [55.0, 43.65, 65.41, 49.0];
/** Arpeggio intervals in semitones over the root. */
const ARP = [12, 19, 24, 19];

/**
 * A tiny procedurally-generated house loop played through Web Audio. Unlike
 * SimulatedSource this makes real sound and goes through the real analyser,
 * so it tests the full pipeline end-to-end without needing any music files.
 */
export class SynthTrack implements PlaybackSource {
  bpm = 120;

  private ctx!: AudioContext;
  private out!: GainNode;
  private noise!: AudioBuffer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;

  async start(engine: AudioEngine): Promise<void> {
    this.ctx = engine.ctx;
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.7;
    this.out.connect(engine.input);
    this.noise = makeNoise(this.ctx);
    this.nextTime = this.ctx.currentTime + 0.05;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.out) {
      const out = this.out;
      out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
      setTimeout(() => out.disconnect(), 300);
    }
  }

  private schedule(): void {
    const sixteenth = 60 / this.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number): void {
    const i = step % 16;
    const bar = Math.floor(step / 16);
    const root = ROOTS[bar % ROOTS.length];

    if (i % 4 === 0) this.kick(t);
    if (i === 4 || i === 12) this.snare(t);
    if (i % 4 === 2) this.hat(t, 0.12);
    else if (i % 2 === 1) this.hat(t, 0.04);
    if (i % 4 === 2) this.bass(t, root);
    if (i % 2 === 0) this.pluck(t, root * 2 ** (ARP[(i / 2) % ARP.length] / 12) * 2);
  }

  private kick(t: number): void {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  private snare(t: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(hp).connect(g).connect(this.out);
    src.start(t);
    src.stop(t + 0.2);

    const tone = this.ctx.createOscillator();
    tone.type = 'triangle';
    tone.frequency.value = 190;
    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(0.25, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    tone.connect(tg).connect(this.out);
    tone.start(t);
    tone.stop(t + 0.1);
  }

  private hat(t: number, vol: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 8000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(hp).connect(g).connect(this.out);
    src.start(t);
    src.stop(t + 0.06);
  }

  private bass(t: number, freq: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(lp).connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  private pluck(t: number, freq: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
