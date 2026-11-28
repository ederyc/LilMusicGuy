# Lil Music Guy

A little 3D figurine that dances to whatever music is playing on your computer.

## Run it

```bash
npm install
npm run dev      # open the printed URL
npm test         # beat and vibe detection unit tests
npm run calibrate  # print what the vibe detector hears for each simulated style
npm run models   # one-time: download the on-device speech model (~42 MB) for "Understand speech"
```

Add `?source=simulated&style=lofi` (and optionally `&bpm=90`) to the URL to make him start dancing on load.
Other URL switches: `style=talk` / `style=talkbed` (simulated podcast, with or without background
music), `posture=stand|sit|lounge` to hold a posture, `at=<seconds>` to fast-forward and freeze.

See [SECURITY.md](SECURITY.md) for what happens to the audio he hears (short version: it never
leaves your computer and is never saved).

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

## What he does

The music picks his **posture**, and he moves between them in order (lounging → sitting up →
standing up), so changes never snap:

- **Standing and dancing** for energetic songs. Every 8 beats he picks a move suited to the
  vibe. Heavy, loud music (headbang / hype) makes him squint, furrow his brows and bang harder.
- **Sitting and vibing** on the edge of his prop for laid-back songs: head bopping on the beat,
  drumming on his thighs, tapping alternate feet.
- **Lounging**, leaning back on his hands with one leg out, for the quietest, mellowest songs:
  a slow head bop and a tapping foot.

A posture has to be wanted for a few seconds before he changes (so a short quiet bar doesn't
make him fidget). A sudden surge, like a drop after a quiet build, gets him straight up with a
"whoa".

**Talking** (YouTube, podcasts, streams) is told apart from music by sound alone: how much
the voice band swings and pauses, and whether there's bass. When people are talking he sits
and watches the screen, chin in hand, nodding along when the speaker pauses. With **Understand
speech** turned on (♪ menu, off by default, needs `npm run models` once) he also reacts to what's
said: laughs along, tilts his head at questions, waves at greetings, perks up when someone
mentions music, and goes "whoa" at surprises. Speech recognition runs entirely on your
computer, and the words never leave the recognizer process.

When nothing's playing he waits standing for a few seconds, then sits on the edge of his
prop (legs swinging, the odd yawn), and after a minute he naps. Music wakes him up. After a
quiet spell he stays seated to hear out the next song before deciding what to do.

## Test bench sources

| Source | What it tests |
| --- | --- |
| **Simulated** | Fake spectrum data, no sound, in six music styles (house, lo-fi, funk, trap, rock, ballad) plus two talking ones (podcast, video with background music). Tests dance logic, beat, vibe and talk detection without any audio. |
| **Test track** | A generated house beat played through Web Audio. Tests the full real-audio pipeline. |
| **Audio file…** | Any local mp3/wav. Tests against real music. |
| **Computer audio** | Screen sharing with audio on. For an app like Spotify choose **Entire Screen** and turn on "Also share system audio" (macOS 14.2+ with a recent Chrome, Windows, ChromeOS). A single app **window never carries sound**. For music in a browser tab, share that tab with "Share tab audio" on. Not available in Safari or Firefox. The desktop app (`npm run desktop`) hears everything with no picker at all. |
| **Mic / input** | The mic, or any input device. Pick a loopback device (BlackHole, Loopback, VB-Cable) that your output is routed into to hear every app, in any browser. |

## How it fits together

```
SpectrumSource ──► FeatureExtractor ──► VibeDetector ──► Dancer ──► LilGuy (rig)
(sim / engine)     beats, BPM, energy   vibe + traits    poses      model + accessory slots
```

- `src/audio/FeatureExtractor.ts`: bass spectral-flux beat detection, tempo estimate, and a phase-locked beat clock. No Web Audio dependency, so it's unit tested.
- `src/audio/AudioEngine.ts`: Web Audio graph. New audio inputs implement `PlaybackSource`.
- `src/audio/VibeDetector.ts`: measures traits (energy, punch, bass, brightness, noisiness, swing, tempo), smooths them over a few seconds and picks the nearest of six vibes: mellow, chill, groovy, bouncy, hype, headbang. Listens for a few seconds at the start of a song before committing, and only switches after a new vibe has held for 5 s. Pure logic, unit tested.
- `src/audio/SpeechDetector.ts`: talk vs. music from band levels (voice-band swing, gaps, missing sub-bass), smoothed with hysteresis. Unit tested against real speech (macOS `say`) and synthesized music, including a drumless ballad and a song with sung vocals.
- `src/audio/SpeechTap.ts` + `speechTap.worklet.js`: desktop app with Understand speech on only. Buffers 16 kHz audio while people are talking and sends each utterance to `electron/transcriber.cjs` (Whisper tiny, on-device, network disabled), which returns only a reaction cue.
- `src/character/Dancer.ts`: dance moves are pure functions `beat → Pose`, each tagged with the vibes it suits. Add a move by adding an entry to `MOVES`. Also holds the postures (`postureFor` maps vibe + loudness to stand / sit / lounge), the transitions between them, the sitting / lounging / watching / listening poses, the per-vibe idles and the reactions to cues.

### Tuning the vibes

The prototypes in `VIBE_PROTOTYPES` were tuned against the simulated styles, which are cartoons of each genre. Real music will need adjusting: play songs you know, watch the trait meters in the **Vibe** panel, and move the prototypes toward what you see. `npm test` keeps the simulated styles honest while you do.
- `src/render/toon.ts`: the look. `toonMaterial()` gives cel shading with colored shadows (three bands, anti-aliased edges) and a rim light; `addOutlines()` adds constant-width ink outlines (inverted hulls extruded in screen space, skinned meshes included) whose color follows the surface color. Global tuning lives in `LOOK`. No post-processing, so it all works on the transparent desktop window. Anything new (props, accessories, shop items) should use `toonMaterial` and get outlines.
- `src/scene/ContactShadow.ts`: soft blobs under his feet and body that shrink as he lifts off, so he looks planted on his prop.
- `src/character/Body.ts`: the physics layer. Every joint follows its target through a spring; the body's own accelerations drive secondary motion (head lag, arm flop, elbow whip, belly squash, hat wobble); two-bone IK keeps the feet planted so the knees bend. Tune the feel in `TUNING`, `JIGGLE` and `GAIN` at the top.
- `src/character/LilGuy.ts`: the model (skinned torso, arms and legs on a skeleton with spine, neck, elbows, wrists, knees and ankles), color customization, and accessory slots (`head`, `face`, `back`, `leftHand`, `rightHand`) for future shop items.
