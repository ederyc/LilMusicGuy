import type { SpectrumSource } from './types';

/**
 * Something that produces real sound into the engine (test track, file, mic or
 * input device, computer audio).
 */
export interface PlaybackSource {
  start(engine: AudioEngine): Promise<void>;
  stop(): void;
  /** Called if the source ends on its own (e.g. the user stops screen sharing). */
  onEnded?: () => void;
}

/**
 * Owns the Web Audio graph:
 *
 *   source ─► input ─┬─► analyser  (what LilGuy "hears")
 *                    └─► speakers ─► destination
 *
 * Sources that shouldn't be played back out loud (e.g. microphone) connect
 * straight to `analyser` instead of `input`.
 */
export class AudioEngine implements SpectrumSource {
  readonly ctx: AudioContext;
  readonly input: GainNode;
  readonly analyser: AnalyserNode;
  private speakers: GainNode;

  constructor() {
    this.ctx = new AudioContext();
    this.input = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    // Low smoothing keeps transients (kicks) sharp for beat detection;
    // FeatureExtractor does its own smoothing for visuals.
    this.analyser.smoothingTimeConstant = 0.2;
    this.speakers = this.ctx.createGain();

    this.input.connect(this.analyser);
    this.input.connect(this.speakers);
    this.speakers.connect(this.ctx.destination);
  }

  get binCount(): number {
    return this.analyser.frequencyBinCount;
  }

  get binHz(): number {
    return this.ctx.sampleRate / this.analyser.fftSize;
  }

  read(out: Uint8Array): void {
    this.analyser.getByteFrequencyData(out as Uint8Array<ArrayBuffer>);
  }

  setVolume(v: number): void {
    this.speakers.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }
}
