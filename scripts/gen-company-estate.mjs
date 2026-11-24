#!/usr/bin/env node
/**
 * Company-estate fixture generator (Stage 10, Amnesiac Corpus ablation).
 *
 * Deterministic seeded generation of a small multi-department enterprise estate:
 * SQL dump, CSVs, plain notes, meeting transcript + WAV (2 synthetic speakers),
 * minimal .pptx deck, and .eml mail. People/org ids/project codenames recur across
 * departments and modalities — the cross-department duplication IS the fixture.
 *
 * Ground truth (entity list + occurrence spans) lives ONLY in the output manifest
 * (fixtures/company-estate-manifest.json), never inside the estate files; the engine
 * never receives the manifest. Zero egress, no external files.
 *
 * Output: fixtures/company-estate/**  +  fixtures/company-estate-manifest.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESTATE_DIR = path.join(ROOT, 'fixtures/company-estate');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/company-estate-manifest.json');
export const SEED = 20261124;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Estate population: 16 people, 4 org ids, 4 project codenames.
// Every person is addressed by exact full name + email + phone so detection and
// cross-file occurrence counts are measurable.
// ---------------------------------------------------------------------------
const MAIL_DOMAIN = 'northfield-ltd.example';
const PEOPLE = [
  ['Priya', 'Sharma'], ['Marcus', 'Bell'], ['Ondrej', 'Novak'], ['Hana', 'Ito'],
  ['Lena', 'Weber'], ['Kwame', 'Asante'], ['Tomas', 'Vidal'], ['Ines', 'Duarte'],
  ['Elena', 'Vance'], ['Ravi', 'Chandra'], ['Sarah', 'Kwon'], ['Daniel', 'Petrov'],
  ['Nadia', 'Farouk'], ['Victor', 'Adeyemi'], ['Grace', 'Okonkwo'], ['Felix', 'Marchetti'],
].map(([first, last], i) => ({
  first,
  last,
  name: `${first} ${last}`,
  email: `${first.toLowerCase()}.${last.toLowerCase()}@${MAIL_DOMAIN}`,
  phone: `+44 20 7946 ${String(900 + i * 3).padStart(4, '0')}`,
}));

const ORG_IDS = ['ORG-2271', 'ORG-3174', 'ORG-4402', 'ORG-8115'];
const PROJECT_CODES = ['AMBER', 'LANTERN', 'PEBBLE', 'QUARRY'];
const ORG_NAMES = ['Harrow Logistics Ltd', 'Calder Freight Group', 'Nuneaton Textiles plc', 'Ardwick Tooling Co'];

const EMAIL_RX = /@/g;
function spokenEmail(email) {
  return email.replace(EMAIL_RX, ' at ').replace(/\./g, ' dot ');
}
const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function spokenPhone(phone) {
  const digits = phone.replace(/[^0-9]/g, '');
  return `plus ${digits.split('').map((d) => DIGIT_WORDS[Number(d)]).join(' ')}`;
}

function sqlDump() {
  const lines = [
    '-- Northfield Ltd internal service inventory (text SQL dump, INSERT statements only)',
    'CREATE TABLE employees (emp_id INT, full_name TEXT, email TEXT, phone TEXT, department TEXT, project_code TEXT);',
    'CREATE TABLE tickets (ticket_id INT, project_code TEXT, assigned_name TEXT, org_id TEXT, summary TEXT);',
  ];
  PEOPLE.forEach((p, i) => {
    const dept = i % 2 === 0 ? 'IT' : 'BUSINESS';
    lines.push(
      `INSERT INTO employees (emp_id, full_name, email, phone, department, project_code) VALUES (${100 + i}, '${p.name}', '${p.email}', '${p.phone}', '${dept}', '${PROJECT_CODES[i % 4]}');`
    );
  });
  ORG_IDS.forEach((org, i) => {
    const owner = PEOPLE[i * 4];
    lines.push(
      `INSERT INTO tickets (ticket_id, project_code, assigned_name, org_id, summary) VALUES (${7700 + i}, '${PROJECT_CODES[i]}', '${owner.name}', '${org}', 'Rotate service credentials for ${ORG_NAMES[i]} contact ${owner.email} before the next release.');`
    );
  });
  return lines.join('\n') + '\n';
}

function itRunbook() {
  const p = PEOPLE[0], q = PEOPLE[3];
  return [
    `Service runbook — platform escalation path (IT).`,
    `Primary on-call is ${p.name}; pager escalation goes to ${q.name} after 30 minutes.`,
    `Access requests for project ${PROJECT_CODES[0]} must be mailed to ${p.email} with the ticket number.`,
    `Vendor contact for deployment approvals: ${PEOPLE[6].name}, ${PEOPLE[6].email}, ${PEOPLE[6].phone}.`,
    `The legacy deploy token ghp_TESTTOKEN0123456789abcdefghijklmnopqrstuvwxyz was rotated on 2026-11-20.`,
    `Database restore drills run on Thursdays; ${PEOPLE[5].name} keeps the checklist and pings ${PEOPLE[12].email} for sign-off.`,
  ].join('\n') + '\n';
}

function escalationNotes() {
  const p = PEOPLE[4], q = PEOPLE[9];
  return [
    `Handover notes — incident bridge, week of 2026-11-16.`,
    `Open incident INC-1043 is owned by ${p.name} (${p.phone}); deputy ${q.name} (${q.email}).`,
    `Stakeholders to contact: ${PEOPLE[10].name} for finance sign-off and ${PEOPLE[14].name} for comms.`,
    `Linked workstream: ${PROJECT_CODES[1]} under supplier ${ORG_IDS[1]}, with the same contact list as the AMBER bridge.`,
  ].join('\n') + '\n';
}

function accountsCsv() {
  const rows = ['org_id,account_name,contact_name,contact_email,contact_phone,payment_terms,project_code'];
  ORG_IDS.forEach((org, i) => {
    const contact = PEOPLE[(i * 3 + 1) % PEOPLE.length];
    rows.push(`${org},${ORG_NAMES[i]},${contact.name},${contact.email},${contact.phone},net 30,${PROJECT_CODES[(i + 2) % 4]}`);
  });
  // people recurring from the IT side as account managers on business accounts
  rows.push(`${ORG_IDS[0]},${ORG_NAMES[0]} — renewals,${PEOPLE[1].name},${PEOPLE[1].email},${PEOPLE[1].phone},net 45,${PROJECT_CODES[0]}`);
  rows.push(`${ORG_IDS[2]},${ORG_NAMES[2]} — renewals,${PEOPLE[7].name},${PEOPLE[7].email},${PEOPLE[7].phone},net 30,${PROJECT_CODES[2]}`);
  return rows.join('\n') + '\n';
}

function contractEditsCsv() {
  const rows = ['clause,editor_name,editor_email,submitted_by,reviewer,last_touched'];
  PEOPLE.forEach((p, i) => rows.push(`SLA-0${(i % 6) + 1},${p.name},${p.email},${PEOPLE[(i + 8) % PEOPLE.length].name},${PEOPLE[(i + 3) % PEOPLE.length].name},2026-11-${String(10 + (i % 10)).padStart(2, '0')}`));
  return rows.join('\n') + '\n';
}

function pricingNotes() {
  const p = PEOPLE[8], q = PEOPLE[13];
  return [
    `Renewal pricing memo (Business).`,
    `Owner: ${p.name} (${p.email}). Approvers: ${q.name} and ${PEOPLE[11].name}.`,
    `Renewal window for ${ORG_IDS[3]} closes 2026-12-01; the counter-proposal references project ${PROJECT_CODES[3]}.`,
    `Cost escalations must be logged against ${PROJECT_CODES[2]} and shared with ${PEOPLE[2].email} (IT capacity planning) before the board review.`,
  ].join('\n') + '\n';
}

const EML_KICKOFF = [
  'From: =?UTF-8?B?RWxlbmEgVmFuY2U=?= <elena.vance@northfield-ltd.example>',
  'To: it-leadership@northfield-ltd.example, business-leadership@northfield-ltd.example',
  'Subject: =?UTF-8?B?S2lja29mZiBkZWNsYXJhdGlvbiDigJQgUHJvamVjdCBBTUJFUg==?=',
  'Message-ID: <kickoff-2026-11-18@northfield-ltd.example>',
  'Date: Wed, 18 Nov 2026 09:00:00 +0000',
  '',
  'Kickoff for project AMBER lands Monday. IT lead is Priya Sharma (priya.sharma@northfield-ltd.example);',
  'vendor ORG-2271 (Nuneaton Textiles plc) renews against project PEBBLE in the same window.',
  'Phone bridge: +44 20 7946 0900 (ask for Hana Ito). Business approval: Ines Duarte.',
].join('\r\n') + '\r\n';

const EML_REVIEW = [
  'From: Sarah Kwon <sarah.kwon@northfield-ltd.example>',
  'To: Ravi Chandra <ravi.chandra@northfield-ltd.example>, Victor Adeyemi <victor.adeyemi@northfield-ltd.example>',
  'To2: daniel.petrov@northfield-ltd.example',
  'Subject: Q3 review edits — SLA clauses',
  'Message-ID: <review-q3-2026-11-20@northfield-ltd.example>',
  'Date: Fri, 20 Nov 2026 15:30:00 +0000',
  'Content-Type: multipart/mixed; boundary="BOUNDE10"',
  '',
  '--BOUNDE10',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Reviewers on the Q3 contract: Ravi Chandra, Daniel Petrov and Lena Weber (lerunbook escalation path).',
  'Finance contact for the invoice run: Ines Duarte +44 20 7946 0926. Deck for the review meeting is attached.',
  '',
  '--BOUNDE10',
  'Content-Type: text/plain; name="review-notes.txt"',
  'Content-Disposition: attachment; filename="review-notes.txt"',
  '',
  'Notes: contact Elena Vance for legal wording; escalation phone +44 20 7946 0921.',
  '--BOUNDE10--',
].join('\r\n') + '\r\n';

// ---------------------------------------------------------------------------
// Minimal real .pptx (stored ZIP): slides + speaker notes + docProps, the same
// shape the deep pptx parser expects.
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
function buildStoredZip(entries) {
  const localParts = [];
  const cdParts = [];
  let offset = 0;
  for (const { name, content } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(raw);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 8); // stored — no deflate, so the bytes are deterministic by construction
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(raw.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    localParts.push(lfh, nameBuf, raw);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(raw.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    cdParts.push(cd, nameBuf);
    offset += lfh.length + nameBuf.length + raw.length;
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

function buildDeckPptx() {
  const slide = (parts) => `<p:sld>${parts.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:sld>`;
  const deck = buildStoredZip([
    {
      name: 'docProps/core.xml',
      content: '<cp:coreProperties><dc:creator>Elena Vance</dc:creator><dc:title>Board proposal</dc:title></cp:coreProperties>',
    },
    { name: 'ppt/slides/slide1.xml', content: slide(['Board proposal — Northfield Ltd', `Prepared by ${PEOPLE[8].name}, ${PEOPLE[8].email}`, `Project ${PROJECT_CODES[3]} vs renewal ${ORG_IDS[3]}`]) },
    { name: 'ppt/slides/slide2.xml', content: slide(['Commercial terms', `Contact desk: ${PEOPLE[10].name} ${PEOPLE[10].email} ${PEOPLE[10].phone}`, `Parallel workstream: ${PROJECT_CODES[2]} (vendor ${ORG_IDS[2]})`]) },
    { name: 'ppt/notesSlides/notesSlide1.xml', content: '<p:notes><a:p><a:t>Before the board vote, call Lena Weber (+44 20 7946 0911) and confirm project AMBER staffing with Ondrej Novak.</a:t></a:p></p:notes>' },
  ]);
  return deck;
}

// ---------------------------------------------------------------------------
// Meeting WAV: 2 synthetic speakers, distinct F0, same technique as the Stage 9
// prosody fixture (mulberry32 + harmonic mix + syllable envelope, PCM16).
// ---------------------------------------------------------------------------
const SAMPLE_RATE = 16000;
const SPEAKER_F0 = { A: 112, B: 232 };
const SPEAKER_HARM = { A: [0.30, 0.10, 0.04, 0.015], B: [0.22, 0.14, 0.09, 0.05] };

// Two speakers with real identities: IT voice (A) and Business voice (B); the
// turn speech lines carry canonical email/phone/project values, one spoken form
// each so the audio path's Spoken ITN normalizes onto the same salted entities.
const SYNC_LINES = [
  ['A', 'Welcome to the weekly sync. IT agenda: project AMBER rollout and the ORG-2271 renewal.'],
  ['B', 'Business confirms the board pack; the ORG-4402 counter-proposal for project QUARRY is attached.'],
  ['A', `Platform side is on track; I will send the checklist from ${spokenEmail(PEOPLE[0].email)} this afternoon.`],
  ['B', `Legal will co-sign with Ravi Chandra; the invoice run contact stays Ines Duarte, ${spokenPhone(PEOPLE[7].phone)}.`],
  ['A', `Deployment approvals still route through Tomas Vidal; escalation phone ${spokenPhone(PEOPLE[6].phone)}.`],
  ['B', 'One risk: the notes bridge references project LANTERN, same stakeholders as today.'],
  ['A', 'Finance sign-off goes to Sarah Kwon and Daniel Petrov before Friday.'],
  ['B', 'Close. Actions owned by Priya Sharma and Elena Vance.'],
];

function buildMeetingWav() {
  const rnd = mulberry32(SEED ^ 0x57415645); // "WAVE" — distinct sub-seed so no fixture shares state
  const samples = [0.0];
  const turns = [];
  for (let t = 0; t < SYNC_LINES.length; t++) {
    const spk = SYNC_LINES[t][0];
    const f0 = SPEAKER_F0[spk] * (1 + 0.02 * (rnd() - 0.5));
    const harm = SPEAKER_HARM[spk];
    const turnStartSample = samples.length;
    const durSamples = Math.round((1.0 + 0.6 * rnd()) * SAMPLE_RATE);
    for (let i = 0; i < durSamples; i++) {
      const x = i / SAMPLE_RATE;
      const env = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4.2 * x + (spk === 'A' ? 0 : 1.3));
      const gate = env > 0.15 ? env : 0.02;
      let s = 0;
      for (let h = 1; h <= 4; h++) s += harm[h - 1] * Math.sin(h * 2 * Math.PI * f0 * x + h * (spk === 'A' ? 0.4 : 0.9));
      s = s * gate + 0.004 * (rnd() - 0.5);
      samples.push(s);
    }
    for (let i = 0; i < Math.round(0.3 * SAMPLE_RATE); i++) samples.push(0.0); // turn gap
    const startMs = Math.round(((turnStartSample - 1) / SAMPLE_RATE) * 1000);
    turns.push({ speaker: spk, startMs, endMs: startMs + Math.round((durSamples / SAMPLE_RATE) * 1000) });
  }
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  return { wav: buf, turns };
}

const DIALOGUE = buildMeetingWav();
const SPEAKER_PERSON = { A: PEOPLE[0].name, B: PEOPLE[8].name }; // the voices ARE estate people

function transcript() {
  const lines = [
    'Meeting transcript — weekly sync, Northfield Ltd (IT + Business), 2026-11-19.',
  ];
  DIALOGUE.turns.forEach((turn, i) => {
    const stamp = `${String(Math.floor(turn.startMs / 60000)).padStart(2, '0')}:${String(Math.floor((turn.startMs % 60000) / 1000)).padStart(2, '0')}`;
    lines.push(`[${stamp}] ${SPEAKER_PERSON[turn.speaker]}: ${SYNC_LINES[i][1]}`);
  });
  return lines.join('\n') + '\n';
}

function meetingVtt() {
  const vtt = ['WEBVTT', ''];
  DIALOGUE.turns.forEach((turn, i) => {
    const fmt = (ms) => `00:${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
    vtt.push(`${fmt(turn.startMs)} --> ${fmt(turn.endMs)}`);
    vtt.push(`<v ${SPEAKER_PERSON[turn.speaker]}>${SYNC_LINES[i][1]}`);
    vtt.push('');
  });
  return vtt.join('\n');
}

// ---------------------------------------------------------------------------
// Files + ground-truth occurrence scan
// ---------------------------------------------------------------------------
const FILES = [
  { path: 'it/service-inventory.sql', department: 'it', modality: 'sql', text: sqlDump },
  { path: 'it/runbook.txt', department: 'it', modality: 'text', text: itRunbook },
  { path: 'it/escalation-notes.txt', department: 'it', modality: 'text', text: escalationNotes },
  { path: 'business/accounts.csv', department: 'business', modality: 'csv', text: accountsCsv },
  { path: 'business/contract-edits.csv', department: 'business', modality: 'csv', text: contractEditsCsv },
  { path: 'business/pricing-notes.txt', department: 'business', modality: 'text', text: pricingNotes },
  { path: 'shared/kickoff-announcement.eml', department: 'shared', modality: 'email', text: () => EML_KICKOFF },
  { path: 'shared/review-q3.eml', department: 'shared', modality: 'email', text: () => EML_REVIEW },
  { path: 'meetings/weekly-sync-transcript.txt', department: 'meetings', modality: 'transcript', text: transcript, transcriptOf: 'meetings/weekly-sync.wav' },
  { path: 'meetings/weekly-sync.vtt', department: 'meetings', modality: 'captions', text: meetingVtt, transcriptOf: 'meetings/weekly-sync.wav' },
  { path: 'meetings/weekly-sync.wav', department: 'meetings', modality: 'audio', bytes: () => DIALOGUE.wav },
  { path: 'business/board-proposal.pptx', department: 'business', modality: 'deck', bytes: buildDeckPptx },
];

// GT entity kinds: every value the manifest pins, with char spans over text files.
function charSpans(hay, needle) {
  const out = [];
  let at = hay.indexOf(needle);
  while (at !== -1) {
    out.push([at, at + needle.length]);
    at = hay.indexOf(needle, at + needle.length);
  }
  return out;
}

export function generateEstate() {
  fs.mkdirSync(ESTATE_DIR, { recursive: true });
  // Atomic (tmp+rename) writes: node --test runs test files in parallel, and both the
  // ablation and company-brain suites regenerate this estate — no reader ever sees a
  // truncated fixture.
  const writeAtomic = (abs, data) => {
    const tmp = `${abs}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, data);
    // Windows EPERMs rename over a file another parallel test process still has open; it is
    // transient, so retry briefly instead of failing the whole suite.
    for (let attempt = 1; ; attempt++) {
      try {
        fs.renameSync(tmp, abs);
        return;
      } catch (e) {
        if (e.code !== 'EPERM' || attempt >= 10) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
  };
  const fileRecords = [];
  const textsByPath = new Map();
  const bytesByPath = new Map();
  for (const f of FILES) {
    const abs = path.join(ESTATE_DIR, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (f.text) {
      const text = f.text();
      writeAtomic(abs, text);
      textsByPath.set(f.path, text);
      bytesByPath.set(f.path, Buffer.from(text, 'utf8'));
      fileRecords.push({ path: f.path, department: f.department, modality: f.modality, bytes: Buffer.byteLength(text), ...(f.transcriptOf ? { transcriptOf: f.transcriptOf } : {}) });
    } else {
      const buf = f.bytes();
      writeAtomic(abs, buf);
      bytesByPath.set(f.path, buf);
      fileRecords.push({ path: f.path, department: f.department, modality: f.modality, bytes: buf.length });
    }
  }

  const modalityOf = new Map(fileRecords.map((f) => [f.path, f.modality]));
  const deptOf = new Map(fileRecords.map((f) => [f.path, f.department]));
  const entities = [];
  const pushEntity = (id, theClass, values, scanValues = values) => {
    const occurrences = [];
    const presentFiles = [];
    for (const rec of fileRecords) {
      const rel = rec.path;
      const text = textsByPath.get(rel);
      if (text !== undefined) {
        const spans = [];
        for (const v of scanValues) for (const [s, e] of charSpans(text, v)) spans.push([s, e]);
        if (spans.length) {
          occurrences.push({ file: rel, charSpans: spans });
          presentFiles.push(rel);
        }
      } else if (values.some((v) => bytesByPath.get(rel).includes(Buffer.from(v, 'utf8')))) {
        presentFiles.push(rel); // binary surface (deck/audio): value present, char spans not applicable
      }
    }
    entities.push({
      id,
      class: theClass,
      values,
      ...(scanValues === values ? {} : { spokenValues: scanValues.filter((v) => !values.includes(v)) }),
      files: presentFiles,
      departments: [...new Set(presentFiles.map((p) => deptOf.get(p)))],
      modalities: [...new Set(presentFiles.map((p) => modalityOf.get(p)))],
      occurrences,
      occurrenceCount: occurrences.reduce((n, o) => n + o.charSpans.length, 0),
    });
  };

  PEOPLE.forEach((p) =>
    pushEntity(
      `person:${p.first.toLowerCase()}-${p.last.toLowerCase()}`,
      'person',
      [p.name, p.email, p.phone],
      [p.name, p.email, p.phone, spokenEmail(p.email), spokenPhone(p.phone)]
    )
  );
  ORG_IDS.forEach((org) => pushEntity(`org:${org.toLowerCase()}`, 'org_id', [org]));
  PROJECT_CODES.forEach((code) => pushEntity(`project:${code.toLowerCase()}`, 'project_code', [code]));

  // pptx text lives inside the stored slide XML — record entity values that the deck carries
  const deckBytes = buildDeckPptx();
  const deckEntityHits = [];
  for (const e of entities) {
    const deckHits = e.values.filter((v) => deckBytes.includes(Buffer.from(v, 'utf8')));
    if (deckHits.length) deckEntityHits.push({ id: e.id, values: deckHits });
  }
  const manifest = {
    kind: 'company-estate-manifest',
    stage: 10,
    seed: SEED,
    anti_circularity_note:
      'Ground truth lives ONLY in this manifest. The estate files contain no GT markers, and nothing in this file is fed to the engine; the ablation runner reads the manifest only to score engine coverage and injected-PII counts, outside the corpus path.',
    estateDir: 'fixtures/company-estate',
    departments: ['it', 'business', 'shared', 'meetings'],
    modalities: ['sql', 'csv', 'text', 'email', 'transcript', 'captions', 'audio', 'deck'],
    audio_capture_note:
      'The caption track (meetings/weekly-sync.vtt) carries spoken-form emails/phones; in the engine those Spoken-ITN-normalize onto the same salted entities as the written forms. That linkage is engine-observed, not GT-asserted. A caller without local ASR weights supplies the caption word timeline as wordTimestamps — recorder capture, never ground truth.',
    files: fileRecords,
    population: {
      people: PEOPLE.map((p) => ({ name: p.name, email: p.email, phone: p.phone })),
      orgIds: ORG_IDS,
      orgNames: ORG_NAMES,
      projectCodes: PROJECT_CODES,
    },
    deckEntityOccurrences: deckEntityHits,
    entities,
  };
  writeAtomic(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const m = generateEstate();
  console.log(JSON.stringify({ estate: 'fixtures/company-estate', files: m.files.length, entities: m.entities.length, manifest: 'fixtures/company-estate-manifest.json' }));
}
