import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRecordsForPII } from './clean-and-tokenize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_GRAPH_WASM_PATH = path.resolve(__dirname, '../vendor/wasm/verisieve_graph.wasm');

export const EDGE_TYPE_TO_ID = {
  CONTAINS_SECTION: 0,
  CONTAINS_BLOCK: 1,
  TABLE_HEADER_OF: 2,
  NEXT_CHUNK: 3,
  REFERS_TO: 4,
  MENTIONS: 5,
  RELATES_TO: 6,
  SUPPORTED_BY: 7,
  DERIVED_FROM: 8,
  SIMILAR_TO: 9,
};

export const ID_TO_EDGE_TYPE = [
  'CONTAINS_SECTION',
  'CONTAINS_BLOCK',
  'TABLE_HEADER_OF',
  'NEXT_CHUNK',
  'REFERS_TO',
  'MENTIONS',
  'RELATES_TO',
  'SUPPORTED_BY',
  'DERIVED_FROM',
  'SIMILAR_TO',
];

function directionCode(dir) {
  if (dir === 'out') return 0;
  if (dir === 'in') return 1;
  return 2;
}

function edgeTypeMaskParts(edgeTypes) {
  if (!Array.isArray(edgeTypes) || edgeTypes.length === 0) return [0, 0];
  let lo = 0;
  let hi = 0;
  for (const item of edgeTypes) {
    const id = typeof item === 'number' ? item : EDGE_TYPE_TO_ID[item];
    if (!Number.isInteger(id) || id < 0 || id >= 64) continue;
    if (id < 32) lo |= 1 << id;
    else hi |= 1 << (id - 32);
  }
  return [lo >>> 0, hi >>> 0];
}

export function buildGraphEngineFromInstance(instance) {
  const ex = instance.exports;
  const abiVersion = Number(ex.vs_graph_abi_version?.() ?? 0);
  if (abiVersion !== 1) {
    throw new Error(`Unsupported verisieve_graph WASM ABI version: ${abiVersion} (expected 1)`);
  }

  return {
    abiVersion,
    instance,
    nodeCount() {
      return ex.vs_graph_node_count() >>> 0;
    },
    edgeCount() {
      return ex.vs_graph_edge_count() >>> 0;
    },
    buildFromEdges(nodeCount, srcs, dsts, edgeTypes, weights) {
      const e = Math.min(srcs.length, dsts.length, edgeTypes.length, weights.length);
      ex.vs_graph_prepare_edges(e);
      if (e > 0) {
        new Uint32Array(ex.memory.buffer, ex.vs_graph_in_srcs_ptr(), e).set(srcs.subarray(0, e));
        new Uint32Array(ex.memory.buffer, ex.vs_graph_in_dsts_ptr(), e).set(dsts.subarray(0, e));
        new Uint16Array(ex.memory.buffer, ex.vs_graph_in_types_ptr(), e).set(edgeTypes.subarray(0, e));
        new Float32Array(ex.memory.buffer, ex.vs_graph_in_weights_ptr(), e).set(weights.subarray(0, e));
      }
      return ex.vs_graph_build(nodeCount >>> 0, e >>> 0) >>> 0;
    },
    serializeSnapshot() {
      const len = ex.vs_graph_serialize_csr() >>> 0;
      const ptr = ex.vs_graph_snapshot_ptr();
      return new Uint8Array(ex.memory.buffer, ptr, len).slice();
    },
    loadSnapshot(bytes) {
      const ptr = ex.vs_graph_prepare_snapshot(bytes.byteLength >>> 0);
      new Uint8Array(ex.memory.buffer, ptr, bytes.byteLength).set(bytes);
      return ex.vs_graph_load_csr(bytes.byteLength >>> 0) === 1;
    },
    blastRadius(seedIndices, options = {}) {
      const k = seedIndices.length;
      if (k === 0) return [];
      ex.vs_graph_prepare_seeds(k);
      new Uint32Array(ex.memory.buffer, ex.vs_graph_in_seed_nodes_ptr(), k).set(seedIndices);
      const [maskLo, maskHi] = edgeTypeMaskParts(options.edgeTypes || options.edgeTypeIds);
      const count =
        ex.vs_graph_blast_radius(
          k >>> 0,
          directionCode(options.direction || 'in'),
          (options.maxHops ?? 3) >>> 0,
          maskLo,
          maskHi
        ) >>> 0;
      if (count === 0) return [];

      const nodes = new Uint32Array(ex.memory.buffer, ex.vs_graph_out_nodes_ptr(), count);
      const hops = new Uint32Array(ex.memory.buffer, ex.vs_graph_out_hops_ptr(), count);
      const via = new Uint32Array(ex.memory.buffer, ex.vs_graph_out_via_types_ptr(), count);
      const scores = new Float32Array(ex.memory.buffer, ex.vs_graph_out_scores_ptr(), count);

      const hits = new Array(count);
      for (let i = 0; i < count; i++) {
        hits[i] = {
          nodeIdx: nodes[i],
          minHop: hops[i],
          viaEdgeTypeId: via[i],
          viaEdgeType: ID_TO_EDGE_TYPE[via[i]] || 'MENTIONS',
          impactScore: Math.round(scores[i] * 10000) / 10000,
        };
      }
      return hits;
    },
    personalizedPageRank(seedIndices, seedWeights, options = {}) {
      const k = Math.min(seedIndices.length, seedWeights.length);
      if (k === 0) return new Float32Array(0);
      ex.vs_graph_prepare_seeds(k);
      new Uint32Array(ex.memory.buffer, ex.vs_graph_in_seed_nodes_ptr(), k).set(seedIndices.subarray(0, k));
      new Float32Array(ex.memory.buffer, ex.vs_graph_in_seed_weights_ptr(), k).set(seedWeights.subarray(0, k));
      const n = ex.vs_graph_ppr(k >>> 0, options.alpha ?? 0.85, (options.iterations ?? 15) >>> 0) >>> 0;
      return new Float32Array(ex.memory.buffer, ex.vs_graph_out_scores_ptr(), n).slice();
    },
    shortestPath(srcIdx, dstIdx, options = {}) {
      const len =
        ex.vs_graph_shortest_path(
          srcIdx >>> 0,
          dstIdx >>> 0,
          directionCode(options.direction || 'both'),
          (options.maxHops ?? 6) >>> 0,
          options.weighted ? 1 : 0
        ) >>> 0;
      if (len === 0) return new Uint32Array(0);
      return new Uint32Array(ex.memory.buffer, ex.vs_graph_out_nodes_ptr(), len).slice();
    },
    tarjanScc() {
      const componentCount = ex.vs_graph_tarjan_scc() >>> 0;
      const n = ex.vs_graph_node_count() >>> 0;
      const components =
        n > 0 ? new Uint32Array(ex.memory.buffer, ex.vs_graph_out_components_ptr(), n).slice() : new Uint32Array(0);
      return { componentCount, components };
    },
    louvainCommunities(maxPasses = 12) {
      const communityCount = ex.vs_graph_louvain(maxPasses >>> 0) >>> 0;
      const n = ex.vs_graph_node_count() >>> 0;
      const communities =
        n > 0 ? new Uint32Array(ex.memory.buffer, ex.vs_graph_out_components_ptr(), n).slice() : new Uint32Array(0);
      return { communityCount, communities };
    },
  };
}

let cachedModule = null;

export function loadGraphWasmSync(wasmPath = DEFAULT_GRAPH_WASM_PATH) {
  if (!cachedModule || wasmPath !== DEFAULT_GRAPH_WASM_PATH) {
    const bytes = fs.readFileSync(wasmPath);
    const mod = new WebAssembly.Module(bytes);
    if (wasmPath === DEFAULT_GRAPH_WASM_PATH) cachedModule = mod;
    return buildGraphEngineFromInstance(new WebAssembly.Instance(mod, {}));
  }
  return buildGraphEngineFromInstance(new WebAssembly.Instance(cachedModule, {}));
}

function sha256Short(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 12);
}

function normalizePiiKind(rawType) {
  const lower = String(rawType || 'entity').trim().toLowerCase();
  if (lower === 'name_likely' || lower === 'person') return 'PERSON';
  if (lower === 'address_likely' || lower === 'address') return 'ADDRESS';
  if (lower === 'date_of_birth' || lower === 'dob') return 'DOB';
  if (lower === 'ip_address' || lower === 'ip') return 'IP';
  return lower.replace(/[^a-z0-9_]/g, '_').toUpperCase() || 'ENTITY';
}

function canonicalizePii(rawValue, kind) {
  const collapsed = String(rawValue || '').replace(/\s+/g, ' ').trim();
  if (kind === 'PHONE' || kind === 'SSN' || kind === 'CREDIT_CARD') {
    return collapsed.replace(/[^\d+]/g, '');
  }
  return collapsed.replace(/^[([{'"<]+|[.,;:!?)\]}'">]+$/g, '').toLowerCase();
}

export class SaltedPseudonymVault {
  constructor(salt) {
    this.salt = salt || crypto.randomBytes(24).toString('hex');
    this.byEntityId = new Map();
    this.kindCounters = new Map();
  }

  pseudonymize(rawValue, piiType) {
    const kind = normalizePiiKind(piiType);
    const canonical = canonicalizePii(rawValue, kind);
    const hmac16 = crypto
      .createHmac('sha256', this.salt)
      .update(`${kind}:${canonical}`)
      .digest('hex')
      .slice(0, 16);
    const entityId = `ent:${kind.toLowerCase()}:${hmac16}`;
    const existing = this.byEntityId.get(entityId);
    if (existing) {
      existing.mention_count += 1;
      return existing;
    }
    const seq = (this.kindCounters.get(kind) || 0) + 1;
    this.kindCounters.set(kind, seq);
    const displayToken = kind.startsWith('SECRET_')
      ? `<SECRET:${kind.slice(7)}_${String(seq).padStart(2, '0')}>`
      : `<PII:${kind}_${String(seq).padStart(2, '0')}>`;
    const entry = {
      entity_id: entityId,
      display_token: displayToken,
      pii_kind: kind,
      mention_count: 1,
    };
    this.byEntityId.set(entityId, entry);
    return entry;
  }

  maskText(text, options = {}) {
    const piiItems = scanRecordsForPII(text);
    if (!piiItems.length) return { maskedText: text, entityIds: [] };
    const isHeading = Boolean(options.isHeading);
    const sorted = [...piiItems].sort((a, b) => a.start - b.start);
    let out = '';
    let lastIdx = 0;
    const entityIds = [];
    for (const item of sorted) {
      if (item.start < lastIdx) continue;
      const cat = String(item.category || item.type || '').toLowerCase();
      // Preserve Title-Case section headings unless explicit title/honorific prefix precedes the name
      if (isHeading && cat === 'name_likely') {
        const prefix = text.slice(Math.max(0, item.start - 16), item.start);
        if (!/\b(?:Dr|Mr|Mrs|Ms|Prof|Patient|Lead|Author)\.?\s+$/i.test(prefix)) {
          continue;
        }
      }
      out += text.slice(lastIdx, item.start);
      const rawVal = item.value ?? text.slice(item.start, item.end);
      const entry = this.pseudonymize(rawVal, item.category || item.type);
      out += entry.display_token;
      if (!entityIds.includes(entry.entity_id)) entityIds.push(entry.entity_id);
      lastIdx = item.end;
    }
    out += text.slice(lastIdx);
    return { maskedText: out, entityIds };
  }

  exportRedactedEntities() {
    return Array.from(this.byEntityId.values()).map((e) => ({ ...e }));
  }
}

function tokenizeBm25(text) {
  return String(text || '')
    .toLowerCase()
    .match(/[a-z0-9]+(?:[.,][0-9]+)*/g) || [];
}

function buildBm25Index(texts) {
  const N = texts.length;
  const docLens = new Uint32Array(N);
  const postings = new Map();
  let totalLen = 0;

  for (let i = 0; i < N; i++) {
    const toks = tokenizeBm25(texts[i]);
    docLens[i] = toks.length;
    totalLen += toks.length;
    if (toks.length === 0) continue;
    const tf = new Map();
    for (let j = 0; j < toks.length; j++) {
      const w = toks[j];
      tf.set(w, (tf.get(w) || 0) + 1);
    }
    for (const [w, f] of tf.entries()) {
      let list = postings.get(w);
      if (!list) {
        list = [];
        postings.set(w, list);
      }
      list.push(i, f);
    }
  }

  return {
    N,
    avgdl: totalLen / Math.max(1, N),
    docLens,
    postings,
  };
}

function rankBm25Indexed(query, index) {
  const N = index.N;
  if (N === 0) return [];
  const scores = new Float64Array(N);
  const qToks = tokenizeBm25(query);
  if (qToks.length === 0) return Array.from(scores);

  const k1 = 1.5;
  const b = 0.75;
  const avgdl = Math.max(1, index.avgdl);
  const docLens = index.docLens;

  for (let qi = 0; qi < qToks.length; qi++) {
    const list = index.postings.get(qToks[qi]);
    if (!list) continue;
    const df = list.length >> 1;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (let j = 0; j < list.length; j += 2) {
      const docIdx = list[j];
      const f = list[j + 1];
      scores[docIdx] += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * docLens[docIdx]) / avgdl));
    }
  }
  return Array.from(scores);
}

function rrfFuse(scoreArrays, k = 60) {
  if (!scoreArrays.length) return [];
  const n = scoreArrays[0].length;
  const out = new Float64Array(n);
  for (const scores of scoreArrays) {
    const order = scores
      .map((s, i) => ({ s, i }))
      .sort((a, b) => b.s - a.s || a.i - b.i);
    for (let r = 0; r < order.length; r++) {
      out[order[r].i] += 1 / (k + r + 1);
    }
  }
  return Array.from(out);
}

/**
 * Builds a strictly redacted Document Knowledge Graph backed by `verisieve_graph.wasm` Dual-CSR.
 * Accepts documents: [{ source, text, pageNo? }] and optional artifacts: [{ artifactId, kind, sourceRowIndices }].
 */
export class PortableDocumentGraph {
  constructor(options = {}) {
    this.vault = new SaltedPseudonymVault(options.workspaceSalt);
    this.engine = options.engine || loadGraphWasmSync();
    this.nodes = [];
    this.edges = [];
    this.provenance = [];
    this.idToIdx = new Map();
    this.byId = new Map();
    this.passages = [];
    this.passageIndices = [];
    this.sections = [];
    this.documents = [];
    this.pasBm25Index = buildBm25Index([]);
    this.secBm25Index = buildBm25Index([]);
    this.entitiesByPas = new Map();
    this.childSections = new Map();
    this.blocksByParent = new Map();
    this.pasCounts = new Map();
  }

  indexDocuments(documents = [], artifacts = []) {
    const nodeMap = new Map();
    const edges = [];
    const edgeKeys = new Set();
    const provenance = [];

    const addNode = (node) => {
      if (!nodeMap.has(node.node_id)) nodeMap.set(node.node_id, node);
    };
    const addEdge = (src_id, dst_id, edge_type, weight = 1.0, props = {}) => {
      if (!src_id || !dst_id || src_id === dst_id) return;
      const key = `${src_id}|${edge_type}|${dst_id}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({ src_id, dst_id, edge_type, weight, props });
    };

    let globalLineIdx = 0;
    const passageIdByLineIdx = new Map();

    const splitMdRow = (line) => {
      let s = String(line || '').trim();
      if (s.startsWith('|')) s = s.slice(1);
      if (s.endsWith('|')) s = s.slice(0, -1);
      return s.split('|').map((c) => c.trim());
    };
    const isMdTableSep = (line) => {
      const cells = splitMdRow(line);
      return cells.length >= 2 && cells.every((c) => /^:?-{2,}:?$/.test(c));
    };

    for (const doc of documents) {
      const source = String(doc.source || doc.name || 'document.md');
      const docId = `doc:${sha256Short(source)}`;
      const modality = doc.modality || 'document';
      addNode({
        node_id: docId,
        node_type: 'DOCUMENT',
        doc_id: docId,
        breadcrumb: source,
        text_redacted: source,
        text_contextualized: source,
        gatekeeper_action: 'KEEP_SAFE',
        props: { source, modality, ...(doc.parentSource ? { parent_source: doc.parentSource } : {}) },
      });
      if (doc.parentSource) {
        const parentDocId = `doc:${sha256Short(String(doc.parentSource))}`;
        addNode({
          node_id: parentDocId,
          node_type: 'DOCUMENT',
          doc_id: parentDocId,
          breadcrumb: String(doc.parentSource),
          text_redacted: String(doc.parentSource),
          text_contextualized: String(doc.parentSource),
          gatekeeper_action: 'KEEP_SAFE',
          props: { source: String(doc.parentSource) },
        });
        addEdge(docId, parentDocId, 'DERIVED_FROM', 1.0, { relation: 'attachment_or_archive_child' });
      }

      const sectionStack = [];
      const sectionByBreadcrumb = new Map();
      let secCounter = 0;
      let accLines = [];
      let prevPasId = null;

      const ensureSectionPath = (pathTitles, pageNo = null) => {
        if (!Array.isArray(pathTitles) || pathTitles.length === 0) return null;
        let parentId = docId;
        let lastSec = null;
        const prefix = [];
        for (let lvl = 0; lvl < pathTitles.length; lvl++) {
          const { maskedText: safeTitle } = this.vault.maskText(String(pathTitles[lvl] || '').trim(), { isHeading: true });
          if (!safeTitle) continue;
          prefix.push(safeTitle);
          const bc = prefix.join(' > ');
          let secNode = sectionByBreadcrumb.get(bc);
          if (!secNode) {
            const secNodeId = `sec:${docId.slice(4)}:${secCounter++}`;
            secNode = {
              node_id: secNodeId,
              node_type: 'SECTION',
              doc_id: docId,
              breadcrumb: bc,
              text_redacted: safeTitle,
              text_contextualized: `${source} > ${bc}`,
              gatekeeper_action: 'KEEP_SAFE',
              props: { source, level: lvl + 1, pageStart: pageNo, pageEnd: pageNo },
            };
            addNode(secNode);
            addEdge(parentId, secNodeId, 'CONTAINS_SECTION', 1.0, { level: lvl + 1 });
            sectionByBreadcrumb.set(bc, secNode);
          } else if (pageNo !== null) {
            if (secNode.props.pageStart === null || pageNo < secNode.props.pageStart) secNode.props.pageStart = pageNo;
            if (secNode.props.pageEnd === null || pageNo > secNode.props.pageEnd) secNode.props.pageEnd = pageNo;
          }
          parentId = secNode.node_id;
          lastSec = secNode;
        }
        return lastSec;
      };

      const maskTableRowPreservingHeaders = (rawRow) => {
        const segments = String(rawRow || '').split(/\s*\|\s*/);
        const maskedSegs = [];
        const allEntIds = [];
        for (const seg of segments) {
          const colonIdx = seg.indexOf(':');
          if (colonIdx > 0 && colonIdx < 48) {
            const rawHeader = seg.slice(0, colonIdx).trim();
            const rawVal = seg.slice(colonIdx + 1).trim();
            const hRes = this.vault.maskText(rawHeader, { isHeading: true });
            const vRes = this.vault.maskText(rawVal);
            maskedSegs.push(`${hRes.maskedText}: ${vRes.maskedText}`);
            for (const id of [...hRes.entityIds, ...vRes.entityIds]) {
              if (!allEntIds.includes(id)) allEntIds.push(id);
            }
          } else {
            const res = this.vault.maskText(seg);
            maskedSegs.push(res.maskedText);
            for (const id of res.entityIds) {
              if (!allEntIds.includes(id)) allEntIds.push(id);
            }
          }
        }
        return { maskedText: maskedSegs.join(' | '), entityIds: allEntIds };
      };

      const emitBlockNode = ({
        rawText,
        nodeType = 'PASSAGE',
        curSec = null,
        pageNo = doc.pageNo ?? null,
        structRole = 'P',
        tableHeaders = null,
        gatekeeperAction = 'KEEP_SAFE',
        preRedactedEntityIds = null,
        preRedacted = false,
        blockModality = modality,
        timeRangeMs = null,
        frameTimeMs = null,
        speakerId = null,
        parentSource = null,
      }) => {
        if (!rawText || rawText.length < 4) return;
        const { maskedText, entityIds: detectedEntityIds } = preRedacted
          ? { maskedText: rawText, entityIds: [] }
          : nodeType === 'TABLE_ROW'
            ? maskTableRowPreservingHeaders(rawText)
            : this.vault.maskText(rawText);
        const entityIds = Array.from(new Set([...(preRedactedEntityIds || []), ...detectedEntityIds]));
        const breadcrumb = curSec ? curSec.breadcrumb : '';
        const textCtx = breadcrumb ? `[${breadcrumb}] ${maskedText}` : maskedText;
        const pasId = `pas:${docId.slice(4)}:${globalLineIdx}`;
        const lineIndex = globalLineIdx++;

        addNode({
          node_id: pasId,
          node_type: nodeType,
          doc_id: docId,
          breadcrumb,
          text_redacted: maskedText,
          text_contextualized: textCtx,
          gatekeeper_action: gatekeeperAction,
          props: {
            source,
            modality: blockModality,
            line_index: lineIndex,
            page_no: pageNo,
            struct_role: structRole,
            ...(timeRangeMs ? { time_range_ms: timeRangeMs } : {}),
            ...(frameTimeMs !== null && frameTimeMs !== undefined ? { frame_time_ms: frameTimeMs } : {}),
            ...(speakerId ? { speaker_id: speakerId } : {}),
            ...(parentSource ? { parent_source: parentSource } : {}),
            ...(tableHeaders && tableHeaders.length ? { table_headers: tableHeaders } : {}),
          },
        });
        passageIdByLineIdx.set(lineIndex, pasId);
        addEdge(curSec ? curSec.node_id : docId, pasId, 'CONTAINS_BLOCK', 1.0);
        if (parentSource && parentSource !== source) {
          const parentDocId = `doc:${sha256Short(String(parentSource))}`;
          addNode({
            node_id: parentDocId,
            node_type: 'DOCUMENT',
            doc_id: parentDocId,
            breadcrumb: String(parentSource),
            text_redacted: String(parentSource),
            text_contextualized: String(parentSource),
            gatekeeper_action: 'KEEP_SAFE',
            props: { source: String(parentSource) },
          });
          addEdge(pasId, parentDocId, 'DERIVED_FROM', 1.0, { relation: 'parent_container' });
        }
        if (prevPasId) addEdge(prevPasId, pasId, 'NEXT_CHUNK', 0.5);
        prevPasId = pasId;

        for (const entId of entityIds) {
          addEdge(pasId, entId, 'MENTIONS', 1.0);
        }

        provenance.push({
          provenance_id: `prov:${pasId}`,
          node_id: pasId,
          doc_id: docId,
          page_no: pageNo,
          struct_role: structRole,
        });
      };

      // Pre-structured blocks path (from Tier-0 structure-extractor or KEEP_SAFE rows)
      if (Array.isArray(doc.blocks) && doc.blocks.length > 0) {
        for (const blk of doc.blocks) {
          const text = String(blk.text ?? blk.masked_text ?? '').trim();
          if (text.length < 4) continue;
          const gatekeeperAction = blk.gatekeeper_action || 'KEEP_SAFE';
          const pathTitles = Array.isArray(blk.sectionPath) && blk.sectionPath.length > 0
            ? blk.sectionPath
            : (blk.breadcrumb ? String(blk.breadcrumb).split(/\s*>\s*/).filter(Boolean) : []);
          const pageNo = blk.pageStart ?? blk.page_no ?? doc.pageNo ?? null;
          const curSec = ensureSectionPath(pathTitles, pageNo);
          const role = blk.structRole || blk.struct_role || 'P';
          const nodeType = role === 'TABLE_ROW' ? 'TABLE_ROW' : 'PASSAGE';
          emitBlockNode({
            rawText: text,
            nodeType,
            curSec,
            pageNo,
            structRole: role,
            tableHeaders: blk.tableHeaders || blk.table_headers || null,
            gatekeeperAction,
            preRedactedEntityIds: blk.entityIds || blk.entity_ids || null,
            preRedacted: Boolean(blk.preRedacted),
            blockModality: blk.modality || modality,
            timeRangeMs: blk.timeRangeMs || blk.time_range_ms || null,
            frameTimeMs: blk.frameTimeMs ?? blk.frame_time_ms ?? null,
            speakerId: blk.speakerId || blk.speaker_id || null,
            parentSource: blk.parentSource || blk.parent_source || doc.parentSource || null,
          });
        }
        continue;
      }

      const lines = String(doc.text || '').split(/\r?\n/);

      const flushPassage = () => {
        if (!accLines.length) return;
        const rawBlock = accLines.join('\n').trim();
        accLines = [];
        if (rawBlock.length < 4) return;
        const curSec = sectionStack[sectionStack.length - 1] || null;
        emitBlockNode({
          rawText: rawBlock,
          nodeType: 'PASSAGE',
          curSec,
          pageNo: doc.pageNo ?? null,
          structRole: 'P',
        });
      };

      for (let li = 0; li < lines.length; li++) {
        const trimmed = lines[li].trim();
        if (!trimmed) {
          flushPassage();
          continue;
        }
        const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          flushPassage();
          const level = headingMatch[1].length;
          const { maskedText: safeTitle } = this.vault.maskText(headingMatch[2].trim(), { isHeading: true });
          while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].level >= level) {
            sectionStack.pop();
          }
          const parentId = sectionStack.length > 0 ? sectionStack[sectionStack.length - 1].node_id : docId;
          const breadcrumb = [...sectionStack.map((s) => s.title), safeTitle].join(' > ');
          const secNodeId = `sec:${docId.slice(4)}:${secCounter++}`;
          const secNode = {
            node_id: secNodeId,
            node_type: 'SECTION',
            doc_id: docId,
            breadcrumb,
            text_redacted: safeTitle,
            text_contextualized: `${source} > ${breadcrumb}`,
            gatekeeper_action: 'KEEP_SAFE',
            props: { source, level, pageStart: doc.pageNo ?? null, pageEnd: doc.pageNo ?? null },
          };
          addNode(secNode);
          addEdge(parentId, secNodeId, 'CONTAINS_SECTION', 1.0, { level });
          sectionStack.push({ node_id: secNodeId, title: safeTitle, level, breadcrumb });
          continue;
        }

        // GFM Markdown table support: header + separator + data rows -> TABLE_ROW nodes
        if (trimmed.includes('|') && li + 1 < lines.length && isMdTableSep(lines[li + 1])) {
          flushPassage();
          const headers = splitMdRow(trimmed).map((h, idx) => h || `Column ${idx + 1}`);
          const curSec = sectionStack[sectionStack.length - 1] || null;
          li += 2;
          while (li < lines.length) {
            const rowLine = lines[li].trim();
            if (!rowLine || !rowLine.includes('|') || /^#{1,6}\s+/.test(rowLine)) {
              li--;
              break;
            }
            const cells = splitMdRow(rowLine);
            const rowText = cells
              .map((val, idx) => (val ? `${headers[idx] || `Column ${idx + 1}`}: ${val}` : ''))
              .filter(Boolean)
              .join(' | ');
            if (rowText.length >= 4) {
              emitBlockNode({
                rawText: rowText,
                nodeType: 'TABLE_ROW',
                curSec,
                pageNo: doc.pageNo ?? null,
                structRole: 'TABLE_ROW',
                tableHeaders: headers,
              });
            }
            li++;
          }
          continue;
        }

        accLines.push(trimmed);
      }
      flushPassage();
    }

    // Register strictly redacted ENTITY nodes
    for (const ent of this.vault.exportRedactedEntities()) {
      addNode({
        node_id: ent.entity_id,
        node_type: 'ENTITY',
        doc_id: null,
        breadcrumb: ent.pii_kind,
        text_redacted: ent.display_token,
        text_contextualized: `${ent.pii_kind} ${ent.display_token}`,
        gatekeeper_action: 'KEEP_SAFE',
        props: { ...ent },
      });
    }

    // Register ARTIFACT nodes + DERIVED_FROM edges for PII Blast Radius
    for (const art of artifacts) {
      const artId = `art:${art.kind || 'sft_jsonl'}:${art.artifactId}`;
      addNode({
        node_id: artId,
        node_type: 'ARTIFACT',
        doc_id: null,
        breadcrumb: art.kind || 'sft_jsonl',
        text_redacted: art.artifactId,
        text_contextualized: `${art.kind || 'sft_jsonl'}:${art.artifactId}`,
        gatekeeper_action: 'KEEP_SAFE',
        props: { kind: art.kind || 'sft_jsonl', artifactId: art.artifactId },
      });
      for (const rowIdx of art.sourceRowIndices || []) {
        const pasId = passageIdByLineIdx.get(rowIdx);
        if (pasId) addEdge(artId, pasId, 'DERIVED_FROM', 1.0);
      }
    }

    this.nodes = Array.from(nodeMap.values());
    this.edges = edges;
    this.provenance = provenance;
    this.idToIdx = new Map(this.nodes.map((n, i) => [n.node_id, i]));
    this.byId = nodeMap;

    // Precompute query-time lookup tables and inverted BM25 indexes once at index time
    this.passages = [];
    this.passageIndices = [];
    this.sections = [];
    this.documents = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n.node_type === 'PASSAGE' || n.node_type === 'TABLE_ROW') {
        this.passages.push(n);
        this.passageIndices.push(i);
      } else if (n.node_type === 'SECTION') {
        this.sections.push(n);
      } else if (n.node_type === 'DOCUMENT') {
        this.documents.push(n);
      }
    }
    this.pasBm25Index = buildBm25Index(this.passages.map((p) => p.text_contextualized));
    this.secBm25Index = buildBm25Index(this.sections.map((s) => s.text_contextualized));

    this.entitiesByPas = new Map();
    this.childSections = new Map();
    this.blocksByParent = new Map();
    this.pasCounts = new Map();
    for (const e of this.edges) {
      if (e.edge_type === 'MENTIONS') {
        let list = this.entitiesByPas.get(e.src_id);
        if (!list) {
          list = [];
          this.entitiesByPas.set(e.src_id, list);
        }
        list.push(e.dst_id);
      } else if (e.edge_type === 'CONTAINS_SECTION') {
        let list = this.childSections.get(e.src_id);
        if (!list) {
          list = [];
          this.childSections.set(e.src_id, list);
        }
        list.push(e.dst_id);
      } else if (e.edge_type === 'CONTAINS_BLOCK') {
        let list = this.blocksByParent.get(e.src_id);
        if (!list) {
          list = [];
          this.blocksByParent.set(e.src_id, list);
        }
        list.push(e.dst_id);
        this.pasCounts.set(e.src_id, (this.pasCounts.get(e.src_id) || 0) + 1);
      }
    }

    // Load into verisieve_graph.wasm Dual-CSR
    const srcs = [];
    const dsts = [];
    const types = [];
    const weights = [];
    for (const e of this.edges) {
      const s = this.idToIdx.get(e.src_id);
      const d = this.idToIdx.get(e.dst_id);
      if (s === undefined || d === undefined) continue;
      srcs.push(s);
      dsts.push(d);
      types.push(EDGE_TYPE_TO_ID[e.edge_type] ?? 0);
      weights.push(Number.isFinite(e.weight) && e.weight > 0 ? e.weight : 1.0);
    }
    this.engine.buildFromEdges(
      this.nodes.length,
      Uint32Array.from(srcs),
      Uint32Array.from(dsts),
      Uint16Array.from(types),
      Float32Array.from(weights)
    );

    return {
      nodeCount: this.nodes.length,
      edgeCount: this.edges.length,
      provenanceCount: this.provenance.length,
      entities: this.vault.exportRedactedEntities(),
      wasmBackend: 'verisieve_graph.wasm',
    };
  }

  blastRadius(seedIds, options = {}) {
    const indices = [];
    for (const sid of seedIds || []) {
      const idx = this.idToIdx.get(sid);
      if (idx !== undefined) indices.push(idx);
    }
    if (!indices.length) return [];
    const raw = this.engine.blastRadius(Uint32Array.from(indices), {
      direction: options.direction || 'in',
      maxHops: options.maxHops ?? 3,
      edgeTypes: options.edgeTypes,
    });
    return raw.map((h) => {
      const node = this.nodes[h.nodeIdx];
      return {
        nodeId: node.node_id,
        nodeType: node.node_type,
        source: node.props?.source || null,
        modality: node.props?.modality || null,
        breadcrumb: node.breadcrumb || null,
        ...(node.props?.time_range_ms ? { timeRangeMs: node.props.time_range_ms } : {}),
        ...(node.props?.frame_time_ms !== undefined ? { frameTimeMs: node.props.frame_time_ms } : {}),
        minHop: h.minHop,
        viaEdgeType: h.viaEdgeType,
        impactScore: h.impactScore,
      };
    });
  }

  tracePath(srcId, dstId, options = {}) {
    const s = this.idToIdx.get(srcId);
    const d = this.idToIdx.get(dstId);
    if (s === undefined || d === undefined) return null;
    const raw = this.engine.shortestPath(s, d, {
      direction: options.direction || 'both',
      maxHops: options.maxHops ?? 6,
      weighted: Boolean(options.weighted),
    });
    if (!raw.length) return null;
    return Array.from(raw, (idx) => this.nodes[idx].node_id);
  }

  pprRetrieve(query, options = {}) {
    const topK = Math.max(1, options.topK ?? 6);
    const passageResetScale = options.passageResetScale ?? 0.05;
    const passages = this.passages;
    if (!passages.length) return { rankedPassages: [], seedSections: [], seedEntities: [] };

    const sections = this.sections;
    const pasBm25 = rankBm25Indexed(query, this.pasBm25Index);
    const secBm25 = sections.length ? rankBm25Indexed(query, this.secBm25Index) : [];
    const entitiesByPas = this.entitiesByPas;

    const seedMap = new Map();
    const seedSections = [];
    const seedEntities = new Set();

    const topSecs = secBm25
      .map((score, i) => ({ score, node: sections[i] }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const maxSec = topSecs[0]?.score || 1;
    for (const s of topSecs) {
      seedMap.set(s.node.node_id, s.score / maxSec);
      seedSections.push(s.node.node_id);
    }

    const topPas = pasBm25
      .map((score, i) => ({ score, node: passages[i] }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    const maxPas = topPas[0]?.score || 1;
    for (const p of topPas) {
      const norm = p.score / maxPas;
      seedMap.set(p.node.node_id, (seedMap.get(p.node.node_id) || 0) + norm * passageResetScale);
      for (const entId of entitiesByPas.get(p.node.node_id) || []) {
        seedMap.set(entId, (seedMap.get(entId) || 0) + norm);
        seedEntities.add(entId);
      }
    }

    const seedIdx = [];
    const seedW = [];
    for (const [id, w] of seedMap.entries()) {
      const idx = this.idToIdx.get(id);
      if (idx !== undefined && w > 0) {
        seedIdx.push(idx);
        seedW.push(w);
      }
    }

    const pprAll = seedIdx.length
      ? this.engine.personalizedPageRank(Uint32Array.from(seedIdx), Float32Array.from(seedW), {
          alpha: options.alpha ?? 0.85,
          iterations: options.iterations ?? 15,
        })
      : new Float32Array(this.nodes.length);

    const pprPas = this.passageIndices.map((idx) => pprAll[idx] || 0);
    const fused = rrfFuse([pprPas, pasBm25], 60);

    const rankedPassages = passages
      .map((p, i) => ({
        nodeId: p.node_id,
        source: p.props.source,
        lineIndex: p.props.line_index,
        breadcrumb: p.breadcrumb,
        textRedacted: p.text_redacted,
        score: Number(fused[i].toFixed(6)),
        pprScore: Number(pprPas[i].toFixed(6)),
        bm25Score: Number(pasBm25[i].toFixed(4)),
      }))
      .sort((a, b) => b.score - a.score || b.pprScore - a.pprScore || a.lineIndex - b.lineIndex)
      .slice(0, topK);

    return { rankedPassages, seedSections, seedEntities: Array.from(seedEntities) };
  }

  getDocumentTree(docIdFilter) {
    const byId = this.byId;
    const children = this.childSections;
    const pasCounts = this.pasCounts;
    const build = (secId) => {
      const n = byId.get(secId);
      if (!n || n.node_type !== 'SECTION') return null;
      return {
        nodeId: n.node_id,
        title: n.text_redacted,
        level: n.props.level ?? 1,
        pageStart: n.props.pageStart ?? null,
        pageEnd: n.props.pageEnd ?? null,
        breadcrumb: n.breadcrumb,
        passageCount: pasCounts.get(secId) || 0,
        children: (children.get(secId) || []).map(build).filter(Boolean),
      };
    };
    return this.documents
      .filter((n) => !docIdFilter || n.node_id === docIdFilter)
      .map((doc) => ({
        docId: doc.node_id,
        source: doc.props.source,
        nodes: (children.get(doc.node_id) || []).map(build).filter(Boolean),
      }));
  }

  readSectionNodes(sectionNodeIds = [], options = {}) {
    const includeDescendants = options.includeDescendants !== false;
    const byId = this.byId;
    const childSecs = this.childSections;
    const blocksByParent = this.blocksByParent;
    const targets = [];
    const seenSec = new Set();
    const walk = (id) => {
      if (seenSec.has(id)) return;
      seenSec.add(id);
      targets.push(id);
      if (includeDescendants) {
        for (const c of childSecs.get(id) || []) walk(c);
      }
    };
    for (const id of sectionNodeIds) walk(id);

    const out = [];
    const seenPas = new Set();
    for (const secId of targets) {
      for (const blkId of blocksByParent.get(secId) || []) {
        if (seenPas.has(blkId)) continue;
        const n = byId.get(blkId);
        if (!n || (n.node_type !== 'PASSAGE' && n.node_type !== 'TABLE_ROW')) continue;
        seenPas.add(blkId);
        out.push({
          nodeId: n.node_id,
          source: n.props.source,
          lineIndex: n.props.line_index,
          breadcrumb: n.breadcrumb,
          textRedacted: n.text_redacted,
        });
      }
    }
    return out.sort((a, b) => String(a.source).localeCompare(String(b.source)) || a.lineIndex - b.lineIndex);
  }

  registerArtifact({ artifactId, kind = 'cag_kv_slot', sourceNodeIds = [], props = {} }) {
    const artId = `art:${kind}:${artifactId}`;
    if (!this.byId.has(artId)) {
      const node = {
        node_id: artId,
        node_type: 'ARTIFACT',
        doc_id: null,
        breadcrumb: kind,
        text_redacted: String(artifactId),
        text_contextualized: `${kind}:${artifactId}`,
        gatekeeper_action: 'KEEP_SAFE',
        props: { kind, artifactId, ...props },
      };
      this.nodes.push(node);
      this.idToIdx.set(artId, this.nodes.length - 1);
      this.byId.set(artId, node);
    }

    const existingKeys = new Set(this.edges.map((e) => `${e.src_id}|${e.edge_type}|${e.dst_id}`));
    for (const srcNodeId of sourceNodeIds || []) {
      if (!this.byId.has(srcNodeId)) continue;
      const key = `${artId}|DERIVED_FROM|${srcNodeId}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      this.edges.push({ src_id: artId, dst_id: srcNodeId, edge_type: 'DERIVED_FROM', weight: 1.0, props: {} });
    }

    // Rebuild Dual-CSR in verisieve_graph.wasm so blastRadius immediately traverses ARTIFACT -> DERIVED_FROM -> PASSAGE -> MENTIONS -> ENTITY
    const srcs = [];
    const dsts = [];
    const types = [];
    const weights = [];
    for (const e of this.edges) {
      const s = this.idToIdx.get(e.src_id);
      const d = this.idToIdx.get(e.dst_id);
      if (s === undefined || d === undefined) continue;
      srcs.push(s);
      dsts.push(d);
      types.push(EDGE_TYPE_TO_ID[e.edge_type] ?? 0);
      weights.push(Number.isFinite(e.weight) && e.weight > 0 ? e.weight : 1.0);
    }
    this.engine.buildFromEdges(
      this.nodes.length,
      Uint32Array.from(srcs),
      Uint32Array.from(dsts),
      Uint16Array.from(types),
      Float32Array.from(weights)
    );

    return { artifactNodeId: artId, edgeCount: this.edges.length, nodeCount: this.nodes.length };
  }
}
