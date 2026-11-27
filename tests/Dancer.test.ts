import { describe, expect, it } from 'vitest';
import { Dancer } from '../src/character/Dancer';
import { SILENT_FEATURES, type AudioFeatures } from '../src/audio/types';

const quiet = (t: number): AudioFeatures => ({ ...SILENT_FEATURES, time: t });
const music = (t: number): AudioFeatures => ({ ...SILENT_FEATURES, time: t, beat: t * 2, bpm: 120, energy: 0.3, bass: 0.6, active: true });

function run(d: Dancer, from: number, to: number, f: (t: number) => AudioFeatures) {
  let last = d.update(f(from), null, 0);
  for (let t = from; t < to; t += 1 / 60) last = d.update(f(t), null, 1 / 60);
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

  it('wakes with a start when music plays, gets up, then dances', () => {
    const d = new Dancer();
    d.sitAfter = 2;
    d.napAfter = 5;
    run(d, 0, 20, quiet);
    expect(d.label).toBe('Napping');

    const woke = run(d, 20, 20.1, music);
    expect(woke.eyeOpen).toBe(1); // eyes snap open

    const p = run(d, 20.1, 21.5, music);
    expect(p.sit).toBeLessThan(0.1); // up off his seat
    run(d, 21.5, 24, music);
    expect(d.intensity).toBeGreaterThan(0.5);
    expect(d.label).not.toMatch(/Napping|Chilling|Idle/);
  });

  it('does not sit down during a short gap between songs', () => {
    const d = new Dancer();
    run(d, 0, 10, music);
    const p = run(d, 10, 14, quiet);
    expect(p.sit).toBeLessThan(0.05);
  });
});
