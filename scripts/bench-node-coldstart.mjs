import { getVersieveDlInstanceSync } from '../src/wasm-needle-dl.js';

const n = parseInt(process.argv[2] || '1207', 10);
const passes = parseInt(process.argv[3] || '200', 10);

const t0 = performance.now();
const inst = getVersieveDlInstanceSync();
const exp = inst.exports;
const inProcessWasmInitMs = Number((performance.now() - t0).toFixed(3));

const dim = 64;
const dModel = 16;
const nLayers = 2;
const rank = 4;
const backboneSeed = 101;
const trainSeed = 42;

const vbBytes = exp.mle_dl_vera_backbone_bytes(dim, dModel, nLayers);
const vsCnt = exp.mle_dl_vera_scale_count(nLayers);
const vpCnt = exp.mle_dl_vera_param_count(dModel, nLayers, rank, 1);

const xPtr = exp.mle_dl_alloc(n * dim * 4);
const vbPtr = exp.mle_dl_alloc(vbBytes);
const vsPtr = exp.mle_dl_alloc(vsCnt * 4);
const vpPtr = exp.mle_dl_alloc(vpCnt * 4);
const outPtr = exp.mle_dl_alloc(n * 4);

let hotLoopMs = 0;
let safeCount = 0;
let sumP = 0;

try {
  const xData = new Float32Array(n * dim);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < dim; j++) {
      xData[i * dim + j] = ((i * 31 + j * 17) % 100) / 100.0;
    }
  }
  new Float32Array(exp.memory.buffer, xPtr, n * dim).set(xData);

  exp.mle_dl_vera_init_backbone(vbPtr, vsPtr, dim, dModel, nLayers, backboneSeed);
  exp.mle_dl_vera_init_params(vpPtr, dModel, nLayers, rank, 1, trainSeed);

  if (passes > 1) {
    exp.mle_dl_vera_predict(xPtr, vbPtr, vsPtr, vpPtr, outPtr, n, dim, dModel, nLayers, rank, 0, 1, backboneSeed);
  }

  const tHot0 = performance.now();
  for (let r = 0; r < passes; r++) {
    exp.mle_dl_vera_predict(xPtr, vbPtr, vsPtr, vpPtr, outPtr, n, dim, dModel, nLayers, rank, 0, 1, backboneSeed);
    const preds = new Float32Array(exp.memory.buffer, outPtr, n);
    safeCount = 0;
    for (let i = 0; i < n; i++) {
      const p = preds[i];
      sumP += p;
      if (p >= 0.5) safeCount++;
    }
  }
  hotLoopMs = Number(((performance.now() - tHot0) / passes).toFixed(4));
} finally {
  exp.mle_dl_free(xPtr, n * dim * 4);
  exp.mle_dl_free(vbPtr, vbBytes);
  exp.mle_dl_free(vsPtr, vsCnt * 4);
  exp.mle_dl_free(vpPtr, vpCnt * 4);
  exp.mle_dl_free(outPtr, n * 4);
}

const peakRssMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));

console.log(JSON.stringify({
  n,
  passes,
  inProcessWasmInitMs,
  hotLoopMs,
  peakRssMb,
  safeCount,
  avgP: Number((sumP / Math.max(1, n * passes)).toFixed(6)),
  wasmKernelExecuted: true,
  nodeVersion: process.version,
}));
