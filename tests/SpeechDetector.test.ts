import { describe, expect, it } from 'vitest';
import { SpeechDetector } from '../src/audio/SpeechDetector';
import { SimulatedSource, SIM_STYLES, type SimStyleName } from '../src/audio/sources/SimulatedSource';
import { SimulatedTalk } from '../src/audio/sources/SimulatedTalk';
import type { SpectrumSource } from '../src/audio/types';
import { analyse, mix, RATE, sayPcm, songPcm } from './helpers/audio';

const BIN_HZ = RATE / 2048;

/** Run a source through the detector; returns the talk level over the last few seconds. */
function talkFromSource(src: SpectrumSource, seconds: number) {
  const d = new SpeechDetector();
  const buf = new Uint8Array(1024);
  const tail: number[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    src.read(buf, t);
    const r = d.process(buf, src.binHz, t, true);
    if (t > seconds - 4) tail.push(r.talk);
  }
  return { min: Math.min(...tail), max: Math.max(...tail) };
}

function talkFromPcm(pcm: Float32Array) {
  const d = new SpeechDetector();
  const seconds = pcm.length / RATE;
  const tail: number[] = [];
  let last = d.current;
  analyse(pcm, (bytes, t) => {
    last = d.process(bytes, BIN_HZ, t, true);
    if (t > seconds - 4) tail.push(last.talk);
  });
  if (tail.length < 60) throw new Error(`only ${tail.length} frames analysed`);
  return { min: Math.min(...tail), max: Math.max(...tail), mean: tail.reduce((a, b) => a + b, 0) / tail.length, last };
}

const SPEECH =
  'Welcome back to the show. Today we are talking about how small habits add up over time. ' +
  'I tried something new this week, and honestly, it surprised me. So here is what happened. ' +
  'I woke up early, made coffee, and wrote down three things I wanted to finish. ' +
  'By lunch, two of them were done. That never happens! What do you think made the difference? ' +
  'Let me know in the comments, and we will read a few of them next time. Thanks for listening, everybody.';

describe('SpeechDetector on simulated sources', () => {
  for (const style of Object.keys(SIM_STYLES) as SimStyleName[]) {
    it(`calls ${style} music, not talk`, () => {
      expect(talkFromSource(new SimulatedSource({ style }), 16).max).toBeLessThan(0.3);
    });
  }
  it('calls the simulated podcast talk', () => {
    expect(talkFromSource(new SimulatedTalk(), 16).min).toBeGreaterThan(0.7);
  });
});

describe('SpeechDetector on real audio', () => {
  const speech = sayPcm(SPEECH);
  const speech2 = sayPcm(SPEECH, 'Samantha');

  it.runIf(!!speech)('hears a voice talking as talk', () => {
    const r = talkFromPcm(speech!);
    expect(r.min).toBeGreaterThan(0.6);
  });
  it.runIf(!!speech2)('hears another voice as talk', () => {
    expect(talkFromPcm(speech2!).min).toBeGreaterThan(0.6);
  });
  it.runIf(!!speech)('still hears talk over a quiet background track', () => {
    const bed = songPcm({ seconds: speech!.length / RATE, drums: false, gain: 0.5 });
    expect(talkFromPcm(mix(speech!, bed, 0.08)).mean).toBeGreaterThan(0.5);
  });

  it('calls a song with drums music', () => {
    expect(talkFromPcm(songPcm({ seconds: 16 })).max).toBeLessThan(0.3);
  });
  it('calls a song with sung vocals music', () => {
    expect(talkFromPcm(songPcm({ seconds: 16, vocals: true })).max).toBeLessThan(0.3);
  });
  it('calls a drumless piano ballad music', () => {
    expect(talkFromPcm(songPcm({ seconds: 16, drums: false, piano: true, bpm: 70 })).max).toBeLessThan(0.35);
  });
});
