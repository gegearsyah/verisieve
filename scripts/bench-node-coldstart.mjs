import { getVerisieveDlInstanceSync } from '../src/wasm-needle-dl.js';

const n = parseInt(process.argv[2] || '1207', 10);
const passes = parseInt(process.argv[3] || '200', 10);

const t0 = performance.now();
const inst = getVerisieveDlInstanceSync();
const inProcessWasmInitMs = Number((performance.now() - t0).toFixed(3));

const X = new Float32Array(n * 520);
const w = new Float32Array(520);
for (let j = 0; j < 520; j++) w[j] = 0.002 * ((j % 11) - 5);
for (let i = 0; i < n; i++) {
  for (let j = 0; j < 520; j++) X[i * 520 + j] = 0.01 * ((i + j) % 17);
}

// Warmup JIT if hot-loop benchmark (>1 pass)
if (passes > 1) {
  for (let i = 0; i < n; i++) {
    let z = 0.05;
    const base = i * 520;
    for (let j = 0; j < 520; j++) z += X[base + j] * w[j];
    const p = 1.0 / (1.0 + Math.exp(-z));
    if (p >= 0.72) z += 0;
  }
}

let safeCount = 0;
let sumP = 0;
const tHot0 = performance.now();
for (let r = 0; r < passes; r++) {
  safeCount = 0;
  for (let i = 0; i < n; i++) {
    let z = 0.05;
    const base = i * 520;
    for (let j = 0; j < 520; j++) z += X[base + j] * w[j];
    const p = 1.0 / (1.0 + Math.exp(-z));
    sumP += p;
    if (p >= 0.72) safeCount++;
  }
}
const hotLoopMs = Number(((performance.now() - tHot0) / passes).toFixed(4));
const peakRssMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));

console.log(JSON.stringify({
  n,
  passes,
  inProcessWasmInitMs,
  hotLoopMs,
  peakRssMb,
  safeCount,
  avgP: Number((sumP / (n * passes)).toFixed(6)),
  nodeVersion: process.version
}));
