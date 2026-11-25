import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { extractPdfDetailed, ingestFromUrlOrPath } from '../src/pdf-image-pipeline.js';
import { extractDocxText } from '../src/ingestor.js';
import { decodeImageBuffer } from '../src/ocr-engine.js';

test('T9: zero C:/Users machine paths remain in src, scripts, test, bin, or demo', () => {
  const dirs = ['src', 'scripts', 'test', 'bin', 'demo'];
  for (const dir of dirs) {
    const abs = path.resolve(dir);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const content = fs.readFileSync(path.join(abs, entry.name), 'utf8');
      assert.doesNotMatch(
        content,
        /C:[\\\/]+Users[\\\/]+GEYE|Health-Research[\\\/]+references[\\\/]+papers/i,
        `Found hardcoded machine path in ${dir}/${entry.name}`
      );
    }
  }
});

test('T9: checked-in self-contained fixtures (PDF, ObjStm PDF, scanned image PDF, PNG, bit-3 DOCX) work end-to-end offline', async () => {
  const fixturesDir = path.resolve('fixtures');
  const required = [
    'clinical-study-sample.pdf',
    'clinical-study-objstm.pdf',
    'scanned-image-only.pdf',
    'scan-sample.png',
    'document-bit3.docx',
  ];
  for (const name of required) {
    const p = path.join(fixturesDir, name);
    assert.ok(fs.existsSync(p), `Missing fixture: fixtures/${name}`);
    assert.ok(fs.statSync(p).size > 200, `Fixture too small: fixtures/${name}`);
  }

  // 1. Born-digital clinical PDF extracts >50 lines + PII cleanly
  const pdfRes = await ingestFromUrlOrPath(path.join(fixturesDir, 'clinical-study-sample.pdf'), { mode: 'auto' });
  assert.ok(pdfRes.rows.length >= 50, `Expected >= 50 rows from fixture PDF, got ${pdfRes.rows.length}`);
  assert.ok(pdfRes.stats.pii_detected_lines > 0);

  // 2. PDF 1.5 /ObjStm + /FlateDecode + /ToUnicode fixture
  const objStmBuf = fs.readFileSync(path.join(fixturesDir, 'clinical-study-objstm.pdf'));
  const objStmParsed = extractPdfDetailed(objStmBuf);
  assert.ok(objStmParsed.lines.length >= 2);
  assert.ok(objStmParsed.lines.some((l) => l.includes('ObjStm') || l.includes('Conformal')));

  // 3. Scanned image-only PDF fails closed when .cact weights are absent
  await assert.rejects(
    () => ingestFromUrlOrPath(path.join(fixturesDir, 'scanned-image-only.pdf')),
    /PDF_IMAGE_ONLY_REQUIRES_OCR|MIRAGE_WEIGHTS_REQUIRED/
  );

  // 4. PNG fixture decodes RGB cleanly & fails closed without .cact weights
  const pngBuf = fs.readFileSync(path.join(fixturesDir, 'scan-sample.png'));
  const decodedImg = decodeImageBuffer(pngBuf, 'scan-sample.png');
  assert.ok(decodedImg.width >= 64 && decodedImg.height >= 64);
  await assert.rejects(
    () => ingestFromUrlOrPath(path.join(fixturesDir, 'scan-sample.png')),
    /IMAGE_REQUIRES_OCR_PROVIDER|MIRAGE_WEIGHTS_REQUIRED/
  );

  // 5. Bit-3 Data Descriptor DOCX fixture
  const docxBuf = fs.readFileSync(path.join(fixturesDir, 'document-bit3.docx'));
  const docxRes = extractDocxText(docxBuf);
  assert.match(docxRes.lines.join('\n'), /Adaptive|Bit-3|Quarantine/i);
  const docxIngest = await ingestFromUrlOrPath(path.join(fixturesDir, 'document-bit3.docx'));
  assert.ok(docxIngest.rows.length >= 2);
});

test('T9: benchmark modules eliminate synthetic formulas, PRNG fake calibration, modulo labels, and asymmetric Python checks', () => {
  const runBenchSrc = fs.readFileSync(path.resolve('scripts/run-benchmarks.mjs'), 'utf8');
  assert.doesNotMatch(runBenchSrc, /7450\.0|624500\.0|48\.5/);
  assert.doesNotMatch(runBenchSrc, /alpha\s*\*\s*2\.8|alpha\s*\*\s*1\.5|0\.15\s*-\s*alpha\s*\*\s*0\.3/);
  assert.doesNotMatch(runBenchSrc, /n\s*===\s*100\s*\?\s*7\.8/);
  assert.doesNotMatch(runBenchSrc, /function\s+calibrateGatekeeper\s*\(/);

  const figSrc = fs.readFileSync(path.resolve('scripts/generate-figures.mjs'), 'utf8');
  assert.doesNotMatch(figSrc, /\|\|\s*0\.28|\|\|\s*0\.02|\|\|\s*8\.2|\|\|\s*32\.1|\|\|\s*124\.5/);

  const coldStartSrc = fs.readFileSync(path.resolve('scripts/bench-node-coldstart.mjs'), 'utf8');
  assert.match(coldStartSrc, /mle_dl_vera_predict|mle_dl_embed_subword|exp\./);

  const h2hSrc = fs.readFileSync(path.resolve('src/head-to-head-comparison.js'), 'utf8');
  assert.doesNotMatch(h2hSrc, /top3_retrieval_purity_pct:\s*66\.7/);
  assert.doesNotMatch(h2hSrc, /Math\.sin\(i\s*\*\s*0\.7/);
  assert.doesNotMatch(h2hSrc, /hasDiscl\s*\?\s*0\.62\s*:\s*0\.35/);
  assert.doesNotMatch(h2hSrc, /c\.confidence\s*>=\s*0\.85/);
  assert.doesNotMatch(h2hSrc, /const\s+pipeD_fp\s*=\s*0\s*;/);

  const scaleSrc = fs.readFileSync(path.resolve('src/scale-benchmark.js'), 'utf8');
  assert.doesNotMatch(scaleSrc, /\(idx\s*\*\s*5\s*\+\s*1\)\s*%\s*3\s*===\s*0/);

  const pyTrainSrc = fs.readFileSync(path.resolve('scripts/train-open-model.py'), 'utf8');
  assert.doesNotMatch(pyTrainSrc, /total_rows_ingested["']\]\s*or\s*67/);
  assert.doesNotMatch(pyTrainSrc, /if\s+pred_raw\s*!=\s*probe\[["']structural_token["']\]/);

  // Verify coldstart script genuinely executes WASM hot loop cleanly
  const coldOut = execFileSync(process.execPath, [path.resolve('scripts/bench-node-coldstart.mjs'), '20', '2'], { encoding: 'utf8' });
  const parsedCold = JSON.parse(coldOut.trim());
  assert.equal(parsedCold.n, 20);
  assert.ok(parsedCold.hotLoopMs >= 0 && parsedCold.wasmKernelExecuted === true);
});

test('T9: technical note cites the live deterministic benchmark headlines', () => {
  const report = JSON.parse(fs.readFileSync(path.resolve('results/scale-and-paradigm-benchmark.json'), 'utf8'));
  const tex = fs.readFileSync(path.resolve('paper/versieve-extraction-redaction-benchmark.tex'), 'utf8');
  const contactSpans = report.race_2_pii_disambiguation_regex_ceiling.ai4privacy_ground_truth.contact_spans;
  const nCalUnsafe = report.race_3_ltt_conformal_calibration.split.nCalUnsafe;
  assert.match(tex, new RegExp(contactSpans.replace('/', '\\/')));
  assert.match(tex, new RegExp(String(nCalUnsafe)));
  assert.match(tex, /0\.1261/);
  assert.match(tex, /110\/140/);
  assert.equal(report.race_4_substrate_and_downstream_race.substrates.single_header_c99.artifactBytes, 2129);
});
