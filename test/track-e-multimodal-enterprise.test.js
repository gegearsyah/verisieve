import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { loadMediaWasmSync, DEFAULT_MEDIA_WASM_PATH } from '../src/media-wasm.js';
import { parseEnterpriseBuffer } from '../src/enterprise-parsers.js';
import { scanEnterprisePiiAndSecrets, redactEnterpriseText } from '../src/secret-scanner.js';
import {
  encodePcm16Wav,
  measureWavWindowRms,
  redactAudioCall,
  collapseRepeatedSpeechPhrases,
  deduplicateSpeechSegments,
} from '../src/audio-redactor.js';
import { buildSlidingWindows, createLocalNeuralPiiRunner, redactWithHybridNeuralPii } from '../src/neural-pii-onnx.js';
import {
  redactVideoKeyframes,
  scrubBinaryMediaMetadata,
  filterReadableOcrSlideLines,
} from '../src/video-redactor.js';
import { deduplicateChunks } from '../src/ingestor.js';
import {
  perceive,
  perceiveMulti,
  runGraphCoupledConformalRedaction,
  computePtlmMaskedSpans,
} from '../src/perceive.js';
import {
  trainGatekeeper,
  calibrateGatekeeper,
  calibrateClusterRobustGatekeeper,
  calibrateStreamingEProcessGatekeeper,
} from '../src/gatekeeper.js';
import { handleJsonRpcRequest, handleJsonRpcRequestAsync } from '../src/mcp-server.js';

// ---------------------------------------------------------------------------
// Test Helpers: Minimal Real ZIP, TAR.GZ, WAV+INFO, and Outlook CFBF .msg Builders
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
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

function buildMinimalOutlookMsg({ subject, sender, body, attachmentName, attachmentBytes }) {
  // Build a valid v3 (512-byte sector) CFBF/OLE2 container with regular FAT streams
  const SECTOR = 512;
  const encodeUtf16 = (s) => Buffer.from(s + '\0', 'utf16le');

  // Pad stream payloads to >= 4096 bytes? No: set mini_cutoff = 0 so every stream uses regular FAT!
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

  // Sector 0 = FAT, Sector 1 = Dir (sector 1, 2 = up to 8 dir entries), Sector 3+ = stream payloads
  const fat = new Uint32Array(128).fill(0xffffffff);
  fat[0] = 0xfffffffd; // FATSECT
  fat[1] = 2;          // Dir chain 1 -> 2
  fat[2] = 0xfffffffe; // ENDOFCHAIN

  let nextSec = 3;
  const dataSectors = [];
  const allocStream = (buf) => {
    const start = nextSec;
    const count = Math.max(1, Math.ceil(buf.length / SECTOR));
    for (let i = 0; i < count; i++) {
      const sec = Buffer.alloc(SECTOR);
      buf.copy(sec, 0, i * SECTOR, Math.min(buf.length, (i + 1) * SECTOR));
      dataSectors.push(sec);
      fat[nextSec] = i === count - 1 ? 0xfffffffe : nextSec + 1;
      nextSec++;
    }
    return start;
  };

  const makeDir = (name, objType, left, right, child, startSec, size) => {
    const d = Buffer.alloc(128);
    const nb = Buffer.from(name + '\0', 'utf16le');
    nb.copy(d, 0, 0, Math.min(64, nb.length));
    d.writeUInt16LE(Math.min(64, nb.length), 64);
    d[66] = objType;
    d[67] = 1; // black
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

  const dirs = [];
  // 0: Root Entry -> child 1
  dirs.push(makeDir('Root Entry', 5, NO, NO, 1, 0xfffffffe, 0));
  // 1: subject (right -> 2)
  dirs.push(makeDir(streams[0].name, 2, NO, 2, NO, s0, streams[0].data.length));
  // 2: sender (right -> 3)
  dirs.push(makeDir(streams[1].name, 2, NO, 3, NO, s1, streams[1].data.length));
  // 3: body (right -> 4 if att)
  dirs.push(makeDir(streams[2].name, 2, NO, attStreams.length ? 4 : NO, NO, s2, streams[2].data.length));
  if (attStreams.length) {
    const a0 = allocStream(attStreams[0].data);
    const a1 = allocStream(attStreams[1].data);
    // 4: attachment storage -> child 5
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
  hdr.writeUInt16LE(9, 30); // 512B sector
  hdr.writeUInt16LE(6, 32); // 64B mini
  hdr.writeUInt32LE(1, 44); // 1 FAT sector
  hdr.writeUInt32LE(1, 48); // first dir sector = 1
  hdr.writeUInt32LE(0, 56); // mini cutoff = 0 (all regular FAT)
  hdr.writeUInt32LE(0xfffffffe, 60); // no MiniFAT
  hdr.writeUInt32LE(0, 64);
  hdr.writeUInt32LE(0xfffffffe, 68); // no extra DIFAT
  hdr.writeUInt32LE(0, 72);
  for (let i = 0; i < 109; i++) hdr.writeUInt32LE(i === 0 ? 0 : 0xffffffff, 76 + i * 4);

  const fatBuf = Buffer.from(fat.buffer, fat.byteOffset, fat.byteLength);
  return Buffer.concat([hdr, fatBuf, ...dirs, ...dataSectors]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('Track E0: verisieve_media.wasm has 0 imports, ABI v1, <250 KB, and matches Rtio byte-for-byte', () => {
  const bytes = fs.readFileSync(DEFAULT_MEDIA_WASM_PATH);
  assert.ok(bytes.length > 50_000 && bytes.length < 250_000, `Unexpected wasm size ${bytes.length}`);
  const mod = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(mod), [], 'verisieve_media.wasm MUST have 0 imports');
  const engine = loadMediaWasmSync();
  assert.equal(engine.abiVersion, 1);

  const rtioPath = path.resolve(process.cwd(), '../Rtio/frontend/public/wasm/verisieve_media.wasm');
  if (fs.existsSync(rtioPath)) {
    const rtioBytes = fs.readFileSync(rtioPath);
    assert.ok(bytes.equals(rtioBytes), 'matilda-portable and Rtio verisieve_media.wasm must be byte-identical');
  }
});

test('Track E1: Deep parsers cover .eml (reply/sig strip + attachment), .msg (WASM CFBF), .pptx (speaker notes/hidden slide), .xlsx (pivotCache/comments/veryHidden), .vtt, Slack, .ics, .ipynb, .har', () => {
  // 1. EML with RFC 2047 subject, Received IP, quoted chain, signature, and base64 CSV attachment
  const csvAttachment = Buffer.from('Name,Email\nElena Vance,elena.vance@acme.com\n').toString('base64');
  const eml = [
    'Received: from mail.internal.corp (10.20.30.40) by mx.acme.com',
    'From: =?UTF-8?B?RWxlbmEgVmFuY2U=?= <elena.vance@acme.com>',
    'To: legal@acme.com',
    'Subject: =?UTF-8?B?UTMgQ29udHJhY3QgUmV2aWV3?=',
    'Message-ID: <msg-01@acme.com>',
    'Content-Type: multipart/mixed; boundary="BOUND99"',
    '',
    '--BOUND99',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Please review the updated SLA terms for Acme Corp.',
    '',
    '-- ',
    'Elena Vance | VP Legal | +1-415-555-0199',
    '',
    'On Mon, Nov 20, 2026 at 9:00 AM, John Smith wrote:',
    '> Duplicate old thread history with leaked SSN 123-45-6789',
    '--BOUND99',
    'Content-Type: text/csv; name="roster.csv"',
    'Content-Disposition: attachment; filename="roster.csv"',
    'Content-Transfer-Encoding: base64',
    '',
    csvAttachment,
    '--BOUND99--',
  ].join('\r\n');

  const emlParsed = parseEnterpriseBuffer('mail/q3.eml', Buffer.from(eml));
  assert.equal(emlParsed.modality, 'email');
  assert.ok(emlParsed.forensicFindings.some((f) => f.vector === 'email_received_headers'));
  assert.ok(emlParsed.forensicFindings.some((f) => f.vector === 'email_reply_chain_and_signature_stripped'));
  const emlText = emlParsed.blocks.map((b) => b.text).join('\n');
  assert.match(emlText, /Q3 Contract Review/);
  assert.doesNotMatch(emlText, /123-45-6789/, 'Quoted reply chain should be stripped');
  assert.equal(emlParsed.attachments.length, 1);
  assert.equal(emlParsed.attachments[0].filename, 'roster.csv');

  // 2. Outlook .msg binary CFBF parsed purely in Rust/WASM
  const msgBuf = buildMinimalOutlookMsg({
    subject: 'Board Compensation Deck',
    sender: 'cfo@acme.com',
    body: 'See attached payroll sheet for Elena Vance.',
    attachmentName: 'notes.txt',
    attachmentBytes: 'Confidential bonus note',
  });
  const msgParsed = parseEnterpriseBuffer('outlook/comp.msg', msgBuf);
  assert.equal(msgParsed.modality, 'email');
  assert.ok(msgParsed.blocks.some((b) => b.text.includes('Board Compensation Deck')));
  assert.equal(msgParsed.attachments.length, 1);
  assert.equal(msgParsed.attachments[0].filename, 'notes.txt');

  // 3. PPTX with hidden slide + speaker notes PII + docProps
  const pptxBuf = buildZipBuffer([
    { name: 'docProps/core.xml', content: '<cp:coreProperties><dc:creator>Elena Vance</dc:creator></cp:coreProperties>' },
    { name: 'ppt/slides/slide1.xml', content: '<p:sld><a:p><a:t>Q3 Revenue Summary</a:t></a:p></p:sld>' },
    { name: 'ppt/slides/slide2.xml', content: '<p:sld show="0"><a:p><a:t>Hidden layoff list</a:t></a:p></p:sld>' },
    { name: 'ppt/notesSlides/notesSlide1.xml', content: '<p:notes><a:p><a:t>Call elena.vance@acme.com before announcing</a:t></a:p></p:notes>' },
  ]);
  const pptxParsed = parseEnterpriseBuffer('decks/q3.pptx', pptxBuf);
  assert.ok(pptxParsed.forensicFindings.some((f) => f.vector === 'pptx_hidden_slide'));
  assert.ok(pptxParsed.forensicFindings.some((f) => f.vector === 'pptx_speaker_notes'));
  assert.ok(pptxParsed.blocks.some((b) => b.structRole === 'SPEAKER_NOTES' && b.text.includes('elena.vance@acme.com')));

  // 4. XLSX with veryHidden sheet + threadedComments + pivotCache forensic leak
  const xlsxBuf = buildZipBuffer([
    {
      name: 'xl/workbook.xml',
      content: '<workbook><sheets><sheet name="Summary" r:id="rId1"/><sheet name="Salaries" state="veryHidden" r:id="rId2"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    },
    { name: 'xl/sharedStrings.xml', content: '<sst><si><t>Employee</t></si><si><t>Email</t></si><si><t>Elena Vance</t></si><si><t>elena.vance@acme.com</t></si></sst>' },
    { name: 'xl/worksheets/sheet1.xml', content: '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>' },
    { name: 'xl/worksheets/sheet2.xml', content: '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Exec Comp</t></is></c></row></sheetData></worksheet>' },
    { name: 'xl/threadedComments/threadedComment1.xml', content: '<ThreadedComments><threadedComment><text>Check TFN 865 414 088</text></threadedComment></ThreadedComments>' },
    { name: 'xl/pivotCache/pivotCacheRecords1.xml', content: '<pivotCacheRecords><r><s v="deleted.customer@bank.com"/></r></pivotCacheRecords>' },
  ]);
  const xlsxParsed = parseEnterpriseBuffer('sheets/tracker.xlsx', xlsxBuf);
  assert.ok(xlsxParsed.forensicFindings.some((f) => f.vector === 'xlsx_hidden_sheet' && f.state === 'veryHidden'));
  assert.ok(xlsxParsed.forensicFindings.some((f) => f.vector === 'xlsx_cell_comments'));
  assert.ok(xlsxParsed.forensicFindings.some((f) => f.vector === 'xlsx_pivot_cache_hidden_records'));
  assert.ok(xlsxParsed.blocks.some((b) => b.structRole === 'TABLE_ROW' && b.text.includes('Employee: Elena Vance')));

  // 5. VTT, Slack, ICS (folded lines), IPYNB (cell output), HAR (auth header scrubbed)
  const vttParsed = parseEnterpriseBuffer(
    'calls/review.vtt',
    Buffer.from('WEBVTT\n\n00:00:05.000 --> 00:00:12.500\n<v Elena Vance>Please email elena.vance@acme.com\n')
  );
  assert.equal(vttParsed.blocks[0].structRole, 'TRANSCRIPT_TURN');
  assert.deepEqual(vttParsed.blocks[0].timeRangeMs, { startMs: 5000, endMs: 12500 });

  const slackParsed = parseEnterpriseBuffer(
    'chat/eng.json',
    Buffer.from(JSON.stringify([{ ts: '1700001.1', user: 'U01', text: 'Ask <@U02> about <mailto:sec@acme.com|sec@acme.com>' }])),
    { usersMap: { U01: { real_name: 'Elena Vance' }, U02: { real_name: 'Marcus Cole' } } }
  );
  assert.ok(slackParsed.blocks[0].text.includes('Elena Vance') && slackParsed.blocks[0].text.includes('Marcus Cole'));

  const icsParsed = parseEnterpriseBuffer(
    'cal/sync.ics',
    Buffer.from('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Legal Sync\r\nATTENDEE;CN="Elena Vance":mailto:elena.\r\n vance@acme.com\r\nEND:VEVENT\r\nEND:VCALENDAR')
  );
  assert.ok(icsParsed.blocks[0].text.includes('elena.vance@acme.com'), 'RFC 5545 folded line must unfold cleanly');

  const ipynbParsed = parseEnterpriseBuffer(
    'ml/audit.ipynb',
    Buffer.from(JSON.stringify({ cells: [{ cell_type: 'code', source: ['print(df)'], outputs: [{ text: ['user=elena.vance@acme.com'] }] }] }))
  );
  assert.ok(ipynbParsed.forensicFindings.some((f) => f.vector === 'ipynb_cell_output'));

  const harParsed = parseEnterpriseBuffer(
    'net/capture.har',
    Buffer.from(JSON.stringify({ log: { entries: [{ request: { method: 'GET', url: 'https://api.acme.com/v1', headers: [{ name: 'Authorization', value: 'Bearer secret_token_xyz123456789' }] }, response: { headers: [] } }] } }))
  );
  assert.ok(harParsed.forensicFindings.some((f) => f.vector === 'har_credentials_scrubbed'));
  assert.doesNotMatch(harParsed.scrubbedHarJson, /secret_token_xyz123456789/);
});

test('Track E2: Anti-evasion, international checksums, 30+ secrets (0 hash/UUID FP), K8s base64 Secret, and ZIP-slip / ZIP-bomb fail-closed', () => {
  const sample = [
    'Evaded email: s\u0430rah\u200B.chen@acme.com',
    'IBAN: GB82 WEST 1234 5698 7654 32',
    'AU TFN: 865 414 088 | AU ABN: 51 824 753 556 | UK NHS: 943 476 5919',
    'AWS: AKIAIOSFODNN7X9K2M4P',
    'OpenAI: sk-proj-9aB3cD5eF7gH9iJ1kL3mN5oP7qR9sT1uV3wX5yZ7',
    'JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'DB: postgres://admin:Sup3rS3cretP@ss@db.internal:5432/prod',
    'Safe SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'Safe UUID: 550e8400-e29b-41d4-a716-446655440000',
  ].join('\n');

  const scan = scanEnterprisePiiAndSecrets(sample);
  assert.ok(scan.evasionCharsStripped >= 1);
  assert.ok(scan.homoglyphsFolded >= 1);
  const types = new Set(scan.spans.map((s) => s.type));
  for (const expected of ['EMAIL', 'IBAN', 'AU_TFN', 'AU_ABN', 'UK_NHS', 'AWS_ACCESS_KEY', 'OPENAI_API_KEY', 'JWT', 'DB_CONNECTION_URI']) {
    assert.ok(types.has(expected), `Expected detector ${expected} to fire (got: ${[...types].join(',')})`);
  }
  const red = redactEnterpriseText(sample);
  assert.ok(red.maskedText.includes('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'), 'SHA-256 must NOT false-positive');
  assert.ok(red.maskedText.includes('550e8400-e29b-41d4-a716-446655440000'), 'UUID must NOT false-positive');
  assert.doesNotMatch(red.maskedText, /AKIAIOSFODNN7X9K2M4P|sk-proj-|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9|Sup3rS3cret/);

  // K8s Secret base64 decode
  const k8sYaml = `apiVersion: v1\nkind: Secret\ndata:\n  OPENAI_API_KEY: ${Buffer.from('sk-proj-9aB3cD5eF7gH9iJ1kL3mN5oP7qR9sT1uV3wX5yZ7').toString('base64')}\n`;
  const k8sParsed = parseEnterpriseBuffer('deploy/secret.yaml', Buffer.from(k8sYaml));
  assert.ok(k8sParsed.forensicFindings.some((f) => f.vector === 'k8s_secret_base64_decoded'));

  // Zip-Slip path traversal rejected in Rust/WASM
  const zipSlipBuf = buildZipBuffer([{ name: '../etc/passwd', content: 'root:x:0:0' }]);
  assert.throws(() => parseEnterpriseBuffer('evil.zip', zipSlipBuf), /ZIP_SLIP_REJECTED/);

  // ZIP compression bomb rejected mid-stream in Rust/WASM
  const bombBuf = buildZipBuffer([{ name: 'zeros.txt', content: Buffer.alloc(1024 * 1024, 0x41) }], { useDeflate: true });
  assert.throws(() => parseEnterpriseBuffer('bomb.zip', bombBuf, { maxArchiveRatio: 25 }), /ZIP_BOMB_RATIO_EXCEEDED/);
});

test('Track E3: Audio Spoken ITN + sample-accurate WAV silence/beep redaction + RIFF metadata scrub + fail-closed ASR', async () => {
  // Build a 3-second 16kHz sine wave + inject a forensic RIFF LIST/INFO chunk!
  const sr = 16000;
  const samples = new Float32Array(sr * 3);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.4;
  const baseWav = Buffer.from(encodePcm16Wav(samples, sr, 1));
  const infoPayload = Buffer.from('INFOIART\x0c\x00\x00\x00Elena Vance\x00');
  const listChunk = Buffer.concat([Buffer.from('LIST'), Buffer.alloc(4), infoPayload]);
  listChunk.writeUInt32LE(infoPayload.length, 4);
  const wavWithMeta = Buffer.concat([baseWav, listChunk]);
  wavWithMeta.writeUInt32LE(wavWithMeta.length - 8, 4);

  // Fail-closed when no ASR provider or wordTimestamps are provided
  await assert.rejects(() => redactAudioCall('calls/no-asr.wav', wavWithMeta), /ASR_WEIGHTS_REQUIRED/);

  // Spoken email & spoken phone inside 1000ms..2400ms
  const words = [
    { word: 'hello', startMs: 100, endMs: 400 },
    { word: 'email', startMs: 400, endMs: 800 },
    { word: 'sarah', startMs: 1000, endMs: 1200 },
    { word: 'dot', startMs: 1200, endMs: 1400 },
    { word: 'chen', startMs: 1400, endMs: 1600 },
    { word: 'at', startMs: 1600, endMs: 1800 },
    { word: 'acme', startMs: 1800, endMs: 2000 },
    { word: 'dot', startMs: 2000, endMs: 2200 },
    { word: 'com', startMs: 2200, endMs: 2400 },
    { word: 'thanks', startMs: 2600, endMs: 2900 },
  ];

  const silentRes = await redactAudioCall('calls/q3.wav', wavWithMeta, {
    wordTimestamps: words,
    mode: 'silence',
    padMs: 20,
  });
  assert.doesNotMatch(silentRes.redactedTranscript, /sarah\.chen@acme\.com/);
  assert.ok(silentRes.spokenTransformsCount >= 1);
  assert.equal(silentRes.audioMeta.strippedMetadataChunks.length, 1);
  assert.equal(silentRes.audioMeta.strippedMetadataChunks[0].chunkId, 'LIST');
  assert.ok(!Buffer.from(silentRes.redactedWavBytes).includes(Buffer.from('Elena Vance')), 'Forensic RIFF metadata must be scrubbed');

  // Inside redacted window [1100, 2300]: RMS energy MUST be ~0.0!
  const mutedRms = measureWavWindowRms(silentRes.redactedWavBytes, 1100, 2300);
  assert.ok(mutedRms < 1e-4, `Expected silence RMS < 1e-4, got ${mutedRms}`);

  // Outside redacted window [100, 500]: original 440Hz speech energy MUST be preserved!
  const keptRms = measureWavWindowRms(silentRes.redactedWavBytes, 100, 500);
  assert.ok(keptRms > 0.2, `Expected unredacted speech RMS > 0.2, got ${keptRms}`);
});

test('Track E4: Stage 3B sliding-window overlap, lowercase spoken name NER, surname coref, and fail-closed NER_WEIGHTS_REQUIRED', async () => {
  await assert.rejects(() => createLocalNeuralPiiRunner({ tier: 'gliner2-pii-multi', modelPath: '/nonexistent/gliner.onnx' }), /NER_WEIGHTS_REQUIRED/);

  const longText = Array.from({ length: 420 }, (_, i) => `word${i}`).join(' ');
  const windows = buildSlidingWindows(longText, 384, 64);
  assert.equal(windows.length, 2);

  // Lowercase spoken name + surname coreference ("Elena Vance" & "Ms. Vance")
  const text = 'Please send the contract to sarah chen and notify Elena Vance. Later Ms. Vance approved it.';
  const runner = await createLocalNeuralPiiRunner({
    tier: 'gliner-pii-edge',
    spanProvider: async (chunk) => {
      const idx = chunk.indexOf('sarah chen');
      return idx >= 0 ? [{ label: 'person', start: idx, end: idx + 'sarah chen'.length, score: 0.94 }] : [];
    },
  });
  const hybrid = await redactWithHybridNeuralPii(text, { neuralRunner: runner });
  assert.equal(hybrid.neuralNerLoaded, true);
  assert.doesNotMatch(hybrid.maskedText, /sarah chen|Elena Vance|Ms\. Vance/);

  const elenaEnt = hybrid.entities.find((e) => e.start === text.indexOf('Elena Vance'));
  const msVanceEnt = hybrid.entities.find((e) => e.start === text.indexOf('Ms. Vance'));
  assert.ok(elenaEnt && msVanceEnt);
  assert.equal(elenaEnt.entityId, msVanceEnt.entityId, 'Surname coreference must share exact same salted entityId');
});

test('Track E5: Video keyframe scene-change, OCR + Face temporal tracking (zero flicker) & MP4/JPEG metadata scrubbing', async () => {
  const mkFrame = (timeMs, fillR, fillG, fillB) => {
    const pixels = new Uint8Array(32 * 32 * 3);
    for (let i = 0; i < 32 * 32; i++) {
      pixels[i * 3] = fillR;
      pixels[i * 3 + 1] = fillG;
      pixels[i * 3 + 2] = fillB;
    }
    return { timeMs, width: 32, height: 32, channels: 3, pixels };
  };

  // Frame 0: title slide (white); Frame 1 (500ms): new dark slide with PII + face; Frame 2 (1000ms): same slide (NOT a keyframe!)
  const frames = [mkFrame(0, 240, 240, 240), mkFrame(500, 20, 40, 200), mkFrame(1000, 20, 40, 200)];
  const res = await redactVideoKeyframes('calls/zoom.mp4', frames, {
    ocrProvider: async (f) =>
      f.timeMs === 500 ? [{ text: 'Contact elena.vance@acme.com', bbox: [4, 4, 16, 12] }] : [],
    faceDetector: async (f) => (f.timeMs === 500 ? [{ x1: 20, y1: 20, x2: 28, y2: 28, trackId: 99 }] : []),
    pixelMode: 'blackout',
    holdMs: 1000,
    padPct: 0.15,
  });

  assert.equal(res.keyframeCount, 2, 'Frame 0 and Frame 1 should be keyframes, Frame 2 skipped by scene delta');
  assert.equal(res.blocks.length, 1);
  assert.doesNotMatch(res.blocks[0].text, /elena\.vance@acme\.com/);
  assert.equal(res.blocks[0].frameTimeMs, 500);

  // Frame 2 (non-keyframe at 1000ms) MUST STILL have PII & face boxes blacked out via temporal box tracking!
  const f2 = res.redactedFrames[2];
  assert.ok(f2.maskedPixels > 0, 'Intermediate non-keyframe must stay masked (zero 1-frame flicker)');
  const offPii = (6 * 32 + 6) * 3;
  assert.deepEqual(Array.from(f2.pixels.slice(offPii, offPii + 3)), [18, 18, 22]);
  const offFace = (24 * 32 + 24) * 3;
  assert.deepEqual(Array.from(f2.pixels.slice(offFace, offFace + 3)), [18, 18, 22]);

  // MP4 udta scrubbing preserves exact file length
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 12]), Buffer.from('ftypisom'),
    Buffer.from([0, 0, 0, 24]), Buffer.from('moov'),
    Buffer.from([0, 0, 0, 16]), Buffer.from('udtaGPS+33.8'),
  ]);
  const scrubbed = scrubBinaryMediaMetadata(mp4);
  assert.equal(scrubbed.cleanBytes.length, mp4.length);
  assert.equal(scrubbed.meta.strippedCount, 1);
  assert.ok(!Buffer.from(scrubbed.cleanBytes).includes(Buffer.from('GPS+33.8')));
});

test('Track E6: Cross-modal Knowledge Graph + GDPR Art. 17 blast_radius + new MCP tools', async () => {
  const pptxBuf = buildZipBuffer([
    { name: 'ppt/slides/slide1.xml', content: '<p:sld><a:p><a:t>Architecture Review</a:t></a:p></p:sld>' },
    { name: 'ppt/notesSlides/notesSlide1.xml', content: '<p:notes><a:p><a:t>Brief Elena Vance before board vote</a:t></a:p></p:notes>' },
  ]);

  const ingestResp = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 101,
    method: 'tools/call',
    params: {
      name: 'ingest_enterprise_bundle',
      arguments: {
        workspaceSalt: 'track-e-gdpr-salt',
        files: [
          {
            source: 'mail/deal.eml',
            text: 'From: elena.vance@acme.com\r\nSubject: Deal\r\n\r\nElena Vance approved the budget.',
          },
          {
            source: 'decks/board.pptx',
            contentBase64: pptxBuf.toString('base64'),
          },
          {
            source: 'calls/standup.vtt',
            text: 'WEBVTT\n\n00:01:02.000 --> 00:01:08.000\n<v Speaker_01>Elena Vance joined the call.\n',
          },
        ],
        artifacts: [{ artifact_id: 'art:sft-v1', name: 'enterprise-sft.jsonl', source_line_indices: [0, 1, 2] }],
      },
    },
  });
  assert.ok(!ingestResp.error, ingestResp.error?.message);
  const ingestData = JSON.parse(ingestResp.result.content[0].text);
  const elenaEntity = ingestData.entities.find((e) => e.pii_kind === 'PERSON' && e.mention_count >= 3);
  assert.ok(elenaEntity, 'Elena Vance must collapse to ONE cross-modal entity across email, PPTX notes, and VTT');

  // Run <1ms GDPR Art. 17 blast_radius across ALL modalities
  const blastResp = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 102,
    method: 'tools/call',
    params: {
      name: 'blast_radius',
      arguments: { seedIds: [elenaEntity.entity_id], direction: 'in', maxHops: 4 },
    },
  });
  const blast = JSON.parse(blastResp.result.content[0].text);
  const hitSources = new Set(blast.hits.map((h) => h.source || h.nodeId));
  assert.ok(hitSources.has('mail/deal.eml'), 'Blast radius must include email');
  assert.ok(hitSources.has('decks/board.pptx'), 'Blast radius must include PPTX speaker note');
  assert.ok(hitSources.has('calls/standup.vtt'), 'Blast radius must include VTT call transcript');

  // Verify MCP scan_enterprise_secrets & redact_audio_call
  const secretResp = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 103,
    method: 'tools/call',
    params: { name: 'scan_enterprise_secrets', arguments: { text: 'Key AKIAIOSFODNN7X9K2M4P' } },
  });
  const secretData = JSON.parse(secretResp.result.content[0].text);
  assert.equal(secretData.secretCount, 1);
  assert.doesNotMatch(secretData.maskedText, /AKIAIOSFODNN7X9K2M4P/);

  const wavSamples = new Float32Array(8000).fill(0.25);
  const wavB64 = Buffer.from(encodePcm16Wav(wavSamples, 8000, 1)).toString('base64');
  const audioResp = await handleJsonRpcRequestAsync({
    jsonrpc: '2.0',
    id: 104,
    method: 'tools/call',
    params: {
      name: 'redact_audio_call',
      arguments: {
        source: 'calls/mcp.wav',
        wavBase64: wavB64,
        mode: 'silence',
        wordTimestamps: [
          { word: 'email', startMs: 0, endMs: 200 },
          { word: 'elena@acme.com', startMs: 300, endMs: 700 },
        ],
      },
    },
  });
  assert.ok(!audioResp.error, audioResp.error?.message);
  const audioData = JSON.parse(audioResp.result.content[0].text);
  assert.doesNotMatch(audioData.redactedTranscript, /elena@acme\.com/);
  assert.equal(audioData.redactionLog.length, 1);

  // Verify backported dark-mode OCR readability gate, Whisper phrase collapse, and timestamp-agnostic dedup
  assert.deepEqual(
    filterReadableOcrSlideLines(
      [
        '® Tle Fd Secon View Go Rn Temi Wp EO « 1 cpu alma ia RCo CHINE - 0 save',
        'Quarterly Compliance Evaluation: contact elena.vance@acme.com',
      ],
      0.82
    ),
    ['Quarterly Compliance Evaluation: contact elena.vance@acme.com']
  );

  assert.equal(
    collapseRepeatedSpeechPhrases(
      'the first part is that, the first part is that, the first part is that, like, you are not going to be able to do anything.'
    ),
    'the first part is that, like, you are not going to be able to do anything.'
  );

  const dedupedSpeech = deduplicateSpeechSegments([
    { startSec: 107, endSec: 110, text: 'And then you are going to be able to do anything.' },
    { startSec: 110, endSec: 113, text: 'And then you are going to be able to do anything.' },
    { startSec: 113, endSec: 116, text: 'And then you are going to be able to do' },
  ]);
  assert.equal(dedupedSpeech.length, 1);

  const chunkDedup = deduplicateChunks([
    '[Speech 01:47–01:50] And then you are going to be able to do anything.',
    '[Speech 01:50–01:53] And then you are going to be able to do anything.',
    '[Speech 01:53–01:56] And then you are going to be able to do anything.',
  ]);
  assert.equal(chunkDedup.uniqueChunks.length, 1);
  assert.equal(chunkDedup.duplicatesRemoved, 2);

  // Verify GC-CRC (Graph-Coupled Cross-Modal Conformal Redaction) & one-shot perceiveMulti()
  const gccrcRes = runGraphCoupledConformalRedaction(
    [
      {
        source: 'ruling.pdf',
        modality: 'document',
        text: 'The applicant, Mr. Markus Pentikainen, lodged application 11882/10.',
        neuralSpans: [{ start: 19, end: 37, type: 'PERSON', score: 0.91 }],
      },
      {
        source: 'call_asr.vtt',
        modality: 'audio',
        text: 'Later in the hearing, Pentikainen and Elena Vans testified.',
        // Weak local neural scores (< 0.50 anchorThreshold) that isolated τ=0.50 would miss!
        neuralSpans: [
          { start: 22, end: 33, type: 'PERSON', score: 0.24 },
          { start: 38, end: 48, type: 'PERSON', score: 0.26 },
        ],
      },
      {
        source: 'mail.eml',
        modality: 'email',
        text: 'Lead counsel Dr. Elena Vance confirmed the schedule.',
        neuralSpans: [{ start: 17, end: 28, type: 'PERSON', score: 0.93 }],
      },
    ],
    { anchorThreshold: 0.50, lowNeuralThreshold: 0.20, workspaceSalt: 'test-gccrc' }
  );
  assert.ok(gccrcRes.anchorPoolSize >= 2, 'GC-CRC must populate Salted Reference Anchor Pool');
  assert.ok(gccrcRes.propagatedSpansCount >= 2, 'GC-CRC must propagate anchors to weak/phonetic mentions');
  assert.doesNotMatch(
    gccrcRes.blocks[1].maskedText,
    /Pentikainen|Elena Vans/,
    'GC-CRC must redact weak cross-modal and ASR-corrupted mentions coupled to high-precision anchors'
  );

  const perceived = await perceiveMulti([
    { name: 'mail/deal.eml', text: 'From: elena.vance@acme.com\r\nSubject: Q4\r\n\r\nDr. Elena Vance signed off.' },
    { name: 'decks/board.pptx', bytes: pptxBuf },
    { name: 'calls/standup.vtt', text: 'WEBVTT\n\n00:00:10.000 --> 00:00:15.000\n<v Speaker>Elena Vans reviewed the deck.\n' },
  ]);
  assert.match(perceived.perceptionStream, /<DOC src="mail\/deal\.eml">/);
  assert.match(perceived.perceptionStream, /<BLOCK id="b1"/);
  assert.doesNotMatch(perceived.markdown, /elena\.vance@acme\.com|Elena Vans/);
  assert.ok(perceived.chunks.length >= 2);
  assert.ok(perceived.sftJsonl.includes('"role":"assistant"'));
  assert.equal(perceived.receipt.engine, 'versieve-gccrc-v1');
});

test('Track E7: Zero-import WASM SR-MP 512-slot Salted Reference Sketch Ring, HC-CRC & E-LTT Conformal Calibration, PT-LM Loss Masking, and Omnimodal Scene Timeline', async () => {
  // 1. WASM SR-MP 512-slot Salted Reference Sketch Ring direct kernel verification
  const engine = loadMediaWasmSync();
  assert.equal(typeof engine.srmpReset, 'function', 'verisieve_media.wasm must expose srmpReset');
  assert.equal(typeof engine.srmpSeedAnchor, 'function', 'verisieve_media.wasm must expose srmpSeedAnchor');
  assert.equal(typeof engine.srmpQueryCandidate, 'function', 'verisieve_media.wasm must expose srmpQueryCandidate');

  const slotCount0 = engine.srmpReset();
  assert.equal(slotCount0, 0);

  const seed1 = engine.srmpSeedAnchor('Pentikainen', 'srmp-salt-v1', {
    entityUid: 7,
    blockIdx: 0,
    confidence: 0.94,
    kindCode: 1,
  });
  assert.ok(seed1.slotCount >= 1);
  assert.equal(seed1.entityUid, 7);

  // Query noisy ASR homophone ("Pentikaynen") and 1-char OCR typo ("Pentikalnen") against the 512-slot WASM ring
  const hitAsr = engine.srmpQueryCandidate('Pentikaynen', 'srmp-salt-v1', {
    blockIdx: 3,
    localScore: 0.24,
    minDice: 0.65,
    gamma: 0.85,
    beta: 0.20,
  });
  assert.equal(hitAsr.matched, true, 'WASM SR-MP ring must match phonetic ASR drift Pentikaynen -> Pentikainen');
  assert.equal(hitAsr.entityUid, 7);
  assert.ok(hitAsr.coupledScore >= 0.70, `Expected coupledScore >= 0.70, got ${hitAsr.coupledScore}`);

  // Query unrelated domain phrase ("Confidence") -> must NOT false-couple!
  const missDomain = engine.srmpQueryCandidate('Confidence', 'srmp-salt-v1', {
    blockIdx: 3,
    localScore: 0.22,
    minDice: 0.65,
    gamma: 0.85,
    beta: 0.20,
  });
  assert.equal(missDomain.matched, false, 'Unrelated domain noun must not couple to SR-MP anchor');
  assert.ok(missDomain.coupledScore < 0.30);

  // 2. Hierarchical Cluster-Robust Conformal Risk Control (HC-CRC) & Streaming Martingale (E-LTT)
  const mkFeat = (val, seedOffset) => {
    const row = new Float32Array(520);
    row[0] = val;
    row[512] = val;
    for (let j = 1; j < 16; j++) row[j] = Math.sin(seedOffset + j) * 0.05;
    return row;
  };
  const trainFeats = [];
  const trainLabels = [];
  for (let i = 0; i < 80; i++) {
    const isSafe = i >= 50 ? 1 : 0;
    trainFeats.push(mkFeat(isSafe ? 0.85 : -0.85, i));
    trainLabels.push(isSafe);
  }
  const gkBundle = trainGatekeeper(trainFeats, trainLabels, { epochs: 25, lr: 0.2 });

  // Build 45 correlated document clusters (35 unsafe documents with 5 correlated paragraphs each, 10 safe documents)
  const calibClusters = [];
  for (let d = 0; d < 45; d++) {
    const docUnsafe = d < 35;
    const blocks = [];
    for (let b = 0; b < 4; b++) {
      // Correlated blocks inside the same document share the same latent document score shift
      const latent = docUnsafe ? -0.75 + (d === 0 ? 0.95 : 0.0) : 0.88;
      blocks.push({
        featureRow: mkFeat(latent, d * 10 + b),
        labelSafe: docUnsafe ? 0 : 1,
      });
    }
    calibClusters.push({ clusterId: `doc_${d}`, blocks });
  }

  const hccrc = calibrateClusterRobustGatekeeper(gkBundle, calibClusters, { alpha: 0.10, delta: 0.05 });
  assert.equal(hccrc.clusterCalibration.certified, true);
  assert.ok(hccrc.clusterCalibration.designEffect >= 1.0, 'Intra-cluster correlation design effect must be >= 1.0');
  assert.ok(hccrc.clusterCalibration.tauKeep >= 0.50);

  const eltt = calibrateStreamingEProcessGatekeeper(gkBundle, calibClusters, { alpha: 0.15, delta: 0.05 });
  assert.equal(eltt.eProcessCalibration.certified, true);
  assert.ok(eltt.eProcessCalibration.maxEValue >= 20.0, 'Ville supermartingale wealth must reach >= 1/delta (20.0)');

  // 3. PT-LM (Privacy-Token Loss Masking) Span & Subword Label Masking
  const sampleAsst = 'According to APP 1, <PII:PERSON_01> must contact <PII:EMAIL_02> within 30 days using <SECRET:AWS_ACCESS_KEY_1>.';
  const ptlm = computePtlmMaskedSpans(sampleAsst);
  assert.equal(ptlm.placeholderCount, 3);
  assert.ok(ptlm.unmaskedTokenRatio > 0.50 && ptlm.unmaskedTokenRatio < 0.90);
  for (const sp of ptlm.spans) {
    const slice = sampleAsst.slice(sp.start, sp.end);
    assert.match(slice, /^<(?:PII|SECRET):[A-Z0-9_]+>$/);
  }

  // 4. Omnimodal Perceive-Everything: Audio + Video Keyframe + Presentation Slide Timeline Synchronization
  const omni = await perceiveMulti([
    {
      name: 'deck.pptx',
      bytes: buildZipBuffer([
        { name: 'ppt/slides/slide1.xml', content: '<p:sld><a:p><a:t>Architecture Lead: Dr. Markus Pentikainen (11882/10)</a:t></a:p></p:sld>' },
        { name: 'ppt/notesSlides/notesSlide1.xml', content: '<p:notes><a:p><a:t>Speaker note: confirm budget with Pentikainen</a:t></a:p></p:notes>' },
      ]),
      neuralSpans: [{ start: 23, end: 41, type: 'PERSON', score: 0.95 }],
    },
    {
      name: 'meeting.vtt',
      text: 'WEBVTT\n\n00:00:01.000 --> 00:00:06.000\n<v Host>Welcome Markus Pentikaynen to the architecture review.\n',
    },
    {
      name: 'recording.mp4',
      frames: [
        { timeMs: 2000, width: 16, height: 16, channels: 3, pixels: new Uint8Array(16 * 16 * 3).fill(20) },
      ],
    },
  ], {
    ocrProvider: async () => [{ text: 'Slide 1: Pentikalnen Review', bbox: [1, 1, 10, 6] }],
  });

  assert.ok(Array.isArray(omni.sceneTimeline) && omni.sceneTimeline.length >= 1, 'perceiveMulti must emit synchronized omnimodal sceneTimeline');
  assert.ok(omni.ptlmSftJsonl.includes('"ptlm_mask_spans"'), 'perceiveMulti must emit PT-LM loss-masked SFT records');
  assert.doesNotMatch(omni.markdown, /Pentikainen|Pentikaynen|Pentikalnen/, 'Omnimodal SR-MP must link across Slide + Audio ASR + Video OCR');
});

