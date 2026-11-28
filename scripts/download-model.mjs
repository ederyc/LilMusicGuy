// One-time setup: downloads the speech-recognition model (Whisper tiny, English, ~40 MB,
// from Hugging Face) into ./models so transcription can run fully on this machine.
// This is the only time anything is downloaded; the app itself never goes online:
// it loads the model from ./models with remote loading turned off.
//
//   npm run models
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, pipeline } from '@huggingface/transformers';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MODEL = 'onnx-community/whisper-tiny.en';
env.cacheDir = path.join(root, 'models');
env.allowRemoteModels = true;

console.log(`Downloading ${MODEL} into ${env.cacheDir} …`);
const asr = await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8', device: 'cpu' });
// quick self-check on a second of silence
await asr(new Float32Array(16000));
await asr.dispose();
console.log('Done. Transcription can now run offline.');
