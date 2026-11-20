import { describe, expect, it } from 'vitest';
import { FeatureExtractor } from '../src/audio/FeatureExtractor';
import { SimulatedSource } from '../src/audio/sources/SimulatedSource';
import type { AudioFeatures } from '../src/audio/types';

/** Run the simulated source through the extractor with slightly jittery frame timing. */
function run(source: SimulatedSource, seconds: number, fps = 60) {
  const extractor = new FeatureExtractor();
  const buf = new Uint8Array(source.binCount);
  const frames: AudioFeatures[] = [];
  let t = 0;
  let seed = 7;
  const jitter = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 0.004;
  };
  while (t < seconds) {
    source.read(buf, t);
    frames.push(extractor.process(buf, source.binHz, t));
    t += 1 / fps + jitter();
  }
  return frames;
}

describe('FeatureExtractor', () => {
  for (const bpm of [90, 120, 150]) {
    it(`locks onto ${bpm} BPM`, () => {
      const src = new SimulatedSource();
      src.bpm = bpm;
      const frames = run(src, 10);
      const last = frames[frames.length - 1];
      expect(last.bpm).toBeGreaterThan(bpm - 3);
      expect(last.bpm).toBeLessThan(bpm + 3);
      expect(last.active).toBe(true);

      // Roughly one detected beat per actual beat (allow a warm-up miss or two).
      const beats = frames.filter((f) => f.isBeat).length;
      const expected = (10 * bpm) / 60;
      expect(beats).toBeGreaterThan(expected - 4);
      expect(beats).toBeLessThanOrEqual(expected + 1);
    });
  }

  it('beat clock advances once per beat after locking', () => {
    const src = new SimulatedSource();
    src.bpm = 120;
    const frames = run(src, 12);
    const at5 = frames.find((f) => f.time >= 5)!;
    const last = frames[frames.length - 1];
    const advanced = last.beat - at5.beat;
    const expected = ((last.time - at5.time) * 120) / 60;
    expect(Math.abs(advanced - expected)).toBeLessThan(0.5);
  });

  it('reports silence and no beats when nothing is playing', () => {
    const src = new SimulatedSource();
    src.playing = false;
    const frames = run(src, 4);
    expect(frames.some((f) => f.isBeat)).toBe(false);
    expect(frames[frames.length - 1].active).toBe(false);
    expect(frames[frames.length - 1].energy).toBeLessThan(0.01);
  });

  it('goes inactive after music stops', () => {
    const src = new SimulatedSource();
    const extractor = new FeatureExtractor();
    const buf = new Uint8Array(src.binCount);
    let f!: AudioFeatures;
    for (let t = 0; t < 5; t += 1 / 60) {
      src.playing = t < 2;
      src.read(buf, t);
      f = extractor.process(buf, src.binHz, t);
    }
    expect(f.active).toBe(false);
  });

  it('louder music yields higher energy', () => {
    const quiet = new SimulatedSource();
    quiet.level = 0.3;
    const loud = new SimulatedSource();
    loud.level = 1;
    const q = run(quiet, 3).at(-1)!;
    const l = run(loud, 3).at(-1)!;
    expect(l.energy).toBeGreaterThan(q.energy);
  });
});
