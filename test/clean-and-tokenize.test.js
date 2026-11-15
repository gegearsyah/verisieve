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
  const piiText = 'Contact alice@example.com, phone +61 412 345 678, ssn 123-45-6789, card 4111 2222 3333 4444, ip 192.168.1.1, dob 25/12/1990, name Patient Name: John Smith, address 123 Fake St Sydney.';
  
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
