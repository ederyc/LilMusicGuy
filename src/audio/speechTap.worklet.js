// Audio worklet: mixes what he hears to mono, resamples it to 16 kHz (what the speech
// recognizer wants) and hands it to the page in half-second pieces. Runs only while the
// "understand speech" option is on; the audio stays in memory.
class SpeechTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000; // input samples per output sample
    this.acc = 0;
    this.count = 0;
    this.pos = 0;
    this.out = new Float32Array(8000);
    this.n = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const frames = input[0].length;
    for (let i = 0; i < frames; i++) {
      let s = 0;
      for (let c = 0; c < input.length; c++) s += input[c][i];
      // box filter over each output sample's span: cheap anti-aliasing for speech
      this.acc += s / input.length;
      this.count++;
      this.pos += 1;
      if (this.pos >= this.step) {
        this.pos -= this.step;
        this.out[this.n++] = this.acc / this.count;
        this.acc = 0;
        this.count = 0;
        if (this.n === this.out.length) {
          this.port.postMessage(this.out, [this.out.buffer]);
          this.out = new Float32Array(8000);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('lmg-speech-tap', SpeechTap);
