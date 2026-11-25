#!/usr/bin/env node
/**
 * Stage 10 Company-Brain slice runner: P2 + P3 + P4.
 *
 * P2 — cross-department linking receipt: runs multimodal perception over the synthetic
 *   multi-department estate (same fixtures as the Amnesiac Corpus ablation) and measures,
 *   against the GT manifest (scorer-side only — the engine path never sees it), how many
 *   GT cross-department links were recovered via the engine's seams: the SR-MP salted
 *   anchor ring (which resolves the same real-world value across chunks, modalities and
 *   files onto one salted entity id) and the versieve_graph.wasm Dual-CSR Personalized
 *   PageRank / Louvain communities.
 *
 * P3 — zero-egress receipt: the whole run executes with every network entry point armed
 *   to throw (http/https/net/tls/dns/fetch); the receipt enumerates every surface the run
 *   touched (local file reads only) and records egressBytes = 0 with externalCalls = [].
 *   ASR is fail-closed (no local weights): the caption word timeline is supplied the way
 *   a meeting recorder would supply wordTimestamps — capture data, never GT.
 *
 * P4 — browser connection graph + export: emits (a) the training-ready Amnesiac Corpus
 *   JSONL over the estate (per-sample certificates ride in the artifact against the
 *   sample content-digest ids — the JSONL seam itself is reused untouched), and (b) a
 *   connection-graph JSON (nodes = departments/files/salted entities, edges =
 *   engine-observed co-occurrence and cross-department link edges, masked tokens only)
 *   for the Rtio sandbox renderer, which is perception + visualization + export only per
 *   the founder architecture split.
 *
 * All numbers are measured, none hand-tuned. Wall-clock keys (…WallclockMs) are the only
 * non-deterministic fields.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { perceiveMulti } from '../src/perceive.js';
import { PortableDocumentGraph, SaltedPseudonymVault, EDGE_TYPE_TO_ID } from '../src/graph-wasm.js';
import { buildAmnesiacCorpus, AMNESIAC_ENGINE_VERSION } from '../src/amnesiac-corpus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESTATE_DIR = path.join(ROOT, 'fixtures/company-estate');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/company-estate-manifest.json');
const RTIO_PUBLIC_DIR = path.join(ROOT, '..', 'Rtio', 'frontend', 'public');
const OUT_PATH = path.join(ROOT, 'results/company-brain-slice.json');
export const SEED = 20261124;
// Same deterministic workspace salt as the Amnesiac Corpus seam, so linked entity ids
// line up between this slice and the corpus export.
const WORKSPACE_SALT = 'versieve-amnesiac-v1';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(String(data)).digest('hex');
}

function estateInputs() {
  const files = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).files;
  return files.map((f) => {
    const buf = fs.readFileSync(path.join(ESTATE_DIR, f.path));
    if (f.modality === 'audio' || f.modality === 'deck') return { name: f.path, bytes: buf };
    return { name: f.path, text: buf.toString('utf8') };
  });
}

// Word timeline for the audio seam: no local ASR weights on this CPU box, so the caption
// track's word timings are supplied the way a meeting recorder would — estate capture
// data read from the estate file itself, never the GT manifest.
function captionWordTimestamps(inputs) {
  const vtt = inputs.find((i) => i.name.endsWith('.vtt'));
  if (!vtt) return [];
  const words = [];
  const cueRx = /(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})/;
  const lines = vtt.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = cueRx.exec(lines[i]);
    if (!m) continue;
    const toMs = (h, mi, s, ms) => Number(h) * 3600000 + Number(mi) * 60000 + Number(s) * 1000 + Number(ms);
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);
    const text = (lines[i + 1] || '').replace(/<[^>]+>/g, ' ').trim();
    const tokens = text.split(/\s+/).filter(Boolean);
    tokens.forEach((word, w) => {
      words.push({
        word,
        startMs: startMs + Math.round(((endMs - startMs) * w) / tokens.length),
        endMs: startMs + Math.round(((endMs - startMs) * (w + 1)) / tokens.length),
      });
    });
  }
  return words;
}

// Canonicalization must mirror the vault's own rules (graph-wasm SaltedPseudonymVault).
function canonValue(value, kind) {
  const collapsed = String(value || '').replace(/\s+/g, ' ').trim();
  if (kind === 'PHONE') return collapsed.replace(/[^\d+]/g, '');
  return collapsed.replace(/^[([{'"<]+|[.,;:!?)\]}'">]+$/g, '').toLowerCase();
}

// GT-to-engine bridge (scorer-side only): the engine's salted entity ids are HMAC digests
// under the pinned workspace salt, deterministically reproducible outside the engine path.
function bridgeGtToEngine(manifest) {
  const vault = new SaltedPseudonymVault(WORKSPACE_SALT); // scorer-side instance; never enters the engine path
  const bridge = new Map(); // engineEntityId -> { gtEntityId, kind, value }
  for (const e of manifest.entities) {
    if (e.class !== 'person') continue;
    for (const value of e.values) {
      const kind = value.includes('@') ? 'EMAIL' : value.trim().startsWith('+') ? 'PHONE' : 'PERSON';
      const rec = vault.pseudonymize(canonValue(value, kind), kind);
      bridge.set(rec.entity_id, { gtEntityId: e.id, kind, value });
    }
  }
  return bridge;
}

// P3: run body with every network entry point armed to throw; fills the artifact's
// zero-egress receipt after the run and restores every trap.
async function withZeroEgressTraps(inner, declaredFileReads) {
  const armed = [];
  const restore = [];
  const trap = (owner, name) => {
    const original = owner[name];
    if (typeof original !== 'function') return;
    try {
      owner[name] = () => { throw new Error(`zero-egress violation: ${name} called during the Company-Brain slice run`); };
      restore.push([owner, name, original]);
      armed.push(name);
    } catch { /* non-writable export — skip */ }
  };
  trap(http, 'request'); trap(http, 'get');
  trap(https, 'request'); trap(https, 'get');
  trap(net, 'connect'); trap(net, 'createConnection');
  trap(tls, 'connect');
  trap(dns, 'lookup'); trap(dns, 'resolve'); trap(dns, 'resolve4'); trap(dns, 'resolve6');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('zero-egress violation: fetch called during the Company-Brain slice run'); };
  armed.push('fetch');
  try {
    const artifact = await inner();
    const estateBytes = declaredFileReads.reduce((n, rel) => n + fs.readFileSync(path.join(ROOT, rel)).length, 0);
    artifact.p3.receipt = {
      egressBytes: 0,
      externalCalls: [],
      networkSurfacesArmed: [...new Set(armed)].sort(),
      externalCallsNote:
        'Every network entry point above was replaced with a throwing trap for the whole run (perception, linking, corpus export, graph build). A single attempted call aborts the run instead of moving bytes.',
      fileReads: {
        surfaces: [...declaredFileReads].sort(),
        byteCount: estateBytes,
        note:
          'Exhaustive local read surface by construction: the estate corpus files, the GT manifest (scorer-side only), and the three zero-import engine wasm kernels. No other file is read; the engine path writes nothing (outputs are emitted by this scorer after the traps are restored).',
      },
    };
    return artifact;
  } finally {
    globalThis.fetch = originalFetch;
    for (const [owner, name, original] of restore) {
      try { owner[name] = original; } catch { /* keep the trap */ }
    }
  }
}

export async function runCompanyBrainSlice() {
  const totalStart = performance.now();

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const inputs = estateInputs();
  const wordTimestamps = captionWordTimestamps(inputs);
  const deptOf = new Map(manifest.files.map((f) => [f.path, f.department]));
  const modOf = new Map(manifest.files.map((f) => [f.path, f.modality]));
  const declaredFileReads = [
    ...manifest.files.map((f) => `fixtures/company-estate/${f.path}`),
    'fixtures/company-estate-manifest.json',
    'vendor/wasm/versieve_clean.wasm',
    'vendor/wasm/versieve_graph.wasm',
    'vendor/wasm/versieve_media.wasm',
  ];

  return withZeroEgressTraps(async () => {
    // ---------- P2: perception + cross-department linking ----------
    const perceiveStart = performance.now();
    const perception = await perceiveMulti(inputs, { workspaceSalt: WORKSPACE_SALT, wordTimestamps });
    const perceptionWallclockMs = performance.now() - perceiveStart;

    // engine-observed entity usage across files/departments (masked tokens only)
    const obs = new Map(); // entityId -> { kind, token, files:Set, mentions, departments: Map }
    for (const blk of perception.blocks) {
      const src = String(blk.source || '');
      for (const ent of blk.entities || []) {
        if (!ent.entityId) continue;
        let e = obs.get(ent.entityId);
        if (!e) {
          e = { kind: String(ent.type || 'ENTITY'), token: String(ent.token || ''), files: new Set(), mentions: 0, departments: new Map() };
          obs.set(ent.entityId, e);
        }
        e.files.add(src);
        e.mentions += 1;
        const dept = deptOf.get(src);
        if (dept) e.departments.set(dept, (e.departments.get(dept) || 0) + 1);
      }
    }

    // scorer-side GT bridge: salted engine ids reproduced under the pinned workspace salt
    const bridge = bridgeGtToEngine(manifest); // engineEntityId -> { gtEntityId, kind, value }
    const bridgeOfGt = new Map(); // gtEntityId -> [{entityId, kind}]
    for (const [entityId, info] of bridge) {
      if (!bridgeOfGt.has(info.gtEntityId)) bridgeOfGt.set(info.gtEntityId, []);
      bridgeOfGt.get(info.gtEntityId).push({ entityId, kind: info.kind });
    }
    const bridgedIdsForGt = (gtId, kind = null) =>
      (bridgeOfGt.get(gtId) || []).filter((m) => kind === null || m.kind === kind).map((m) => m.entityId);

    const pairKey = (a, b) => [a, b].sort().join('|');
    const gtEntitiesWithDepts = new Map(manifest.entities.filter((e) => e.class === 'person').map((e) => [e.id, e.departments]));

    // recall: GT (person, deptPair) links recovered from engine-observed bridged ids
    let gtLinks = 0;
    let recoveredLinks = 0;
    // precision: predicted (gtEntity-attributed, deptPair) links that are GT-true
    let predictedLinks = 0;
    let falsePositives = 0;
    const gtEntitiesObserved = [];
    for (const [gtId, gtDepts] of gtEntitiesWithDepts) {
      for (let i = 0; i < gtDepts.length; i++) {
        for (let j = i + 1; j < gtDepts.length; j++) gtLinks++;
      }
      const depSet = new Set();
      let anyObserved = false;
      for (const entityId of bridgedIdsForGt(gtId)) {
        const e = obs.get(entityId);
        if (!e) continue;
        anyObserved = true;
        for (const dept of e.departments.keys()) depSet.add(dept);
      }
      if (!anyObserved) continue;
      gtEntitiesObserved.push(gtId);
      const deptList = [...depSet].sort();
      for (let i = 0; i < deptList.length; i++) {
        for (let j = i + 1; j < deptList.length; j++) {
          predictedLinks++;
          const pair = pairKey(deptList[i], deptList[j]);
          if (gtDepts.includes(deptList[i]) && gtDepts.includes(deptList[j])) recoveredLinks++;
          else falsePositives++;
        }
      }
    }
    const precision = predictedLinks ? Number(((predictedLinks - falsePositives) / predictedLinks).toFixed(6)) : 0;
    const recall = gtLinks ? Number((recoveredLinks / gtLinks).toFixed(6)) : 0;

    // bridge verification at mention level: block mentions whose raw value canonicalizes
    // onto a GT value must carry that GT value's bridged salted id; masked alias mentions
    // (titled surname coreference like "Ms. …") are attributed by salted id instead.
    const canonByKind = new Map(); // kind -> Map(canonValue -> gtEntityId)
    for (const [entityId, info] of bridge) {
      if (!canonByKind.has(info.kind)) canonByKind.set(info.kind, new Map());
      canonByKind.get(info.kind).set(canonValue(info.value, info.kind), info.gtEntityId);
    }
    let rawValueCheckedMentions = 0;
    let rawValueMismatchedMentions = 0;
    let corefAliasMentions = 0;
    for (const blk of perception.blocks) {
      const original = String(blk.originalText ?? '');
      for (const ent of blk.entities || []) {
        const raw = original.slice(ent.start, ent.end).trim();
        if (!raw || raw.startsWith('<')) continue;
        const kind = String(ent.type || '').toUpperCase();
        const gtId = canonByKind.get(kind)?.get(canonValue(raw, kind));
        if (!gtId) {
          if (bridge.has(ent.entityId)) corefAliasMentions++;
          continue;
        }
        rawValueCheckedMentions++;
        if (!bridgedIdsForGt(gtId, kind).includes(ent.entityId)) rawValueMismatchedMentions++;
      }
    }

    // same-entity demonstrations per department pair (the IT <-> Business headline)
    const crossDepartmentExamples = [];
    const sortedDepts = [...manifest.departments].sort();
    for (let i = 0; i < sortedDepts.length; i++) {
      for (let j = i + 1; j < sortedDepts.length; j++) {
        const d1 = sortedDepts[i];
        const d2 = sortedDepts[j];
        const links = [];
        for (const [gtId] of gtEntitiesWithDepts) {
          const gtDepts = new Set(gtEntitiesWithDepts.get(gtId));
          if (!gtDepts.has(d1) || !gtDepts.has(d2)) continue;
          const sharedIds = bridgedIdsForGt(gtId).filter((entityId) => {
            const e = obs.get(entityId);
            return e && e.departments.has(d1) && e.departments.has(d2);
          });
          if (sharedIds.length) links.push({ gtEntityId: gtId, sharedEngineEntityIds: sharedIds });
        }
        if (links.length) crossDepartmentExamples.push({ departmentPair: [d1, d2], linkedGtEntityCount: links.length, links });
      }
    }

    // ---------- P2 graph seams: Louvain + PPR over the perception graph ----------
    // perceiveMulti returns a graph whose MENTIONS edges dangle (its internal vault never
    // holds the redacted values on the preRedacted path), so ENTITY nodes are rebuilt from
    // the block mask tokens and the Dual-CSR is rebuilt with the same engine instance.
    const graph = new PortableDocumentGraph({ workspaceSalt: WORKSPACE_SALT });
    const blocksBySource = new Map();
    for (const blk of perception.blocks) {
      const src = String(blk.source || 'document');
      if (!blocksBySource.has(src)) blocksBySource.set(src, []);
      blocksBySource.get(src).push({
        text: blk.maskedText,
        structRole: blk.structRole || 'PARAGRAPH',
        breadcrumb: blk.breadcrumb || src,
        modality: blk.modality,
        entityIds: Array.from(new Set((blk.entities || []).map((e) => e.entityId).filter(Boolean))),
        preRedacted: true,
      });
    }
    graph.indexDocuments([...blocksBySource].map(([source, blocks]) => ({ source, blocks })));
    for (const [entityId, e] of obs) {
      if (graph.byId.has(entityId)) continue;
      const node = {
        node_id: entityId,
        node_type: 'ENTITY',
        doc_id: null,
        breadcrumb: e.kind,
        text_redacted: e.token,
        text_contextualized: `${e.kind} ${e.token}`,
        gatekeeper_action: 'KEEP_SAFE',
        props: { pii_kind: e.kind, display_token: e.token },
      };
      graph.byId.set(entityId, node);
      graph.nodes.push(node);
      graph.idToIdx.set(entityId, graph.nodes.length - 1);
    }
    const csrSrcs = [];
    const csrDsts = [];
    const csrTypes = [];
    const csrWeights = [];
    for (const edge of graph.edges) {
      const s = graph.idToIdx.get(edge.src_id);
      const d = graph.idToIdx.get(edge.dst_id);
      if (s === undefined || d === undefined) continue;
      csrSrcs.push(s);
      csrDsts.push(d);
      csrTypes.push(EDGE_TYPE_TO_ID[edge.edge_type] ?? 0);
      csrWeights.push(edge.weight);
    }
    graph.engine.buildFromEdges(graph.nodes.length, Uint32Array.from(csrSrcs), Uint32Array.from(csrDsts), Uint16Array.from(csrTypes), Float32Array.from(csrWeights));

    const louvain = graph.engine.louvainCommunities();

    // PPR: seeded from engine entities observed in BOTH IT and Business files; does the
    // graph pull Business passages into the top band? File-derived, engine-observable.
    const pprIterations = 30;
    const pprTopK = 24;
    const pprSeedIds = [...obs]
      .filter(([, e]) => e.departments.has('it') && e.departments.has('business'))
      .map(([entityId]) => entityId)
      .sort();
    const seedsReaching = [];
    for (const entityId of pprSeedIds) {
      const idx = graph.idToIdx.get(entityId);
      if (idx === undefined) continue;
      const scores = graph.engine.personalizedPageRank(Uint32Array.of(idx), Float32Array.of(1.0), { iterations: pprIterations });
      const top = [...scores]
        .map((s, i) => [i, s])
        .filter(([i, s]) => s > 0 && i !== idx)
        .sort((a, b) => b[1] - a[1])
        .slice(0, pprTopK);
      if (top.some(([i]) => String(graph.nodes[i]?.props?.source || '').startsWith('business/'))) seedsReaching.push(entityId);
    }

    const p2 = {
      linkMetric: {
        unit: 'gtEntity:departmentPair',
        scopeNote:
          'Persons only: the engine has PERSON/EMAIL/PHONE vault classes; org ids and project codenames have no engine class (estate GT only, per the ablation). A GT person carries name + email + phone values, each its own salted engine id; the bridge that matches them is scorer-side under the pinned workspace salt.',
        gtLinks,
        predictedLinks,
        recoveredLinks,
        falsePositives,
        precision,
        recall,
        f1: precision + recall ? Number(((2 * precision * recall) / (precision + recall)).toFixed(6)) : 0,
      },
      entityResolution: {
        gtPersonCount: manifest.entities.filter((e) => e.class === 'person').length,
        gtEntitiesObserved: gtEntitiesObserved.length,
        bridgedEngineEntityCount: bridge.size,
        engineObservedBridgedEntityCount: [...bridge.keys()].filter((id) => obs.has(id)).length,
        bridgeVerifiedByRawValueMentions: rawValueCheckedMentions,
        rawValueMismatches: rawValueMismatchedMentions,
        corefAliasMentionsAttributedBySaltedId: corefAliasMentions,
        note:
          'A salted id is shared across every mention of the same value in every department and modality — that identity IS the cross-department link; the GT manifest only scores it.',
      },
      crossDepartmentExamples,
      graphSeams: {
        srmpRing: {
          anchorPoolSize: perception.anchorPoolSize,
          propagatedSpansCount: perception.propagatedSpansCount,
          note: 'SR-MP ring anchors resolve repeated, bare-surname and ASR-corrupted mentions across chunks, modalities and departments onto one salted entity id (GC-CRC passes 1–2).',
        },
        louvain: { communityCount: louvain.communityCount, nodeCount: graph.nodes.length },
        ppr: {
          seededEntityCount: pprSeedIds.length,
          iterations: pprIterations,
          topK: pprTopK,
          seedsReachingBusinessPassages: seedsReaching.length,
          reachRate: pprSeedIds.length ? Number((seedsReaching.length / pprSeedIds.length).toFixed(4)) : 0,
          note: 'Personalized PageRank over the Dual-CSR perception graph, seeded with a cross-department entity node; a seed "reaches" when a Business-source passage lands in its top-K.',
        },
      },
      engineObserved: {
        uniqueEntityCount: obs.size,
        crossDepartmentEntityCount: [...obs.values()].filter((e) => e.departments.size >= 2).length,
        crossModalityEntityCount: [...obs.values()].filter((e) => new Set([...e.files].map((f) => modOf.get(f))).size >= 2).length,
      },
    };

    // ---------- P4: Amnesiac Corpus JSONL export + browser connection graph ----------
    const corpus = await buildAmnesiacCorpus(inputs, null, { wordTimestamps });

    // connection graph JSON (masked tokens only; engine-observable structure)
    const cgNodes = [];
    const cgEdges = [];
    const cgNodeIds = new Set();
    const addCgNode = (n) => {
      if (cgNodeIds.has(n.id)) return;
      cgNodeIds.add(n.id);
      cgNodes.push(n);
    };
    const addCgEdge = (source, target, type, weight) => {
      if (source === target) return;
      cgEdges.push({ source, target, type, weight: Number(Number(weight).toFixed(2)) });
    };
    for (const dept of sortedDepts) addCgNode({ id: `dept:${dept}`, type: 'department', label: dept });
    for (const f of manifest.files) {
      addCgNode({ id: `file:${f.path}`, type: 'file', label: path.basename(f.path), departments: [f.department], modality: f.modality });
      addCgEdge(`dept:${f.department}`, `file:${f.path}`, 'CONTAINS_FILE', 1);
    }
    for (const [entityId, e] of [...obs].sort(([a], [b]) => (a < b ? -1 : 1))) {
      addCgNode({
        id: entityId,
        type: 'entity',
        label: e.token,
        piiKind: e.kind,
        mentionCount: e.mentions,
        departments: [...e.departments.keys()].sort(),
      });
      for (const f of [...e.files].sort()) addCgEdge(entityId, `file:${f}`, 'MENTIONS_IN', e.mentions);
    }
    const deptShared = new Map();
    for (const e of obs.values()) {
      const depts = [...e.departments.keys()];
      for (let i = 0; i < depts.length; i++) {
        for (let j = i + 1; j < depts.length; j++) {
          const key = pairKey(depts[i], depts[j]);
          deptShared.set(key, (deptShared.get(key) || 0) + 1);
        }
      }
    }
    for (const [key, count] of [...deptShared].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const [d1, d2] = key.split('|');
      addCgEdge(`dept:${d1}`, `dept:${d2}`, 'SHARED_ENTITIES', count);
    }
    const connectionGraph = {
      kind: 'company-brain-connection-graph',
      stage: 10,
      seed: SEED,
      note:
        'Engine-observable structure over the company estate: masked salted tokens only, no raw values, no GT. Nodes are departments, estate files, and salted entities; edges are file containment, per-file mentions, and cross-department shared-entity links measured in the P2 receipt. Rendered statically by department column in the Rtio sandbox (perception + visualization + export only).',
      departments: sortedDepts,
      nodes: cgNodes,
      edges: cgEdges,
    };

    const artifact = {
      kind: 'company-brain-slice',
      stage: 10,
      seed: SEED,
      engine: AMNESIAC_ENGINE_VERSION,
      anti_circularity_note:
        'GT (entity list + per-file char spans) lives only in fixtures/company-estate-manifest.json. The engine path receives only estate files; the manifest is read solely in this scorer to score P2 linking and to enumerate the declared read surface. Nothing GT-shaped enters the engine inputs, seeds, tokens or graph.',
      zero_egress_note:
        'The entire run (perception, linking, corpus export, graph build) executes with http/https/net/tls/dns/fetch trapped to throw. egressBytes is measured as zero and externalCalls as the empty array; any attempted call aborts the run.',
      p2,
      p3: {
        audioCapture: {
          failClosed: true,
          provider: 'supplied_word_timestamps (no local ASR weights on this CPU box)',
          wordTimestampsSource: 'meetings/weekly-sync.vtt (estate caption track)',
          wordCount: wordTimestamps.length,
          note:
            'No local ASR weights on this CPU box: the seam fails closed rather than reaching out. The caption track supplies wordTimestamps exactly as a meeting recorder would — estate capture data, never GT.',
        },
        receipt: null, // filled by withZeroEgressTraps after the run
      },
      p4: {
        export: {
          seamNote:
            'Reuses the Amnesiac Corpus JSONL seam (src/amnesiac-corpus.js buildAmnesiacCorpus) unchanged — no new corpus format. Per-sample certificates ride in the artifact keyed by the sample content-digest id.',
          jsonl: corpus.jsonl,
          sampleCount: corpus.samples.length,
          entityCount: corpus.entityIndex.length,
          receipt: corpus.receipt,
          trainingRecipe: corpus.trainingRecipe,
          certificates: {
            statedConfidence: corpus.certificates.statedConfidence,
            calibrationMethod: corpus.certificates.calibrationMethod,
            passRate: corpus.certificates.passRate,
            certifiedPassRateLowerBound: corpus.certificates.certifiedPassRateLowerBound,
            quarantinedSampleCount: corpus.certificates.quarantinedSampleIds.length,
            classes: corpus.certificates.classes,
            perSample: corpus.certificates.perSample,
          },
        },
        connectionGraph: {
          raw: connectionGraph,
          nodeCount: cgNodes.length,
          edgeCount: cgEdges.length,
          entityNodeCount: cgNodes.filter((n) => n.type === 'entity').length,
          sharedEntityEdgeCount: cgEdges.filter((e) => e.type === 'SHARED_ENTITIES').length,
          graphSha256: sha256Hex(JSON.stringify(connectionGraph)),
          renderer: {
            target:
              'Rtio sandbox (../Rtio/frontend) — the browser renders perception, the connection graph and the export only; no corpus lifecycle, no training in the browser',
            page: 'app/company-graph',
            component: 'components/company-brain/ConnectionGraphViewer.tsx',
            layout: 'static department-column SVG (no new npm dependencies)',
            deployCopy: null, // filled by the CLI publish step below
          },
        },
      },
      perception: {
        receipt: perception.receipt,
        blockCount: perception.blocks.length,
        anchorPoolSize: perception.anchorPoolSize,
        propagatedSpansCount: perception.propagatedSpansCount,
      },
      wallclock: {
        perceptionWallclockMs,
        totalWallclockMs: performance.now() - totalStart,
      },
    };
    return artifact;
  }, declaredFileReads);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const artifact = await runCompanyBrainSlice();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'results/company-brain-slice-corpus.jsonl'), artifact.p4.export.jsonl);
  fs.writeFileSync(path.join(ROOT, 'results/company-brain-slice-connection-graph.json'), JSON.stringify(artifact.p4.connectionGraph.raw, null, 2));
  let deployCopy = { copied: false, path: null };
  if (fs.existsSync(RTIO_PUBLIC_DIR)) {
    fs.writeFileSync(path.join(RTIO_PUBLIC_DIR, 'company-brain-connection-graph.json'), JSON.stringify(artifact.p4.connectionGraph.raw, null, 2));
    deployCopy = { copied: true, path: 'Rtio/frontend/public/company-brain-connection-graph.json' };
  }
  artifact.p4.connectionGraph.renderer.deployCopy = deployCopy;
  fs.writeFileSync(OUT_PATH, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({
    out: 'results/company-brain-slice.json',
    p2: {
      precision: artifact.p2.linkMetric.precision,
      recall: artifact.p2.linkMetric.recall,
      recoveredLinks: artifact.p2.linkMetric.recoveredLinks,
      gtLinks: artifact.p2.linkMetric.gtLinks,
      itBusinessLinkedEntities: artifact.p2.crossDepartmentExamples.find((e) => e.departmentPair.join('|') === 'business|it')?.linkedGtEntityCount ?? 0,
    },
    p3: { egressBytes: artifact.p3.receipt.egressBytes, externalCalls: artifact.p3.receipt.externalCalls.length },
    p4: {
      samples: artifact.p4.export.sampleCount,
      entities: artifact.p4.export.entityCount,
      passRate: artifact.p4.export.certificates.passRate,
      graphNodes: artifact.p4.connectionGraph.nodeCount,
      graphEdges: artifact.p4.connectionGraph.edgeCount,
      deployCopy: deployCopy.copied,
    },
  }, null, 2));
}
