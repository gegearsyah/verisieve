import test from 'node:test';
import assert from 'node:assert/strict';

import {
  perceive,
  perceiveMulti,
  createDetectorAdapter,
  createDetectorRegistry,
  validateDetectorAdapter,
  computeBoxIoU,
  DetectorAdapterError,
  trainGatekeeper,
  calibrateGatekeeper,
  calibrateClusterRobustGatekeeper,
  calibrateStreamingEProcessGatekeeper,
  decideGatekeeper,
  decideMultiAxisGatekeeper,
  combineConvexEValues,
  evaluateDualChannelEValue,
  mapGateActionToPolicy,
  observationsToCalibrationClusters,
  GATE_REJECTION_REASONS,
  GATE_RECOVERABILITY,
} from '../src/index.js';

function makeSolidRgbFrame(width, height, r, g, b) {
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 3] = r;
    pixels[i * 3 + 1] = g;
    pixels[i * 3 + 2] = b;
  }
  return pixels;
}

function getRgbPixel(pixels, width, x, y) {
  const off = (y * width + x) * 3;
  return [pixels[off], pixels[off + 1], pixels[off + 2]];
}

// Deterministic Mulberry32 PRNG for reproducible Monte Carlo e-value validity checks
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTrainedBundle() {
  const mkVec = (val) => new Float32Array(520).fill(val);
  const trainRows = Array.from({ length: 40 }, (_, i) => mkVec(i < 20 ? 0.8 : -0.8));
  const trainLabels = Array.from({ length: 40 }, (_, i) => (i < 20 ? 1 : 0));
  const bundle = trainGatekeeper(trainRows, trainLabels, { seed: 42, lr: 0.15, epochs: 35 });

  const calRows = [];
  const calLabels = [];
  for (let i = 0; i < 70; i++) {
    calRows.push(mkVec(0.65 + (i % 5) * 0.04));
    calLabels.push(1);
    calRows.push(mkVec(-0.05 - (i / 70) * 0.75));
    calLabels.push(0);
  }
  calibrateGatekeeper(bundle, calRows, calLabels, { alpha: 0.05, delta: 0.05, targetDropRecall: 0.90 });
  return { bundle, mkVec };
}

// ---------------------------------------------------------------------------
// 1. Pluggable Stage 3B Local Text Detector -> GC-CRC / SR-MP -> HC-CRC / E-LTT
// ---------------------------------------------------------------------------
test('Pluggable local text detector feeds Stage 3B redaction, cross-doc GC-CRC/SR-MP anchor coupling, and conformal risk stats', async () => {
  // Simulates a local Presidio/GLiNER adapter detecting a lowercase person name in doc 1 only;
  // doc 2 contains only a bare surname + phonetic ASR drift that the adapter does NOT tag directly.
  const mockLocalNer = createDetectorAdapter({
    id: 'mock-presidio-local',
    kind: 'text',
    provenanceTag: 'presidio:local-en',
    detect: async ({ kind, text, filePath }) => {
      assert.equal(kind, 'text');
      if (filePath !== 'memo.txt') return [];
      const needle = 'karel novotny';
      const idx = text.indexOf(needle);
      if (idx === -1) return [];
      return [
        {
          entityType: 'PERSON',
          start: idx,
          end: idx + needle.length,
          text: needle,
          score: 0.94,
          provenanceTag: 'presidio:local-en',
        },
      ];
    },
  });

  const registry = createDetectorRegistry([mockLocalNer]);
  assert.equal(registry.list('text').length, 1);
  assert.equal(registry.list('image').length, 0);

  const res = await perceiveMulti(
    [
      { name: 'memo.txt', text: 'Case owner: karel novotny approved the preliminary review.' },
      {
        name: 'hearing.vtt',
        text: 'WEBVTT\n\n00:00:02.000 --> 00:00:07.000\n<v Clerk>Later Novotny and Novotni confirmed receipt.\n',
      },
    ],
    {
      detectors: registry,
      workspaceSalt: 't2-text-adapter-test',
    }
  );

  // Plugged text span in doc 1 redacted with provenance tag preserved
  assert.doesNotMatch(res.markdown, /karel novotny/i);
  const memoBlock = res.blocks.find((b) => b.source === 'memo.txt');
  assert.ok(memoBlock, 'memo.txt block must be present');
  assert.ok(
    memoBlock.entities.some((e) => e.provenanceTag === 'presidio:local-en'),
    'Redacted entity must carry plugged adapter provenanceTag'
  );

  // Bare surname & phonetic drift in doc 2 automatically coupled via GC-CRC / SR-MP!
  assert.doesNotMatch(
    res.markdown,
    /\bNovotny\b|\bNovotni\b/,
    'GC-CRC/SR-MP must propagate plugged detector anchor to bare surname and phonetic drift in doc 2'
  );
  assert.ok(res.anchorPoolSize >= 2, 'Anchor pool must be seeded from plugged detector spans');
  assert.ok(res.propagatedSpansCount >= 1, 'Propagated spans count must reflect cross-doc coupling');

  // Shared entity graph & conformal risk statistics populated for HC-CRC / E-LTT
  assert.ok(res.graph.nodes.length >= 2);
  assert.deepEqual(res.conformalRiskStats.detectorAdapterIds, ['mock-presidio-local']);
  assert.equal(res.conformalRiskStats.pluggedTextSpansCount, 1);
  assert.ok(res.conformalRiskStats.maxCoupledRiskScore >= 0.85);
  assert.equal(res.conformalRiskStats.clusters.length, 2);
});

// ---------------------------------------------------------------------------
// 2. Pluggable Local Image-Region Detector -> IoU BBoxes + Zero-Import WASM Pixel Redaction
// ---------------------------------------------------------------------------
test('computeBoxIoU computes exact IoU across normalized, xywh, x1y1x2y2, and array box representations', () => {
  assert.equal(computeBoxIoU({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 10, height: 10 }), 1);
  assert.equal(computeBoxIoU({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 }), 0);
  // 5x10 overlap out of 10x10 + 10x10 - 50 = 150 -> 1/3
  const partial = computeBoxIoU(
    { x: 0, y: 0, width: 10, height: 10 },
    [5, 0, 15, 10]
  );
  assert.ok(Math.abs(partial - 1 / 3) < 1e-9, `Expected 1/3, got ${partial}`);
  const normIou = computeBoxIoU(
    { x: 0.25, y: 0.25, width: 0.5, height: 0.5, normalized: true },
    { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75, normalized: true }
  );
  assert.ok(Math.abs(normIou - 1.0) < 1e-9);
});

test('Pluggable local image-region detector reports IoU-compatible bboxes and deterministically redacts pixels via zero-import WASM kernel', async () => {
  const width = 40;
  const height = 40;
  const rawPixels = makeSolidRgbFrame(width, height, 210, 180, 90);

  const mockVisualDetector = createDetectorAdapter({
    id: 'mock-onnx-face-local',
    kind: 'image',
    provenanceTag: 'onnx:yunet-local',
    detect: async ({ kind, image }) => {
      assert.equal(kind, 'image');
      assert.equal(image.width, width);
      assert.equal(image.height, height);
      return [
        // Normalized bbox covering pixel region [4..20, 4..20]
        {
          entityType: 'FACE',
          bbox: { x: 0.1, y: 0.1, width: 0.4, height: 0.4, normalized: true },
          score: 0.96,
          provenanceTag: 'onnx:yunet-local',
        },
        // Pixel-space bbox covering [24..36, 24..36]
        {
          entityType: 'SIGNATURE',
          bbox: { x: 24, y: 24, width: 12, height: 12, normalized: false },
          score: 0.89,
        },
      ];
    },
  });

  const res = await perceive(
    { name: 'id-card.png', pixels: rawPixels, width, height, channels: 3 },
    {
      detectorAdapters: [mockVisualDetector],
      pixelMode: 'blackout',
    }
  );

  // Output blocks & imageArtifacts report IoU-compatible bounding boxes
  assert.equal(res.imageArtifacts.length, 1);
  const art = res.imageArtifacts[0];
  assert.equal(art.source, 'id-card.png');
  assert.equal(art.detections.length, 2);
  assert.ok(art.maskedPixels > 0, 'Zero-import WASM media kernel must mask pixels inside detected regions');

  const faceDet = art.detections.find((d) => d.entityType === 'FACE');
  const sigDet = art.detections.find((d) => d.entityType === 'SIGNATURE');
  assert.ok(faceDet && sigDet);
  assert.equal(faceDet.provenanceTag, 'onnx:yunet-local');
  assert.equal(sigDet.provenanceTag, 'onnx:yunet-local');
  assert.equal(
    computeBoxIoU(faceDet.bbox, { x: 0.1, y: 0.1, width: 0.4, height: 0.4, normalized: true }),
    1.0
  );
  assert.equal(
    computeBoxIoU(sigDet.bbox, { x: 24, y: 24, width: 12, height: 12 }),
    1.0
  );

  // Verify deterministic WASM blackout [18, 18, 22] inside BOTH boxes and untouched outside
  assert.deepEqual(getRgbPixel(art.pixels, width, 10, 10), [18, 18, 22]);
  assert.deepEqual(getRgbPixel(art.pixels, width, 30, 30), [18, 18, 22]);
  assert.deepEqual(getRgbPixel(art.pixels, width, 1, 1), [210, 180, 90]);

  // Verify block carries bboxes & imageDetections
  const imgBlock = res.blocks.find((b) => b.source === 'id-card.png');
  assert.ok(imgBlock);
  assert.equal(imgBlock.bboxes.length, 2);
  assert.equal(imgBlock.imageDetections.length, 2);

  // Also test image adapter plugged into video frames
  const f0 = { timeMs: 0, width: 20, height: 20, channels: 3, pixels: makeSolidRgbFrame(20, 20, 200, 100, 50) };
  const vidRes = await perceive(
    { name: 'clip.mp4', frames: [f0] },
    {
      detectors: [
        createDetectorAdapter({
          id: 'vid-face-local',
          kind: 'image',
          detect: () => [{ entityType: 'FACE', bbox: { x: 4, y: 4, width: 8, height: 8 }, score: 0.91 }],
        }),
      ],
      pixelMode: 'blackout',
    }
  );
  assert.equal(vidRes.videoArtifacts.length, 1);
  assert.ok(vidRes.videoArtifacts[0].redactedFrames[0].maskedPixels > 0);
  assert.deepEqual(getRgbPixel(vidRes.videoArtifacts[0].redactedFrames[0].pixels, 20, 8, 8), [18, 18, 22]);
});

// ---------------------------------------------------------------------------
// 3. Zero-Egress Fail-Closed Enforcement (No Silent Bypass or Passthrough)
// ---------------------------------------------------------------------------
test('Zero-egress fail-closed enforcement rejects remote config, missing weights/runtime, throwing adapters, and malformed spans loudly', async () => {
  // 3a. Disallowed remote URL / egress config
  assert.throws(
    () =>
      createDetectorAdapter({
        id: 'cloud-ner',
        kind: 'text',
        remoteUrl: 'https://api.example.com/v1/ner',
        detect: () => [],
      }),
    (err) => err instanceof DetectorAdapterError && err.code === 'DETECTOR_EGRESS_FORBIDDEN'
  );
  assert.throws(
    () =>
      validateDetectorAdapter({
        id: 'egress-flag',
        kind: 'text',
        egress: true,
        detect: () => [],
      }),
    (err) => err instanceof DetectorAdapterError && err.code === 'DETECTOR_EGRESS_FORBIDDEN'
  );
  assert.throws(
    () =>
      validateDetectorAdapter({
        id: 'remote-model-uri',
        kind: 'text',
        modelPath: 'https://huggingface.co/some/model.onnx',
        detect: () => [],
      }),
    (err) => err instanceof DetectorAdapterError && err.code === 'DETECTOR_EGRESS_FORBIDDEN'
  );

  // 3b. Missing local model weights / runtime fails closed inside perceive()
  await assert.rejects(
    () =>
      perceive('Sensitive record for Elena Vance', {
        detectors: [
          {
            id: 'missing-onnx',
            kind: 'text',
            modelPath: '/nonexistent/local/model_int8.onnx',
            detect: () => [],
          },
        ],
      }),
    (err) => err instanceof DetectorAdapterError && err.code === 'DETECTOR_WEIGHTS_MISSING'
  );

  await assert.rejects(
    () =>
      perceive('Sensitive record for Elena Vance', {
        detectors: [
          {
            id: 'missing-runtime',
            kind: 'text',
            runtimeCheck: async () => ({ ok: false, reason: 'onnxruntime-node not installed' }),
            detect: () => [],
          },
        ],
      }),
    (err) => err instanceof DetectorAdapterError && err.code === 'DETECTOR_RUNTIME_MISSING'
  );

  // 3c. Throwing adapter fails closed with ZERO raw canary text leaked in error message
  const canarySecret = 'CANARY_UNREDACTED_SECRET_99182736';
  await assert.rejects(
    () =>
      perceive(`Patient note containing ${canarySecret}`, {
        detectors: [
          createDetectorAdapter({
            id: 'crash-adapter',
            kind: 'text',
            detect: () => {
              throw new Error(`internal crash processing ${canarySecret}`);
            },
          }),
        ],
      }),
    (err) => {
      assert.ok(err instanceof DetectorAdapterError);
      assert.equal(err.code, 'DETECTOR_EXECUTION_FAILED');
      assert.ok(!err.message.includes(canarySecret), 'Fail-closed error message must never echo raw input bytes');
      return true;
    }
  );

  // 3d. Malformed spans fail closed (non-array, out-of-bounds offsets, invalid score, malformed bbox)
  await assert.rejects(
    () =>
      perceive('Hello world', {
        detectors: [
          createDetectorAdapter({
            id: 'bad-return',
            kind: 'text',
            detect: () => null,
          }),
        ],
      }),
    (err) => err instanceof DetectorAdapterError && err.code === 'DETECTOR_MALFORMED_SPAN'
  );

  await assert.rejects(
    () =>
      perceive('Short text', {
        detectors: [
          createDetectorAdapter({
            id: 'oob-span',
            kind: 'text',
            detect: () => [{ entityType: 'PERSON', start: 0, end: 999, score: 0.9 }],
          }),
        ],
      }),
    (err) => err instanceof DetectorAdapterError && err.code === 'DETECTOR_MALFORMED_SPAN'
  );

  await assert.rejects(
    () =>
      perceive(
        { name: 'bad.png', pixels: makeSolidRgbFrame(10, 10, 50, 50, 50), width: 10, height: 10, channels: 3 },
        {
          detectors: [
            createDetectorAdapter({
              id: 'bad-bbox',
              kind: 'image',
              detect: () => [{ entityType: 'FACE', bbox: { x: 0.8, y: 0.8, width: 0.5, height: 0.5, normalized: true }, score: 0.9 }],
            }),
          ],
        }
      ),
    (err) => err instanceof DetectorAdapterError && err.code === 'DETECTOR_MALFORMED_SPAN'
  );
});

// ---------------------------------------------------------------------------
// 4. Human-Correction Payload Feedback Loop (Manual BBox, Span Override/Exempt, Custom Regex)
// ---------------------------------------------------------------------------
test('Human-correction payload applies manual image bboxes, text span overrides/exemptions, and custom regex rules and logs calibration observations', async () => {
  const width = 32;
  const height = 32;
  const pixels = makeSolidRgbFrame(width, height, 230, 230, 230);

  const textDoc = 'Ticket DOSSIER-4821-AU assigned to zoltan_k; retain support@public.example but mask secret@private.example.';
  const res = await perceiveMulti(
    [
      { name: 'ticket.txt', text: textDoc },
      { name: 'scan.png', pixels, width, height, channels: 3 },
    ],
    {
      workspaceSalt: 't2-human-corrections',
      humanCorrections: {
        // 1. Manual image bounding box on scan.png
        imageBoxes: [
          {
            source: 'scan.png',
            entityType: 'HANDWRITTEN_SIGNATURE',
            bbox: { x: 4, y: 4, width: 10, height: 10, normalized: false },
            action: 'redact',
            reviewerId: 'reviewer-01',
            reason: 'Missed signature in corner',
          },
        ],
        // 2. Text span addition + exact span exemption
        spanOverrides: [
          {
            source: 'ticket.txt',
            text: 'zoltan_k',
            entityType: 'PERSON_HANDLE',
            action: 'add',
            reviewerId: 'reviewer-01',
          },
          {
            source: 'ticket.txt',
            text: 'support@public.example',
            entityType: 'EMAIL',
            action: 'exempt',
            reviewerId: 'reviewer-01',
            reason: 'Public generic helpdesk address',
          },
        ],
        // 3. Custom deterministic regex rule
        customRegexRules: [
          {
            id: 'au-dossier-id',
            pattern: '\\bDOSSIER-\\d{4}-[A-Z]{2}\\b',
            entityType: 'DOSSIER_CODE',
            action: 'redact',
            reviewerId: 'reviewer-01',
          },
        ],
      },
    }
  );

  // Verify deterministic text redaction & exemption
  assert.doesNotMatch(res.markdown, /DOSSIER-4821-AU/, 'Custom regex rule must redact matching dossier code');
  assert.doesNotMatch(res.markdown, /zoltan_k/, 'Manual span addition must redact zoltan_k');
  assert.doesNotMatch(res.markdown, /secret@private\.example/, 'Non-exempt email must stay redacted');
  assert.match(res.markdown, /support@public\.example/, 'Exempted span must remain unredacted');

  // Verify deterministic WASM pixel redaction from manual image bbox
  assert.equal(res.imageArtifacts.length, 1);
  assert.ok(res.imageArtifacts[0].maskedPixels > 0);
  assert.deepEqual(getRgbPixel(res.imageArtifacts[0].pixels, width, 8, 8), [18, 18, 22]);
  assert.deepEqual(getRgbPixel(res.imageArtifacts[0].pixels, width, 28, 28), [230, 230, 230]);

  // Verify structured calibration observations emitted for ALL 4 corrections
  assert.equal(res.calibrationObservations.length, 4);
  const kinds = new Set(res.calibrationObservations.map((o) => o.correctionKind));
  assert.ok(kinds.has('manual_image_bbox'));
  assert.ok(kinds.has('text_span_addition'));
  assert.ok(kinds.has('text_span_exemption'));
  assert.ok(kinds.has('custom_regex_rule'));

  const regexObs = res.calibrationObservations.find((o) => o.correctionKind === 'custom_regex_rule');
  assert.equal(regexObs.ruleId, 'au-dossier-id');
  assert.equal(regexObs.labelSafe, 0);

  const exemptObs = res.calibrationObservations.find((o) => o.correctionKind === 'text_span_exemption');
  assert.equal(exemptObs.labelSafe, 1);

  // Verify observations convert cleanly to HC-CRC / E-LTT calibration clusters
  const clusters = observationsToCalibrationClusters(res.calibrationObservations);
  assert.equal(clusters.length, 2);
  assert.ok(clusters.every((c) => Array.isArray(c.blocks) && c.blocks.length >= 1));
});

// ---------------------------------------------------------------------------
// 5. Structured Conformal Gate Diagnostics (rejectionReason, recoverability, policyAction)
// ---------------------------------------------------------------------------
test('Conformal gate emits deterministic rejectionReason, recoverability, and allow/redact/deny policyAction across KEEP, ABSTAIN, DROP, cluster, and multi-axis paths', () => {
  assert.equal(mapGateActionToPolicy('KEEP'), 'allow');
  assert.equal(mapGateActionToPolicy('KEEP_SAFE'), 'allow');
  assert.equal(mapGateActionToPolicy('KEEP_SAFE_REDACTED'), 'allow');
  assert.equal(mapGateActionToPolicy('ABSTAIN'), 'redact');
  assert.equal(mapGateActionToPolicy('ABSTAIN_HUMAN_REVIEW'), 'redact');
  assert.equal(mapGateActionToPolicy('DROP'), 'deny');
  assert.equal(mapGateActionToPolicy('DROP_OR_QUARANTINE'), 'deny');
  assert.equal(mapGateActionToPolicy('QUARANTINE_SECRET'), 'deny');

  const { bundle, mkVec } = buildTrainedBundle();

  // KEEP_SAFE -> allow / NONE / none
  const keepDec = decideGatekeeper(bundle, mkVec(0.95));
  assert.equal(keepDec.action, 'KEEP_SAFE');
  assert.equal(keepDec.policyAction, 'allow');
  assert.equal(keepDec.rejectionReason, GATE_REJECTION_REASONS.NONE);
  assert.equal(keepDec.recoverability, GATE_RECOVERABILITY.NONE);

  // DROP_OR_QUARANTINE -> deny / RISK_BUDGET_EXCEEDED / hard_drop
  const dropDec = decideGatekeeper(bundle, mkVec(-0.95));
  assert.equal(dropDec.action, 'DROP_OR_QUARANTINE');
  assert.equal(dropDec.policyAction, 'deny');
  assert.equal(dropDec.rejectionReason, GATE_REJECTION_REASONS.RISK_BUDGET_EXCEEDED);
  assert.equal(dropDec.recoverability, GATE_RECOVERABILITY.HARD_DROP);

  // ABSTAIN_HUMAN_REVIEW (certified risk budget) -> redact / RISK_BUDGET_EXCEEDED / recoverable_human_review
  const midBundle = {
    dim: 520,
    weights: Array.from(new Float32Array(520)),
    bias: 0.0, // prob = 0.50
    calibration: { certified: true, tauKeep: 0.75, tauDrop: 0.25, alpha: 0.05, delta: 0.05 },
  };
  const abstainDec = decideGatekeeper(midBundle, mkVec(0));
  assert.equal(abstainDec.action, 'ABSTAIN_HUMAN_REVIEW');
  assert.equal(abstainDec.abstained, true);
  assert.equal(abstainDec.policyAction, 'redact');
  assert.equal(abstainDec.rejectionReason, GATE_REJECTION_REASONS.RISK_BUDGET_EXCEEDED);
  assert.equal(abstainDec.recoverability, GATE_RECOVERABILITY.RECOVERABLE_HUMAN_REVIEW);

  // Uncertified calibration -> CALIBRATION_INSUFFICIENT / recoverable_recalibrate
  const uncertBundle = {
    dim: 520,
    weights: Array.from(new Float32Array(520)),
    bias: 2.0,
    calibration: { certified: false, tauKeep: 1.0, tauDrop: 0.0, nNegatives: 0, alpha: 0.05, delta: 0.05 },
  };
  const uncertDec = decideGatekeeper(uncertBundle, mkVec(0));
  assert.equal(uncertDec.action, 'ABSTAIN_HUMAN_REVIEW');
  assert.equal(uncertDec.policyAction, 'redact');
  assert.equal(uncertDec.rejectionReason, GATE_REJECTION_REASONS.CALIBRATION_INSUFFICIENT);
  assert.equal(uncertDec.recoverability, GATE_RECOVERABILITY.RECOVERABLE_RECALIBRATE);

  // Cluster-calibrated bundle -> CLUSTER_ADJUSTED_RISK_EXCEEDED
  const clusterBundle = {
    dim: 520,
    weights: Array.from(new Float32Array(520)),
    bias: 0.0,
    calibration: null,
    clusterCalibration: { certified: true, tauKeep: 0.75, tauDrop: 0.25, alpha: 0.05, delta: 0.05 },
  };
  const clusterAbstain = decideGatekeeper(clusterBundle, mkVec(0));
  assert.equal(clusterAbstain.action, 'ABSTAIN_HUMAN_REVIEW');
  assert.equal(clusterAbstain.rejectionReason, GATE_REJECTION_REASONS.CLUSTER_ADJUSTED_RISK_EXCEEDED);
  assert.equal(clusterAbstain.recoverability, GATE_RECOVERABILITY.RECOVERABLE_HUMAN_REVIEW);

  // Explicit detectorError, forensicAnomaly, unparsableInput
  const detErrDec = decideGatekeeper(bundle, mkVec(0.95), { detectorError: true });
  assert.equal(detErrDec.action, 'DROP_OR_QUARANTINE');
  assert.equal(detErrDec.policyAction, 'deny');
  assert.equal(detErrDec.rejectionReason, GATE_REJECTION_REASONS.DETECTOR_ERROR);
  assert.equal(detErrDec.recoverability, GATE_RECOVERABILITY.HARD_DROP);

  const forensicHard = decideGatekeeper(bundle, mkVec(0.95), { forensicAnomaly: true });
  assert.equal(forensicHard.rejectionReason, GATE_REJECTION_REASONS.FORENSIC_ANOMALY);
  assert.equal(forensicHard.recoverability, GATE_RECOVERABILITY.HARD_DROP);

  const forensicRecov = decideGatekeeper(bundle, mkVec(0.95), { forensicAnomaly: true, forensicRecoverable: true });
  assert.equal(forensicRecov.action, 'ABSTAIN_HUMAN_REVIEW');
  assert.equal(forensicRecov.rejectionReason, GATE_REJECTION_REASONS.FORENSIC_ANOMALY);
  assert.equal(forensicRecov.recoverability, GATE_RECOVERABILITY.RECOVERABLE_HUMAN_REVIEW);

  // Multi-axis topic block -> TOPIC_POLICY_BLOCK
  const multiBundle = {
    modelType: 'matilda-multiaxis-gatekeeper-v1',
    axes: ['safe', 'useful', 'topic'],
    models: {
      safe: { dim: 520, weights: Array.from(new Float32Array(520)), bias: 2.0, calibration: { certified: true, tauKeep: 0.7, tauDrop: 0.3 } },
      useful: { dim: 520, weights: Array.from(new Float32Array(520)), bias: 2.0, calibration: { certified: true, tauKeep: 0.7, tauDrop: 0.3 } },
      topic: { dim: 520, weights: Array.from(new Float32Array(520)), bias: -2.0, calibration: { certified: true, tauKeep: 0.7, tauDrop: 0.3 } },
    },
  };
  const topicDrop = decideMultiAxisGatekeeper(multiBundle, mkVec(0));
  assert.equal(topicDrop.conjunctionAction, 'DROP_OR_QUARANTINE');
  assert.equal(topicDrop.policyAction, 'deny');
  assert.equal(topicDrop.rejectionReason, GATE_REJECTION_REASONS.TOPIC_POLICY_BLOCK);
  assert.equal(topicDrop.recoverability, GATE_RECOVERABILITY.HARD_DROP);
});

// ---------------------------------------------------------------------------
// 6. Dual-Channel Secondary E-Value Hook (AC-CRC Convex Validity + Abstention + Backwards Compat)
// ---------------------------------------------------------------------------
test('combineConvexEValues validates weights/inputs and preserves E[E_joint] <= 1 and P(E_joint >= 1/delta) <= delta under dependent H0 Monte Carlo', () => {
  // Exact convex arithmetic
  assert.equal(combineConvexEValues(2, 10), 6); // default 0.5 / 0.5
  assert.ok(Math.abs(combineConvexEValues(2, 10, { w1: 0.25, w2: 0.75 }) - 8) < 1e-12);
  assert.ok(Math.abs(combineConvexEValues(2, 10, [0.8, 0.2]) - 3.6) < 1e-12);

  // Fail-closed validation on invalid weights or e-values
  assert.throws(() => combineConvexEValues(-0.1, 1.0), /INVALID_E_VALUE/);
  assert.throws(() => combineConvexEValues(1.0, Number.NaN), /INVALID_E_VALUE/);
  assert.throws(() => combineConvexEValues(1.0, 1.0, { w1: 0, w2: 1 }), /INVALID_E_VALUE_WEIGHTS/);
  assert.throws(() => combineConvexEValues(1.0, 1.0, { w1: 0.6, w2: 0.6 }), /INVALID_E_VALUE_WEIGHTS/);
  assert.throws(() => combineConvexEValues(1.0, 1.0, { w1: -0.2, w2: 1.2 }), /INVALID_E_VALUE_WEIGHTS/);

  // Seeded Monte Carlo check under H_0 with POSITIVELY DEPENDENT channels E1, E2
  // (shared latent exponential variable U ~ Exp(1), so E[E1] = 1 and E[E2] = 1 with strong dependence!)
  const rng = mulberry32(20261126);
  const N = 20000;
  const delta = 0.05;
  const threshold = 1 / delta; // 20.0
  let sumJoint = 0;
  let breaches = 0;

  for (let i = 0; i < N; i++) {
    // Dependent valid e-values under H_0:
    // E1 = -ln(u) ~ Exp(1) => E[E1] = 1
    // E2 = 2 * I[u < 0.5] (correlated with E1 through same u!) => E[E2] = 1
    const u = Math.max(1e-12, rng());
    const e1 = -Math.log(u);
    const e2 = u < 0.05 ? 20.0 * 0.95 : 0.05 / 0.95; // E[E2] = 0.05 * 19 + 0.95 * (0.05/0.95) = 1.0
    const joint = combineConvexEValues(e1, e2, { w1: 0.4, w2: 0.6 });
    assert.ok(joint >= 0);
    sumJoint += joint;
    if (joint >= threshold) breaches++;
  }

  const meanJoint = sumJoint / N;
  const empiricalBreachRate = breaches / N;
  assert.ok(meanJoint <= 1.04, `Expected E[E_joint] <= 1 under H_0 (got ${meanJoint.toFixed(4)})`);
  assert.ok(
    empiricalBreachRate <= delta + 0.005,
    `Expected P(E_joint >= 1/delta) <= delta=${delta} (got ${empiricalBreachRate.toFixed(4)})`
  );

  // evaluateDualChannelEValue structure check
  const ev = evaluateDualChannelEValue(1.0, 45.0, { eValueWeights: { w1: 0.5, w2: 0.5 }, delta: 0.05 });
  assert.equal(ev.jointEValue, 23.0);
  assert.equal(ev.threshold, 20.0);
  assert.equal(ev.exceeded, true);
});

test('Dual-channel secondary e-value triggers abstention when breaching 1/delta and stays 100% backwards-compatible when omitted', async () => {
  const { bundle, mkVec } = buildTrainedBundle();

  // Baseline without secondary channel -> KEEP_SAFE and no eValueDiagnostics key
  const baseDec = decideGatekeeper(bundle, mkVec(0.95));
  assert.equal(baseDec.action, 'KEEP_SAFE');
  assert.equal(baseDec.abstained, false);
  assert.equal(baseDec.eValueDiagnostics, undefined);

  // Benign secondary channel (jointE = 0.5*1 + 0.5*1.2 = 1.1 < 20) -> stays KEEP_SAFE
  const benignDec = decideGatekeeper(bundle, mkVec(0.95), {
    primaryEValue: 1.0,
    adversaryEValue: 1.2,
    delta: 0.05,
  });
  assert.equal(benignDec.action, 'KEEP_SAFE');
  assert.equal(benignDec.abstained, false);
  assert.equal(benignDec.policyAction, 'allow');
  assert.equal(benignDec.eValueDiagnostics.exceeded, false);

  // Breaching secondary channel (jointE = 0.5*1 + 0.5*45 = 23 >= 20) -> abstains!
  const breachDec = decideGatekeeper(bundle, mkVec(0.95), {
    primaryEValue: 1.0,
    adversaryEValue: 45.0,
    delta: 0.05,
  });
  assert.equal(breachDec.action, 'ABSTAIN_HUMAN_REVIEW');
  assert.equal(breachDec.abstained, true);
  assert.equal(breachDec.policyAction, 'redact');
  assert.equal(breachDec.rejectionReason, GATE_REJECTION_REASONS.E_VALUE_THRESHOLD_EXCEEDED);
  assert.equal(breachDec.recoverability, GATE_RECOVERABILITY.RECOVERABLE_HUMAN_REVIEW);
  assert.equal(breachDec.eValueDiagnostics.exceeded, true);
  assert.equal(breachDec.eValueDiagnostics.jointEValue, 23.0);

  // End-to-end perceive() with calibrated gatekeeper + breaching secondary e-value
  const perceived = await perceive('Routine operational update with zero personal data.', {
    gatekeeper: bundle,
    featureExtractor: () => mkVec(0.95),
    primaryEValue: 1.0,
    secondaryEValue: 50.0,
    delta: 0.05,
  });
  assert.equal(perceived.blocks[0].gateAction, 'ABSTAIN_HUMAN_REVIEW');
  assert.equal(perceived.blocks[0].policyAction, 'redact');
  assert.equal(perceived.blocks[0].rejectionReason, GATE_REJECTION_REASONS.E_VALUE_THRESHOLD_EXCEEDED);
  assert.equal(perceived.blocks[0].recoverability, GATE_RECOVERABILITY.RECOVERABLE_HUMAN_REVIEW);

  // E-LTT calibrateStreamingEProcessGatekeeper backwards compatibility when omitted vs. dual-channel enabled
  const calibClusters = Array.from({ length: 40 }, (_, d) => ({
    clusterId: `doc_${d}`,
    blocks: Array.from({ length: 4 }, () => ({
      prob: d < 32 ? 0.12 : 0.92,
      labelSafe: d < 32 ? 0 : 1,
    })),
  }));
  const bundleSingle = JSON.parse(JSON.stringify(bundle));
  const bundleDual = JSON.parse(JSON.stringify(bundle));
  calibrateStreamingEProcessGatekeeper(bundleSingle, calibClusters, { alpha: 0.15, delta: 0.05 });
  assert.equal(bundleSingle.eProcessCalibration.certified, true);
  assert.equal(bundleSingle.eProcessCalibration.dualChannel, undefined);

  calibrateStreamingEProcessGatekeeper(bundleDual, calibClusters, {
    alpha: 0.15,
    delta: 0.05,
    secondaryEValue: 25.0,
    eValueWeights: { w1: 0.5, w2: 0.5 },
  });
  assert.equal(bundleDual.eProcessCalibration.certified, true);
  assert.equal(bundleDual.eProcessCalibration.dualChannel.enabled, true);
  assert.deepEqual(bundleDual.eProcessCalibration.dualChannel.weights, { w1: 0.5, w2: 0.5 });

  // Also check HC-CRC compatibility with clusterCalibration
  const hccrcBundle = JSON.parse(JSON.stringify(bundle));
  hccrcBundle.calibration = null;
  calibrateClusterRobustGatekeeper(hccrcBundle, calibClusters, { alpha: 0.10, delta: 0.05 });
  assert.equal(hccrcBundle.clusterCalibration.certified, true);
});
