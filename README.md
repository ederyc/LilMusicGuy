# Lil Music Guy

A little 3D figurine that dances to whatever music is playing on your computer.

## Run it

```bash
npm install
npm run dev      # open the printed URL
npm test         # beat-detection unit tests
```

Add `?source=simulated&bpm=128` to the URL to make him start dancing on load.

## Test bench sources

| Source | What it tests |
| --- | --- |
| **Simulated** | Fake spectrum data, no sound. Tests dance logic and beat detection without any audio. |
| **Test track** | A generated house beat played through Web Audio. Tests the full real-audio pipeline. |
| **Audio file…** | Any local mp3/wav. Tests against real music. |
| **Microphone** | Play music out loud and he listens. Closest thing to "music on my device" for now. |

## How it fits together

```
SpectrumSource ──► FeatureExtractor ──► Dancer ──► LilGuy (rig)
(sim / engine)     beats, BPM, energy   poses      model + accessory slots
```

- `src/audio/FeatureExtractor.ts`: bass spectral-flux beat detection, tempo estimate, and a phase-locked beat clock. No Web Audio dependency, so it's unit tested.
- `src/audio/AudioEngine.ts`: Web Audio graph. New audio inputs implement `PlaybackSource`.
- `src/character/Dancer.ts`: dance moves are pure functions `beat → Pose`. Add a move by adding an entry to `MOVES`.
- `src/character/LilGuy.ts`: the model, color customization, and accessory slots (`head`, `face`, `back`, `leftHand`, `rightHand`) for future shop items.
