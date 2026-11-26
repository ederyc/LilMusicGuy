import { describe, expect, it } from 'vitest';
import { FeatureExtractor } from '../src/audio/FeatureExtractor';
import { SimulatedSource, type SimStyleName } from '../src/audio/sources/SimulatedSource';
import { VibeDetector, type Vibe, type VibeName } from '../src/audio/VibeDetector';

/** Feed a source through extractor + detector; `script(t)` can change the source mid-run. */
function run(src: SimulatedSource, seconds: number, script?: (t: number) => void) {
  const ex = new FeatureExtractor();
  const vd = new VibeDetector();
  const buf = new Uint8Array(src.binCount);
  const frames: Vibe[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    script?.(t);
    src.read(buf, t);
    frames.push(vd.process(buf, src.binHz, ex.process(buf, src.binHz, t)));
  }
  return frames;
}

const EXPECTED: [SimStyleName, VibeName][] = [
  ['house', 'hype'],
  ['lofi', 'chill'],
  ['funk', 'groovy'],
  ['trap', 'bouncy'],
  ['rock', 'headbang'],
  ['ballad', 'mellow'],
];

describe('VibeDetector', () => {
  for (const [style, vibe] of EXPECTED) {
    for (const seed of [1, 42]) {
      it(`hears ${style} as ${vibe} (seed ${seed})`, () => {
        const frames = run(new SimulatedSource({ style, seed }), 20);
        expect(frames.at(-1)!.name).toBe(vibe);
      });
    }
  }

  it('listens for a few seconds before committing', () => {
    const frames = run(new SimulatedSource({ style: 'house' }), 10);
    const first = frames.findIndex((f) => f.name !== null);
    expect(frames[30].listening).toBe(true);
    expect(frames[30].name).toBeNull();
    expect(first / 60).toBeGreaterThanOrEqual(3.4);
    expect(first / 60).toBeLessThan(8.1);
    expect(frames[first].listening).toBe(false);
  });

  it('does not flip-flop once committed', () => {
    for (const [style] of EXPECTED) {
      const frames = run(new SimulatedSource({ style }), 30).filter((f) => f.name !== null);
      const changes = frames.filter((f, i) => i > 0 && f.name !== frames[i - 1].name).length;
      expect(changes, style).toBeLessThanOrEqual(1);
    }
  });

  it('follows a change of song without a gap, after holding a while', () => {
    const src = new SimulatedSource({ style: 'house' });
    const frames = run(src, 40, (t) => {
      if (Math.abs(t - 20) < 1 / 120) src.setStyle('ballad');
    });
    const at = (s: number) => frames[Math.round(s * 60)];
    expect(at(19.5).name).toBe('hype');
    expect(at(22).name).toBe('hype'); // not yet: has to hold
    expect(frames.at(-1)!.name).toBe('mellow');
  });

  it('forgets the vibe after a long silence and listens again', () => {
    const src = new SimulatedSource({ style: 'rock' });
    const frames = run(src, 30, (t) => {
      src.playing = t < 12 || t > 20;
    });
    const at = (s: number) => frames[Math.round(s * 60)];
    expect(at(11.5).name).toBe('headbang');
    expect(at(18).name).toBeNull();
    expect(at(21).listening).toBe(true);
    expect(frames.at(-1)!.name).toBe('headbang');
  });

  it('reports a runner-up and a sensible confidence', () => {
    const v = run(new SimulatedSource({ style: 'funk' }), 20).at(-1)!;
    expect(v.next).not.toBeNull();
    expect(v.next).not.toBe(v.name);
    expect(v.confidence).toBeGreaterThan(0);
    expect(v.blend).toBeGreaterThanOrEqual(0);
    expect(v.blend).toBeLessThanOrEqual(0.5);
  });
});
