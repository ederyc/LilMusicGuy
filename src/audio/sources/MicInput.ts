import type { AudioEngine, PlaybackSource } from '../AudioEngine';

/**
 * Listens through the microphone. Handy real-world test: play music out loud
 * on the laptop speakers and LilGuy hears it. Connected straight to the
 * analyser (not the speakers) to avoid feedback.
 */
export class MicInput implements PlaybackSource {
  private stream: MediaStream | null = null;
  private node: MediaStreamAudioSourceNode | null = null;

  async start(engine: AudioEngine): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.node = engine.ctx.createMediaStreamSource(this.stream);
    this.node.connect(engine.analyser);
  }

  stop(): void {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node = null;
    this.stream = null;
  }
}
