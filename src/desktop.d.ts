import type { Cue } from './character/Dancer';

/** Commands the desktop app's menu sends to the page. */
export type DesktopCommand =
  | { type: 'source'; value: 'system' | 'mic' | 'demo' | 'off' }
  | { type: 'prop'; value: string }
  /** Turn on-device speech understanding on or off. */
  | { type: 'understand'; value: boolean }
  /** A reaction to something that was said (the words themselves never reach the page). */
  | { type: 'cue'; value: Cue };

declare global {
  interface Window {
    /** Present only inside the desktop app (see electron/preload.cjs). */
    lilguy?: {
      onCommand(cb: (cmd: DesktopCommand) => void): void;
      status(s: { mode: string; text: string }): void;
      /** Hand 16 kHz speech audio to the on-device transcriber. */
      hear(samples: Float32Array): void;
    };
  }
}
