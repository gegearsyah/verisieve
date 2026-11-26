#!/usr/bin/env node
/**
 * bin/versieve.mjs
 * Universal CLI for Versieve:
 * - Zero-Egress Unstructured Document Sieve, Dual PII Redactor & Conformal Client-Side Token Gatekeeper
 * - BYOD file/folder/URL processing (PDF, PNG, BMP, HTML, EML, CSV, JSON, TXT)
 * - Conformal gatekeeper training, calibration & routing inference
 * - Local OCR dependencies are installed with the package; OCR assets load from disk at runtime.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
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
import { auditVersieveDlWasm } from '../src/wasm-needle-dl.js';
import { auditVersieveSqlWasm } from '../src/sql-wasm.js';
import { loadCleanWasm } from '../src/clean-wasm.js';
import { extractPdfDetailed, verifyPdfRedactionIrreversibility } from '../src/pdf-parser.js';
import { extractDocxText, stripHtmlBoilerplate, ingestUrl } from '../src/ingestor.js';
import { ingestFromUrlOrPath, sanitizePdfBuffer } from '../src/pdf-image-pipeline.js';
import { createLocalTesseractOcrProvider } from '../src/local-tesseract-ocr.js';
import { isHtmlDocumentBuffer, isPdfDocumentBuffer } from '../src/document-format.js';
import { extractDocxForensic, parseEnterpriseBuffer } from '../src/enterprise-parsers.js';
import { encodePNG } from '../src/multi-font-fixture.js';
import { perceive } from '../src/perceive.js';
import {
  POLICY_VERDICT_MAP,
  POLICY_VERDICT_SEMANTICS,
  mapPolicyVerdict,
  stripHiddenChannelsFromText,
  shadowAuditText,
  checkNumericIntegrity,
  exportTrainingDataset,
  writeTrainingDataset,
} from '../src/exporters.js';

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
      error: `Non-zero imports detected (${imports.length}) in versieve_clean.wasm`,
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
      error: `Non-zero imports detected (${imports.length}) in versieve_dl.wasm`,
    };
  }
  const report = await auditVersieveDlWasm(fullPath);
  return {
    ...report,
    wasmPath: fullPath,
    zeroEgressVerified: Boolean(report.ok && report.airGapped && imports.length === 0),
  };
}

function isUrlTarget(target) {
  return typeof target === 'string' && (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(target) || target.startsWith('arxiv:'));
}

async function withCliOcrProvider(options, callback) {
  if (typeof options.ocrProvider === 'function' || resolveCactusWeightsBytes(options)) {
    return await callback(options);
  }
  const ocrProvider = createLocalTesseractOcrProvider();
  try {
    return await callback({ ...options, ocrProvider });
  } finally {
    await ocrProvider.close();
  }
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
    if (isHtmlDocumentBuffer(buf)) {
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
    if (!isPdfDocumentBuffer(buf)) {
      throw new Error(`INVALID_PDF_HEADER: ${path.basename(fullPath)} is neither a PDF nor HTML`);
    }
    const pdfRes = await extractPdfDetailed(buf);
    const lines = pdfRes.lines || [];
    if (lines.length === 0) {
      if ((pdfRes.images || []).length > 0) {
        if (typeof options.ocrProvider !== 'function' && !resolveCactusWeightsBytes(options)) {
          throw new Error(
            `PDF_IMAGE_ONLY_REQUIRES_OCR: ${path.basename(fullPath)} has 0 selectable text lines and ${pdfRes.images.length} embedded images; install the local Tesseract OCR dependencies or supply ${DEFAULT_MIRAGE_WEIGHTS_PATH}`
          );
        }
        const ocrTexts = [];
        for (const img of pdfRes.images) {
          const decoded = decodePdfImageXObject(img);
          const ocr = await runTiledOcrAsync(decoded, { ...options, filename: path.basename(fullPath), sourceFormat: 'pdf' });
          ocrTexts.push(...(ocr.lines || []).map((l) => l.text));
        }
        const joined = ocrTexts.join('\n');
        if (!joined.trim()) {
          throw new Error(`PDF_OCR_NO_TEXT: Local OCR found no readable text in ${path.basename(fullPath)}`);
        }
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
    if (typeof options.ocrProvider !== 'function' && !resolveCactusWeightsBytes(options)) {
      throw new Error(
        `IMAGE_REQUIRES_OCR_PROVIDER: Cannot extract real text from ${path.basename(fullPath)} without local Tesseract OCR dependencies or ${DEFAULT_MIRAGE_WEIGHTS_PATH}`
      );
    }
    const ocrRes = await runTiledOcrAsync(decoded, { ...options, filename: path.basename(fullPath), sourceFormat: 'image' });
    const joined = (ocrRes.lines || []).map((l) => l.text).join('\n');
    if (!joined.trim()) {
      throw new Error(`IMAGE_OCR_NO_TEXT: Local OCR found no readable text in ${path.basename(fullPath)}`);
    }
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

// ---------------------------------------------------------------------------
// Per-Kernel Zero-Import WASM Footprint & Policy Mapping Helpers
// ---------------------------------------------------------------------------

const WASM_KERNEL_SPECS = Object.freeze([
  {
    kernel: 'versieve_clean',
    file: 'versieve_clean.wasm',
    role: 'Tokenizer, structural normalizer & MinHash deduplicator',
  },
  {
    kernel: 'versieve_sql',
    file: 'versieve_sql.wasm',
    role: 'Embedded SQL & tabular column/schema engine',
  },
  {
    kernel: 'versieve_graph',
    file: 'versieve_graph.wasm',
    role: 'Dual-CSR entity/document graph, PPR & blast-radius engine',
  },
  {
    kernel: 'versieve_dl',
    file: 'versieve_dl.wasm',
    role: 'SIMD needle & dense linear-algebra kernel',
  },
  {
    kernel: 'versieve_media',
    file: 'versieve_media.wasm',
    role: 'Archive/MSG unpacker, Stage 3A PII+secrets, WAV & pixel redactor',
  },
]);

async function buildWasmFootprintReport() {
  const kernels = [];
  let totalBytes = 0;
  let totalImports = 0;
  for (const spec of WASM_KERNEL_SPECS) {
    const wasmPath = path.join(PKG_ROOT, 'vendor/wasm', spec.file);
    if (!fs.existsSync(wasmPath)) {
      throw new Error(`WASM_KERNEL_MISSING: ${wasmPath}`);
    }
    const bytes = fs.readFileSync(wasmPath);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
    const mod = await WebAssembly.compile(bytes);
    const imports = WebAssembly.Module.imports(mod);
    const exportsList = WebAssembly.Module.exports(mod);
    totalBytes += bytes.length;
    totalImports += imports.length;
    kernels.push({
      kernel: spec.kernel,
      name: spec.kernel,
      file: spec.file,
      wasmPath,
      role: spec.role,
      byteLength: bytes.length,
      sizeKB: Number((bytes.length / 1024).toFixed(2)),
      importCount: imports.length,
      exportCount: exportsList.length,
      zeroImports: imports.length === 0,
      zeroEgressVerified: imports.length === 0,
      sha256,
    });
  }
  const allZeroImports = kernels.every((k) => k.importCount === 0);
  return {
    kernels,
    kernelCount: kernels.length,
    totalBytes,
    totalKB: Number((totalBytes / 1024).toFixed(2)),
    importCount: totalImports,
    allZeroImports,
    zeroEgress: allZeroImports,
    policyMapping: { ...POLICY_VERDICT_MAP },
    policySemantics: POLICY_VERDICT_SEMANTICS.map((row) => ({ ...row })),
  };
}

function formatFootprintText(fp) {
  const lines = [
    'Per-Kernel Zero-Import WASM Footprint (vendor/wasm/*.wasm):',
    '  Kernel               File                    Size (B)    Imports   Role',
    '  -------------------  ----------------------  ----------  --------  ------------------------------------------------',
  ];
  for (const k of fp.kernels) {
    lines.push(
      `  ${k.kernel.padEnd(19)}  ${k.file.padEnd(22)}  ${String(k.byteLength).padStart(10)}  ${String(k.importCount).padStart(8)}  ${k.role}`
    );
  }
  lines.push('  -------------------  ----------------------  ----------  --------  ------------------------------------------------');
  lines.push(
    `  TOTAL (${fp.kernelCount} kernels)    ${''.padEnd(22)}  ${String(fp.totalBytes).padStart(10)}  ${String(fp.importCount).padStart(8)}  zeroEgress=${fp.zeroEgress}`
  );
  lines.push('');
  lines.push('Conformal Gate Verdict -> Policy Semantics Mapping:');
  for (const row of fp.policySemantics) {
    lines.push(`  ${row.verdict.padEnd(8)} -> ${row.policy.padEnd(7)} : ${row.meaning}`);
  }
  return lines.join('\n');
}

function crc32Buffer(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildCleanDocxBuffer(paragraphs) {
  const bodyXml = paragraphs
    .filter((p) => String(p).trim().length > 0)
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`)
    .join('');
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`;
  const rawBytes = Buffer.from(docXml, 'utf8');
  const compBytes = zlib.deflateRawSync(rawBytes);
  const crc = crc32Buffer(rawBytes);
  const nameBuf = Buffer.from('word/document.xml', 'utf8');

  const lfh = Buffer.alloc(30 + nameBuf.length);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(0, 6);
  lfh.writeUInt16LE(8, 8);
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(compBytes.length, 18);
  lfh.writeUInt32LE(rawBytes.length, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(lfh, 30);

  const cdOffset = lfh.length + compBytes.length;
  const cd = Buffer.alloc(46 + nameBuf.length);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(compBytes.length, 20);
  cd.writeUInt32LE(rawBytes.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(0, 42);
  nameBuf.copy(cd, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([lfh, compBytes, cd, eocd]);
}

function stripHtmlHiddenDom(rawHtml) {
  let html = String(rawHtml ?? '');
  let htmlComments = 0;
  let hiddenDomElements = 0;

  html = html.replace(/<!--[\s\S]*?-->/g, () => {
    htmlComments += 1;
    return '';
  });
  for (const tag of ['script', 'style', 'template']) {
    const rx = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    html = html.replace(rx, () => {
      hiddenDomElements += 1;
      return '';
    });
  }
  const hiddenAttrRx = /<([a-zA-Z0-9:-]+)\b[^>]*\bhidden\b[^>]*>[\s\S]*?<\/\1>/gi;
  html = html.replace(hiddenAttrRx, () => {
    hiddenDomElements += 1;
    return '';
  });
  const hiddenStyleRx =
    /<([a-zA-Z0-9:-]+)\b[^>]*\bstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?(?![0-9])|font-size\s*:\s*0(?:px|pt|em|rem|%)?(?![0-9]))[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi;
  html = html.replace(hiddenStyleRx, () => {
    hiddenDomElements += 1;
    return '';
  });

  return { html, htmlComments, hiddenDomElements };
}

function defaultSanitizedOutputPath(fullPath) {
  const parsed = path.parse(fullPath);
  const ext = parsed.ext || '.txt';
  return path.join(parsed.dir, `${parsed.name}.sanitized${ext}`);
}

function sha256HexBuf(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizeEntityClass(type) {
  const u = String(type || 'CUSTOM').toUpperCase();
  return u === 'NAME_LIKELY' ? 'PERSON' : u;
}

function summarizeForensicFindingsSafe(findings) {
  return (findings || []).map((f) => ({
    ...(f.code ? { code: String(f.code) } : {}),
    ...(f.vector ? { vector: String(f.vector) } : {}),
    ...(f.channel ? { channel: String(f.channel) } : {}),
    ...(Number.isInteger(f.pageIndex) ? { pageIndex: f.pageIndex } : {}),
    ...(Number.isInteger(f.strippedCount) ? { strippedCount: f.strippedCount } : {}),
    ...(Number.isInteger(f.count) ? { count: f.count } : {}),
  }));
}

function escapeRegexLiteral(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyRedactedReplacements(inputText, redactedValues) {
  let out = String(inputText ?? '');
  const ordered = [...(redactedValues || [])]
    .filter((rv) => typeof rv?.value === 'string' && rv.value.length > 0 && typeof rv?.token === 'string')
    .sort((a, b) => b.value.length - a.value.length);
  for (const rv of ordered) {
    out = out.replace(new RegExp(escapeRegexLiteral(rv.value), 'g'), rv.token);
  }
  return out;
}

function sanitizeJsonValue(node, redactedValues) {
  if (typeof node === 'string') {
    const stripped = stripHiddenChannelsFromText(node).text;
    return applyRedactedReplacements(stripped, redactedValues);
  }
  if (Array.isArray(node)) {
    return node.map((item) => sanitizeJsonValue(item, redactedValues));
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const cleanKey = applyRedactedReplacements(stripHiddenChannelsFromText(k).text, redactedValues);
      out[cleanKey] = sanitizeJsonValue(v, redactedValues);
    }
    return out;
  }
  return node;
}

async function sanitizeLocalFile(inputTarget, cliFlags = {}) {
  if (isUrlTarget(inputTarget)) {
    throw new Error('ZERO_EGRESS_LOCAL_ONLY: versieve sanitize operates strictly on local files with zero network egress');
  }
  const fullPath = path.resolve(inputTarget);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error(`Input file not found: ${inputTarget}`);
  }

  const outputPath =
    typeof cliFlags.out === 'string' && cliFlags.out.length > 0
      ? path.resolve(cliFlags.out)
      : defaultSanitizedOutputPath(fullPath);

  const rawBuf = fs.readFileSync(fullPath);
  const beforeSha256 = sha256HexBuf(rawBuf);
  const ext = path.extname(fullPath).toLowerCase();
  const baseName = path.basename(fullPath);
  const workspaceSalt = cliFlags['workspace-salt'] || 'versieve-sanitize-v1';

  let detectedFormat = (ext.replace(/^\./, '') || 'txt').toLowerCase();
  let perceived = null;
  let outputBuffer = null;
  let beforeComparableText = '';
  let afterComparableText = '';
  let unicodeCounts = {
    zeroWidth: 0,
    bidiControls: 0,
    invisibleOperators: 0,
    tagCharacters: 0,
    controlCharacters: 0,
    invisibleUnicode: 0,
    htmlComments: 0,
    total: 0,
  };
  let hiddenDomElements = 0;
  let metadataStripped = 0;
  let pdfRevisionsFlattened = 0;
  let pdfVerification = null;
  const collectedForensics = [];

  if (isPdfDocumentBuffer(rawBuf)) {
    detectedFormat = 'pdf';
    const sourceDiag = extractPdfDetailed(rawBuf);
    const visibleDiag = extractPdfDetailed(rawBuf, { excludeInvisibleRuns: true, _skipRevisionInspection: true });
    collectedForensics.push(...(sourceDiag.forensicFindings || []));
    if ((sourceDiag.revisionCount ?? 1) > 1) {
      pdfRevisionsFlattened = (sourceDiag.revisionCount ?? 1) - 1;
    }

    const visibleRawJoined = (visibleDiag.lines || []).join('\n');
    const visStripped = stripHiddenChannelsFromText(visibleRawJoined);
    unicodeCounts = visStripped.counts;
    beforeComparableText = visStripped.text;

    perceived = await perceive(fullPath, { workspaceSalt });
    collectedForensics.push(...(perceived.forensicFindings || []));

    const extraSpans = (perceived.redactedValues || []).map((rv) => ({
      value: rv.value,
      type: rv.type || 'custom',
      replacement: rv.token || '[REDACTED]',
    }));

    const pdfSanitized = sanitizePdfBuffer(rawBuf, {
      redactedSpans: extraSpans,
      throwOnLeak: true,
    });

    // Also assert none of the source PDF hidden-channel snippets survive in the emitted flattened PDF
    const hiddenChannelNeedles = [];
    for (const f of sourceDiag.forensicFindings || []) {
      if (typeof f.textSnippet === 'string' && f.textSnippet.trim().length >= 3) {
        hiddenChannelNeedles.push({ value: f.textSnippet.trim(), type: f.code || 'forensic_hidden' });
      }
      for (const rs of f.residualStrings || []) {
        if (typeof rs === 'string' && rs.trim().length >= 3) {
          hiddenChannelNeedles.push({ value: rs.trim(), type: f.code || 'forensic_revision' });
        }
      }
    }
    if (hiddenChannelNeedles.length > 0) {
      verifyPdfRedactionIrreversibility(pdfSanitized.redactedPdfBuffer, hiddenChannelNeedles, { throwOnLeak: true });
    }

    pdfVerification = pdfSanitized.verification;
    outputBuffer = pdfSanitized.redactedPdfBuffer;
    const afterDiag = extractPdfDetailed(outputBuffer);
    afterComparableText = (afterDiag.lines || []).join('\n');
  } else if (ext === '.docx') {
    detectedFormat = 'docx';
    const docxForensic = extractDocxForensic(baseName, rawBuf);
    collectedForensics.push(...(docxForensic.forensicFindings || []));
    const docxExtracted = extractDocxText(rawBuf);
    const rawJoined = (docxExtracted.lines || []).join('\n');
    const stripped = stripHiddenChannelsFromText(rawJoined);
    unicodeCounts = stripped.counts;
    beforeComparableText = stripped.text;

    perceived = await perceive({ name: `${path.parse(baseName).name}.txt`, text: stripped.text }, { workspaceSalt });
    const cleanParagraphs = (perceived.blocks || [])
      .filter((b) => b.policyAction !== 'deny')
      .map((b) => stripHiddenChannelsFromText(b.maskedText).text)
      .filter((t) => t.trim().length > 0);
    afterComparableText = cleanParagraphs.join('\n\n');

    if (path.extname(outputPath).toLowerCase() === '.docx') {
      outputBuffer = buildCleanDocxBuffer(cleanParagraphs);
    } else {
      outputBuffer = Buffer.from(afterComparableText + (afterComparableText ? '\n' : ''), 'utf8');
    }
  } else if (ext === '.png' || ext === '.bmp') {
    detectedFormat = ext.slice(1);
    const decoded = decodeImageBuffer(rawBuf, baseName);
    const imgResult = await withCliOcrProvider(
      { weightsPath: cliFlags.weights || cliFlags['weights-path'] },
      async (ocrOpts) => {
        const ocr = await runTiledOcrAsync(decoded, { ...ocrOpts, filename: baseName, sourceFormat: 'image' });
        const ocrText = (ocr.lines || []).map((l) => l.text).join('\n');
        const stripped = stripHiddenChannelsFromText(ocrText);
        const perc = await perceive(
          ocrText.trim()
            ? { name: `${path.parse(baseName).name}.txt`, text: stripped.text }
            : fullPath,
          { workspaceSalt }
        );
        return { ocr, stripped, perc };
      }
    );
    unicodeCounts = imgResult.stripped.counts;
    beforeComparableText = imgResult.stripped.text;
    perceived = imgResult.perc;
    collectedForensics.push(...(perceived.forensicFindings || []));

    const cleanLines = (perceived.blocks || [])
      .filter((b) => b.policyAction !== 'deny')
      .map((b) => stripHiddenChannelsFromText(b.maskedText).text);
    afterComparableText = cleanLines.join('\n\n');

    const redactedNeedles = (perceived.redactedValues || []).map((rv) => String(rv.value || '').toLowerCase()).filter(Boolean);
    const rgb = new Uint8Array(decoded.rgb);
    for (const line of imgResult.ocr.lines || []) {
      const lowerLine = String(line.text || '').toLowerCase();
      if (redactedNeedles.some((n) => lowerLine.includes(n)) && line.bbox) {
        const x0 = Math.max(0, Math.floor(line.bbox.x0 ?? line.bbox.x ?? 0));
        const y0 = Math.max(0, Math.floor(line.bbox.y0 ?? line.bbox.y ?? 0));
        const x1 = Math.min(decoded.width, Math.ceil(line.bbox.x1 ?? (x0 + (line.bbox.width ?? 0))));
        const y1 = Math.min(decoded.height, Math.ceil(line.bbox.y1 ?? (y0 + (line.bbox.height ?? 0))));
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const off = (y * decoded.width + x) * 3;
            rgb[off] = 0;
            rgb[off + 1] = 0;
            rgb[off + 2] = 0;
          }
        }
      }
    }
    const outExt = path.extname(outputPath).toLowerCase();
    if (outExt === '.txt' || outExt === '.md') {
      outputBuffer = Buffer.from(afterComparableText + (afterComparableText ? '\n' : ''), 'utf8');
    } else {
      outputBuffer = encodePNG(decoded.width, decoded.height, rgb);
    }
  } else if (ext === '.html' || ext === '.htm' || isHtmlDocumentBuffer(rawBuf)) {
    detectedFormat = 'html';
    const rawHtml = rawBuf.toString('utf8');
    const domScrub = stripHtmlHiddenDom(rawHtml);
    hiddenDomElements = domScrub.hiddenDomElements;
    const boiler = stripHtmlBoilerplate(domScrub.html);
    const uni = stripHiddenChannelsFromText(boiler.cleanText, { stripHtmlComments: true });
    unicodeCounts = {
      ...uni.counts,
      htmlComments: uni.counts.htmlComments + domScrub.htmlComments,
      total: uni.counts.total + domScrub.htmlComments,
    };
    beforeComparableText = uni.text;

    perceived = await perceive({ name: `${path.parse(baseName).name}.txt`, text: uni.text }, { workspaceSalt });
    const cleanBody = (perceived.blocks || [])
      .filter((b) => b.policyAction !== 'deny')
      .map((b) => stripHiddenChannelsFromText(b.maskedText).text)
      .join('\n\n');
    afterComparableText = cleanBody;

    const outExt = path.extname(outputPath).toLowerCase();
    if (outExt === '.html' || outExt === '.htm') {
      const paras = cleanBody
        .split(/\n{2,}/)
        .filter((p) => p.trim().length > 0)
        .map((p) => `  <p>${escapeXml(p)}</p>`)
        .join('\n');
      outputBuffer = Buffer.from(`<!doctype html>\n<html>\n<body>\n${paras}\n</body>\n</html>\n`, 'utf8');
    } else {
      outputBuffer = Buffer.from(cleanBody + (cleanBody ? '\n' : ''), 'utf8');
    }
  } else if (ext === '.eml') {
    detectedFormat = 'eml';
    const rawEml = rawBuf.toString('utf8');
    const headerSplitIdx = rawEml.search(/\r?\n\r?\n/);
    const rawHeaderPart = headerSplitIdx >= 0 ? rawEml.slice(0, headerSplitIdx) : '';
    const strippedHeaderMatches =
      rawHeaderPart.match(/^(?:bcc|x-originating-ip|x-mailer|user-agent|received|return-path|message-id):/gim) || [];
    metadataStripped = strippedHeaderMatches.length;

    const domScrub = stripHtmlHiddenDom(rawEml);
    hiddenDomElements = domScrub.hiddenDomElements;
    const rawUni = stripHiddenChannelsFromText(domScrub.html, { stripHtmlComments: true });
    unicodeCounts = {
      ...rawUni.counts,
      htmlComments: rawUni.counts.htmlComments + domScrub.htmlComments,
      total: rawUni.counts.total + domScrub.htmlComments,
    };

    const parsedContainer = parseEnterpriseBuffer(baseName, rawBuf, { workspaceSalt });
    collectedForensics.push(...(parsedContainer.forensicFindings || []));

    perceived = await perceive(fullPath, { workspaceSalt });
    collectedForensics.push(...(perceived.forensicFindings || []));

    // Scrub hidden comments/DOM/Unicode from perceived blocks so downstream exports & output file are 100% clean
    const cleanedBlocks = [];
    const beforeParts = [];
    for (const blk of perceived.blocks || []) {
      if (blk.policyAction === 'deny') continue;
      const origClean = stripHiddenChannelsFromText(stripHtmlHiddenDom(blk.originalText || '').html).text.trim();
      if (origClean) beforeParts.push(origClean);
      const maskedClean = stripHiddenChannelsFromText(stripHtmlHiddenDom(blk.maskedText || '').html).text.trim();
      cleanedBlocks.push({ ...blk, maskedText: maskedClean });
    }
    perceived = { ...perceived, blocks: cleanedBlocks };
    beforeComparableText = beforeParts.join('\n\n');
    afterComparableText = cleanedBlocks.map((b) => b.maskedText).filter(Boolean).join('\n\n');
    outputBuffer = Buffer.from(afterComparableText + (afterComparableText ? '\n' : ''), 'utf8');
  } else if (ext === '.json') {
    detectedFormat = 'json';
    const rawText = rawBuf.toString('utf8');
    const stripped = stripHiddenChannelsFromText(rawText, { stripHtmlComments: false });
    unicodeCounts = stripped.counts;
    beforeComparableText = stripped.text;

    perceived = await perceive({ name: baseName, text: stripped.text }, { workspaceSalt });
    collectedForensics.push(...(perceived.forensicFindings || []));

    let parsedJson;
    let isValidJson = false;
    try {
      parsedJson = JSON.parse(stripped.text);
      isValidJson = true;
    } catch {
      isValidJson = false;
    }
    if (isValidJson) {
      const sanitizedObj = sanitizeJsonValue(parsedJson, perceived.redactedValues || []);
      afterComparableText = JSON.stringify(sanitizedObj, null, 2);
      outputBuffer = Buffer.from(afterComparableText + '\n', 'utf8');
    } else {
      afterComparableText = (perceived.blocks || [])
        .filter((b) => b.policyAction !== 'deny')
        .map((b) => stripHiddenChannelsFromText(b.maskedText).text)
        .join('\n\n');
      outputBuffer = Buffer.from(afterComparableText + (afterComparableText ? '\n' : ''), 'utf8');
    }
  } else {
    const rawText = rawBuf.toString('utf8');
    const domScrub = stripHtmlHiddenDom(rawText);
    hiddenDomElements = domScrub.hiddenDomElements;
    const stripped = stripHiddenChannelsFromText(domScrub.html, { stripHtmlComments: true });
    unicodeCounts = {
      ...stripped.counts,
      htmlComments: stripped.counts.htmlComments + domScrub.htmlComments,
      total: stripped.counts.total + domScrub.htmlComments,
    };
    beforeComparableText = stripped.text;

    perceived = await perceive({ name: baseName, text: stripped.text }, { workspaceSalt });
    collectedForensics.push(...(perceived.forensicFindings || []));

    const cleanBlocks = (perceived.blocks || [])
      .filter((b) => b.policyAction !== 'deny')
      .map((b) => ({ ...b, maskedText: stripHiddenChannelsFromText(b.maskedText).text }));
    perceived = { ...perceived, blocks: cleanBlocks };
    afterComparableText = cleanBlocks.map((b) => b.maskedText).join('\n\n');
    outputBuffer = Buffer.from(afterComparableText + (afterComparableText ? '\n' : ''), 'utf8');
  }

  // Deduplicate forensic findings safely (never echoing raw snippets)
  const seenForensicKeys = new Set();
  const dedupedForensics = [];
  for (const f of collectedForensics) {
    const key = `${f.code || ''}|${f.vector || ''}|${f.channel || ''}|${f.pageIndex ?? ''}|${f.textSnippet || ''}`;
    if (seenForensicKeys.has(key)) continue;
    seenForensicKeys.add(key);
    dedupedForensics.push(f);
  }
  const safeForensics = summarizeForensicFindingsSafe(dedupedForensics);
  const forensicCodes = Array.from(new Set(safeForensics.map((f) => f.code || f.vector).filter(Boolean)));

  const hiddenChannelsTotal =
    dedupedForensics.length +
    unicodeCounts.invisibleUnicode +
    unicodeCounts.htmlComments +
    hiddenDomElements +
    metadataStripped +
    pdfRevisionsFlattened;

  const hiddenChannelsStripped = {
    total: hiddenChannelsTotal,
    forensicFindingsCount: dedupedForensics.length,
    forensicCodes,
    forensicFindings: safeForensics,
    unicode: {
      zeroWidth: unicodeCounts.zeroWidth,
      bidiControls: unicodeCounts.bidiControls,
      invisibleOperators: unicodeCounts.invisibleOperators,
      tagCharacters: unicodeCounts.tagCharacters,
      controlCharacters: unicodeCounts.controlCharacters,
      total: unicodeCounts.invisibleUnicode,
    },
    htmlComments: unicodeCounts.htmlComments,
    hiddenDomElements,
    metadataStripped,
    pdfRevisionsFlattened,
  };

  // Aggregate per-class masked entity counts & unique entity IDs
  const byClass = {};
  const uniqueEntityIds = new Set();
  let totalEntitiesMasked = 0;
  for (const blk of perceived?.blocks || []) {
    for (const ent of blk.entities || []) {
      const cls = normalizeEntityClass(ent.type);
      byClass[cls] = (byClass[cls] || 0) + 1;
      totalEntitiesMasked += 1;
      if (ent.entityId) uniqueEntityIds.add(String(ent.entityId));
    }
  }
  if (totalEntitiesMasked === 0 && (perceived?.redactedValues || []).length > 0) {
    for (const rv of perceived.redactedValues) {
      const cls = normalizeEntityClass(rv.type);
      byClass[cls] = (byClass[cls] || 0) + 1;
      totalEntitiesMasked += 1;
    }
  }
  const entityCountsMasked = {
    total: totalEntitiesMasked,
    uniqueEntities: uniqueEntityIds.size || (perceived?.redactedValues || []).length,
    byClass,
  };

  const knownRawValues = (perceived?.redactedValues || []).map((rv) => rv.value).filter(Boolean);
  const shadowTextAudit = shadowAuditText(afterComparableText, { knownRawValues });
  const pdfOk = pdfVerification ? Boolean(pdfVerification.ok && pdfVerification.residualLeakCount === 0) : true;
  const shadowPassed = shadowTextAudit.status === 'PASS' && pdfOk;
  const residualCount = shadowTextAudit.residualSpans + (pdfVerification ? pdfVerification.residualLeakCount : 0);

  const shadowAuditResult = {
    status: shadowPassed ? 'PASS' : 'FAIL',
    residualSpans: residualCount,
    checks: pdfVerification ? [...shadowTextAudit.checks, 'pdf_irreversibility'] : shadowTextAudit.checks,
    ...(pdfVerification
      ? {
          pdfIrreversibilityVerified: pdfOk,
          pdfChannelsChecked: pdfVerification.channelsChecked,
          pdfCheckedSpanCount: pdfVerification.checkedSpanCount,
        }
      : {}),
  };

  const numIntegrity = checkNumericIntegrity(beforeComparableText, afterComparableText, knownRawValues);
  const numericIntegrityStatus = numIntegrity.status;

  const anyDenied = (perceived?.blocks || []).some((b) => b.policyAction === 'deny');
  let verdict = 'KEEP';
  if (!shadowPassed || anyDenied) {
    verdict = 'DROP';
  } else if (entityCountsMasked.total > 0 || hiddenChannelsStripped.total > 0) {
    verdict = 'ABSTAIN';
  }
  const policyAction = mapPolicyVerdict(verdict);
  const policyVerdict = {
    verdict,
    policy: policyAction,
    policyAction,
    mapping: { ...POLICY_VERDICT_MAP },
  };

  const receiptSha256 =
    perceived?.receipt?.receiptSha256 ||
    sha256HexBuf(Buffer.from(`${beforeSha256}:${sha256HexBuf(outputBuffer)}`, 'utf8'));

  if (!shadowPassed) {
    const failedReport = {
      inputPath: fullPath,
      outputPath: null,
      format: detectedFormat,
      beforeBytes: rawBuf.length,
      afterBytes: 0,
      beforeSha256,
      afterSha256: null,
      hiddenChannelsStripped,
      entityCountsMasked,
      numericIntegrityStatus,
      numericIntegrity: numIntegrity,
      shadowAuditResult,
      verdict,
      policyAction,
      policyVerdict,
      receiptSha256,
      zeroEgress: true,
    };
    if (typeof cliFlags['diff-report'] === 'string' && cliFlags['diff-report'].length > 0) {
      const rp = path.resolve(cliFlags['diff-report']);
      fs.mkdirSync(path.dirname(rp), { recursive: true });
      fs.writeFileSync(rp, JSON.stringify(failedReport, null, 2) + '\n');
    }
    const err = new Error(`SANITIZE_SHADOW_AUDIT_FAILED: ${residualCount} residual span(s) detected; output suppressed`);
    err.diffReport = failedReport;
    throw err;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, outputBuffer);
  const afterSha256 = sha256HexBuf(outputBuffer);

  let trainingExportSummary = undefined;
  if (typeof cliFlags.format === 'string' && cliFlags.format.length > 0) {
    const exported = await exportTrainingDataset(perceived, { format: cliFlags.format });
    const exportTarget =
      typeof cliFlags['export-out'] === 'string' && cliFlags['export-out'].length > 0
        ? cliFlags['export-out']
        : `${outputPath}.${exported.format}.jsonl`;
    const written = writeTrainingDataset(exported, exportTarget);
    trainingExportSummary = {
      format: exported.format,
      jsonlPath: written.jsonlPath,
      manifestPath: written.manifestPath,
      recordCount: exported.manifest.recordCount,
      datasetSha256: exported.manifest.datasetSha256,
    };
  }

  const diffReport = {
    inputPath: fullPath,
    outputPath,
    format: detectedFormat,
    beforeBytes: rawBuf.length,
    afterBytes: outputBuffer.length,
    beforeSha256,
    afterSha256,
    hiddenChannelsStripped,
    entityCountsMasked,
    numericIntegrityStatus,
    numericIntegrity: numIntegrity,
    shadowAuditResult,
    verdict,
    policyAction,
    policyVerdict,
    receiptSha256,
    zeroEgress: true,
    ...(trainingExportSummary ? { trainingExport: trainingExportSummary } : {}),
  };

  if (typeof cliFlags['diff-report'] === 'string' && cliFlags['diff-report'].length > 0) {
    const reportPath = path.resolve(cliFlags['diff-report']);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(diffReport, null, 2) + '\n');
  }

  return diffReport;
}

const { flags, positional } = parseArgs(rawArgs);
let command = positional[0];

if (flags.help || rawArgs.includes('-h') || command === 'help') {
  const fp = await buildWasmFootprintReport();
  console.log('Versieve CLI v1.0.0 — Zero-Egress Multimodal Sanitizer, Exporters & Conformal Gatekeeper\n');
  console.log('Usage:');
  console.log('  versieve sanitize <inputFile> [--out <outputPath>] [--diff-report <reportPath>] [--json] [--format <exportFormat>] [--export-out <jsonlPath>]');
  console.log('  versieve footprint [--json]');
  console.log('  versieve run <path-or-url> [--out-dir <folder>] [--csv <out.csv>] [--json <out.json>] [--alpha <0.05>]');
  console.log('  versieve ingest <path-or-url> [--out <out.json>]');
  console.log('  versieve train --input <dataset.jsonl|json|csv> [--out <bundle.json>] [--alpha <0.05>]');
  console.log('  versieve decide --bundle <bundle.json> (--text <string> | --input <file>)');
  console.log('  versieve audit-wasm [<wasmPath>]');
  console.log('  versieve selftest\n');
  console.log('Supported training export formats (--format): llama-factory-sharegpt, llama-factory-alpaca, unsloth, oumi, nemo, document-qa\n');
  console.log(formatFootprintText(fp));
} else if (!command || command === 'selftest') {
  console.log('Versieve CLI v1.0.0');
  console.log('Running selftest pipeline...');
  const sample = 'Invoice #12345 from alice@example.com total $500.00. Phone +61 412 345 678.';
  const res = runCleanAndTokenizePipeline(sample, { format: 'text' });
  console.log('Ingest & Tokenize OK:', res.blocks.length, 'blocks,', res.tokenizedChunks.length, 'chunks.');
  console.log('Node Hash:', res.nodeHash);
  console.log('Selftest passed successfully!');
} else if (command === 'footprint') {
  try {
    const fp = await buildWasmFootprintReport();
    if (flags.json) {
      const serialized = JSON.stringify(fp, null, 2);
      if (typeof flags.json === 'string') {
        fs.writeFileSync(path.resolve(flags.json), serialized + '\n');
      }
      console.log(serialized);
    } else {
      console.log(formatFootprintText(fp));
    }
    if (!fp.allZeroImports || fp.kernelCount !== 5) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Error inspecting WASM footprint:', err.message);
    process.exitCode = 1;
  }
} else if (command === 'sanitize') {
  let inputTarget = flags.input || positional[1];
  let jsonFlag = flags.json;
  if (!inputTarget && typeof flags.json === 'string') {
    inputTarget = flags.json;
    jsonFlag = true;
  }
  if (!inputTarget) {
    console.error(
      'Error: Usage: versieve sanitize <inputFile> [--out <outputPath>] [--diff-report <reportPath>] [--json] [--format <exportFormat>] [--export-out <jsonlPath>]'
    );
    process.exitCode = 1;
  } else {
    try {
      const report = await sanitizeLocalFile(inputTarget, flags);
      if (jsonFlag) {
        const serialized = JSON.stringify(report, null, 2);
        if (typeof jsonFlag === 'string') {
          fs.writeFileSync(path.resolve(jsonFlag), serialized + '\n');
        }
        console.log(serialized);
      } else {
        console.log('========================================================================');
        console.log('               VERSIEVE — ZERO-EGRESS SANITIZE DIFF REPORT              ');
        console.log('========================================================================');
        console.log(` Input File:           ${report.inputPath} (${report.format}, ${report.beforeBytes} B)`);
        console.log(` Sanitized Output:     ${report.outputPath} (${report.afterBytes} B)`);
        console.log(` Hidden Channels:      ${report.hiddenChannelsStripped.total} stripped (forensic=${report.hiddenChannelsStripped.forensicFindingsCount}, unicode=${report.hiddenChannelsStripped.unicode.total}, comments=${report.hiddenChannelsStripped.htmlComments})`);
        console.log(` Entities Masked:      ${report.entityCountsMasked.total} spans (${JSON.stringify(report.entityCountsMasked.byClass)})`);
        console.log(` Numeric Integrity:    ${report.numericIntegrityStatus}`);
        console.log(` Shadow Audit:         ${report.shadowAuditResult.status} (residualSpans=${report.shadowAuditResult.residualSpans})`);
        console.log(` Policy Verdict:       ${report.policyVerdict.verdict} -> ${report.policyVerdict.policy}`);
        console.log(` Receipt SHA-256:      ${report.receiptSha256}`);
        console.log(` Zero Egress:          ${report.zeroEgress}`);
        if (report.trainingExport) {
          console.log(` Training Export:      ${report.trainingExport.jsonlPath} (${report.trainingExport.format}, ${report.trainingExport.recordCount} records)`);
        }
        console.log('========================================================================');
      }
    } catch (err) {
      console.error('Error sanitizing file:', err.message);
      process.exitCode = 1;
    }
  }
} else if (command === 'audit-wasm') {
  try {
    const singleTarget = flags.wasm || positional[1];
    if (singleTarget) {
      const base = path.basename(singleTarget).toLowerCase();
      let report;
      if (base.includes('versieve_clean')) {
        report = await auditCleanWasmArtifact(singleTarget);
      } else if (base.includes('versieve_dl')) {
        report = await auditDlWasmArtifact(singleTarget);
      } else if (base.includes('versieve_sql')) {
        report = await auditVersieveSqlWasm(singleTarget);
      } else {
        report = await auditCactusWasmArtifact(singleTarget, { strict: true });
      }
      console.log(JSON.stringify(report, null, 2));
      if (!report.zeroEgressVerified) {
        process.exit(1);
      }
    } else {
      const cactus = await auditCactusWasmArtifact(path.join(PKG_ROOT, 'vendor/cactus/cactus.wasm'), { strict: true });
      const versieveClean = await auditCleanWasmArtifact(path.join(PKG_ROOT, 'vendor/wasm/versieve_clean.wasm'));
      const versieveDl = await auditDlWasmArtifact(path.join(PKG_ROOT, 'vendor/wasm/versieve_dl.wasm'));
      const versieveSql = await auditVersieveSqlWasm(path.join(PKG_ROOT, 'vendor/wasm/versieve_sql.wasm'));
      const allVerified = Boolean(
        cactus.zeroEgressVerified &&
        versieveClean.zeroEgressVerified &&
        versieveDl.zeroEgressVerified &&
        versieveSql.zeroEgressVerified
      );
      const summary = {
        allVerified,
        binaries: {
          cactus,
          versieve_clean: versieveClean,
          versieve_dl: versieveDl,
          versieve_sql: versieveSql,
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
} else if (command === 'run' || (!['sanitize', 'footprint', 'help', 'ingest', 'train', 'decide', 'audit-wasm', 'selftest'].includes(command) && positional.length > 0)) {
  const target = command === 'run' ? positional[1] : command;

  if (!target) {
    console.error('Error: Please provide a file path, directory path, or online URL.');
    console.log('Usage: npx versieve run <path-or-url> [--out-dir <folder>] [--csv <out.csv>] [--json <out.json>] [--mode <mode>] [--pii-strategy <strategy>] [--alpha <0.05>]');
    process.exit(1);
  }

  const options = {
    mode: flags['mode'] || 'auto',
    piiStrategy: flags['pii-strategy'] || flags['strategy'] || 'token',
    alpha: flags['alpha'] ? parseFloat(flags['alpha']) : 0.05,
    maxSeqLen: flags['max-seq-len'] ? parseInt(flags['max-seq-len'], 10) : 256,
    chunkMode: flags['chunk-mode'],
    chunkTokens: flags['chunk-tokens'] ? parseInt(flags['chunk-tokens'], 10) : undefined,
    chunkOverlap: flags['chunk-overlap'] ? parseInt(flags['chunk-overlap'], 10) : undefined,
    pseudonymize: flags['pseudonymize'] === true || flags['pseudonymize'] === 'true',
    workspaceSalt: flags['workspace-salt'],
    outDir: flags['out-dir'] || flags['outDir'],
    csv: flags['csv'],
    json: flags['json'],
    svg: flags['svg'],
    bundle: flags['bundle'],
    weightsPath: flags['weights'] || flags['weights-path'],
  };

  try {
    console.log(`Processing: ${target}...`);
    const result = await withCliOcrProvider(options, (ocrOptions) =>
      ingestFromUrlOrPath(target, ocrOptions)
    );
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
    console.log('             VERSIEVE — UNIVERSAL DATA GATEKEEPER AUDIT                ');
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
      console.log(`   - ${path.join(options.outDir, 'rtio-graph-sft.jsonl')}`);
      console.log(`   - ${path.join(options.outDir, 'triples.jsonl')}`);
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
    const loaded = await withCliOcrProvider(
      { weightsPath: flags.weights || flags['weights-path'] },
      (ocrOptions) => readBinaryOrTextForCli(target, ocrOptions)
    );
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
    console.error('Error: Usage: versieve train --input <dataset.jsonl|json|csv> [--out <bundle.json>] [--alpha 0.05] [--epochs 30]');
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
    console.error('Error: Usage: versieve decide --bundle <bundle.json> (--text <string> | --input <file>)');
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
      const loaded = await withCliOcrProvider(
        { weightsPath: flags.weights || flags['weights-path'] },
        (ocrOptions) => readBinaryOrTextForCli(flags.input, ocrOptions)
      );
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
  console.log('Available subcommands: sanitize, footprint, run, ingest, train, decide, selftest, audit-wasm');
  process.exit(1);
}
