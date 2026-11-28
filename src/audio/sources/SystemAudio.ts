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
 * disabled and shrunk right away, and never read. Like the mic, this goes straight to the analyser, never the speakers, so the
 * music isn't played twice.
 */
export class SystemAudio implements PlaybackSource {
  onEnded?: () => void;
  readonly listenOnly = true;

  private stream: MediaStream | null = null;
  private node: MediaStreamAudioSourceNode | null = null;

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  }

  /** Ask for the share. Call straight from the click, before anything slow. */
  async acquire(): Promise<void> {
    if (!SystemAudio.supported) throw new Error("This browser can't share audio. Try Chrome or Edge.");

    // Chrome-specific hints (systemAudio, selfBrowserSurface, …) aren't in the DOM typings yet.
    // Start the picker on "Entire screen": that's the only choice that carries other apps'
    // sound (Spotify, Music, …). Shared windows never carry audio in Chrome.
    const options = {
      video: { displaySurface: 'monitor' },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    } as DisplayMediaStreamOptions;
    this.stream = await navigator.mediaDevices.getDisplayMedia(options);

    const [audio] = this.stream.getAudioTracks();
    if (!audio) {
      const surface = (this.stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
      this.stop();
      throw new Error(
        surface === 'window'
          ? "a shared window doesn't include its sound. Share again, choose \"Entire Screen\" and turn on \"Also share system audio\" (for music from an app like Spotify), or pick a browser tab playing music."
          : 'no sound was shared. Share again: choose "Entire Screen" and turn on "Also share system audio", or pick a browser tab and turn on "Share tab audio".',
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

    // The screen video is never looked at: switch it off (it then carries only black
    // frames) and ask for the smallest, slowest stream. Stopping it outright can end the
    // whole share, audio included.
    for (const video of this.stream.getVideoTracks()) {
      video.enabled = false;
      void video.applyConstraints({ width: 2, height: 2, frameRate: 1 }).catch(() => {});
    }
  }

  async start(engine: AudioEngine): Promise<void> {
    if (!this.stream) await this.acquire();
    const [audio] = this.stream!.getAudioTracks();

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
