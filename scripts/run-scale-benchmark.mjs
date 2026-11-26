#!/usr/bin/env node
/**
 * scripts/run-scale-benchmark.mjs
 *
 * Versieve 1,207-Document Public Benchmark & Multi-Race Audit Runner
 * 1. Executes 1,207-Document Multi-Source Public Benchmark (PMC Clinical PDFs + FUNSD + ai4privacy + PubMedQA)
 * 2. Audits 4 Real Races:
 *    - Race 1: Born-Digital PDF Front Door vs. 2D Tiled OCR (and 4/8 CIDFont ToUnicode CMap null)
 *    - Race 2: PII Disambiguation & Honest Regex Ceiling (ai4privacy structured vs. bare names)
 *    - Race 3: Learn-Then-Test (LTT) Conformal Gatekeeper Calibration on N = 1,207 docs
 *    - Race 4: Same-Session Substrate & Downstream Training Race (C99 hot-loop win vs. JS/WASM)
 * 3. Optional flag-gated External NER Baselines on the exact 500 ai4privacy-200k records / 580 scored spans:
 *    - --presidio / --with-presidio  (Microsoft Presidio + spaCy en_core_web_lg)
 *    - --gliner   / --with-gliner    (Local Apache-2.0 GLiNER-PII-Edge 45M INT8 ONNX)
 *    Default invocation (no flags) remains 100% byte-identical to the baseline run.
 * 4. Verifies 100% byte-identical SVG determinism across independent passes
 * 5. Prints comprehensive MLSys-style audit report
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runScaleAndParadigmBenchmark } from '../src/scale-benchmark.js';
import { scanRecordsForPII } from '../src/clean-and-tokenize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Exact Paper A Race 2 tag sets (matching src/scale-benchmark.js lines 902-910)
export const AI4PRIVACY_CONTACT_LABELS = Object.freeze([
  'EMAIL', 'PHONENUMBER', 'CREDITCARDNUMBER', 'IPV4',
]);
export const AI4PRIVACY_TARGETED_8_LABELS = Object.freeze([
  'EMAIL', 'PHONENUMBER', 'CREDITCARDNUMBER', 'IPV4', 'SSN', 'DATE', 'DOB', 'IP',
]);
export const AI4PRIVACY_26_STRUCTURED_LABELS = Object.freeze([
  'EMAIL', 'PHONENUMBER', 'PHONE', 'SSN', 'CREDITCARDNUMBER', 'CREDIT_CARD',
  'IP', 'IPV4', 'IPV6', 'DATE', 'DOB', 'TIME', 'URL', 'IBAN', 'MAC', 'BIC',
  'BITCOINADDRESS', 'ETHEREUMADDRESS', 'LITECOINADDRESS', 'PIN', 'PHONEIMEI',
  'VEHICLEVIN', 'VEHICLEVRM', 'MASKEDNUMBER', 'ACCOUNTNUMBER', 'ZIPCODE',
]);
export const AI4PRIVACY_BARE_NAME_LABELS = Object.freeze([
  'FIRSTNAME', 'LASTNAME', 'MIDDLENAME',
]);

// Predicted entity types that map to the 26 structured tag scope (excludes free-form PERSON/ORG/LOC/ADDRESS)
const STRUCTURED_PRED_TYPES = new Set([
  'EMAIL', 'EMAIL_ADDRESS', 'PHONE', 'PHONE_NUMBER', 'PHONENUMBER', 'CREDIT_CARD',
  'CREDIT CARD NUMBER', 'CREDITCARDNUMBER', 'SSN', 'US_SSN', 'IP', 'IP_ADDRESS',
  'IP ADDRESS', 'IPV4', 'IPV6', 'DATE', 'DATE_TIME', 'DATE OF BIRTH', 'DOB', 'TIME',
  'URL', 'IBAN', 'IBAN_CODE', 'MAC', 'BIC', 'CRYPTO', 'BITCOINADDRESS',
  'ETHEREUMADDRESS', 'LITECOINADDRESS', 'PIN', 'PHONEIMEI', 'VEHICLEVIN',
  'VEHICLEVRM', 'MASKEDNUMBER', 'ACCOUNTNUMBER', 'ACCOUNT NUMBER', 'US_BANK_NUMBER',
  'US_ITIN', 'US_PASSPORT', 'US_DRIVER_LICENSE', 'UK_NHS', 'ZIPCODE', 'ZIP_CODE',
  'POSTAL_CODE', 'NRP',
]);

export function parseScaleBenchmarkArgs(argv = []) {
  const opts = {
    help: false,
    withPresidio: false,
    withGliner: false,
    externalOnly: false,
    pythonPath: null,
    spacyModel: 'en_core_web_lg',
    presidioThreshold: 0.50,
    glinerThreshold: 0.40,
    ai4privacyPath: null,
    glinerModelDir: null,
    outJsonPath: null,
    seed: 42,
    bootstraps: 1000,
    unknownFlags: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--presidio' || arg === '--with-presidio') {
      opts.withPresidio = true;
    } else if (arg === '--gliner' || arg === '--with-gliner') {
      opts.withGliner = true;
    } else if (arg === '--external-only') {
      opts.externalOnly = true;
    } else if (arg === '--python' && i + 1 < argv.length) {
      opts.pythonPath = argv[++i];
    } else if (arg.startsWith('--python=')) {
      opts.pythonPath = arg.slice('--python='.length);
    } else if (arg === '--spacy-model' && i + 1 < argv.length) {
      opts.spacyModel = argv[++i];
    } else if (arg.startsWith('--spacy-model=')) {
      opts.spacyModel = arg.slice('--spacy-model='.length);
    } else if (arg === '--presidio-threshold' && i + 1 < argv.length) {
      opts.presidioThreshold = Number(argv[++i]);
    } else if (arg.startsWith('--presidio-threshold=')) {
      opts.presidioThreshold = Number(arg.slice('--presidio-threshold='.length));
    } else if (arg === '--gliner-threshold' && i + 1 < argv.length) {
      opts.glinerThreshold = Number(argv[++i]);
    } else if (arg.startsWith('--gliner-threshold=')) {
      opts.glinerThreshold = Number(arg.slice('--gliner-threshold='.length));
    } else if (arg === '--ai4privacy-path' && i + 1 < argv.length) {
      opts.ai4privacyPath = argv[++i];
    } else if (arg.startsWith('--ai4privacy-path=')) {
      opts.ai4privacyPath = arg.slice('--ai4privacy-path='.length);
    } else if (arg === '--gliner-model-dir' && i + 1 < argv.length) {
      opts.glinerModelDir = argv[++i];
    } else if (arg.startsWith('--gliner-model-dir=')) {
      opts.glinerModelDir = arg.slice('--gliner-model-dir='.length);
    } else if (arg === '--out-json' && i + 1 < argv.length) {
      opts.outJsonPath = argv[++i];
    } else if (arg.startsWith('--out-json=')) {
      opts.outJsonPath = arg.slice('--out-json='.length);
    } else if (arg === '--seed' && i + 1 < argv.length) {
      opts.seed = Number(argv[++i]);
    } else if (arg.startsWith('--seed=')) {
      opts.seed = Number(arg.slice('--seed='.length));
    } else if (arg === '--bootstraps' && i + 1 < argv.length) {
      opts.bootstraps = Number(argv[++i]);
    } else if (arg.startsWith('--bootstraps=')) {
      opts.bootstraps = Number(arg.slice('--bootstraps='.length));
    } else {
      opts.unknownFlags.push(arg);
    }
  }

  return opts;
}

function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function wilsonIntervalPct(k, n, z = 1.959963984540054) {
  if (n <= 0) return [0, 0];
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return [
    Number((Math.max(0, center - half) * 100).toFixed(2)),
    Number((Math.min(1, center + half) * 100).toFixed(2)),
  ];
}

function spansOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function dedupeSpans(spans) {
  if (!Array.isArray(spans) || spans.length === 0) return [];
  const ordered = [...spans].sort((a, b) =>
    a.start - b.start || (b.end - b.start) - (a.end - a.start) || (b.score ?? 1) - (a.score ?? 1)
  );
  const out = [];
  let lastEnd = -1;
  for (const s of ordered) {
    if (s.start >= lastEnd) {
      out.push(s);
      lastEnd = s.end;
    }
  }
  return out;
}

function bootstrapRatioCI(perDocPairs, { bootstraps = 1000, seed = 42 } = {}) {
  const n = perDocPairs.length;
  if (n === 0 || bootstraps <= 0) return [0, 0];
  const rng = mulberry32(seed);
  const vals = new Array(bootstraps);
  for (let b = 0; b < bootstraps; b++) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * n);
      num += perDocPairs[idx][0];
      den += perDocPairs[idx][1];
    }
    vals[b] = den > 0 ? (num / den) * 100 : 0;
  }
  vals.sort((a, b) => a - b);
  return [
    Number(vals[Math.floor(0.025 * bootstraps)].toFixed(2)),
    Number(vals[Math.min(bootstraps - 1, Math.floor(0.975 * bootstraps))].toFixed(2)),
  ];
}

function bootstrapF1CI(perDocStats, { bootstraps = 1000, seed = 42 } = {}) {
  // perDocStats: [[gtTp, gtFn, predTp, predFp], ...]
  const n = perDocStats.length;
  if (n === 0 || bootstraps <= 0) return [0, 0];
  const rng = mulberry32(seed);
  const vals = new Array(bootstraps);
  for (let b = 0; b < bootstraps; b++) {
    let gtp = 0;
    let gfn = 0;
    let ptp = 0;
    let pfp = 0;
    for (let i = 0; i < n; i++) {
      const [a, c, d, e] = perDocStats[Math.floor(rng() * n)];
      gtp += a;
      gfn += c;
      ptp += d;
      pfp += e;
    }
    const r = gtp + gfn > 0 ? gtp / (gtp + gfn) : 0;
    const p = ptp + pfp > 0 ? ptp / (ptp + pfp) : 0;
    vals[b] = p + r > 0 ? ((2 * p * r) / (p + r)) * 100 : 0;
  }
  vals.sort((a, b) => a - b);
  return [
    Number(vals[Math.floor(0.025 * bootstraps)].toFixed(2)),
    Number(vals[Math.min(bootstraps - 1, Math.floor(0.975 * bootstraps))].toFixed(2)),
  ];
}

/**
 * Deterministically scores predicted spans against ai4privacy-200k records using
 * exact character-offset overlap on the Paper A 26-tag denominator (580 spans),
 * core contact/card/IPv4 (140), targeted-8 (253), bare names (238), and all 56 tags (1,556).
 */
export function scoreAi4PrivacyPredictions(records, predsPerRecord, { seed = 42, bootstraps = 1000 } = {}) {
  const contactSet = new Set(AI4PRIVACY_CONTACT_LABELS);
  const targetedSet = new Set(AI4PRIVACY_TARGETED_8_LABELS);
  const struct26Set = new Set(AI4PRIVACY_26_STRUCTURED_LABELS);
  const bareNameSet = new Set(AI4PRIVACY_BARE_NAME_LABELS);

  const tally = (filterGtFn, filterPredFn, precisionGtFn) => {
    let gtTp = 0;
    let gtFn = 0;
    let valTp = 0;
    let predTp = 0;
    let predFp = 0;
    const perDocRecall = [];
    const perDocValRecall = [];
    const perDocPrec = [];
    const perDocF1 = [];

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const srcText = String(rec.source_text || '');
      const allGt = rec.privacy_mask || [];
      const gtSlice = allGt.filter(filterGtFn);
      const precGtSlice = precisionGtFn ? allGt.filter(precisionGtFn) : gtSlice;
      const rawPreds = (predsPerRecord[i] || []).filter(filterPredFn);
      const preds = dedupeSpans(rawPreds);
      const hitVals = preds.map((p) =>
        String(p.value !== undefined ? p.value : srcText.slice(p.start, p.end)).toLowerCase()
      );

      let docGtTp = 0;
      let docValTp = 0;
      for (const m of gtSlice) {
        const hit = preds.some((p) => spansOverlap(p.start, p.end, m.start, m.end));
        if (hit) docGtTp++;
        const val = String(m.value !== undefined ? m.value : srcText.slice(m.start, m.end)).toLowerCase();
        const valMatched =
          val.length > 0 && hitVals.some((hv) => hv.length > 0 && (hv === val || hv.includes(val) || val.includes(hv)));
        if (valMatched) docValTp++;
      }
      const docGtFn = gtSlice.length - docGtTp;

      let docPredTp = 0;
      for (const p of preds) {
        const hit = precGtSlice.some((m) => spansOverlap(p.start, p.end, m.start, m.end));
        if (hit) docPredTp++;
      }
      const docPredFp = preds.length - docPredTp;

      gtTp += docGtTp;
      gtFn += docGtFn;
      valTp += docValTp;
      predTp += docPredTp;
      predFp += docPredFp;

      perDocRecall.push([docGtTp, gtSlice.length]);
      perDocValRecall.push([docValTp, gtSlice.length]);
      perDocPrec.push([docPredTp, preds.length]);
      perDocF1.push([docGtTp, docGtFn, docPredTp, docPredFp]);
    }

    const gtTotal = gtTp + gtFn;
    const predTotal = predTp + predFp;
    const recall = gtTotal > 0 ? gtTp / gtTotal : 0;
    const valRecall = gtTotal > 0 ? valTp / gtTotal : 0;
    const precision = predTotal > 0 ? predTp / predTotal : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    return {
      tp: gtTp,
      fn: gtFn,
      gtTotal,
      spans: `${gtTp}/${gtTotal}`,
      valueMatchTp: valTp,
      valueMatchSpans: `${valTp}/${gtTotal}`,
      valueMatchRecallPct: Number((valRecall * 100).toFixed(2)),
      valueMatchRecallWilson95CI: wilsonIntervalPct(valTp, gtTotal),
      valueMatchRecallBootstrap95CI: bootstrapRatioCI(perDocValRecall, { bootstraps, seed: seed + 3 }),
      predTotal,
      predTp,
      predFp,
      recallPct: Number((recall * 100).toFixed(2)),
      recallWilson95CI: wilsonIntervalPct(gtTp, gtTotal),
      recallBootstrap95CI: bootstrapRatioCI(perDocRecall, { bootstraps, seed }),
      precisionPct: Number((precision * 100).toFixed(2)),
      precisionWilson95CI: wilsonIntervalPct(predTp, predTotal),
      precisionBootstrap95CI: bootstrapRatioCI(perDocPrec, { bootstraps, seed: seed + 1 }),
      f1Pct: Number((f1 * 100).toFixed(2)),
      f1Bootstrap95CI: bootstrapF1CI(perDocF1, { bootstraps, seed: seed + 2 }),
    };
  };

  const anyPred = () => true;
  const structPred = (p) => STRUCTURED_PRED_TYPES.has(String(p.type || p.label || '').toUpperCase());
  const is26 = (m) => struct26Set.has(String(m.label || '').toUpperCase());
  const isContact = (m) => contactSet.has(String(m.label || '').toUpperCase());
  const isTargeted = (m) => targetedSet.has(String(m.label || '').toUpperCase());
  const isBareName = (m) => bareNameSet.has(String(m.label || '').toUpperCase());
  const isAnyGt = () => true;

  // Primary Paper A 26-tag scope:
  // - recall over the exact 580 structured spans (any detector hit covering the span)
  // - precision evaluated cleanly in two ways:
  //     (a) structured26AnyGtPrecision: predicted spans overlapping ANY of the 56 GT PII tags (avoids penalizing true PERSON detections)
  //     (b) structured26StrictFiltered: structured-type predicted spans overlapping the 26-tag GT subset
  const structured26 = tally(is26, anyPred, isAnyGt);
  const structured26Strict = tally(is26, structPred, is26);
  const contactCardIpv4 = tally(isContact, anyPred, isAnyGt);
  const targeted8 = tally(isTargeted, anyPred, isAnyGt);
  const bareNames = tally(isBareName, anyPred, isAnyGt);
  const all56Tags = tally(isAnyGt, anyPred, isAnyGt);

  return {
    recordsEvaluated: records.length,
    seed,
    bootstraps,
    structured26: {
      ...structured26,
      precisionDefinition: 'Fraction of predicted spans overlapping any ground-truth PII span in privacy_mask (56-tag GT); recall is over the exact 26 structured tags (580 spans).',
      strictStructuredOnlyPrecisionPct: structured26Strict.precisionPct,
      strictStructuredOnlyPrecisionWilson95CI: structured26Strict.precisionWilson95CI,
      strictStructuredOnlyF1Pct: structured26Strict.f1Pct,
      strictStructuredOnlyF1Bootstrap95CI: structured26Strict.f1Bootstrap95CI,
      strictStructuredOnlyPredTotal: structured26Strict.predTotal,
    },
    contactCardIpv4,
    targeted8,
    bareNames,
    all56Tags,
  };
}

function resolveDefaultPython() {
  if (process.env.VERSIEVE_PYTHON) return process.env.VERSIEVE_PYTHON;
  if (process.platform === 'win32' && fs.existsSync('C:\\Python312\\python.exe')) {
    return 'C:\\Python312\\python.exe';
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function emitFailClosedError(payload) {
  const out = {
    ok: false,
    ...payload,
  };
  console.error(JSON.stringify(out, null, 2));
  process.exit(2);
}

function runExternalNerArms(opts) {
  const pythonBin = opts.pythonPath || resolveDefaultPython();
  const ai4Path = path.resolve(
    opts.ai4privacyPath ||
      (process.env.VERSIEVE_UNTRUSTED_BENCHMARKS_DIR
        ? path.join(process.env.VERSIEVE_UNTRUSTED_BENCHMARKS_DIR, 'ai4privacy-500.json')
        : 'results/untrusted-benchmarks/ai4privacy-500.json')
  );
  const glinerModelDir = path.resolve(
    opts.glinerModelDir ||
      (process.env.VERSIEVE_UNTRUSTED_BENCHMARKS_DIR
        ? path.join(process.env.VERSIEVE_UNTRUSTED_BENCHMARKS_DIR, 'track-e-public/models/gliner-pii-edge')
        : 'results/untrusted-benchmarks/track-e-public/models/gliner-pii-edge')
  );
  const outJsonPath = path.resolve(opts.outJsonPath || 'results/scale-and-paradigm-benchmark.json');
  const workerScript = path.resolve(REPO_ROOT, 'scripts/run-gate-over-detector-and-stitched-shootout.py');

  const requestedArms = [];
  if (opts.withPresidio) requestedArms.push('presidio');
  if (opts.withGliner) requestedArms.push('gliner_edge');

  if (!fs.existsSync(ai4Path)) {
    emitFailClosedError({
      errorCode: 'DATASET_MISSING',
      message: `Required ai4privacy dataset not found: ${ai4Path}`,
      requestedArms,
      missingPaths: [ai4Path],
    });
  }
  if (!fs.existsSync(workerScript)) {
    emitFailClosedError({
      errorCode: 'WORKER_SCRIPT_MISSING',
      message: `Required Python worker script not found: ${workerScript}`,
      requestedArms,
      missingPaths: [workerScript],
    });
  }
  if (opts.withGliner) {
    const onnxFile = path.join(glinerModelDir, 'onnx', 'model_quint8.onnx');
    const tokFile = path.join(glinerModelDir, 'tokenizer.json');
    const missing = [onnxFile, tokFile].filter((p) => !fs.existsSync(p));
    if (missing.length > 0) {
      emitFailClosedError({
        errorCode: 'EXTERNAL_RUNTIME_MISSING',
        message: 'GLiNER-Edge ONNX weights or tokenizer missing locally (fail-closed).',
        requestedArms,
        missingRuntimes: ['gliner_edge_onnx_weights'],
        missingPaths: missing,
      });
    }
  }

  const pyArgs = [
    workerScript,
    '--mode', 'ai4privacy-ner',
    '--ai4privacy-path', ai4Path,
    '--spacy-model', opts.spacyModel,
    '--presidio-threshold', String(opts.presidioThreshold),
    '--gliner-threshold', String(opts.glinerThreshold),
    '--gliner-model-dir', glinerModelDir,
  ];
  if (opts.withPresidio) pyArgs.push('--presidio');
  if (opts.withGliner) pyArgs.push('--gliner');

  const proc = spawnSync(pythonBin, pyArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (proc.error) {
    emitFailClosedError({
      errorCode: 'EXTERNAL_RUNTIME_MISSING',
      message: `Failed to execute Python runtime "${pythonBin}": ${proc.error.message}`,
      requestedArms,
      pythonPath: pythonBin,
      missingRuntimes: ['python'],
    });
  }

  let parsed = null;
  try {
    parsed = JSON.parse((proc.stdout || '').trim());
  } catch {
    // fall through to structured failure
  }

  if (proc.status !== 0 || !parsed || parsed.ok !== true) {
    emitFailClosedError({
      errorCode: parsed?.errorCode || 'EXTERNAL_RUNTIME_MISSING',
      message: parsed?.message || `External NER Python worker exited with status ${proc.status}`,
      requestedArms,
      pythonPath: pythonBin,
      missingRuntimes: parsed?.missingRuntimes || requestedArms,
      diagnostics: parsed || { stderr: (proc.stderr || '').slice(0, 2000) },
    });
  }

  const records = JSON.parse(fs.readFileSync(ai4Path, 'utf8'));

  // Always compute matched-protocol Versieve format-validated regex baseline on the exact same records
  const versieveRegexPreds = records.map((rec) =>
    scanRecordsForPII(rec.source_text || '').map((h) => ({
      start: h.start,
      end: h.end,
      value: h.value,
      type: String(h.type || '').toUpperCase(),
      score: 1.0,
    }))
  );
  const versieveRegexScored = scoreAi4PrivacyPredictions(records, versieveRegexPreds, {
    seed: opts.seed,
    bootstraps: opts.bootstraps,
  });

  const arms = {
    versieve_regex_matched_protocol: {
      detector: 'Versieve Format-Validated Regex (scanRecordsForPII)',
      license: 'Apache-2.0',
      runtime: `Node.js ${process.version}`,
      ...versieveRegexScored,
    },
  };

  for (const [armKey, armPayload] of Object.entries(parsed.arms || {})) {
    const scored = scoreAi4PrivacyPredictions(records, armPayload.predictions, {
      seed: opts.seed,
      bootstraps: opts.bootstraps,
    });
    arms[armKey] = {
      detector: armPayload.detector,
      modelVersion: armPayload.modelVersion,
      spacyPipeline: armPayload.spacyPipeline ?? null,
      packageVersions: armPayload.packageVersions,
      modelSha256: armPayload.modelSha256 ?? null,
      license: armPayload.license,
      scoreThreshold: armPayload.scoreThreshold,
      latencyMs: armPayload.latencyMs,
      ...scored,
    };
  }

  const externalBlock = {
    generatedAt: parsed.generatedAt,
    dataset: 'ai4privacy/pii-masking-200k (exact 500-record Paper A split)',
    datasetLicense: 'Apache-2.0 (ai4privacy-200k synthetic PII benchmark)',
    recordsEvaluated: records.length,
    structured26DenominatorSpans: arms.versieve_regex_matched_protocol.structured26.gtTotal,
    all56DenominatorSpans: arms.versieve_regex_matched_protocol.all56Tags.gtTotal,
    seed: opts.seed,
    bootstraps: opts.bootstraps,
    pythonRuntime: parsed.pythonRuntime,
    arms,
  };

  // Append-only write into outJsonPath: preserve all existing committed baseline keys verbatim
  let existing = {};
  if (fs.existsSync(outJsonPath)) {
    existing = JSON.parse(fs.readFileSync(outJsonPath, 'utf8'));
  }
  const merged = {
    ...existing,
    race_2_external_ner_baselines: externalBlock,
  };
  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.writeFileSync(outJsonPath, JSON.stringify(merged, null, 2), 'utf8');

  console.log('\n========================================================================');
  console.log('   RACE 2 (PAPER A R5): EXTERNAL NER BASELINES ON ai4privacy-200k       ');
  console.log('========================================================================');
  console.log(` Records: ${records.length} | 26-Tag Spans: ${externalBlock.structured26DenominatorSpans} | All-56 Spans: ${externalBlock.all56DenominatorSpans} | Seed: ${opts.seed} (${opts.bootstraps} boot)`);
  for (const [key, arm] of Object.entries(arms)) {
    const s26 = arm.structured26;
    const bn = arm.bareNames;
    const a56 = arm.all56Tags;
    console.log(` - ${key}:`);
    console.log(`     26-Tag Recall: ${s26.recallPct}% (${s26.spans}, 95% Wilson [${s26.recallWilson95CI[0]}%, ${s26.recallWilson95CI[1]}%], Boot [${s26.recallBootstrap95CI[0]}%, ${s26.recallBootstrap95CI[1]}%])`);
    console.log(`     PII Precision: ${s26.precisionPct}% (${s26.predTp}/${s26.predTotal}, 95% Wilson [${s26.precisionWilson95CI[0]}%, ${s26.precisionWilson95CI[1]}%]) | 26-Tag F1: ${s26.f1Pct}% [${s26.f1Bootstrap95CI[0]}%, ${s26.f1Bootstrap95CI[1]}%]`);
    console.log(`     Bare-Name Rec: ${bn.recallPct}% (${bn.spans}) | All-56 F1: ${a56.f1Pct}% (P=${a56.precisionPct}%, R=${a56.recallPct}%)`);
  }
  console.log(` Appended race_2_external_ner_baselines -> ${outJsonPath}\n`);
  return externalBlock;
}

function runBaselineScaleBenchmark() {
  console.log('========================================================================');
  console.log('   VERSIEVE — 1,207-DOCUMENT PUBLIC BENCHMARK & MULTI-RACE AUDIT       ');
  console.log('   FUNSD (199) + ai4privacy (500) + PubMedQA (500) + PMC Full-Text (8)   ');
  console.log('========================================================================\n');

  const svgPath = path.resolve('docs/scale-and-paradigm-benchmark.svg');
  const jsonPath = path.resolve('results/scale-and-paradigm-benchmark.json');

  // Step 1: Execute Pass 1 with live Python measurement
  console.log('1. Executing 1,207-Document Multi-Source Benchmark (Pass 1)...');
  const t0 = performance.now();
  const pass1 = runScaleAndParadigmBenchmark({
    write: true,
    runPythonSubprocess: true,
    timestamp: '2026-11-15T00:00:00.000Z'
  });
  const pass1Ms = Math.round(performance.now() - t0);

  if (!fs.existsSync(svgPath) || !fs.existsSync(jsonPath)) {
    console.error('Expected benchmark output artifacts not found.');
    process.exit(1);
  }

  const svg1 = fs.readFileSync(svgPath, 'utf8');
  const sha1 = crypto.createHash('sha256').update(svg1).digest('hex');
  console.log(`   - Pass 1 Total Latency: ${pass1Ms.toLocaleString()} ms`);
  console.log(`   - Pass 1 SVG SHA-256:   ${sha1}`);

  // Step 2: Determinism Check Across Passes
  console.log('\n2. Verifying Deterministic Byte-Identical Output Across Passes (Pass 2)...');
  const pass2 = runScaleAndParadigmBenchmark({
    write: false,
    timestamp: '2026-11-15T00:00:00.000Z'
  });
  const sha2 = crypto.createHash('sha256').update(pass2.svg).digest('hex');
  console.log(`   - Pass 2 SVG SHA-256:   ${sha2}`);

  if (sha1 === sha2) {
    console.log('   ✓ SUCCESS: SVG visualization is 100% byte-identical across runs!');
  } else {
    console.error('   ✗ FAILED: SVG visualization differs across runs!');
    process.exit(1);
  }

  // Read results JSON
  const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const meta = report.corpus_metadata;
  const r1 = report.race_1_born_digital_vs_tiled_ocr;
  const r2 = report.race_2_pii_disambiguation_regex_ceiling;
  const r3 = report.race_3_ltt_conformal_calibration;
  const r4 = report.race_4_substrate_and_downstream_race;
  const summary = report.summary_findings;

  console.log('\n========================================================================');
  console.log('            1,207-DOCUMENT PUBLIC BENCHMARK CORPUS AUDIT                ');
  console.log('========================================================================');
  console.log(` Total Distinct Documents:     ${meta.total_documents.toLocaleString().padEnd(8)} (100% Real Public External Data)`);
  console.log(` ICDAR-2019 FUNSD Forms:       ${meta.funsd_scanned_forms.toString().padEnd(8)} (Archival Scanned Memos, Faxes, Forms)`);
  console.log(` ai4privacy-200k Records:      ${meta.ai4privacy_records.toString().padEnd(8)} (Ground-Truth PII Spans & Masks)`);
  console.log(` PubMedQA Labeled QA:          ${meta.pubmedqa_records.toString().padEnd(8)} (Biomedical Clinical Research QA)`);
  console.log(` Born-Digital PMC PDFs:        ${meta.pmc_clinical_pdfs.toString().padEnd(8)} (Full-Text Open Access Clinical Trials)`);
  console.log(` Documents Containing PII:     ${meta.documents_with_pii.toLocaleString().padEnd(8)} (Emails, Phones, Hospital Addrs)`);
  console.log(` Documents With Lookalikes:    ${meta.documents_with_lookalikes.toLocaleString().padEnd(8)} (Technical & Clinical Entities)`);
  console.log('------------------------------------------------------------------------');

  console.log('\n========================================================================');
  console.log('   RACE 1: BORN-DIGITAL PDF FRONT DOOR & 2D TILED LAYOUT GEOMETRY        ');
  console.log('========================================================================');
  console.log(` PMC Clean Stream Extraction:  ${r1.pmc_pdf_eval.cleanExtractedPdfs}/${r1.pmc_pdf_eval.totalPdfs} PDFs (${r1.pmc_pdf_eval.totalReadableLines} lines, ${r1.pmc_pdf_eval.totalReadableWords} words in ${r1.pmc_pdf_eval.totalLatencyMs} ms total / ${r1.pmc_pdf_eval.avgLatencyPerPdfMs} ms avg)`);
  console.log(' FUNSD Scanned Forms (N = 199 forms, 30,595 bboxes) Geometric Survival:');
  for (const [mode, m] of Object.entries(r1.funsd_scanned_eval.modes)) {
    console.log(`   - ${mode.padEnd(22)}: Bbox Survival ${String(m.bboxLegibilitySurvivalPct + '%').padEnd(8)} (${m.wordsSurvived} / ${r1.funsd_scanned_eval.totalWordsMeasured} words)`);
  }

  console.log('\n========================================================================');
  console.log('   RACE 2: PII DISAMBIGUATION & HONEST REGEX CEILING                    ');
  console.log('========================================================================');
  console.log(` ai4privacy Core Contact/IPv4: ${r2.ai4privacy_ground_truth.contact_card_ipv4_recall_pct}% (${r2.ai4privacy_ground_truth.contact_spans})`);
  console.log(` ai4privacy All 26 Struct Tags:${r2.ai4privacy_ground_truth.all_26_structured_pii_recall_pct}% (${r2.ai4privacy_ground_truth.all_structured_spans})`);
  console.log(` ai4privacy Bare-Name Recall:  ${r2.ai4privacy_ground_truth.unstructured_bare_name_recall_pct}% (${r2.ai4privacy_ground_truth.bare_name_spans})`);
  console.log(` PubMedQA Blind Test Title-Case: Naive ${r2.pubmedqa_clinical_eval.test_split_250.naive_hits_per_1k_words}/1k words -> Lexicon ${r2.pubmedqa_clinical_eval.test_split_250.context_hits_per_1k_words}/1k words (${r2.pubmedqa_clinical_eval.hit_reduction_ratio_test}x fewer hits)`);

  console.log('\n========================================================================');
  console.log('   RACE 3: LEARN-THEN-TEST (LTT) CONFORMAL GATEKEEPER CALIBRATION       ');
  console.log('========================================================================');
  console.log(` Split: n_train = ${r3.split.nTrain}, n_cal = ${r3.split.nCal} (unsafe = ${r3.split.nCalUnsafe}), n_test = ${r3.split.nTest} (unsafe = ${r3.split.nTestUnsafe})`);
  console.log(' Alpha Budget | tau_keep | Cond FPR (%) | Joint Risk (%) | Safe Yield (%) | Abstain (%) | Status');
  console.log('--------------+----------+--------------+----------------+----------------+-------------+-------------------');
  for (const a of Object.values(r3.alphaSweep)) {
    console.log(` α = ${String(a.alpha.toFixed(2)).padEnd(5)}   | ${String(a.tauKeep.toFixed(2)).padEnd(8)} | ${String(a.testCondFprPct + '%').padEnd(12)} | ${String(a.testJointRiskPct + '%').padEnd(14)} | ${String(a.safeRetentionYieldPct + '%').padEnd(14)} | ${String(a.abstentionRatePct + '%').padEnd(11)} | ${a.status}`);
  }
  const ub = r3.uncalibratedBaseline;
  console.log(` Uncalibrated | tau=${ub.tauKeep.toFixed(2)} | ${String(ub.testCondFprPct + '%').padEnd(12)} | ${String(ub.testJointRiskPct + '%').padEnd(14)} | ${String(ub.safeRetentionYieldPct + '%').padEnd(14)} | ${String(ub.abstentionRatePct + '%').padEnd(11)} | Uncontrolled`);

  console.log('\n========================================================================');
  console.log(`   RACE 4: ${r4.trialsPerSubstrate}-RUN INTERLEAVED SUBSTRATE & DOWNSTREAM ABLATION               `);
  console.log('========================================================================');
  console.log(` Single-Header C99 (12.4 KB):  OS Spawn ${r4.substrates.single_header_c99.processSpawnColdStartMs} ms | RSS ${r4.substrates.single_header_c99.peakRssMb} MB | Hot Loop ${r4.substrates.single_header_c99.hotLoopInferenceMs} ms`);
  console.log(` Node + WASM (60.1 KB):        OS Spawn ${r4.substrates.pure_wasm_js.processSpawnColdStartMs} ms (in-proc ${r4.substrates.pure_wasm_js.inProcessWarmWasmInitMs} ms) | RSS ${r4.substrates.pure_wasm_js.peakRssMb} MB | Hot Loop ${r4.substrates.pure_wasm_js.hotLoopInferenceMs} ms`);
  console.log(` Python + NumPy:               OS Spawn ${r4.substrates.python_numpy.processSpawnColdStartMs} ms (import ${r4.substrates.python_numpy.importMs} ms) | RSS ${r4.substrates.python_numpy.peakRssMb} MB | Hot Loop ${r4.substrates.python_numpy.hotLoopInferenceMs} ms`);
  console.log(` Python + PyTorch + DuckDB:    OS Spawn ${r4.substrates.local_python.processSpawnColdStartMs} ms (import ${r4.substrates.local_python.frameworkImportMs} ms) | RSS ${r4.substrates.local_python.peakRssMb} MB`);

  console.log('\n========================================================================');
  console.log('                        SUMMARY VERIFICATION                            ');
  console.log('========================================================================');
  console.log(` OS Spawn Speedup vs. PyTorch:           ${summary.speedup_vs_pytorch_spawn}x faster (${r4.substrates.pure_wasm_js.processSpawnColdStartMs} ms vs. ${r4.substrates.local_python.processSpawnColdStartMs} ms)`);
  console.log(` RAM Reduction vs. PyTorch:              ${summary.memory_reduction_factor_vs_pytorch}x smaller (${r4.substrates.pure_wasm_js.peakRssMb} MB vs. ${r4.substrates.local_python.peakRssMb} MB)`);
  console.log(` C99 Hot-Loop vs. Node JIT:              ${summary.c99_hot_loop_speedup_vs_js}x faster (${r4.substrates.single_header_c99.hotLoopInferenceMs} ms vs. ${r4.substrates.pure_wasm_js.hotLoopInferenceMs} ms; NumPy BLAS: ${summary.numpy_hot_loop_ms} ms)`);
  console.log(` Held-Out Gatekeeper Loss N=100->Full:   -${summary.post_training_gate_bce_loss_reduction_pct}% (${r4.downstreamAblation.ablation_100.versieve_conformal.heldOutGateBceLoss} -> ${r4.downstreamAblation.ablation_full_train.versieve_conformal.heldOutGateBceLoss}), Acc ${summary.post_training_gate_acc_full_train}%`);
  console.log(` Held-Out Needle R@5 (125 Q->Body):      ${summary.needle_recall_at_5_versieve}% (vs Raw ${r4.needleBenchmark.raw_unmasked.recallAt5Pct}%)`);
  console.log('\n Honest Findings & Boundaries:');
  for (const nullReport of summary.honest_nulls_and_boundaries_reported) {
    console.log(`   - ${nullReport}`);
  }
  console.log('========================================================================\n');
  console.log(' Artifacts Written:');
  console.log('   - results/scale-and-paradigm-benchmark.json');
  console.log('   - docs/scale-and-paradigm-benchmark.svg\n');
}

function printHelp() {
  console.log(`Usage: node scripts/run-scale-benchmark.mjs [options]

Default (no flags): executes the exact 1,207-document baseline benchmark (byte-identical).

Optional External NER Baseline Flags (Paper A R5, fail-closed if runtimes missing):
  --presidio, --with-presidio     Run Microsoft Presidio (spaCy) on the 500 ai4privacy-200k records
  --gliner, --with-gliner         Run local GLiNER-PII-Edge ONNX on the 500 ai4privacy-200k records
  --external-only                 Append external NER results without re-running Races 1-4
  --python <path>                 Python interpreter path (default: VERSIEVE_PYTHON or C:\\Python312\\python.exe)
  --spacy-model <name>            spaCy pipeline name for Presidio (default: en_core_web_lg)
  --presidio-threshold <float>    Presidio score threshold (default: 0.50)
  --gliner-threshold <float>      GLiNER-Edge score threshold (default: 0.40)
  --ai4privacy-path <path>        Override ai4privacy-500.json path
  --gliner-model-dir <path>       Override local gliner-pii-edge ONNX directory
  --out-json <path>               Output JSON path (default: results/scale-and-paradigm-benchmark.json)
  --seed <int>                    Bootstrap RNG seed (default: 42)
  --bootstraps <int>              Bootstrap resample count (default: 1000)
  --help, -h                      Show this message
`);
}

function main() {
  const rawArgv = process.argv.slice(2);
  if (rawArgv.length === 0) {
    // Byte-identical default path: zero external NER flags parsed or run
    runBaselineScaleBenchmark();
    return;
  }

  const opts = parseScaleBenchmarkArgs(rawArgv);
  if (opts.help) {
    printHelp();
    return;
  }
  if (opts.unknownFlags.length > 0) {
    emitFailClosedError({
      errorCode: 'INVALID_CLI_FLAGS',
      message: `Unknown CLI flags: ${opts.unknownFlags.join(', ')}`,
      unknownFlags: opts.unknownFlags,
    });
  }
  if (!Number.isInteger(opts.seed) || !Number.isInteger(opts.bootstraps) || opts.bootstraps < 1) {
    emitFailClosedError({
      errorCode: 'INVALID_CLI_FLAGS',
      message: `Invalid --seed (${opts.seed}) or --bootstraps (${opts.bootstraps})`,
    });
  }

  const wantsExternal = opts.withPresidio || opts.withGliner;
  if (opts.externalOnly && !wantsExternal) {
    emitFailClosedError({
      errorCode: 'INVALID_CLI_FLAGS',
      message: '--external-only requires at least one of --presidio or --gliner',
    });
  }

  if (!opts.externalOnly) {
    runBaselineScaleBenchmark();
  }
  if (wantsExternal) {
    runExternalNerArms(opts);
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main();
}
