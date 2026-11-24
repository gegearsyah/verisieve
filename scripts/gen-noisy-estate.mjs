#!/usr/bin/env node
/**
 * Noisy-estate benchmark generator (K4/K5 prep).
 *
 * Spec: docs/2026-11-24-noisy-estate-benchmark-spec.md — the authority for every
 * rate, table and count used here; all constants are applied verbatim from the
 * spec (§3 schema, §4 noise taxonomy N1-N8, §5 simulator plan, §6 question
 * strata, §8 acceptance gates) and nothing is invented beyond them.
 *
 * World-first generation: the world model (people, collision pairs, shared
 * inboxes, org entities, facts, promotion events) is authored and frozen first;
 * documents are seeded noisy projections of it; the noise map (every person
 * mention, its exact written surface and its N1-N8 corruption) is recorded in
 * the manifest. Truth is never adjusted to match documents. Engine blindness:
 * this file imports only node: builtins and reads nothing under src/.
 *
 * Output: fixtures/noisy-estate/**  +  fixtures/noisy-estate-manifest.json
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESTATE_DIR = path.join(ROOT, 'fixtures/noisy-estate');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/noisy-estate-manifest.json');
export const SEED = 20261124;

// ---------------------------------------------------------------------------
// Spec §4 constants — verbatim.
// ---------------------------------------------------------------------------
const NICKNAMES = {
  Robert: ['Bob'], William: ['Bill'], Elizabeth: ['Liz', 'Beth'], Katherine: ['Kathy', 'Kate'],
  Jennifer: ['Jen'], Michael: ['Mike', 'Mikey'], James: ['Jim'], Richard: ['Rick', 'Dick'],
  Thomas: ['Tom'], Margaret: ['Maggie', 'Peggy'], Susan: ['Sue'], Joseph: ['Joe'],
  Daniel: ['Dan'], David: ['Dave'], Alexandra: ['Alex', 'Sandra'], Barbara: ['Barb'], Patricia: ['Pat'],
};
const RATE = {
  N1_TOKEN: 0.06,    // 6% of name tokens in "scanned" memo/CSV docs
  N2_PEOPLE: 0.30,   // 30% of people carry a nickname mention (>=1 doc each)
  N3_MENTIONS: 0.15, // initials / short form
  N4_MENTIONS: 0.20, // case / format variants
  N5_THREADS: 30,    // shared-inbox attribution threads
  N7_PEOPLE: 0.10,   // stale-record people (prior email, months 1-4 docs)
  N8_EVENTS: 8,      // promotion / rename events
  PHONE_VARIANT: 0.30,
};
const POPULATION = 250;
const FACTS_TOTAL = 180;
const FACTS_SINGLE = 108; // 60%
const QUESTIONS = { Q1: 24, Q2: 24, Q3: 12 };
const DOC_PLAN = [['email', 40], ['chat', 30], ['memo', 20], ['roster', 10], ['captions', 15]];
const TIMELINE = { months: 14, stale: [1, 4], current: [9, 14], startDate: '2025-06' };

// ---------------------------------------------------------------------------
// Seeded randomness (one stream, consumed in a fixed order; no other source).
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
// The baseline's trivial normalization, replicated here only for the N6 tag check:
// lowercase, strip punctuation, collapse whitespace. Nothing fancier (spec §7).
function norm(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Name / org pools. Full-name uniqueness is enforced so the ONLY same-name
// strings in the corpus are the 20 designed N6 pairs.
// ---------------------------------------------------------------------------
const FIRSTS = [
  'Sarah', 'Elena', 'Priya', 'Marcus', 'Lena', 'Grace', 'Nadia', 'Victor', 'Felix', 'Ines',
  'Ondrej', 'Hana', 'Kwame', 'Ravi', 'Tomas', 'Ingrid', 'Stefan', 'Amara', 'Diego', 'Yuki',
  'Omar', 'Freya', 'Luca', 'Aisha', 'Milan', 'Sofia', 'Andrei', 'Chidi', 'Marta', 'Jonah',
  'Petra', 'Roshan', 'Elif', 'Bruno', 'Anya', 'Kenji', 'Zara', 'Emil', 'Noor', 'Callum',
];
const SURNAMES = [
  'Vance', 'Sharma', 'Bell', 'Weber', 'Okonkwo', 'Farouk', 'Adeyemi', 'Marchetti', 'Duarte',
  'Novak', 'Ito', 'Asante', 'Chandra', 'Vidal', 'Petrov', 'Kwon', 'Rossi', 'Keller',
  'Lindqvist', 'Moreau', 'Bauer', 'Horvath', 'Silva', 'Costa', 'Ferreira', 'Mensah', 'Diallo',
  'Okoro', 'Adebayo', 'Tanaka', 'Sato', 'Kobayashi', 'Park', 'Kim', 'Wang', 'Zhang', 'Liu',
  'Ivanov', 'Volkov', 'Popescu', 'Dumitru', 'Kovacs', 'Nagy', 'Toth', 'Varga', 'Farkas',
  'Berg', 'Holm', 'Dahl', 'Eriksen', 'Nielsen', 'Hansen', 'Larsen', 'Virtanen', 'Korhonen',
  'Jokinen', 'Kowalczyk', 'Nowak', 'Zielinski', 'Janssen', 'Bakker', 'Peeters', 'Maes',
  'Claes', 'Willems', 'Fontaine', 'Dubois', 'Lambert', 'Renard', 'Girard', 'Fontana',
  'Rinaldi', 'Greco', 'Conti', 'Esposito', 'Bianchi', 'Romano', 'Gallo', 'Marino',
  'Lindgren', 'Sorensen', 'Vasquez', 'Rojas', 'Paredes', 'Quispe', 'Salazar', 'Cortez',
  'Mwangi', 'Kimani', 'Banda', 'Phiri', 'Zulu', 'Sibanda', 'Haddad', 'Khalil', 'Mansour',
  'Demir', 'Yilmaz', 'Arslan', 'Ozturk',
];
const PAIR_NAMES = [ // 20 designed same-full-name pairs (N6); 10 reach the N2 table
  ['Robert', 'Chen'], ['William', 'Osei'], ['Elizabeth', 'Marsh'], ['Katherine', 'Ito'],
  ['Michael', 'Farrell'], ['James', 'Whitfield'], ['Richard', 'Nakamura'], ['Thomas', 'Beringer'],
  ['Margaret', 'Alvi'], ['Jennifer', 'Odell'],
  ['Sarah', 'Okafor'], ['Elena', 'Vance'], ['Priya', 'Sharma'], ['Marcus', 'Bell'],
  ['Lena', 'Weber'], ['Grace', 'Okonkwo'], ['Nadia', 'Farouk'], ['Victor', 'Adeyemi'],
  ['Felix', 'Marchetti'], ['Ines', 'Duarte'],
];
const DEPARTMENTS = ['Research', 'Finance', 'Operations', 'Legal', 'Sales', 'Support', 'Engineering', 'People'];
const TITLES = ['Analyst', 'Engineer', 'Coordinator', 'Manager', 'Team Lead', 'Specialist', 'Administrator', 'Officer', 'Asst. Director', 'Director of Ops'];
const PROJECTS = ['AMBER', 'BASALT', 'CINDER', 'DELTIC', 'EMBER', 'FALLOW', 'GRANITE', 'HARVEST', 'INDIGO', 'JUNIPER', 'KESTREL', 'LANTERN'];
const PRODUCTS = ['LedgerOne', 'Clearline', 'Vantis', 'Northgate', 'Bluecrest', 'Ridgeway', 'Solventis', 'Meridian', 'CobaltRow', 'Eastfork'];
const INBOX_LOCALS = [
  'hr', 'ops-team', 'billing', 'payroll', 'it-helpdesk', 'security', 'facilities', 'recruiting',
  'legal-intake', 'procurement', 'travel-desk', 'compliance', 'audit', 'onboarding', 'reimbursements',
  'vendor-desk', 'data-requests', 'press', 'service-desk', 'quality', 'logistics', 'planning',
  'training', 'escrow', 'front-desk', 'mailroom', 'benefits', 'risk', 'archive', 'studio',
];
const JOIN_MONTHS = [
  'January 2025', 'February 2025', 'March 2025', 'April 2025', 'May 2025', 'June 2025',
  'July 2025', 'August 2025', 'September 2025', 'October 2025', 'November 2025', 'December 2025',
];
const DOMAIN = 'corp.example';
const OLD_DOMAIN = 'old-corp.example';

const pad = (n, w) => String(n).padStart(w, '0');
function monthIso(m) { // window month 1..14 -> fixed 2025-06..2026-07 calendar, never wallclock
  const off = m - 1 + 5;
  const year = 2025 + Math.floor(off / 12);
  const mon = (off % 12) + 1;
  return `${year}-${pad(mon, 2)}-${pad(1 + int(28), 2)}`;
}
const phoneFormats = (d) => [
  `555-${d.slice(3, 6)}-${d.slice(6, 10)}`,                 // 555-012-3456
  `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`,  // (555) 012-3456
  `+1 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 10)}`, // +1 555 012 3456
];

// ---------------------------------------------------------------------------
// 1. World model — authored first, frozen.
// ---------------------------------------------------------------------------
const people = [];
const usedNames = new Set();
const usedEmails = new Set();
const usedPhones = new Set();

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
function makePerson(first, last, emailLocal = null, extra = {}) {
  const fullName = `${first} ${last}`;
  if (!extra.sameNameByDesign) {
    assert.ok(!usedNames.has(norm(fullName)), `full-name collision outside the designed pairs: ${fullName}`);
  }
  usedNames.add(norm(fullName));
  const p = {
    personId: `person-${pad(people.length + 1, 3)}`,
    firstName: first,
    lastName: last,
    fullName,
    emails: [uniqueEmail(emailLocal ?? `${first.toLowerCase()}.${last.toLowerCase()}`)],
    _digits: uniquePhone(),
    phone: null,
    department: pick(DEPARTMENTS),
    title: pick(TITLES),
    joinDate: pick(JOIN_MONTHS),
    project: null,
    ...extra,
  };
  p.phone = phoneFormats(p._digits)[0];
  people.push(p);
  return p;
}

const collisionPairs = [];
PAIR_NAMES.forEach(([first, last], i) => {
  // member 0: initial-based mailbox; member 1: full-name mailbox; distinct
  // department and title, so the pair is distinguishable ONLY by context.
  const m0 = makePerson(first, last, `${first[0].toLowerCase()}.${last.toLowerCase()}`);
  const m1 = makePerson(first, last, `${first.toLowerCase()}.${last.toLowerCase()}`, { sameNameByDesign: true });
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

// N2 population: everyone whose first name is in the spec's nickname table.
// 20 pair members + 55 others = exactly 75 = 30% of 250.
for (let i = 0; i < 55; i++) {
  const first = Object.keys(NICKNAMES)[i % 17];
  let last = pick(SURNAMES);
  while (usedNames.has(norm(`${first} ${last}`))) last = pick(SURNAMES);
  makePerson(first, last);
}
for (let i = 0; i < POPULATION - 40 - 55; i++) {
  let first = pick(FIRSTS);
  let last = pick(SURNAMES);
  while (usedNames.has(norm(`${first} ${last}`))) { first = pick(FIRSTS); last = pick(SURNAMES); }
  makePerson(first, last);
}
assert.equal(people.length, POPULATION, '250 people');
for (const p of people) {
  if (NICKNAMES[p.firstName]) {
    p._nickVariants = NICKNAMES[p.firstName];
    p._nickVariant = p._nickVariants.length > 1 ? int(p._nickVariants.length) : 0;
  }
}
const nickPeople = people.filter((p) => p._nickVariants);
assert.equal(nickPeople.length, Math.round(POPULATION * RATE.N2_PEOPLE), `N2 population = 30% of 250`);

// 1-2 emails per person.
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

// 48 project owners (ownsProject facts draw only from owners).
const owners = shuffled(people).slice(0, 48);
for (const [i, owner] of owners.entries()) owner.project = PROJECTS[i % PROJECTS.length];

// 30 shared inboxes.
const sharedInboxes = shuffled(INBOX_LOCALS).map((local, i) => ({
  inboxId: `inbox-${pad(i + 1, 2)}`,
  address: `${local}@${DOMAIN}`,
  department: pick(DEPARTMENTS),
}));

// ---------------------------------------------------------------------------
// 2. Facts (180 = 108 single-doc + 72 multi-doc; 8 of the multi are promotions).
// ---------------------------------------------------------------------------
const FACT_ATTRS = [ // [attr, total, singleCount]
  ['worksIn', 50, 30], ['titled', 46, 27], ['joinedOn', 44, 26], ['ownsProject', 40, 25],
];
assert.equal(FACT_ATTRS.reduce((n, [, t]) => n + t, 0), FACTS_TOTAL);
assert.equal(FACT_ATTRS.reduce((n, [, , s]) => n + s, 0), FACTS_SINGLE);

const byId = new Map();
const facts = [];
for (const [attr, total, singleCount] of FACT_ATTRS) {
  const seen = new Set();
  const holders = [];
  for (;;) {
    const p = pick(people);
    if (attr === 'ownsProject' && !p.project) continue;
    const key = `${p.personId}|${attr}`;
    if (seen.has(key)) continue;
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
      promotion: null,
    });
  });
}
for (const p of people) byId.set(p.personId, p);

// 8 promotion/rename events among the multi-doc titled facts (stale people and
// pair members excluded, so the two stale mechanisms and the pair semantics
// never fight over one mention).
{
  const candidates = shuffled(facts.filter((f) => f.attr === 'titled' && !f.singleDoc));
  for (const f of candidates) {
    const p = byId.get(f.personId);
    if (p._stale || pairOf.has(p.personId)) continue;
    let before = pick(TITLES);
    while (before === p.title) before = pick(TITLES);
    f.promotion = { titleBefore: before, eventMonth: 5 + int(4) };
    p.promotion = f.promotion;
    if (facts.filter((x) => x.promotion).length === RATE.N8_EVENTS) break;
  }
  assert.equal(facts.filter((x) => x.promotion).length, RATE.N8_EVENTS, '8 promotion events');
}

// ---------------------------------------------------------------------------
// 3. Documents, months, the occurrence deal, statement routing.
// ---------------------------------------------------------------------------
const docs = [];
for (const [modality, count] of DOC_PLAN) {
  for (let i = 1; i <= count; i++) {
    const stem = { email: 'mail/thread', chat: 'chat/chat', memo: 'memos/memo', roster: 'rosters/roster', captions: 'captions/meeting' }[modality];
    const ext = modality === 'email' ? 'eml' : modality === 'captions' ? 'vtt' : modality === 'roster' ? (i <= 7 ? 'csv' : 'sql') : 'txt';
    docs.push({
      path: `${stem}-${pad(i, 2)}.${ext}`,
      modality,
      format: ext,
      month: modality === 'roster'
        ? TIMELINE.current[0] + int(TIMELINE.current[1] - TIMELINE.current[0] + 1)
        : 1 + int(TIMELINE.months),
      capacity: { email: 4, chat: 8, memo: 6, roster: 25, captions: 6 }[modality],
      assignments: [],
      n5: null,
    });
  }
}
assert.equal(docs.length, 115, '115 documents');
for (const d of docs) d.date = monthIso(d.month); // fixed calendar, drawn once per document

// roster membership: seeded shuffle of the people, dealt 25 per roster.
const rosterOrder = shuffled(people);
const rosterDocs = docs.filter((d) => d.modality === 'roster');
rosterOrder.forEach((p, i) => { p.rosterPath = rosterDocs[Math.floor(i / 25)].path; });

// occurrence deal: 2 non-roster documents per person (A, B), with constraints —
// stale people land one doc in months 1-4 (N7); promotion people straddle their
// event month (stale title before it, current title after it).
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
    const b = takeSlot((d) => d !== a, `stale B ${p.personId}`);
    p.docB = b; b.assignments.push(p.personId);
  } else if (p.promotion) {
    const a = takeSlot((d) => d.month < p.promotion.eventMonth, `event A ${p.personId}`);
    p.docA = a; a.assignments.push(p.personId);
    const b = takeSlot((d) => d !== a && d.month >= TIMELINE.current[0], `event B ${p.personId}`);
    p.docB = b; b.assignments.push(p.personId);
  } else {
    const a = takeSlot(null, `A ${p.personId}`);
    p.docA = a; a.assignments.push(p.personId);
    const b = takeSlot((d) => d !== a, `B ${p.personId}`);
    p.docB = b; b.assignments.push(p.personId);
  }
}
// minimum participants per simulator (borrowed extras carry no facts).
const MIN_PARTICIPANTS = { email: 2, chat: 2, memo: 2, captions: 3 };
{
  const order = shuffled(people);
  let at = 0;
  for (const d of docs) {
    if (d.modality === 'roster') continue;
    while (d.assignments.length < MIN_PARTICIPANTS[d.modality]) d.assignments.push(order[at++ % order.length].personId);
  }
}

// N5: 30 email threads each carry one shared inbox; the responsible person is
// named only in the body.
const n5Docs = [];
for (const d of shuffled(docs.filter((x) => x.modality === 'email' && x.assignments.length >= 2))) {
  n5Docs.push(d);
  if (n5Docs.length === RATE.N5_THREADS) break;
}
assert.equal(n5Docs.length, RATE.N5_THREADS, '30 shared-inbox threads');
shuffled(sharedInboxes).forEach((inbox, i) => { n5Docs[i].n5 = inbox; });

// statement routing per fact.
const docStatements = new Map(docs.map((d) => [d.path, []]));
const addStatement = (docPath, fact, idx) => docStatements.get(docPath).push({ fact, idx });
for (const fact of facts) {
  const p = byId.get(fact.personId);
  if (fact.promotion) {
    fact.statementDocs = [p.docA.path, p.docB.path];
    addStatement(p.docA.path, fact, 0);
    addStatement(p.docB.path, fact, 1);
  } else if (fact.attr === 'worksIn' || fact.attr === 'ownsProject') {
    // the roster row is the join key for 1-doc facts (spec §5)
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
// 4. Emission — documents as noisy projections of the frozen world. Every person
// reference passes through refName/refEmail/refPhone, which owns the noise
// application and the noise map.
// ---------------------------------------------------------------------------
const mentions = [];
const noiseSummary = { N1: 0, N2: 0, N3: 0, N4: 0, N5: 0, N6: 0, N7: 0, N8: 0 };
const nickDone = new Set();
const statementSurfaces = new Map();
const emittedStatements = new Map();

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
    if (/[lO1I]/.test(token)) return token.replace(/[lO1I]/, (m) => (m === 'l' ? '1' : '0'));
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

function newDoc(def) {
  return { def, text: '', len: 0, mentions: [] };
}
function put(st, s) {
  st.text += s;
  st.len = st.text.length;
}
function refMention(st, person, kind, surface, noises) {
  const start = st.len;
  put(st, surface);
  const tagged = noises.slice();
  if (person.pairId && kind === 'name' && norm(surface) === norm(person.fullName)) tagged.push('N6');
  for (const n of tagged) noiseSummary[n]++;
  const rec = {
    mentionId: `m-${pad(mentions.length + 1, 5)}`,
    doc: st.def.path,
    personId: person.personId,
    kind,
    surface,
    noises: tagged,
    charStart: start,
    charEnd: st.len,
  };
  st.mentions.push(rec);
  mentions.push(rec);
  return surface;
}

// A person's name reference. mode: 'roll' | 'canonicalBase' | 'variantBase'.
// canonicalBase/variantBase are for fact statements (so multi-doc facts join on
// genuinely different surfaces); everything else rolls the spec rates.
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
    const canonical = `${person.firstName} ${person.lastName}`;
    const cands = [{ s: `${person.lastName.toUpperCase()}, ${person.firstName.toUpperCase()}`, n: 'N4' }];
    if (person._nickVariants) cands.push({ s: `${person._nickVariants[person._nickVariant]} ${person.lastName}`, n: 'N2' });
    const cand = cands.find((c) => norm(c.s) !== norm(canonical)) || cands[0];
    surface = cand.s;
    noises.push(cand.n);
  } else if (doc.modality === 'chat' && person._nickVariants) {
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

function statementsFor(docPath, personId) {
  return (docStatements.get(docPath) || []).filter((it) => it.fact.personId === personId);
}

const CHAT_FILLER = [
  'export is running', 'will check the queue this afternoon', 'handover done on my side',
  'review notes are in the shared folder', 'still waiting on the sign-off', 'ticket resolved, closing out',
];
const ATTR_SUFFIX = (attr, value) => ({
  worksIn: ` works in ${value}.`,
  titled: ` serves as ${value}.`,
  joinedOn: ` joined in ${value}.`,
  ownsProject: ` owns project ${value}.`,
}[attr]);

// One statement line: writes the person reference (canonical for the first
// statement of a fact, a guaranteed-different surface variant for later ones)
// followed by the attribute value in plain text.
function statementLine(st, item, extraTags = []) {
  const { fact, idx } = item;
  const person = byId.get(fact.personId);
  const value = fact.promotion ? (idx === 0 ? fact.promotion.titleBefore : fact.value) : fact.value;
  // N8: a promotion fact's two statements disagree on title across documents —
  // both sides of the disagreement carry the tag.
  const tags = extraTags.slice();
  if (fact.promotion) tags.push('N8');
  put(st, ' ');
  const nameSurface = refName(st, person, idx === 0 ? 'canonicalBase' : 'variantBase', tags);
  if (!statementSurfaces.has(fact.factId)) statementSurfaces.set(fact.factId, []);
  statementSurfaces.get(fact.factId).push(nameSurface);
  if (!emittedStatements.has(fact.factId)) emittedStatements.set(fact.factId, new Set());
  emittedStatements.get(fact.factId).add(st.def.path);
  let suffix = ATTR_SUFFIX(fact.attr, value);
  if (fact.promotion && idx === 0) suffix = suffix.replace('serves as', 'served as');
  put(st, suffix);
}

function fillerLine(st, person, docType) {
  if (docType === 'chat') {
    put(st, `update from my side: ${pick(CHAT_FILLER)}`);
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
  put(st, pick([' has the action item.', ' will take the next review.', ' follows up on the open thread.', ' picks up the handover today.']));
}

// --- email threads ----------------------------------------------------------
function emitEmail(def) {
  const st = newDoc(def);
  const parts = def.assignments.map((id) => byId.get(id));
  const n = Math.max(4, parts.length);
  const stmts = docStatements.get(def.path) || [];
  const responsible = def.n5 ? parts[1 % parts.length] : null;
  const chunks = [[], [], [], []];
  let ci = 0;
  for (const item of stmts) {
    if (def.n5 && item.fact.personId === responsible.personId) continue; // emitted in the inbox message
    chunks[ci++ % chunks.length].push(item);
  }
  const date = def.date;
  const subject = `Subject: ${pick([`${pick(PROJECTS)} planning`, `${pick(PRODUCTS)} rollout update`, `${pick(DEPARTMENTS)} review`, `follow-up: ${pick(PROJECTS)} handover`])}`;
  for (let k = 0; k < 4; k++) {
    const from = parts[k % parts.length];
    const to = parts[(k + 1) % parts.length];
    put(st, 'From: ');
    refName(st, from);
    put(st, ` <`);
    refEmail(st, from);
    put(st, `>\r\nTo: `);
    refName(st, to);
    put(st, ` <`);
    refEmail(st, to);
    put(st, `>\r\n${subject}\r\nMessage-ID: <${def.path.replace('/', '-')}-msg-${k + 1}@${DOMAIN}>\r\nDate: ${date}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n`);
    const body = chunks[k];
    if (body.length) for (const item of body) { statementLine(st, item); put(st, '\r\n'); }
    else { fillerLine(st, from, 'email'); put(st, '\r\n'); }
    put(st, '\r\n');
  }
  if (def.n5) {
    const to = parts[0];
    put(st, 'From: ' + def.n5.address + `\r\nTo: `);
    refName(st, to);
    put(st, ` <`);
    refEmail(st, to);
    put(st, `>\r\n${subject}\r\nMessage-ID: <${def.path.replace('/', '-')}-msg-5@${DOMAIN}>\r\nDate: ${date}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n`);
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

// --- chat sessions ----------------------------------------------------------
function emitChat(def) {
  const st = newDoc(def);
  const parts = def.assignments.map((id) => byId.get(id));
  put(st, `# chat log — ${def.date}\n`);
  parts.forEach((p, i) => {
    const time = `${pad(9 + ((i * 13) % 9), 2)}:${pad((i * 17) % 60, 2)}`;
    const handle = p.emails[0].split('@')[0];
    put(st, `[${time}] `);
    refMention(st, p, 'name', handle, []); // login handle, stable across the world
    put(st, ' (');
    refName(st, p); // nicknames dominate chat
    put(st, '): ');
    const mine = statementsFor(def.path, p.personId);
    if (mine.length) {
      put(st, 'flagging for the channel: ');
      statementLine(st, mine[0]);
      for (const extra of mine.slice(1)) { put(st, ' Also: '); statementLine(st, extra); }
    } else {
      fillerLine(st, p, 'chat');
    }
    put(st, '\n');
  });
  return st;
}

// --- memos ------------------------------------------------------------------
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

// --- rosters ----------------------------------------------------------------
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
  const header = `# Northwind consolidated directory export — shard ${index + 1} of 10 (${def.date})`;
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

// --- meeting captions -------------------------------------------------------
function emitCaptions(def) {
  const st = newDoc(def);
  const parts = def.assignments.map((id) => byId.get(id));
  put(st, `WEBVTT\nNOTE\nmeeting — ${def.date} · ${pick(PROJECTS)} / ${pick(PRODUCTS)} review\n\n`);
  const fmt = (ms) => `00:${pad(Math.floor(ms / 60000), 2)}:${pad(Math.floor((ms % 60000) / 1000), 2)}.${pad(ms % 1000, 3)}`;
  parts.forEach((p, i) => {
    const start = 4000 + i * 7000;
    const end = start + 6000;
    put(st, `${fmt(start)} --> ${fmt(end)}\n<v `);
    refName(st, p); // spoken-form variants
    put(st, `>`);
    const mine = statementsFor(def.path, p.personId);
    if (mine.length) {
      put(st, 'Reading the roster item for the record: ');
      statementLine(st, mine[0]);
      for (const extra of mine.slice(1)) { put(st, ' And: '); statementLine(st, extra); }
    } else {
      fillerLine(st, p, 'chat');
    }
    put(st, '\n\n');
  });
  return st;
}

// emit every document in fixed order
const docTexts = [];
let rosterIndex = 0;
docs.forEach((def) => {
  const st = def.modality === 'email' ? emitEmail(def)
    : def.modality === 'chat' ? emitChat(def)
      : def.modality === 'memo' ? emitMemo(def)
        : def.modality === 'roster' ? emitRoster(def, rosterIndex++)
          : emitCaptions(def);
  docTexts.push(st);
});

// ---------------------------------------------------------------------------
// 5. Post-conditions, then the frozen answer key.
// ---------------------------------------------------------------------------
const textByPath = new Map(docTexts.map((st) => [st.def.path, st.text]));
const mentionsByDoc = new Map(docTexts.map((st) => [st.def.path, st.mentions]));

// a) every routed statement was emitted exactly once, in exactly its routed docs
for (const fact of facts) {
  const emitted = emittedStatements.get(fact.factId) ?? new Set();
  assert.deepEqual([...emitted].sort(), [...fact.statementDocs].sort(), `fact ${fact.factId} statement routing`);
}

// b) multi-doc facts join on genuinely different surfaces
for (const fact of facts.filter((f) => !f.singleDoc)) {
  const surfaces = statementSurfaces.get(fact.factId) || [];
  assert.ok(surfaces.length >= 2, `fact ${fact.factId} must have 2 statement surfaces`);
  assert.notEqual(norm(surfaces[0]), norm(surfaces[1]), `fact ${fact.factId} statements must use different surface forms`);
}

// c) every fact is answerable from its docs; every person mention-coverage holds
for (const fact of facts) {
  assert.ok(fact.statementDocs.some((d) => textByPath.get(d).includes(fact.value)), `fact ${fact.factId} value must be written in its docs`);
  for (const d of fact.statementDocs) {
    assert.ok(mentionsByDoc.get(d).some((m) => m.personId === fact.personId), `fact ${fact.factId} person must be mentioned in ${d}`);
  }
}
{
  const seen = new Map(people.map((p) => [p.personId, new Map()]));
  for (const m of mentions) {
    const mod = new Map(docs.map((d) => [d.path, d.modality])).get(m.doc);
    seen.get(m.personId).set(m.doc, mod);
  }
  for (const [pid, docsSeen] of seen) {
    assert.ok(docsSeen.size >= 2, `person ${pid} must appear in >=2 documents`);
    assert.ok(new Set(docsSeen.values()).size >= 2, `person ${pid} must appear in >=2 modalities`);
  }
}

// ---------------------------------------------------------------------------
// 6. Eval questions (Q1/Q2/Q3), authored here from the world model only.
// ---------------------------------------------------------------------------
function questionText(attr, fullName) {
  return attr === 'worksIn' ? `Which department does ${fullName} work in?`
    : attr === 'titled' ? `What title does ${fullName} hold currently?`
      : attr === 'joinedOn' ? `When did ${fullName} join the company?`
        : `Which project does ${fullName} own?`;
}
const questions = [];
for (const [stratum, poolFilter, want] of [['Q1', (f) => f.singleDoc, QUESTIONS.Q1], ['Q2', (f) => !f.singleDoc, QUESTIONS.Q2]]) {
  const byAttr = new Map();
  for (const f of shuffled(facts.filter(poolFilter))) {
    if (!byAttr.has(f.attr)) byAttr.set(f.attr, []);
    byAttr.get(f.attr).push(f);
  }
  for (const [attr, list] of byAttr) {
    for (const f of list.slice(0, want / byAttr.size)) {
      questions.push({
        qid: `q-${pad(questions.length + 1, 2)}`,
        stratum,
        personId: f.personId,
        attr: f.attr,
        expectedValue: f.value,
        docs: f.statementDocs,
        question: questionText(f.attr, byId.get(f.personId).fullName),
      });
    }
  }
}
for (const pair of shuffled(collisionPairs).slice(0, QUESTIONS.Q3)) {
  const target = byId.get(pair.personIds[0]);
  questions.push({
    qid: `q-${pad(questions.length + 1, 2)}`,
    stratum: 'Q3',
    personId: target.personId,
    collisionWith: pair.personIds[1],
    attr: 'worksIn',
    expectedValue: target.department,
    docs: [target.rosterPath, target.docA.path, target.docB.path],
    question: `Which department does ${target.fullName} (the ${target.title}) work in?`,
  });
}
assert.equal(questions.length, 60, '60 questions');
for (const q of questions) {
  assert.ok(q.docs.some((d) => textByPath.get(d).includes(q.expectedValue)),
    `question ${q.qid} must be answerable: expected "${q.expectedValue}" in ${JSON.stringify(q.docs)}`);
  for (const d of q.docs) {
    assert.ok(mentionsByDoc.get(d).some((m) => m.personId === q.personId), `question ${q.qid} target must be mentioned in every cited doc`);
  }
}

// ---------------------------------------------------------------------------
// 7. Write the estate (atomically, tmp+rename) and pin its SHA-256.
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

fs.rmSync(ESTATE_DIR, { recursive: true, force: true });
const fileRecords = [];
const written = [];
for (const st of docTexts) {
  const abs = path.join(ESTATE_DIR, st.def.path);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  writeAtomic(abs, st.text, 'utf8');
  written.push({ rel: st.def.path, bytes: Buffer.from(st.text, 'utf8') });
  fileRecords.push({ path: st.def.path, modality: st.def.modality, format: st.def.format, month: st.def.month, date: st.def.date, bytes: Buffer.byteLength(st.text) });
}
const h = crypto.createHash('sha256');
for (const { rel, bytes } of written.slice().sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
  h.update(`${rel}\u0000`);
  h.update(bytes);
  h.update(Buffer.from([0]));
}
const estateSha256 = h.digest('hex');

const manifest = {
  kind: 'noisy-estate-manifest',
  version: 'noisy-estate-v1',
  seed: SEED,
  spec: 'docs/2026-11-24-noisy-estate-benchmark-spec.md',
  anti_circularity_note:
    'World-first: this manifest is the frozen answer key (world model, noise map N1-N8, questions). The engine never receives it; the estate generator imports nothing from src/. Noise rates, tables and counts come verbatim from the spec (§3-§8) and are frozen at noisy-estate-v1 — deviations are recorded, never smoothed.',
  estateDir: 'fixtures/noisy-estate',
  timeline: TIMELINE,
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
  documents: fileRecords,
  mentions,
  noiseSummary,
  questions,
  estateSha256,
  estateSha256Recipe: 'sha256 over the document paths in sorted (POSIX separator) order; per file update(path + NUL), update(file bytes), update(one NUL byte)',
};
writeAtomic(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

// console summary (deterministic; no wallclock)
console.log(JSON.stringify({
  estate: 'fixtures/noisy-estate',
  documents: docs.length,
  people: people.length,
  mentions: mentions.length,
  facts: facts.length,
  questions: questions.length,
  noiseSummary,
  estateSha256,
  manifest: 'fixtures/noisy-estate-manifest.json',
}));
