import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCleanWasm, loadCleanWasmSync } from '../src/clean-wasm.js';
import { runCleanAndTokenizePipeline } from '../src/clean-and-tokenize.js';

const WASM_PATH = path.resolve(process.cwd(), 'vendor/wasm/verisieve_clean.wasm');

test('matilda-portable loads identical verisieve_clean.wasm for boilerplate strip, dedup, and chunking', async () => {
  assert.ok(fs.existsSync(WASM_PATH), `Expected synced WASM at ${WASM_PATH}`);
  const wasmBytes = fs.readFileSync(WASM_PATH);
  const mod = await WebAssembly.compile(wasmBytes);
  assert.equal(WebAssembly.Module.imports(mod).length, 0);

  const syncEngine = loadCleanWasmSync();
  const asyncEngine = await loadCleanWasm(wasmBytes);
  assert.equal(syncEngine.abiVersion, 1);
  assert.equal(asyncEngine.abiVersion, 1);

  const html = '<nav>Skip to main content | Log in</nav><article><p>Local-first telemetry keeps patient records offline.</p></article><footer>Privacy Policy · All rights reserved</footer>';
  const cleaned = syncEngine.stripBoilerplate(html, { html: true, stripChrome: true });
  assert.ok(cleaned.includes('Local-first telemetry keeps patient records offline.'));
  assert.ok(!cleaned.includes('Skip to main content'));
  assert.ok(!cleaned.includes('All rights reserved'));

  const result = runCleanAndTokenizePipeline(
    [
      'Cookie preferences | Accept all cookies',
      'Cohort A completed ambulatory blood pressure monitoring with Dr. Sam Patel at sam.patel@clinic.org.',
      'Cohort A completed ambulatory blood pressure monitoring with Dr. Sam Patel at sam.patel@clinic.org.',
      '© 2026 Clinic Network. All rights reserved.',
    ].join('\n'),
    { format: 'text', maxSeqLen: 120, chunkByTokenWindow: true }
  );

  assert.ok(result.wasmCleanActive === true, 'Pipeline must report wasmCleanActive=true');
  assert.ok(result.blocks.length >= 1);
  assert.ok(result.blocks.every(b => !b.text.includes('sam.patel@clinic.org')));
  assert.ok(!result.blocks.some(b => /Cookie preferences|All rights reserved/i.test(b.text)));
});

import testT1 from 'node:test';
import assertT1 from 'node:assert/strict';
import fsT1 from 'node:fs';
import pathT1 from 'node:path';
import cryptoT1 from 'node:crypto';
import {
  buildEngineFromInstance as buildCleanEngineT1,
  loadCleanWasmSync as loadCleanWasmSyncT1,
} from '../src/clean-wasm.js';

testT1('T1: zero imports, ABI v1 enforcement, and strict RangeError on oversized slices', () => {
  const wasmPath = pathT1.resolve(process.cwd(), 'vendor/wasm/verisieve_clean.wasm');
  const wasmBytes = fsT1.readFileSync(wasmPath);
  const wasmMod = new WebAssembly.Module(wasmBytes);
  assertT1.equal(WebAssembly.Module.imports(wasmMod).length, 0);

  const instance = new WebAssembly.Instance(wasmMod, {});
  const engine = buildCleanEngineT1(instance);
  assertT1.equal(engine.abiVersion, 1);
  assertT1.equal(engine.dedupCap(), 2048);

  const badAbiInstance = {
    exports: {
      ...instance.exports,
      vs_clean_abi_version: () => 2,
    },
  };
  assertT1.throws(() => buildCleanEngineT1(badAbiInstance), /ABI/i);

  const oversizedText = 'word '.repeat(120_000); // > 524,288 bytes
  assertT1.throws(() => engine.dedupCheck(oversizedText, 0.8), RangeError);
  assertT1.throws(() => engine.writeInputBytes(new Uint8Array(engine.inCap + 1)), RangeError);
  const splitChunks = engine.chunkByTokenWindow('€'.repeat(200_000), { maxTokens: 64, overlapTokens: 8 });
  assertT1.ok(splitChunks.length > 10);
  assertT1.ok(splitChunks.every((c) => !c.text.includes('\uFFFD')));
});

testT1('T1: HTML strips quoted/commented script/style, decodes UTF-8 entities, and splits oversized HTML on UTF-8 boundaries', () => {
  const engine = loadCleanWasmSyncT1();
  const payload =
    '<div>Before &#x2019; &#8364; &#x1F600;&nbsp;end</div>' +
    '<script>const x = "</script>"; const y = `</script>`; /* </script> */ secretFn();</script>' +
    '<style>/* </style> */ .a { content: "</style>"; }</style>' +
    '<p>SSN 123-45-6789 | CC 4111-2222-3333-4444 | Alice</p>' +
    '<p>Home | Docs | Pricing</p>';
  const cleaned = engine.stripBoilerplate(payload, { html: true, chrome: true });
  assertT1.ok(cleaned.includes('Before \u2019 \u20ac \u{1F600} end'), `unexpected: ${cleaned}`);
  assertT1.ok(!cleaned.includes('secretFn'), `leaked script: ${cleaned}`);
  assertT1.ok(!cleaned.includes('content:'), `leaked style: ${cleaned}`);
  assertT1.ok(cleaned.includes('SSN 123-45-6789 | CC 4111-2222-3333-4444 | Alice'), `dropped PII: ${cleaned}`);
  assertT1.ok(!cleaned.includes('Home | Docs | Pricing'), `kept chrome: ${cleaned}`);

  // Oversized multi-byte HTML > 524,288 bytes
  const unit = '<p>€ Clinical observation delta. </p>';
  const bigHtml = '<html><body>' + unit.repeat(16_000) + '</body></html>';
  assertT1.ok(Buffer.byteLength(bigHtml, 'utf8') > 524_288);
  const bigClean = engine.stripBoilerplate(bigHtml, { html: true, chrome: false });
  assertT1.ok(!bigClean.includes('\uFFFD'), 'corrupted UTF-8 across split boundary');
  assertT1.ok(bigClean.includes('€ Clinical observation delta.'));
});

testT1('T1: dedup ring tracks overflow and eviction count accurately', () => {
  const engine = loadCleanWasmSyncT1();
  engine.dedupReset();
  const cap = engine.dedupCap();
  assertT1.equal(cap, 2048);
  assertT1.equal(engine.dedupOverflowed(), false);
  assertT1.equal(engine.dedupEvicted(), 0);

  for (let i = 0; i < cap + 3; i += 1) {
    let x = BigInt(i + 1) * 0x9e3779b97f4a7c15n;
    const words = [];
    for (let w = 0; w < 8; w += 1) {
      x = BigInt.asUintN(64, (x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n);
      x = BigInt.asUintN(64, (x ^ (x >> 27n)) * 0x94d049bb133111ebn);
      x ^= x >> 31n;
      words.push(x.toString(36));
    }
    const res = engine.dedupCheck(words.join(' '), 0.95);
    assertT1.equal(res.code, 0);
    assertT1.equal(res.action, 'keep');
  }
  assertT1.equal(engine.dedupCount(), cap);
  assertT1.equal(engine.dedupOverflowed(), true);
  assertT1.equal(engine.dedupEvicted(), 3);
});

testT1('T1: vendor verisieve_clean.wasm matches Rtio frontend public wasm byte-for-byte', () => {
  const localWasm = pathT1.resolve(process.cwd(), 'vendor/wasm/verisieve_clean.wasm');
  const rtioWasm = pathT1.resolve(process.cwd(), '../Rtio/frontend/public/wasm/verisieve_clean.wasm');
  assertT1.ok(fsT1.existsSync(rtioWasm), `missing sibling wasm at ${rtioWasm}`);
  const h1 = cryptoT1.createHash('sha256').update(fsT1.readFileSync(localWasm)).digest('hex');
  const h2 = cryptoT1.createHash('sha256').update(fsT1.readFileSync(rtioWasm)).digest('hex');
  assertT1.equal(h1, h2);
});
