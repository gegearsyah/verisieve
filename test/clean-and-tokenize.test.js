import test from 'node:test';
import assert from 'node:assert';
import {
  ingestUnstructuredText,
  fnv1a,
  computeNodeHash,
  normalizeForHash,
  stripBoilerplate,
  dedupBlocks,
  PII_PATTERNS,
  maskValue,
  scanRecordsForPII,
  maskPiiDual,
  createTokenizer,
  tokenizeBlocks,
  extractFeatureRow,
  AuditChain,
  runCleanAndTokenizePipeline
} from '../src/clean-and-tokenize.js';

function refUtf8Fnv1a(str) {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(String(str), 'utf8')) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

test('Born-digital text, HTML, and email ingestion', () => {
  // Plain text
  const textBlocks = ingestUnstructuredText('Hello World\nLine 2', { format: 'text' });
  assert.strictEqual(textBlocks.length, 2);
  assert.strictEqual(textBlocks[0].text, 'Hello World');
  assert.strictEqual(textBlocks[0].sourceFormat, 'text');

  // HTML
  const htmlInput = '<div><p>Hello &amp; Welcome</p><script>alert(1);</script></div>';
  const htmlBlocks = ingestUnstructuredText(htmlInput, { format: 'html' });
  assert.strictEqual(htmlBlocks.length, 1);
  assert.strictEqual(htmlBlocks[0].text, 'Hello & Welcome');
  assert.strictEqual(htmlBlocks[0].sourceFormat, 'html');

  // Email
  const emailInput = 'From: alice@example.com\nTo: bob@example.com\nSubject: Test\n\nHello Bob,\n\n> Quoted reply\n\nBest regards';
  const emailBlocks = ingestUnstructuredText(emailInput, { format: 'email' });
  assert.ok(emailBlocks.length >= 1);
  assert.strictEqual(emailBlocks[0].headers.from, 'alice@example.com');
  // Check quote stripping
  assert.ok(!emailBlocks.some(b => b.text.includes('Quoted reply')));
});

test('Rtio fnv1a and computeNodeHash determinism and key-order invariance', () => {
  const h1 = fnv1a('test-string');
  const h2 = fnv1a('test-string');
  assert.strictEqual(h1, h2);
  assert.strictEqual(typeof h1, 'string');
  assert.strictEqual(h1.length, 8);

  const configA = { b: 2, a: 1, nested: { y: 20, x: 10 } };
  const configB = { a: 1, nested: { x: 10, y: 20 }, b: 2 };

  const nodeHashA = computeNodeHash('test-node', configA, ['abc', 'def']);
  const nodeHashB = computeNodeHash('test-node', configB, ['def', 'abc']);
  assert.strictEqual(nodeHashA, nodeHashB);
});

test('100% removal of planted PII across all 8 categories in text and RGB image', () => {
  const piiText = 'Contact alice@example.com, phone +61 412 345 678, ssn 123-45-6789, card 4532-0151-1283-0366, ip 192.168.1.1, dob 25/12/1990, name Patient Name: John Smith, address 123 Fake St Sydney.';
  
  const blocks = [{
    id: 'b1',
    text: piiText,
    sourceFormat: 'ocr_blocks',
    bbox: [10, 10, 100, 50]
  }];

  const rgb = new Uint8Array(200 * 200 * 3);
  rgb.fill(255); // White background

  const masked = maskPiiDual(blocks, { rgb, width: 200, height: 200, strategy: 'token' });
  assert.strictEqual(masked.length, 1);
  const outText = masked[0].text;

  // Verify all 8 PII categories replaced by tokens
  assert.ok(outText.includes('<PII:EMAIL>'));
  assert.ok(outText.includes('<PII:PHONE>'));
  assert.ok(outText.includes('<PII:SSN>'));
  assert.ok(outText.includes('<PII:CREDIT_CARD>'));
  assert.ok(outText.includes('<PII:IP_ADDRESS>'));
  assert.ok(outText.includes('<PII:DATE_OF_BIRTH>'));
  assert.ok(outText.includes('<PII:NAME_LIKELY>'));
  assert.ok(outText.includes('<PII:ADDRESS_LIKELY>'));

  // Verify RGB pixels at bbox [10, 10, 100, 50] are blacked out to [18, 18, 22]
  const centerIdx = (20 * 200 + 20) * 3;
  assert.strictEqual(rgb[centerIdx], 18);
  assert.strictEqual(rgb[centerIdx + 1], 18);
  assert.strictEqual(rgb[centerIdx + 2], 22);
});

test('Pluggable custom tokenizer injection vs default tokenizer determinism', () => {
  const defaultTokenizer = createTokenizer();
  const res1 = defaultTokenizer.encode('Hello Matilda');
  const res2 = defaultTokenizer.encode('Hello Matilda');
  assert.deepStrictEqual(res1.tokenIds, res2.tokenIds);
  assert.ok(res1.tokenIds instanceof Uint32Array);
  assert.ok(res1.attentionMask instanceof Uint8Array);

  // Custom tokenizer adapter injection
  const customTokenizer = createTokenizer({
    vocab: {},
    merges: [],
    encode: (text) => ({
      tokenIds: new Uint32Array([1, 42, 2]),
      attentionMask: new Uint8Array([1, 1, 1]),
      tokenCount: 3
    })
  });
  const customRes = customTokenizer.encode('Anything');
  assert.strictEqual(customRes.tokenIds[1], 42);

  // Feature row extraction
  const block = { id: 'b1', text: 'Matilda portable ML engine test data 12345', confidence: 0.95 };
  const features = extractFeatureRow(block, res1.tokenIds);
  assert.ok(features instanceof Float32Array);
  assert.strictEqual(features.length, 520);
});

test('AuditChain.verifyChain() passing, tamper detection failing, and stripping .raw/.data/.rows', () => {
  const chain = new AuditChain();
  chain.log('STEP_1', { status: 'ok', raw: 'should be stripped', data: 'also stripped' });
  chain.log('STEP_2', { status: 'ready', rows: [1, 2, 3] });

  const entries = chain.entries;
  assert.strictEqual(AuditChain.verifyChain(entries), true);

  // Verify .raw, .data, .rows are absent from stored metadata
  assert.strictEqual(entries[0].metadata.raw, undefined);
  assert.strictEqual(entries[0].metadata.data, undefined);
  assert.strictEqual(entries[1].metadata.rows, undefined);

  // Tamper detection: modify metadata of entry 0
  const tampered = JSON.parse(JSON.stringify(entries));
  tampered[0].metadata.status = 'tampered';
  assert.strictEqual(AuditChain.verifyChain(tampered), false);
});

test('End-to-end pipeline runCleanAndTokenizePipeline', () => {
  const pipelineResult = runCleanAndTokenizePipeline('Sample born-digital text with email test@example.com', { format: 'text' });
  assert.ok(pipelineResult.blocks.length > 0);
  assert.ok(pipelineResult.tokenizedChunks.length > 0);
  assert.ok(pipelineResult.features.length > 0);
  assert.ok(pipelineResult.auditEntries.length > 0);
  assert.ok(typeof pipelineResult.nodeHash === 'string');
});

test('T3: fnv1a UTF-8 C99 parity & byte-utf8-v1 exact round-trip tokenization', () => {
  assert.strictEqual(fnv1a('café'), refUtf8Fnv1a('café'));
  assert.strictEqual(fnv1a('naïve-🧬-日本語'), refUtf8Fnv1a('naïve-🧬-日本語'));

  const tok = createTokenizer({ maxSeqLen: 128 });
  assert.strictEqual(tok.name, 'byte-utf8-v1');
  const sample = 'Patient\tcafé 🧬 <PII:EMAIL> & <PII:SSN>\nLine 2!';
  const enc = tok.encode(sample, 128);
  assert.strictEqual(tok.decode(enc.tokenIds), sample);
});

test('T3: structural feature slots [512..519] separate confidences, compute real ratios, and record unpadded tokenCount', () => {
  const tok = createTokenizer({ maxSeqLen: 256 });
  const plainText = 'hello';
  const plainEnc = tok.encode(plainText, 256);
  const plainFeat = extractFeatureRow({ id: 'p', text: plainText, fontStyle: 'sans_serif' }, plainEnc.tokenIds);

  assert.strictEqual(plainFeat[513], Math.fround(1.0));
  assert.strictEqual(plainFeat[514], Math.fround(1.0));
  assert.strictEqual(plainFeat[515], 0);
  assert.strictEqual(plainFeat[516], 0);
  assert.ok(plainFeat[519] > 0 && plainFeat[519] < 0.06, `Expected unpadded token ratio < 0.06, got ${plainFeat[519]}`);

  const mixedText = 'Check 123!! café';
  const mixedEnc = tok.encode(mixedText, 256);
  const mixedFeat = extractFeatureRow({
    id: 'm',
    text: mixedText,
    wordConfidences: [0.25, 0.95],
    piiItems: [{ type: 'email', value: 'a@b.co' }],
  }, mixedEnc);

  assert.strictEqual(mixedFeat[512], 1);
  assert.strictEqual(mixedFeat[513], Math.fround(0.25));
  assert.ok(Math.abs(mixedFeat[514] - 0.60) < 1e-5);
  assert.ok(mixedFeat[515] > 0, 'Punctuation/structural variance must be non-zero without hardcoded constant');
  assert.ok(mixedFeat[516] > 0, 'Non-ASCII ratio must be non-zero for café without hardcoded constant');
});

test('T3: PII scanner enforces Luhn+IIN card check, grant/kernel disambiguation, and opt-in domain configs', () => {
  // Invalid Luhn 16-digit serials must NOT trigger credit_card
  const nonCards = scanRecordsForPII('Serial 4111 2222 3333 4444 and Sample 9999 8888 7777 6666.');
  assert.strictEqual(nonCards.some((x) => x.type === 'credit_card'), false);

  // Valid Luhn Visa / MC / Amex must trigger credit_card
  for (const card of ['4532-0151-1283-0366', '5425 2334 3010 9903', '378282246310005']) {
    const hits = scanRecordsForPII(`Billing card ${card} verified.`);
    assert.ok(hits.some((x) => x.type === 'credit_card'), `Valid Luhn card not detected: ${card}`);
  }

  // Technical lookalike disambiguators remain intact
  const lookalikes = scanRecordsForPII('Grant ID 800-555-0199 running on Kernel v10.24.108.3.');
  assert.strictEqual(lookalikes.length, 0);

  // Hardcoded fixture literals are excluded by default, allowed via opt-in domainConfig
  const defaultOnly = "Patient at Guy's Campus and King's College London; reviewed by Montgomery.";
  const defaultHits = scanRecordsForPII(defaultOnly);
  assert.strictEqual(defaultHits.length, 0);

  const fixtureLine = "Review by Montgomery at Wong Tai Sin Hospital and Guy's Campus or King's College London.";
  const domainHits = scanRecordsForPII(fixtureLine, {
    domainConfig: {
      additionalPatterns: {
        name_likely: /\bMontgomery\b/g,
        address_likely: /Wong Tai Sin Hospital|Guy's Campus|King's College London/gi
      }
    }
  });
  assert.ok(domainHits.some((x) => x.value === 'Montgomery'));
  assert.ok(domainHits.some((x) => x.value === 'Wong Tai Sin Hospital'));
});
