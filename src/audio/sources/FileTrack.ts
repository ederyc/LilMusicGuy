import type { AudioEngine, PlaybackSource } from '../AudioEngine';

/** Plays a local audio file (mp3/wav/ogg/…) on loop through the engine. */
export class FileTrack implements PlaybackSource {
  private node: AudioBufferSourceNode | null = null;

  constructor(private file: File) {}

  async start(engine: AudioEngine): Promise<void> {
    const buffer = await engine.ctx.decodeAudioData(await this.file.arrayBuffer());
    this.node = engine.ctx.createBufferSource();
    this.node.buffer = buffer;
    this.node.loop = true;
    this.node.connect(engine.input);
    this.node.start();
  }

  stop(): void {
    if (!this.node) return;
    try {
      this.node.stop();
    } catch {
      /* already stopped */
    }
    this.node.disconnect();
    this.node = null;
  }
}
