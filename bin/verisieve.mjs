#!/usr/bin/env node
/**
 * bin/verisieve.mjs
 * Universal CLI for VeriSieve:
 * - Zero-Egress Unstructured Document Sieve, Dual PII Redactor & Conformal Client-Side Token Gatekeeper
 * - BYOD file/folder/URL processing (PDF, PNG, BMP, HTML, EML, CSV, JSON, TXT)
 * - Conformal gatekeeper training, calibration & routing inference
 * - Zero external npm dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runCleanAndTokenizePipeline, extractFeatureRow, scanRecordsForPII } from '../src/clean-and-tokenize.js';
import { trainGatekeeper, calibrateGatekeeper, decideGatekeeper } from '../src/gatekeeper.js';
import {
  auditCactusWasmArtifact,
  decodeImageBuffer,
  decodePdfImageXObject,
  runTiledOcrAsync,
  resolveCactusWeightsBytes,
  DEFAULT_MIRAGE_WEIGHTS_PATH,
} from '../src/ocr-engine.js';
import { auditVerisieveDlWasm } from '../src/wasm-needle-dl.js';
import { loadCleanWasm } from '../src/clean-wasm.js';
import { extractPdfDetailed } from '../src/pdf-parser.js';
import { extractDocxText, stripHtmlBoilerplate, ingestUrl } from '../src/ingestor.js';
import { ingestFromUrlOrPath } from '../src/pdf-image-pipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, '..');

const rawArgs = process.argv.slice(2);

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eqIdx = a.indexOf('=');
      if (eqIdx > 2) {
        flags[a.slice(2, eqIdx)] = a.slice(eqIdx + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

async function auditCleanWasmArtifact(wasmPath) {
  const fullPath = path.isAbsolute(wasmPath) ? wasmPath : path.resolve(process.cwd(), wasmPath);
  if (!fs.existsSync(fullPath)) {
    return {
      ok: false,
      zeroEgressVerified: false,
      wasmPath: fullPath,
      error: `WASM binary not found at ${fullPath}`,
    };
  }
  const bytes = fs.readFileSync(fullPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
  const mod = await WebAssembly.compile(bytes);
  const imports = WebAssembly.Module.imports(mod);
  const exports = WebAssembly.Module.exports(mod).map((e) => e.name);
  if (imports.length > 0) {
    return {
      ok: false,
      zeroEgressVerified: false,
      wasmPath: fullPath,
      byteLength: bytes.length,
      sha256,
      importCount: imports.length,
      imports,
      exports,
      error: `Non-zero imports detected (${imports.length}) in verisieve_clean.wasm`,
    };
  }
  const engine = await loadCleanWasm(bytes);
  return {
    ok: engine.abiVersion === 1,
    zeroEgressVerified: engine.abiVersion === 1 && imports.length === 0,
    wasmPath: fullPath,
    byteLength: bytes.length,
    sha256,
    importCount: 0,
    abiVersion: engine.abiVersion,
    exports,
  };
}

async function auditDlWasmArtifact(wasmPath) {
  const fullPath = path.isAbsolute(wasmPath) ? wasmPath : path.resolve(process.cwd(), wasmPath);
  if (!fs.existsSync(fullPath)) {
    return {
      ok: false,
      zeroEgressVerified: false,
      wasmPath: fullPath,
      error: `WASM binary not found at ${fullPath}`,
    };
  }
  const bytes = fs.readFileSync(fullPath);
  const mod = await WebAssembly.compile(bytes);
  const imports = WebAssembly.Module.imports(mod);
  if (imports.length > 0) {
    return {
      ok: false,
      zeroEgressVerified: false,
      wasmPath: fullPath,
      byteLength: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
      importCount: imports.length,
      imports,
      error: `Non-zero imports detected (${imports.length}) in verisieve_dl.wasm`,
    };
  }
  const report = await auditVerisieveDlWasm(fullPath);
  return {
    ...report,
    wasmPath: fullPath,
    zeroEgressVerified: Boolean(report.ok && report.airGapped && imports.length === 0),
  };
}

function isUrlTarget(target) {
  return typeof target === 'string' && (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(target) || target.startsWith('arxiv:'));
}

async function readBinaryOrTextForCli(targetPath, options = {}) {
  if (isUrlTarget(targetPath)) {
    const urlRes = await ingestUrl(targetPath, options);
    return {
      sourceType: 'url',
      format: 'text',
      title: urlRes.title,
      url: urlRes.finalUrl || urlRes.url,
      links: urlRes.links,
      cleanText: urlRes.cleanText,
      text: urlRes.cleanText,
    };
  }
  const fullPath = path.resolve(targetPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Input path not found: ${targetPath}`);
  }
  const ext = path.extname(fullPath).toLowerCase();
  const buf = fs.readFileSync(fullPath);
  if (ext === '.pdf') {
    const pdfRes = await extractPdfDetailed(buf);
    const lines = pdfRes.lines || [];
    if (lines.length === 0) {
      if ((pdfRes.images || []).length > 0) {
        if (!resolveCactusWeightsBytes(options)) {
          throw new Error(
            `PDF_IMAGE_ONLY_REQUIRES_OCR: ${path.basename(fullPath)} has 0 selectable text lines and ${pdfRes.images.length} embedded images; supply local ${DEFAULT_MIRAGE_WEIGHTS_PATH} (MIRAGE_WEIGHTS_REQUIRED)`
          );
        }
        const ocrTexts = [];
        for (const img of pdfRes.images) {
          const decoded = decodePdfImageXObject(img);
          const ocr = await runTiledOcrAsync(decoded, { ...options, filename: path.basename(fullPath), sourceFormat: 'pdf' });
          ocrTexts.push(...(ocr.lines || []).map((l) => l.text));
        }
        const joined = ocrTexts.join('\n');
        return { sourceType: 'pdf_ocr', format: 'text', text: joined, cleanText: joined };
      }
      throw new Error(`PDF_EMPTY_TEXT_LAYER: ${path.basename(fullPath)} yielded zero extractable text lines`);
    }
    const joined = lines.join('\n');
    return { sourceType: 'pdf', format: 'text', text: joined, cleanText: joined };
  }
  if (ext === '.docx') {
    const docxRes = extractDocxText(buf, options);
    const joined = docxRes.lines.join('\n');
    return { sourceType: 'docx', format: 'text', text: joined, cleanText: joined };
  }
  if (ext === '.png' || ext === '.bmp') {
    const decoded = decodeImageBuffer(buf, path.basename(fullPath));
    if (!resolveCactusWeightsBytes(options)) {
      throw new Error(
        `IMAGE_REQUIRES_OCR_PROVIDER: Cannot extract real text from ${path.basename(fullPath)} without local ${DEFAULT_MIRAGE_WEIGHTS_PATH} (MIRAGE_WEIGHTS_REQUIRED)`
      );
    }
    const ocrRes = await runTiledOcrAsync(decoded, { ...options, filename: path.basename(fullPath), sourceFormat: 'image' });
    const joined = (ocrRes.lines || []).map((l) => l.text).join('\n');
    return { sourceType: 'image', format: 'text', text: joined, cleanText: joined };
  }
  if (ext === '.html' || ext === '.htm') {
    const stripped = stripHtmlBoilerplate(buf.toString('utf8'));
    return {
      sourceType: 'html',
      format: 'text',
      title: stripped.title,
      links: stripped.links,
      cleanText: stripped.cleanText,
      text: stripped.cleanText,
    };
  }
  const formatMap = { '.json': 'json', '.csv': 'csv', '.eml': 'email' };
  const text = buf.toString('utf8');
  return { sourceType: 'file', format: formatMap[ext] || 'text', text, cleanText: text };
}

function parseDatasetFile(datasetPath) {
  const fullPath = path.resolve(datasetPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Dataset file not found: ${datasetPath}`);
  }
  const raw = fs.readFileSync(fullPath, 'utf8').trim();
  if (!raw) {
    throw new Error(`Dataset file is empty: ${datasetPath}`);
  }
  const ext = path.extname(fullPath).toLowerCase();
  if (ext === '.json') {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.rows)) return parsed.rows;
    if (Array.isArray(parsed.featureRows) && Array.isArray(parsed.labels)) {
      return parsed.featureRows.map((fr, idx) => ({ featureRow: fr, label: parsed.labels[idx] }));
    }
    throw new Error('JSON dataset must be an array of { label, text|featureRow } objects');
  }
  if (ext === '.jsonl' || ext === '.ndjson' || raw.startsWith('{')) {
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const startIdx = /^(label|text)\s*,/i.test(lines[0]) ? 1 : 0;
  const rows = [];
  for (let i = startIdx; i < lines.length; i++) {
    const comma = lines[i].indexOf(',');
    if (comma <= 0) continue;
    const left = lines[i].slice(0, comma).trim().replace(/^"|"$/g, '');
    const right = lines[i].slice(comma + 1).trim().replace(/^"|"$/g, '');
    if (left === '0' || left === '1') {
      rows.push({ label: Number(left), text: right });
    } else if (right === '0' || right === '1') {
      rows.push({ label: Number(right), text: left });
    }
  }
  return rows;
}

function stratifiedDisjointSplit(featureRows, labels, calRatio = 0.5) {
  const posIdx = [];
  const negIdx = [];
  for (let i = 0; i < labels.length; i++) {
    if (Number(labels[i]) === 1) posIdx.push(i);
    else negIdx.push(i);
  }
  const splitClass = (indices) => {
    if (indices.length < 2) {
      return { train: indices, cal: [] };
    }
    let nCal = Math.round(indices.length * calRatio);
    nCal = Math.max(1, Math.min(indices.length - 1, nCal));
    return {
      train: indices.slice(0, indices.length - nCal),
      cal: indices.slice(indices.length - nCal),
    };
  };
  const pos = splitClass(posIdx);
  const neg = splitClass(negIdx);
  const trainIdx = [...pos.train, ...neg.train];
  const calIdx = [...pos.cal, ...neg.cal];
  return {
    trainRows: trainIdx.map((i) => featureRows[i]),
    trainLabels: trainIdx.map((i) => labels[i]),
    calRows: calIdx.map((i) => featureRows[i]),
    calLabels: calIdx.map((i) => labels[i]),
  };
}

const { flags, positional } = parseArgs(rawArgs);
let command = positional[0];

if (!command || command === 'selftest') {
  console.log('VeriSieve CLI v1.0.0');
  console.log('Running selftest pipeline...');
  const sample = 'Invoice #12345 from alice@example.com total $500.00. Phone +61 412 345 678.';
  const res = runCleanAndTokenizePipeline(sample, { format: 'text' });
  console.log('Ingest & Tokenize OK:', res.blocks.length, 'blocks,', res.tokenizedChunks.length, 'chunks.');
  console.log('Node Hash:', res.nodeHash);
  console.log('Selftest passed successfully!');
  process.exit(0);
}

if (command === 'audit-wasm') {
  try {
    const singleTarget = flags.wasm || positional[1];
    if (singleTarget) {
      const base = path.basename(singleTarget).toLowerCase();
      let report;
      if (base.includes('verisieve_clean')) {
        report = await auditCleanWasmArtifact(singleTarget);
      } else if (base.includes('verisieve_dl')) {
        report = await auditDlWasmArtifact(singleTarget);
      } else {
        report = await auditCactusWasmArtifact(singleTarget, { strict: true });
      }
      console.log(JSON.stringify(report, null, 2));
      if (!report.zeroEgressVerified) {
        process.exit(1);
      }
    } else {
      const cactus = await auditCactusWasmArtifact(path.join(PKG_ROOT, 'vendor/cactus/cactus.wasm'), { strict: true });
      const verisieveClean = await auditCleanWasmArtifact(path.join(PKG_ROOT, 'vendor/wasm/verisieve_clean.wasm'));
      const verisieveDl = await auditDlWasmArtifact(path.join(PKG_ROOT, 'vendor/wasm/verisieve_dl.wasm'));
      const allVerified = Boolean(
        cactus.zeroEgressVerified &&
        verisieveClean.zeroEgressVerified &&
        verisieveDl.zeroEgressVerified
      );
      const summary = {
        allVerified,
        binaries: {
          cactus,
          verisieve_clean: verisieveClean,
          verisieve_dl: verisieveDl,
        },
      };
      console.log(JSON.stringify(summary, null, 2));
      if (!allVerified) {
        process.exit(1);
      }
    }
  } catch (err) {
    console.error('Error auditing WASM artifact:', err.message);
    process.exit(1);
  }
} else if (command === 'run' || (!['ingest', 'train', 'decide', 'audit-wasm', 'selftest'].includes(command) && positional.length > 0)) {
  const target = command === 'run' ? positional[1] : command;

  if (!target) {
    console.error('Error: Please provide a file path, directory path, or online URL.');
    console.log('Usage: npx verisieve run <path-or-url> [--out-dir <folder>] [--csv <out.csv>] [--json <out.json>] [--mode <mode>] [--pii-strategy <strategy>] [--alpha <0.05>]');
    process.exit(1);
  }

  const options = {
    mode: flags['mode'] || 'auto',
    piiStrategy: flags['pii-strategy'] || flags['strategy'] || 'token',
    alpha: flags['alpha'] ? parseFloat(flags['alpha']) : 0.05,
    maxSeqLen: flags['max-seq-len'] ? parseInt(flags['max-seq-len'], 10) : 256,
    outDir: flags['out-dir'] || flags['outDir'],
    csv: flags['csv'],
    json: flags['json'],
    svg: flags['svg'],
    bundle: flags['bundle'],
    weightsPath: flags['weights'] || flags['weights-path'],
  };

  try {
    console.log(`Processing: ${target}...`);
    const result = await ingestFromUrlOrPath(target, options);
    const { stats, fetchStatus, gatekeeperBundle } = result;

    const total = stats.total_lines || 1;
    const keepPct = Math.round(((stats.keep_safe_lines || 0) / total) * 100);
    const dropPct = Math.round(((stats.drop_or_quarantine_lines || 0) / total) * 100);
    const abstainPct = Math.round(((stats.abstain_lines || 0) / total) * 100);
    const piiPct = Math.round(((stats.pii_detected_lines || 0) / total) * 100);
    const conformalStatus =
      stats.gatekeeper_status ||
      (gatekeeperBundle?.calibration?.certified ? 'CERTIFIED' : 'FAIL_CLOSED_UNVERIFIED');
    const statusDetail =
      conformalStatus === 'CERTIFIED'
        ? 'CERTIFIED (Empirical FPR <= alpha under Exchangeability)'
        : 'FAIL_CLOSED_UNVERIFIED (Insufficient null calibration samples or non-certified threshold)';

    console.log('\n========================================================================');
    console.log('             VERISIEVE — UNIVERSAL DATA GATEKEEPER AUDIT                ');
    console.log('========================================================================');
    console.log(` Target Source:        ${target} (${fetchStatus})`);
    console.log(` Ingestion Mode:       ${options.mode}`);
    console.log(` PII Strategy:         ${options.piiStrategy}`);
    console.log(` Conformal Risk (α):   ${options.alpha} (${Math.round((1 - options.alpha) * 100)}% Statistical Bound)`);
    console.log('------------------------------------------------------------------------');
    console.log(` Total Lines Ingested: ${stats.total_lines.toString().padEnd(6)}`);
    console.log(` PII Lines Detected:   ${stats.pii_detected_lines.toString().padEnd(6)} (${piiPct}% of lines quarantined/masked)`);
    console.log(` KEEP_SAFE:            ${stats.keep_safe_lines.toString().padEnd(6)} (${keepPct}% safe for LLM training/RAG)`);
    console.log(` DROP_OR_QUARANTINE:   ${stats.drop_or_quarantine_lines.toString().padEnd(6)} (${dropPct}% personal PII / boilerplate)`);
    console.log(` ABSTAIN_HUMAN_REVIEW: ${stats.abstain_lines.toString().padEnd(6)} (${abstainPct}% requires human verification)`);
    console.log(` Gatekeeper Threshold: tau_keep = ${gatekeeperBundle.calibration.tauKeep.toFixed(2)}, tau_drop = ${gatekeeperBundle.calibration.tauDrop.toFixed(2)}`);
    console.log(` Conformal Status:     ${statusDetail}`);
    console.log('------------------------------------------------------------------------');

    if (options.outDir) {
      console.log(` Output Written to Folder: ${options.outDir}`);
      console.log(`   - ${path.join(options.outDir, 'results.csv')}`);
      console.log(`   - ${path.join(options.outDir, 'results.json')}`);
      console.log(`   - ${path.join(options.outDir, 'train-qwen-llama-sft.jsonl')}`);
      console.log(`   - ${path.join(options.outDir, 'train-tokens.bin')}`);
      console.log(`   - ${path.join(options.outDir, 'gatekeeper-bundle.json')}`);
      console.log(`   - ${path.join(options.outDir, 'summary-report.svg')}`);
    } else {
      if (options.csv) console.log(` CSV Output:           ${options.csv}`);
      if (options.json) console.log(` JSON Output:          ${options.json}`);
      if (options.svg) console.log(` SVG Report:           ${options.svg}`);
      if (options.bundle) console.log(` Gatekeeper Bundle:    ${options.bundle}`);
      if (!options.csv && !options.json && !options.svg && !options.bundle) {
        console.log(' Tip: Pass --out-dir ./results or --csv out.csv to export artifacts.');
      }
    }
    console.log('========================================================================\n');
  } catch (err) {
    console.error('Error executing pipeline:', err.message);
    process.exit(1);
  }
} else if (command === 'ingest') {
  const target = flags.input || positional[1];
  if (!target) {
    console.error('Error: Please provide a file path or URL to ingest.');
    process.exit(1);
  }
  try {
    const loaded = await readBinaryOrTextForCli(target, {
      weightsPath: flags.weights || flags['weights-path'],
    });
    const result = runCleanAndTokenizePipeline(loaded.text, { format: loaded.format || 'text' });
    const payload = {
      sourceType: loaded.sourceType,
      cleanText: loaded.cleanText,
      title: loaded.title,
      url: loaded.url,
      links: loaded.links,
      ...result,
    };
    const serialized = JSON.stringify(payload, null, 2);
    if (flags.out) {
      fs.writeFileSync(path.resolve(flags.out), serialized);
    }
    console.log(serialized);
  } catch (err) {
    console.error('Error ingesting target:', err.message);
    process.exit(1);
  }
} else if (command === 'train') {
  const inputPath = flags.input || positional[1];
  const outPath = flags.out || flags.bundle || positional[2];
  if (!inputPath) {
    console.error('Error: Usage: verisieve train --input <dataset.jsonl|json|csv> [--out <bundle.json>] [--alpha 0.05] [--epochs 30]');
    process.exit(1);
  }
  try {
    const rows = parseDatasetFile(inputPath);
    if (rows.length < 4) {
      throw new Error(`Dataset too small for disjoint train/calibration split (${rows.length} rows; need >= 4)`);
    }
    const alpha = flags.alpha ? parseFloat(flags.alpha) : 0.05;
    const epochs = flags.epochs ? parseInt(flags.epochs, 10) : 30;
    const lr = flags.lr ? parseFloat(flags.lr) : 0.05;
    const calRatio = flags['cal-ratio'] ? parseFloat(flags['cal-ratio']) : 0.5;

    const featureRows = rows.map((row) => {
      if (Array.isArray(row.featureRow) || ArrayBuffer.isView(row.featureRow)) {
        return new Float32Array(row.featureRow);
      }
      const text = String(row.text ?? '');
      const pii = scanRecordsForPII(text);
      return extractFeatureRow({ text, piiItems: pii });
    });
    const labels = rows.map((row) => {
      const rawLabel = row.label !== undefined ? row.label : row.safe;
      return rawLabel === true || Number(rawLabel) === 1 ? 1 : 0;
    });

    const { trainRows, trainLabels, calRows, calLabels } = stratifiedDisjointSplit(featureRows, labels, calRatio);
    if (calRows.length === 0) {
      throw new Error('Unable to construct non-empty holdout calibration split from dataset');
    }

    const bundle = trainGatekeeper(trainRows, trainLabels, { epochs, lr });
    calibrateGatekeeper(bundle, calRows, calLabels, { alpha });
    const certified = Boolean(bundle.calibration?.certified);
    const gatekeeperStatus = certified ? 'CERTIFIED' : 'FAIL_CLOSED_UNVERIFIED';

    const serializableBundle = {
      ...bundle,
      weights: Array.from(bundle.weights || []),
      certified,
      gatekeeperStatus,
    };
    let resolvedOutPath = null;
    if (typeof outPath === 'string' && outPath.length > 0) {
      resolvedOutPath = path.resolve(outPath);
      fs.writeFileSync(resolvedOutPath, JSON.stringify(serializableBundle, null, 2));
    }
    console.log(JSON.stringify({
      gatekeeperStatus,
      certified,
      tauKeep: bundle.calibration.tauKeep,
      tauDrop: bundle.calibration.tauDrop,
      alpha,
      trainCount: trainRows.length,
      calCount: calRows.length,
      calibrationNegatives: calLabels.filter((l) => l === 0).length,
      receipt: bundle.receipt,
      outPath: resolvedOutPath,
    }, null, 2));
  } catch (err) {
    console.error('Error training gatekeeper:', err.message);
    process.exit(1);
  }
} else if (command === 'decide') {
  const bundlePath = flags.bundle || positional[1];
  if (!bundlePath || !fs.existsSync(path.resolve(bundlePath))) {
    console.error('Error: Usage: verisieve decide --bundle <bundle.json> (--text <string> | --input <file>)');
    process.exit(1);
  }
  try {
    const bundleRaw = JSON.parse(fs.readFileSync(path.resolve(bundlePath), 'utf8'));
    if (Array.isArray(bundleRaw.weights)) {
      bundleRaw.weights = new Float32Array(bundleRaw.weights);
    }
    let text;
    if (typeof flags.text === 'string') {
      text = flags.text;
    } else if (flags.input) {
      const loaded = await readBinaryOrTextForCli(flags.input, {
        weightsPath: flags.weights || flags['weights-path'],
      });
      text = loaded.cleanText;
    } else {
      throw new Error('Provide --text "<string>" or --input <file> to evaluate');
    }

    const pii = scanRecordsForPII(text);
    const fRow = extractFeatureRow({ text, piiItems: pii });
    const dec = decideGatekeeper(bundleRaw, fRow);
    const certified = Boolean(bundleRaw.calibration?.certified);
    console.log(JSON.stringify({
      action: dec.action,
      probSafe: dec.probSafe,
      tauKeep: dec.tauKeep,
      tauDrop: dec.tauDrop,
      margin: dec.margin,
      certified,
      gatekeeperStatus: certified ? 'CERTIFIED' : 'FAIL_CLOSED_UNVERIFIED',
      piiDetected: pii.length > 0,
      piiCount: pii.length,
      piiCategories: Array.from(new Set(pii.map((p) => p.category))),
    }, null, 2));
  } catch (err) {
    console.error('Error running gatekeeper decision:', err.message);
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${command}`);
  console.log('Available subcommands: run, ingest, train, decide, selftest, audit-wasm');
  process.exit(1);
}
