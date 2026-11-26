import type { AudioEngine, PlaybackSource } from '../AudioEngine';

/**
 * Listens through an audio input: the microphone by default, or any input device by id.
 * Picking a loopback device (BlackHole, Loopback, VB-Cable, …) that your computer's output
 * is routed into lets him hear everything the computer plays, in any browser.
 * Connected straight to the analyser (not the speakers) to avoid feedback.
 */
export class MicInput implements PlaybackSource {
  onEnded?: () => void;

  private stream: MediaStream | null = null;
  private node: MediaStreamAudioSourceNode | null = null;

  constructor(private deviceId?: string) {}

  /** Audio inputs. Labels are only filled in once the page has had mic permission. */
  static async devices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  }

  async start(engine: AudioEngine): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : {}),
      },
    });
    this.stream.getAudioTracks()[0]?.addEventListener('ended', () => this.onEnded?.());
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
