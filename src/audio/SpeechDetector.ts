/**
 * Tells people talking (videos, podcasts, streams, calls) apart from music, from the same
 * spectrum frames everything else uses. It only looks at levels in a few frequency bands;
 * it never hears words.
 *
 * What gives speech away:
 * - **Swing**: speech is syllables and pauses, so the voice band (300–3400 Hz) swings over
 *   a wide range (20+ dB) within a couple of seconds. A music mix stays much more level.
 * - **Gaps**: a good part of the time the voice band is well below its recent peak
 *   (between words and sentences). Music rarely leaves holes.
 * - **No sub-bass**: voices have little below ~85 Hz, so that band sits under the voice
 *   band; in nearly all music a kick or bass puts it well above.
 *
 * Each is scored 0..1, combined, and smoothed over a few seconds with hysteresis, so a
 * quiet bridge in a song doesn't flip him into "watching" mode.
 */
export interface SpeechReading {
  /** 0..1, smoothed: how much of what's playing is talking rather than music. */
  talk: number;
  /** Someone's voice is sounding right now (on during words, off in pauses). */
  speaking: boolean;
  /** Raw per-window evidence, for the test bench readout and tuning. */
  swingDb: number;
  gaps: number;
  subBass: number;
}

/** AnalyserNode byte scale: 0..255 spans minDecibels..maxDecibels (-100..-30 dB by default). */
const DB_PER_BYTE = 70 / 255;
const WINDOW_SECONDS = 3;
/** How quickly the talk estimate follows the evidence (1/s). */
const RISE = 0.6;
const FALL = 0.45;

export class SpeechDetector {
  private times: number[] = [];
  private voice: number[] = [];
  private sub: number[] = [];
  private talkLevel = 0;
  private lastTime: number | null = null;
  private reading: SpeechReading = { talk: 0, speaking: false, swingDb: 0, gaps: 0, subBass: 0 };

  process(spectrum: Uint8Array, binHz: number, time: number, active: boolean): SpeechReading {
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(0.25, time - this.lastTime));
    this.lastTime = time;

    const band = (lo: number, hi: number) => {
      const a = Math.max(1, Math.round(lo / binHz));
      const b = Math.min(spectrum.length - 1, Math.round(hi / binHz));
      let sum = 0;
      for (let i = a; i <= b; i++) sum += spectrum[i];
      return b >= a ? sum / (b - a + 1) : 0;
    };
    const voice = band(300, 3400);
    const sub = band(35, 85);

    this.times.push(time);
    this.voice.push(voice);
    this.sub.push(sub);
    while (this.times.length && time - this.times[0] > WINDOW_SECONDS) {
      this.times.shift();
      this.voice.shift();
      this.sub.shift();
    }

    const sorted = [...this.voice].sort((x, y) => x - y);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    const hi = pct(0.9);
    const lo = pct(0.1);
    const swingDb = (hi - lo) * DB_PER_BYTE;
    // Gaps: time spent at least 15 dB under the recent peak.
    const gapLine = hi - 15 / DB_PER_BYTE;
    const gaps = this.voice.filter((v) => v < gapLine).length / Math.max(1, this.voice.length);
    // Sub-bass relative to the voice band, in dB (louder voice band → more negative).
    const subAvg = this.sub.reduce((a, b) => a + b, 0) / Math.max(1, this.sub.length);
    const subBass = (subAvg - hi) * DB_PER_BYTE;

    const full = this.times.length > 1 && time - this.times[0] > WINDOW_SECONDS * 0.6;
    let evidence = 0;
    if (active && full && hi > 40) {
      const swingScore = ramp(swingDb, 12, 24);
      const gapScore = ramp(gaps, 0.08, 0.25);
      // Music's kick and bass sit well above the voice band (+15 dB or more); a voice
      // alone leaves the sub-bass below it.
      const noSubScore = ramp(-subBass, -10, 3);
      // Swing and gaps are the main tells; missing sub-bass confirms it. With bass present
      // (talk over a background track) it takes stronger swing and gaps to count.
      evidence = (0.45 * swingScore + 0.35 * gapScore + 0.2 * noSubScore) * (0.55 + 0.45 * noSubScore);
      evidence = ramp(evidence, 0.3, 0.65);
    }
    const rate = evidence > this.talkLevel ? RISE : FALL;
    this.talkLevel += (evidence - this.talkLevel) * (1 - Math.exp(-dt * rate));
    if (!active) this.talkLevel *= Math.exp(-dt * 0.5);

    this.reading = {
      talk: this.talkLevel,
      speaking: active && voice > gapLine + 6 / DB_PER_BYTE && voice > 40,
      swingDb,
      gaps,
      subBass,
    };
    return this.reading;
  }

  get current(): SpeechReading {
    return this.reading;
  }

  reset(): void {
    this.times = [];
    this.voice = [];
    this.sub = [];
    this.talkLevel = 0;
    this.lastTime = null;
  }
}

function ramp(x: number, lo: number, hi: number): number {
  return x <= lo ? 0 : x >= hi ? 1 : (x - lo) / (hi - lo);
}
