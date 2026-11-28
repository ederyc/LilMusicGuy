import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RATE, sayPcm } from './helpers/audio';

// The transcriber is the desktop app's on-device speech recognizer (electron/transcriber.cjs).
// These run only where the model has been downloaded (`npm run models`) and macOS `say` exists.
const require = createRequire(import.meta.url);
const { createTranscriber, cleanText, cuesFrom } = require('../electron/transcriber.cjs');
const modelsDir = join(__dirname, '..', 'models');
const haveModel = existsSync(join(modelsDir, 'onnx-community', 'whisper-tiny.en', 'config.json'));

function to16k(pcm: Float32Array): Float32Array {
  const ratio = RATE / 16000;
  const out = new Float32Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let k = 0; k < ratio; k++) sum += pcm[i * ratio + k];
    out[i] = sum / ratio;
  }
  return out;
}

describe('transcriber', () => {
  it('ignores Whisper filler for silence', () => {
    expect(cleanText('[BLANK_AUDIO]')).toBe('');
    expect(cleanText('  you ')).toBe('');
    expect(cleanText(' Hello   there. ')).toBe('Hello there.');
  });

  it('turns words into reactions', () => {
    expect(cuesFrom('Hahaha, that is so true')).toEqual(['laugh']);
    expect(cuesFrom('Hey everybody, welcome back to the channel.')).toEqual(['greeting']);
    expect(cuesFrom('Do you like this song?')).toEqual(['music', 'question']);
    expect(cuesFrom('Whoa, no way.')).toEqual(['wow']);
    expect(cuesFrom('(laughing)')).toEqual(['laugh']);
    expect(cuesFrom('The quarterly numbers came in flat.')).toEqual([]);
  });

  const speech = haveModel ? sayPcm('Hello everybody, welcome back to the show. Do you like this song?') : null;
  it.runIf(!!speech)('turns speech into words, offline', async () => {
    const transcribe = await createTranscriber(modelsDir);
    const started = Date.now();
    const text: string = await transcribe(to16k(speech!));
    const seconds = (Date.now() - started) / 1000;
    console.log(`transcribed ${(speech!.length / RATE).toFixed(1)} s of audio in ${seconds.toFixed(2)} s: "${text}"`);
    expect(text.toLowerCase()).toMatch(/welcome back/);
    expect(text).toMatch(/\?/);
    // and it really can't reach the network now
    await expect(fetch('https://example.com')).rejects.toThrow(/disabled/);
  }, 60000);
});
