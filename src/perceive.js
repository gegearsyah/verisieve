/**
 * Versieve Unified Multimodal Perception & Graph-Coupled Conformal Redaction (`GC-CRC`)
 *
 * Implements:
 * 1. `GC-CRC` (Graph-Coupled Cross-Modal Conformal Risk Control):
 *    - Addresses the "Fragmented Context Horizon" of traditional chunk-isolated redactors
 *      (Presidio, vanilla GLiNER, standard LTT) where entities introduced with clear context
 *      in one paragraph/modality (e.g., "Applicant: Mr. Markus Pentikäinen" in an email or
 *      Page 1 of a ruling) reappear as bare, inflected, or ASR/OCR-corrupted mentions
 *      ("pentikainen", "elena vans") in later paragraphs, audio turns, or video slides.
 *    - Seeds a bounded Salted Reference Anchor Pool `A = {(entityId, sig128, nodeId)}` from
 *      high-confidence spans using `versieve_media.wasm`'s 128-bit salted Bloom+Soundex
 *      signature (`vs_media_pprl_signature`).
 *    - Propagates anchor risk across all chunks and modalities via Dual-CSR Personalized
 *      PageRank (`versieve_graph.wasm`) + phonetic Dice similarity, recovering cross-chunk
 *      and cross-modal mentions without lowering the global NER threshold (avoiding the
 *      precision collapse of low-threshold isolated NER).
 * 2. `perceive()` / `perceiveMulti()`:
 *    - One-call multimodal perception pipeline converting any document, archive, spreadsheet,
 *      email, audio recording, or video keyframe set into:
 *      (a) Structured Perception Stream (`<DOC><BLOCK modality="..." role="..." gate="...">...`)
 *      (b) Clean redacted Markdown (`markdown`)
 *      (c) Ready-to-train tokenized SFT / RAG chunks (`chunks`, `sftJsonl`)
 *      (d) Live Dual-CSR Knowledge Graph (`graph`, `<1 ms` PPR & GDPR Art. 17 `blastRadius`)
 *      (e) Cryptographic SHA-256 provenance receipt (`receipt`).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadMediaWasmSync, pprlDiceSimilarity } from './media-wasm.js';
import { loadCleanWasmSync } from './clean-wasm.js';
import {
  PortableDocumentGraph,
  SaltedPseudonymVault,
} from './graph-wasm.js';
import { parseEnterpriseBuffer } from './enterprise-parsers.js';
import { redactEnterpriseText } from './secret-scanner.js';
import { compileTermList, matchTermKeysInText } from './term-matcher.js';
import { redactAudioCall } from './audio-redactor.js';
import { redactVideoKeyframes } from './video-redactor.js';
import { extractPdfDetailed } from './pdf-parser.js';
import { extractDocxStructured } from './structure-extractor.js';
import { decodePngBuffer } from './ocr-engine.js';
import { extractFeatureRow, createTokenizer } from './clean-and-tokenize.js';
import {
  decideGatekeeper,
  mapGateActionToPolicy,
  GATE_REJECTION_REASONS,
  GATE_RECOVERABILITY,
  createCalibrationObservation,
} from './gatekeeper.js';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// ---------------------------------------------------------------------------
// Pluggable Stage 3B Local Detector Adapter Contract & IoU Helpers
// ---------------------------------------------------------------------------

const DISALLOWED_EGRESS_KEYS = Object.freeze([
  'remoteUrl',
  'endpoint',
  'apiUrl',
  'baseUrl',
  'url',
  'webhookUrl',
  'cloudEndpoint',
  'cloudProvider',
]);

const REMOTE_URI_RE = /^(?:https?|wss?|ftp|s3|gs):\/\//i;

/**
 * Structured fail-closed error thrown when a pluggable Stage 3B detector adapter
 * violates zero-egress policy, is missing local runtimes/weights, throws during
 * execution, or returns malformed spans.
 */
export class DetectorAdapterError extends Error {
  constructor(code, message, { adapterId = null, details = null, cause = undefined } = {}) {
    super(`${code}: ${message}`);
    this.name = 'DetectorAdapterError';
    this.code = code;
    this.adapterId = adapterId;
    this.details = details;
    if (cause !== undefined) this.cause = cause;
  }
}

function normalizeBoxCoords(box, label = 'box') {
  if (!box || typeof box !== 'object') {
    throw new TypeError(`INVALID_BBOX: ${label} must be an object or 4-element array`);
  }
  let x1;
  let y1;
  let x2;
  let y2;
  let normalized = false;

  if (Array.isArray(box)) {
    if (box.length !== 4) {
      throw new TypeError(`INVALID_BBOX: ${label} array must have 4 elements [x1, y1, x2, y2]`);
    }
    [x1, y1, x2, y2] = box.map(Number);
  } else {
    normalized = Boolean(box.normalized);
    if (box.x1 !== undefined && box.y1 !== undefined && box.x2 !== undefined && box.y2 !== undefined) {
      x1 = Number(box.x1);
      y1 = Number(box.y1);
      x2 = Number(box.x2);
      y2 = Number(box.y2);
    } else if (
      box.x !== undefined &&
      box.y !== undefined &&
      (box.width !== undefined || box.w !== undefined) &&
      (box.height !== undefined || box.h !== undefined)
    ) {
      x1 = Number(box.x);
      y1 = Number(box.y);
      const w = Number(box.width ?? box.w);
      const h = Number(box.height ?? box.h);
      x2 = x1 + w;
      y2 = y1 + h;
    } else {
      throw new TypeError(`INVALID_BBOX: ${label} must specify { x, y, width, height } or { x1, y1, x2, y2 }`);
    }
  }

  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    throw new TypeError(`INVALID_BBOX: ${label} coordinates must be finite numbers`);
  }
  const width = x2 - x1;
  const height = y2 - y1;
  return { x: x1, y: y1, width, height, x1, y1, x2, y2, normalized };
}

/**
 * Computes Intersection-over-Union (IoU) in `[0, 1]` between two bounding boxes.
 * Accepts `{ x, y, width, height, normalized? }`, `{ x, y, w, h }`, `{ x1, y1, x2, y2 }`,
 * or `[x1, y1, x2, y2]`.
 */
export function computeBoxIoU(boxA, boxB) {
  const a = normalizeBoxCoords(boxA, 'boxA');
  const b = normalizeBoxCoords(boxB, 'boxB');
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return 0;

  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) return 0;

  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

function projectBoxToPixels(bbox, width, height) {
  const c = normalizeBoxCoords(bbox, 'bbox');
  if (c.normalized) {
    const w = Number(width || 0);
    const h = Number(height || 0);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    const x1 = Math.max(0, Math.min(w, Math.round(c.x * w)));
    const y1 = Math.max(0, Math.min(h, Math.round(c.y * h)));
    const x2 = Math.max(x1, Math.min(w, Math.round((c.x + c.width) * w)));
    const y2 = Math.max(y1, Math.min(h, Math.round((c.y + c.height) * h)));
    return { x1, y1, x2, y2 };
  }
  const x1 = Math.max(0, Math.round(c.x1));
  const y1 = Math.max(0, Math.round(c.y1));
  const x2 = Math.max(x1, Math.round(c.x2));
  const y2 = Math.max(y1, Math.round(c.y2));
  if (width > 0 && height > 0) {
    return {
      x1: Math.min(width, x1),
      y1: Math.min(height, y1),
      x2: Math.min(width, x2),
      y2: Math.min(height, y2),
    };
  }
  return { x1, y1, x2, y2 };
}

function normalizeAdapterKinds(kind) {
  const allowed = new Set(['text', 'image']);
  if (typeof kind === 'string') {
    const k = kind.trim().toLowerCase();
    if (k === 'multimodal' || k === 'both') return ['text', 'image'];
    if (allowed.has(k)) return [k];
    return null;
  }
  if (Array.isArray(kind) && kind.length > 0) {
    const out = [];
    for (const item of kind) {
      const k = String(item || '').trim().toLowerCase();
      if (!allowed.has(k)) return null;
      if (!out.includes(k)) out.push(k);
    }
    return out;
  }
  return null;
}

/**
 * Pure fail-closed validator for a pluggable Stage 3B detector adapter.
 * Enforces:
 * - Valid adapter contract (`id`, `kind`, `detect`)
 * - Zero-egress policy (rejects remote URLs, `egress: true`, `allowNetwork: true`, `localOnly: false`)
 * - Local weights/runtime availability (`modelPath`/`weightsPath`, `runtimeAvailable`, `weightsAvailable`, sync `runtimeCheck`)
 */
export function validateDetectorAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new DetectorAdapterError(
      'DETECTOR_ADAPTER_INVALID',
      'Detector adapter must be a non-null object'
    );
  }
  const adapterId = typeof adapter.id === 'string' && adapter.id.trim() ? adapter.id.trim() : null;
  if (!adapterId) {
    throw new DetectorAdapterError(
      'DETECTOR_ADAPTER_INVALID',
      'Detector adapter requires a non-empty string `id`'
    );
  }
  if (typeof adapter.detect !== 'function') {
    throw new DetectorAdapterError(
      'DETECTOR_ADAPTER_INVALID',
      `Detector adapter "${adapterId}" requires a \`detect\` function`,
      { adapterId }
    );
  }
  const kinds = normalizeAdapterKinds(adapter.kind);
  if (!kinds) {
    throw new DetectorAdapterError(
      'DETECTOR_ADAPTER_INVALID',
      `Detector adapter "${adapterId}" must specify kind "text", "image", "multimodal", or ["text","image"]`,
      { adapterId }
    );
  }

  // Zero-egress enforcement: forbid remote endpoints or explicit egress opt-ins
  for (const key of DISALLOWED_EGRESS_KEYS) {
    if (adapter[key] !== undefined && adapter[key] !== null && adapter[key] !== '' && adapter[key] !== false) {
      throw new DetectorAdapterError(
        'DETECTOR_EGRESS_FORBIDDEN',
        `Detector adapter "${adapterId}" declares disallowed remote configuration key "${key}". Zero-egress policy enforced.`,
        { adapterId, details: { forbiddenKey: key } }
      );
    }
  }
  if (adapter.egress === true || adapter.allowNetwork === true || adapter.localOnly === false) {
    throw new DetectorAdapterError(
      'DETECTOR_EGRESS_FORBIDDEN',
      `Detector adapter "${adapterId}" attempted to enable network egress. Zero-egress policy enforced.`,
      { adapterId }
    );
  }

  for (const pathKey of ['modelPath', 'weightsPath']) {
    const p = adapter[pathKey];
    if (p !== undefined && p !== null && p !== '') {
      if (typeof p !== 'string') {
        throw new DetectorAdapterError(
          'DETECTOR_ADAPTER_INVALID',
          `Detector adapter "${adapterId}" ${pathKey} must be a local file path string`,
          { adapterId }
        );
      }
      if (REMOTE_URI_RE.test(p.trim())) {
        throw new DetectorAdapterError(
          'DETECTOR_EGRESS_FORBIDDEN',
          `Detector adapter "${adapterId}" ${pathKey} cannot reference a remote URI. Zero-egress policy enforced.`,
          { adapterId, details: { pathKey } }
        );
      }
      if (!fs.existsSync(p)) {
        throw new DetectorAdapterError(
          'DETECTOR_WEIGHTS_MISSING',
          `Detector adapter "${adapterId}" local weights/model path not found: ${p}`,
          { adapterId, details: { pathKey, path: p } }
        );
      }
    }
  }

  if (adapter.runtimeAvailable === false) {
    throw new DetectorAdapterError(
      'DETECTOR_RUNTIME_MISSING',
      `Detector adapter "${adapterId}" reports local runtime unavailable`,
      { adapterId }
    );
  }
  if (adapter.weightsAvailable === false) {
    throw new DetectorAdapterError(
      'DETECTOR_WEIGHTS_MISSING',
      `Detector adapter "${adapterId}" reports local model weights unavailable`,
      { adapterId }
    );
  }

  if (typeof adapter.runtimeCheck === 'function') {
    let checkRes;
    try {
      checkRes = adapter.runtimeCheck();
    } catch (err) {
      if (err instanceof DetectorAdapterError) throw err;
      throw new DetectorAdapterError(
        'DETECTOR_RUNTIME_MISSING',
        `Detector adapter "${adapterId}" runtimeCheck failed: ${err?.message || String(err)}`,
        { adapterId, cause: err }
      );
    }
    if (checkRes && typeof checkRes.then !== 'function') {
      if (checkRes === false || (typeof checkRes === 'object' && checkRes.ok === false)) {
        throw new DetectorAdapterError(
          'DETECTOR_RUNTIME_MISSING',
          `Detector adapter "${adapterId}" runtimeCheck reported unavailable: ${checkRes?.reason || 'runtime unavailable'}`,
          { adapterId, details: typeof checkRes === 'object' ? checkRes : null }
        );
      }
    }
  }

  return Object.freeze({
    id: adapterId,
    kind: kinds.length === 2 ? 'multimodal' : kinds[0],
    kinds: Object.freeze(kinds),
    provenanceTag:
      typeof adapter.provenanceTag === 'string' && adapter.provenanceTag.trim()
        ? adapter.provenanceTag.trim()
        : `adapter:${adapterId}`,
    localOnly: true,
    modelPath: adapter.modelPath ?? null,
    weightsPath: adapter.weightsPath ?? null,
    runtimeCheck: typeof adapter.runtimeCheck === 'function' ? adapter.runtimeCheck : null,
    detect: adapter.detect,
  });
}

/**
 * Pure factory creating a validated, frozen, stateless Stage 3B detector adapter.
 */
export function createDetectorAdapter(config) {
  return validateDetectorAdapter(config);
}

/**
 * Pure scoped registry helper for composing multiple validated detector adapters
 * without relying on hidden global mutable state.
 */
export function createDetectorRegistry(initialAdapters = []) {
  const byId = new Map();
  const register = (adapterConfig) => {
    const validated = validateDetectorAdapter(adapterConfig);
    byId.set(validated.id, validated);
    return validated;
  };
  for (const item of initialAdapters || []) register(item);
  return {
    register,
    get: (id) => byId.get(id) || null,
    list: (kind) => {
      const all = Array.from(byId.values());
      if (!kind) return all;
      const k = String(kind).toLowerCase();
      return all.filter((a) => a.kinds.includes(k));
    },
    toArray: () => Array.from(byId.values()),
  };
}

/**
 * Strictly validates and normalizes a raw span emitted by a Stage 3B detector adapter.
 * Fails closed with `DETECTOR_MALFORMED_SPAN` on any invalid offsets, scores, or bboxes.
 */
export function normalizeDetectorSpan(rawSpan, context = {}) {
  const adapterId = context.adapterId || 'unknown';
  const defaultProvenance = context.provenanceTag || `adapter:${adapterId}`;
  const kind = context.kind || 'text';

  if (!rawSpan || typeof rawSpan !== 'object' || Array.isArray(rawSpan)) {
    throw new DetectorAdapterError(
      'DETECTOR_MALFORMED_SPAN',
      `Detector adapter "${adapterId}" emitted a non-object ${kind} span`,
      { adapterId }
    );
  }

  const rawType = rawSpan.entityType ?? rawSpan.type ?? rawSpan.label;
  if (typeof rawType !== 'string' || !rawType.trim()) {
    throw new DetectorAdapterError(
      'DETECTOR_MALFORMED_SPAN',
      `Detector adapter "${adapterId}" emitted a ${kind} span without a valid entityType`,
      { adapterId }
    );
  }
  const entityType = rawType.trim().toUpperCase();

  const rawScore = rawSpan.score ?? rawSpan.confidence;
  if (typeof rawScore !== 'number' || !Number.isFinite(rawScore) || rawScore < 0 || rawScore > 1) {
    throw new DetectorAdapterError(
      'DETECTOR_MALFORMED_SPAN',
      `Detector adapter "${adapterId}" emitted a ${kind} span with invalid score (expected [0, 1])`,
      { adapterId }
    );
  }

  if (
    rawSpan.provenanceTag !== undefined &&
    (typeof rawSpan.provenanceTag !== 'string' || !rawSpan.provenanceTag.trim())
  ) {
    throw new DetectorAdapterError(
      'DETECTOR_MALFORMED_SPAN',
      `Detector adapter "${adapterId}" emitted a ${kind} span with invalid provenanceTag`,
      { adapterId }
    );
  }
  const provenanceTag = rawSpan.provenanceTag ? rawSpan.provenanceTag.trim() : defaultProvenance;

  if (kind === 'text') {
    const inputText = String(context.text ?? '');
    const start = rawSpan.start;
    const end = rawSpan.end;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > inputText.length
    ) {
      throw new DetectorAdapterError(
        'DETECTOR_MALFORMED_SPAN',
        `Detector adapter "${adapterId}" emitted out-of-bounds text offsets [${start}, ${end}) for length ${inputText.length}`,
        { adapterId }
      );
    }
    if (rawSpan.text !== undefined && typeof rawSpan.text !== 'string') {
      throw new DetectorAdapterError(
        'DETECTOR_MALFORMED_SPAN',
        `Detector adapter "${adapterId}" emitted non-string span text`,
        { adapterId }
      );
    }
    const textSlice = rawSpan.text !== undefined ? rawSpan.text : inputText.slice(start, end);
    return {
      kind: 'text',
      entityType,
      type: entityType,
      start,
      end,
      text: textSlice,
      score: rawScore,
      confidence: rawScore,
      provenanceTag,
      adapterId,
    };
  }

  if (kind === 'image') {
    let box;
    try {
      box = normalizeBoxCoords(rawSpan.bbox, 'span.bbox');
    } catch (err) {
      throw new DetectorAdapterError(
        'DETECTOR_MALFORMED_SPAN',
        `Detector adapter "${adapterId}" emitted malformed image bbox: ${err.message}`,
        { adapterId, cause: err }
      );
    }
    if (box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0) {
      throw new DetectorAdapterError(
        'DETECTOR_MALFORMED_SPAN',
        `Detector adapter "${adapterId}" emitted non-positive or negative image bbox`,
        { adapterId }
      );
    }
    if (box.normalized && (box.x > 1 + 1e-6 || box.y > 1 + 1e-6 || box.x2 > 1 + 1e-6 || box.y2 > 1 + 1e-6)) {
      throw new DetectorAdapterError(
        'DETECTOR_MALFORMED_SPAN',
        `Detector adapter "${adapterId}" emitted normalized image bbox outside [0, 1]`,
        { adapterId }
      );
    }
    const bbox = {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      normalized: box.normalized,
    };
    const pixelBox = projectBoxToPixels(bbox, context.width, context.height);
    return {
      kind: 'image',
      entityType,
      type: entityType,
      bbox,
      pixelBox,
      score: rawScore,
      confidence: rawScore,
      provenanceTag,
      adapterId,
    };
  }

  throw new DetectorAdapterError(
    'DETECTOR_MALFORMED_SPAN',
    `Unsupported span kind "${kind}"`,
    { adapterId }
  );
}

async function resolveAndValidateAdapters(options = {}) {
  const rawList = [];
  const collect = (val) => {
    if (!val) return;
    if (typeof val.toArray === 'function') {
      rawList.push(...val.toArray());
    } else if (Array.isArray(val)) {
      rawList.push(...val);
    } else {
      rawList.push(val);
    }
  };
  collect(options.detectors);
  collect(options.detectorAdapters);

  const validated = [];
  for (const raw of rawList) {
    const adapter = validateDetectorAdapter(raw);
    if (typeof adapter.runtimeCheck === 'function') {
      let checkRes;
      try {
        checkRes = await adapter.runtimeCheck();
      } catch (err) {
        if (err instanceof DetectorAdapterError) throw err;
        throw new DetectorAdapterError(
          'DETECTOR_RUNTIME_MISSING',
          `Detector adapter "${adapter.id}" async runtimeCheck failed: ${err?.message || String(err)}`,
          { adapterId: adapter.id, cause: err }
        );
      }
      if (checkRes === false || (checkRes && typeof checkRes === 'object' && checkRes.ok === false)) {
        throw new DetectorAdapterError(
          'DETECTOR_RUNTIME_MISSING',
          `Detector adapter "${adapter.id}" runtimeCheck reported unavailable: ${checkRes?.reason || 'runtime unavailable'}`,
          { adapterId: adapter.id, details: typeof checkRes === 'object' ? checkRes : null }
        );
      }
    }
    validated.push(adapter);
  }
  return validated;
}

async function invokeDetectorAdapter(adapter, request, context) {
  let rawSpans;
  try {
    rawSpans = await adapter.detect(request);
  } catch (err) {
    if (err instanceof DetectorAdapterError) throw err;
    throw new DetectorAdapterError(
      'DETECTOR_EXECUTION_FAILED',
      `Detector adapter "${adapter.id}" threw during ${request.kind} detection`,
      { adapterId: adapter.id, details: { kind: request.kind, errorName: err?.name || 'Error' }, cause: err }
    );
  }
  if (!Array.isArray(rawSpans)) {
    throw new DetectorAdapterError(
      'DETECTOR_MALFORMED_SPAN',
      `Detector adapter "${adapter.id}" must return an array of spans (got ${rawSpans === null ? 'null' : typeof rawSpans})`,
      { adapterId: adapter.id }
    );
  }
  return rawSpans.map((sp) =>
    normalizeDetectorSpan(sp, {
      ...context,
      kind: request.kind,
      adapterId: adapter.id,
      provenanceTag: adapter.provenanceTag,
    })
  );
}

function normalizeHumanCorrections(raw) {
  const empty = { imageBoxes: [], spanOverrides: [], customRegexRules: [] };
  if (!raw) return empty;

  const imageBoxes = [];
  const spanOverrides = [];
  const customRegexRules = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') {
        throw new DetectorAdapterError('HUMAN_CORRECTION_INVALID', 'Human correction item must be an object');
      }
      const k = String(item.kind || '').toLowerCase();
      if (k === 'image_bbox' || k === 'bbox' || item.bbox) {
        imageBoxes.push(item);
      } else if (k === 'regex' || k === 'custom_regex' || item.pattern !== undefined) {
        customRegexRules.push(item);
      } else {
        spanOverrides.push(item);
      }
    }
  } else if (typeof raw === 'object') {
    for (const b of raw.imageBoxes || raw.manualBoxes || raw.bboxes || []) imageBoxes.push(b);
    for (const s of raw.spanOverrides || raw.textSpans || raw.spans || []) spanOverrides.push(s);
    for (const r of raw.customRegexRules || raw.regexRules || raw.customRules || []) customRegexRules.push(r);
  } else {
    throw new DetectorAdapterError('HUMAN_CORRECTION_INVALID', 'humanCorrections must be an object or array');
  }

  const normalizedImageBoxes = imageBoxes.map((item, idx) => {
    let c;
    try {
      c = normalizeBoxCoords(item.bbox ?? item, `humanCorrections.imageBoxes[${idx}]`);
    } catch (err) {
      throw new DetectorAdapterError('HUMAN_CORRECTION_INVALID', err.message, { cause: err });
    }
    if (c.x < 0 || c.y < 0 || c.width <= 0 || c.height <= 0) {
      throw new DetectorAdapterError(
        'HUMAN_CORRECTION_INVALID',
        `humanCorrections.imageBoxes[${idx}] must have non-negative x,y and positive width,height`
      );
    }
    return {
      source: item.source ?? item.filePath ?? null,
      blockId: item.blockId ?? null,
      entityType: String(item.entityType || item.type || 'IMAGE_PII').trim().toUpperCase(),
      action: String(item.action || 'redact').trim().toLowerCase(),
      bbox: { x: c.x, y: c.y, width: c.width, height: c.height, normalized: c.normalized },
      reviewerId: item.reviewerId ?? null,
      reason: item.reason ?? null,
    };
  });

  const normalizedSpanOverrides = spanOverrides.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new DetectorAdapterError('HUMAN_CORRECTION_INVALID', `spanOverrides[${idx}] must be an object`);
    }
    const hasOffsets = Number.isInteger(item.start) && Number.isInteger(item.end) && item.end > item.start && item.start >= 0;
    const hasText = typeof (item.text ?? item.match) === 'string' && String(item.text ?? item.match).length > 0;
    if (!hasOffsets && !hasText) {
      throw new DetectorAdapterError(
        'HUMAN_CORRECTION_INVALID',
        `spanOverrides[${idx}] requires valid integer { start, end } or non-empty \`text\``
      );
    }
    return {
      source: item.source ?? item.filePath ?? null,
      blockId: item.blockId ?? null,
      start: hasOffsets ? item.start : null,
      end: hasOffsets ? item.end : null,
      text: hasText ? String(item.text ?? item.match) : null,
      entityType: String(item.entityType || item.type || 'CUSTOM').trim().toUpperCase(),
      action: String(item.action || 'redact').trim().toLowerCase(),
      score: typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : 1.0,
      reviewerId: item.reviewerId ?? null,
      reason: item.reason ?? null,
    };
  });

  const normalizedRegexRules = customRegexRules.map((item, idx) => {
    if (!item || typeof item !== 'object' || item.pattern === undefined) {
      throw new DetectorAdapterError('HUMAN_CORRECTION_INVALID', `customRegexRules[${idx}] requires a \`pattern\``);
    }
    let rx;
    try {
      if (item.pattern instanceof RegExp) {
        const flags = item.pattern.flags.includes('g') ? item.pattern.flags : `${item.pattern.flags}g`;
        rx = new RegExp(item.pattern.source, flags);
      } else if (typeof item.pattern === 'string' && item.pattern.length > 0) {
        const rawFlags = typeof item.flags === 'string' ? item.flags : 'g';
        const flags = rawFlags.includes('g') ? rawFlags : `${rawFlags}g`;
        rx = new RegExp(item.pattern, flags);
      } else {
        throw new TypeError('pattern must be a RegExp or non-empty string');
      }
    } catch (err) {
      throw new DetectorAdapterError(
        'HUMAN_CORRECTION_INVALID',
        `customRegexRules[${idx}] has invalid regex: ${err.message}`,
        { cause: err }
      );
    }
    return {
      ruleId: String(item.id || item.name || `custom_regex_${idx + 1}`),
      source: item.source ?? item.filePath ?? null,
      blockId: item.blockId ?? null,
      regex: rx,
      entityType: String(item.entityType || item.type || 'CUSTOM_REGEX').trim().toUpperCase(),
      action: String(item.action || 'redact').trim().toLowerCase(),
      score: typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : 1.0,
      reviewerId: item.reviewerId ?? null,
      reason: item.reason ?? null,
    };
  });

  return {
    imageBoxes: normalizedImageBoxes,
    spanOverrides: normalizedSpanOverrides,
    customRegexRules: normalizedRegexRules,
  };
}

function correctionMatchesTarget(corr, source, blockId) {
  if (corr.source && source && corr.source !== source && path.basename(corr.source) !== path.basename(source)) {
    return false;
  }
  if (corr.blockId && blockId && corr.blockId !== blockId) {
    return false;
  }
  return true;
}

function spansOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function applyExemptSpansToRedaction(rawText, redResult, exemptSpans = []) {
  if (!Array.isArray(exemptSpans) || exemptSpans.length === 0) return redResult;
  const surviving = (redResult.entities || []).filter(
    (e) => !exemptSpans.some((ex) => spansOverlap(e.start, e.end, ex.start, ex.end))
  );
  if (surviving.length === (redResult.entities || []).length) return redResult;

  surviving.sort((a, b) => a.start - b.start);
  let maskedText = '';
  let cursor = 0;
  for (const e of surviving) {
    if (e.start < cursor) continue;
    maskedText += rawText.slice(cursor, e.start) + e.token;
    cursor = e.end;
  }
  maskedText += rawText.slice(cursor);

  return {
    ...redResult,
    maskedText,
    entities: surviving,
    piiCount: surviving.filter((e) => e.category === 'pii').length,
    secretCount: surviving.filter((e) => e.category === 'secret').length,
  };
}

const STOPWORD_CANDIDATES = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'was', 'were',
  'are', 'not', 'but', 'had', 'has', 'will', 'would', 'could', 'should', 'under',
  'court', 'government', 'state', 'article', 'convention', 'section', 'chapter',
  'act', 'law', 'case', 'application', 'judgment', 'committee', 'commission',
  'department', 'ministry', 'national', 'European', 'european', 'human', 'rights',
  'applicant', 'applicants', 'president', 'judge', 'judges', 'registrar', 'council',
  'parliament', 'republic', 'kingdom', 'federal', 'supreme', 'constitutional',
  'criminal', 'civil', 'administrative', 'district', 'regional', 'municipal',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'sunday', 'street', 'avenue', 'hospital',
  'university', 'police', 'prison', 'office', 'company', 'bank', 'group',
]);

/**
 * Graph-Coupled Cross-Modal Conformal Redaction (`GC-CRC`).
 *
 * Given an ordered array of blocks (paragraphs within a document, or multimodal turns
 * across email, slides, audio ASR, and video OCR):
 *   Pass 1 (High-Precision Anchor Seeding):
 *     Runs Stage 3A WASM + high-precision Stage 3B neural spans (`anchorThreshold`, default 0.50)
 *     and registers every verified PERSON / code / contact entity into the Salted Reference
 *     Anchor Pool with its 128-bit WASM Bloom+Soundex signature (`vs_media_pprl_signature`),
 *     plus individual surname/token anchors (>= 4 chars, non-stopword).
 *   Pass 2 (Cross-Chunk & Cross-Modal Anchor Propagation):
 *     Scans remaining unmasked candidate tokens across all blocks in the document/workspace
 *     graph. Any candidate matching an anchor via exact normalized token or 128-bit
 *     Bloom+Soundex PPRL (`Dice >= pprlThreshold` + Soundex match, weighted by Dual-CSR
 *     graph proximity) is promoted to a coupled span with score:
 *       S_GC(m, c) = 1 - (1 - s_local) * (1 - gamma * Dice(sig(m), sig_a) * (1 + beta * ppr(a -> c)))
 *     and masked with the anchor's consistent `<PII:...>` pseudonym!
 */
export function runGraphCoupledConformalRedaction(blocks, options = {}) {
  const mediaEngine = loadMediaWasmSync();
  const workspaceSalt = options.workspaceSalt || 'versieve-gccrc-v1';
  const vault = options.vault || new SaltedPseudonymVault(workspaceSalt);
  const anchorThreshold = options.anchorThreshold ?? 0.50;
  const lowNeuralThreshold = options.lowNeuralThreshold ?? 0.20;
  const pprlDiceThreshold = options.pprlDiceThreshold ?? 0.78;
  const gamma = options.gamma ?? 0.85;
  const beta = options.beta ?? 0.20;

  // Bounded Salted Reference Anchor Pool (cap = 512 working anchors in versieve_media.wasm SR-MP Ring)
  const MAX_ANCHORS = options.maxAnchors ?? 512;
  const anchorPool = new Map(); // normToken -> { token, rawSample, type, entityId, entityUid, sig, blockIdx }
  const anchorByUid = new Map();
  let nextUid = 1;
  mediaEngine.srmpReset();

  const kindCodeFromType = (t) => {
    const u = String(t || '').toUpperCase();
    if (u === 'PER' || u.includes('PERSON') || u.includes('NAME')) return 1;
    if (u.includes('CODE') || u.includes('CASE') || u.includes('MRN') || u.includes('ID')) return 2;
    if (u.includes('EMAIL')) return 3;
    if (u.includes('ORG')) return 4;
    return 5;
  };

  const registerAnchorToken = (rawPiece, type, entityId, blockIdx, conf = 0.92) => {
    if (anchorPool.size >= MAX_ANCHORS) return;
    const clean = String(rawPiece || '').replace(/^[^A-Za-z0-9\u00C0-\u024F]+|[^A-Za-z0-9\u00C0-\u024F]+$/g, '');
    if (clean.length < 4) return;
    const lower = clean.toLowerCase();
    if (STOPWORD_CANDIDATES.has(lower)) return;
    if (/^\d+$/.test(clean) && clean.length < 5) return;

    const sig = mediaEngine.pprlSignature(clean, workspaceSalt);
    if (!anchorPool.has(lower)) {
      const entityUid = nextUid++;
      const entry = {
        norm: lower,
        rawSample: clean,
        type,
        entityId,
        entityUid,
        sig,
        blockIdx,
      };
      anchorPool.set(lower, entry);
      anchorByUid.set(entityUid, entry);
      mediaEngine.srmpSeedAnchor(clean, workspaceSalt, {
        entityUid,
        blockIdx,
        confidence: conf,
        kindCode: kindCodeFromType(type),
      });
    }
  };

  const compareSigs = (sigA, sigB) => ({
    dice: pprlDiceSimilarity(sigA.bloomHex, sigB.bloomHex),
    phoneticMatch: Boolean(sigA.phoneticHex && sigA.phoneticHex === sigB.phoneticHex),
  });

  // Pass 1: High-Precision Anchor Seeding across all blocks
  const pass1Results = blocks.map((blk, idx) => {
    const text = String(blk.text || '');
    const exemptSpans = Array.isArray(blk.exemptSpans) ? blk.exemptSpans : [];
    const rawNeural = Array.isArray(blk.neuralSpans) ? blk.neuralSpans : [];
    const allNeural = exemptSpans.length > 0
      ? rawNeural.filter((s) => !exemptSpans.some((ex) => spansOverlap(s.start, s.end, ex.start, ex.end)))
      : rawNeural;
    const highNeural = allNeural.filter((s) => (s.score ?? s.confidence ?? 1.0) >= anchorThreshold);
    const lowNeural = allNeural.filter((s) => (s.score ?? s.confidence ?? 1.0) >= lowNeuralThreshold && (s.score ?? s.confidence ?? 1.0) < anchorThreshold);

    const rawRed = redactEnterpriseText(text, {
      vault,
      neuralSpans: highNeural,
      domainConfig: options.domainConfig,
      whitelist: options.whitelist,
      blacklist: options.blacklist,
    });
    const red = applyExemptSpansToRedaction(text, rawRed, exemptSpans);

    for (const ent of red.entities) {
      const t = String(ent.type || '').toUpperCase();
      const entValue = text.slice(ent.start, ent.end);
      const isPersonType = t === 'PER' || t.includes('PERSON') || t.includes('NAME');
      if (isPersonType || t.includes('CODE') || t.includes('EMAIL') || t.includes('ORG') || t.includes('CASE') || t.includes('MRN')) {
        registerAnchorToken(entValue, isPersonType ? 'PERSON' : ent.type, ent.entityId, idx);
        // Also index constituent surname/given-name tokens >= 4 chars for PERSON spans
        // (supports both Title-Case and lowercase ASR / plugged neural NER detections)
        if (isPersonType) {
          for (const part of String(entValue || '').split(/[\s\-.,/]+/)) {
            if (part.length >= 4 && /^[A-Za-z\u00C0-\u024F]/.test(part)) {
              registerAnchorToken(part, 'PERSON', ent.entityId, idx);
            }
          }
        }
      }
    }

    return { text, red, highNeural, lowNeural, exemptSpans, blockIdx: idx };
  });

  // Pass 2: Graph-Coupled Cross-Chunk & Cross-Modal Anchor Propagation
  let propagatedSpansCount = 0;
  const anchorList = Array.from(anchorPool.values());

  const coupledBlocks = pass1Results.map((p1, idx) => {
    const { text, highNeural, lowNeural, exemptSpans } = p1;
    const promotedSpans = [...highNeural];

    // 2a. Promote weak neural candidates (score in [lowNeuralThreshold, anchorThreshold))
    // ONLY if they couple with a Salted Reference Anchor in the document/workspace graph!
    for (const weak of lowNeural) {
      const spanText = text.slice(weak.start, weak.end).trim();
      if (spanText.length < 3) continue;
      const parts = spanText.split(/\s+/).filter((w) => w.length >= 4);
      let maxCoupledScore = weak.score ?? 0.25;
      let matchedAnchor = null;

      for (const part of [spanText, ...parts]) {
        const clean = part.replace(/^[^A-Za-z0-9\u00C0-\u024F]+|[^A-Za-z0-9\u00C0-\u024F]+$/g, '');
        if (clean.length < 4) continue;
        const lower = clean.toLowerCase();
        if (STOPWORD_CANDIDATES.has(lower)) continue;

        if (anchorPool.has(lower)) {
          matchedAnchor = anchorPool.get(lower);
          const distDecay = 1 / (1 + 0.05 * Math.abs(idx - matchedAnchor.blockIdx));
          maxCoupledScore = Math.max(maxCoupledScore, 1 - (1 - (weak.score ?? 0.25)) * (1 - gamma * (1 + beta * distDecay)));
          break;
        }

        const wasmHit = mediaEngine.srmpQueryCandidate(clean, workspaceSalt, {
          blockIdx: idx,
          localScore: weak.score ?? 0.25,
          minDice: pprlDiceThreshold,
          gamma,
          beta,
        });
        if (wasmHit.matched && anchorByUid.has(wasmHit.entityUid)) {
          matchedAnchor = anchorByUid.get(wasmHit.entityUid);
          maxCoupledScore = Math.max(maxCoupledScore, wasmHit.coupledScore);
          break;
        }
        for (const anc of anchorList) {
          const cmp = compareSigs(mediaEngine.pprlSignature(clean, workspaceSalt), anc.sig);
          if (cmp.dice >= pprlDiceThreshold || (cmp.phoneticMatch && cmp.dice >= 0.48)) {
            matchedAnchor = anc;
            const distDecay = 1 / (1 + 0.05 * Math.abs(idx - anc.blockIdx));
            const effSim = cmp.phoneticMatch ? Math.max(cmp.dice, 0.82) : cmp.dice;
            const boost = Math.min(0.99, gamma * effSim * (1 + beta * distDecay));
            maxCoupledScore = Math.max(maxCoupledScore, 1 - (1 - (weak.score ?? 0.25)) * (1 - boost));
            break;
          }
        }
        if (matchedAnchor) break;
      }

      if (matchedAnchor && maxCoupledScore >= anchorThreshold) {
        promotedSpans.push({
          start: weak.start,
          end: weak.end,
          type: matchedAnchor.type || weak.type || 'PERSON',
          score: Number(maxCoupledScore.toFixed(4)),
          coupledFromAnchor: matchedAnchor.entityId,
          provenanceTag: weak.provenanceTag || 'gccrc:anchor_promoted',
          adapterId: weak.adapterId,
        });
        propagatedSpansCount++;
      }
    }

    // 2b. Scan unmasked capitalized or spoken tokens for direct/phonetic anchor matches
    // (catches bare surnames in later paragraphs or homophone ASR corruptions like "Elena Vans")
    const tokenRe = /\b[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F'-]{3,24}\b/g;
    let m;
    while ((m = tokenRe.exec(text)) !== null) {
      const word = m[0];
      const start = m.index;
      const end = start + word.length;
      const lower = word.toLowerCase();
      if (STOPWORD_CANDIDATES.has(lower)) continue;

      // Skip if explicitly exempted by human correction or already covered
      const isExempt = exemptSpans.some((ex) => spansOverlap(start, end, ex.start, ex.end));
      if (isExempt) continue;

      const alreadyCovered =
        p1.red.entities.some((e) => start < e.end && end > e.start) ||
        promotedSpans.some((s) => start < s.end && end > s.start);
      if (alreadyCovered) continue;

      let matchedAnchor = anchorPool.get(lower) || null;
      let coupledScore = matchedAnchor ? 0.88 : 0;

      if (!matchedAnchor && options.enablePhoneticTokenScan !== false && /^[A-Z\u00C0-\u00DE]/.test(word)) {
        const wasmHit = mediaEngine.srmpQueryCandidate(word, workspaceSalt, {
          blockIdx: idx,
          localScore: 0.22,
          minDice: pprlDiceThreshold,
          gamma,
          beta,
        });
        if (wasmHit.matched && anchorByUid.has(wasmHit.entityUid)) {
          matchedAnchor = anchorByUid.get(wasmHit.entityUid);
          coupledScore = wasmHit.coupledScore;
        }
      }

      if (matchedAnchor && coupledScore >= anchorThreshold) {
        promotedSpans.push({
          start,
          end,
          type: matchedAnchor.type || 'PERSON',
          score: coupledScore,
          coupledFromAnchor: matchedAnchor.entityId,
          provenanceTag: 'gccrc:srmp_propagated',
        });
        propagatedSpansCount++;
      }
    }

    const rawFinalRed =
      promotedSpans.length > highNeural.length
        ? redactEnterpriseText(text, {
            vault,
            neuralSpans: promotedSpans,
            domainConfig: options.domainConfig,
            whitelist: options.whitelist,
            blacklist: options.blacklist,
          })
        : p1.red;
    const finalRed = applyExemptSpansToRedaction(text, rawFinalRed, exemptSpans);

    // Attach adapter/correction provenanceTag & coupledFromAnchor onto matched entities
    const enrichedEntities = finalRed.entities.map((ent) => {
      const matchedPromoted = promotedSpans.find(
        (sp) => sp.start === ent.start && sp.end === ent.end
      );
      if (!matchedPromoted) return ent;
      return {
        ...ent,
        ...(matchedPromoted.provenanceTag ? { provenanceTag: matchedPromoted.provenanceTag } : {}),
        ...(matchedPromoted.adapterId ? { adapterId: matchedPromoted.adapterId } : {}),
        ...(matchedPromoted.coupledFromAnchor ? { coupledFromAnchor: matchedPromoted.coupledFromAnchor } : {}),
      };
    });

    // Coupled non-conformity risk score for LTT/HC-CRC gatekeeping (incorporating plugged text + image scores)
    const imageMaxScore = Array.isArray(blocks[idx]?.imageDetections)
      ? blocks[idx].imageDetections.reduce((mx, d) => Math.max(mx, d.score ?? 0), 0)
      : 0;
    const baseScore = enrichedEntities.length > 0 ? 0.92 : imageMaxScore > 0 ? imageMaxScore : 0.04;
    const maxEntityScore = Math.max(
      imageMaxScore,
      promotedSpans.reduce((mx, s) => Math.max(mx, s.score ?? 0.85), baseScore)
    );
    const gateAction = finalRed.secretCount > 0 ? 'QUARANTINE_SECRET' : 'KEEP_SAFE_REDACTED';

    return {
      ...blocks[idx],
      originalText: text,
      maskedText: finalRed.maskedText,
      entities: enrichedEntities,
      piiCount: finalRed.piiCount,
      secretCount: finalRed.secretCount,
      coupledRiskScore: Number(maxEntityScore.toFixed(4)),
      gateAction,
      policyAction: mapGateActionToPolicy(gateAction),
      rejectionReason:
        gateAction === 'QUARANTINE_SECRET'
          ? GATE_REJECTION_REASONS.RISK_BUDGET_EXCEEDED
          : GATE_REJECTION_REASONS.NONE,
      recoverability:
        gateAction === 'QUARANTINE_SECRET'
          ? GATE_RECOVERABILITY.RECOVERABLE_HUMAN_REVIEW
          : GATE_RECOVERABILITY.NONE,
    };
  });

  return {
    blocks: coupledBlocks,
    anchorPoolSize: anchorPool.size,
    propagatedSpansCount,
    vault,
  };
}

/**
 * Pillar 3: Privacy-Token Loss Masking (`PT-LM`).
 *
 * Identifies every `<PII:...>` and `<SECRET:...>` placeholder span in an assistant
 * response so SFT/LoRA tokenizers can set `labels[t] = -100` on privacy placeholders
 * (eliminating `<PII:...>` subspace hijacking / tag echoing while keeping zero raw PII
 * in `input_ids`).
 */
export function computePtlmMaskedSpans(text) {
  const s = String(text || '');
  const rx = /<(?:PII|SECRET):[A-Z0-9_]+>/g;
  const spans = [];
  let maskedChars = 0;
  let m;
  while ((m = rx.exec(s)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    spans.push({ start, end, token: m[0] });
    maskedChars += m[0].length;
  }
  const totalChars = Math.max(1, s.length);
  const unmaskedTokenRatio = Number(Math.max(0, (totalChars - maskedChars) / totalChars).toFixed(4));
  return {
    placeholderCount: spans.length,
    maskedChars,
    totalChars: s.length,
    unmaskedTokenRatio,
    spans,
  };
}

/**
 * Synchronizes perceived audio turns (`timeRangeMs`), video keyframes (`frameTimeMs`),
 * and presentation slides (`Slide N` + `Speaker Notes`) into a unified Omnimodal Scene
 * Timeline (`sceneTimeline`), enabling small local models to reason jointly over what was
 * spoken, shown on screen, and annotated in slides at the same moment.
 */
export function buildOmnimodalSceneTimeline(blocks = []) {
  const scenes = [];
  const audioTurns = blocks.filter((b) => b.modality === 'audio' && b.timeRangeMs);
  const videoFrames = blocks.filter((b) => b.modality === 'video_frame' && typeof b.frameTimeMs === 'number');
  const slideBlocks = blocks.filter((b) => b.modality === 'slide');

  // Group slide blocks by Slide number
  const slideByNum = new Map();
  for (const sb of slideBlocks) {
    const m = String(sb.breadcrumb || '').match(/Slide\s+(\d+)/i);
    const num = m ? Number(m[1]) : 1;
    if (!slideByNum.has(num)) slideByNum.set(num, []);
    slideByNum.get(num).push(sb);
  }
  const slideNums = [...slideByNum.keys()].sort((a, b) => a - b);

  if (audioTurns.length > 0 || videoFrames.length > 0) {
    const anchors = audioTurns.length > 0
      ? audioTurns.map((a, idx) => ({
          sceneIndex: idx + 1,
          startMs: a.timeRangeMs.startMs,
          endMs: a.timeRangeMs.endMs,
          audioBlocks: [a],
        }))
      : videoFrames.map((v, idx) => ({
          sceneIndex: idx + 1,
          startMs: Math.max(0, v.frameTimeMs - 1000),
          endMs: v.frameTimeMs + 2000,
          audioBlocks: [],
        }));

    anchors.forEach((sc, idx) => {
      const matchedFrames = videoFrames.filter(
        (vf) => vf.frameTimeMs >= sc.startMs - 1500 && vf.frameTimeMs <= sc.endMs + 1500
      );
      const slideNum = slideNums[idx % Math.max(1, slideNums.length)];
      const matchedSlides = slideNum !== undefined ? (slideByNum.get(slideNum) || []) : [];
      const entityIds = Array.from(
        new Set(
          [...sc.audioBlocks, ...matchedFrames, ...matchedSlides].flatMap((b) =>
            (b.entities || []).map((e) => e.entityId)
          )
        )
      );
      scenes.push({
        sceneId: `scene_${sc.sceneIndex}`,
        timeRangeMs: { startMs: sc.startMs, endMs: sc.endMs },
        spokenText: sc.audioBlocks.map((b) => b.maskedText).join(' '),
        visualKeyframeText: matchedFrames.map((b) => b.maskedText).join(' | '),
        slideContextText: matchedSlides.map((b) => `[${b.structRole}] ${b.maskedText}`).join(' | '),
        entityIds,
      });
    });
  } else if (slideNums.length > 0) {
    slideNums.forEach((num, idx) => {
      const sbs = slideByNum.get(num) || [];
      scenes.push({
        sceneId: `scene_${idx + 1}`,
        slideNumber: num,
        spokenText: '',
        visualKeyframeText: '',
        slideContextText: sbs.map((b) => `[${b.structRole}] ${b.maskedText}`).join(' | '),
        entityIds: Array.from(new Set(sbs.flatMap((b) => (b.entities || []).map((e) => e.entityId)))),
      });
    });
  }
  return scenes;
}

/**
 * Formats a perceived block into an Unlimited-OCR-style structured layout/modality tag:
 * `<BLOCK id="b1" modality="document" role="PARAGRAPH" gate="KEEP_SAFE_REDACTED" risk="0.040">...</BLOCK>`
 */
function formatPerceptionBlockTag(blk, idx) {
  const attrs = [
    `id="b${idx + 1}"`,
    `modality="${blk.modality || 'document'}"`,
    `role="${blk.structRole || 'PARAGRAPH'}"`,
    `gate="${blk.gateAction || 'KEEP_SAFE_REDACTED'}"`,
    `risk="${(blk.coupledRiskScore ?? 0).toFixed(3)}"`,
  ];
  if (blk.timeRangeMs) {
    attrs.push(`time="[${blk.timeRangeMs.startMs},${blk.timeRangeMs.endMs}]"`);
  }
  const entIds = (blk.entities || []).map((e) => e.entityId).filter(Boolean);
  if (entIds.length > 0) {
    attrs.push(`entities="[${Array.from(new Set(entIds)).join(',')}]"`);
  }
  return `<BLOCK ${attrs.join(' ')}>${blk.maskedText}</BLOCK>`;
}

/**
 * Best-effort container type from magic bytes, so callers can hand over raw
 * bytes or a folder without naming the format themselves.
 */
function sniffExtension(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const ascii = (start, end) => b.toString('latin1', start, Math.min(end, b.length));
  if (ascii(0, 5) === '%PDF-') return '.pdf';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return '.png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return '.wav';
  if (ascii(0, 4) === 'GIF8') return '.gif';
  if (ascii(0, 2) === 'PK' && b[2] === 3 && b[3] === 4) {
    const head = ascii(0, 32768);
    if (head.includes('word/')) return '.docx';
    if (head.includes('ppt/')) return '.pptx';
    if (head.includes('xl/')) return '.xlsx';
    return '.zip';
  }
  if (b[0] === 0x1f && b[1] === 0x8b) return '.tar.gz';
  if (ascii(257, 262) === 'ustar') return '.tar';
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    return ascii(0, 65536).includes('__substg1.0_') ? '.msg' : '';
  }
  return '';
}

function looksLikeUtf8Text(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const sample = b.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

/** Keep an explicit extension; otherwise append the sniffed or text one. */
function detectName(name, buf) {
  if (name && path.extname(name)) return name;
  const ext = buf ? sniffExtension(buf) || (looksLikeUtf8Text(buf) ? '.txt' : '') : '.txt';
  return `${name || 'inline'}${ext}`;
}

/** Accept an array, a comma/newline-separated string, or a `.txt` file path (one term per line). */
function readTermList(input) {
  if (Array.isArray(input)) return input;
  if (typeof input !== 'string' || !input.trim()) return [];
  const s = input.trim();
  return /\.txt$/i.test(s) && fs.existsSync(s)
    ? fs.readFileSync(s, 'utf8').split(/\r?\n/)
    : s.split(/[\r\n,]+/);
}

/** Expand directory inputs into their files, in deterministic order. */
function expandInputs(inputs, recursive) {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (recursive) walk(p);
      } else if (ent.isFile()) {
        out.push(p);
      }
    }
  };
  for (const item of inputs) {
    if (typeof item === 'string' && fs.existsSync(item) && fs.statSync(item).isDirectory()) {
      walk(item);
    } else {
      out.push(item);
    }
  }
  return out;
}

/**
 * One-shot multimodal perception & sanitization pipeline (`perceive`).
 *
 * Accepts a file path, `{ name, bytes/content/text }`, or raw text/buffer across:
 *   - Documents & Archives: `.pdf`, `.docx`, `.pptx`, `.xlsx`, `.eml`, `.msg`, `.vtt`, `.srt`,
 *     `.har`, `.ipynb`, `.ics`, `.json`, `.csv`, `.html`, `.md`, `.txt`, `.zip`, `.tar.gz`
 *   - Audio (`wavBytes` / `.wav`): Spoken ITN + `GC-CRC` phonetic anchor propagation + WAV waveform redaction
 *   - Video (`frames` / `.mp4`): Keyframe scene-change + OCR + temporal box pixel redaction
 *
 * Returns structured `<DOC><BLOCK...>` perception tags, clean Markdown, tokenized SFT/RAG chunks,
 * live Dual-CSR `versieve_graph.wasm` knowledge graph, and a SHA-256 provenance receipt.
 */
export async function perceive(input, options = {}) {
  const res = await perceiveMulti([input], options);
  return res;
}

/**
 * Multi-file / cross-modal one-shot perception (`perceiveMulti`).
 * Processes an entire multimodal stack (e.g., PDF + PPTX deck + email + WAV audio call)
 * in a single shared `GC-CRC` reference anchor horizon and Dual-CSR knowledge graph.
 *
 * `inputs` may be file paths, directory paths (walked recursively unless
 * `options.recursive === false`), raw bytes (format sniffed from magic bytes),
 * raw text, or `{ name?, bytes?, text?, frames? }` objects. A bare string that
 * is not an existing path is treated as text.
 *
 * `options.whitelist` values are never redacted; `options.blacklist` values are
 * always redacted. Both accept an array, a comma/newline-separated string, or a
 * `.txt` file path (one term per line), and apply deterministic structural breakdown
 * (email <-> name/handle, honorifics, separator variants, diacritics, and phone digits).
 * `options.keywords` (same forms and breakdown) scopes the extraction: only blocks
 * whose source text matches a keyword reach markdown, chunks, SFT, and the graph.
 * Redaction still runs over every block first, so scoping never leaves a dropped
 * block's PII unredacted in the returned artifacts.
 * `perceive()` is just `perceiveMulti([input])`.
 */
export async function perceiveMulti(inputs = [], options = {}) {
  const inputList = Array.isArray(inputs) ? inputs : [inputs];
  const workspaceSalt = options.workspaceSalt || 'versieve-perceive-v1';
  const vault = options.vault || new SaltedPseudonymVault(workspaceSalt);

  // Fail closed up-front on any invalid, egress-violating, or missing-runtime detector adapter
  // and on any malformed human-correction payload.
  const adapters = await resolveAndValidateAdapters(options);
  const textAdapters = adapters.filter((a) => a.kinds.includes('text'));
  const imageAdapters = adapters.filter((a) => a.kinds.includes('image'));
  const corrections = normalizeHumanCorrections(options.humanCorrections);

  const perceptionOptions = {
    ...options,
    whitelist: compileTermList(readTermList(options.whitelist)),
    blacklist: compileTermList(readTermList(options.blacklist)),
  };
  const cleanEngine = loadCleanWasmSync();
  const maxTokensPerChunk = options.maxTokensPerChunk ?? 256;
  const overlapTokens = options.overlapTokens ?? 24;

  const rawBlocks = [];
  const forensicFindings = [];
  const audioArtifacts = [];
  const videoArtifacts = [];
  const imageArtifacts = [];
  const calibrationObservations = [];
  const diagramEdgesBySource = new Map();
  const chartSeriesBySource = new Map();

  for (const item of expandInputs(inputList, options.recursive !== false)) {
    let name = null;
    let buf = null;
    let text = null;

    if (typeof item === 'string') {
      if (fs.existsSync(item) && fs.statSync(item).isFile()) {
        name = path.basename(item);
        buf = fs.readFileSync(item);
      } else {
        text = item;
      }
    } else if (item instanceof Uint8Array || Buffer.isBuffer(item)) {
      buf = item;
    } else if (item instanceof ArrayBuffer) {
      buf = new Uint8Array(item);
    } else if (item && typeof item === 'object') {
      name = item.name || item.source || null;
      if (typeof item.text === 'string') text = item.text;
      else if (!item.bytes && typeof item.content === 'string') text = item.content;
      else if (item.bytes || item.content || item.buffer) {
        const b = item.bytes || item.content || item.buffer;
        buf = b instanceof Uint8Array ? b : new Uint8Array(b);
      }
    }

    const explicitPixelObj =
      item && typeof item === 'object' && !Array.isArray(item.frames)
        ? item.pixels && item.width && item.height
          ? { pixels: item.pixels, width: item.width, height: item.height, channels: item.channels ?? 3 }
          : item.image && item.image.pixels && item.image.width && item.image.height
            ? {
                pixels: item.image.pixels,
                width: item.image.width,
                height: item.image.height,
                channels: item.image.channels ?? 3,
              }
            : null
        : null;

    name = explicitPixelObj && !name ? 'inline.png' : detectName(name, buf);
    const lower = name.toLowerCase();

    // Audio WAV perception + Spoken ITN + waveform redaction
    if (lower.endsWith('.wav') && buf) {
      const audioRes = await redactAudioCall(name, buf, {
        ...perceptionOptions,
        vault,
        workspaceSalt,
      });
      audioArtifacts.push(audioRes);
      for (const b of audioRes.blocks) {
        rawBlocks.push({ ...b, source: name, neuralSpans: item?.neuralSpans });
      }
      continue;
    }

    // Video keyframe sequence perception (with optional pluggable image-region adapters & manual bboxes)
    if (item && Array.isArray(item.frames)) {
      const videoImageDetections = [];
      const matchingManualBoxes = corrections.imageBoxes.filter((b) =>
        correctionMatchesTarget(b, name, null)
      );
      const baseFaceDetector = typeof perceptionOptions.faceDetector === 'function' ? perceptionOptions.faceDetector : null;
      const wrappedFaceDetector =
        imageAdapters.length > 0 || matchingManualBoxes.length > 0
          ? async (frame) => {
              const outBoxes = baseFaceDetector ? [...((await baseFaceDetector(frame)) || [])] : [];
              const frameBlockId = `${name}@${frame.timeMs ?? 0}ms`;
              const frameDetections = [];
              for (const adapter of imageAdapters) {
                const dets = await invokeDetectorAdapter(
                  adapter,
                  {
                    kind: 'image',
                    image: {
                      pixels: frame.pixels,
                      width: frame.width,
                      height: frame.height,
                      channels: frame.channels ?? 3,
                      timeMs: frame.timeMs,
                    },
                    blockId: frameBlockId,
                    filePath: name,
                    options: options.detectorOptions,
                  },
                  { width: frame.width, height: frame.height }
                );
                frameDetections.push(...dets);
              }
              const exemptBoxes = [];
              for (const mb of matchingManualBoxes) {
                if (!correctionMatchesTarget(mb, name, frameBlockId)) continue;
                const pBox = projectBoxToPixels(mb.bbox, frame.width, frame.height);
                if (mb.action === 'exempt' || mb.action === 'allow') {
                  exemptBoxes.push(mb.bbox);
                  calibrationObservations.push(
                    createCalibrationObservation({
                      source: name,
                      blockId: frameBlockId,
                      modality: 'video_frame',
                      correctionKind: 'image_bbox_exemption',
                      entityType: mb.entityType,
                      action: 'exempt',
                      labelSafe: 1,
                      bbox: mb.bbox,
                      reviewerId: mb.reviewerId,
                      reason: mb.reason,
                    })
                  );
                } else {
                  frameDetections.push({
                    kind: 'image',
                    entityType: mb.entityType,
                    type: mb.entityType,
                    bbox: mb.bbox,
                    pixelBox: pBox,
                    score: 1.0,
                    confidence: 1.0,
                    provenanceTag: 'human_correction:bbox',
                    adapterId: 'human_correction',
                  });
                  calibrationObservations.push(
                    createCalibrationObservation({
                      source: name,
                      blockId: frameBlockId,
                      modality: 'video_frame',
                      correctionKind: 'manual_image_bbox',
                      entityType: mb.entityType,
                      action: 'redact',
                      labelSafe: 0,
                      bbox: mb.bbox,
                      reviewerId: mb.reviewerId,
                      reason: mb.reason,
                    })
                  );
                }
              }
              const activeFrameDets =
                exemptBoxes.length > 0
                  ? frameDetections.filter(
                      (d) => !exemptBoxes.some((ex) => computeBoxIoU(d.bbox, ex) >= 0.5)
                    )
                  : frameDetections;
              for (const det of activeFrameDets) {
                videoImageDetections.push({ ...det, timeMs: frame.timeMs ?? 0 });
                if (det.pixelBox) {
                  outBoxes.push({
                    x1: det.pixelBox.x1,
                    y1: det.pixelBox.y1,
                    x2: det.pixelBox.x2,
                    y2: det.pixelBox.y2,
                  });
                }
              }
              return outBoxes;
            }
          : baseFaceDetector;

      const vidRes = await redactVideoKeyframes(name, item.frames, {
        ...perceptionOptions,
        ...(wrappedFaceDetector ? { faceDetector: wrappedFaceDetector } : {}),
        vault,
        workspaceSalt,
      });
      if (videoImageDetections.length > 0) {
        vidRes.imageDetections = videoImageDetections;
      }
      videoArtifacts.push(vidRes);
      for (const b of vidRes.blocks) {
        const blockDets = videoImageDetections.filter((d) => d.timeMs === b.frameTimeMs);
        rawBlocks.push({
          ...b,
          source: name,
          neuralSpans: item?.neuralSpans,
          ...(blockDets.length > 0
            ? { imageDetections: blockDets, bboxes: blockDets.map((d) => d.bbox) }
            : {}),
        });
      }
      if (vidRes.blocks.length === 0 && videoImageDetections.length > 0) {
        rawBlocks.push({
          source: name,
          modality: 'video_frame',
          structRole: 'IMAGE_REGION',
          breadcrumb: `${name} > regions`,
          text: `[IMAGE_REDACTED: ${Array.from(new Set(videoImageDetections.map((d) => d.entityType))).join(', ')}]`,
          imageDetections: videoImageDetections,
          bboxes: videoImageDetections.map((d) => d.bbox),
        });
      }
      continue;
    }

    // Raw Image (PNG / JPEG / pixel buffer) forensic metadata scrub + pluggable image adapters + WASM pixel redaction
    if (explicitPixelObj || (/\.(png|jpe?g|bmp|webp|raw|rgb|rgba)$/i.test(lower) && buf)) {
      const mediaEngine = loadMediaWasmSync();
      let scrubbedBytes = buf || null;
      if (buf && /\.(png|jpe?g)$/i.test(lower)) {
        try {
          const scrubbed = mediaEngine.scrubMediaMetadata(buf);
          scrubbedBytes = scrubbed.cleanBytes;
          if (scrubbed?.meta?.strippedCount > 0) {
            forensicFindings.push({
              source: name,
              vector: 'image_exif_gps_metadata_scrubbed',
              strippedCount: scrubbed.meta.strippedCount,
              strippedTags: scrubbed.meta.strippedTags,
            });
          }
        } catch {}
      }

      // Resolve raw pixel buffer (from explicit pixels or PNG decode when visual detectors/corrections are active)
      let pixels = explicitPixelObj ? explicitPixelObj.pixels : null;
      let width = explicitPixelObj ? explicitPixelObj.width : (item?.width ?? null);
      let height = explicitPixelObj ? explicitPixelObj.height : (item?.height ?? null);
      let channels = explicitPixelObj ? explicitPixelObj.channels : (item?.channels ?? 3);

      const matchingManualBoxes = corrections.imageBoxes.filter((b) =>
        correctionMatchesTarget(b, name, `${name}#img`)
      );
      if (
        !pixels &&
        buf &&
        buf.length >= 8 &&
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        (imageAdapters.length > 0 || matchingManualBoxes.length > 0)
      ) {
        try {
          const dec = decodePngBuffer(Buffer.from(buf));
          pixels = dec.rgb;
          width = dec.width;
          height = dec.height;
          channels = 3;
        } catch {}
      }

      const imageBlockId = `${name}#img`;
      const rawImageDetections = [];
      for (const adapter of imageAdapters) {
        const dets = await invokeDetectorAdapter(
          adapter,
          {
            kind: 'image',
            image: {
              pixels,
              bytes: buf,
              width,
              height,
              channels,
            },
            blockId: imageBlockId,
            filePath: name,
            options: options.detectorOptions,
          },
          { width, height }
        );
        rawImageDetections.push(...dets);
      }

      // Apply manual image bounding box corrections (redact / exempt) and log calibration observations
      const exemptImageBoxes = [];
      for (const mb of matchingManualBoxes) {
        const pixelBox = projectBoxToPixels(mb.bbox, width, height);
        if (mb.action === 'exempt' || mb.action === 'allow') {
          exemptImageBoxes.push(mb.bbox);
          calibrationObservations.push(
            createCalibrationObservation({
              source: name,
              blockId: imageBlockId,
              modality: 'image',
              correctionKind: 'image_bbox_exemption',
              entityType: mb.entityType,
              action: 'exempt',
              labelSafe: 1,
              bbox: mb.bbox,
              reviewerId: mb.reviewerId,
              reason: mb.reason,
            })
          );
        } else {
          rawImageDetections.push({
            kind: 'image',
            entityType: mb.entityType,
            type: mb.entityType,
            bbox: mb.bbox,
            pixelBox,
            score: 1.0,
            confidence: 1.0,
            provenanceTag: 'human_correction:bbox',
            adapterId: 'human_correction',
          });
          calibrationObservations.push(
            createCalibrationObservation({
              source: name,
              blockId: imageBlockId,
              modality: 'image',
              correctionKind: 'manual_image_bbox',
              entityType: mb.entityType,
              action: 'redact',
              labelSafe: 0,
              bbox: mb.bbox,
              reviewerId: mb.reviewerId,
              reason: mb.reason,
            })
          );
        }
      }

      const activeDetections =
        exemptImageBoxes.length > 0
          ? rawImageDetections.filter(
              (d) => !exemptImageBoxes.some((ex) => computeBoxIoU(d.bbox, ex) >= 0.5)
            )
          : rawImageDetections;

      // Deterministic pixel redaction via zero-import versieve_media.wasm when pixel buffer is present
      const pixelBoxes = activeDetections
        .map((d) => d.pixelBox || projectBoxToPixels(d.bbox, width, height))
        .filter((pb) => pb && pb.x2 > pb.x1 && pb.y2 > pb.y1);

      let redactedPixels = pixels ? new Uint8Array(pixels) : null;
      let maskedPixels = 0;
      const pixelMode = options.pixelMode || 'blackout';
      const pixelStrength = options.pixelStrength ?? 10;
      if (pixels && width > 0 && height > 0 && pixelBoxes.length > 0) {
        const resPix = mediaEngine.redactPixels(
          pixels,
          width,
          height,
          channels,
          pixelBoxes,
          { mode: pixelMode, strength: pixelStrength }
        );
        redactedPixels = resPix.pixels;
        maskedPixels = resPix.maskedPixels;
      }

      if (activeDetections.length > 0 || pixels) {
        imageArtifacts.push({
          source: name,
          width: width ?? null,
          height: height ?? null,
          channels: pixels ? channels : null,
          pixels: redactedPixels,
          maskedPixels,
          detections: activeDetections,
          bboxes: activeDetections.map((d) => d.bbox),
          pixelBoxes,
          mode: pixelMode,
          ...(scrubbedBytes ? { cleanBytes: scrubbedBytes } : {}),
        });
      }

      let emittedOcrBlocks = 0;
      if (typeof options.ocrProvider === 'function') {
        const ocrLines = await options.ocrProvider({
          source: name,
          bytes: buf,
          pixels,
          width,
          height,
          channels,
        });
        for (const [lIdx, line] of (ocrLines || []).entries()) {
          if (line?.text) {
            emittedOcrBlocks++;
            rawBlocks.push({
              source: name,
              modality: 'image',
              structRole: 'IMAGE_OCR',
              breadcrumb: `${name} > box_${lIdx + 1}`,
              text: String(line.text),
              ocrBoxes: line.bbox ? [line.bbox] : undefined,
              neuralSpans: item?.neuralSpans,
              ...(activeDetections.length > 0
                ? {
                    imageDetections: activeDetections,
                    bboxes: activeDetections.map((d) => d.bbox),
                    maskedPixels,
                  }
                : {}),
            });
          }
        }
      }

      if (emittedOcrBlocks === 0 && activeDetections.length > 0) {
        rawBlocks.push({
          source: name,
          modality: 'image',
          structRole: 'IMAGE_REGION',
          breadcrumb: `${name} > regions`,
          text: `[IMAGE_REDACTED: ${Array.from(new Set(activeDetections.map((d) => d.entityType))).join(', ')}]`,
          imageDetections: activeDetections,
          bboxes: activeDetections.map((d) => d.bbox),
          maskedPixels,
        });
      }
      continue;
    }

    // PDF born-digital perception
    if (lower.endsWith('.pdf') && buf) {
      const diag = await extractPdfDetailed(Buffer.from(buf));
      for (let i = 0; i < (diag.lines || []).length; i++) {
        rawBlocks.push({
          source: name,
          modality: 'document',
          structRole: 'PDF_LINE',
          breadcrumb: `${name} > line_${i + 1}`,
          text: diag.lines[i],
          neuralSpans: item?.neuralSpans,
        });
      }
      continue;
    }

    // DOCX structured perception
    if (lower.endsWith('.docx') && buf) {
      const docx = extractDocxStructured(Buffer.from(buf), name);
      for (const b of docx.blocks || []) {
        rawBlocks.push({
          source: name,
          modality: 'document',
          structRole: b.role || 'PARAGRAPH',
          breadcrumb: b.breadcrumb || name,
          text: b.text,
          neuralSpans: item?.neuralSpans,
        });
      }
      continue;
    }

    // Enterprise formats (.eml, .msg, .pptx, .xlsx, .vtt, .srt, .har, .ipynb, .ics, .json, .txt)
    const rawInput = buf || Buffer.from(String(text || ''), 'utf8');
    const parsed = parseEnterpriseBuffer(name, rawInput, { vault, workspaceSalt });
    if (Array.isArray(parsed.diagramEdges) && parsed.diagramEdges.length > 0) {
      diagramEdgesBySource.set(name, parsed.diagramEdges);
    }
    if (Array.isArray(parsed.chartSeries) && parsed.chartSeries.length > 0) {
      chartSeriesBySource.set(name, parsed.chartSeries);
    }
    if (Array.isArray(parsed.forensicFindings)) {
      forensicFindings.push(...parsed.forensicFindings.map((f) => ({ source: name, ...f })));
    }
    for (const b of parsed.blocks || []) {
      rawBlocks.push({
        ...b,
        source: name,
        neuralSpans: item?.neuralSpans,
      });
    }
  }

  // Run plugged Stage 3B text detector adapters & text human corrections across all raw blocks
  let pluggedTextSpansCount = 0;
  for (let i = 0; i < rawBlocks.length; i++) {
    const blk = rawBlocks[i];
    const blockId = blk.blockId || `b${i + 1}`;
    blk.blockId = blockId;
    const blockText = String(blk.text || '');

    const mergedNeural = Array.isArray(blk.neuralSpans) ? [...blk.neuralSpans] : [];
    const detectorSpans = [];

    if (textAdapters.length > 0 && blockText.length > 0 && blk.structRole !== 'IMAGE_REGION') {
      for (const adapter of textAdapters) {
        const spans = await invokeDetectorAdapter(
          adapter,
          {
            kind: 'text',
            text: blockText,
            blockId,
            filePath: blk.source,
            modality: blk.modality || 'document',
            options: options.detectorOptions,
          },
          { text: blockText }
        );
        detectorSpans.push(...spans);
        mergedNeural.push(...spans);
        pluggedTextSpansCount += spans.length;
      }
    }

    const exemptSpans = Array.isArray(blk.exemptSpans) ? [...blk.exemptSpans] : [];

    // Apply human span overrides / additions / exemptions
    for (const ov of corrections.spanOverrides) {
      if (!correctionMatchesTarget(ov, blk.source, blockId)) continue;
      const matchedRanges = [];
      if (ov.start !== null && ov.end !== null) {
        if (ov.start >= 0 && ov.end <= blockText.length && ov.end > ov.start) {
          matchedRanges.push({ start: ov.start, end: ov.end });
        }
      } else if (ov.text) {
        let pos = 0;
        while (pos <= blockText.length - ov.text.length) {
          const hit = blockText.indexOf(ov.text, pos);
          if (hit === -1) break;
          matchedRanges.push({ start: hit, end: hit + ov.text.length });
          pos = hit + ov.text.length;
        }
      }

      for (const range of matchedRanges) {
        const priorOverlap = mergedNeural.find((s) => spansOverlap(s.start, s.end, range.start, range.end));
        if (ov.action === 'exempt' || ov.action === 'allow') {
          exemptSpans.push(range);
          for (let k = mergedNeural.length - 1; k >= 0; k--) {
            if (spansOverlap(mergedNeural[k].start, mergedNeural[k].end, range.start, range.end)) {
              mergedNeural.splice(k, 1);
            }
          }
          calibrationObservations.push(
            createCalibrationObservation({
              source: blk.source,
              blockId,
              modality: blk.modality || 'document',
              correctionKind: 'text_span_exemption',
              entityType: ov.entityType,
              action: 'exempt',
              labelSafe: 1,
              previousScore: priorOverlap ? (priorOverlap.score ?? priorOverlap.confidence ?? null) : null,
              span: range,
              reviewerId: ov.reviewerId,
              reason: ov.reason,
            })
          );
        } else {
          if (ov.action === 'override') {
            for (let k = mergedNeural.length - 1; k >= 0; k--) {
              if (spansOverlap(mergedNeural[k].start, mergedNeural[k].end, range.start, range.end)) {
                mergedNeural.splice(k, 1);
              }
            }
          }
          mergedNeural.push({
            kind: 'text',
            entityType: ov.entityType,
            type: ov.entityType,
            start: range.start,
            end: range.end,
            text: blockText.slice(range.start, range.end),
            score: ov.score,
            confidence: ov.score,
            provenanceTag: 'human_correction:span_override',
            adapterId: 'human_correction',
          });
          calibrationObservations.push(
            createCalibrationObservation({
              source: blk.source,
              blockId,
              modality: blk.modality || 'document',
              correctionKind: ov.action === 'override' ? 'text_span_override' : 'text_span_addition',
              entityType: ov.entityType,
              action: ov.action === 'override' ? 'override' : 'redact',
              labelSafe: 0,
              previousScore: priorOverlap ? (priorOverlap.score ?? priorOverlap.confidence ?? null) : 0,
              span: range,
              reviewerId: ov.reviewerId,
              reason: ov.reason,
            })
          );
        }
      }
    }

    // Apply human custom regex rules deterministically
    for (const rule of corrections.customRegexRules) {
      if (!correctionMatchesTarget(rule, blk.source, blockId)) continue;
      if (blk.structRole === 'IMAGE_REGION') continue;
      rule.regex.lastIndex = 0;
      let rm;
      while ((rm = rule.regex.exec(blockText)) !== null) {
        if (rm[0].length === 0) {
          rule.regex.lastIndex++;
          continue;
        }
        const range = { start: rm.index, end: rm.index + rm[0].length };
        if (rule.action === 'exempt' || rule.action === 'allow') {
          exemptSpans.push(range);
          calibrationObservations.push(
            createCalibrationObservation({
              source: blk.source,
              blockId,
              modality: blk.modality || 'document',
              correctionKind: 'custom_regex_rule',
              entityType: rule.entityType,
              action: 'exempt',
              labelSafe: 1,
              span: range,
              ruleId: rule.ruleId,
              provenanceTag: `human_correction:custom_regex:${rule.ruleId}`,
              reviewerId: rule.reviewerId,
              reason: rule.reason,
            })
          );
        } else {
          mergedNeural.push({
            kind: 'text',
            entityType: rule.entityType,
            type: rule.entityType,
            start: range.start,
            end: range.end,
            text: rm[0],
            score: rule.score,
            confidence: rule.score,
            provenanceTag: `human_correction:custom_regex:${rule.ruleId}`,
            adapterId: 'human_correction',
          });
          calibrationObservations.push(
            createCalibrationObservation({
              source: blk.source,
              blockId,
              modality: blk.modality || 'document',
              correctionKind: 'custom_regex_rule',
              entityType: rule.entityType,
              action: 'redact',
              labelSafe: 0,
              previousScore: 0,
              span: range,
              ruleId: rule.ruleId,
              provenanceTag: `human_correction:custom_regex:${rule.ruleId}`,
              reviewerId: rule.reviewerId,
              reason: rule.reason,
            })
          );
        }
      }
    }

    if (mergedNeural.length > 0) blk.neuralSpans = mergedNeural;
    if (detectorSpans.length > 0) blk.detectorSpans = detectorSpans;
    if (exemptSpans.length > 0) blk.exemptSpans = exemptSpans;
  }

  // Run Graph-Coupled Cross-Modal Conformal Redaction (GC-CRC) across all perceived blocks
  const gccrc = runGraphCoupledConformalRedaction(rawBlocks, {
    ...perceptionOptions,
    vault,
    workspaceSalt,
  });

  // Optional conformal gatekeeper evaluation over perceived blocks (with structured diagnostics & dual-channel e-value hook)
  const gateTokenizer = options.gatekeeper ? createTokenizer() : null;
  const forensicSources = new Set(forensicFindings.map((f) => f.source));

  // Optional keyword scoping: keep only blocks whose source text matches a keyword
  // (with deterministic structural breakdown: email <-> name/handle, separators, phone digits).
  const compiledKeywords = compileTermList(readTermList(options.keywords));
  const keywordTerms = compiledKeywords.map((t) => t.key);
  const extractedBlocks = [];
  for (const blk of gccrc.blocks) {
    const matchedKeywords =
      compiledKeywords.length > 0
        ? matchTermKeysInText(String(blk.originalText), compiledKeywords, { mode: 'keywords' })
        : [];
    if (compiledKeywords.length > 0 && matchedKeywords.length === 0) continue;

    let finalBlk = { ...blk, matchedKeywords };
    if (options.gatekeeper) {
      const featureRow =
        typeof options.featureExtractor === 'function'
          ? options.featureExtractor(finalBlk)
          : finalBlk.featureRow ||
            extractFeatureRow(
              {
                text: finalBlk.maskedText,
                piiItems: finalBlk.entities,
                confidence: Math.max(0.05, 1 - (finalBlk.coupledRiskScore ?? 0)),
              },
              gateTokenizer.encode(finalBlk.maskedText)
            );
      const secE =
        typeof options.secondaryEValue === 'function'
          ? options.secondaryEValue(finalBlk)
          : options.secondaryEValue !== undefined
            ? options.secondaryEValue
            : typeof options.adversaryEValue === 'function'
              ? options.adversaryEValue(finalBlk)
              : options.adversaryEValue;
      const primE =
        typeof options.primaryEValue === 'function'
          ? options.primaryEValue(finalBlk)
          : options.primaryEValue;

      const gateDecision = decideGatekeeper(options.gatekeeper, featureRow, {
        ...(primE !== undefined ? { primaryEValue: primE } : {}),
        ...(secE !== undefined ? { secondaryEValue: secE } : {}),
        ...(options.eValueWeights ? { eValueWeights: options.eValueWeights } : {}),
        ...(options.delta !== undefined ? { delta: options.delta } : {}),
        ...(options.failOnForensicAnomaly && forensicSources.has(finalBlk.source)
          ? { forensicAnomaly: true, forensicRecoverable: Boolean(options.forensicRecoverable) }
          : {}),
      });
      finalBlk = {
        ...finalBlk,
        gateAction: gateDecision.action,
        policyAction: gateDecision.policyAction,
        rejectionReason: gateDecision.rejectionReason,
        recoverability: gateDecision.recoverability,
        gateDecision,
      };
    }
    extractedBlocks.push(finalBlk);
  }

  // Build Unlimited-OCR-style structured perception tag stream & token-windowed training chunks
  cleanEngine.dedupReset();
  const docTagsBySource = new Map();
  const chunks = [];
  const markdownLines = [];

  for (let i = 0; i < extractedBlocks.length; i++) {
    const blk = extractedBlocks[i];
    const src = blk.source || 'document';
    if (!docTagsBySource.has(src)) docTagsBySource.set(src, []);
    docTagsBySource.get(src).push(formatPerceptionBlockTag(blk, i));
    markdownLines.push(blk.maskedText);

    const wins = cleanEngine.chunkByTokenWindow(blk.maskedText, {
      maxTokens: maxTokensPerChunk,
      overlapTokens,
    });
    for (const w of wins) {
      const probe = w.text.replace(/^\[(?:Speech|Slide|\d{1,2}:\d{2})[^\]]*\]\s*/i, '').trim() || w.text;
      const d = cleanEngine.dedupCheck(probe, 0.85);
      if (d.action === 'exact_duplicate' || d.action === 'near_duplicate') continue;
      chunks.push({
        id: `chunk_${chunks.length + 1}`,
        source: src,
        modality: blk.modality || 'document',
        role: blk.structRole || 'PARAGRAPH',
        gate: blk.gateAction,
        policyAction: blk.policyAction,
        rejectionReason: blk.rejectionReason,
        recoverability: blk.recoverability,
        coupledRiskScore: blk.coupledRiskScore,
        text: w.text,
        tokenEstimate: w.tokenCount,
        entityIds: Array.from(new Set((blk.entities || []).map((e) => e.entityId))),
      });
    }
  }

  const perceptionStream = Array.from(docTagsBySource.entries())
    .map(([src, tags]) => `<DOC src="${src}">\n  ${tags.join('\n  ')}\n</DOC>`)
    .join('\n');

  const markdown = markdownLines.join('\n\n');
  const sftJsonl = chunks
    .map((c) =>
      JSON.stringify({
        id: c.id,
        source: c.source,
        modality: c.modality,
        messages: [
          { role: 'system', content: 'Answer strictly from the provided sanitized context.' },
          { role: 'user', content: `Summarize the key record from ${c.source} (${c.role}).` },
          { role: 'assistant', content: c.text },
        ],
      })
    )
    .join('\n');

  const ptlmSftJsonl = chunks
    .map((c) => {
      const ptlm = computePtlmMaskedSpans(c.text);
      return JSON.stringify({
        id: c.id,
        source: c.source,
        modality: c.modality,
        ptlm_mask_spans: ptlm.spans,
        ptlm_placeholder_count: ptlm.placeholderCount,
        ptlm_unmasked_ratio: ptlm.unmaskedTokenRatio,
        messages: [
          { role: 'system', content: 'Answer strictly from the provided sanitized context.' },
          { role: 'user', content: `Summarize the key record from ${c.source} (${c.role}).` },
          { role: 'assistant', content: c.text },
        ],
      });
    })
    .join('\n');

  const sceneTimeline = buildOmnimodalSceneTimeline(extractedBlocks);

  // Index into zero-import Dual-CSR versieve_graph.wasm for <1ms PPR & GDPR Art. 17 erasure
  const graphIndex = new PortableDocumentGraph({ workspaceSalt });
  const docsForGraph = Array.from(docTagsBySource.keys()).map((src) => ({
    source: src,
    blocks: extractedBlocks
      .filter((b) => (b.source || 'document') === src)
      .map((b) => ({
        text: b.maskedText,
        structRole: b.structRole || 'PARAGRAPH',
        breadcrumb: b.breadcrumb || src,
        modality: b.modality || 'document',
        entityIds: Array.from(new Set((b.entities || []).map((e) => e.entityId))),
        preRedacted: true,
      })),
    diagramEdges: diagramEdgesBySource.get(src) || [],
    chartSeries: chartSeriesBySource.get(src) || [],
  }));
  graphIndex.indexDocuments(docsForGraph);

  const receiptPayload = {
    engine: 'versieve-gccrc-v1',
    blockCount: extractedBlocks.length,
    sourceBlockCount: gccrc.blocks.length,
    keywords: keywordTerms,
    chunkCount: chunks.length,
    anchorPoolSize: gccrc.anchorPoolSize,
    propagatedSpansCount: gccrc.propagatedSpansCount,
    forensicFindingsCount: forensicFindings.length,
    perceptionSha256: sha256Hex(perceptionStream),
  };

  // Inventory of every masked span so callers can audit what was (and was not) redacted.
  const seen = new Set();
  const redactedValues = [];
  for (const blk of extractedBlocks) {
    for (const e of blk.entities || []) {
      const value = blk.originalText.slice(e.start, e.end);
      const key = `${e.token}\u0000${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      redactedValues.push({
        value,
        token: e.token,
        type: e.type,
        category: e.category,
        ...(e.provenanceTag ? { provenanceTag: e.provenanceTag } : {}),
      });
    }
  }

  // Conformal risk statistics & document-cluster feed for HC-CRC / E-LTT
  const clusterMap = new Map();
  let riskSum = 0;
  let maxRisk = 0;
  for (const blk of extractedBlocks) {
    const r = Number(blk.coupledRiskScore ?? 0);
    riskSum += r;
    if (r > maxRisk) maxRisk = r;
    const cid = blk.source || 'document';
    if (!clusterMap.has(cid)) clusterMap.set(cid, []);
    clusterMap.get(cid).push({
      blockId: blk.blockId,
      prob: blk.gateDecision ? blk.gateDecision.prob : Number(Math.max(0, Math.min(1, 1 - r)).toFixed(4)),
      coupledRiskScore: r,
      entityCount: (blk.entities || []).length,
      imageDetectionCount: (blk.imageDetections || []).length,
      gateAction: blk.gateAction,
      policyAction: blk.policyAction,
      rejectionReason: blk.rejectionReason,
      recoverability: blk.recoverability,
    });
  }
  const pluggedImageDetectionsCount =
    imageArtifacts.reduce((s, a) => s + (a.detections?.length || 0), 0) +
    videoArtifacts.reduce((s, a) => s + (a.imageDetections?.length || 0), 0);

  const conformalRiskStats = {
    blockCount: extractedBlocks.length,
    maxCoupledRiskScore: Number(maxRisk.toFixed(4)),
    meanCoupledRiskScore: extractedBlocks.length > 0 ? Number((riskSum / extractedBlocks.length).toFixed(4)) : 0,
    pluggedTextSpansCount,
    pluggedImageDetectionsCount,
    detectorAdapterIds: adapters.map((a) => a.id),
    clusters: Array.from(clusterMap.entries()).map(([clusterId, blocks]) => ({ clusterId, blocks })),
  };

  return {
    perceptionStream,
    markdown,
    chunks,
    redactedValues,
    sftJsonl,
    ptlmSftJsonl,
    sceneTimeline,
    blocks: extractedBlocks,
    anchorPoolSize: gccrc.anchorPoolSize,
    propagatedSpansCount: gccrc.propagatedSpansCount,
    forensicFindings,
    audioArtifacts,
    videoArtifacts,
    imageArtifacts,
    calibrationObservations,
    conformalRiskStats,
    graph: graphIndex,
    receipt: {
      ...receiptPayload,
      receiptSha256: sha256Hex(JSON.stringify(receiptPayload)),
    },
  };
}
