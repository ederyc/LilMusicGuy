import type { SpectrumSource } from './types';

/**
 * Something that produces real sound into the engine (test track, file, mic or
 * input device, computer audio).
 */
export interface PlaybackSource {
  /**
   * Sources that capture audio (computer audio, mic) get their stream here, before any
   * audio device is touched: browsers only allow a capture prompt shortly after the click,
   * and opening an audio device can take seconds (Bluetooth headphones waking up).
   */
  acquire?(): Promise<void>;
  /** Only listened to, never played out loud: the engine then opens no output device. */
  readonly listenOnly?: boolean;
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

  /**
   * `output: false` analyses without playing anything, so no output device is opened at
   * all (Chrome / Electron). That matters with Bluetooth headphones: opening one can stall
   * while they switch modes, and capture-only sources never need speakers.
   */
  constructor(readonly output = true) {
    this.ctx = new AudioContext(output ? {} : ({ sinkId: { type: 'none' } } as AudioContextOptions));
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

  /** Start the audio clock; fails (instead of hanging) if the device doesn't respond. */
  async resume(timeoutMs = 5000): Promise<void> {
    if (this.ctx.state === 'running') return;
    let timer = 0;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(
        () =>
          reject(
            new Error(
              "the audio device isn't responding. If you're on Bluetooth headphones, wait a moment for them to connect (or switch output to the speakers) and try again.",
            ),
          ),
        timeoutMs,
      );
    });
    try {
      await Promise.race([this.ctx.resume(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  close(): void {
    void this.ctx.close().catch(() => {});
  }
}
