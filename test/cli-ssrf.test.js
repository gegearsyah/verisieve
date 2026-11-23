import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import {
  isDisallowedIpAddress,
  validatePublicUrlTarget,
  assertSafePublicUrl,
  stripHtmlBoilerplate,
  ingestUrl,
  ingestLinkList,
} from '../src/ingestor.js';
import { ingestFromUrlOrPath } from '../src/pdf-image-pipeline.js';
import {
  handleJsonRpcRequest,
  handleJsonRpcRequestAsync,
} from '../src/mcp-server.js';
import { encodePNG } from '../src/multi-font-fixture.js';

function generateMinimalPdfBuffer(lines) {
  const escaped = lines.map((l) => l.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'));
  const streamOps = escaped.map((l, idx) => `BT /F1 12 Tf 72 ${720 - idx * 18} Td (${l}) Tj ET`).join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
    `4 0 obj << /Length ${Buffer.byteLength(streamOps, 'utf8')} >>\nstream\n${streamOps}\nendstream\nendobj\n`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function makeTempDir(prefix = 'verisieve-t5-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function buildMinimalDocxBuffer(paragraphText) {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${paragraphText}</w:t></w:r></w:p>
  </w:body>
</w:document>`;
  const nameBuf = Buffer.from('word/document.xml', 'utf8');
  const dataBuf = zlib.deflateRawSync(Buffer.from(xml, 'utf8'));
  const uncompSize = Buffer.byteLength(xml, 'utf8');

  const lfh = Buffer.alloc(30 + nameBuf.length);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(0, 6);
  lfh.writeUInt16LE(8, 8);
  lfh.writeUInt32LE(dataBuf.length, 18);
  lfh.writeUInt32LE(uncompSize, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(lfh, 30);

  const cdOffset = lfh.length + dataBuf.length;
  const cd = Buffer.alloc(46 + nameBuf.length);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(dataBuf.length, 20);
  cd.writeUInt32LE(uncompSize, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(0, 42);
  nameBuf.copy(cd, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([lfh, dataBuf, cd, eocd]);
}

test('T5: stripHtmlBoilerplate and ingestUrl return normalized cleanText consistently', async () => {
  const html = `<html><head><title>Clinical Note</title><style>.hidden{display:none}</style><script>alert(1)</script></head><body><h1>Rehabilitation Outcomes</h1><p>Early mobilization improves recovery after hip fracture surgery.</p></body></html>`;
  const stripped = stripHtmlBoilerplate(html, { url: 'https://example.org/clinical' });
  assert.equal(typeof stripped.cleanText, 'string');
  assert.ok(stripped.cleanText.includes('Early mobilization improves recovery'));
  assert.ok(!stripped.cleanText.includes('alert(1)'));
  assert.equal(stripped.cleanText, stripped.lines.join('\n'));

  const fetched = await ingestUrl('https://example.org/clinical', {
    lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchFn: async () =>
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
  });
  assert.equal(typeof fetched.cleanText, 'string');
  assert.ok(fetched.cleanText.includes('Rehabilitation Outcomes'));
  assert.equal(fetched.url, 'https://example.org/clinical');
});

test('T5: SSRF validation blocks private/IMDS/loopback IPs, private DNS, credentials, redirect hops, and oversized responses', async () => {
  assert.equal(isDisallowedIpAddress('127.0.0.1'), true);
  assert.equal(isDisallowedIpAddress('10.20.30.40'), true);
  assert.equal(isDisallowedIpAddress('172.16.5.4'), true);
  assert.equal(isDisallowedIpAddress('192.168.1.10'), true);
  assert.equal(isDisallowedIpAddress('100.64.0.1'), true);
  assert.equal(isDisallowedIpAddress('169.254.169.254'), true);
  assert.equal(isDisallowedIpAddress('::1'), true);
  assert.equal(isDisallowedIpAddress('::ffff:127.0.0.1'), true);
  assert.equal(isDisallowedIpAddress('fc00::1'), true);
  assert.equal(isDisallowedIpAddress('fe80::1'), true);
  assert.equal(isDisallowedIpAddress('93.184.216.34'), false);

  const blockedUrls = [
    'file:///etc/passwd',
    'https://user:secret@example.com/private',
    'http://127.0.0.1:8080/admin',
    'http://localhost:3000/api',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/internal',
    'http://172.16.0.9/internal',
    'http://192.168.0.1/router',
    'http://100.64.1.2/cgnat',
    'http://[::1]/secret',
    'http://[::ffff:169.254.169.254]/meta',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://singlelabel/',
  ];
  for (const target of blockedUrls) {
    assert.throws(() => validatePublicUrlTarget(target), /URL_SSRF_BLOCKED|Blocked|Invalid protocol/i);
    await assert.rejects(() => ingestUrl(target), /URL_SSRF_BLOCKED|Blocked|Invalid protocol/i);
    await assert.rejects(() => ingestFromUrlOrPath(target), /URL_SSRF_BLOCKED|Blocked|Invalid protocol/i);
  }

  // DNS rebinding to private IP
  await assert.rejects(
    () =>
      assertSafePublicUrl('https://rebind.example.org/doc', {
        lookupFn: async () => [{ address: '169.254.169.254', family: 4 }],
      }),
    /URL_SSRF_BLOCKED/i
  );

  // Redirect hop into IMDS metadata endpoint
  await assert.rejects(
    () =>
      ingestUrl('https://public.example.org/start', {
        lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
        fetchFn: async () =>
          new Response('', {
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data/' },
          }),
      }),
    /URL_SSRF_BLOCKED|Blocked/i
  );

  // Unbounded redirect chain
  let hops = 0;
  await assert.rejects(
    () =>
      ingestUrl('https://public.example.org/loop', {
        maxRedirects: 2,
        lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
        fetchFn: async () => {
          hops += 1;
          return new Response('', {
            status: 302,
            headers: { location: `https://public.example.org/loop?n=${hops}` },
          });
        },
      }),
    /URL_REDIRECT_LIMIT/i
  );

  // Oversized streaming response
  const bigHtml = '<html><body><p>' + 'A'.repeat(2048) + '</p></body></html>';
  await assert.rejects(
    () =>
      ingestUrl('https://public.example.org/big', {
        maxBytes: 256,
        lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
        fetchFn: async () => new Response(bigHtml, { status: 200 }),
      }),
    /URL_RESPONSE_TOO_LARGE/i
  );

  // Unreachable URL fails with typed URL_FETCH_FAILED instead of substituting a local sample file
  await assert.rejects(
    () =>
      ingestFromUrlOrPath('https://unreachable.example.org/doc', {
        lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
        fetchFn: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
    /URL_FETCH_FAILED/i
  );

  // Real loopback server redirect & size cap test when allowPrivateNetworkForTest is opted in
  const srv = http.createServer((req, res) => {
    if (req.url === '/redir') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><p>Public test payload</p></body></html>');
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    const port = srv.address().port;
    await assert.rejects(
      () => ingestUrl(`http://127.0.0.1:${port}/redir`, { allowPrivateNetworkForTest: true }),
      /URL_SSRF_BLOCKED|Blocked/i
    );
  } finally {
    srv.close();
  }
});

test('T5: CLI implements audit-wasm (all binaries), honest run status, binary-safe ingest, train, and decide', () => {
  const cliPath = path.resolve('bin/verisieve.mjs');
  const tmpDir = makeTempDir();
  try {
    // 1. multi-binary audit-wasm
    const auditOut = execFileSync(process.execPath, [cliPath, 'audit-wasm'], { encoding: 'utf8' });
    const auditJson = JSON.parse(auditOut);
    assert.equal(auditJson.allVerified, true);
    assert.equal(auditJson.binaries.cactus.zeroEgressVerified, true);
    assert.equal(auditJson.binaries.verisieve_clean.zeroEgressVerified, true);
    assert.equal(auditJson.binaries.verisieve_dl.zeroEgressVerified, true);

    // 2. CLI audit-wasm fails exit 1 on tampered WASM with host imports
    const evilWasm = path.join(tmpDir, 'evil.wasm');
    // Minimal valid WASM module importing env.exfil: () -> ()
    fs.writeFileSync(
      evilWasm,
      Buffer.from([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
        0x02, 0x0d, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x05, 0x65, 0x78, 0x66, 0x69, 0x6c, 0x00, 0x00,
      ])
    );
    assert.throws(
      () => execFileSync(process.execPath, [cliPath, 'audit-wasm', evilWasm], { encoding: 'utf8', stdio: 'pipe' }),
      (err) => err.status === 1
    );

    // 3. CLI ingest binary PDF + DOCX + uses local OCR on PNG without Cactus weights
    const pdfPath = path.join(tmpDir, 'sample.pdf');
    fs.writeFileSync(
      pdfPath,
      generateMinimalPdfBuffer(['Clinical note: Early mobilization improves patient recovery.'])
    );
    const pdfIngestOut = execFileSync(process.execPath, [cliPath, 'ingest', pdfPath], { encoding: 'utf8' });
    const pdfIngest = JSON.parse(pdfIngestOut);
    assert.ok(JSON.stringify(pdfIngest).includes('Early mobilization'));

    const docxPath = path.join(tmpDir, 'sample.docx');
    fs.writeFileSync(docxPath, buildMinimalDocxBuffer('DOCX protocol adherence improved outcomes.'));
    const docxIngestOut = execFileSync(process.execPath, [cliPath, 'ingest', docxPath], { encoding: 'utf8' });
    const docxIngest = JSON.parse(docxIngestOut);
    assert.ok(JSON.stringify(docxIngest).includes('DOCX protocol adherence'));

    const pngPath = path.join(tmpDir, 'scan.png');
    fs.writeFileSync(pngPath, encodePNG(4, 4, new Uint8Array(4 * 4 * 3)));
    assert.throws(
      () => execFileSync(process.execPath, [cliPath, 'ingest', pngPath], { encoding: 'utf8', stdio: 'pipe' }),
      (err) => err.status === 1 && /IMAGE_OCR_NO_TEXT/i.test(String(err.stderr || err.stdout))
    );

    // 4. CLI run reports FAIL_CLOSED_UNVERIFIED honestly on small corpus (<59 null calibration points)
    const tinyTxt = path.join(tmpDir, 'tiny.txt');
    fs.writeFileSync(tinyTxt, 'Early rehabilitation protocol.\nPatient John Doe SSN 232-00-9812.\nFollow-up note.');
    const runOut = execFileSync(process.execPath, [cliPath, 'run', tinyTxt], { encoding: 'utf8' });
    assert.match(runOut, /FAIL_CLOSED_UNVERIFIED/);
    assert.doesNotMatch(runOut, /Conformal Status:\s+CERTIFIED/);

    // 5. CLI train & decide with >=59 disjoint calibration negatives (260 rows -> 130 cal -> 65 negatives)
    const rows = [];
    for (let i = 0; i < 260; i++) {
      const isSafe = i % 2 === 0;
      rows.push({
        label: isSafe ? 1 : 0,
        text: isSafe
          ? `Clinical trial cohort ${i} reported improved mobility and functional outcome scores.`
          : `CONFIDENTIAL Patient John Doe ${i} SSN 232-00-${String(1000 + i).padStart(4, '0')} fax 555-01${String(i % 100).padStart(2, '0')}`,
      });
    }
    const datasetPath = path.join(tmpDir, 'dataset.jsonl');
    fs.writeFileSync(datasetPath, rows.map((r) => JSON.stringify(r)).join('\n'));
    const bundlePath = path.join(tmpDir, 'bundle.json');
    const trainOut = execFileSync(
      process.execPath,
      [cliPath, 'train', '--input', datasetPath, '--out', bundlePath, '--alpha', '0.05', '--epochs', '25'],
      { encoding: 'utf8' }
    );
    const trainSummary = JSON.parse(trainOut);
    assert.equal(fs.existsSync(bundlePath), true);
    assert.equal(trainSummary.certified, true);
    assert.equal(trainSummary.gatekeeperStatus, 'CERTIFIED');

    const decideOut = execFileSync(
      process.execPath,
      [cliPath, 'decide', '--bundle', bundlePath, '--text', 'CONFIDENTIAL Patient Evelyn Vance SSN 232-00-9812'],
      { encoding: 'utf8' }
    );
    const decision = JSON.parse(decideOut);
    assert.equal(decision.certified, true);
    assert.equal(decision.piiDetected, true);
    assert.ok(['DROP_OR_QUARANTINE', 'ABSTAIN_HUMAN_REVIEW', 'KEEP_SAFE'].includes(decision.action));
    assert.ok(!JSON.stringify(decision).includes('232-00-9812'), 'CLI decide must not echo raw SSN by default');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ingestFromUrlOrPath parses HTML saved with a .pdf extension', async () => {
  const tmpDir = makeTempDir();
  try {
    const mislabeledPath = path.join(tmpDir, 'compliance-guide.pdf');
    fs.writeFileSync(
      mislabeledPath,
      '<!doctype html><html><head><title>Compliance guide</title></head><body><p>The retention period for compliance records is seven years.</p></body></html>'
    );

    const result = await ingestFromUrlOrPath(mislabeledPath);
    assert.ok(
      result.rows.some((row) => row.raw_excerpt?.includes('retention period for compliance records')),
      'HTML text should be ingested instead of sent to the PDF parser'
    );

    const cliResult = JSON.parse(
      execFileSync(
        process.execPath,
        [path.resolve('bin/verisieve.mjs'), 'ingest', mislabeledPath],
        { encoding: 'utf8' }
      )
    );
    assert.equal(cliResult.sourceType, 'html');
    assert.ok(cliResult.cleanText.includes('retention period for compliance records'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('T5: MCP ingest_url_or_links, privacy-safe gatekeeper_decide, and holdout multi-axis calibration with PII scanning', async () => {
  // 1. ingest_url_or_links SSRF rejection
  const ssrfRes = await handleJsonRpcRequestAsync({
    jsonrpc: '2.0',
    id: 501,
    method: 'tools/call',
    params: {
      name: 'ingest_url_or_links',
      arguments: { url: 'http://169.254.169.254/latest/meta-data/' },
    },
  });
  assert.ok(ssrfRes.error || JSON.parse(ssrfRes.result.content[0].text).fetched?.[0]?.success === false);
  const ssrfMsg = ssrfRes.error ? ssrfRes.error.message : JSON.stringify(ssrfRes.result);
  assert.match(ssrfMsg, /URL_SSRF_BLOCKED|Blocked/i);

  // 2. ingest_url_or_links cleanText propagation via inline links + injectable options or HTML
  const htmlIngest = await handleJsonRpcRequestAsync({
    jsonrpc: '2.0',
    id: 502,
    method: 'tools/call',
    params: {
      name: 'ingest_url_or_links',
      arguments: {
        htmlOrLinks: '<html><body><p>Clinical outcome summary without boilerplate.</p></body></html>',
      },
    },
  });
  const htmlPayload = JSON.parse(htmlIngest.result.content[0].text);
  assert.ok(typeof htmlPayload.cleanText === 'string' && htmlPayload.cleanText.includes('Clinical outcome summary'));
  assert.ok(Array.isArray(htmlPayload.blocks) && htmlPayload.blocks[0].text.includes('Clinical outcome summary'));
  assert.ok(Array.isArray(htmlPayload.tokenizedChunks) && htmlPayload.tokenizedChunks[0].tokenCount > 0);

  // 2b. ingest_url_or_links async URL path propagates cleanText into pipeline and manifest
  const urlMcpRes = await handleJsonRpcRequestAsync({
    jsonrpc: '2.0',
    id: 5021,
    method: 'tools/call',
    params: {
      name: 'ingest_url_or_links',
      arguments: {
        url: 'https://example.org/mcp-article',
        options: {
          lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
          fetchFn: async () =>
            new Response('<html><body><p>Verified clinical trial findings on mobility recovery.</p></body></html>', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            }),
        },
      },
    },
  });
  const urlMcpPayload = JSON.parse(urlMcpRes.result.content[0].text);
  assert.ok(urlMcpPayload.cleanText.includes('Verified clinical trial findings'));
  assert.ok(urlMcpPayload.blocks[0].text.includes('Verified clinical trial findings'));
  assert.ok(urlMcpPayload.manifest.aggregate.totalChunksExtracted > 0);

  // 3. gatekeeper_decide omits raw textExcerpt and redacts raw PII values unless opted in
  const batchDecide = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 503,
    method: 'tools/call',
    params: {
      name: 'gatekeeper_decide',
      arguments: {
        texts: [
          'Patient Evelyn Vance DOB 03/12/1944 SSN 232-00-9812 admitted yesterday.',
          'Early mobilization improves hospital discharge mobility.',
        ],
      },
    },
  });
  const batchJsonText = batchDecide.result.content[0].text;
  assert.ok(!batchJsonText.includes('232-00-9812'), 'raw SSN must not leak in MCP response');
  assert.ok(!batchJsonText.includes('Evelyn Vance'), 'raw name must not leak in MCP response');
  const parsedBatch = JSON.parse(batchJsonText);
  assert.equal(parsedBatch.decisions[0].textExcerpt, undefined);
  assert.equal(parsedBatch.decisions[0].piiDetected, true);

  // Opt-in includeRawExcerpt explicitly allowed when requested (masked still safe or present)
  const optInDecide = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 504,
    method: 'tools/call',
    params: {
      name: 'gatekeeper_decide',
      arguments: {
        includeRawExcerpt: true,
        texts: ['Early mobilization improves hospital discharge mobility.'],
      },
    },
  });
  const parsedOptIn = JSON.parse(optInDecide.result.content[0].text);
  assert.ok(parsedOptIn.decisions[0].textExcerpt.includes('Early mobilization'));

  // 4. train_multiaxis_gatekeeper with < 59 negative holdout samples avoids false certification
  const samples = [];
  for (let i = 0; i < 16; i++) {
    samples.push({
      text: i % 2 === 0
        ? `Clinical study cohort ${i} with clean outcomes.`
        : `CONFIDENTIAL Patient John Doe ${i} SSN 232-00-${1000 + i}`,
      safe: i % 2 === 0,
      useful: i % 2 === 0,
      topic: i % 2 === 0,
    });
  }
  const multiTrain = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 505,
    method: 'tools/call',
    params: {
      name: 'train_multiaxis_gatekeeper',
      arguments: { samples },
    },
  });
  const multiBundle = JSON.parse(multiTrain.result.content[0].text);
  assert.equal(multiBundle.models.safe.calibration.certified, false);
  assert.equal(multiBundle.models.useful.calibration.certified, false);
  assert.equal(multiBundle.models.topic.calibration.certified, false);
  assert.equal(multiBundle.gatekeeperStatus, 'FAIL_CLOSED_UNVERIFIED');

  const multiDecide = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 506,
    method: 'tools/call',
    params: {
      name: 'gatekeeper_decide_multiaxis',
      arguments: {
        bundle: multiBundle,
        text: 'Patient Evelyn Vance SSN 232-00-9812 confidential note',
      },
    },
  });
  const multiDecidePayload = JSON.parse(multiDecide.result.content[0].text);
  assert.equal(multiDecidePayload.piiDetected, true);
  assert.equal(multiDecidePayload.gatekeeperStatus, 'FAIL_CLOSED_UNVERIFIED');
  assert.equal(multiDecidePayload.abstained, true);

  // 5. Certified multi-axis calibration when all 3 axes have >= 59 holdout negative samples
  const largeSamples = [];
  for (let i = 0; i < 260; i++) {
    const safe = i % 2 === 0;
    largeSamples.push({
      text: safe
        ? `Clinical outcome cohort ${i} shows improved mobility scores.`
        : `CONFIDENTIAL Patient John Doe ${i} SSN 232-00-${String(1000 + i).padStart(4, '0')}`,
      safe,
      useful: safe,
      topic: safe,
    });
  }
  const certTrain = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 507,
    method: 'tools/call',
    params: {
      name: 'train_multiaxis_gatekeeper',
      arguments: { samples: largeSamples, options: { epochs: 25 } },
    },
  });
  const certBundle = JSON.parse(certTrain.result.content[0].text);
  assert.equal(certBundle.models.safe.calibration.certified, true);
  assert.equal(certBundle.gatekeeperStatus, 'CERTIFIED');
});
