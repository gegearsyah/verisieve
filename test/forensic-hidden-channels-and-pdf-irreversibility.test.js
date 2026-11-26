/**
 * test/forensic-hidden-channels-and-pdf-irreversibility.test.js
 * External-behavior TDD suite for Issue #30 (T3):
 *  1. Failed PDF redaction detection (text under opaque vector rectangle overlays)
 *  2. PDF incremental revision history leak detection (multiple %%EOF / startxref)
 *  3. Invisible text forensics across PDF (3 Tr, white-on-white, tiny font, off-page) & DOCX (white text, w:vanish, tiny w:sz)
 *  4. Recursive nested attachment scanning across EML/MSG/ZIP with bounded maxDepth & zip-bomb/zip-slip fail-closed guards
 *  5. Mandatory post-redaction PDF irreversibility verification pass (fails loudly on pseudo-redaction, passes with 0 residual on genuinely scrubbed PDF)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import {
  extractPdfDetailed,
  verifyPdfRedactionIrreversibility,
  redactPdfBuffer,
} from '../src/pdf-parser.js';
import {
  verifyPdfRedactionIrreversibility as pipelineVerifyPdfIrreversibility,
  redactPdfBuffer as pipelineRedactPdfBuffer,
  sanitizePdfBuffer,
  generateResearchPdfAndImage,
} from '../src/pdf-image-pipeline.js';
import { parseEnterpriseBuffer, extractDocxForensic } from '../src/enterprise-parsers.js';

// ---------------------------------------------------------------------------
// Minimal valid binary builders (PDF 1.4/1.5, incremental PDF, ZIP/DOCX, EML, CFBF MSG)
// ---------------------------------------------------------------------------

function buildPdf(objects, { header = '%PDF-1.4\n' } = {}) {
  let out = Buffer.from(header, 'latin1');
  const offsets = [0];
  for (let idx = 0; idx < objects.length; idx += 1) {
    offsets.push(out.length);
    const body = Buffer.isBuffer(objects[idx]) ? objects[idx] : Buffer.from(objects[idx], 'latin1');
    out = Buffer.concat([out, Buffer.from(`${idx + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
  }
  const xrefOff = out.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`;
  return {
    buffer: Buffer.concat([out, Buffer.from(xref, 'latin1')]),
    xrefOff,
    size: objects.length + 1,
  };
}

function buildSinglePagePdf(contentStream, { mediaBox = '[0 0 612 792]', compress = false } = {}) {
  const raw = Buffer.from(contentStream, 'latin1');
  const streamObj = compress
    ? Buffer.concat([
        Buffer.from(`<< /Length ${zlib.deflateSync(raw).length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
        zlib.deflateSync(raw),
        Buffer.from('\nendstream', 'latin1'),
      ])
    : `<< /Length ${raw.length} >>\nstream\n${contentStream}\nendstream`;

  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox ${mediaBox} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    streamObj,
  ]);
}

function appendIncrementalPdfUpdate(basePdf, updatedObjNum, updatedBodyStr) {
  const startOff = basePdf.buffer.length;
  const objBytes = Buffer.from(`${updatedObjNum} 0 obj\n${updatedBodyStr}\nendobj\n`, 'latin1');
  const xrefOff = startOff + objBytes.length;
  const newSize = Math.max(basePdf.size, updatedObjNum + 1);
  const xref =
    `xref\n${updatedObjNum} 1\n${String(startOff).padStart(10, '0')} 00000 n \n` +
    `trailer\n<< /Size ${newSize} /Root 1 0 R /Prev ${basePdf.xrefOff} >>\n` +
    `startxref\n${xrefOff}\n%%EOF\n`;
  return {
    buffer: Buffer.concat([basePdf.buffer, objBytes, Buffer.from(xref, 'latin1')]),
    xrefOff,
    size: newSize,
  };
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZipBuffer(entries, { useDeflate = true } = {}) {
  const localParts = [];
  const cdParts = [];
  let offset = 0;

  for (const { name, content } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(raw);
    const data = useDeflate ? zlib.deflateRawSync(raw) : raw;
    const method = useDeflate ? 8 : 0;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(data.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);

    localParts.push(lfh, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    cdParts.push(cd, nameBuf);

    offset += lfh.length + nameBuf.length + data.length;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

function buildEmlWithAttachment({ from = 'sender@acme.com', to = 'legal@acme.com', subject = 'Test', body = 'Hello', attachmentName, attachmentMime = 'application/octet-stream', attachmentBytes, boundary = 'BND_TEST_01' }) {
  const b64 = Buffer.from(attachmentBytes).toString('base64');
  return Buffer.from(
    [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
      `--${boundary}`,
      `Content-Type: ${attachmentMime}; name="${attachmentName}"`,
      `Content-Disposition: attachment; filename="${attachmentName}"`,
      'Content-Transfer-Encoding: base64',
      '',
      b64,
      `--${boundary}--`,
      '',
    ].join('\r\n'),
    'utf8'
  );
}

function buildMinimalOutlookMsg({ subject, sender, body, attachmentName, attachmentBytes }) {
  const SECTOR = 512;
  const encodeUtf16 = (s) => Buffer.from(s + '\0', 'utf16le');
  const streams = [
    { name: '__substg1.0_0037001F', data: encodeUtf16(subject) },
    { name: '__substg1.0_0C1F001F', data: encodeUtf16(sender) },
    { name: '__substg1.0_1000001F', data: encodeUtf16(body) },
  ];
  const attStreams = attachmentName
    ? [
        { name: '__substg1.0_3707001F', data: encodeUtf16(attachmentName) },
        { name: '__substg1.0_37010102', data: Buffer.from(attachmentBytes) },
      ]
    : [];

  const fat = new Uint32Array(128).fill(0xffffffff);
  fat[0] = 0xfffffffd;
  fat[1] = 2;
  fat[2] = 0xfffffffe;
  let nextSec = 3;
  const dataSectors = [];
  const allocStream = (buf) => {
    const start = nextSec;
    const count = Math.max(1, Math.ceil(buf.length / SECTOR));
    for (let i = 0; i < count; i += 1) {
      const sec = Buffer.alloc(SECTOR);
      buf.copy(sec, 0, i * SECTOR, Math.min(buf.length, (i + 1) * SECTOR));
      dataSectors.push(sec);
      fat[nextSec] = i === count - 1 ? 0xfffffffe : nextSec + 1;
      nextSec += 1;
    }
    return start;
  };
  const makeDir = (name, objType, left, right, child, startSec, size) => {
    const d = Buffer.alloc(128);
    const nb = Buffer.from(name + '\0', 'utf16le');
    nb.copy(d, 0, 0, Math.min(64, nb.length));
    d.writeUInt16LE(Math.min(64, nb.length), 64);
    d[66] = objType;
    d[67] = 1;
    d.writeUInt32LE(left >>> 0, 68);
    d.writeUInt32LE(right >>> 0, 72);
    d.writeUInt32LE(child >>> 0, 76);
    d.writeUInt32LE(startSec >>> 0, 116);
    d.writeUInt32LE(size >>> 0, 120);
    return d;
  };

  const NO = 0xffffffff;
  const s0 = allocStream(streams[0].data);
  const s1 = allocStream(streams[1].data);
  const s2 = allocStream(streams[2].data);

  const dirs = [
    makeDir('Root Entry', 5, NO, NO, 1, 0xfffffffe, 0),
    makeDir(streams[0].name, 2, NO, 2, NO, s0, streams[0].data.length),
    makeDir(streams[1].name, 2, NO, 3, NO, s1, streams[1].data.length),
    makeDir(streams[2].name, 2, NO, attStreams.length ? 4 : NO, NO, s2, streams[2].data.length),
  ];
  if (attStreams.length) {
    const a0 = allocStream(attStreams[0].data);
    const a1 = allocStream(attStreams[1].data);
    dirs.push(makeDir('__attach_version1.0_#00000000', 1, NO, NO, 5, 0xfffffffe, 0));
    dirs.push(makeDir(attStreams[0].name, 2, NO, 6, NO, a0, attStreams[0].data.length));
    dirs.push(makeDir(attStreams[1].name, 2, NO, NO, NO, a1, attStreams[1].data.length));
  }
  while (dirs.length < 8) dirs.push(Buffer.alloc(128));

  const hdr = Buffer.alloc(SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(hdr, 0);
  hdr.writeUInt16LE(0x003e, 24);
  hdr.writeUInt16LE(0x0003, 26);
  hdr.writeUInt16LE(0xfffe, 28);
  hdr.writeUInt16LE(9, 30);
  hdr.writeUInt16LE(6, 32);
  hdr.writeUInt32LE(1, 44);
  hdr.writeUInt32LE(1, 48);
  hdr.writeUInt32LE(0, 56);
  hdr.writeUInt32LE(0xfffffffe, 60);
  hdr.writeUInt32LE(0, 64);
  hdr.writeUInt32LE(0xfffffffe, 68);
  hdr.writeUInt32LE(0, 72);
  for (let i = 0; i < 109; i += 1) hdr.writeUInt32LE(i === 0 ? 0 : 0xffffffff, 76 + i * 4);

  return Buffer.concat([hdr, Buffer.from(fat.buffer, fat.byteOffset, fat.byteLength), ...dirs, ...dataSectors]);
}

// ---------------------------------------------------------------------------
// 1. Failed-Redaction Detection (Text Under Opaque Overlays)
// ---------------------------------------------------------------------------

test('T3.1: Detects failed PDF redactions where extractable text sits underneath an opaque filled rectangle overlay', () => {
  const content = [
    'BT /F1 12 Tf 0 0 0 rg 1 0 0 1 72 720 Tm (Public Summary: Quarterly Audit) Tj ET',
    'BT /F1 12 Tf 0 0 0 rg 1 0 0 1 72 680 Tm (Secret SSN: 123-45-6789) Tj ET',
    // Pseudo-redaction: black filled rectangle drawn directly over the secret line
    '0 0 0 rg 68 674 180 18 re f',
    // CMYK black filled rectangle via B operator over another secret line
    'BT /F1 12 Tf 0 g 1 0 0 1 72 640 Tm (Account: 9876-5432-1098) Tj ET',
    '0 0 0 1 k 68 634 190 18 re B',
  ].join('\n');

  const { buffer } = buildSinglePagePdf(content);
  const diag = extractPdfDetailed(buffer);

  assert.ok(Array.isArray(diag.forensicFindings), 'extractPdfDetailed must expose forensicFindings array');
  const overlayFindings = diag.forensicFindings.filter((f) => f.code === 'PDF_TEXT_UNDER_OPAQUE_OVERLAY');
  assert.equal(overlayFindings.length, 2, `Expected 2 overlay findings, got ${overlayFindings.length}`);

  const ssnFinding = overlayFindings.find((f) => f.textSnippet.includes('123-45-6789'));
  assert.ok(ssnFinding, 'Must flag SSN line covered by black filled rectangle');
  assert.equal(ssnFinding.page, 1);
  assert.ok(ssnFinding.coveredTextLength >= 20);
  assert.ok(ssnFinding.bbox && typeof ssnFinding.bbox.x === 'number' && ssnFinding.bbox.w > 0);
  assert.ok(ssnFinding.overlayBbox && ssnFinding.overlayBbox.x === 68 && ssnFinding.overlayBbox.w === 180);

  const acctFinding = overlayFindings.find((f) => f.textSnippet.includes('9876-5432-1098'));
  assert.ok(acctFinding, 'Must flag CMYK black B-filled overlay too');

  // Benign white text drawn AFTER a dark banner header must NOT false-positive as failed redaction
  const benignContent = [
    '0 0 0 rg 50 740 400 24 re f',
    'BT /F1 14 Tf 1 1 1 rg 1 0 0 1 60 748 Tm (ACME CORPORATE REPORT) Tj ET',
  ].join('\n');
  const benignDiag = extractPdfDetailed(buildSinglePagePdf(benignContent).buffer);
  assert.equal(
    benignDiag.forensicFindings.filter((f) => f.code === 'PDF_TEXT_UNDER_OPAQUE_OVERLAY').length,
    0,
    'High-contrast white text over pre-drawn dark banner must not false-positive'
  );
  assert.equal(
    benignDiag.forensicFindings.filter((f) => f.code === 'INVISIBLE_WHITE_ON_WHITE_TEXT').length,
    0,
    'White text over dark banner must not false-positive as white-on-white'
  );
});

// ---------------------------------------------------------------------------
// 2. PDF Incremental Revision History Inspection
// ---------------------------------------------------------------------------

test('T3.2: Detects leaked sensitive strings retained in earlier PDF incremental update revisions (%%EOF #1 vs #2)', () => {
  const rev1Stream = 'BT /F1 12 Tf 1 0 0 1 72 720 Tm (Confidential Witness: Elena Vance SSN 123-45-6789) Tj ET';
  const rev1 = buildSinglePagePdf(rev1Stream);

  const rev2Stream = 'BT /F1 12 Tf 1 0 0 1 72 720 Tm (Confidential Witness: [REDACTED]) Tj ET';
  const rev2Obj5 = `<< /Length ${Buffer.byteLength(rev2Stream, 'latin1')} >>\nstream\n${rev2Stream}\nendstream`;
  const rev2 = appendIncrementalPdfUpdate(rev1, 5, rev2Obj5);

  const diag = extractPdfDetailed(rev2.buffer);
  assert.equal(diag.revisionCount, 2, 'Must detect 2 %%EOF revisions');
  assert.ok(diag.lines.join('\n').includes('[REDACTED]'), 'Latest revision text must be extracted');
  assert.ok(!diag.lines.join('\n').includes('123-45-6789'), 'Latest revision lines should reflect rev 2');

  const revLeaks = diag.forensicFindings.filter((f) => f.code === 'PDF_INCREMENTAL_REVISION_LEAK');
  assert.equal(revLeaks.length, 1, 'Must emit PDF_INCREMENTAL_REVISION_LEAK finding');
  assert.equal(revLeaks[0].revisionCount, 2);
  assert.ok(
    revLeaks[0].residualStrings.some((s) => s.includes('Elena Vance') && s.includes('123-45-6789')),
    'Must report historical residual string from earlier revision'
  );
});

// ---------------------------------------------------------------------------
// 3. Invisible Text Forensics (PDF & DOCX)
// ---------------------------------------------------------------------------

test('T3.3A: Detects all 4 PDF invisible-text channels (3 Tr, white-on-white, tiny font, off-page coordinates)', () => {
  const content = [
    'BT /F1 12 Tf 0 0 0 rg 1 0 0 1 72 740 Tm (Visible Clinical Note) Tj ET',
    // 1) Rendering mode 3 (invisible text)
    'BT /F1 12 Tf 3 Tr 1 0 0 1 72 710 Tm (Hidden Mode 3 Prompt Injection) Tj 0 Tr ET',
    // 2) White-on-white text (1 1 1 rg on default white page)
    'BT /F1 12 Tf 1 1 1 rg 1 0 0 1 72 680 Tm (White On White Secret Key) Tj 0 0 0 rg ET',
    // 3) Sub-legible tiny font (0.5 pt)
    'BT /F1 0.5 Tf 0 0 0 rg 1 0 0 1 72 650 Tm (Microscopic Sublegible Payload) Tj ET',
    // 4) Off-page coordinate text (outside MediaBox [0 0 612 792])
    'BT /F1 12 Tf 0 0 0 rg 1 0 0 1 -250 500 Tm (Offpage Negative X Secret) Tj ET',
    'BT /F1 12 Tf 0 0 0 rg 1 0 0 1 850 500 Tm (Offpage Beyond Width Secret) Tj ET',
  ].join('\n');

  const { buffer } = buildSinglePagePdf(content, { mediaBox: '[0 0 612 792]' });
  const diag = extractPdfDetailed(buffer);

  const codes = new Set(diag.forensicFindings.map((f) => f.code));
  assert.ok(codes.has('PDF_INVISIBLE_RENDER_MODE_3'), `Missing PDF_INVISIBLE_RENDER_MODE_3 in ${[...codes]}`);
  assert.ok(codes.has('INVISIBLE_WHITE_ON_WHITE_TEXT'), `Missing INVISIBLE_WHITE_ON_WHITE_TEXT in ${[...codes]}`);
  assert.ok(codes.has('INVISIBLE_SUBLEGIBLE_FONT'), `Missing INVISIBLE_SUBLEGIBLE_FONT in ${[...codes]}`);
  assert.ok(codes.has('PDF_OFF_PAGE_TEXT'), `Missing PDF_OFF_PAGE_TEXT in ${[...codes]}`);

  const mode3 = diag.forensicFindings.find((f) => f.code === 'PDF_INVISIBLE_RENDER_MODE_3');
  assert.match(mode3.textSnippet, /Hidden Mode 3/);

  const wow = diag.forensicFindings.find((f) => f.code === 'INVISIBLE_WHITE_ON_WHITE_TEXT');
  assert.match(wow.textSnippet, /White On White/);

  const tiny = diag.forensicFindings.find((f) => f.code === 'INVISIBLE_SUBLEGIBLE_FONT');
  assert.match(tiny.textSnippet, /Microscopic Sublegible/);
  assert.ok(tiny.fontSizePt <= 1.5);

  const offPage = diag.forensicFindings.filter((f) => f.code === 'PDF_OFF_PAGE_TEXT');
  assert.equal(offPage.length, 2, 'Both negative-X and beyond-MediaBox text runs must be flagged');
});

test('T3.3B: Detects DOCX invisible-text channels (w:color FFFFFF, w:vanish, and tiny w:sz)', () => {
  const docXml = [
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    '<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Normal visible paragraph.</w:t></w:r></w:p>',
    '<w:p><w:r><w:rPr><w:color w:val="FFFFFF"/></w:rPr><w:t>White hidden SSN 123-45-6789</w:t></w:r></w:p>',
    '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Vanished secret memo</w:t></w:r></w:p>',
    '<w:p><w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:t>Tiny 1pt hidden watermark</w:t></w:r></w:p>',
    '</w:body></w:document>',
  ].join('');

  const docxBuf = buildZipBuffer([{ name: 'word/document.xml', content: docXml }]);
  const parsed = extractDocxForensic('hidden.docx', docxBuf);

  const codes = new Set(parsed.forensicFindings.map((f) => f.code));
  assert.ok(codes.has('INVISIBLE_WHITE_ON_WHITE_TEXT'), `Missing INVISIBLE_WHITE_ON_WHITE_TEXT in ${[...codes]}`);
  assert.ok(codes.has('DOCX_VANISH_HIDDEN_TEXT'), `Missing DOCX_VANISH_HIDDEN_TEXT in ${[...codes]}`);
  assert.ok(codes.has('INVISIBLE_SUBLEGIBLE_FONT'), `Missing INVISIBLE_SUBLEGIBLE_FONT in ${[...codes]}`);

  const tinyFinding = parsed.forensicFindings.find((f) => f.code === 'INVISIBLE_SUBLEGIBLE_FONT');
  assert.equal(tinyFinding.fontSizePt, 1);
  assert.match(tinyFinding.textSnippet, /Tiny 1pt hidden watermark/);
});

// ---------------------------------------------------------------------------
// 4. Recursive Nested Attachment Scanning with Depth & Zip-Bomb Guards
// ---------------------------------------------------------------------------

test('T3.4A: Recursively scans nested EML -> ZIP -> inner EML -> TXT & DOCX attachments and MSG -> ZIP attachments', () => {
  const secretTxt = Buffer.from('Deep secret payload: alice.deep@acme.com SSN 999-11-2222', 'utf8');
  const innerEml = buildEmlWithAttachment({
    from: 'inner@acme.com',
    subject: 'Inner Forwarded Case',
    body: 'Inner email body text.',
    attachmentName: 'deep_secret.txt',
    attachmentMime: 'text/plain',
    attachmentBytes: secretTxt,
    boundary: 'BND_INNER',
  });
  const nestedDocx = buildZipBuffer([
    {
      name: 'word/document.xml',
      content: '<w:document><w:body><w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden Office Attachment Token</w:t></w:r></w:p></w:body></w:document>',
    },
  ]);
  const bundleZip = buildZipBuffer([
    { name: 'nested/inner.eml', content: innerEml },
    { name: 'nested/notes.docx', content: nestedDocx },
  ]);
  const outerEml = buildEmlWithAttachment({
    from: 'outer@acme.com',
    subject: 'Outer Bundle Email',
    body: 'Please inspect the attached zip bundle.',
    attachmentName: 'evidence.zip',
    attachmentMime: 'application/zip',
    attachmentBytes: bundleZip,
    boundary: 'BND_OUTER',
  });

  const parsed = parseEnterpriseBuffer('mail/outer.eml', outerEml);
  const allText = parsed.blocks.map((b) => b.text).join('\n');

  assert.match(allText, /Outer Bundle Email/);
  assert.match(allText, /Inner Forwarded Case/);
  assert.match(allText, /alice\.deep@acme\.com/, 'Must recursively extract TXT attachment from EML -> ZIP -> inner EML -> TXT');
  assert.match(allText, /Hidden Office Attachment Token/, 'Must recursively extract DOCX inside ZIP inside EML');
  assert.ok(
    parsed.forensicFindings.some((f) => f.code === 'DOCX_VANISH_HIDDEN_TEXT'),
    'Must propagate forensic findings from nested Office attachments'
  );

  // Also test Outlook .msg -> .zip -> .txt recursive extraction
  const msgZip = buildZipBuffer([{ name: 'payroll.txt', content: 'MSG nested payroll bob@corp.test' }]);
  const msgBuf = buildMinimalOutlookMsg({
    subject: 'Outlook Nested Archive',
    sender: 'hr@corp.test',
    body: 'Attached archive.',
    attachmentName: 'payroll.zip',
    attachmentBytes: msgZip,
  });
  const parsedMsg = parseEnterpriseBuffer('outlook/nested.msg', msgBuf);
  assert.match(parsedMsg.blocks.map((b) => b.text).join('\n'), /bob@corp\.test/);
});

test('T3.4B: Enforces bounded recursion maxDepth and fails closed on nested zip-bomb & zip-slip inside EML/ZIP', () => {
  // Build 6-deep nested EML chain (exceeds default maxDepth=4)
  let currentEml = Buffer.from('From: leaf@acme.com\r\nSubject: Leaf Level 6\r\n\r\nDeep leaf payload.', 'utf8');
  for (let lvl = 5; lvl >= 1; lvl -= 1) {
    currentEml = buildEmlWithAttachment({
      from: `lvl${lvl}@acme.com`,
      subject: `Level ${lvl}`,
      body: `Body level ${lvl}`,
      attachmentName: `level_${lvl + 1}.eml`,
      attachmentMime: 'message/rfc822',
      attachmentBytes: currentEml,
      boundary: `BND_LVL_${lvl}`,
    });
  }

  // Bounded depth truncation finding without infinite recursion
  const bounded = parseEnterpriseBuffer('mail/deep_chain.eml', currentEml, { maxDepth: 2 });
  assert.ok(
    bounded.forensicFindings.some((f) => f.code === 'RECURSIVE_ATTACHMENT_MAX_DEPTH_EXCEEDED'),
    'Must record RECURSIVE_ATTACHMENT_MAX_DEPTH_EXCEEDED when nesting exceeds maxDepth'
  );
  assert.doesNotMatch(bounded.blocks.map((b) => b.text).join('\n'), /Deep leaf payload/, 'Must halt recursion at maxDepth');

  // Strict fail-closed mode when failOnMaxDepth: true
  assert.throws(
    () => parseEnterpriseBuffer('mail/deep_chain.eml', currentEml, { maxDepth: 2, failOnMaxDepth: true }),
    /MAX_DEPTH_EXCEEDED/
  );

  // Deeply nested ZIP-in-ZIP fails closed with ARCHIVE_MAX_DEPTH_EXCEEDED
  let nestedZip = buildZipBuffer([{ name: 'leaf.txt', content: 'deep zip leaf' }]);
  for (let i = 0; i < 4; i += 1) {
    nestedZip = buildZipBuffer([{ name: `inner_${i}.zip`, content: nestedZip }]);
  }
  assert.throws(
    () => parseEnterpriseBuffer('deep.zip', nestedZip, { maxDepth: 2 }),
    /ARCHIVE_MAX_DEPTH_EXCEEDED/
  );

  // Zip-bomb nested inside an EML attachment MUST fail closed (never silently swallowed!)
  const bombZip = buildZipBuffer([{ name: 'bomb.txt', content: Buffer.alloc(1024 * 1024, 0x41) }], { useDeflate: true });
  const bombEml = buildEmlWithAttachment({
    subject: 'Malicious Bomb',
    attachmentName: 'bomb.zip',
    attachmentMime: 'application/zip',
    attachmentBytes: bombZip,
    boundary: 'BND_BOMB',
  });
  assert.throws(
    () => parseEnterpriseBuffer('mail/bomb.eml', bombEml, { maxArchiveRatio: 25 }),
    /ZIP_BOMB_RATIO_EXCEEDED/
  );

  // Zip-slip nested inside an EML attachment MUST fail closed!
  const slipZip = buildZipBuffer([{ name: '../../etc/passwd', content: 'root:x:0:0' }]);
  const slipEml = buildEmlWithAttachment({
    subject: 'Malicious ZipSlip',
    attachmentName: 'slip.zip',
    attachmentMime: 'application/zip',
    attachmentBytes: slipZip,
    boundary: 'BND_SLIP',
  });
  assert.throws(
    () => parseEnterpriseBuffer('mail/slip.eml', slipEml),
    /ZIP_SLIP_REJECTED/
  );
});

// ---------------------------------------------------------------------------
// 5. Mandatory Post-Redaction PDF Irreversibility Verification Pass
// ---------------------------------------------------------------------------

test('T3.5: verifyPdfRedactionIrreversibility fails loudly on pseudo-redacted, invisible, and incremental-leak PDFs; passes with 0 residual on genuinely scrubbed PDF', () => {
  assert.equal(pipelineVerifyPdfIrreversibility, verifyPdfRedactionIrreversibility);
  assert.equal(pipelineRedactPdfBuffer, redactPdfBuffer);

  // Case A: Pseudo-redacted PDF (black box over intact SSN text) -> MUST FAIL LOUDLY!
  const pseudoRedacted = buildSinglePagePdf(
    [
      'BT /F1 12 Tf 0 0 0 rg 1 0 0 1 72 720 Tm (Patient: Evelyn Vance) Tj ET',
      'BT /F1 12 Tf 0 0 0 rg 1 0 0 1 72 690 Tm (SSN: 123-45-6789) Tj ET',
      '0 0 0 rg 68 684 160 18 re f',
    ].join('\n')
  ).buffer;

  assert.throws(
    () => verifyPdfRedactionIrreversibility(pseudoRedacted, ['123-45-6789', { value: 'Evelyn Vance', type: 'person' }]),
    (err) => {
      assert.equal(err.code, 'PDF_REDACTION_IRREVERSIBILITY_FAILED');
      assert.equal(err.report.ok, false);
      assert.ok(err.residualLeaks.some((l) => l.span === '123-45-6789'));
      assert.ok(err.residualLeaks.some((l) => l.forensicCodes.includes('PDF_TEXT_UNDER_OPAQUE_OVERLAY')));
      return true;
    }
  );

  // Non-throwing mode returns ok: false with full leak details
  const softRes = verifyPdfRedactionIrreversibility(pseudoRedacted, ['123-45-6789'], { throwOnLeak: false });
  assert.equal(softRes.ok, false);
  assert.equal(softRes.residualLeakCount, 1);

  // Case B: Redacted via incremental update (rev 1 still holds secret!) -> MUST FAIL LOUDLY!
  const rev1 = buildSinglePagePdf('BT /F1 12 Tf 1 0 0 1 72 720 Tm (Secret SSN 123-45-6789) Tj ET');
  const rev2Stream = 'BT /F1 12 Tf 1 0 0 1 72 720 Tm (Secret SSN [REDACTED]) Tj ET';
  const incrementalRedacted = appendIncrementalPdfUpdate(
    rev1,
    5,
    `<< /Length ${Buffer.byteLength(rev2Stream, 'latin1')} >>\nstream\n${rev2Stream}\nendstream`
  ).buffer;

  assert.throws(
    () => verifyPdfRedactionIrreversibility(incrementalRedacted, ['123-45-6789']),
    (err) => {
      assert.equal(err.code, 'PDF_REDACTION_IRREVERSIBILITY_FAILED');
      assert.ok(err.residualLeaks[0].channels.includes('incremental_revision'));
      return true;
    }
  );

  // Case C: Redacted text left behind in rendering mode 3 invisible layer -> MUST FAIL LOUDLY!
  const mode3LeakPdf = buildSinglePagePdf(
    [
      'BT /F1 12 Tf 1 0 0 1 72 720 Tm (Public Report [REDACTED]) Tj ET',
      'BT /F1 12 Tf 3 Tr 1 0 0 1 72 700 Tm (123-45-6789) Tj 0 Tr ET',
    ].join('\n')
  ).buffer;
  assert.throws(
    () => verifyPdfRedactionIrreversibility(mode3LeakPdf, ['123-45-6789']),
    /PDF_REDACTION_IRREVERSIBILITY_FAILED/
  );

  // Case D: Genuinely scrubbed PDF via redactPdfBuffer -> passes with 0 residual spans and strips overlays/revisions/invisible text!
  const dirtySource = appendIncrementalPdfUpdate(
    buildSinglePagePdf(
      [
        'BT /F1 12 Tf 0 0 0 rg 1 0 0 1 72 740 Tm (Clinical Study Protocol 2026) Tj ET',
        'BT /F1 12 Tf 0 0 0 rg 1 0 0 1 72 710 Tm (Patient Evelyn Vance SSN 123-45-6789) Tj ET',
        '0 0 0 rg 68 704 260 18 re f',
        'BT /F1 12 Tf 3 Tr 1 0 0 1 72 680 Tm (Invisible leak 123-45-6789) Tj 0 Tr ET',
      ].join('\n')
    ),
    5,
    `<< /Length 97 >>\nstream\nBT /F1 12 Tf 1 0 0 1 72 740 Tm (Clinical Study Protocol 2026) Tj ET\nBT /F1 12 Tf 1 0 0 1 72 710 Tm (Patient Evelyn Vance SSN 123-45-6789) Tj ET\nendstream`
  ).buffer;

  const { redactedPdfBuffer, verification } = redactPdfBuffer(
    dirtySource,
    [
      { value: '123-45-6789', type: 'ssn', replacement: '<PII:SSN>' },
      { value: 'Evelyn Vance', type: 'person', replacement: '<PII:PERSON>' },
    ]
  );

  assert.equal(verification.ok, true);
  assert.equal(verification.residualLeakCount, 0);
  assert.equal(verification.revisionCount, 1, 'Scrubbed PDF must be single-revision flattened');
  assert.equal(verification.forensicFindings.length, 0, 'Scrubbed PDF must have 0 hidden-channel findings');

  // Re-extract independently to confirm safe prose remains while secrets are completely absent from bytes
  const reExtracted = extractPdfDetailed(redactedPdfBuffer);
  assert.ok(reExtracted.lines.join('\n').includes('Clinical Study Protocol 2026'));
  assert.ok(reExtracted.lines.join('\n').includes('<PII:SSN>'));
  assert.ok(!redactedPdfBuffer.toString('latin1').includes('123-45-6789'));
  assert.ok(!redactedPdfBuffer.toString('latin1').includes('Evelyn Vance'));

  // Also verify wired generateResearchPdfAndImage emits verified redactedPdfBuffer when given explicit lines
  const res = generateResearchPdfAndImage({
    lines: [
      { text: 'Clinical study cohort summary for safe release.', fontStyle: 'sans_serif', routingLabel: 'keep_safe', label: 1 },
      { text: 'Patient SSN: 123-45-6789', fontStyle: 'monospace', routingLabel: 'quarantine_pii', piiType: 'ssn', piiVal: '123-45-6789', label: 0 },
    ],
  });
  assert.ok(Buffer.isBuffer(res.redactedPdfBuffer), 'generateResearchPdfAndImage must emit redactedPdfBuffer');
  assert.equal(res.pdfRedactionVerification.ok, true);
  assert.equal(res.pdfRedactionVerification.residualLeakCount, 0);
  assert.ok(!res.redactedPdfBuffer.toString('latin1').includes('123-45-6789'));

  // Also verify sanitizePdfBuffer end-to-end auto-PII redaction + mandatory irreversibility gate
  const autoDirtyPdf = buildSinglePagePdf(
    [
      'BT /F1 12 Tf 0 g 72 720 Td (Contact ada.lovelace@acme.org regarding SSN 123-45-6789) Tj ET',
      '0 g 68 714 280 18 re f*',
      'BT /F1 12 Tf 1 g 72 680 Td (White gray text with 1 g) Tj ET',
    ].join('\n')
  ).buffer;
  const dirtyDiag = extractPdfDetailed(autoDirtyPdf);
  assert.ok(dirtyDiag.forensicFindings.some((f) => f.code === 'PDF_TEXT_UNDER_OPAQUE_OVERLAY'));
  assert.ok(dirtyDiag.forensicFindings.some((f) => f.code === 'INVISIBLE_WHITE_ON_WHITE_TEXT'));

  const sanitized = sanitizePdfBuffer(autoDirtyPdf);
  assert.equal(sanitized.verification.ok, true);
  assert.equal(sanitized.verification.residualLeakCount, 0);
  assert.ok(!sanitized.redactedPdfBuffer.toString('latin1').includes('ada.lovelace@acme.org'));
  assert.ok(!sanitized.redactedPdfBuffer.toString('latin1').includes('123-45-6789'));
});

test('T3.6: Nested EML -> ZIP -> PDF propagates hidden-channel findings and enforces maxArchiveTotalBytes guard', () => {
  const hiddenPdf = buildSinglePagePdf(
    'BT /F1 12 Tf 3 Tr 1 0 0 1 72 700 Tm (Nested PDF Invisible Secret) Tj 0 Tr ET'
  ).buffer;
  const zipWithPdf = buildZipBuffer([
    { name: 'evidence/hidden.pdf', content: hiddenPdf },
  ]);
  const emlWithPdfZip = buildEmlWithAttachment({
    subject: 'Evidence Bundle With Hidden PDF',
    attachmentName: 'bundle.zip',
    attachmentMime: 'application/zip',
    attachmentBytes: zipWithPdf,
    boundary: 'BND_PDF_ZIP',
  });

  const parsed = parseEnterpriseBuffer('mail/pdf_bundle.eml', emlWithPdfZip);
  assert.ok(
    parsed.forensicFindings.some((f) => f.code === 'PDF_INVISIBLE_RENDER_MODE_3'),
    'Must propagate PDF_INVISIBLE_RENDER_MODE_3 from nested EML -> ZIP -> PDF'
  );
  assert.match(parsed.blocks.map((b) => b.text).join('\n'), /Nested PDF Invisible Secret/);

  // Aggregate maxArchiveTotalBytes guard fails closed inside nested EML -> ZIP
  const largeZip = buildZipBuffer([
    { name: 'a.txt', content: 'A'.repeat(2048) },
    { name: 'b.txt', content: 'B'.repeat(2048) },
  ]);
  const emlLarge = buildEmlWithAttachment({
    subject: 'Large Archive',
    attachmentName: 'large.zip',
    attachmentMime: 'application/zip',
    attachmentBytes: largeZip,
    boundary: 'BND_LARGE',
  });
  assert.throws(
    () => parseEnterpriseBuffer('mail/large.eml', emlLarge, { maxArchiveTotalBytes: 3000 }),
    /ARCHIVE_TOTAL_SIZE_EXCEEDED/
  );
});
