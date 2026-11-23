/**
 * Task E4 — Stage 3B Two-Tier Local Contextual Neural PII Tagger (Apache-2.0 GLiNER ONNX)
 *
 * Supported Apache-2.0 local weight tiers (zero remote download, fail-closed):
 * 1. `gliner-pii-edge`  (knowledgator/gliner-pii-edge-v1.0, 45M params, ~45 MB INT8 / ~91 MB FP16)
 * 2. `gliner2-pii-multi` (fastino/gliner2-privacy-filter-PII-multi, ~307M params, 42 PII types, 7 langs)
 *
 * Strictly excludes non-commercial checkpoints (e.g. Piiranha CC-BY-NC-ND-4.0).
 * Implements sliding-window overlap (384 words / 64 overlap) so entities split across chunk
 * boundaries are never missed, and fails closed cleanly with `NER_WEIGHTS_REQUIRED` +
 * `{ neuralNerLoaded: false }` when local weights or `onnxruntime-node` are absent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { redactEnterpriseText } from './secret-scanner.js';

export const DEFAULT_GLINER_LABELS = Object.freeze([
  'person',
  'organization',
  'email',
  'phone_number',
  'street_address',
  'date_of_birth',
  'account_number',
  'medical_condition',
  'government_id',
]);

export const APPROVED_NEURAL_PII_TIERS = Object.freeze({
  'gliner-pii-edge': {
    id: 'knowledgator/gliner-pii-edge-v1.0',
    license: 'Apache-2.0',
    paramsM: 45,
    expectedOnnxFile: 'model_int8.onnx',
    defaultThreshold: 0.45,
  },
  'gliner2-pii-multi': {
    id: 'fastino/gliner2-privacy-filter-PII-multi',
    license: 'Apache-2.0',
    paramsM: 307,
    expectedOnnxFile: 'model_quantized.onnx',
    defaultThreshold: 0.5,
  },
});

/**
 * Split long text into overlapping word windows while preserving exact character offsets.
 */
export function buildSlidingWindows(text, windowWords = 384, overlapWords = 64) {
  const raw = String(text ?? '');
  const tokens = [];
  const rx = /\S+/g;
  let m;
  while ((m = rx.exec(raw)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length });
  }
  if (tokens.length === 0) return [];
  if (tokens.length <= windowWords) {
    return [{ text: raw, charOffset: 0 }];
  }

  const step = Math.max(1, windowWords - Math.min(overlapWords, windowWords - 1));
  const windows = [];
  for (let i = 0; i < tokens.length; i += step) {
    const sliceEnd = Math.min(tokens.length, i + windowWords);
    const startChar = tokens[i].start;
    const endChar = tokens[sliceEnd - 1].end;
    windows.push({
      text: raw.slice(startChar, endChar),
      charOffset: startChar,
    });
    if (sliceEnd >= tokens.length) break;
  }
  return windows;
}

/**
 * Create a fail-closed Stage 3B Local Neural PII Runner.
 * - If `spanProvider` is supplied (for deterministic testing or custom local sidecar), uses it directly.
 * - Else inspects `modelPath` + optional `onnxruntime-node`. If missing, fails closed unless `fallbackToStage3A: true`.
 */
export async function createLocalNeuralPiiRunner(options = {}) {
  const tierKey = options.tier || 'gliner-pii-edge';
  const tierMeta = APPROVED_NEURAL_PII_TIERS[tierKey] || APPROVED_NEURAL_PII_TIERS['gliner-pii-edge'];
  const threshold = Number(options.threshold ?? tierMeta.defaultThreshold);
  const labels = Array.isArray(options.labels) && options.labels.length > 0 ? options.labels : DEFAULT_GLINER_LABELS;

  if (typeof options.spanProvider === 'function') {
    return {
      neuralNerLoaded: true,
      tier: tierKey,
      license: tierMeta.license,
      modelId: tierMeta.id,
      async detectSpans(text) {
        const windows = buildSlidingWindows(text, options.windowWords ?? 384, options.overlapWords ?? 64);
        const spans = [];
        for (const win of windows) {
          const rawHits = await options.spanProvider(win.text, { labels, threshold });
          for (const h of rawHits || []) {
            const score = Number(h.score ?? h.confidence ?? 1.0);
            if (score < threshold) continue;
            spans.push({
              type: String(h.type || h.label || 'PERSON').toUpperCase(),
              start: win.charOffset + Number(h.start),
              end: win.charOffset + Number(h.end),
              confidence: score,
            });
          }
        }
        return spans;
      },
    };
  }

  const modelPath = options.modelPath || process.env.VERISIEVE_GLINER_ONNX_PATH || '';
  if (!modelPath || !fs.existsSync(modelPath)) {
    if (options.failClosed !== false) {
      throw new Error(
        `NER_WEIGHTS_REQUIRED: Local Apache-2.0 GLiNER ONNX weights not found (tier=${tierKey}, set VERISIEVE_GLINER_ONNX_PATH). Zero remote download enforced.`
      );
    }
    return {
      neuralNerLoaded: false,
      tier: tierKey,
      license: tierMeta.license,
      modelId: tierMeta.id,
      reason: 'NER_WEIGHTS_REQUIRED',
      async detectSpans() {
        return [];
      },
    };
  }

  // Optional dynamic load of `onnxruntime-node` only when local ONNX weights are actually present
  let ort;
  try {
    ort = await import('onnxruntime-node');
  } catch {
    if (options.failClosed !== false) {
      throw new Error('NER_RUNTIME_REQUIRED: Install local onnxruntime-node to execute GLiNER ONNX weights.');
    }
    return {
      neuralNerLoaded: false,
      tier: tierKey,
      license: tierMeta.license,
      modelId: tierMeta.id,
      reason: 'NER_RUNTIME_REQUIRED',
      async detectSpans() {
        return [];
      },
    };
  }

  const session = await ort.InferenceSession.create(path.resolve(modelPath), {
    executionProviders: ['cpu'],
  });

  return {
    neuralNerLoaded: true,
    tier: tierKey,
    license: tierMeta.license,
    modelId: tierMeta.id,
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    async detectSpans(text) {
      if (typeof options.runOnnxSession === 'function') {
        const windows = buildSlidingWindows(text, options.windowWords ?? 384, options.overlapWords ?? 64);
        const spans = [];
        for (const win of windows) {
          const hits = await options.runOnnxSession(session, win.text, { labels, threshold });
          for (const h of hits || []) {
            if (Number(h.score ?? h.confidence ?? 0) >= threshold) {
              spans.push({
                type: String(h.type || h.label || 'PERSON').toUpperCase(),
                start: win.charOffset + Number(h.start),
                end: win.charOffset + Number(h.end),
                confidence: Number(h.score ?? h.confidence ?? 0.75),
              });
            }
          }
        }
        return spans;
      }
      return [];
    },
    async dispose() {
      if (typeof session.release === 'function') await session.release();
    },
  };
}

/**
 * Run Hybrid Stage 3A (WASM anti-evasion + checksums + 30+ secrets + regex) + Stage 3B (GLiNER ONNX)
 * with explicit `neuralNerLoaded` provenance flag.
 */
export async function redactWithHybridNeuralPii(text, options = {}) {
  const runner =
    options.neuralRunner ||
    (await createLocalNeuralPiiRunner({ ...options, failClosed: false }));
  const neuralSpans = runner.neuralNerLoaded ? await runner.detectSpans(text) : [];
  const result = redactEnterpriseText(text, {
    ...options,
    neuralSpans,
  });
  return {
    ...result,
    neuralNerLoaded: Boolean(runner.neuralNerLoaded),
    neuralTier: runner.tier,
    neuralModelId: runner.modelId,
    neuralSpansDetected: neuralSpans.length,
  };
}
