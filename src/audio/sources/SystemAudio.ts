import type { AudioEngine, PlaybackSource } from '../AudioEngine';

/**
 * Listens to what the computer is playing, through the browser's screen-share picker with
 * "Share audio" turned on. What can be shared depends on the browser and OS:
 *
 * - Chrome / Edge: a tab's audio everywhere; the whole system's audio when sharing the
 *   entire screen on Windows and ChromeOS (and on recent macOS with a recent Chrome).
 * - Safari and Firefox don't share audio this way. For those (or for every app on a Mac),
 *   route audio through a loopback device like BlackHole and pick it as the input device.
 *
 * The browser insists on a video track too; it's kept (stopping it can end the share) but
 * never used. Like the mic, this goes straight to the analyser, never the speakers, so the
 * music isn't played twice.
 */
export class SystemAudio implements PlaybackSource {
  onEnded?: () => void;

  private stream: MediaStream | null = null;
  private node: MediaStreamAudioSourceNode | null = null;

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  }

  async start(engine: AudioEngine): Promise<void> {
    if (!SystemAudio.supported) throw new Error("This browser can't share audio. Try Chrome or Edge.");

    // Chrome-specific hints (systemAudio, selfBrowserSurface, …) aren't in the DOM typings yet.
    const options = {
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    } as DisplayMediaStreamOptions;
    this.stream = await navigator.mediaDevices.getDisplayMedia(options);

    const [audio] = this.stream.getAudioTracks();
    if (!audio) {
      this.stop();
      throw new Error(
        'No audio was shared. Share again, pick a tab (or your entire screen on Windows) and turn on "Share audio".',
      );
    }
    // macOS without the System Audio Recording permission hands back a track that's
    // already dead and never delivers sound, without any error. Say so instead.
    if (audio.readyState === 'ended') {
      this.stop();
      throw new Error(
        'The computer blocked audio capture. Allow it under System Settings → Privacy & Security → Screen & System Audio Recording, then try again.',
      );
    }
    // The user can end it from the browser's own "Stop sharing" bar.
    audio.addEventListener('ended', () => this.onEnded?.());

    this.node = engine.ctx.createMediaStreamSource(new MediaStream([audio]));
    this.node.connect(engine.analyser);
  }

  stop(): void {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node = null;
    this.stream = null;
  }
}
