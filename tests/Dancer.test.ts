import { describe, expect, it } from 'vitest';
import { Dancer, postureFor, type Pose, type Surroundings } from '../src/character/Dancer';
import { SILENT_FEATURES, type AudioFeatures } from '../src/audio/types';
import type { Vibe, VibeName } from '../src/audio/VibeDetector';

const quiet = (t: number): AudioFeatures => ({ ...SILENT_FEATURES, time: t });
const song =
  (energy: number) =>
  (t: number): AudioFeatures => ({ ...SILENT_FEATURES, time: t, beat: t * 2, bpm: 120, energy, bass: 0.6, active: true });
const music = song(0.3);

const TRAITS = { energy: 0, punch: 0, bass: 0, bright: 0, noisy: 0, swing: 0, tempo: 0 };
const vibeOf = (name: VibeName | null, listening = false): Vibe => ({
  name: listening ? null : name,
  next: null,
  blend: 0,
  confidence: 1,
  listening,
  candidate: name,
  traits: TRAITS,
});

type Step = { pose: Pose; t: number };
function run(
  d: Dancer,
  from: number,
  to: number,
  f: (t: number) => AudioFeatures,
  vibe: Vibe | null = null,
  around?: Surroundings,
  each?: (s: Step) => void,
) {
  let last = d.update(f(from), vibe, 0, around);
  for (let t = from; t < to; t += 1 / 60) {
    last = d.update(f(t), vibe, 1 / 60, around);
    each?.({ pose: last, t });
  }
  return last;
}

describe('Dancer resting', () => {
  it('waits standing, then sits on his prop, then naps', () => {
    const d = new Dancer();
    d.sitAfter = 6;
    d.napAfter = 20;
    let p = run(d, 0, 4, quiet);
    expect(d.label).toBe('Idle');
    expect(p.sit).toBeLessThan(0.05);

    p = run(d, 4, 12, quiet);
    expect(d.label).toBe('Chilling');
    expect(p.sit).toBeGreaterThan(0.95);
    expect(d.sleepiness).toBeLessThan(0.1);

    p = run(d, 12, 35, quiet);
    expect(d.label).toBe('Napping');
    expect(d.sleepiness).toBeGreaterThan(0.8);
    expect(p.eyeOpen).toBeLessThan(0.2);
  });

  it('wakes with a start, listens from his seat, then gets up to dance to an energetic song', () => {
    const d = new Dancer();
    d.sitAfter = 2;
    d.napAfter = 5;
    run(d, 0, 20, quiet);
    expect(d.label).toBe('Napping');

    const woke = run(d, 20, 20.1, music, vibeOf('hype', true));
    expect(woke.eyeOpen).toBe(1); // eyes snap open

    let p = run(d, 20.1, 24, music, vibeOf('hype', true));
    expect(p.sit).toBeGreaterThan(0.9); // hears it out first
    expect(d.label).toBe('Listening…');

    p = run(d, 24, 29, music, vibeOf('hype'));
    expect(p.sit).toBeLessThan(0.1); // up off his seat
    expect(d.intensity).toBeGreaterThan(0.5);
    expect(d.label).not.toMatch(/Napping|Chilling|Idle|Listening/);
  });

  it('does not sit down during a short gap between songs', () => {
    const d = new Dancer();
    run(d, 0, 10, music);
    const p = run(d, 10, 14, quiet);
    expect(p.sit).toBeLessThan(0.05);
  });
});

describe('postures', () => {
  it('maps the music to a posture', () => {
    expect(postureFor('mellow', 0.2)).toBe('lounge');
    expect(postureFor('chill', 0.2)).toBe('lounge');
    expect(postureFor('chill', 0.4)).toBe('sit');
    expect(postureFor('groovy', 0.4)).toBe('stand');
    expect(postureFor('headbang', 0.3)).toBe('stand');
    expect(postureFor('mellow', 0.7)).toBe('stand'); // loud enough always gets him up
  });

  it('lies back for a quiet mellow song, bopping his head', () => {
    const d = new Dancer();
    const nods: number[] = [];
    const p = run(d, 0, 16, song(0.08), vibeOf('mellow'), undefined, ({ pose, t }) => t > 13 && nods.push(pose.headNod));
    expect(d.currentPosture).toBe('lounge');
    expect(d.label).toBe('Lounging');
    expect(p.sit).toBeGreaterThan(0.95);
    expect(p.lean).toBeLessThan(-0.4);
    expect(Math.max(...nods) - Math.min(...nods)).toBeGreaterThan(0.08); // still bopping
  });

  it('sits up before standing when the song suddenly kicks in, then squints and bangs', () => {
    const d = new Dancer();
    run(d, 0, 16, song(0.08), vibeOf('mellow'));
    expect(d.label).toBe('Lounging');

    let upAt = Infinity;
    run(d, 16, 22, song(0.38), vibeOf('headbang'), undefined, ({ pose, t }) => {
      // never reclined while not seated
      if (pose.sit < 0.5) expect(pose.lean).toBeGreaterThan(-0.25);
      if (pose.sit < 0.1) upAt = Math.min(upAt, t);
    });
    expect(upAt - 16).toBeLessThan(3); // the drop gets him up fast, no long wait
    const p = run(d, 22, 26, song(0.38), vibeOf('headbang'));
    expect(p.eyeOpen).toBeLessThan(0.6); // squinting
    expect(p.browDown).toBeGreaterThan(0.5); // brows furrowed
  });

  it('does not fidget: a brief change in the music does not change his posture', () => {
    const d = new Dancer();
    run(d, 0, 20, song(0.3), vibeOf('groovy'));
    expect(d.currentPosture).toBe('stand');
    run(d, 20, 21.5, song(0.3), vibeOf('mellow'));
    expect(d.currentPosture).toBe('stand');
  });

  it('sits and watches when people are talking, nodding when they pause', () => {
    const d = new Dancer();
    const talk = (speaking: boolean): Surroundings => ({ talk: 0.9, speaking });
    run(d, 0, 8, song(0.2), null, talk(true));
    expect(d.label).toBe('Watching');
    expect(d.intensity).toBeLessThan(0.1);
    const before = run(d, 8, 9, song(0.2), null, talk(true)).headNod;
    let maxNod = -Infinity;
    run(d, 9, 9.6, song(0.2), null, talk(false), ({ pose }) => (maxNod = Math.max(maxNod, pose.headNod)));
    expect(maxNod - before).toBeGreaterThan(0.1);
  });

  it('reacts to cues', () => {
    const d = new Dancer();
    run(d, 0, 3, quiet);
    const p = run(d, 3, 3.6, quiet, null, { talk: 0, speaking: false, cue: 'question' });
    expect(d.label).toBe('Hm?');
    expect(p.headTilt).toBeGreaterThan(0.2);
  });
});
