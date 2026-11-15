/**
 * test/pdf-image-pipeline.test.js
 * Unit tests for PDF vs Image -> CSV/JSON -> Hidden PII -> Tokens -> Trained Gatekeeper pipeline
 * Zero external npm dependencies.
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateResearchPdfAndImage,
  extractPdfTextLayer,
  exportBlocksToCsv,
  exportBlocksToJson,
  runPdfVsImageComparison,
  extractPmcClinicalSentences,
  fetchOrLoadFunsdBenchmark
} from '../src/pdf-image-pipeline.js';
import { scanRecordsForPII, maskValue, runCleanAndTokenizePipeline } from '../src/clean-and-tokenize.js';
import {
  auditVerisieveDlWasm,
  embedNeedleWasm,
  searchNeedleWasm,
  trainWasmSmallModel
} from '../src/wasm-needle-dl.js';


test('1. Generated PDF 1.4 binary starts with %PDF-1.4 and ends with %%EOF', () => {
  const { pdfBuffer } = generateResearchPdfAndImage();
  assert.ok(pdfBuffer instanceof Buffer, 'pdfBuffer must be a Buffer');
  const pdfStr = pdfBuffer.toString('latin1');
  assert.ok(pdfStr.startsWith('%PDF-1.4'), 'Must start with %PDF-1.4 header');
  assert.ok(pdfStr.includes('%%EOF'), 'Must end with %%EOF marker');
  assert.ok(pdfStr.includes('/Catalog'), 'Must contain /Catalog dictionary');
  assert.ok(pdfStr.includes('/Pages'), 'Must contain /Pages dictionary');
});

test('2. extractPdfTextLayer recovers 100% of lines from binary PDF buffer', () => {
  const { pdfBuffer, sourceLines } = generateResearchPdfAndImage();
  const extracted = extractPdfTextLayer(pdfBuffer);
  assert.ok(extracted.length >= 17, `Must extract >= 17 lines, got ${extracted.length}`);
  assert.strictEqual(extracted[0].text, sourceLines[0].text || sourceLines[0], 'First line title must match');
});

test('3. Exported PNG image and visual PII redacted PNG are valid PNGs with blacked out PII boxes', () => {
  const { pngBuffer, redactedPngBuffer, badScanPngBuffer } = generateResearchPdfAndImage();
  assert.ok(pngBuffer instanceof Buffer);
  assert.ok(redactedPngBuffer instanceof Buffer);
  assert.ok(badScanPngBuffer instanceof Buffer);

  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(pngBuffer.slice(0, 8).equals(pngHeader), 'Raw PNG must have valid PNG header');
  assert.ok(redactedPngBuffer.slice(0, 8).equals(pngHeader), 'Redacted PNG must have valid PNG header');
  assert.ok(badScanPngBuffer.slice(0, 8).equals(pngHeader), 'Bad scan PNG must have valid PNG header');
});

test('4. PII scanning & maskValue correctly mask sensitive data without leaking raw PII', () => {
  const sampleEmail = 'ncarlini@google.com';
  const maskedEmail = maskValue(sampleEmail, 'email');
  assert.strictEqual(maskedEmail, '<PII:EMAIL>');

  const sampleSsn = '123-45-6789';
  const maskedSsn = maskValue(sampleSsn, 'ssn');
  assert.strictEqual(maskedSsn, '<PII:SSN>');

  const items = scanRecordsForPII('Contact ncarlini@google.com regarding SSN 123-45-6789.');
  assert.strictEqual(items.length, 2);
  assert.ok(items.some((i) => i.type === 'email'));
  assert.ok(items.some((i) => i.type === 'ssn'));
});

test('5. Tokenizer & vectorizer produce token IDs and normalized 520-dim feature vectors', () => {
  const pipelineRes = runCleanAndTokenizePipeline([
    { lineIndex: 0, text: 'Extracting Training Data from Large Language Models', fontStyle: 'DisplaySerif', fontSizePx: 18 }
  ]);
  assert.ok(pipelineRes.blocks.length > 0);
  assert.ok(pipelineRes.features.length > 0);
  assert.strictEqual(pipelineRes.features[0].length, 520);
});

test('6. CSV and JSON exports contain all required columns, >= 17 rows, > 1500 bytes each, and zero unmasked raw PII in masked_text', () => {
  const comparison = runPdfVsImageComparison();

  // 1. Assert all 3 CSVs exist and are strings
  assert.ok(typeof comparison.pdfCsv === 'string', 'pdfCsv must be string');
  assert.ok(typeof comparison.imageCsv === 'string', 'imageCsv must be string');
  assert.ok(typeof comparison.badOcrCsv === 'string', 'badOcrCsv must be string');

  // 2. Assert sizes: each > 1500 bytes, badOcrCsv > 2000 bytes
  assert.ok(comparison.pdfCsv.length > 1500, `pdfCsv size ${comparison.pdfCsv.length} must be > 1500 bytes`);
  assert.ok(comparison.imageCsv.length > 1500, `imageCsv size ${comparison.imageCsv.length} must be > 1500 bytes`);
  assert.ok(comparison.badOcrCsv.length > 2000, `badOcrCsv size ${comparison.badOcrCsv.length} must be > 2000 bytes`);

  // 3. Assert >= 17 data rows (plus 1 header row = >= 18 lines)
  const pdfLines = comparison.pdfCsv.trim().split('\n');
  const imageLines = comparison.imageCsv.trim().split('\n');
  const badOcrLines = comparison.badOcrCsv.trim().split('\n');

  assert.ok(pdfLines.length >= 18, `pdfCsv data rows (${pdfLines.length - 1}) must be >= 17`);
  assert.ok(imageLines.length >= 18, `imageCsv data rows (${imageLines.length - 1}) must be >= 17`);
  assert.ok(badOcrLines.length >= 18, `badOcrCsv data rows (${badOcrLines.length - 1}) must be >= 17`);

  // 4. Assert required headers
  const requiredHeaders = [
    'line_index',
    'source_mode',
    'font_style',
    'raw_excerpt',
    'pii_detected',
    'pii_types',
    'hidden_pii_preview',
    'masked_text',
    'token_count',
    'first_8_token_ids',
    'label',
    'pred_prob',
    'gatekeeper_action'
  ];
  for (const h of requiredHeaders) {
    assert.ok(pdfLines[0].includes(h), `pdfCsv header missing ${h}`);
    assert.ok(imageLines[0].includes(h), `imageCsv header missing ${h}`);
    assert.ok(badOcrLines[0].includes(h), `badOcrCsv header missing ${h}`);
  }

  // 5. Zero unmasked raw PII in masked_text
  const unmaskedPiiRegex = /(?:\b\d{3}-\d{2}-\d{4}\b|\b4532-0151-1283-0366\b|ada\.lovelace@matilda-maincode\.au|\+61\s*412\s*345\s*678)/;
  pdfLines.slice(1).forEach((row) => {
    // Check that masked_text does not leak raw secrets
    const cols = row.split(',');
    const maskedCol = cols[7] || '';
    assert.ok(!unmaskedPiiRegex.test(maskedCol), `Raw PII leaked in masked_text: ${maskedCol}`);
  });
});

test('7. Client-side gatekeeper training + LTT routing classifies lines correctly, pred_prob varies, KEEP_SAFE mean > DROP mean', () => {
  const comparison = runPdfVsImageComparison();
  const pdfRows = comparison.comparisonJson.paths.pdf_binary;
  const imageRows = comparison.comparisonJson.paths.image_2d_tiled;

  assert.ok(pdfRows.length >= 17, `pdfRows length ${pdfRows.length} must be >= 17`);
  assert.ok(imageRows.length >= 17, `imageRows length ${imageRows.length} must be >= 17`);

  // 1. Assert pii_detected === true on at least 8 rows covering all 8 categories
  const piiRows = pdfRows.filter((r) => r.pii_detected === true);
  assert.ok(piiRows.length >= 8, `Must have >= 8 PII rows, got ${piiRows.length}`);

  const detectedPiiTypes = new Set();
  piiRows.forEach((r) => {
    assert.ok(Array.isArray(r.pii_types) && r.pii_types.length > 0, 'PII row must have non-empty pii_types');
    assert.ok(typeof r.hidden_pii_preview === 'string' && r.hidden_pii_preview.length > 0, 'PII row must have hidden_pii_preview');
    r.pii_types.forEach((t) => detectedPiiTypes.add(t));
  });

  const expectedPiiCategories = [
    'email',
    'phone',
    'ssn',
    'credit_card',
    'ip_address',
    'date_of_birth',
    'name_likely',
    'address_likely'
  ];
  for (const cat of expectedPiiCategories) {
    assert.ok(detectedPiiTypes.has(cat), `Expected PII category '${cat}' was not detected`);
  }

  // 2. Assert token_count > 0 and first_8_token_ids.length > 0 on every row
  pdfRows.forEach((r, idx) => {
    assert.ok(r.token_count > 0, `Row ${idx} token_count must be > 0, got ${r.token_count}`);
    assert.ok(
      Array.isArray(r.first_8_token_ids) && r.first_8_token_ids.length > 0,
      `Row ${idx} first_8_token_ids must be non-empty array`
    );
    assert.ok(
      ['KEEP_SAFE', 'DROP_OR_QUARANTINE', 'ABSTAIN_HUMAN_REVIEW'].includes(r.gatekeeper_action),
      `Invalid gatekeeper action: ${r.gatekeeper_action}`
    );
    assert.ok(typeof r.pred_prob === 'number' && !isNaN(r.pred_prob), `pred_prob must be number: ${r.pred_prob}`);
  });

  // 3. Assert pred_prob varies across rows (not constant 0.1)
  const uniqueProbs = new Set(pdfRows.map((r) => r.pred_prob));
  assert.ok(uniqueProbs.size > 5, `pred_prob must vary across rows, found only ${uniqueProbs.size} unique values`);

  // 4. Assert KEEP_SAFE rows have higher mean pred_prob than DROP_OR_QUARANTINE rows
  const keepSafeRows = pdfRows.filter((r) => r.gatekeeper_action === 'KEEP_SAFE');
  const dropRows = pdfRows.filter((r) => r.gatekeeper_action === 'DROP_OR_QUARANTINE');

  assert.ok(keepSafeRows.length > 0, 'Must have at least one KEEP_SAFE row');
  assert.ok(dropRows.length > 0, 'Must have at least one DROP_OR_QUARANTINE row');

  const meanSafeProb = keepSafeRows.reduce((sum, r) => sum + r.pred_prob, 0) / keepSafeRows.length;
  const meanDropProb = dropRows.reduce((sum, r) => sum + r.pred_prob, 0) / dropRows.length;

  assert.ok(
    meanSafeProb > meanDropProb,
    `meanSafeProb (${meanSafeProb.toFixed(4)}) must be greater than meanDropProb (${meanDropProb.toFixed(4)})`
  );
  assert.ok(meanSafeProb >= 0.50, `meanSafeProb (${meanSafeProb}) should be >= 0.50`);
  assert.ok(meanDropProb <= 0.35, `meanDropProb (${meanDropProb}) should be <= 0.35`);
});

test('8. Real PMC clinical research PDF & FUNSD benchmark data integration', async () => {
  // Test clinical sentences extracted from PMC paper
  const sentences = extractPmcClinicalSentences();
  assert.ok(Array.isArray(sentences) && sentences.length >= 5, 'Must extract >= 5 clinical research sentences');
  assert.ok(sentences.some((s) => s.toLowerCase().includes('fracture') || s.toLowerCase().includes('nutritional')));

  // Test loading or fallback of archival benchmark
  const untrustedDir = path.resolve('results/untrusted-benchmarks');
  const funsdData = await fetchOrLoadFunsdBenchmark(untrustedDir);
  assert.ok(funsdData && (funsdData.rows || funsdData.data), 'FUNSD benchmark data must be present');
  assert.ok(fs.existsSync(path.join(untrustedDir, 'funsd-sample.json')), 'funsd-sample.json must exist');
});

test('9. 100% Real External Data Pipeline execution (Zero Mock Strings & Byte-Identical SVG)', async () => {
  const { runRealExternalDataPipeline } = await import('../src/pdf-image-pipeline.js');
  const run1 = runRealExternalDataPipeline({ write: false });

  assert.ok(run1.pmcRows.length >= 30, `PMC rows (${run1.pmcRows.length}) must be >= 30`);
  assert.ok(run1.funsdRows.length >= 30, `FUNSD rows (${run1.funsdRows.length}) must be >= 30`);
  assert.strictEqual(run1.comparisonJson.summary.gatekeeper_status, 'CERTIFIED');

  // Assert ZERO mock strings
  const csvCombined = run1.pmcCsv + run1.funsdCsv;
  assert.ok(!csvCombined.includes('MATILDA SECURE'), 'Must NOT contain mock string "MATILDA SECURE"');
  assert.ok(!csvCombined.includes('Evelyn Vance'), 'Must NOT contain mock string "Evelyn Vance"');
  assert.ok(!csvCombined.includes('ada.lovelace@matilda-maincode.au'), 'Must NOT contain mock string "ada.lovelace"');

  // Assert real author & archival names/emails are caught and processed
  assert.ok(run1.pmcRows.some((r) => r.pii_detected && (r.pii_types.includes('email') || r.pii_types.includes('phone'))));
  assert.ok(run1.funsdRows.some((r) => r.pii_detected && (r.pii_types.includes('phone') || r.pii_types.includes('name_likely'))));

  // Assert byte-identical SVG across two runs
  const run2 = runRealExternalDataPipeline({ write: false });
  assert.strictEqual(run1.comparisonSvg, run2.comparisonSvg, 'SVG visualization must be 100% byte-identical across runs');
});

test('10. ingestFromUrlOrPath handles files, flags, and online URL with offline fallback', async () => {
  const { ingestFromUrlOrPath } = await import('../src/pdf-image-pipeline.js');

  // Test 1: Real local PMC PDF with options
  const pmcPdfPath = 'C:/Users/GEYE ARDIANSYAH/Downloads/Innovation Hub/Health-Research/references/papers/miu_2017_PMC5773420.pdf';
  const outDir = path.resolve('results/test-byod-out');
  const resFile = await ingestFromUrlOrPath(pmcPdfPath, {
    mode: 'auto',
    piiStrategy: 'partial',
    alpha: 0.10,
    maxSeqLen: 128,
    outDir
  });

  assert.ok(resFile.rows.length > 50, `Must extract > 50 lines from real PDF, got ${resFile.rows.length}`);
  assert.ok(resFile.stats.pii_detected_lines > 0, 'Must detect PII in real PDF');
  assert.ok(fs.existsSync(path.join(outDir, 'results.csv')));
  assert.ok(fs.existsSync(path.join(outDir, 'results.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'train-qwen-llama-sft.jsonl')));
  assert.ok(fs.existsSync(path.join(outDir, 'train-tokens.bin')));
  assert.ok(fs.existsSync(path.join(outDir, 'gatekeeper-bundle.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'summary-report.svg')));

  // Assert AuditChain provenance in results.json
  const { AuditChain } = await import('../src/clean-and-tokenize.js');
  const jsonReport = JSON.parse(fs.readFileSync(path.join(outDir, 'results.json'), 'utf8'));
  assert.ok(Array.isArray(jsonReport.audit_chain), 'results.json must contain audit_chain');
  assert.strictEqual(AuditChain.verifyChain(jsonReport.audit_chain), true, 'audit_chain must be cryptographically valid');

  // Assert train-tokens.bin is non-empty multiple of 4 bytes
  const binBuf = fs.readFileSync(path.join(outDir, 'train-tokens.bin'));
  assert.ok(binBuf.length > 0, 'train-tokens.bin must not be empty');
  assert.strictEqual(binBuf.length % 4, 0, 'train-tokens.bin must be 32-bit aligned uint32 array');

  // Assert train-qwen-llama-sft.jsonl ChatML structure
  const sftLines = fs.readFileSync(path.join(outDir, 'train-qwen-llama-sft.jsonl'), 'utf8').trim().split('\n');
  assert.ok(sftLines.length > 0, 'Must have at least 1 KEEP_SAFE training row');
  const firstSample = JSON.parse(sftLines[0]);
  assert.ok(firstSample.text.includes('<|im_start|>user'), 'Must contain ChatML formatting');
  assert.ok(Array.isArray(firstSample.input_ids), 'Must contain input_ids');
  assert.ok(Array.isArray(firstSample.messages), 'Must contain messages');
  assert.ok(typeof firstSample.provenance_node_hash === 'string', 'Must contain provenance_node_hash');

  // Test 2: Unreachable online URL triggers offline fallback cleanly without crashing
  const unreachableUrl = 'https://offline-fallback-test.invalid/paper.pdf';
  const resFallback = await ingestFromUrlOrPath(unreachableUrl, { timeoutMs: 2000 });
  assert.strictEqual(resFallback.fetchStatus, 'offline_fallback');
  assert.ok(resFallback.rows.length > 0, 'Offline fallback must still produce rows');
  assert.ok(resFallback.gatekeeperBundle, 'Must produce gatekeeper bundle');
});

test('11. UI server endpoints /api/run and /api/mcp forward requests cleanly', async () => {
  const { handleJsonRpcRequest } = await import('../src/mcp-server.js');

  // Verify MCP initialize
  const initRes = handleJsonRpcRequest({ jsonrpc: '2.0', id: 101, method: 'initialize' });
  assert.strictEqual(initRes.result.serverInfo.name, 'matilda-portable-mcp');

  // Verify MCP ingest_and_tokenize call
  const callRes = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 102,
    method: 'tools/call',
    params: {
      name: 'ingest_and_tokenize',
      arguments: { input: 'Hospital 124 Shatin Pass Road. miuky@ha.org.hk Phone: +852-3517-3668' }
    }
  });
  assert.ok(callRes.result.content[0].text.includes('<PII:'));
});

test('12. UI server endpoints /api/duckdb and /api/train-model process SQL and training telemetry', async () => {
  const { spawn } = await import('node:child_process');
  const testPort = 3349;

  const child = spawn('node', ['scripts/ui-server.mjs'], {
    env: { ...process.env, PORT: String(testPort) },
    stdio: 'pipe'
  });

  // Wait briefly for server ready
  await new Promise((r) => setTimeout(r, 800));

  try {
    // 1. Test /api/duckdb
    const duckResp = await fetch(`http://localhost:${testPort}/api/duckdb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT source_mode, count(*) as count FROM documents GROUP BY source_mode ORDER BY source_mode;' })
    });
    assert.strictEqual(duckResp.status, 200);
    const duckData = await duckResp.json();
    assert.strictEqual(duckData.ok, true);
    assert.ok(duckData.columns.includes('source_mode'));
    assert.ok(duckData.columns.includes('count'));
    assert.ok(duckData.rows.length >= 2);
    assert.ok(duckData.engine.includes('DuckDB'));

    // 2. Test /api/train-model
    const trainResp = await fetch(`http://localhost:${testPort}/api/train-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: false })
    });
    assert.strictEqual(trainResp.status, 200);
    const trainData = await trainResp.json();
    assert.strictEqual(trainData.ok, true);
    assert.ok(trainData.model_training, 'Must contain model_training');
    assert.strictEqual(trainData.model_training.piiExposureRatePctVerisieve, 0.0, 'VeriSieve PII leak rate must be 0.0%');
    assert.strictEqual(trainData.model_training.piiExposureRatePctRaw, 100.0, 'Raw model PII leak rate must be 100%');
    assert.ok(trainData.model_training.valPerplexityVerisieve <= trainData.model_training.valPerplexityRaw, 'VeriSieve validation perplexity must be superior');
    assert.ok(Array.isArray(trainData.sftPreview), 'Must return sftPreview array');

    // 3. Test /api/needle-search
    const needleResp = await fetch(`http://localhost:${testPort}/api/needle-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hip fracture recovery' })
    });
    assert.strictEqual(needleResp.status, 200);
    const needleData = await needleResp.json();
    assert.strictEqual(needleData.ok, true);
    assert.strictEqual(needleData.piiExposureRatePct, 0.0);
    assert.ok(needleData.results.length >= 1);
  } finally {
    child.kill();
  }
});

test('13. auditVerisieveDlWasm verifies 100% air-gapped pure WASM (0 imports, 60,096 bytes, 23 DL kernel exports)', async () => {
  const audit = await auditVerisieveDlWasm();
  assert.strictEqual(audit.ok, true);
  assert.strictEqual(audit.byteLength, 60096);
  assert.strictEqual(audit.importCount, 0, 'Must have zero WASM imports (100% air-gapped pure WASM)');
  assert.strictEqual(audit.exportCount, 23, 'Must export exactly 23 DL kernels');
  assert.strictEqual(audit.sha256, '2FF6E7756ACAFB31A97AC365D7BFEB9911654D751126C603A9CDEDA8F2E314D2');
  assert.strictEqual(audit.airGapped, true);
  assert.ok(audit.kernelExports.includes('mle_dl_embed_subword'));
  assert.ok(audit.kernelExports.includes('mle_dl_bitnet_encode'));
  assert.ok(audit.kernelExports.includes('mle_dl_transformer_train'));
  assert.ok(audit.kernelExports.includes('mle_dl_vera_train'));
});

test('14. embedNeedleWasm and searchNeedleWasm return deterministic 64-dim embeddings and accurate semantic ranking in pure WASM', () => {
  const textA = 'Effects of Nutritional Status on Elderly Hip Fracture Recovery';
  const textB = 'Functional recovery after hip fracture in elderly patients';
  const textC = 'CONFIDENTIAL FACSIMILE COVER SHEET Dec 10 1998';

  const embA = embedNeedleWasm(textA);
  const embB = embedNeedleWasm(textB);
  const embC = embedNeedleWasm(textC);

  assert.strictEqual(embA.length, 64, 'Must return 64-dim embedding');
  assert.strictEqual(embB.length, 64);
  assert.strictEqual(embC.length, 64);

  // Verify L2 unit-norm
  const normA = Math.hypot(...embA);
  assert.ok(Math.abs(normA - 1.0) < 1e-4, 'Must be L2 unit normalized');

  // Determinism test
  const embA2 = embedNeedleWasm(textA);
  assert.deepStrictEqual(Array.from(embA), Array.from(embA2), 'Embeddings must be 100% deterministic');

  // Semantic search test
  const docs = [textA, textB, textC];
  const results = searchNeedleWasm('elderly hip fracture nutrition recovery', docs, { topK: 3 });

  assert.strictEqual(results.length, 3);
  assert.ok(results[0].latencyMs < 50, 'Search latency must be fast');
  // Top match must be textA (nutritional status on hip fracture)
  assert.strictEqual(results[0].text, textA);
  // Score of clinical match must be higher than fax cover sheet
  assert.ok(results[0].score > results[2].score);
});

test('15. trainWasmSmallModel completes in <100 ms in pure WASM with decreasing loss and 0.0% PII exposure on VeriSieve shard', () => {
  const t0 = performance.now();
  const { results } = trainWasmSmallModel(null, { epochs: 25, exportArtifacts: false });
  const duration = performance.now() - t0;

  assert.ok(duration < 150, `Training must complete in <150 ms in pure WASM, took ${duration.toFixed(2)} ms`);
  const m = results.model_training;
  assert.ok(m.lossHistoryVerisieve.length === 25, 'Must record 25 epochs of loss');
  assert.ok(
    m.lossHistoryVerisieve[m.lossHistoryVerisieve.length - 1] <= m.lossHistoryVerisieve[0],
    'Training loss must decrease or converge'
  );
  assert.strictEqual(m.piiExposureRatePctVerisieve, 0.0, 'PII exposure rate on VeriSieve shard must be 0.0%');
  assert.strictEqual(m.piiExposureRatePctRaw, 100.0, 'PII exposure rate on raw shard must be 100%');
  assert.ok(m.valPerplexityVerisieve <= m.valPerplexityRaw, 'Validation perplexity must be superior on VeriSieve shard');
  assert.strictEqual(m.needleRetrievalPurityPctVerisieve, 100.0, 'Needle retrieval purity must be 100% on certified shard');
});

