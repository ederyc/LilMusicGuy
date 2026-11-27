/** What the desktop app's preload script (electron/preload.cjs) exposes to the page. */
export type DesktopCommand =
  | { type: 'source'; value: 'system' | 'mic' | 'demo' | 'off' }
  | { type: 'prop'; value: string };

declare global {
  interface Window {
    lilguy?: {
      onCommand(cb: (cmd: DesktopCommand) => void): void;
      status(s: { mode: string; text: string }): void;
    };
  }
}
