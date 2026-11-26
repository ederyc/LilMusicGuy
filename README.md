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
- `src/character/LilGuy.ts`: the model, color customization, and accessory slots (`head`, `face`, `back`, `leftHand`, `rightHand`) for future shop items.
