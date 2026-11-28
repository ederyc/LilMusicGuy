# Security & privacy

Lil Music Guy listens to what your computer plays. That's sensitive: it can include video
calls, private videos, and anything else with sound. This document covers what the app does
with that audio and how the code enforces it.

## What happens to audio

| | |
|---|---|
| **Recorded or saved?** | Never. Audio is analysed in memory, frame by frame, and thrown away. No audio, text or listening history is written to disk. |
| **Sent anywhere?** | Never. The app makes no network requests at all (see *Network* below). |
| **Music analysis** | Only loudness in frequency bands (bass, mids, …), used for beats, tempo and vibe. Words can't be recovered from it. |
| **Talk detection** | Also only band loudness: how much the voice band swings and pauses, and whether there's bass. It tells *that* people are talking, not *what* they say. |
| **Speech understanding** | **Off by default.** When you turn it on, short clips of speech go to a separate, sandboxed transcriber process on your computer. It turns them into words, picks a reaction (laugh, question, greeting, music, wow) and discards the words. Only the reaction name leaves that process. The window never sees any text, and nothing is logged. Clips are only collected while people are talking, never during music or silence. |
| **Screen** | macOS only shares system audio through a screen-share. The app turns the video track off and shrinks it to 2×2 px at 1 fps as soon as it starts. It never reads it and never asks for screenshots or thumbnails. |
| **What's on screen** | The app doesn't read window titles, URLs, app names or anything else about what you're watching. |

## How it's enforced

**The window (renderer)**
- Sandboxed, with context isolation and no Node.js. It can only use three functions from
  `electron/preload.cjs`: receive menu commands, report a status line, and hand speech
  audio to the transcriber. Both sides check every message for type, allowed values and size.
- A strict Content-Security-Policy. Scripts and styles come only from the app's own files. No
  `eval`, no inline scripts, no plugins. The built app has `connect-src 'self'`.

**Network** (`electron/main.cjs`)
- Every request from any page is checked. Only the app's own files (and the local dev server
  while developing) are allowed; everything else is cancelled.
- Pages can't navigate away, open popups or embed web views.
- The transcriber process disables `fetch`, `http`, `https`, `net` and `tls` before loading
  the model, with remote model loading off. The model is downloaded once, by you, with
  `npm run models`.

**Permissions**
- Only microphone (audio only) and screen-share (for system audio) are ever granted, and only
  to the app's own page. Everything else is denied, including camera, location, notifications,
  USB, HID, serial and Bluetooth.

**Settings**
- `settings.json` in the app's user-data folder holds only the audio source, the home prop and
  the on/off state of speech understanding. It's readable by your user only (mode 600).
  Unknown values in it are ignored.

**Dependencies**
- `npm audit` is clean as of this writing. Run it after updating dependencies.

## Before shipping a packaged build

These only apply to a packaged app (there's no packaging setup yet):
- Turn on Electron fuses: `RunAsNode` off, `EnableNodeCliInspectArguments` off,
  `EnableNodeOptionsEnvironmentVariable` off, `OnlyLoadAppFromAsar` on,
  `EnableEmbeddedAsarIntegrityValidation` on, `EnableCookieEncryption` on.
- Code-sign and notarize (macOS) / sign (Windows).
- Ship the speech model inside the app's resources (main.cjs already looks in
  `process.resourcesPath/models` when packaged), so users never download anything.
- Remove the debug environment variables (`LMG_DEBUG`, `LMG_SNAPSHOT`, `LMG_USER_DATA`,
  `LMG_DEV_URL`) or gate them behind a developer build.
- In the privacy policy and the first-run screen, say plainly that the app listens to system
  audio, and what speech understanding does.

## Reporting a problem

If you find a way the app could leak audio, text or anything else, please report it privately
to the maintainers rather than in a public issue.
