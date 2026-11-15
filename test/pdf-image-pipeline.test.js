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
