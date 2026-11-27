# Lil Music Guy

A little 3D figurine that dances to whatever music is playing on your computer.

## Run it

```bash
npm install
npm run dev      # open the printed URL
npm test         # beat and vibe detection unit tests
npm run calibrate  # print what the vibe detector hears for each simulated style
```

Add `?source=simulated&style=lofi` (and optionally `&bpm=90`) to the URL to make him start dancing on load.

## Desktop app

```bash
npm run desktop      # build, then launch as its own app (needed for macOS audio permissions)
npm run desktop:dev  # same, but launched from the terminal so you can see its logs
```

He lives in the bottom-right corner of your screen, on his home prop, sitting on the top
edge of the dock. **Wallpaper mode** (the default) keeps him behind all your windows, so you
see him on the bare desktop. Control him from the **♪** in the menu bar: what he listens
to, his home prop, and a link to the test bench. Buddy mode (on top and interactive) is next.

- **Computer audio** on macOS needs 14.2+. The first time, macOS asks for Screen & System
  Audio Recording permission (the screen video is never used). If it's denied, the ♪ menu
  says so; allow it in System Settings → Privacy & Security and pick Computer audio again.
- Launch with `npm run desktop`, not `electron .` from a terminal: macOS attributes the
  permission to whichever app launched it, so from a terminal it'd be the terminal's.
- Electron 45 needs Node 22.12+ to install.
- Dev switches: `LMG_SOURCE=demo` starts on the demo beat for that run, `LMG_DEBUG=1` logs
  the page here, `LMG_DEV_URL=http://localhost:5173` loads from `npm run dev` instead of the build.

When nothing's playing he waits standing for a few seconds, then sits on the edge of his
prop (legs swinging, the odd yawn), and after a minute he naps. Music wakes him up.

## Test bench sources

| Source | What it tests |
| --- | --- |
| **Simulated** | Fake spectrum data, no sound, in six styles (house, lo-fi, funk, trap, rock, ballad). Tests dance logic, beat and vibe detection without any audio. |
| **Test track** | A generated house beat played through Web Audio. Tests the full real-audio pipeline. |
| **Audio file…** | Any local mp3/wav. Tests against real music. |
| **Computer audio** | Screen sharing with "Share audio" on. A tab's audio in Chrome/Edge everywhere; the whole system on Windows/ChromeOS (and recent macOS). Not available in Safari or Firefox. |
| **Mic / input** | The mic, or any input device. Pick a loopback device (BlackHole, Loopback, VB-Cable) that your output is routed into to hear every app, in any browser. |

## How it fits together

```
SpectrumSource ──► FeatureExtractor ──► VibeDetector ──► Dancer ──► LilGuy (rig)
(sim / engine)     beats, BPM, energy   vibe + traits    poses      model + accessory slots
```

- `src/audio/FeatureExtractor.ts`: bass spectral-flux beat detection, tempo estimate, and a phase-locked beat clock. No Web Audio dependency, so it's unit tested.
- `src/audio/AudioEngine.ts`: Web Audio graph. New audio inputs implement `PlaybackSource`.
- `src/audio/VibeDetector.ts`: measures traits (energy, punch, bass, brightness, noisiness, swing, tempo), smooths them over a few seconds and picks the nearest of six vibes: mellow, chill, groovy, bouncy, hype, headbang. Listens for a few seconds at the start of a song before committing, and only switches after a new vibe has held for 5 s. Pure logic, unit tested.
- `src/character/Dancer.ts`: dance moves are pure functions `beat → Pose`, each tagged with the vibes it suits. Add a move by adding an entry to `MOVES`. Also holds the listening pose and the per-vibe idles.

### Tuning the vibes

The prototypes in `VIBE_PROTOTYPES` were tuned against the simulated styles, which are cartoons of each genre. Real music will need adjusting: play songs you know, watch the trait meters in the **Vibe** panel, and move the prototypes toward what you see. `npm test` keeps the simulated styles honest while you do.
- `src/character/Body.ts`: the physics layer. Every joint follows its target through a spring; the body's own accelerations drive secondary motion (head lag, arm flop, elbow whip, belly squash, hat wobble); two-bone IK keeps the feet planted so the knees bend. Tune the feel in `TUNING`, `JIGGLE` and `GAIN` at the top.
- `src/character/LilGuy.ts`: the model (skinned torso, arms and legs on a skeleton with spine, neck, elbows, wrists, knees and ankles), color customization, and accessory slots (`head`, `face`, `back`, `leftHand`, `rightHand`) for future shop items.
