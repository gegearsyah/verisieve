/**
 * src/cag-dossier.js
 * Native Cache-Augmented Generation (CAG) Dossier Builder & KV-Slot Clients (Track C4)
 *
 * Zero retraining, zero custom PyTorch attention:
 *   1. Serializes a bounded, strictly redacted KEEP_SAFE workspace dossier from
 *      PortableDocumentGraph in deterministic TOC reading order (<= 16k/32k/64k tokens).
 *   2. Emits dossier_sha256 + taint_entity_ids[] + slotFilename manifest so GDPR Art. 17
 *      entity revocation immediately identifies and evicts tainted KV slots via
 *      verisieve_graph.wasm blast_radius.
 *   3. Integrates natively with llama-server (--slot-save-path) and Ollama (keep_alive).
 */

import crypto from 'node:crypto';
import { estimateSubwordTokens } from './graph-sft-builder.js';

function isKeepSafe(node) {
  return Boolean(node && (node.gatekeeper_action === undefined || node.gatekeeper_action === 'KEEP_SAFE'));
}

function collectOrderedBlocksForDoc(graph, docNode) {
  const ordered = [];
  const seenBlockIds = new Set();

  const pushBlocksOf = (parentId, headingTitle, level) => {
    const blkIds = graph.blocksByParent?.get(parentId) || [];
    const blkNodes = blkIds
      .map((id) => graph.byId.get(id))
      .filter((n) => n && (n.node_type === 'PASSAGE' || n.node_type === 'TABLE_ROW') && isKeepSafe(n))
      .sort((a, b) => (a.props?.line_index ?? 0) - (b.props?.line_index ?? 0));

    if (headingTitle && blkNodes.length > 0) {
      ordered.push({ kind: 'section_header', title: headingTitle, level: Math.max(2, Math.min(6, level + 1)) });
    }
    for (const blk of blkNodes) {
      if (seenBlockIds.has(blk.node_id)) continue;
      seenBlockIds.add(blk.node_id);
      ordered.push({ kind: 'block', node: blk });
    }
  };

  // Top-level blocks directly under DOCUMENT
  pushBlocksOf(docNode.node_id, null, 1);

  // DFS pre-order walk of child SECTION nodes
  const visitedSec = new Set();
  const walkSection = (secId) => {
    if (visitedSec.has(secId)) return;
    visitedSec.add(secId);
    const secNode = graph.byId.get(secId);
    if (!secNode || secNode.node_type !== 'SECTION' || !isKeepSafe(secNode)) return;
    const level = secNode.props?.level ?? 1;
    const blkIds = graph.blocksByParent?.get(secId) || [];
    const childSecs = graph.childSections?.get(secId) || [];
    const hasOwnBlocks = blkIds.some((id) => {
      const n = graph.byId.get(id);
      return n && (n.node_type === 'PASSAGE' || n.node_type === 'TABLE_ROW') && isKeepSafe(n);
    });
    if (hasOwnBlocks) {
      pushBlocksOf(secId, secNode.text_redacted, level);
    } else if (childSecs.length > 0) {
      ordered.push({ kind: 'section_header', title: secNode.text_redacted, level: Math.max(2, Math.min(6, level + 1)) });
    }
    for (const childId of childSecs) {
      walkSection(childId);
    }
  };

  for (const rootSecId of graph.childSections?.get(docNode.node_id) || []) {
    walkSection(rootSecId);
  }

  return ordered;
}

/**
 * Serializes a strictly redacted KEEP_SAFE workspace dossier in deterministic TOC
 * reading order, capped cleanly at `options.maxTokens` (default 32768).
 */
export function buildCagDossier(graph, options = {}) {
  const maxTokens = Math.max(32, Math.round(options.maxTokens ?? 32768));
  const preamble =
    options.preamble ??
    'You are answering questions strictly from the verified, PII-redacted VeriSieve workspace dossier below. Preserve salted entity tags (<PII:...>) exactly and never fabricate facts outside this dossier.';

  const provByNodeId = new Map();
  for (const p of graph.provenance || []) {
    provByNodeId.set(p.node_id, p.provenance_id);
  }

  const parts = [];
  let usedTokens = 0;
  if (preamble) {
    parts.push(preamble);
    usedTokens += estimateSubwordTokens(preamble);
  }

  const includedPassageIds = [];
  const omittedPassageIds = [];
  const includedProvenanceIds = [];
  const taintEntitySet = new Set();
  const includedDocs = new Set();
  let sectionCount = 0;
  let truncated = false;

  const docs = [...(graph.documents || [])]
    .filter(isKeepSafe)
    .sort((a, b) => String(a.props?.source || '').localeCompare(String(b.props?.source || '')));

  for (const doc of docs) {
    const source = doc.props?.source || doc.text_redacted || doc.node_id;
    const docHeader = `# Document: ${source}`;
    const docHeaderTok = estimateSubwordTokens(docHeader);
    let docHeaderEmitted = false;
    let pendingSectionHeader = null;

    const items = collectOrderedBlocksForDoc(graph, doc);
    for (const item of items) {
      if (item.kind === 'section_header') {
        pendingSectionHeader = `${'#'.repeat(item.level)} ${item.title}`;
        continue;
      }

      const blk = item.node;
      const blkText = String(blk.text_redacted || '').trim();
      if (!blkText) continue;

      if (truncated) {
        omittedPassageIds.push(blk.node_id);
        continue;
      }

      const pendingParts = [];
      let deltaTok = 0;
      if (!docHeaderEmitted) {
        pendingParts.push(docHeader);
        deltaTok += docHeaderTok;
      }
      if (pendingSectionHeader) {
        pendingParts.push(pendingSectionHeader);
        deltaTok += estimateSubwordTokens(pendingSectionHeader);
      }
      pendingParts.push(blkText);
      deltaTok += estimateSubwordTokens(blkText);

      // Clean boundary check: always include at least 1 passage if dossier is otherwise empty
      if (includedPassageIds.length > 0 && usedTokens + deltaTok > maxTokens) {
        truncated = true;
        omittedPassageIds.push(blk.node_id);
        continue;
      }

      if (!docHeaderEmitted) {
        docHeaderEmitted = true;
        includedDocs.add(doc.node_id);
      }
      if (pendingSectionHeader) {
        sectionCount++;
        pendingSectionHeader = null;
      }
      parts.push(...pendingParts);
      usedTokens += deltaTok;
      includedPassageIds.push(blk.node_id);
      includedProvenanceIds.push(provByNodeId.get(blk.node_id) || `prov:${blk.node_id}`);
      for (const entId of graph.entitiesByPas?.get(blk.node_id) || []) {
        taintEntitySet.add(entId);
      }
    }
  }

  const dossierText = parts.join('\n\n');
  const dossierSha256 = crypto.createHash('sha256').update(dossierText).digest('hex');
  const slotFilename = `cag-slot-${dossierSha256.slice(0, 16)}.bin`;
  const taintEntityIds = Array.from(taintEntitySet).sort();

  return {
    schemaVersion: '1.0',
    dossierText,
    dossierSha256,
    slotFilename,
    taintEntityIds,
    includedPassageIds,
    omittedPassageIds,
    includedProvenanceIds,
    estimatedTokens: estimateSubwordTokens(dossierText),
    maxTokens,
    truncated,
    documentCount: includedDocs.size,
    sectionCount,
    passageCount: includedPassageIds.length,
  };
}

/**
 * Registers the CAG KV-slot manifest as an ARTIFACT node in PortableDocumentGraph
 * with DERIVED_FROM edges to every included passage so verisieve_graph.wasm blast_radius
 * can immediately identify tainted KV caches on GDPR Art. 17 entity revocation.
 */
export function registerCagArtifactInGraph(graph, manifest) {
  return graph.registerArtifact({
    artifactId: manifest.dossierSha256.slice(0, 16),
    kind: 'cag_kv_slot',
    sourceNodeIds: manifest.includedPassageIds,
    props: {
      dossierSha256: manifest.dossierSha256,
      slotFilename: manifest.slotFilename,
      estimatedTokens: manifest.estimatedTokens,
    },
  });
}

/**
 * Evaluates GDPR Art. 17 cache eviction using verisieve_graph.wasm blastRadius
 * over revoked salted entity IDs (`ent:<kind>:<hmac16>`).
 */
export function checkCagEviction(graph, manifest, revokedEntityIds = []) {
  const revokedSet = new Set((revokedEntityIds || []).filter(Boolean));
  if (revokedSet.size === 0) {
    return {
      mustEvict: false,
      matchedEntities: [],
      affectedNodeIds: [],
      hitArtifact: false,
      slotFilename: manifest.slotFilename,
      dossierSha256: manifest.dossierSha256,
      reason: 'NO_REVOKED_ENTITIES',
    };
  }

  const includedPasSet = new Set(manifest.includedPassageIds || []);
  const expectedArtId = `art:cag_kv_slot:${manifest.dossierSha256.slice(0, 16)}`;

  const blastHits = graph.blastRadius(Array.from(revokedSet), {
    direction: 'in',
    maxHops: 3,
    edgeTypes: ['MENTIONS', 'DERIVED_FROM'],
  });

  const affectedNodeIds = blastHits
    .filter((h) => includedPasSet.has(h.nodeId) || h.nodeId === expectedArtId)
    .map((h) => h.nodeId);
  const hitArtifact = blastHits.some((h) => h.nodeId === expectedArtId);
  const matchedEntities = (manifest.taintEntityIds || []).filter((id) => revokedSet.has(id));
  const mustEvict = hitArtifact || affectedNodeIds.length > 0 || matchedEntities.length > 0;

  return {
    mustEvict,
    matchedEntities,
    affectedNodeIds,
    hitArtifact,
    slotFilename: manifest.slotFilename,
    dossierSha256: manifest.dossierSha256,
    reason: mustEvict ? 'GDPR_ART17_ENTITY_TAINT_DETECTED' : 'CLEAN_NO_OVERLAP',
  };
}

/**
 * Native llama-server (`llama.cpp --slot-save-path`) CAG client with KV slot save/restore/erase.
 */
export class LlamaServerCagClient {
  constructor(baseUrl = 'http://127.0.0.1:8080', options = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.fetchImpl = options.fetch || globalThis.fetch;
  }

  async _postJson(endpoint, payload) {
    const res = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`LLAMA_SERVER_HTTP_${res.status}: ${errText || endpoint}`);
    }
    return await res.json();
  }

  async saveSlot(slotId, filename) {
    return await this._postJson(`/slots/${slotId}?action=save`, { filename });
  }

  async restoreSlot(slotId, filename) {
    return await this._postJson(`/slots/${slotId}?action=restore`, { filename });
  }

  async eraseSlot(slotId) {
    return await this._postJson(`/slots/${slotId}?action=erase`, {});
  }

  async warmDossier(manifest, options = {}) {
    const slotId = options.slotId ?? 0;
    const promptPrefix = options.promptPrefix ?? `${manifest.dossierText}\n\n`;
    const t0 = performance.now();
    const completion = await this._postJson('/completion', {
      prompt: promptPrefix,
      id_slot: slotId,
      cache_prompt: true,
      n_predict: options.warmPredictTokens ?? 0,
      temperature: 0,
    });
    const saveRes = options.saveSlot === false ? null : await this.saveSlot(slotId, manifest.slotFilename);
    const latencyMs = Math.round((performance.now() - t0) * 100) / 100;
    const timings = completion.timings || {};

    return {
      backend: 'llama-server',
      slotId,
      slotFilename: manifest.slotFilename,
      dossierSha256: manifest.dossierSha256,
      saved: Boolean(saveRes),
      latencyMs,
      promptEvalTokens: timings.prompt_n ?? 0,
      promptEvalMs: timings.prompt_ms ?? latencyMs,
      cacheHitTokens: timings.cache_n ?? 0,
    };
  }

  async queryWithDossier(manifest, question, options = {}) {
    const slotId = options.slotId ?? 0;
    const prompt = `${manifest.dossierText}\n\nQuestion: ${question}\nAnswer:`;
    const t0 = performance.now();
    const completion = await this._postJson('/completion', {
      prompt,
      id_slot: slotId,
      cache_prompt: true,
      n_predict: options.maxTokens ?? 256,
      temperature: options.temperature ?? 0.0,
      stop: options.stop ?? ['\nQuestion:', '\n\nQuestion:'],
    });
    const latencyMs = Math.round((performance.now() - t0) * 100) / 100;
    const timings = completion.timings || {};
    const cacheHitTokens = timings.cache_n ?? 0;

    return {
      backend: 'llama-server',
      slotId,
      answer: String(completion.content || '').trim(),
      latencyMs,
      promptEvalTokens: timings.prompt_n ?? 0,
      promptEvalMs: timings.prompt_ms ?? 0,
      cacheHitTokens,
      predictedTokens: timings.predicted_n ?? 0,
      cacheHit: cacheHitTokens > 0,
    };
  }
}

/**
 * Native Ollama (`keep_alive`) CAG client with `prompt_eval_count` KV cache-hit telemetry.
 */
export class OllamaCagClient {
  constructor(baseUrl = 'http://127.0.0.1:11434', options = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.fetchImpl = options.fetch || globalThis.fetch;
  }

  async _postJson(endpoint, payload) {
    const res = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OLLAMA_HTTP_${res.status}: ${errText || endpoint}`);
    }
    return await res.json();
  }

  async warmDossier(manifest, options = {}) {
    const model = options.model;
    if (!model) throw new Error('OllamaCagClient.warmDossier requires options.model');
    const keepAlive = options.keepAlive ?? '30m';
    const numCtx = options.numCtx ?? Math.min(65536, Math.max(4096, manifest.maxTokens + 1024));
    const t0 = performance.now();

    const data = await this._postJson('/api/generate', {
      model,
      prompt: `${manifest.dossierText}\n\nAcknowledge workspace dossier loaded.`,
      stream: false,
      keep_alive: keepAlive,
      ...(options.think !== undefined ? { think: Boolean(options.think) } : {}),
      options: {
        num_ctx: numCtx,
        num_predict: 1,
        temperature: 0,
      },
    });
    const latencyMs = Math.round((performance.now() - t0) * 100) / 100;

    return {
      backend: 'ollama',
      model,
      keepAlive,
      dossierSha256: manifest.dossierSha256,
      latencyMs,
      promptEvalCount: data.prompt_eval_count ?? 0,
      promptEvalCachedCount: data.prompt_eval_cached_count ?? 0,
      promptEvalDurationMs: Math.round(((data.prompt_eval_duration ?? 0) / 1e6) * 100) / 100,
      totalDurationMs: Math.round(((data.total_duration ?? 0) / 1e6) * 100) / 100,
    };
  }

  async queryWithDossier(manifest, question, options = {}) {
    const model = options.model;
    if (!model) throw new Error('OllamaCagClient.queryWithDossier requires options.model');
    const keepAlive = options.keepAlive ?? '30m';
    const numCtx = options.numCtx ?? Math.min(65536, Math.max(4096, manifest.maxTokens + 1024));
    const t0 = performance.now();

    const data = await this._postJson('/api/generate', {
      model,
      prompt: `${manifest.dossierText}\n\nQuestion: ${question}\nAnswer:`,
      stream: false,
      keep_alive: keepAlive,
      ...(options.think !== undefined ? { think: Boolean(options.think) } : {}),
      options: {
        num_ctx: numCtx,
        num_predict: options.maxTokens ?? 256,
        temperature: options.temperature ?? 0.0,
      },
    });
    const latencyMs = Math.round((performance.now() - t0) * 100) / 100;
    const promptEvalCount = data.prompt_eval_count ?? 0;
    const promptEvalCachedCount = data.prompt_eval_cached_count ?? 0;
    const baseline = options.baselineColdPromptTokens ?? manifest.estimatedTokens;
    const cacheHit =
      promptEvalCachedCount > 0 ||
      (baseline > 0 && promptEvalCount > 0 && promptEvalCount < baseline * 0.5);

    return {
      backend: 'ollama',
      model,
      answer: String(data.response || '').trim(),
      latencyMs,
      promptEvalCount,
      promptEvalCachedCount,
      promptEvalDurationMs: Math.round(((data.prompt_eval_duration ?? 0) / 1e6) * 100) / 100,
      evalCount: data.eval_count ?? 0,
      totalDurationMs: Math.round(((data.total_duration ?? 0) / 1e6) * 100) / 100,
      cacheHit,
    };
  }

  async evictModel(model) {
    if (!model) throw new Error('OllamaCagClient.evictModel requires model');
    return await this._postJson('/api/generate', {
      model,
      prompt: '',
      stream: false,
      keep_alive: 0,
    });
  }
}
