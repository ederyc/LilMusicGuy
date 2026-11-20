/**
 * Everything the character needs to know about the music, computed once per frame.
 * All band values are normalized to 0..1.
 */
export interface AudioFeatures {
  /** Seconds (same clock that was passed to the extractor). */
  time: number;
  /** Overall loudness, smoothed. */
  energy: number;
  bass: number;
  mid: number;
  treble: number;
  /** True only on the frame a beat onset was detected. */
  isBeat: boolean;
  /** 0..1 how pronounced the detected beat was (0 when isBeat is false). */
  beatStrength: number;
  /** Estimated tempo, or 0 while still unknown. */
  bpm: number;
  /**
   * Continuous beat clock. Integer part = beat count, fractional part = phase
   * within the current beat (0 = on the beat). Keeps ticking between detected
   * beats once the tempo is known, so animation stays smooth.
   */
  beat: number;
  /** Whether music is currently considered "playing" (not silence). */
  active: boolean;
}

/**
 * Anything that can hand us a frequency spectrum (byte magnitudes, like
 * AnalyserNode.getByteFrequencyData). Real audio and fake test data both
 * implement this, so the rest of the pipeline can't tell them apart.
 */
export interface SpectrumSource {
  readonly binCount: number;
  /** Width of one frequency bin in Hz (sampleRate / fftSize). */
  readonly binHz: number;
  read(out: Uint8Array, time: number): void;
}

export const SILENT_FEATURES: AudioFeatures = {
  time: 0,
  energy: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  isBeat: false,
  beatStrength: 0,
  bpm: 0,
  beat: 0,
  active: false,
};
