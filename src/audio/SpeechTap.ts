import type { AudioEngine } from './AudioEngine';
import workletUrl from './speechTap.worklet.js?url';

const RATE = 16000;
/** Send what's been said so far once it's this long, or when the speaker pauses. */
const MAX_SECONDS = 8;
const MIN_SECONDS = 1.2;

/**
 * Collects 16 kHz audio of people talking, for the on-device transcriber (desktop app,
 * "understand speech" option only). It buffers only while `talking` is true, i.e. while
 * the speech detector says it's a voice rather than music, sends each utterance off when
 * the speaker pauses (or every 8 s), then forgets it. Nothing is kept or saved.
 */
export class SpeechTap {
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private length = 0;
  private talking = false;
  private speaking = false;
  private silentFor = 0;

  constructor(private send: (samples: Float32Array) => void) {}

  get running(): boolean {
    return !!this.node;
  }

  async start(engine: AudioEngine): Promise<void> {
    if (this.node) return;
    await engine.ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(engine.ctx, 'lmg-speech-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => this.take(e.data);
    // The worklet must be pulled by the graph to run; route it into a muted gain.
    const sink = engine.ctx.createGain();
    sink.gain.value = 0;
    engine.analyser.connect(node);
    node.connect(sink);
    sink.connect(engine.ctx.destination);
    this.node = node;
    this.sink = sink;
  }

  stop(): void {
    this.node?.port.close();
    this.node?.disconnect();
    this.sink?.disconnect();
    this.node = null;
    this.sink = null;
    this.drop();
  }

  /** Called every frame with the speech detector's reading. */
  update(talking: boolean, speaking: boolean, dt: number): void {
    this.talking = talking;
    this.speaking = speaking;
    if (!talking) {
      this.drop();
      return;
    }
    this.silentFor = speaking ? 0 : this.silentFor + dt;
    // A pause after enough speech: send this utterance.
    if (this.silentFor > 0.45 && this.length >= RATE * MIN_SECONDS) this.flush();
  }

  private take(samples: Float32Array): void {
    if (!this.talking) return; // music or silence: not buffered at all
    if (!this.speaking && this.length === 0) return; // don't start on a pause
    this.chunks.push(samples);
    this.length += samples.length;
    if (this.length >= RATE * MAX_SECONDS) this.flush();
  }

  private flush(): void {
    if (!this.length) return;
    const all = new Float32Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      all.set(c, at);
      at += c.length;
    }
    this.drop();
    this.send(all);
  }

  private drop(): void {
    this.chunks = [];
    this.length = 0;
    this.silentFor = 0;
  }
}
