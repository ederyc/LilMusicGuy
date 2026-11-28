// On-device speech recognition (Whisper tiny, English) for the "understand speech" option.
//
// Runs in its own process (an Electron utility process), separate from the window and the
// main app, and is only started when the user turns the option on.
//
// Privacy rules this file keeps:
// - Audio comes in as short in-memory chunks; nothing is ever written to disk.
// - The model loads from local files only (`npm run models` downloads it once); remote
//   model loading is off and `fetch` is disabled in this process, so it cannot go online.
// - The words never leave this process: it reports only a reaction ("laugh",
//   "question", …) and a word count, then the text is dropped. Nothing is logged.

const MODEL = 'onnx-community/whisper-tiny.en';
/** Whisper hears 16 kHz mono. Chunks longer than this are cut (Whisper's own limit is 30 s). */
const SAMPLE_RATE = 16000;
const MAX_SECONDS = 15;

function disableNetwork() {
  const refuse = () => Promise.reject(new Error('Network access is disabled in the transcriber.'));
  globalThis.fetch = refuse;
  for (const mod of ['node:http', 'node:https', 'node:net', 'node:tls']) {
    try {
      const m = require(mod);
      for (const fn of ['request', 'get', 'connect', 'createConnection']) {
        if (typeof m[fn] === 'function') {
          m[fn] = () => {
            throw new Error('Network access is disabled in the transcriber.');
          };
        }
      }
    } catch {
      /* module not present */
    }
  }
}

/** Load the model from `modelsDir` (no downloads). Resolves to `(Float32Array) => Promise<string>`. */
async function createTranscriber(modelsDir) {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = modelsDir;
  env.cacheDir = modelsDir;
  disableNetwork();
  const asr = await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8', device: 'cpu' });
  return async (samples) => {
    if (!(samples instanceof Float32Array) || samples.length < SAMPLE_RATE * 0.3) return '';
    const clip = samples.length > SAMPLE_RATE * MAX_SECONDS ? samples.subarray(samples.length - SAMPLE_RATE * MAX_SECONDS) : samples;
    const out = await asr(clip);
    return cleanText(Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text);
  };
}

/** Whisper's filler for silence/noise ("[BLANK_AUDIO]", "(music)", "you") isn't speech. */
function cleanText(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (/^[[(](blank_audio|music|silence|no speech)[\])]$/i.test(t)) return '';
  if (/^(you|\.|thank you\.)$/i.test(t)) return '';
  return t.slice(0, 500);
}

/**
 * Turn what was said into reactions. This is the only thing that leaves this process:
 * a few fixed words like "laugh" or "question", never the text itself.
 */
const CUE_PATTERNS = [
  ['laugh', /\b(ha(ha)+|haha|lol|lmao)\b|[[(](laugh|laughs|laughing|laughter)[\])]/i],
  ['wow', /\b(wow|whoa|woah|no way|oh my god|omg|incredible|insane|amazing)\b/i],
  ['greeting', /\b(hello|hi there|hey (guys|everyone|everybody|y'?all)|welcome( back)?|what'?s up)\b/i],
  ['music', /\b(music|song|songs|beat|dance|dancing|playlist|album)\b|[[(]music[\])]/i],
  ['question', /\?\s*$/],
];

function cuesFrom(text) {
  const cues = [];
  for (const [cue, re] of CUE_PATTERNS) if (re.test(text)) cues.push(cue);
  return cues;
}

module.exports = { createTranscriber, cleanText, cuesFrom, SAMPLE_RATE };

// --- As an Electron utility process ---------------------------------------------------
if (process.parentPort) {
  let ready = null;
  let busy = false;
  process.parentPort.on('message', async ({ data }) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'init' && typeof data.modelsDir === 'string') {
      ready = createTranscriber(data.modelsDir);
      ready.then(
        () => process.parentPort.postMessage({ type: 'ready' }),
        (err) => process.parentPort.postMessage({ type: 'error', message: String(err?.message ?? err).slice(0, 300) }),
      );
      return;
    }
    if (data.type === 'audio' && ready) {
      // One at a time; if it's still working on the last chunk, drop this one (he'll
      // catch the next). Keeps CPU use bounded.
      if (busy) return;
      busy = true;
      try {
        const transcribe = await ready;
        const samples = data.samples instanceof Float32Array ? data.samples : new Float32Array(data.samples ?? []);
        const text = await transcribe(samples);
        // Only the reaction leaves this process; the words are dropped right here.
        const [cue] = cuesFrom(text);
        process.parentPort.postMessage({ type: 'heard', cue: cue ?? null, words: text ? text.split(' ').length : 0 });
      } catch (err) {
        process.parentPort.postMessage({ type: 'error', message: String(err?.message ?? err).slice(0, 300) });
      } finally {
        busy = false;
      }
    }
  });
}
