#!/usr/bin/env node
/**
 * Open-estate benchmark generator (Stage K6 external-validity estate).
 *
 * Binding references:
 *   docs/research-notes/2026-11-24-open-estate-dataset-hunt.md  (layered design, Section 5,
 *     and the rejection ledger: OpenSanctions and Fisher are never used here)
 *   docs/2026-11-24-parked-followups-handoff.md Item 3          (scope, founder rulings)
 *   docs/2026-11-24-noisy-estate-benchmark-spec.md              (construction discipline;
 *     the N1-N8 noise constants are applied verbatim from its Section 4 where they apply)
 *
 * Two labeled layers, never mixed in one metric (the manifest labels every document):
 *   Layer R (real identity; truth = corpus annotations): AMI/ICSI meeting transcripts taken
 *     from the QMSum repackaging (MIT; the underlying AMI/ICSI corpora are CC BY 4.0),
 *     rendered as meeting-caption fixtures in the estate schema, plus a small AMI audio
 *     slice (CC BY 4.0). Audio is never relabeled; overlay does not exist on audio.
 *   Layer O (overlay identity; truth by construction): a frozen synthetic world model
 *     projected onto real document content: deterministic identity substitution of QMSum
 *     transcript speaker labels (the audio link does not survive: recorded, not smoothed),
 *     plus synthetic email/memo/roster documents whose filler text quotes real transcript
 *     content from the same corpus. Spec noise N1-N8 applies on layer O.
 *
 * Enron slice (founder ruling, binding): when --enron <extracted maildir> is given the
 * generator renders an ADDITIONAL Enron-derived document set OUTSIDE the repository into
 * --enron-out (default: sibling dir of the extracted archive). Zero Enron bytes are ever
 * written inside the repository. The committed manifest records only the source URL, the
 * license situation (none stated), the archive SHA-256 pin and the recipe version.
 *
 * World-first: the world model is authored and frozen first; documents are seeded noisy
 * projections of it; every person mention carries its exact written surface, span and
 * N1-N8 tags in the manifest noise map. Truth is never adjusted to match documents.
 * Engine blindness: this file imports only node: builtins and reads nothing under src/.
 *
 * Output: fixtures/open-estate/**  +  fixtures/open-estate-manifest.json
 *   (--enron: additionally <enron-out>/open-estate-enron-slice-manifest.json, external)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESTATE_DIR = path.join(ROOT, 'fixtures/open-estate');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/open-estate-manifest.json');

// External input locations (downloads live outside the repository tree).
const DOWNLOADS = process.env.OPEN_ESTATE_DOWNLOADS || path.join(ROOT, '..', 'open-estate-downloads');
function argOf(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null;
}
const QMSUM_DIR = argOf('qmsum') || process.env.OPEN_ESTATE_QMSUM_DIR || path.join(DOWNLOADS, 'qmsum', 'QMSum-main', 'data');
const AMI_AUDIO_DIR = argOf('ami') || process.env.OPEN_ESTATE_AMI_DIR || path.join(DOWNLOADS, 'ami-audio');
const ENRON_DIR = argOf('enron');
const ENRON_OUT = argOf('enron-out') || (ENRON_DIR ? path.join(path.dirname(ENRON_DIR), 'open-estate-enron-slice') : null);
const ENRON_ARCHIVE = argOf('enron-archive');

export const SEED = 20261124;
const VERSION = 'open-estate-v1';

// ---------------------------------------------------------------------------
// Pinned external sources (constants: the recipe is the authority; when a
// source is available locally it is verified against these pins and the
// generator fails loudly on any mismatch).
// ---------------------------------------------------------------------------
const QMSUM_SOURCE = {
  name: 'QMSum',
  url: 'https://github.com/Yale-LILY/QMSum',
  license: 'MIT (repackaging); the underlying AMI and ICSI meeting corpora are CC BY 4.0',
  splits: ['train', 'val', 'test'],
  note:
    'Speaker fields in QMSum are canonicalized role handles (AMI meetings: Project Manager / Industrial Designer / User Interface / Marketing; ICSI meetings: Grad A-F / PhD A-F / Postdoc E), not personal names. Layer R ground truth is keyed to these corpus speaker labels exactly as distributed. This deviates from the hunt note (which expected inherited personal names) and the deviation is recorded, not smoothed.',
};
const AMI_SOURCE = {
  name: 'AMI Meeting Corpus audio',
  url: 'https://groups.inf.ed.ac.uk/ami/download/',
  license: 'CC BY 4.0',
  annotationsUrl: 'https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/ami_public_manual_1.6.2.zip',
  audioUrlPattern: 'https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus/<meeting>/audio/<meeting>.Mix-Headset.wav',
  note:
    'Real speech of real participants. Audio identity is never relabeled and carries no overlay. The committed slice is the per-meeting headset mix WAV. Ground truth is the corpus-provided participant annotation: per channel the AMI global participant id and role, recorded below from the AMI manual annotations (participants are pseudonymous corpus ids). This item runs no scorer on audio; the fixtures exist for later arms.',
};
const ENRON_SOURCE = {
  name: 'Enron email',
  url: 'https://www.cs.cmu.edu/~enron/',
  archiveName: 'enron_mail_20150507.tar.gz',
  archiveSha256: 'b3da1b3fe0369ec3140bb4fbce94702c33b7da810ec15d718b3fadf5cd748ca7',
  license:
    'No license stated on the CMU page; publicly released via the FERC investigation; the page asks users to be sensitive to the privacy of the people involved',
  note:
    'Founder ruling (binding): benchmark with the archive on this machine only; zero Enron bytes are committed to the repository, raw or derived. The Enron-derived document set is written outside the repository and every committed artifact records aggregates only.',
};

// Audio pins: per-meeting committed file, byte length, sha256, and the
// corpus-provided participant roster (channel, participant id, role) as
// recorded from the AMI manual annotations meetings.xml (CC BY 4.0).
const AUDIO_MEETINGS = [
  {
    meetingId: 'ES2002a', rel: 'audio/ES2002a.Mix-Headset.wav', bytes: 40724524, sha256: '9c76866990fcc8b84006dc32d273ad99df439090b748ebe72103bb78c3216ee7',
    participants: [
      { channel: 0, agent: 'A', participantId: 'MEE006', role: 'ID' },
      { channel: 1, agent: 'B', participantId: 'FEE005', role: 'PM' },
      { channel: 2, agent: 'C', participantId: 'MEE007', role: 'UI' },
      { channel: 3, agent: 'D', participantId: 'MEE008', role: 'ME' },
    ],
  },
  {
    meetingId: 'ES2003a', rel: 'audio/ES2003a.Mix-Headset.wav', bytes: 36472536, sha256: '41cf861afafc20e70061c6cc82b2cb1c620d630be6d13361da928f04fc00beea',
    participants: [
      { channel: 0, agent: 'A', participantId: 'MEE011', role: 'UI' },
      { channel: 1, agent: 'B', participantId: 'MEE009', role: 'PM' },
      { channel: 2, agent: 'C', participantId: 'MEE012', role: 'ME' },
      { channel: 3, agent: 'D', participantId: 'MEE010', role: 'ID' },
    ],
  },
  {
    meetingId: 'ES2004a', rel: 'audio/ES2004a.Mix-Headset.wav', bytes: 33579394, sha256: '3e2560b19bee6952c7c7ce041b0f1ea8a7ea9468044c4eea79d2a2c67e24ab0f',
    participants: [
      { channel: 0, agent: 'A', participantId: 'MEO015', role: 'UI' },
      { channel: 1, agent: 'B', participantId: 'FEE013', role: 'PM' },
      { channel: 2, agent: 'C', participantId: 'MEE014', role: 'ID' },
      { channel: 3, agent: 'D', participantId: 'FEE016', role: 'ME' },
    ],
  },
  {
    meetingId: 'ES2005a', rel: 'audio/ES2005a.Mix-Headset.wav', bytes: 15292120, sha256: 'ac33e7b18ae72931e65dc279af4b129370ad62ca6ed64299b9e35f356e3f8ed8',
    participants: [
      { channel: 0, agent: 'A', participantId: 'MEE018', role: 'ID' },
      { channel: 1, agent: 'B', participantId: 'MEO020', role: 'ME' },
      { channel: 2, agent: 'C', participantId: 'MEE017', role: 'PM' },
      { channel: 3, agent: 'D', participantId: 'FEE019', role: 'UI' },
    ],
  },
  {
    meetingId: 'IS1000a', rel: 'audio/IS1000a.Mix-Headset.wav', bytes: 50645452, sha256: '25c9a48237c1f23bc419702f89234467a1b9efedbac16d9673f52d6a8c1c6a57',
    participants: [
      { channel: 0, agent: 'A', participantId: 'FIE081', role: 'ME' },
      { channel: 1, agent: 'B', participantId: 'MIO082', role: 'PM' },
      { channel: 2, agent: 'C', participantId: 'MIO050', role: 'UI' },
      { channel: 3, agent: 'D', participantId: 'MIO016', role: 'ID' },
    ],
  },
  {
    meetingId: 'TS3003a', rel: 'audio/TS3003a.Mix-Headset.wav', bytes: 48180608, sha256: 'b6ce59ff735c234afdd94b13744aa26f6785af746170543fd03b33160e920a6d',
    participants: [
      { channel: 0, agent: 'A', participantId: 'MTD009PM', role: 'PM' },
      { channel: 1, agent: 'B', participantId: 'MTD011UID', role: 'UI' },
      { channel: 2, agent: 'C', participantId: 'MTD0010ID', role: 'ID' },
      { channel: 3, agent: 'D', participantId: 'MTD012ME', role: 'ME' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Noise constants: the noisy-estate spec Section 4 rates verbatim where they
// apply. Counts (N5 threads, N8 events, facts, docs) are scaled to the
// 60-person world and recorded here as explicit generation constants.
// ---------------------------------------------------------------------------
const NICKNAMES = {
  Robert: ['Bob'], William: ['Bill'], Elizabeth: ['Liz', 'Beth'], Katherine: ['Kathy', 'Kate'],
  Jennifer: ['Jen'], Michael: ['Mike', 'Mikey'], James: ['Jim'], Richard: ['Rick', 'Dick'],
  Thomas: ['Tom'], Margaret: ['Maggie', 'Peggy'], Susan: ['Sue'], Joseph: ['Joe'],
  Daniel: ['Dan'], David: ['Dave'], Alexandra: ['Alex', 'Sandra'], Barbara: ['Barb'], Patricia: ['Pat'],
};
const RATE = {
  N1_TOKEN: 0.06,    // 6% of name tokens in "scanned" memo/roster docs
  N2_PEOPLE: 0.30,   // 30% of people carry a nickname mention (>=1 doc each) -> 18 of 60
  N3_MENTIONS: 0.15, // initials / short form
  N4_MENTIONS: 0.20, // case / format variants
  N5_THREADS: 8,     // shared-inbox attribution threads (spec had 30 on a 250-person world)
  N7_PEOPLE: 0.10,   // stale-record people (prior email, early-window docs) -> 6 of 60
  N8_EVENTS: 3,      // promotion / rename events (spec had 8)
  PHONE_VARIANT: 0.30,
};
const POPULATION = 60;
const FACTS_ATTRS = [ // [attr, total, singleCount] scaled from the spec's 180 = 108 + 72
  ['worksIn', 14, 8], ['titled', 12, 7], ['joinedOn', 12, 8], ['ownsProject', 10, 6],
];
const FACTS_TOTAL = 48;
const FACTS_SINGLE = 29;
const DOC_PLAN = [['email', 12], ['memo', 6], ['roster', 3], ['captions-overlay', 10]];
const TIMELINE = { months: 12, stale: [1, 4], current: [9, 12], startDate: '2025-08' };
const LAYER_R = { amiMeetings: 8, icsiMeetings: 4, overlaySourceMeetings: 4, turnsPerCaptionDoc: 40 };

// ---------------------------------------------------------------------------
// Seeded randomness (one stream for the committed estate, one for the external
// Enron slice; each consumed in a fixed order, no other source).
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const int = (n) => Math.floor(rand() * n);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function seededShuffle(arr, seed) {
  const r = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function norm(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Name and org pools: a fresh, smaller cast than the noisy estate. Full-name
// uniqueness is enforced so the only same-name strings in the world are the
// designed collision pairs.
// ---------------------------------------------------------------------------
const FIRSTS = [
  'Priya', 'Marcus', 'Lena', 'Grace', 'Nadia', 'Victor', 'Felix', 'Ines',
  'Ondrej', 'Hana', 'Kwame', 'Ravi', 'Tomas', 'Ingrid', 'Stefan', 'Amara',
  'Diego', 'Yuki', 'Omar', 'Freya', 'Luca', 'Aisha', 'Milan', 'Sofia',
  'Andrei', 'Chidi', 'Marta', 'Jonah', 'Petra', 'Roshan', 'Elif', 'Bruno',
  'Anya', 'Kenji', 'Zara', 'Emil',
];
const SURNAMES = [
  'Ashgrove', 'Belmonte', 'Castellane', 'Drachmann', 'Eastlake', 'Fiorini',
  'Galbraith', 'Harrower', 'Idowu', 'Jankauskas', 'Kirkness', 'Lorrimer',
  'Montcalm', 'Northcutt', 'Oyelaran', 'Peregrine', 'Quenneville', 'Ravenna',
  'Sandovalz', 'Thackeray', 'Umberton', 'Valdenoro', 'Wexford', 'Yarrow',
  'Zaborskis', 'Almadovar', 'Brackfield', 'Crestwood', 'Delacorte', 'Elmswood',
  'Fairweather', 'Goransson', 'Hollinrake', 'Ironside', 'Jessiman', 'Kingsmill',
  'Lockridge', 'Meacham', 'Nethercote', 'Overstall', 'Pemberley', 'Ravenhill',
  'Strathairn', 'Trentham', 'Undercliff', 'Vandyken', 'Westermann', 'Yoxall',
  'Zwingmann', 'Auberon', 'Briarly', 'Chamberlaine', 'Duncastle', 'Ellerby',
  'Fenmore', 'Groveland', 'Harbottle', 'Lampeter', 'Marchmont', 'Oakhurst',
];
// 12 designed same-full-name pairs; the first 6 carry nickname-capable first
// names so the N2 arithmetic holds exactly (12 pair members + 6 singles = 18
// = 30% of 60).
const PAIR_NAMES = [
  ['Robert', 'Ferrant', true], ['William', 'Okonjo', true], ['Elizabeth', 'Trask', true],
  ['Katherine', 'Ilyes', true], ['Michael', 'Castell', true], ['James', 'Nyman', true],
  ['Priya', 'Kapadia', false], ['Marcus', 'Thorne', false], ['Ingrid', 'Solano', false],
  ['Diego', 'Amaral', false], ['Yusuf', 'Baran', false], ['Freya', 'Lindahl', false],
];
const DEPARTMENTS = ['Research', 'Finance', 'Operations', 'Legal', 'Sales', 'Support', 'Engineering', 'People'];
const TITLES = ['Analyst', 'Engineer', 'Coordinator', 'Manager', 'Team Lead', 'Specialist', 'Administrator', 'Officer', 'Asst. Director', 'Director of Ops'];
const PROJECTS = ['ORCHID', 'PENNON', 'SOLSTICE', 'TIDEWAY', 'UMBRA', 'VESPER', 'WATTLE', 'ZENITH'];
const PRODUCTS = ['Fairbank', 'Quorra', 'Lumenly', 'Stitchport', 'Nordvik', 'Asterly', 'Corvid', 'Brightmoor', 'Talloway', 'Perdita'];
const INBOX_LOCALS = ['hr', 'ops-team', 'billing', 'payroll', 'it-helpdesk', 'security', 'facilities', 'recruiting', 'legal-intake', 'procurement', 'travel-desk', 'compliance'];
const JOIN_MONTHS = [
  'August 2025', 'September 2025', 'October 2025', 'November 2025', 'December 2025',
  'January 2026', 'February 2026', 'March 2026', 'April 2026', 'May 2026', 'June 2026', 'July 2026',
];
const DOMAIN = 'helioframe.example';
const OLD_DOMAIN = 'old-helioframe.example';

// ---------------------------------------------------------------------------
// QMSum input (layer R content + overlay source content).
// ---------------------------------------------------------------------------
function assertReadable(p, what, hint) {
  if (!fs.existsSync(p)) {
    throw new Error(`open-estate generator: missing ${what} at ${p}. ${hint}`);
  }
}
assertReadable(QMSUM_DIR, 'the QMSum data directory', 'Set OPEN_ESTATE_QMSUM_DIR or pass --qmsum <dir> (the QMSum-main/data directory from https://github.com/Yale-LILY/QMSum).');

function listMeetings(dir) {
  const out = [];
  for (const domain of ['Academic', 'Product', 'Committee']) {
    for (const split of ['train', 'val', 'test']) {
      const sdir = path.join(dir, domain, split);
      if (!fs.existsSync(sdir)) continue;
      for (const f of fs.readdirSync(sdir).sort()) {
        if (!f.endsWith('.json')) continue;
        const id = f.replace(/\.json$/, '');
        const family = /^(ES|IS|TS)/.test(id) ? 'AMI' : /^(Bed|Bdb|Bmr|Bro|Buw)/.test(id) ? 'ICSI' : null;
        if (!family) continue; // committee meetings remain out of scope for this estate
        out.push({ id, family, split, p: path.join(sdir, f) });
      }
    }
  }
  return out;
}
const allMeetings = listMeetings(QMSUM_DIR);
assert.ok(allMeetings.length > 0, 'QMSum data directory yielded no AMI/ICSI meetings');

const amiAll = allMeetings.filter((m) => m.family === 'AMI');
const icsiAll = allMeetings.filter((m) => m.family === 'ICSI');
const layerRMeetings = seededShuffle(amiAll, SEED + 11).slice(0, LAYER_R.amiMeetings)
  .concat(seededShuffle(icsiAll, SEED + 12).slice(0, LAYER_R.icsiMeetings));
const usedR = new Set(layerRMeetings.map((m) => m.id));
const overlaySourceMeetings = seededShuffle(amiAll, SEED + 13).filter((m) => !usedR.has(m.id))
  .slice(0, LAYER_R.overlaySourceMeetings);
assert.equal(layerRMeetings.length, LAYER_R.amiMeetings + LAYER_R.icsiMeetings, 'layer R meeting selection');
assert.equal(overlaySourceMeetings.length, LAYER_R.overlaySourceMeetings, 'overlay source meeting selection');

function readMeeting(m) {
  const d = JSON.parse(fs.readFileSync(m.p, 'utf8'));
  return { id: m.id, family: m.family, split: m.split, turns: d.meeting_transcripts.map((t) => ({ speaker: t.speaker, content: t.content })) };
}
const layerRData = layerRMeetings.map(readMeeting);
const overlaySourceData = overlaySourceMeetings.map(readMeeting);

// ---------------------------------------------------------------------------
// 1. World model (layer O): authored first, frozen.
// ---------------------------------------------------------------------------
const people = [];
const usedNames = new Set();
const usedEmails = new Set();
const usedPhones = new Set();
const pad = (n, w) => String(n).padStart(w, '0');

function uniqueEmail(local) {
  let cur = local; let i = 1;
  while (usedEmails.has(`${cur}@${DOMAIN}`)) cur = `${local}-${++i}`;
  usedEmails.add(`${cur}@${DOMAIN}`);
  return `${cur}@${DOMAIN}`;
}
function uniquePhone() {
  for (;;) {
    const d = `5550${pad(int(1000), 3)}${pad(int(1000), 3)}`;
    if (!usedPhones.has(d)) { usedPhones.add(d); return d; }
  }
}
function phoneFormats(d) {
  return [
    `555-${d.slice(3, 6)}-${d.slice(6, 10)}`,
    `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`,
    `+1 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 10)}`,
  ];
}
function makePerson(first, last, opts = {}) {
  const fullName = `${first} ${last}`;
  if (!opts.sameNameByDesign) assert.ok(!usedNames.has(norm(fullName)), `full-name collision outside the designed pairs: ${fullName}`);
  usedNames.add(norm(fullName));
  const p = {
    personId: `person-${pad(people.length + 1, 3)}`,
    firstName: first,
    lastName: last,
    fullName,
    emails: [uniqueEmail(opts.emailLocal ?? `${first.toLowerCase()}.${last.toLowerCase()}`)],
    _digits: uniquePhone(),
    phone: null,
    department: opts.department ?? pick(DEPARTMENTS),
    title: opts.title ?? pick(TITLES),
    joinDate: pick(JOIN_MONTHS),
    project: null,
    ...opts,
  };
  p.phone = phoneFormats(p._digits)[0];
  people.push(p);
  return p;
}

const collisionPairs = [];
PAIR_NAMES.forEach(([first, last], i) => {
  const m0 = makePerson(first, last, {
    emailLocal: `${first[0].toLowerCase()}.${last.toLowerCase()}`,
    sameNameByDesign: true,
  });
  const m1 = makePerson(first, last, {
    emailLocal: `${first.toLowerCase()}.${last.toLowerCase()}`,
    sameNameByDesign: true,
  });
  for (;;) {
    m1.department = pick(DEPARTMENTS);
    m1.title = pick(TITLES);
    if (m1.department !== m0.department && m1.title !== m0.title) break;
  }
  const pair = { pairId: `pair-${pad(i + 1, 2)}`, name: `${first} ${last}`, personIds: [m0.personId, m1.personId] };
  collisionPairs.push(pair);
  for (const p of [m0, m1]) p.pairId = pair.pairId;
});
const pairOf = new Map();
for (const pair of collisionPairs) for (const id of pair.personIds) pairOf.set(id, pair);

// 6 non-pair people complete the N2 population: 12 nickname pair members
// (PAIR_NAMES rows 1-6) + 6 = 18 = 30% of 60.
const nickSingles = [];
{
  const pool = seededShuffle(Object.keys(NICKNAMES), SEED + 21);
  let made = 0;
  for (const first of pool) {
    if (made >= 6) break;
    if (PAIR_NAMES.some(([pf]) => pf === first)) continue;
    for (const last of seededShuffle(SURNAMES, SEED + 22)) {
      if (!usedNames.has(norm(`${first} ${last}`))) {
        makePerson(first, last);
        nickSingles.push(people[people.length - 1]);
        made++;
        break;
      }
    }
  }
  assert.equal(made, 6, '6 nickname singles');
}
{
  let made = 0;
  for (const first of seededShuffle(FIRSTS, SEED + 23)) {
    if (made >= POPULATION - PAIR_NAMES.length * 2 - nickSingles.length) break;
    if (NICKNAMES[first]) continue;
    for (const last of seededShuffle(SURNAMES, SEED + 24)) {
      if (!usedNames.has(norm(`${first} ${last}`))) {
        makePerson(first, last);
        made++;
        break;
      }
    }
  }
}
assert.equal(people.length, POPULATION, '60 people');
for (const p of people) {
  if (NICKNAMES[p.firstName]) {
    p._nickVariants = NICKNAMES[p.firstName];
    p._nickVariant = p._nickVariants.length > 1 ? int(p._nickVariants.length) : 0;
  }
}
const nickPeople = people.filter((p) => p._nickVariants);
assert.equal(nickPeople.length, Math.round(POPULATION * RATE.N2_PEOPLE), 'N2 population = 30% of 60');

people.forEach((p, i) => {
  if (i % 4 === 1) p.emails.push(uniqueEmail(`${p.firstName.toLowerCase()}.${p.lastName.toLowerCase()}-home`));
});

// N7 stale-record people (10%, non-pair): prior email on the old domain.
const stalePeople = shuffled(people.filter((p) => !pairOf.has(p.personId)))
  .slice(0, Math.round(POPULATION * RATE.N7_PEOPLE));
for (const p of stalePeople) {
  p.priorEmail = `${p.firstName[0].toLowerCase()}${p.lastName.toLowerCase()}@${OLD_DOMAIN}`;
  p._stale = true;
}
assert.equal(stalePeople.length, 6, '6 stale-record people');

// 16 project owners (ownsProject facts draw only from owners).
const owners = shuffled(people).slice(0, 16);
for (const [i, owner] of owners.entries()) owner.project = PROJECTS[i % PROJECTS.length];

// 12 shared inboxes.
const sharedInboxes = shuffled(INBOX_LOCALS).map((local, i) => ({
  inboxId: `inbox-${pad(i + 1, 2)}`,
  address: `${local}@${DOMAIN}`,
  department: pick(DEPARTMENTS),
}));

// ---------------------------------------------------------------------------
// 2. Facts (48 = 29 single-doc + 19 multi-doc; 3 of the multi are promotions).
// Designed collision-pair members hold no facts: their identity stress lives in
// rosters, captions and case-variant mentions, not in multi-doc statement joins.
// ---------------------------------------------------------------------------
assert.equal(FACTS_ATTRS.reduce((n, [, t]) => n + t, 0), FACTS_TOTAL, 'facts total');
assert.equal(FACTS_ATTRS.reduce((n, [, , s]) => n + s, 0), FACTS_SINGLE, 'single-doc facts');

const byId = new Map();
const facts = [];
for (const [attr, total, singleCount] of FACTS_ATTRS) {
  const seen = new Set();
  const holders = [];
  for (;;) {
    const p = pick(people);
    if (pairOf.has(p.personId)) continue;
    if (attr === 'ownsProject' && !p.project) continue;
    const key = `${p.personId}|${attr}`;
    if (seen.has(key)) continue;
    // titled facts exclude stale-record people: N8 promotion events need the
    // before/after pair on one person's docs and must not fight N7 over them
    if (attr === 'titled' && p._stale) continue;
    if (attr === 'ownsProject' && p._stale) continue;
    seen.add(key);
    holders.push(p);
    if (holders.length === total) break;
  }
  shuffled(holders).forEach((p, i) => {
    const value = attr === 'worksIn' ? p.department
      : attr === 'titled' ? p.title
        : attr === 'joinedOn' ? p.joinDate
          : p.project;
    facts.push({
      factId: `fact-${pad(facts.length + 1, 3)}`,
      personId: p.personId,
      attr,
      value,
      singleDoc: i < singleCount,
      statementDocs: [],
    });
  });
}
for (const p of people) byId.set(p.personId, p);

// 3 promotion/rename events among the multi-doc titled facts (stale people
// excluded so the noise mechanisms never fight over one mention).
{
  const candidates = shuffled(facts.filter((f) => f.attr === 'titled' && !f.singleDoc));
  let made = 0;
  for (const f of candidates) {
    if (made === RATE.N8_EVENTS) break;
    const p = byId.get(f.personId);
    if (p._stale) continue;
    let before = pick(TITLES);
    while (before === p.title) before = pick(TITLES);
    f.promotion = { titleBefore: before, eventMonth: 5 + int(3) };
    p.promotion = f.promotion;
    made++;
  }
  assert.equal(made, RATE.N8_EVENTS, '3 promotion events');
}

// ---------------------------------------------------------------------------
// 3. Overlay documents, months, occurrence deal, statement routing.
// ---------------------------------------------------------------------------
const docs = [];
for (const [modality, count] of DOC_PLAN) {
  for (let i = 1; i <= count; i++) {
    const stem = { email: 'mail/thread', memo: 'memos/memo', roster: 'rosters/roster', 'captions-overlay': 'overlay-captions/caption' }[modality];
    const ext = modality === 'email' ? 'eml' : modality === 'roster' ? (i <= 2 ? 'csv' : 'sql') : modality === 'captions-overlay' ? 'vtt' : 'txt';
    docs.push({
      path: `${stem}-${pad(i, 2)}.${ext}`,
      modality,
      format: ext,
      layer: 'overlay',
      month: modality === 'roster'
        ? TIMELINE.current[0] + int(TIMELINE.current[1] - TIMELINE.current[0] + 1)
        : 1 + int(TIMELINE.months),
      capacity: { email: 4, memo: 6, roster: 25, 'captions-overlay': 6 }[modality],
      assignments: [],
      n5: null,
    });
  }
}
assert.equal(docs.length, 31, '31 overlay documents');
for (const d of docs) {
  const off = d.month - 1 + 7;
  const year = 2025 + Math.floor(off / 12);
  const mon = (off % 12) + 1;
  d.date = `${year}-${pad(mon, 2)}-${pad(1 + int(28), 2)}`;
}

const rosterOrder = shuffled(people);
const rosterDocs = docs.filter((d) => d.modality === 'roster');
rosterOrder.forEach((p, i) => { p.rosterPath = rosterDocs[Math.floor(i / 25)].path; });

// occurrence deal: 2 non-roster documents per person (A, B), B forced to a
// different modality so >=2-modality coverage holds by construction; stale
// people land one doc in months 1-4 (N7); promotion people straddle their event.
const slots = [];
for (const d of docs) if (d.modality !== 'roster') for (let s = 0; s < d.capacity; s++) slots.push(d);
const dealSlots = shuffled(slots);
function takeSlot(pred, why) {
  const idx = pred ? dealSlots.findIndex(pred) : 0;
  assert.ok(idx !== -1, `slot pool exhausted: ${why}`);
  return dealSlots.splice(idx, 1)[0];
}
for (const p of shuffled(people)) {
  if (p._stale) {
    const a = takeSlot((d) => d.month <= TIMELINE.stale[1] && (d.modality === 'email' || d.modality === 'memo'), `stale A ${p.personId}`);
    p.docA = a; a.assignments.push(p.personId);
    const b = takeSlot((d) => d !== a && d.modality !== a.modality, `stale B ${p.personId}`);
    p.docB = b; b.assignments.push(p.personId);
  } else if (p.promotion) {
    const a = takeSlot((d) => d.month < p.promotion.eventMonth, `event A ${p.personId}`);
    p.docA = a; a.assignments.push(p.personId);
    const b = takeSlot((d) => d !== a && d.modality !== a.modality && d.month >= TIMELINE.current[0], `event B ${p.personId}`);
    p.docB = b; b.assignments.push(p.personId);
  } else {
    const a = takeSlot(null, `A ${p.personId}`);
    p.docA = a; a.assignments.push(p.personId);
    const b = takeSlot((d) => d !== a && d.modality !== a.modality, `B ${p.personId}`);
    p.docB = b; b.assignments.push(p.personId);
  }
}
const MIN_PARTICIPANTS = { email: 2, memo: 2, 'captions-overlay': 3 };
{
  const order = shuffled(people);
  let at = 0;
  for (const d of docs) {
    if (d.modality === 'roster') continue;
    while (d.assignments.length < MIN_PARTICIPANTS[d.modality]) d.assignments.push(order[at++ % order.length].personId);
  }
}

// N5: 8 email threads carry one shared inbox each; the responsible person is
// named only in the body.
const n5Docs = [];
for (const d of shuffled(docs.filter((x) => x.modality === 'email' && x.assignments.length >= 2))) {
  n5Docs.push(d);
  if (n5Docs.length === RATE.N5_THREADS) break;
}
assert.equal(n5Docs.length, RATE.N5_THREADS, '8 shared-inbox threads');
shuffled(sharedInboxes).forEach((inbox, i) => { if (n5Docs[i]) n5Docs[i].n5 = inbox; });

const docStatements = new Map(docs.map((d) => [d.path, []]));
const addStatement = (docPath, fact, idx) => docStatements.get(docPath).push({ fact, idx });
for (const fact of facts) {
  const p = byId.get(fact.personId);
  if (fact.promotion) {
    fact.statementDocs = [p.docA.path, p.docB.path];
    addStatement(p.docA.path, fact, 0);
    addStatement(p.docB.path, fact, 1);
  } else if (fact.attr === 'worksIn' || fact.attr === 'ownsProject') {
    fact.statementDocs = [p.rosterPath];
    addStatement(p.rosterPath, fact, 0);
    if (!fact.singleDoc) {
      const extra = chance(0.5) ? p.docA : p.docB;
      fact.statementDocs.push(extra.path);
      addStatement(extra.path, fact, 1);
    }
  } else {
    fact.statementDocs = [p.docA.path];
    addStatement(p.docA.path, fact, 0);
    if (!fact.singleDoc) {
      fact.statementDocs.push(p.docB.path);
      addStatement(p.docB.path, fact, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Deterministic identity substitution: each overlay-source meeting gets a
// frozen speaker-label -> overlay-person map, authored before the documents. Two
// meetings intentionally map both members of one collision pair onto two
// different meeting speakers: the designed collision stress of the layer.
// ---------------------------------------------------------------------------
const substitutionMaps = [];
{
  const pairStarts = shuffled(collisionPairs).slice(0, 2);
  for (const [mi, m] of overlaySourceData.entries()) {
    const labels = [];
    for (const t of m.turns) if (!labels.includes(t.speaker)) labels.push(t.speaker);
    assert.ok(labels.length >= 2 && labels.length <= 6, `overlay source meeting ${m.id} speaker count`);
    const map = { meetingId: m.id, labels: [], note: 'the audio link does not survive substitution: recorded' };
    const pool = shuffled(people.filter((p) => !pairOf.has(p.personId) && !substitutionMaps.some((sm) => sm.labels.some((l) => l.personId === p.personId))));
    let pi = 0;
    const pair = pairStarts[mi === 0 ? 0 : mi === 2 ? 1 : -1] || null;
    labels.forEach((label, li) => {
      let person;
      if (pair && li < 2) {
        person = byId.get(pair.personIds[li]);
      } else {
        person = pool[pi++ % pool.length];
      }
      map.labels.push({ label, personId: person.personId });
    });
    substitutionMaps.push(map);
  }
  assert.equal(substitutionMaps.length, overlaySourceData.length, 'substitution maps authored');
}

// quote pool: real transcript content (verbatim utterances, disfluency markers
// stripped) used as the filler layer of overlay email/memo documents.
const quotePool = [];
for (const m of overlaySourceData) {
  for (let i = 0; i < m.turns.length; i += 7) {
    const text = m.turns[i].content.replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    if (text.length >= 25) quotePool.push({ meeting: m.id, text });
  }
}
assert.ok(quotePool.length >= 100, 'quote pool size');

// ---------------------------------------------------------------------------
// 5. Mention machinery: every person reference passes through the noise
// application; the noise map records surface, span and N1-N8 tags. Layer R
// mentions are recorded with no overlay and no noise (corpus labels, as-is).
// ---------------------------------------------------------------------------
const layerOMentions = [];
const layerRMentions = [];
const noiseSummary = { N1: 0, N2: 0, N3: 0, N4: 0, N5: 0, N6: 0, N7: 0, N8: 0 };
const nickDone = new Set();
const statementSurfaces = new Map();
const emittedStatements = new Map();

function newDoc(def) { return { def, text: '', len: 0, mentions: [] }; }
function put(st, s) { st.text += s; st.len = st.text.length; }
function recordMention(list, st, personId, kind, surface, noises, start) {
  const rec = {
    mentionId: `m-${pad(list.length + 1, 5)}`,
    doc: st.def.path,
    layer: st.def.layer,
    personId,
    kind,
    surface,
    noises,
    charStart: start,
    charEnd: st.len,
  };
  st.mentions.push(rec);
  list.push(rec);
  return rec;
}
function writeMentionSurface(st, list, personId, kind, surface, noises) {
  const start = st.len;
  put(st, surface);
  recordMention(list, st, personId, kind, surface, noises, start);
  return surface;
}
function refMention(st, person, kind, surface, noises) {
  const tagged = noises.slice();
  if (person.pairId && kind === 'name' && norm(surface) === norm(person.fullName)) tagged.push('N6');
  for (const n of tagged) noiseSummary[n]++;
  return writeMentionSurface(st, layerOMentions, person.personId, kind, surface, tagged);
}
function refName(st, person, mode = 'roll', extraTags = []) {
  const doc = st.def;
  const noises = [];
  let surface;
  const nickPending = person._nickVariants && !nickDone.has(person.personId) && doc.modality !== 'roster';
  if (nickPending) {
    surface = `${person._nickVariants[person._nickVariant]} ${person.lastName}`;
    noises.push('N2');
    nickDone.add(person.personId);
  } else if (mode === 'canonicalBase' || doc.modality === 'roster') {
    surface = `${person.firstName} ${person.lastName}`;
  } else if (mode === 'variantBase') {
    const canonical = norm(`${person.firstName} ${person.lastName}`);
    const cands = [{ s: `${person.lastName.toUpperCase()}, ${person.firstName.toUpperCase()}`, n: 'N4' }];
    if (!pairOf.has(person.personId)) cands.push({ s: `${person.firstName[0]}. ${person.lastName}`, n: 'N3' });
    if (person._nickVariants) cands.push({ s: `${person._nickVariants[person._nickVariant]} ${person.lastName}`, n: 'N2' });
    const cand = cands.find((c) => norm(c.s) !== canonical) || cands[0];
    surface = cand.s;
    noises.push(cand.n);
  } else if (doc.modality === 'captions-overlay' && person._nickVariants) {
    surface = `${person._nickVariants[person._nickVariant]} ${person.lastName}`;
    noises.push('N2');
    nickDone.add(person.personId);
  } else {
    const u = rand();
    if (u < RATE.N3_MENTIONS && !pairOf.has(person.personId)) {
      surface = `${person.firstName[0]}. ${person.lastName}`; // initials only where locally unambiguous
      noises.push('N3');
    } else if (u < RATE.N3_MENTIONS + RATE.N4_MENTIONS) {
      surface = chance(0.5)
        ? `${person.lastName.toUpperCase()}, ${person.firstName.toUpperCase()}`
        : `${person.firstName.toUpperCase()} ${person.lastName.toUpperCase()}`;
      noises.push('N4');
    } else {
      surface = `${person.firstName} ${person.lastName}`;
    }
  }
  if ((doc.modality === 'memo' || doc.modality === 'roster') && !noises.includes('N3') && surface.includes(' ')) {
    const corrupted = applyN1(surface);
    if (corrupted !== surface) { surface = corrupted; noises.push('N1'); }
  }
  for (const tag of extraTags) noises.push(tag);
  return refMention(st, person, 'name', surface, noises);
}
function refEmail(st, person) {
  if (person._stale && st.def.month <= TIMELINE.stale[1]) {
    return refMention(st, person, 'email', person.priorEmail, ['N7']);
  }
  return refMention(st, person, 'email', person.emails[0], []);
}
function refPhone(st, person) {
  if (chance(RATE.PHONE_VARIANT)) {
    return refMention(st, person, 'phone', phoneFormats(person._digits)[1 + int(2)], ['N4']);
  }
  return refMention(st, person, 'phone', phoneFormats(person._digits)[0], []);
}

const NEIGHBORS = {
  a: 'sq', b: 'vn', c: 'xv', d: 'sf', e: 'wr', f: 'dg', g: 'fh', h: 'gj', i: 'uo', j: 'hk',
  k: 'jl', l: 'ko', m: 'n', n: 'bm', o: 'ip', p: 'o', q: 'w', r: 'et', s: 'ad', t: 'ry',
  u: 'yi', v: 'cb', w: 'qe', x: 'zc', y: 'tu', z: 'x',
};
function corruptToken(token) {
  if (token.length < 2) return token;
  const op = pick(['sub', 'drop', 'double', 'ocr']);
  const letters = [];
  for (let i = 0; i < token.length; i++) if (/[a-z]/i.test(token[i])) letters.push(i);
  if (!letters.length) return token;
  const at = letters[int(letters.length)];
  const ch = token[at];
  const low = ch.toLowerCase();
  if (op === 'ocr') {
    if (token.includes('rn')) return token.replace('rn', 'm');
    if (/[lO1I]/.test(token)) return token.replace(/[lO1I]/, (mm) => (mm === 'l' ? '1' : '0'));
    if (NEIGHBORS[low]) return token.slice(0, at) + (ch === low ? NEIGHBORS[low][0] : NEIGHBORS[low][0].toUpperCase()) + token.slice(at + 1);
    return token;
  }
  if (op === 'sub') {
    const reps = NEIGHBORS[low];
    if (!reps) return token;
    return token.slice(0, at) + (ch === low ? reps[int(reps.length)] : reps[int(reps.length)].toUpperCase()) + token.slice(at + 1);
  }
  if (op === 'double') return token.slice(0, at) + ch + token.slice(at);
  return token.slice(0, at) + token.slice(at + 1); // drop
}
function applyN1(surface) {
  let changed = false;
  const out = surface.split(' ').map((tok) => {
    if (chance(RATE.N1_TOKEN)) { changed = true; return corruptToken(tok); }
    return tok;
  }).join(' ');
  return changed ? out : surface;
}

function statementsFor(docPath, personId) {
  return (docStatements.get(docPath) || []).filter((it) => it.fact.personId === personId);
}
const ATTR_SUFFIX = (attr, value) => ({
  worksIn: ` works in ${value}.`,
  titled: ` serves as ${value}.`,
  joinedOn: ` joined in ${value}.`,
  ownsProject: ` owns project ${value}.`,
}[attr]);

function statementLine(st, item, extraTags = []) {
  const { fact, idx } = item;
  const person = byId.get(fact.personId);
  const value = fact.promotion ? (idx === 0 ? fact.promotion.titleBefore : fact.value) : fact.value;
  const tags = extraTags.slice();
  if (fact.promotion) tags.push('N8');
  put(st, ' ');
  const surface = refName(st, person, idx === 0 ? 'canonicalBase' : 'variantBase', tags);
  if (!statementSurfaces.has(fact.factId)) statementSurfaces.set(fact.factId, []);
  statementSurfaces.get(fact.factId).push(surface);
  if (!emittedStatements.has(fact.factId)) emittedStatements.set(fact.factId, new Set());
  emittedStatements.get(fact.factId).add(st.def.path);
  let suffix = ATTR_SUFFIX(fact.attr, value);
  if (fact.promotion && idx === 0) suffix = suffix.replace('serves as', 'served as');
  put(st, suffix);
}

function fillerLine(st, person, docType) {
  if (docType === 'captions-overlay') {
    put(st, '- carried over from the meeting record: "' + pick(quotePool).text + '"');
    return;
  }
  if (chance(0.35)) {
    put(st, 'Ping ');
    refName(st, person);
    put(st, ' on ');
    refPhone(st, person);
    put(st, ' if the queue backs up.');
    return;
  }
  refName(st, person);
  put(st, ` is on the follow-up below, quoting the meeting record: "${pick(quotePool).text}"`);
}

// --- email threads (overlay) -------------------------------------------------
function emitEmail(def) {
  const st = newDoc(def);
  const parts = def.assignments.map((id) => byId.get(id));
  const stmts = docStatements.get(def.path) || [];
  const responsible = def.n5 ? parts[1 % parts.length] : null;
  const chunks = [[], [], [], []];
  let ci = 0;
  for (const item of stmts) {
    if (def.n5 && item.fact.personId === responsible.personId) continue;
    chunks[ci++ % chunks.length].push(item);
  }
  const subject = `Subject: ${pick([`${pick(PROJECTS)} planning`, `${pick(PRODUCTS)} rollout update`, `${pick(DEPARTMENTS)} review`, `follow-up: ${pick(PROJECTS)} handover`])}`;
  for (let k = 0; k < 4; k++) {
    const from = parts[k % parts.length];
    const to = parts[(k + 1) % parts.length];
    put(st, 'From: ');
    refName(st, from);
    put(st, ' <');
    refEmail(st, from);
    put(st, '>\r\nTo: ');
    refName(st, to);
    put(st, ' <');
    refEmail(st, to);
    put(st, `>\r\n${subject}\r\nMessage-ID: <${def.path.replace('/', '-')}-msg-${k + 1}@${DOMAIN}>\r\nDate: ${def.date}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n`);
    const body = chunks[k];
    if (body.length) for (const item of body) { statementLine(st, item); put(st, '\r\n'); }
    else { fillerLine(st, from, 'email'); put(st, '\r\n'); }
    put(st, '\r\n');
  }
  if (def.n5) {
    const to = parts[0];
    put(st, 'From: ' + def.n5.address + '\r\nTo: ');
    refName(st, to);
    put(st, ' <');
    refEmail(st, to);
    put(st, `>\r\n${subject}\r\nMessage-ID: <${def.path.replace('/', '-')}-msg-5@${DOMAIN}>\r\nDate: ${def.date}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n`);
    const respStmts = stmts.filter((it) => it.fact.personId === responsible.personId);
    if (respStmts.length) for (const item of respStmts) { statementLine(st, item, ['N5']); put(st, '\r\n'); }
    else {
      put(st, 'The ');
      put(st, def.n5.address);
      put(st, ' queue item needs an owner: ');
      refName(st, responsible, 'roll', ['N5']);
      put(st, ' will handle the ');
      put(st, def.n5.address.split('@')[0]);
      put(st, ' request this week.\r\n');
    }
    put(st, '\r\n');
  }
  return st;
}

// --- memos (overlay) ---------------------------------------------------------
function emitMemo(def) {
  const st = newDoc(def);
  const parts = def.assignments.map((id) => byId.get(id));
  put(st, `INTERNAL MEMO\nDate: ${def.date}\nRe: ${pick([`${pick(PROJECTS)} staffing`, `${pick(DEPARTMENTS)} planning`, `${pick(PRODUCTS)} follow-up`, 'records cleanup'])}\nFrom: Corporate Communications\n\n`);
  for (const p of parts) {
    const mine = statementsFor(def.path, p.personId);
    if (mine.length) for (const item of mine) { statementLine(st, item); put(st, ' '); }
    else fillerLine(st, p, 'memo');
    put(st, '\n\n');
    if (p._stale && def.month <= TIMELINE.stale[1]) {
      put(st, 'Until the mailbox cutover, reach ');
      refName(st, p);
      put(st, ' at ');
      refEmail(st, p);
      put(st, '.\n\n');
    }
  }
  return st;
}

// --- rosters (overlay) -------------------------------------------------------
function recordRosterStatement(fact, nameSurface, def) {
  if (!statementSurfaces.has(fact.factId)) statementSurfaces.set(fact.factId, []);
  statementSurfaces.get(fact.factId).push(nameSurface);
  if (!emittedStatements.has(fact.factId)) emittedStatements.set(fact.factId, new Set());
  emittedStatements.get(fact.factId).add(def.path);
}
function emitRoster(def, index) {
  const st = newDoc(def);
  const members = rosterOrder.slice(index * 25, (index + 1) * 25);
  const slate = docStatements.get(def.path) || [];
  const header = `# Helioframe consolidated directory export - shard ${index + 1} of 3 (${def.date})`;
  if (def.format === 'csv') {
    put(st, `${header}\nfull_name,email,phone,department,project\n`);
    for (const p of members) {
      const mine = slate.filter((it) => it.fact.personId === p.personId);
      const name = refName(st, p); // canonical base, N1 typos per token
      for (const item of mine) recordRosterStatement(item.fact, name, def);
      put(st, ',');
      refEmail(st, p);
      put(st, ',');
      refPhone(st, p);
      put(st, `,${p.department},${p.project ?? ''}\n`);
    }
  } else {
    put(st, `${header}\nCREATE TABLE roster (full_name TEXT, email TEXT, phone TEXT, department TEXT, project TEXT);\n`);
    for (const p of members) {
      const mine = slate.filter((it) => it.fact.personId === p.personId);
      put(st, `INSERT INTO roster VALUES ('`);
      const name = refName(st, p); // canonical base, N1 typos per token
      for (const item of mine) recordRosterStatement(item.fact, name, def);
      put(st, `', `);
      refEmail(st, p);
      put(st, `, `);
      refPhone(st, p);
      put(st, `, '${p.department}', ${p.project ? `'${p.project}'` : 'NULL'});\n`);
    }
  }
  return st;
}

// --- overlay captions (real meeting content, identity substituted) -----------
// Per-meeting cue surfaces are frozen with the substitution map: the same
// meeting label always renders as the same overlay person surface in this
// generation.
const captionDocDefs = docs.filter((d) => d.modality === 'captions-overlay');
const captionSlices = [];
{
  const per = [3, 3, 2, 2];
  let pos = 0;
  for (const [mi, m] of overlaySourceData.entries()) {
    for (let k = 0; k < per[mi]; k++) {
      captionSlices.push({ meeting: m, start: pos + k * LAYER_R.turnsPerCaptionDoc, len: LAYER_R.turnsPerCaptionDoc });
    }
    pos += per[mi] * LAYER_R.turnsPerCaptionDoc;
  }
  captionSlices.forEach((s, i) => { captionDocDefs[i].meetingId = s.meeting.id; });
  assert.equal(captionSlices.length, captionDocDefs.length, 'caption slices');
}
for (const s of captionSlices) {
  assert.ok(s.start + s.len <= s.meeting.turns.length,
    `overlay source meeting ${s.meeting.id} has enough turns for its caption docs`);
}
const cuePlans = new Map();
for (const map of substitutionMaps) {
  const perLabel = new Map();
  for (const { label, personId } of map.labels) {
    const person = byId.get(personId);
    const u = rand();
    let surface; let noises;
    if (person._nickVariants && !nickDone.has(person.personId)) {
      surface = `${person._nickVariants[person._nickVariant]} ${person.lastName}`;
      noises = ['N2'];
      nickDone.add(person.personId);
    } else if (u < RATE.N3_MENTIONS && !pairOf.has(person.personId)) {
      surface = `${person.firstName[0]}. ${person.lastName}`;
      noises = ['N3'];
    } else if (u < RATE.N3_MENTIONS + RATE.N4_MENTIONS) {
      surface = `${person.firstName.toUpperCase()} ${person.lastName.toUpperCase()}`;
      noises = ['N4'];
    } else {
      surface = `${person.firstName} ${person.lastName}`;
      noises = [];
    }
    perLabel.set(label, { personId, surface, noises });
  }
  cuePlans.set(map.meetingId, perLabel);
}
function emitCaptionOverlay(def) {
  const st = newDoc(def);
  const slice = captionSlices[captionDocDefs.indexOf(def)];
  const cueMap = cuePlans.get(def.meetingId);
  put(st, `WEBVTT\nNOTE\noverlay layer - caption render of meeting transcript ${def.meetingId}; real content, identity substituted; the audio link does not survive\n${def.date}\n\n`);
  const fmt = (ms) => `00:${pad(Math.floor(ms / 60000), 2)}:${pad(Math.floor((ms % 60000) / 1000), 2)}.${pad(ms % 1000, 3)}`;
  const escs = [...cueMap.keys()].map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const labelRx = new RegExp(`(${escs.join('|')})`, 'g');
  const cueTimes = new Map();
  slice.meeting.turns.slice(slice.start, slice.start + slice.len).forEach((t, i) => {
    const cue = cueMap.get(t.speaker);
    assert.ok(cue, `cue plan for ${t.speaker} in ${def.meetingId}`);
    const start = 2000 + i * 7000;
    put(st, `${fmt(start)} --> ${fmt(start + 6000)}\n<v `);
    // cue mention: frozen substitution surface for this label, person-keyed truth
    const person = byId.get(cue.personId);
    const taggedCue = cue.noises.slice();
    if (person.pairId && norm(cue.surface) === norm(person.fullName)) taggedCue.push('N6');
    for (const n of taggedCue) noiseSummary[n]++;
    writeMentionSurface(st, layerOMentions, person.personId, 'name', cue.surface, taggedCue);
    put(st, '> ');
    // real utterance content, verbatim (disfluency markers stripped); every
    // occurrence of a meeting speaker label inside the content is substituted
    // with the mapped person's canonical name and recorded as a mention.
    const content = t.content.replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    labelRx.lastIndex = 0;
    let pos = 0;
    let match;
    while ((match = labelRx.exec(content))) {
      put(st, content.slice(pos, match.index));
      const cue2 = cueMap.get(match[1]);
      const p2 = byId.get(cue2.personId);
      const surface2 = `${p2.firstName} ${p2.lastName}`;
      const tags2 = [];
      if (p2.pairId && norm(surface2) === norm(p2.fullName)) tags2.push('N6');
      for (const n of tags2) noiseSummary[n]++;
      writeMentionSurface(st, layerOMentions, p2.personId, 'name', surface2, tags2);
      pos = match.index + match[0].length;
    }
    put(st, content.slice(pos));
    put(st, '\n\n');
  });
  // follow-up section: routed statements for the doc's assigned people
  put(st, 'NOTE follow-up section\n');
  for (const p of def.assignments.map((id) => byId.get(id))) {
    const mine = statementsFor(def.path, p.personId);
    if (mine.length) for (const item of mine) { statementLine(st, item); put(st, ' '); }
    else fillerLine(st, p, 'captions-overlay');
    put(st, '\n\n');
  }
  return st;
}

// emit every overlay document in fixed order
const docTexts = [];
let rosterIndex = 0;
docs.forEach((def) => {
  const st = def.modality === 'email' ? emitEmail(def)
    : def.modality === 'memo' ? emitMemo(def)
      : def.modality === 'roster' ? emitRoster(def, rosterIndex++)
        : emitCaptionOverlay(def);
  docTexts.push(st);
});

// ---------------------------------------------------------------------------
// 5b. Layer R documents: real AMI/ICSI transcripts rendered as caption fixtures;
// no overlay, no noise; truth = the corpus's own speaker labels.
// ---------------------------------------------------------------------------
const realPeople = new Map(); // personId -> {personId, meetingId, speakerLabel, corpus}
for (const m of layerRData) {
  const def = {
    path: `real-transcripts/real-${m.id}.vtt`,
    modality: 'captions-real',
    format: 'vtt',
    layer: 'real',
    meetingId: m.id,
    corpus: m.family,
    date: `source-split-${m.split}`,
  };
  const st = newDoc(def);
  put(st, `WEBVTT\nNOTE\nreal layer - meeting transcript ${m.id} (${m.family}); corpus speaker labels as distributed; QMSum repackaging (MIT) of AMI/ICSI (CC BY 4.0)\nno overlay, no relabeling; truth = corpus annotations\n\n`);
  const fmt = (ms) => `00:${pad(Math.floor(ms / 60000), 2)}:${pad(Math.floor((ms % 60000) / 1000), 2)}.${pad(ms % 1000, 3)}`;
  for (const t of m.turns) {
    const sp = t.speaker;
    const pid = `real-${m.id}-${norm(sp).replace(/\s+/g, '-')}`;
    if (!realPeople.has(pid)) {
      realPeople.set(pid, { personId: pid, meetingId: m.id, speakerLabel: sp, corpus: m.family, docs: [def.path], turns: 0 });
    } else {
      realPeople.get(pid).turns++;
    }
    const start = 1000 + st.turnCount * 6000;
    put(st, `${fmt(start)} --> ${fmt(start + 5000)}\n<v `);
    writeMentionSurface(st, layerRMentions, pid, 'name', sp, []);
    put(st, `> ${t.content.replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim()}\n\n`);
  }
  docTexts.push(st);
}

// ---------------------------------------------------------------------------
// 6. Post-conditions.
// ---------------------------------------------------------------------------
const textByPath = new Map(docTexts.map((st) => [st.def.path, st.text]));

// a) every routed overlay statement was emitted exactly once, in exactly its routed docs
for (const fact of facts) {
  const emitted = emittedStatements.get(fact.factId) ?? new Set();
  assert.deepEqual([...emitted].sort(), [...fact.statementDocs].sort(), `fact ${fact.factId} statement routing`);
}
// b) multi-doc overlay facts join on genuinely different surfaces
for (const fact of facts.filter((f) => !f.singleDoc)) {
  const surfaces = statementSurfaces.get(fact.factId) || [];
  assert.ok(surfaces.length >= 2, `fact ${fact.factId} must have 2 statement surfaces`);
  assert.notEqual(norm(surfaces[0]), norm(surfaces[1]), `fact ${fact.factId} statements must use different surface forms`);
}
// c) overlay mention coverage: >=2 docs and >=2 modalities per person
{
  const modOf = new Map(docs.map((d) => [d.path, d.modality]));
  const seen = new Map(people.map((p) => [p.personId, new Map()]));
  for (const men of layerOMentions) {
    const seenP = seen.get(men.personId);
    assert.ok(seenP, `overlay mention references a known person (${men.personId})`);
    seenP.set(men.doc, modOf.get(men.doc));
  }
  for (const [pid, docsSeen] of seen) {
    assert.ok(docsSeen.size >= 2, `person ${pid} must appear in >=2 documents, got ${docsSeen.size}`);
    assert.ok(new Set(docsSeen.values()).size >= 2, `person ${pid} must appear in >=2 modalities`);
  }
}
// d) noise completeness on layer O
{
  for (const n of ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8']) {
    assert.ok(noiseSummary[n] > 0, `noise type ${n} must occur on layer O (${noiseSummary[n]})`);
  }
}
// e) layer R spans and entity sanity
{
  for (const men of layerRMentions) {
    assert.equal(textByPath.get(men.doc).slice(men.charStart, men.charEnd), men.surface, `layer R mention ${men.mentionId} must sit at its span`);
  }
  assert.ok(realPeople.size >= 40, `layer R must carry >=40 meeting-speaker entities, got ${realPeople.size}`);
}
// f) every overlay mention span sits at its recorded surface
for (const men of layerOMentions) {
  assert.equal(textByPath.get(men.doc).slice(men.charStart, men.charEnd), men.surface, `layer O mention ${men.mentionId} must sit at its span`);
}

// ---------------------------------------------------------------------------
// 7. Audio slice (committed under fixtures/open-estate/audio).
// ---------------------------------------------------------------------------
function fileHash(abs) {
  const buf = fs.readFileSync(abs);
  return { bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}
const audioRecords = [];
for (const pin of AUDIO_MEETINGS) {
  const src = path.join(AMI_AUDIO_DIR, path.basename(pin.rel));
  const dst = path.join(ESTATE_DIR, pin.rel);
  let have = null;
  if (fs.existsSync(dst)) have = fileHash(dst);
  else if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    have = fileHash(dst);
  }
  if (have && pin.sha256 && have.sha256 !== pin.sha256) {
    throw new Error(`open-estate audio pin mismatch for ${pin.meetingId}: expected ${pin.sha256}, found ${have.sha256}`);
  }
  audioRecords.push({
    meetingId: pin.meetingId,
    rel: pin.rel,
    bytes: have ? have.bytes : pin.bytes || null,
    sha256: have ? have.sha256 : pin.sha256 || null,
    ...(have ? {} : { absent: 'not present on this machine; no fixture written' }),
    participants: pin.participants.slice(),
  });
}

// ---------------------------------------------------------------------------
// 8. Write the estate (atomically, tmp+rename) and pin its SHA-256.
// ---------------------------------------------------------------------------
function writeAtomic(abs, data) {
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmp, abs);
      return;
    } catch (e) {
      if (e.code !== 'EPERM' || attempt >= 10) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

for (const sub of ['real-transcripts', 'overlay-captions', 'mail', 'memos', 'rosters']) {
  fs.rmSync(path.join(ESTATE_DIR, sub), { recursive: true, force: true });
}
const textFileRecords = [];
const written = [];
for (const st of docTexts) {
  const abs = path.join(ESTATE_DIR, st.def.path);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  writeAtomic(abs, st.text, 'utf8');
  written.push({ rel: st.def.path, bytes: Buffer.from(st.text, 'utf8') });
  textFileRecords.push({
    path: st.def.path,
    layer: st.def.layer,
    modality: st.def.modality,
    format: st.def.format,
    ...(st.def.meetingId ? { meetingId: st.def.meetingId, corpus: st.def.corpus } : {}),
    bytes: Buffer.byteLength(st.text),
  });
}
const h = crypto.createHash('sha256');
for (const { rel, bytes } of written.slice().sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
  h.update(`${rel}\u0000`);
  h.update(bytes);
  h.update(Buffer.from([0]));
}
const estateSha256 = h.digest('hex');

const manifest = {
  kind: 'open-estate-manifest',
  version: VERSION,
  seed: SEED,
  sources: ['docs/research-notes/2026-11-24-open-estate-dataset-hunt.md', 'docs/2026-11-24-parked-followups-handoff.md', 'docs/2026-11-24-noisy-estate-benchmark-spec.md'],
  anti_circularity_note:
    'World-first on layer O: this manifest is the frozen answer key. The engine never receives it; this generator imports only node: builtins and reads nothing under src/. Noise rates and tables come verbatim from the noisy-estate spec (Section 4) where they apply; thread/event/fact counts are scaled to the 60-person world. Layer R carries no overlay and no noise: its truth is the corpus speaker labels. Deviations are recorded in the run record, never smoothed.',
  honesty_note:
    'Layered design: layer R truth is intra-corpus (AMI/ICSI corpus speaker labels, and the audio slice whose speaker identity is never relabeled); layer O truth is by construction (overlay world model projected onto real document content). Cross-estate identity truth does not exist in the wild data and is never implied. The audio link of substituted transcripts does not survive the overlay, and this is recorded rather than hidden.',
  estateDir: 'fixtures/open-estate',
  externalSources: {
    qmsum: QMSUM_SOURCE,
    amiAudio: { ...AMI_SOURCE, meetings: audioRecords },
    enron: ENRON_SOURCE,
  },
  audioNote:
    'The audio slice is committed as data under fixtures/open-estate/audio, kept under the agreed size cap. Audio carries no overlay and is scored by no pipeline in this item. The estate SHA-256 recipe covers text fixtures only; audio files are pinned by per-file sha256 in externalSources.amiAudio.',
  estateSha256,
  estateSha256Recipe:
    'sha256 over the text fixture paths in sorted (POSIX separator) order; per file update(path + NUL), update(file bytes), update(one NUL byte). Audio files are excluded from this digest and pinned separately.',
  layerR: {
    note:
      'Real identity layer. Truth = corpus speaker labels. QMSum renders AMI and ICSI speakers as role handles, not personal names; the ground truth is keyed to those labels as distributed (deviation recorded). Mention surfaces are the corpus labels verbatim.',
    people: [...realPeople.values()],
    documents: textFileRecords.filter((d) => d.layer === 'real'),
    mentions: layerRMentions,
    mentionCount: layerRMentions.length,
  },
  layerO: {
    note: 'Overlay identity layer over real document content. Truth by construction.',
    world: {
      people: people.map((p) => ({
        personId: p.personId,
        firstName: p.firstName,
        lastName: p.lastName,
        fullName: p.fullName,
        emails: p.emails,
        phone: p.phone,
        department: p.department,
        title: p.title,
        joinDate: p.joinDate,
        ...(p.project ? { project: p.project } : {}),
        ...(p.priorEmail ? { priorEmail: p.priorEmail } : {}),
        ...(p.promotion ? { promotion: p.promotion } : {}),
      })),
      collisionPairs,
      sharedInboxes,
      departments: DEPARTMENTS,
      projects: PROJECTS,
      products: PRODUCTS,
    },
    facts: facts.map((f) => ({
      factId: f.factId,
      personId: f.personId,
      attr: f.attr,
      value: f.value,
      singleDoc: f.singleDoc,
      docs: f.statementDocs,
      ...(f.promotion ? { promotion: f.promotion } : {}),
    })),
    documents: textFileRecords.filter((d) => d.layer === 'overlay'),
    mentions: layerOMentions,
    mentionCount: layerOMentions.length,
    noiseSummary,
    substitutionMaps,
  },
};

writeAtomic(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

// ---------------------------------------------------------------------------
// 9. Enron slice (external to the repository; zero Enron bytes in-repo).
// ---------------------------------------------------------------------------
if (ENRON_DIR && ENRON_OUT) {
  assertReadable(ENRON_DIR, 'the extracted Enron maildir', 'Extract enron_mail_20150507.tar.gz with the system tar into an empty directory outside the repository, then pass --enron <dir>.');
  const slice = buildEnronSlice(ENRON_DIR);
  fs.rmSync(ENRON_OUT, { recursive: true, force: true });
  const enronWritten = [];
  for (const st of slice.docTexts) {
    const abs = path.join(ENRON_OUT, st.def.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    writeAtomic(abs, st.text, 'utf8');
    enronWritten.push({ rel: st.def.path, bytes: Buffer.from(st.text, 'utf8') });
  }
  const he = crypto.createHash('sha256');
  for (const { rel, bytes } of enronWritten.slice().sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
    he.update(`${rel}\u0000`);
    he.update(bytes);
    he.update(Buffer.from([0]));
  }
  const sliceManifest = {
    kind: 'open-estate-enron-slice-manifest',
    version: VERSION,
    seed: SEED,
    source: ENRON_SOURCE,
    selection: { mailboxes: slice.mailboxCount, excerpts: slice.excerptCount, quotedBodyBytes: slice.quotedBytes },
    note:
      'External to the repository by founder ruling. Documents are synthetic overlay-world email/memo/roster records authored around real Enron body content (quoted excerpts). Truth by construction; real names appearing inside quoted Enron bodies are raw content, not truth members of the world model.',
    world: manifest.layerO.world,
    documents: slice.docTexts.map((st) => ({ path: st.def.path, layer: 'overlay-enron', modality: st.def.modality, format: st.def.format, bytes: Buffer.byteLength(st.text) })),
    mentions: slice.mentions,
    noiseSummary: slice.noiseSummary,
    sliceSha256: he.digest('hex'),
    sliceSha256Recipe: manifest.estateSha256Recipe,
  };
  writeAtomic(path.join(ENRON_OUT, 'open-estate-enron-slice-manifest.json'), JSON.stringify(sliceManifest, null, 2));
  console.log(JSON.stringify({
    enronSlice: path.relative(ROOT, ENRON_OUT).split(path.sep).join('/'),
    external: true,
    documents: slice.docTexts.length,
    mentions: slice.mentions.length,
    noiseSummary: slice.noiseSummary,
    archiveSha256Verified: slice.archiveSha256Verified,
  }));
}

// ---------------------------------------------------------------------------
// 9b. buildEnronSlice: deterministic selection of real Enron bodies plus the
// overlay world projection, on its own seeded stream.
// ---------------------------------------------------------------------------
function buildEnronSlice(enronDir) {
  const erand = mulberry32(SEED ^ 0xe4e0);
  const eint = (n) => Math.floor(erand() * n);
  const epick = (arr) => arr[eint(arr.length)];
  const echance = (p) => erand() < p;
  function eshuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(erand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const ementions = [];
  const enoise = { N1: 0, N2: 0, N3: 0, N4: 0, N5: 0, N6: 0, N7: 0, N8: 0 };
  const enickDone = new Set();

  // deterministic mailbox selection: sorted names, seeded sample, 36 mailboxes
  const maildir = path.join(enronDir, 'maildir');
  const rootDirs = fs.readdirSync(fs.existsSync(maildir) ? maildir : enronDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const mailboxes = eshuffled(rootDirs).slice(0, 36).sort();
  if (mailboxes.length < 36) throw new Error(`open-estate enron slice: only ${mailboxes.length} mailboxes available`);

  const excerpts = [];
  let quotedBytes = 0;
  for (const mb of mailboxes) {
    const mdir = fs.existsSync(maildir) ? path.join(maildir, mb) : path.join(enronDir, mb);
    const files = [];
    const walk = (dir, rel) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs, rel ? `${rel}/${e.name}` : e.name);
        else files.push({ abs, rel: rel ? `${rel}/${e.name}` : e.name });
      }
    };
    walk(mdir, '');
    files.sort((a, b) => (a.rel < b.rel ? -1 : 1));
    // prefer substantive folders over catch-alls; fall back to everything
    const SKIP = ['calendar', 'discussion_threads', 'all_documents', 'notes_inbox', 'sent_items'];
    let pool = files.filter((f) => !SKIP.includes(f.rel.split('/')[0]));
    if (pool.length < 4) pool = files;
    if (!pool.length) continue;
    const idxs = [Math.floor(erand() * pool.length), (Math.floor(erand() * pool.length) + Math.floor(pool.length / 2)) % pool.length];
    for (const i of idxs) {
      const raw = fs.readFileSync(pool[i].abs, 'latin1');
      const sepMatch = raw.match(/\r?\n\r?\n/);
      const head = sepMatch ? raw.slice(0, sepMatch.index) : raw;
      const bodyArea = sepMatch ? raw.slice(sepMatch.index + sepMatch[0].length) : '';
      const bodyLines = bodyArea.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
        .filter((l) => l.length > 30 && !/^[-=*<>|]+$/.test(l) && !/^original message from/i.test(l) && !/^---+ ?(original|forwarded)/i.test(l));
      const body = bodyLines.slice(0, 3).join(' ').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 600);
      if (!body || body.length < 60) continue;
      const m2 = head.match(/^Subject:\s*(.*)$/m);
      excerpts.push({ mailbox: mb, subject: (m2 ? m2[1] : '').trim().slice(0, 120), body });
      quotedBytes += body.length;
      if (excerpts.length >= 72) break;
    }
    if (excerpts.length >= 72) break;
  }
  if (excerpts.length < 60) throw new Error(`open-estate enron slice: excerpt pool too small (${excerpts.length})`);

  // enron documents (external): 24 email threads, 8 memos, 2 rosters.
  const edocs = [];
  for (let i = 1; i <= 24; i++) edocs.push({ path: `enron-mail/mail-${pad(i, 2)}.eml`, modality: 'email', format: 'eml', layer: 'overlay-enron', capacity: 4, assignments: [], n5: null, date: null });
  for (let i = 1; i <= 12; i++) edocs.push({ path: `enron-memos/memo-${pad(i, 2)}.txt`, modality: 'memo', format: 'txt', layer: 'overlay-enron', capacity: 6, assignments: [], n5: null, date: null });
  for (let i = 1; i <= 2; i++) edocs.push({ path: `enron-rosters/roster-${pad(i, 2)}.${i === 1 ? 'csv' : 'sql'}`, modality: 'roster', format: i === 1 ? 'csv' : 'sql', layer: 'overlay-enron', capacity: 30, assignments: [], n5: null, date: null });
  for (const d of edocs) {
    d.month = 1 + eint(TIMELINE.months);
    const off = d.month - 1 + 7;
    d.date = `${2025 + Math.floor(off / 12)}-${pad((off % 12) + 1, 2)}-${pad(1 + eint(28), 2)}`;
  }
  const erosterOrder = eshuffled(people);
  const erosterDocs = edocs.filter((d) => d.modality === 'roster');
  erosterOrder.forEach((p, i) => { p.erosterPath = erosterDocs[Math.floor(i / 30)].path; });
  const eslots = [];
  for (const d of edocs) if (d.modality !== 'roster') for (let s = 0; s < d.capacity; s++) eslots.push(d);
  const edeal = eshuffled(eslots);
  function etake(pred, why) {
    const idx = pred ? edeal.findIndex(pred) : 0;
    assert.ok(idx !== -1, `enron slot pool exhausted: ${why}`);
    return edeal.splice(idx, 1)[0];
  }
  for (const p of eshuffled(people)) {
    if (p._stale) {
      const a = etake((d) => d.month <= TIMELINE.stale[1] && d.modality === 'email', `enron stale A ${p.personId}`);
      p.edocA = a; a.assignments.push(p.personId);
      const b = etake((d) => d !== a && d.modality !== a.modality, `enron stale B ${p.personId}`);
      p.edocB = b; b.assignments.push(p.personId);
    } else {
      const a = etake(null, `enron A ${p.personId}`);
      p.edocA = a; a.assignments.push(p.personId);
      const b = etake((d) => d !== a && d.modality !== a.modality, `enron B ${p.personId}`);
      p.edocB = b; b.assignments.push(p.personId);
    }
  }
  {
    const order = eshuffled(people);
    let at = 0;
    for (const d of edocs) {
      if (d.modality === 'roster') continue;
      while (d.assignments.length < 2) d.assignments.push(order[at++ % order.length].personId);
    }
  }
  {
    const threads = [];
    for (const d of eshuffled(edocs.filter((x) => x.modality === 'email' && x.assignments.length >= 2))) {
      threads.push(d);
      if (threads.length === 6) break;
    }
    eshuffled(sharedInboxes).forEach((inbox, i) => { if (threads[i]) threads[i].n5 = inbox; });
  }

  const edocStatements = new Map(edocs.map((d) => [d.path, []]));
  const eadd = (docPath, fact, idx) => edocStatements.get(docPath).push({ fact, idx });
  for (const fact of facts) {
    const p = byId.get(fact.personId);
    const a = p.edocA;
    const b = p.edocB;
    if (fact.singleDoc) {
      eadd(a.path, fact, 0);
    } else if (fact.promotion) {
      eadd(a.path, fact, a.month < fact.promotion.eventMonth ? 0 : 1);
      eadd(b.path, fact, b.path === a.path ? 1 : (b.month < fact.promotion.eventMonth ? 0 : 1));
    } else {
      eadd(a.path, fact, 0);
      eadd(b.path, fact, 1);
    }
  }
  // promotion facts: idx 0 must be the doc dated before the event, idx 1 after;
  // if both enron docs straddle differently, the routing order above is
  // consistent within each doc's own statement line.
  const estatementSurfaces = new Map();
  function enewDoc(def) { return { def, text: '', len: 0, mentions: [] }; }
  function eput(st, s) { st.text += s; st.len = st.text.length; }
  function erefMention(st, person, kind, surface, noises) {
    const tagged = noises.slice();
    if (person.pairId && kind === 'name' && norm(surface) === norm(person.fullName)) tagged.push('N6');
    for (const n of tagged) enoise[n]++;
    const start = st.len;
    eput(st, surface);
    const rec = {
      mentionId: `e-${pad(ementions.length + 1, 5)}`,
      doc: st.def.path,
      layer: 'overlay-enron',
      personId: person.personId,
      kind,
      surface,
      noises: tagged,
      charStart: start,
      charEnd: st.len,
    };
    st.mentions.push(rec);
    ementions.push(rec);
    return surface;
  }
  function erefName(st, person, mode = 'roll', extraTags = []) {
    const doc = st.def;
    const noises = [];
    let surface;
    const nickPending = person._nickVariants && !enickDone.has(person.personId) && doc.modality !== 'roster';
    if (nickPending) {
      surface = `${person._nickVariants[person._nickVariant]} ${person.lastName}`;
      noises.push('N2');
      enickDone.add(person.personId);
    } else if (mode === 'canonicalBase' || doc.modality === 'roster') {
      surface = `${person.firstName} ${person.lastName}`;
    } else if (mode === 'variantBase') {
      const canonical = norm(`${person.firstName} ${person.lastName}`);
      const cands = [{ s: `${person.lastName.toUpperCase()}, ${person.firstName.toUpperCase()}`, n: 'N4' }];
      if (!pairOf.has(person.personId)) cands.push({ s: `${person.firstName[0]}. ${person.lastName}`, n: 'N3' });
      if (person._nickVariants) cands.push({ s: `${person._nickVariants[person._nickVariant]} ${person.lastName}`, n: 'N2' });
      const cand = cands.find((c) => norm(c.s) !== canonical) || cands[0];
      surface = cand.s;
      noises.push(cand.n);
    } else {
      const u = erand();
      if (u < RATE.N3_MENTIONS && !pairOf.has(person.personId)) {
        surface = `${person.firstName[0]}. ${person.lastName}`;
        noises.push('N3');
      } else if (u < RATE.N3_MENTIONS + RATE.N4_MENTIONS) {
        surface = echance(0.5)
          ? `${person.lastName.toUpperCase()}, ${person.firstName.toUpperCase()}`
          : `${person.firstName.toUpperCase()} ${person.lastName.toUpperCase()}`;
        noises.push('N4');
      } else {
        surface = `${person.firstName} ${person.lastName}`;
      }
    }
    if ((doc.modality === 'memo' || doc.modality === 'roster') && !noises.includes('N3') && surface.includes(' ')) {
      const out = surface.split(' ').map((tok) => {
        if (!echance(RATE.N1_TOKEN)) return tok;
        if (tok.length < 2) return tok;
        const op = epick(['sub', 'drop', 'double', 'ocr']);
        if (op === 'ocr' && /[lO1I]/.test(tok)) return tok.replace(/[lO1I]/, (mm) => (mm === 'l' ? '1' : '0'));
        const at = eint(tok.length);
        const low = tok[at].toLowerCase();
        if (op === 'sub' && NEIGHBORS[low]) return tok.slice(0, at) + (tok[at] === low ? NEIGHBORS[low][eint(NEIGHBORS[low].length)] : NEIGHBORS[low][0].toUpperCase()) + tok.slice(at + 1);
        if (op === 'double') return tok.slice(0, at) + tok[at] + tok.slice(at);
        return tok.slice(0, at) + tok.slice(at + 1);
      }).join(' ');
      if (out !== surface) { surface = out; noises.push('N1'); }
    }
    for (const tag of extraTags) noises.push(tag);
    return erefMention(st, person, 'name', surface, noises);
  }
  function erefEmail(st, person) {
    if (person._stale && st.def.month <= TIMELINE.stale[1]) {
      return erefMention(st, person, 'email', person.priorEmail, ['N7']);
    }
    return erefMention(st, person, 'email', person.emails[0], []);
  }
  function erefPhone(st, person) {
    if (echance(RATE.PHONE_VARIANT)) {
      return erefMention(st, person, 'phone', phoneFormats(person._digits)[1 + eint(2)], ['N4']);
    }
    return erefMention(st, person, 'phone', phoneFormats(person._digits)[0], []);
  }
  function estatementLine(st, item, extraTags = []) {
    const { fact, idx } = item;
    const person = byId.get(fact.personId);
    const value = fact.promotion ? (idx === 0 ? fact.promotion.titleBefore : fact.value) : fact.value;
    const tags = extraTags.slice();
    if (fact.promotion) tags.push('N8');
    eput(st, ' ');
    const surface = erefName(st, person, idx === 0 ? 'canonicalBase' : 'variantBase', tags);
    if (!estatementSurfaces.has(fact.factId)) estatementSurfaces.set(fact.factId, []);
    estatementSurfaces.get(fact.factId).push(surface);
    let suffix = ATTR_SUFFIX(fact.attr, value);
    if (fact.promotion && idx === 0) suffix = suffix.replace('serves as', 'served as');
    eput(st, suffix);
  }
  function efiller(st, person, docType) {
    const ex = epick(excerpts);
    if (docType === 'memo') {
      erefName(st, person);
      eput(st, ` flagged this thread excerpt (subject: ${ex.subject || 'n/a'}): "${ex.body}"`);
      return;
    }
    if (echance(0.35)) {
      eput(st, 'See the quoted thread below. Ping ');
      erefName(st, person);
      eput(st, ' on ');
      erefPhone(st, person);
      eput(st, ' for the file.');
      return;
    }
    erefName(st, person);
    eput(st, ` forwarded this excerpt (subject: ${ex.subject || 'n/a'}): "${ex.body}"`);
  }

  const edocTexts = [];
  for (const def of edocs) {
    const st = enewDoc(def);
    const parts = def.assignments.map((id) => byId.get(id));
    const slate = edocStatements.get(def.path) || [];
    if (def.modality === 'email') {
      const chunks = [[], [], [], []];
      const responsible = def.n5 ? parts[1 % parts.length] : null;
      let ci = 0;
      for (const item of slate) {
        if (def.n5 && item.fact.personId === responsible.personId) continue;
        chunks[ci++ % chunks.length].push(item);
      }
      const subject = `Subject: ${epick([`${epick(PROJECTS)} planning`, `${epick(PRODUCTS)} rollout update`, `${epick(DEPARTMENTS)} review`])}`;
      for (let k = 0; k < 4; k++) {
        const from = parts[k % parts.length];
        const to = parts[(k + 1) % parts.length];
        eput(st, 'From: ');
        erefName(st, from);
        eput(st, ' <');
        erefEmail(st, from);
        eput(st, '>\r\nTo: ');
        erefName(st, to);
        eput(st, ' <');
        erefEmail(st, to);
        eput(st, `>\r\n${subject}\r\nMessage-ID: <${def.path.replace('/', '-')}-msg-${k + 1}@${DOMAIN}>\r\nDate: ${def.date}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n`);
        const body = chunks[k];
        if (body.length) for (const item of body) { estatementLine(st, item); eput(st, '\r\n'); }
        else { efiller(st, from, 'email'); eput(st, '\r\n'); }
        eput(st, '\r\n');
      }
      if (def.n5) {
        const to = parts[0];
        eput(st, 'From: ' + def.n5.address + '\r\nTo: ');
        erefName(st, to);
        eput(st, ' <');
        erefEmail(st, to);
        eput(st, `>\r\n${subject}\r\nMessage-ID: <${def.path.replace('/', '-')}-msg-5@${DOMAIN}>\r\nDate: ${def.date}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n`);
        const respStmts = slate.filter((it) => it.fact.personId === responsible.personId);
        if (respStmts.length) for (const item of respStmts) { estatementLine(st, item, ['N5']); eput(st, '\r\n'); }
        else {
          eput(st, 'The ');
          eput(st, def.n5.address);
          eput(st, ' queue item needs an owner: ');
          erefName(st, responsible, 'roll', ['N5']);
          eput(st, ' will handle the request this week.\r\n');
        }
        eput(st, '\r\n');
      }
    } else if (def.modality === 'memo') {
      eput(st, `INTERNAL MEMO\nDate: ${def.date}\nRe: ${epick([`${epick(PROJECTS)} staffing`, `${epick(DEPARTMENTS)} planning`, 'records cleanup'])}\nFrom: Corporate Communications\n\n`);
      for (const p of parts) {
        const mine = slate.filter((it) => it.fact.personId === p.personId);
        if (mine.length) for (const item of mine) { estatementLine(st, item); eput(st, ' '); }
        else efiller(st, p, 'memo');
        eput(st, '\n\n');
        if (p._stale && def.month <= TIMELINE.stale[1]) {
          eput(st, 'Until the mailbox cutover, reach ');
          erefName(st, p);
          eput(st, ' at ');
          erefEmail(st, p);
          eput(st, '.\n\n');
        }
      }
    } else {
      const members = erosterOrder.filter((p) => p.erosterPath === def.path);
      const header = `# Helioframe external-corpus directory export (${def.date})`;
      if (def.format === 'csv') {
        eput(st, `${header}\nfull_name,email,phone,department,project\n`);
        for (const p of members) {
          const mine = slate.filter((it) => it.fact.personId === p.personId);
          const name = erefName(st, p);
          for (const item of mine) {
            if (!estatementSurfaces.has(item.fact.factId)) estatementSurfaces.set(item.fact.factId, []);
            estatementSurfaces.get(item.fact.factId).push(name);
          }
          eput(st, ',');
          erefEmail(st, p);
          eput(st, ',');
          erefPhone(st, p);
          eput(st, `,${p.department},${p.project ?? ''}\n`);
        }
      } else {
        eput(st, `${header}\nCREATE TABLE roster (full_name TEXT, email TEXT, phone TEXT, department TEXT, project TEXT);\n`);
        for (const p of members) {
          const mine = slate.filter((it) => it.fact.personId === p.personId);
          eput(st, `INSERT INTO roster VALUES ('`);
          const name = erefName(st, p);
          for (const item of mine) {
            if (!estatementSurfaces.has(item.fact.factId)) estatementSurfaces.set(item.fact.factId, []);
            estatementSurfaces.get(item.fact.factId).push(name);
          }
          eput(st, `', `);
          erefEmail(st, p);
          eput(st, `, `);
          erefPhone(st, p);
          eput(st, `, '${p.department}', ${p.project ? `'${p.project}'` : 'NULL'});\n`);
        }
      }
    }
    edocTexts.push(st);
  }

  // archive sha verification when the archive path is given
  let archiveSha256Verified = null;
  if (ENRON_ARCHIVE && ENRON_SOURCE.archiveSha256 && !ENRON_SOURCE.archiveSha256.startsWith('ARCHIVE_SHA256')) {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(ENRON_ARCHIVE)).digest('hex');
    if (sha !== ENRON_SOURCE.archiveSha256) {
      throw new Error(`enron archive sha mismatch for ${ENRON_ARCHIVE}: expected ${ENRON_SOURCE.archiveSha256}, got ${sha}`);
    }
    archiveSha256Verified = sha;
  }
  return {
    docTexts: edocTexts,
    mentions: ementions,
    noiseSummary: enoise,
    mailboxCount: mailboxes.length,
    excerptCount: excerpts.length,
    quotedBytes,
    archiveSha256Verified,
  };
}

// ---------------------------------------------------------------------------
// 10. Console summary (deterministic; no wallclock).
// ---------------------------------------------------------------------------
console.log(JSON.stringify({
  estate: 'fixtures/open-estate',
  documents: docTexts.length,
  layerR: { documents: manifest.layerR.documents.length, people: realPeople.size, mentions: layerRMentions.length },
  layerO: { documents: manifest.layerO.documents.length, people: people.length, mentions: layerOMentions.length, facts: facts.length },
  noiseSummary,
  estateSha256,
  manifest: 'fixtures/open-estate-manifest.json',
}));
