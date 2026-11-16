/**
 * test/pdf-docx-ingest.test.js
 * Red-Green tests for Ticket #17 (T2):
 *  - Born-digital PDF parser (Flate, ASCII85, Filter arrays, ObjStm, scoped 1/2-byte ToUnicode, TJ kerning/coords)
 *  - Preservation of duplicate lines and short (<8 char) tokens + diagnostics
 *  - Bit-3 Data Descriptor DOCX Central Directory extraction + zip-bomb protection + unified path ingest
 *  - Removal of synthetic PMC fallbacks + fail-closed image-only PDF without OCR
 *  - Default SHA-256 raw_excerpt redaction and non-hardcoded gatekeeper_status
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  extractPdfDetailed,
  extractLinesFromPdfBuffer,
  extractPdfTextLayer,
  exportBlocksToCsv,
  exportBlocksToJson,
  getRealPmcDocumentLines,
  extractPmcClinicalSentences,
  runPdfVsImageComparison,
  ingestFromUrlOrPath,
} from '../src/pdf-image-pipeline.js';
import { extractDocxText } from '../src/ingestor.js';

function encodeAscii85(buf) {
  let out = '';
  for (let i = 0; i < buf.length; i += 4) {
    const rem = Math.min(4, buf.length - i);
    if (rem === 4 && buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 0) {
      out += 'z';
      continue;
    }
    let val = 0;
    for (let j = 0; j < 4; j += 1) {
      val = val * 256 + (j < rem ? buf[i + j] : 0);
    }
    const chars = new Array(5);
    for (let k = 4; k >= 0; k -= 1) {
      chars[k] = String.fromCharCode(33 + (val % 85));
      val = Math.floor(val / 85);
    }
    out += chars.slice(0, rem + 1).join('');
  }
  return Buffer.from(out + '~>', 'ascii');
}

function buildPdf(objects) {
  let out = Buffer.from('%PDF-1.5\n', 'latin1');
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
  return Buffer.concat([out, Buffer.from(xref, 'latin1')]);
}

function makeZipEntry(filename, xmlContent, { bit3 = false, inflateRatioBomb = false } = {}) {
  const nameBuf = Buffer.from(filename, 'utf8');
  const rawBuf = Buffer.from(xmlContent, 'utf8');
  const compBuf = inflateRatioBomb
    ? zlib.deflateRawSync(Buffer.alloc(1024 * 1024, 0x41))
    : zlib.deflateRawSync(rawBuf);
  const uncompSize = inflateRatioBomb ? 1024 * 1024 : rawBuf.length;

  const lfh = Buffer.alloc(30 + nameBuf.length);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(bit3 ? 0x0008 : 0x0000, 6);
  lfh.writeUInt16LE(8, 8);
  lfh.writeUInt32LE(0, 14);
  lfh.writeUInt32LE(bit3 ? 0 : compBuf.length, 18);
  lfh.writeUInt32LE(bit3 ? 0 : uncompSize, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(0, 28);
  nameBuf.copy(lfh, 30);

  const dd = bit3 ? Buffer.alloc(16) : Buffer.alloc(0);
  if (bit3) {
    dd.writeUInt32LE(0x08074b50, 0);
    dd.writeUInt32LE(0, 4);
    dd.writeUInt32LE(compBuf.length, 8);
    dd.writeUInt32LE(uncompSize, 12);
  }

  const cdh = Buffer.alloc(46 + nameBuf.length);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt16LE(bit3 ? 0x0008 : 0x0000, 8);
  cdh.writeUInt16LE(8, 10);
  cdh.writeUInt32LE(compBuf.length, 20);
  cdh.writeUInt32LE(uncompSize, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt32LE(0, 42);
  nameBuf.copy(cdh, 46);

  const cdOffset = lfh.length + compBuf.length + dd.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdh.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([lfh, compBuf, dd, cdh, eocd]);
}

test('T2: PDF parser decodes ObjStm, ASCII85+Flate filter arrays, scoped 1/2-byte ToUnicode, TJ kerning, coordinates, multiplicity & short tokens', () => {
  const cmapF1 = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    '1 beginbfchar <0001> <0041> endbfchar', // F1 <0001> -> 'A'
    '1 beginbfrange <0002> <0004> [<0042> <0043> <0044>] endbfrange', // 'B', 'C', 'D'
    'endcmap'
  ].join('\n');

  const cmapF2 = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '1 begincodespacerange <00> <FF> endcodespacerange',
    '1 beginbfchar <01> <005A> endbfchar', // F2 <01> -> 'Z' (same glyph index 1, must stay isolated!)
    'endcmap'
  ].join('\n');

  // Content stream: put bottom line first in stream, top line second in stream to verify Y coordinate sorting,
  // duplicate lines, short token "OK", negative kerning word split, and F1 vs F2 CMap scoping.
  const streamText = [
    'BT',
    '/F1 12 Tf 1 0 0 1 50 650 Tm (<0001><0002><0003><0004>) Tj', // placeholder literal? No, hex outside ()!
    'ET'
  ].join('\n');
  const realContent = [
    'BT /F2 12 Tf 1 0 0 1 50 620 Tm <01> Tj ET', // lower Y=620: 'Z'
    'BT /F1 12 Tf 1 0 0 1 50 760 Tm <0001000200030004> Tj ET', // higher Y=760: 'ABCD'
    'BT /F3 11 Tf 1 0 0 1 50 720 Tm [(Kerning) -240 (Words) -35 (Stay)] TJ ET', // 'Kerning WordsStay'
    'BT /F3 11 Tf 1 0 0 1 50 690 Tm (OK) Tj ET', // short < 8 char line #1
    'BT /F3 11 Tf 1 0 0 1 50 660 Tm (OK) Tj ET', // duplicate line preserved!
  ].join('\n');
  void streamText;
  const contentCompressed = zlib.deflateSync(Buffer.from(realContent, 'latin1'));
  const contentA85Flate = encodeAscii85(contentCompressed);

  // Put object 7 (Type0 F1 Font) and object 8 (Type1 F3 Font) inside an ObjStm!
  const sub7 = `<< /Type /Font /Subtype /Type0 /ToUnicode 5 0 R >>`;
  const sub8 = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`;
  const objStmHeader = `7 0 8 ${sub7.length + 1}\n`;
  const objStmBody = Buffer.from(objStmHeader + sub7 + '\n' + sub8, 'latin1');
  const objStmComp = zlib.deflateSync(objStmBody);

  const pdf = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 7 0 R /F2 6 0 R /F3 8 0 R >> >> /Contents 4 0 R >>',
    Buffer.concat([
      Buffer.from(`<< /Length ${contentA85Flate.length} /Filter [/ASCII85Decode /FlateDecode] >>\nstream\n`, 'latin1'),
      contentA85Flate,
      Buffer.from('\nendstream', 'latin1'),
    ]),
    `<< /Length ${cmapF1.length} >>\nstream\n${cmapF1}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /ToUnicode << /Length ${cmapF2.length} >>\n>>`, // WAIT: make object 6 font pointing to obj 9 ToUnicode!
    Buffer.concat([
      Buffer.from(`<< /Type /ObjStm /N 2 /First ${objStmHeader.length} /Length ${objStmComp.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      objStmComp,
      Buffer.from('\nendstream', 'latin1'),
    ]),
    '<< /Null 0 >>', // placeholder so object numbers 7/8 don't collide? Put ObjStm at 9, F2->10!
  ]);
  void pdf;

  const pdfClean = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>', // 1
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', // 2
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 7 0 R /F2 6 0 R /F3 8 0 R >> >> /Contents 4 0 R >>', // 3
    Buffer.concat([
      Buffer.from(`<< /Length ${contentA85Flate.length} /Filter [/ASCII85Decode /FlateDecode] >>\nstream\n`, 'latin1'),
      contentA85Flate,
      Buffer.from('\nendstream', 'latin1'),
    ]), // 4
    `<< /Length ${cmapF1.length} >>\nstream\n${cmapF1}\nendstream`, // 5
    '<< /Type /Font /Subtype /Type1 /ToUnicode 10 0 R >>', // 6
    Buffer.concat([
      Buffer.from(`<< /Type /ObjStm /N 2 /First ${objStmHeader.length} /Length ${objStmComp.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      objStmComp,
      Buffer.from('\nendstream', 'latin1'),
    ]), // 7 (contains 7 and 8? Wait: keep ObjStm at obj 9 so obj 7/8 live inside ObjStm 9!)
    '<< /Placeholder true >>',
  ]);
  void pdfClean;

  const sub10 = `<< /Type /Font /Subtype /Type0 /ToUnicode 5 0 R >>`;
  const sub11 = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`;
  const stmHdr = `10 0 11 ${sub10.length + 1}\n`;
  const stmComp = zlib.deflateSync(Buffer.from(stmHdr + sub10 + '\n' + sub11, 'latin1'));
  const finalPdf = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>', // 1
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', // 2
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 10 0 R /F2 6 0 R /F3 11 0 R >> >> /Contents 4 0 R >>', // 3
    Buffer.concat([
      Buffer.from(`<< /Length ${contentA85Flate.length} /Filter [/ASCII85Decode /FlateDecode] >>\nstream\n`, 'latin1'),
      contentA85Flate,
      Buffer.from('\nendstream', 'latin1'),
    ]), // 4
    `<< /Length ${cmapF1.length} >>\nstream\n${cmapF1}\nendstream`, // 5
    '<< /Type /Font /Subtype /Type1 /ToUnicode 8 0 R >>', // 6
    Buffer.concat([
      Buffer.from(`<< /Type /ObjStm /N 2 /First ${stmHdr.length} /Length ${stmComp.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      stmComp,
      Buffer.from('\nendstream', 'latin1'),
    ]), // 7
    `<< /Length ${cmapF2.length} >>\nstream\n${cmapF2}\nendstream`, // 8
  ]);

  const diag = extractPdfDetailed(finalPdf);
  assert.equal(diag.pageCount, 1);
  assert.ok(diag.streamCount >= 4);
  assert.equal(diag.isLikelyScanned, false);
  assert.equal(diag.diagnosticReason, 'BORN_DIGITAL_TEXT_EXTRACTED');
  assert.deepEqual(diag.lines, ['ABCD', 'Kerning WordsStay', 'OK', 'OK', 'Z']);
  assert.equal(extractLinesFromPdfBuffer(finalPdf).length, 5);
  assert.equal(extractPdfTextLayer(finalPdf).length, 5);
});

test('T2: DOCX extractor handles bit-3 Data Descriptor, XML runs/tabs/breaks/entities, zip-bomb limit, and unified path ingest', async () => {
  const xml =
    '<w:document><w:body>' +
    '<w:p><w:r><w:t>Hello&amp;</w:t><w:tab/><w:t>World&#x2019;s &#8364;5</w:t></w:r><w:r><w:br/><w:t>NextLine</w:t><w:delText>HIDDEN</w:delText></w:r></w:p>' +
    '</w:body></w:document>';
  const docxBuf = makeZipEntry('word/document.xml', xml, { bit3: true });
  const parsed = extractDocxText(docxBuf);
  assert.equal(parsed.sourceType, 'docx');
  const joined = parsed.lines.join('\n');
  assert.ok(joined.includes('Hello&\tWorld\u2019s \u20ac5'));
  assert.ok(joined.includes('NextLine'));
  assert.ok(!joined.includes('HIDDEN'));

  const bombDocx = makeZipEntry('word/document.xml', '<w:document/>', { bit3: true, inflateRatioBomb: true });
  assert.throws(
    () => extractDocxText(bombDocx, { maxUncompressedBytes: 64 * 1024 }),
    /DOCX_ZIP_BOMB_DETECTED|maxOutputLength/i
  );

  // Unified ingestFromUrlOrPath with real .docx file on disk
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-docx-'));
  try {
    const docxPath = path.join(tmpDir, 'sample.docx');
    const richXml = '<w:document><w:body>' +
      [
        '<w:p><w:r><w:t>Clinical retrospective review of hip fracture surgery outcomes.</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>Patient SSN 123-45-6789 contacted at test@example.org</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>Multivariable logistic regression adjusted for age and baseline frailty.</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>Copyright 2026 Confidential Internal Only Page 1</w:t></w:r></w:p>',
      ].join('') +
      '</w:body></w:document>';
    fs.writeFileSync(docxPath, makeZipEntry('word/document.xml', richXml, { bit3: true }));
    const res = await ingestFromUrlOrPath(docxPath, { outDir: path.join(tmpDir, 'out') });
    assert.equal(res.rows[0].source_mode, 'docx');
    assert.ok(res.rows.some((r) => r.masked_text.includes('hip fracture surgery')));
    assert.ok(!res.csv.includes('123-45-6789'));
    assert.ok(!res.json.includes('123-45-6789'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('T2: Empty/scanned PDF fails closed, dummy PMC getters fail loudly when missing, raw_excerpt redacted by default, and gatekeeper_status not hardcoded', async () => {
  const rgbImg = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 128, 128, 128]);
  const scannedPdf = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${rgbImg.length} >>\nstream\n`, 'latin1'),
      rgbImg,
      Buffer.from('\nendstream', 'latin1'),
    ]),
    '<< /Length 26 >>\nstream\nq 200 0 0 200 0 0 cm /Im1 Do Q\nendstream',
  ]);

  const diag = extractPdfDetailed(scannedPdf);
  assert.equal(diag.pageCount, 1);
  assert.equal(diag.imageXObjectCount, 1);
  assert.equal(diag.isLikelyScanned, true);
  assert.equal(diag.diagnosticReason, 'SCANNED_IMAGE_ONLY_PDF');
  assert.equal(diag.lines.length, 0);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-scanpdf-'));
  try {
    const scanPath = path.join(tmpDir, 'scanned.pdf');
    fs.writeFileSync(scanPath, scannedPdf);
    await assert.rejects(
      () => ingestFromUrlOrPath(scanPath, { outDir: path.join(tmpDir, 'out') }),
      /PDF_IMAGE_ONLY_REQUIRES_OCR/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.throws(() => getRealPmcDocumentLines('Z:/nonexistent-pmc-dir-t2'), /PMC_PDF_SOURCE_NOT_FOUND/);
  assert.throws(() => extractPmcClinicalSentences('Z:/nonexistent-pmc-file-t2.pdf'), /PMC_PDF_NOT_FOUND/);

  const sampleRows = [{
    line_index: 0,
    source_mode: 'text',
    font_style: 'sans_serif',
    raw_excerpt: 'Contact Alice via alice@corp.com or SSN 123-45-6789 immediately.',
    pii_detected: true,
    pii_types: ['email', 'ssn'],
    hidden_pii_preview: 'al***@corp.com',
    masked_text: 'Contact Alice via <PII:EMAIL> or SSN <PII:SSN> immediately.',
    token_count: 10,
    first_8_token_ids: [1, 2, 3],
    label: 0,
    pred_prob: 0.12,
    gatekeeper_action: 'DROP_OR_QUARANTINE',
  }];
  const safeCsv = exportBlocksToCsv(sampleRows);
  const safeJson = exportBlocksToJson(sampleRows);
  assert.ok(!safeCsv.includes('123-45-6789'));
  assert.ok(!safeJson.includes('alice@corp.com'));
  assert.ok(safeCsv.includes('sha256:'));
  assert.ok(exportBlocksToCsv(sampleRows, { includeRawExcerpt: true }).includes('123-45-6789'));

  const cmp = runPdfVsImageComparison();
  assert.equal(cmp.comparisonJson.summary.gatekeeper_status, 'UNCERTIFIED_FAIL_CLOSED');
});
