// Prints what the vibe detector hears for each simulated style: npx vite-node scripts/calibrate.ts
import { FeatureExtractor } from '../src/audio/FeatureExtractor';
import { SIM_STYLES, SimulatedSource, type SimStyleName } from '../src/audio/sources/SimulatedSource';
import { VibeDetector, rank } from '../src/audio/VibeDetector';

for (const style of Object.keys(SIM_STYLES) as SimStyleName[]) {
  const src = new SimulatedSource({ style });
  const ex = new FeatureExtractor();
  const vd = new VibeDetector();
  const buf = new Uint8Array(src.binCount);
  const raw = { centroid: 0, contrast: 0, bassShare: 0, flux: 0, n: 0 };
  let v;
  for (let t = 0; t < 20; t += 1 / 60) {
    src.read(buf, t);
    const f = ex.process(buf, src.binHz, t);
    v = vd.process(buf, src.binHz, f);
    if (t > 10 && vd.raw) { raw.centroid += vd.raw.centroid; raw.contrast += vd.raw.contrast; raw.bassShare += vd.raw.bassShare; raw.flux += vd.raw.flux; raw.n++; }
  }
  const tr = Object.fromEntries(Object.entries(v!.traits).map(([k, x]) => [k, +x.toFixed(2)]));
  console.log(style.padEnd(7), '→', String(v!.name).padEnd(9), JSON.stringify(tr));
  console.log('        raw', `centroid ${(2 ** (raw.centroid / raw.n)).toFixed(0)}Hz contrast ${(raw.contrast / raw.n).toFixed(1)}dB bassShare ${(raw.bassShare / raw.n).toFixed(3)} flux ${(raw.flux / raw.n).toFixed(4)}`, rank(v!.traits).slice(0, 3).map((r) => `${r.name}:${r.d.toFixed(3)}`).join(' '));
}
