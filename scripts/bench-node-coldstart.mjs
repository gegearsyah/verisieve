
import { getVerisieveDlInstanceSync } from '../src/wasm-needle-dl.js';
const t0 = performance.now();
const inst = getVerisieveDlInstanceSync();
const wasmInitMs = performance.now() - t0;
const n = 1207;
let safeCount = 0;
for (let i = 0; i < n; i++) {
  let z = 0.05;
  for (let j = 0; j < 520; j++) z += 0.002 * ((j % 11) - 5) * 0.01 * ((i + j) % 17);
  if (z >= 0.72) safeCount++;
}
const totalMs = performance.now() - t0;
console.log(JSON.stringify({ wasmInitMs, totalMs, safeCount }));
