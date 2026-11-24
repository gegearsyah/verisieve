#!/usr/bin/env node
/**
 * Stage K4, the honesty experiment: composed-corpus false-merge amplification and hub
 * duplication (cross-document handoff, Stage K4; trap 19: a wrong merge poisons every
 * composed sample for that entity while erasure receipts stay clean).
 *
 * Design (world-first truth, seeded, CPU-only, zero egress):
 *   (a) On the committed world-first noisy estate (docs/2026-11-24-noisy-estate-benchmark-spec.md),
 *       induce controlled false merges at a deterministic ladder of rates: the 20 designed
 *       same-name collision pairs (N6) are ALWAYS merged, plus a seeded prefix of one deterministic
 *       sequence of disjoint random non-collision person pairs. The merge is applied at the
 *       entity-index layer: the occurrence entityIds of one honest perceiveMulti() pass are
 *       unioned per merged person class, and BOTH corpora (per-block and composed, readable
 *       identity) are then built through the real engine seam (buildAmnesiacCorpus). Nothing
 *       else in the pipeline changes.
 *   (b) MinHash near-duplicate analysis of the honest composed corpus (deterministic seeds,
 *       shingle size and banding recorded in the artifact), split by hub entities = entities
 *       whose composed sample was truncated by the engine's composed-v1 hub cap (block cap 8).
 *   (c) Entity-degree vs benefit saturation curve: DESIGNED, NOT RUN (designedNotRun section).
 *
 * Anti-circularity: the engine is imported ONLY to construct the corpora under test
 * (perceiveMulti + buildAmnesiacCorpus). Every truth definition (person attribution, merge
 * targets, contamination) comes from the committed manifest answer key, keyed positionally at
 * the manifest's own mention spans; no engine module is consulted for any truth, threshold or
 * scoring rule.
 *
 * Output: results/composed-corpus-failure-modes.json (byte-deterministic, no wallclock fields).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Engine seam, corpus construction only (see anti-circularity note).
import { buildAmnesiacCorpus } from '../src/amnesiac-corpus.js';
import { perceiveMulti } from '../src/perceive.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESTATE_DIR = path.join(ROOT, 'fixtures/noisy-estate');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/noisy-estate-manifest.json');
const GEN_SCRIPT = path.join(ROOT, 'scripts/gen-noisy-estate.mjs');
const OUT_PATH = path.join(ROOT, 'results/composed-corpus-failure-modes.json');

const SEED = 20261124;
const WORKSPACE_SALT = 'versieve-amnesiac-v1';
const RATES = [0.05, 0.1, 0.25, 0.5];
const NEAR_DUP_JACCARD = 0.8;
const SHINGLE_CHARS = 16;
const NUM_HASHES = 128;
const BANDS = 32;
const ROWS = 4;
// The engine's composed-v1 policy constants, as read from src/amnesiac-corpus.js.
const COMPOSITION_POLICY = 'composed-v1';
const HUB_CAP_BLOCKS = 8;

// Regenerate the estate to its canonical manifest-pinned form (the estate generators and tests
// do the same before measuring; regeneration is seed-deterministic).
execFileSync(process.execPath, [GEN_SCRIPT], { cwd: ROOT, stdio: 'pipe' });

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

function listEstateFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push(path.relative(ESTATE_DIR, abs).split(path.sep).join('/'));
    }
  };
  walk(ESTATE_DIR);
  return out.sort();
}

function estateDigest() {
  const h = crypto.createHash('sha256');
  for (const rel of listEstateFiles()) {
    h.update(`${rel}\u0000`);
    h.update(fs.readFileSync(path.join(ESTATE_DIR, rel)));
    h.update(Buffer.from([0]));
  }
  return h.digest('hex');
}
const estateSha256 = estateDigest();
if (estateSha256 !== manifest.estateSha256) {
  throw new Error(`estate digest ${estateSha256} does not match the manifest pin ${manifest.estateSha256}`);
}

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

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round6 = (x) => Number((Math.round(x * 1e6) / 1e6).toFixed(6));
const sha256Hex = (d) => crypto.createHash('sha256').update(d).digest('hex');

// ---------- one honest perception pass ----------

const inputs = listEstateFiles().map((rel) => ({
  name: rel,
  text: fs.readFileSync(path.join(ESTATE_DIR, rel), 'utf8'),
}));
const perceived = await perceiveMulti(inputs, { workspaceSalt: WORKSPACE_SALT });
const blocks = (perceived.blocks || []).filter((b) => String(b.originalText ?? '').trim() !== '');

// ---------- positional truth attribution (manifest answer key only) ----------

const docText = new Map(inputs.map((i) => [i.name, i.text]));
const mentionAtSpan = new Map();
for (const men of manifest.mentions) mentionAtSpan.set(`${men.doc}\u0000${men.charStart}:${men.charEnd}`, men);
// personsBySurface: every person whose manifest mention carries this exact surface string,
// across the whole estate (the surface-level ambiguity check).
const personsBySurface = new Map();
for (const men of manifest.mentions) {
  let set = personsBySurface.get(men.surface);
  if (!set) personsBySurface.set(men.surface, (set = new Set()));
  set.add(men.personId);
}

const entPersons = new Map(); // entityId -> Set<personId> (positional, span-matched)
const entSurfaces = new Map(); // entityId -> Set<surface>
const attributionStats = {
  blocks: blocks.length,
  positionedBlocks: 0,
  unpositionedBlocks: 0,
  spanMatchedOccurrences: 0,
  entityOccurrences: 0,
};
{
  const cursors = new Map();
  blocks.forEach((blk) => {
    const t = docText.get(blk.source);
    let start = -1;
    if (t !== undefined && blk.originalText) {
      const cur = cursors.get(blk.source) || 0;
      const at = t.indexOf(blk.originalText, cur);
      if (at !== -1) {
        start = at;
        cursors.set(blk.source, at + blk.originalText.length);
      }
    }
    if (start === -1) attributionStats.unpositionedBlocks++;
    else attributionStats.positionedBlocks++;
    for (const ent of blk.entities || []) {
      if (!ent.entityId || !Number.isInteger(ent.start) || !Number.isInteger(ent.end)) continue;
      attributionStats.entityOccurrences++;
      const surface = String(blk.originalText).slice(ent.start, ent.end);
      let surfaces = entSurfaces.get(ent.entityId);
      if (!surfaces) entSurfaces.set(ent.entityId, (surfaces = new Set()));
      surfaces.add(surface);
      if (start === -1) continue;
      const men = mentionAtSpan.get(`${blk.source}\u0000${start + ent.start}:${start + ent.end}`);
      if (!men) continue;
      attributionStats.spanMatchedOccurrences++;
      let set = entPersons.get(ent.entityId);
      if (!set) entPersons.set(ent.entityId, (set = new Set()));
      set.add(men.personId);
    }
  });
}

// World-mappable ("clean") entities: positional attribution resolved to exactly one person AND
// the surface-uniqueness guard holds (every person mentioning that surface anywhere in the estate
// is that same person). Inherently person-ambiguous surfaces (N6 collision full names, bare
// surnames, shared inboxes) never induce a merge and never enter a contamination count.
const cleanPersonOf = new Map(); // entityId -> personId
let inherentMultiPersonEntities = 0;
for (const [eid, set] of entPersons) {
  if (set.size > 1) {
    inherentMultiPersonEntities++;
    continue;
  }
  if (set.size !== 1) continue;
  const p = [...set][0];
  let ok = true;
  for (const surface of entSurfaces.get(eid) || []) {
    const bySurface = personsBySurface.get(surface);
    if (!bySurface || bySurface.size !== 1 || !bySurface.has(p)) ok = false;
  }
  if (ok) cleanPersonOf.set(eid, p);
}

// ---------- occurrence bookkeeping (block index -> occurrence list) ----------

const occurrencesByBlock = blocks.map((blk) => {
  const occs = [];
  for (const ent of blk.entities || []) {
    if (!ent.entityId || !Number.isInteger(ent.start) || !Number.isInteger(ent.end)) continue;
    occs.push({ entity: ent.entityId, person: cleanPersonOf.get(ent.entityId) ?? null, start: ent.start, end: ent.end });
  }
  return occs;
});
let cleanOccurrences = 0;
for (const occs of occurrencesByBlock) for (const o of occs) if (o.person !== null) cleanOccurrences++;

// ---------- merge ladder (world-first person pairs off the frozen manifest) ----------

const collisionPairs = manifest.world.collisionPairs;
const collisionPersonIds = collisionPairs.map((p) => p.personIds);
const collisionPersons = new Set(collisionPersonIds.flat());
const eligible = manifest.world.people.map((p) => p.personId).filter((id) => !collisionPersons.has(id));
// One deterministic pair sequence; every rate is a prefix (nested configurations).
const shuffled = [...eligible];
const rnd = mulberry32(SEED);
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const pairSequence = [];
for (let i = 0; i + 1 < shuffled.length; i += 2) pairSequence.push([shuffled[i], shuffled[i + 1]]);

const mergedVaultIdOf = (members) => `ent:merged:${sha256Hex(members.join('\u0000'))}`;

function classesFor(pairList) {
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== undefined && parent.get(x) !== x) x = parent.get(x);
    return x;
  };
  for (const [a, b] of pairList) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const byRoot = new Map();
  for (const p of [...new Set(pairList.flat())].sort()) {
    const r = find(p);
    let list = byRoot.get(r);
    if (!list) byRoot.set(r, (list = []));
    list.push(p);
  }
  return [...byRoot.values()]
    .map((members) => members.sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map((members) => ({ members, size: members.length, vaultId: mergedVaultIdOf(members) }));
}

function mergedEntityMapFor(classes) {
  const classByPerson = new Map();
  for (const cls of classes) for (const p of cls.members) classByPerson.set(p, cls);
  const map = new Map(); // entityId -> { vid, merged }
  for (const [eid, p] of cleanPersonOf) {
    const cls = classByPerson.get(p);
    if (cls && cls.size >= 2) map.set(eid, { vid: cls.vaultId, merged: true });
    else map.set(eid, { vid: eid, merged: false });
  }
  // Inherent multi-person entities (e.g. a collision pair's shared full-name entity) collapse
  // into the merged class only when every person they span was merged together.
  for (const [eid, set] of entPersons) {
    if (set.size <= 1) continue;
    const members = [...set];
    if (map.has(eid) && map.get(eid).merged) continue;
    const cls = classByPerson.get(members[0]);
    if (cls && cls.size === set.size && members.every((p) => classByPerson.get(p) === cls)) {
      map.set(eid, { vid: cls.vaultId, merged: true });
    }
  }
  return map;
}

// Rewrite the honest block stream's occurrence entityIds per merged person class. Everything
// else in the blocks (text, spans, sources) is untouched, and both views are then built through
// the real engine seam from these falsely-merged entity indices.
function rewriteBlocks(entityMap) {
  return blocks.map((blk) => ({
    ...blk,
    entities: (blk.entities || []).map((ent) => {
      const m = entityMap.get(ent.entityId);
      return m && m.vid !== ent.entityId ? { ...ent, entityId: m.vid } : ent;
    }),
  }));
}
function mergedOccView(entityMap) {
  return occurrencesByBlock.map((occs) =>
    occs.map((o) => {
      const m = entityMap.get(o.entity);
      const merged = m ? m.vid !== o.entity : false;
      return { vid: m ? m.vid : o.entity, merged, person: o.person };
    })
  );
}

// ---------- record identity helpers ----------

// Blocks built through the { blocks } seam carry no byte range, so a per-block sample is keyed
// by (source, content); uniqueness across the estate's block stream is asserted at build time.
const blockKey = (source, content) => `${source}\u0000${content}`;
const blockIdxByKey = new Map();
blocks.forEach((blk, i) => blockIdxByKey.set(blockKey(blk.source, String(blk.originalText)), i));
if (blockIdxByKey.size !== blocks.length) {
  throw new Error('duplicate (source, content) pairs in the block stream; record mapping would be ambiguous');
}

// ---------- honest corpora (pin the measured corpora; seed the MinHash analysis) ----------

const honestPerBlock = await buildAmnesiacCorpus({ blocks: blocks.map((blk) => ({ ...blk })) }, { identity: 'readable' });
const honestComposed = await buildAmnesiacCorpus(
  { blocks: blocks.map((blk) => ({ ...blk, entities: (blk.entities || []).map((e) => ({ ...e })) })) },
  { identity: 'readable', composition: 'composed' }
);
// ---------- per-configuration measurement ----------

async function runConfig(rate) {
  const randomPairCount = rate === 0 ? 0 : Math.floor((rate * eligible.length) / 2);
  const randomPairs = pairSequence.slice(0, randomPairCount);
  const pairList = rate === 0 ? [] : [...collisionPersonIds, ...randomPairs];
  const classes = classesFor(pairList);
  const mergedMembers = classes.filter((c) => c.size >= 2);
  const mergedVaultIds = new Set(mergedMembers.map((c) => c.vaultId));
  const entityMap = mergedEntityMapFor(classes);
  const rewritten = rewriteBlocks(entityMap);
  const occView = mergedOccView(entityMap);

  const perBlock = await buildAmnesiacCorpus({ blocks: rewritten }, { identity: 'readable' });
  const composed = await buildAmnesiacCorpus({ blocks: rewritten }, { identity: 'readable', composition: 'composed' });
  if (perBlock.receipt.sampleCount !== blocks.length) {
    throw new Error(`per-block sample count ${perBlock.receipt.sampleCount} != block count ${blocks.length}`);
  }

  // --- per-block view: each record IS one block ---
  // induced-mixed record: some merged identity carries occurrences of >= 2 distinct merged
  // persons in that block. Every merged-person occurrence in an induced-mixed record is a
  // contaminated fact occurrence (its identity now also speaks for another person).
  let perBlockMixedRecords = 0;
  let perBlockContaminated = 0;
  for (const occs of occView) {
    const byVault = new Map();
    for (const o of occs) {
      if (!o.merged) continue;
      let list = byVault.get(o.vid);
      if (!list) byVault.set(o.vid, (list = []));
      list.push(o);
    }
    let mixed = false;
    for (const [vid, list] of byVault) {
      if (!mergedVaultIds.has(vid)) continue;
      const persons = new Set(list.filter((o) => o.person !== null).map((o) => o.person));
      if (persons.size >= 2) mixed = true;
    }
    if (mixed) {
      perBlockMixedRecords++;
      for (const o of occs) if (o.merged && o.person !== null) perBlockContaminated++;
    }
  }
  const falseIdentityPerBlock = occView.reduce((n, occs) => n + occs.filter((o) => o.merged && o.person !== null).length, 0);

  // --- composed view: one record per identity, rendering up to the hub cap of its blocks ---
  const rendered = new Set(); // "bi:oi" occurrences present anywhere in the composed corpus
  const contaminatedSet = new Set();
  const falseIdentitySet = new Set();
  let composedMixedRecords = 0;
  for (const s of composed.samples) {
    const groups = new Map(); // vid -> Set<personId>
    const sampleMergedOccs = new Set(); // "bi:oi" merged occurrences rendered in this record
    for (const blkRec of s.blocks) {
      const bi = blockIdxByKey.get(blockKey(blkRec.source, blkRec.content));
      if (bi === undefined) throw new Error('a composed rendered block does not map back to the block stream');
      const occMap = new Map();
      {
        const orig = blocks[bi];
        let k = 0;
        for (const ent of orig.entities || []) {
          if (!ent.entityId || !Number.isInteger(ent.start) || !Number.isInteger(ent.end)) continue;
          const key = `${ent.start}:${ent.end}`;
          if (occMap.has(key)) throw new Error(`two entities claim one span (block ${bi}, ${key}); mapping would be ambiguous`);
          occMap.set(key, k++);
        }
        if (occMap.size !== occView[bi].length) throw new Error(`occurrence alignment drift at block ${bi}`);
      }
      for (const spanList of Object.values(blkRec.spans || {})) {
        for (const [x, y] of spanList) {
          const oi = occMap.get(`${x}:${y}`);
          if (oi === undefined) throw new Error(`rendered span (${x}:${y}) does not match any block occurrence (block ${bi})`);
          const o = occView[bi][oi];
          rendered.add(`${bi}:${oi}`);
          if (o.merged && o.person !== null) {
            falseIdentitySet.add(`${bi}:${oi}`);
            sampleMergedOccs.add(`${bi}:${oi}`);
            let set = groups.get(o.vid);
            if (!set) groups.set(o.vid, (set = new Set()));
            set.add(o.person);
          }
        }
      }
    }
    let mixed = false;
    for (const [vid, persons] of groups) {
      if (mergedVaultIds.has(vid) && persons.size >= 2) mixed = true;
    }
    if (mixed) {
      composedMixedRecords++;
      for (const key of sampleMergedOccs) contaminatedSet.add(key);
    }
  }
  const falseIdentityComposed = falseIdentitySet.size;
  const contaminatedComposed = contaminatedSet.size;
  const capDroppedComposed = falseIdentityPerBlock - falseIdentityComposed;

  // Merged readable identities: the engine gives one vault id one readable id
  // (ent:<first-seen class label>:<lexicographically smallest raw surface>), and the collapsed
  // members' own readable ids disappear. The merged class inherits the readable id of the member
  // owning the smallest surface when that member's class label matches, so detection by
  // set-difference against the honest index undercounts; instead the predicted readable id is
  // derived from the same surface union the engine collects and asserted present (loud failure
  // on any disagreement), plus a count identity over the index.
  const predictedReadable = new Map(); // vaultId -> readable id
  {
    const memberSurfaces = new Map(); // vaultId -> Set<surface>
    for (const [eid, m] of entityMap) {
      if (!m.merged) continue;
      let set = memberSurfaces.get(m.vid);
      if (!set) memberSurfaces.set(m.vid, (set = new Set()));
      for (const s of entSurfaces.get(eid) || []) set.add(s);
    }
    const labelOf = new Map(); // vaultId -> first-seen class label in stream order
    for (const blk of rewritten) {
      for (const ent of blk.entities || []) {
        if (!mergedVaultIds.has(ent.entityId) || labelOf.has(ent.entityId)) continue;
        const type = String(ent.type || 'CUSTOM').toUpperCase();
        labelOf.set(ent.entityId, type === 'NAME_LIKELY' ? 'PERSON' : type);
      }
    }
    for (const cls of mergedMembers) {
      const canonical = [...(memberSurfaces.get(cls.vaultId) || [])].sort()[0];
      if (canonical === undefined) throw new Error(`merged class ${cls.vaultId} resolved no surface values`);
      const label = labelOf.get(cls.vaultId);
      if (label === undefined) throw new Error(`merged class ${cls.vaultId} has no occurrence in the rewritten stream`);
      predictedReadable.set(cls.vaultId, `ent:${label.toLowerCase()}:${canonical}`);
    }
  }
  const indexIds = new Set(composed.entityIndex.map((e) => e.entityId));
  for (const [vid, rid] of predictedReadable) {
    if (!indexIds.has(rid)) throw new Error(`predicted merged readable id ${rid} absent from the built index`);
  }
  const mergedEntityCount = new Set([...entityMap.entries()].filter(([, m]) => m.merged).map(([eid]) => eid)).size;
  const expectedEntityCount = honestComposed.entityIndex.length - mergedEntityCount + mergedMembers.length;
  if (composed.receipt.entityCount !== expectedEntityCount) {
    throw new Error(`composed entity count ${composed.receipt.entityCount} != expected ${expectedEntityCount}`);
  }
  const mergedReadable = [...predictedReadable.values()].sort();
  let canonicalOfExactlyOneMember = 0;
  for (const rid of mergedReadable) {
    const canonical = rid.slice(rid.indexOf(':', 4) + 1);
    const persons = personsBySurface.get(canonical) || new Set();
    if (persons.size === 1) canonicalOfExactlyOneMember++;
  }

  const perBlockRate = cleanOccurrences ? perBlockContaminated / cleanOccurrences : 0;
  const composedRate = cleanOccurrences ? contaminatedComposed / cleanOccurrences : 0;
  const amplificationFactor = perBlockRate > 0 ? round6(composedRate / perBlockRate) : null;

  return {
    rate,
    randomPairs: randomPairCount,
    mergedClasses: mergedMembers.length,
    mergedPersons: mergedMembers.reduce((n, c) => n + c.members.length, 0),
    perBlock: {
      samples: perBlock.receipt.sampleCount,
      inducedMixedRecords: perBlockMixedRecords,
      contaminatedOccurrences: perBlockContaminated,
      corruptionRate: round6(perBlockRate),
      falseIdentityOccurrences: falseIdentityPerBlock,
      corpusSha256: perBlock.receipt.corpusSha256,
    },
    composed: {
      samples: composed.receipt.sampleCount,
      inducedMixedRecords: composedMixedRecords,
      contaminatedOccurrences: contaminatedComposed,
      corruptionRate: round6(composedRate),
      falseIdentityOccurrences: falseIdentityComposed,
      capDroppedOccurrences: capDroppedComposed,
      corpusSha256: composed.receipt.corpusSha256,
    },
    amplificationFactor,
    falseNameAnchors: {
      mergedClasses: mergedReadable.length,
      canonicalOfExactlyOneMember,
      canonicalSharedOrUnknown: mergedReadable.length - canonicalOfExactlyOneMember,
    },
  };
}

// ---------- MinHash near-duplicate analysis of the honest composed corpus ----------

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const permSalt = Array.from({ length: NUM_HASHES }, (_, i) => `minhash-perm:${i}:v1\u0000`);

function shingleSetOf(text) {
  const norm = String(text).toLowerCase().replace(/\s+/g, ' ');
  const set = new Set();
  for (let i = 0; i + SHINGLE_CHARS <= norm.length; i++) set.add(norm.slice(i, i + SHINGLE_CHARS));
  return set;
}

function minhashAnalysis() {
  const samples = honestComposed.samples;
  const sets = samples.map((s) => shingleSetOf(s.content));
  const zeroShingle = sets.reduce((n, set) => n + (set.size === 0 ? 1 : 0), 0);
  const analyzed = [];
  for (let i = 0; i < samples.length; i++) {
    if (sets[i].size === 0) continue;
    const sig = new Array(NUM_HASHES);
    for (let p = 0; p < NUM_HASHES; p++) {
      let min = 0xffffffff;
      for (const sh of sets[i]) {
        const h = fnv1a(permSalt[p] + sh);
        if (h < min) min = h;
      }
      sig[p] = min;
    }
    analyzed.push({ idx: i, sig });
  }
  const dupPartnerOf = new Map();
  const nearDupPairs = [];
  const addPartner = (a, b) => {
    if (!dupPartnerOf.has(a)) dupPartnerOf.set(a, new Set());
    if (!dupPartnerOf.has(b)) dupPartnerOf.set(b, new Set());
    dupPartnerOf.get(a).add(b);
    dupPartnerOf.get(b).add(a);
  };
  {
    // LSH banding over the MinHash signatures
    const buckets = new Map();
    for (const a of analyzed) {
      for (let b = 0; b < BANDS; b++) {
        const key = `${b}|${a.sig.slice(b * ROWS, (b + 1) * ROWS).join(',')}`;
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        list.push(a.idx);
      }
    }
    const candidates = new Set();
    for (const list of buckets.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = Math.min(list[i], list[j]);
          const b = Math.max(list[i], list[j]);
          candidates.add(`${a}:${b}`);
        }
      }
    }
    for (const key of [...candidates].sort()) {
      const [ai, bi] = key.split(':').map(Number);
      const A = sets[ai];
      const B = sets[bi];
      let inter = 0;
      for (const sh of A) if (B.has(sh)) inter++;
      const union = A.size + B.size - inter;
      const jaccard = union === 0 ? 1 : inter / union;
      if (jaccard >= NEAR_DUP_JACCARD) {
        nearDupPairs.push({ pair: [ai, bi], jaccard: round6(jaccard) });
        addPartner(ai, bi);
      }
    }
    nearDupPairs.sort((x, y) => (x.pair[0] - y.pair[0]) || (x.pair[1] - y.pair[1]) || (y.jaccard - x.jaccard));
  }
  const dupIdx = new Set(dupPartnerOf.keys());
  const hubIdx = new Set();
  samples.forEach((s, i) => {
    if (s.truncatedBlocks > 0) hubIdx.add(i);
  });
  const fracOver = (subset, analyzedSamples) => {
    let inSet = 0;
    let total = 0;
    for (const i of analyzedSamples) {
      if (!subset.has(i)) continue;
      total++;
      if (dupIdx.has(i)) inSet++;
    }
    return total ? round6(inSet / total) : 0;
  };
  const hubAndAnalyzed = [...hubIdx].filter((i) => dupPartnerOf.has(i) || true);
  const hubShare = fracOver(hubIdx, [...hubIdx].filter((i) => sets[i].size > 0));
  const nonHubIdx = [];
  for (let i = 0; i < samples.length; i++) {
    if (!hubIdx.has(i) && sets[i].size > 0) nonHubIdx.push(i);
  }
  return {
    corpusKind: 'honest composed corpus (readable identity, composed-v1 policy)',
    sampleCount: samples.length,
    analyzedSamples: samples.length - zeroShingle,
    zeroShingleSamples: zeroShingle,
    shingle: `${SHINGLE_CHARS}-character shingles over lowercase whitespace-collapsed text`,
    hashFunctions: NUM_HASHES,
    banding: `${BANDS} bands x ${ROWS} rows`,
    lshThresholdApprox: round6(1 - Math.pow(1 / BANDS, 1 / ROWS)),
    nearDuplicateDefinition: `exact shingle-set Jaccard >= ${NEAR_DUP_JACCARD} over LSH candidate pairs`,
    overall: {
      nearDuplicateSampleFraction: fracOver(dupIdx, analyzed.map((a) => a.idx)),
      nearDuplicatePairs: nearDupPairs.length,
      exactDuplicatePairs: nearDupPairs.filter((p) => p.jaccard === 1).length,
    },
    hub: {
      definition: 'composed sample truncated by the composed-v1 hub cap (truncatedBlocks > 0)',
      hubSamples: hubIdx.size,
      nearDuplicateSampleFraction: hubShare,
      nearDuplicatePairsInvolvingHubSamples: nearDupPairs.filter((p) => hubIdx.has(p.pair[0]) || hubIdx.has(p.pair[1])).length,
    },
    nonHub: {
      definition: 'analyzed composed samples not truncated by the hub cap',
      samples: nonHubIdx.length,
      nearDuplicateSampleFraction: fracOver(dupIdx, nonHubIdx),
    },
    topNearDuplicatePairs: nearDupPairs.slice(0, 20),
    capContext: {
      compositionPolicy: COMPOSITION_POLICY,
      hubCapBlocks: HUB_CAP_BLOCKS,
      capHitEntities: hubIdx.size,
      maxTruncatedBlocks: samples.reduce((m, s) => Math.max(m, s.truncatedBlocks), 0),
    },
  };
}

// ---------- designed, not run (binding) ----------

const designedNotRun = {
  title: 'Entity-degree vs benefit saturation curve (benefit as a function of entity degree k)',
  status: 'designed-not-run',
  design: {
    whatWouldBeMeasured:
      'Closed-book multi-hop recall delta of the composed corpus vs the per-block corpus at matched token budget, bucketed by entity degree k (composed contributing blocks per record: 1, 2-3, 4-7, >=8 = hub-cap-saturated), stratified over the manifest-authored Q1/Q2/Q3 questions whose target person falls in each bucket; the saturation point is the smallest degree bucket after which the composed-vs-per-block delta stops increasing.',
    estate: 'fixtures/noisy-estate (world-first noisy estate; 60 manifest-authored questions, strata Q1 24 / Q2 24 / Q3 12)',
    armsAndBudget:
      'two LoRA arms (per-block, composed) at the sealed recipe r16/alpha32 with steps/lr from the Stage 4 sweep; degree buckets are an eval-time stratification of the two existing corpora, so no additional training runs beyond the two arms',
    judging: 'the Stage K3 blinded rubric path with local-judge agreement column, results stratified per bucket and reported verbatim',
    ownerStage: 'Stage K3 (GPU) owns the trained benefit measurement; the bucketing design above is recorded here so the curve can be executed without redesign',
  },
  whyNotRun:
    'CPU-only session; the benefit side of the curve is a trained-model measurement owned by the GPU queue, and this run must not contend with the live GPU job',
  note: 'No number in this artifact comes from the designed-not-run section.',
};

// ---------- assemble and write ----------

const rates = [];
rates.push(await runConfig(0));
for (const rate of RATES) rates.push(await runConfig(rate));
const baseline = rates.find((r) => r.rate === 0);
if (baseline.perBlock.contaminatedOccurrences !== 0 || baseline.composed.contaminatedOccurrences !== 0) {
  throw new Error('the rate-0 configuration must be contamination-free by construction');
}

const mh = minhashAnalysis();

const results = {
  kind: 'composed-corpus-failure-modes',
  version: 'composed-failure-modes-v1',
  seed: SEED,
  estate: {
    fixtureDir: 'fixtures/noisy-estate',
    manifest: 'fixtures/noisy-estate-manifest.json',
    manifestVersion: manifest.version,
    manifestSeed: manifest.seed,
    estateSha256,
    estateSha256Recipe: manifest.estateSha256Recipe,
    people: manifest.world.people.length,
    designedCollisionPairs: collisionPairs.length,
    eligibleNonCollisionPersons: eligible.length,
  },
  engine: {
    seam: 'buildAmnesiacCorpus (src/amnesiac-corpus.js) over perception blocks; merges are induced by rewriting occurrence entityIds at the entity-index layer before the seam',
    identity: 'readable',
    views: ['per-block', 'composed'],
    compositionPolicy: COMPOSITION_POLICY,
    hubCapBlocks: HUB_CAP_BLOCKS,
    engineVersion: honestPerBlock.receipt.engine,
    engineVersionSha256: honestPerBlock.receipt.engineVersionSha256,
    honestCorpusSha256: { perBlock: honestPerBlock.receipt.corpusSha256, composed: honestComposed.receipt.corpusSha256 },
  },
  truth: {
    source: 'fixtures/noisy-estate-manifest.json (the estate answer key; the engine never receives it)',
    attribution:
      'positional: each raw entity occurrence is matched to the manifest mention at the same document span (blocks located in document text by a first-match-at-or-after-cursor scan); the person set of an entity is the union of its matched mention persons',
    cleanEntityRule:
      'an entity is world-mappable when positional attribution resolves it to exactly one person AND every person mentioning its surface string anywhere in the estate is that same person; inherently person-ambiguous surfaces never induce a merge and never enter a contamination count',
    contaminationDefinitions: {
      inducedMixedRecord:
        'a training record (per-block sample or composed sample) in which one falsely-merged identity carries occurrences of >= 2 distinct manifest persons, counting only occurrences of world-mappable entities; inherent pre-merge ambiguity (a shared-surface entity spanning an unmerged collision pair) is excluded',
      contaminatedOccurrence:
        'an occurrence of a merged-person entity (a fact about person p) carried in an induced-mixed record: in per-block the record is the block itself; in composed the record is the composed sample rendering that block',
      falseIdentityOccurrence:
        'an occurrence of a merged-person entity whose attribution is the false merged identity (per-block: every such occurrence; composed: those rendered into the composed corpus; the difference is content dropped by the hub cap, reported as capDroppedOccurrences)',
      corruptionRate:
        'contaminatedOccurrences / cleanOccurrences, where cleanOccurrences counts every occurrence of a world-mappable entity across the whole corpus (identical denominator for both views)',
      amplificationFactor:
        'composed corruptionRate / per-block corruptionRate at the same merge rate; when per-block contamination is zero the factor is undefined and reported as null rather than smoothed',
    },
    stats: {
      ...attributionStats,
      worldMappableEntities: cleanPersonOf.size,
      cleanOccurrences,
      inherentMultiPersonEntities,
      spanMatchedShare: round6(attributionStats.spanMatchedOccurrences / attributionStats.entityOccurrences),
    },
  },
  mergeDesign: {
    pairSelection:
      'the 20 designed same-name collision pairs (N6) are always merged; random disjoint non-collision pairs are a prefix of one deterministic Fisher-Yates shuffle (mulberry32, seed 20261124) over the eligible non-collision persons, taken as consecutive disjoint pairs; at rate r the ladder adds floor(r * eligible / 2) random pairs',
    ratesIncludedZeroBaseline: true,
    note: 'merge rates are world-level person pair rates over the frozen manifest, chosen before any measurement (world-first)',
  },
  falseMergeAmplification: { cleanOccurrences, rates },
  hubDuplication: mh,
  designedNotRun,
  notes: [
    'The engine is imported only to construct the corpora under test (perceiveMulti + buildAmnesiacCorpus); no engine module contributes any truth, threshold, or scoring rule.',
    'Blocks built through the { blocks } seam carry no byte-range ids, so per-block sample identity within a configuration is keyed by (source, content); record mapping is asserted unambiguous at build time (no duplicate (source, content) pairs).',
    'Attribution coverage: positional span matching resolves blocks whose content sits verbatim in its document (derived-format reconstructions do not); entity-level person attribution extends to all occurrences of a world-mappable entity, and only world-mappable entities enter merges and contamination counts.',
    'Composed canonical anchors of merged classes are the lexicographically smallest merged surface value (the engine canonical-anchor rule), naming at most one class member; falseNameAnchors reports how often that anchor names exactly one person.',
    'Amplification is quantified on the record-mixing measure, which is where the two views structurally differ: per-block false-merge damage also exists outside this measure (every merged-person occurrence is attributed to a false identity, reported as falseIdentityOccurrences for both views), but in per-block the records themselves stay single-person.',
    'Where the per-block record-mixing rate is exactly zero (the low rates of the ladder) the amplification factor is undefined and reported as null; read the rate rows where the factor exists together with the falseIdentityOccurrences column, so the per-block view is never read as undamaged.',
  ],
  deviations: [
    'The K4 handoff line names an open-world estate variant; this run uses the committed world-first noisy estate (spec 2026-11-24) as directed by the K4 work order: it is the committed estate with a spec-authored noise taxonomy and a frozen person-level answer key.',
    'Positional span matching covers only blocks whose content sits verbatim in the document text (derived-format reconstructions do not); coverage is reported in truth.stats, and the induced-merge and contamination machinery is restricted to world-mappable entities, so this limitation cannot inflate contamination.',
    'Hub-cap truncation means the composed view drops part of the contaminated content from the corpus (capDroppedOccurrences); composed contamination rates count only rendered occurrences, so contamination is never overstated by dropped content.',
  ],
};

writeAtomic(OUT_PATH, `${JSON.stringify(results, null, 2)}\n`);

console.log(JSON.stringify({
  truth: results.truth.stats,
  amplification: rates.map((r) => ({ rate: r.rate, perBlock: r.perBlock, composed: r.composed, factor: r.amplificationFactor })),
  hubDuplication: {
    overall: mh.overall,
    hub: { hubSamples: mh.hub.hubSamples, fraction: mh.hub.nearDuplicateSampleFraction },
    nonHub: mh.nonHub,
    capHitEntities: mh.capContext.capHitEntities,
  },
  out: 'results/composed-corpus-failure-modes.json',
}));
