/**
 * src/graph-sft-builder.js
 * Graph-Grounded SFT & Future-Compatible Triples Builder (Track C2)
 *
 * Eliminates constant-prompt immediate-EOS collapse by consuming PortableDocumentGraph
 * strictly over KEEP_SAFE nodes and salted pseudonyms (<PII:PERSON_01>, ent:<kind>:<hmac16>):
 *   1. Section-contextualized long passages (packed_passage, 256-1536 tokens)
 *   2. Diverse section-anchored instruction records (section_instruction)
 *   3. Table-header-bound records (table_grounded)
 *   4. Multi-hop graph-walk Q&A chains (multihop_graph_walk via versieve_graph.wasm)
 *   5. AtlasKV / KBLaM-compatible redacted triples.jsonl
 */

import { computeNodeHash } from './clean-and-tokenize.js';
import { PortableDocumentGraph } from './graph-wasm.js';

const TRAILING_SPECIAL_EOS_RE = /(?:\s*(?:<\|im_end\|>|<\|endoftext\|>|<\|eot_id\|>|<\|end\|>|<\/s>))+\s*$/;
const ANY_SPECIAL_EOS_RE = /<\|im_end\|>|<\|endoftext\|>|<\|eot_id\|>|<\|end\|>|<\/s>/;

export function estimateSubwordTokens(text) {
  const s = String(text || '').trim();
  if (!s) return 0;
  return Math.max(1, Math.ceil(s.length / 4));
}

export function stripTrailingSpecialEos(text) {
  return String(text || '').replace(TRAILING_SPECIAL_EOS_RE, '').trimEnd();
}

function sanitizeField(text) {
  return stripTrailingSpecialEos(
    String(text || '').replace(/<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|<\|eot_id\|>|<\/s>/g, '')
  ).trim();
}

function isKeepSafeNode(node) {
  return Boolean(node && (node.gatekeeper_action === undefined || node.gatekeeper_action === 'KEEP_SAFE'));
}

function deterministicHashInt(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function selectDiverseSectionPrompt({ source, breadcrumb, sectionTitle, mergedText, entityTokens, index }) {
  const label = sectionTitle || breadcrumb || source || 'this document section';
  const ctx = breadcrumb && breadcrumb !== sectionTitle ? `${breadcrumb} (${source})` : `${label} (${source})`;
  const hasNumeric = /\$[\d,]+|\b\d+(?:\.\d+)?%|\b\d+\s+(?:days?|months?|years?)\b/i.test(mergedText);
  const hasEntity = entityTokens.length > 0;

  const candidates = [];
  if (hasNumeric) {
    candidates.push(
      `What specific numeric thresholds, limits, or statutory timelines are defined in "${ctx}"?`,
      `Detail the quantitative criteria, exemptions, and operational rules set out under "${label}" in ${source}.`
    );
  }
  if (hasEntity) {
    const entSample = entityTokens.slice(0, 2).join(' and ');
    candidates.push(
      `Describe the responsibilities, audit actions, and grounded facts involving ${entSample} in section "${ctx}".`,
      `Summarize how ${entSample} relates to the rules and findings documented under "${label}" in ${source}.`
    );
  }
  candidates.push(
    `Explain the core requirements, obligations, and procedural rules documented under "${ctx}".`,
    `Provide a structured domain synthesis of section "${label}" from ${source}, preserving all factual details.`,
    `What key governance provisions and operational constraints are established in "${ctx}"?`,
    `Outline the scope, definitions, and exceptions specified in "${label}" (${source}).`
  );

  const pick = (deterministicHashInt(`${ctx}|${index}`) + index) % candidates.length;
  return candidates[pick];
}

function buildSectionPassageGroups(graph, options = {}) {
  const maxTokens = Math.max(64, options.maxTokens ?? 1536);
  const minTokens = Math.max(16, Math.min(maxTokens, options.minTokens ?? 256));

  const provByNodeId = new Map();
  for (const p of graph.provenance || []) {
    provByNodeId.set(p.node_id, p.provenance_id);
  }

  // Group KEEP_SAFE PASSAGE nodes by (doc_id, breadcrumb) preserving deterministic reading order
  const groupsMap = new Map();
  const safePassages = (graph.passages || [])
    .filter((n) => n.node_type === 'PASSAGE' && isKeepSafeNode(n))
    .sort(
      (a, b) =>
        String(a.props?.source || '').localeCompare(String(b.props?.source || '')) ||
        (a.props?.line_index ?? 0) - (b.props?.line_index ?? 0)
    );

  for (const pas of safePassages) {
    const source = pas.props?.source || 'document';
    const breadcrumb = pas.breadcrumb || '';
    const key = `${pas.doc_id || source}||${breadcrumb}`;
    let list = groupsMap.get(key);
    if (!list) {
      list = [];
      groupsMap.set(key, list);
    }
    list.push(pas);
  }

  const mergedWindows = [];
  for (const passages of groupsMap.values()) {
    const source = passages[0].props?.source || 'document';
    const breadcrumb = passages[0].breadcrumb || '';
    const sectionTitle = breadcrumb ? breadcrumb.split(/\s*>\s*/).pop() : source;
    const header = breadcrumb ? `[${source} > ${breadcrumb}]` : `[${source}]`;

    let accTexts = [];
    let accNodeIds = [];
    let accProvIds = [];
    let accEntityIds = new Set();
    let accTokens = estimateSubwordTokens(header);

    const flush = () => {
      if (accTexts.length === 0) return;
      const body = sanitizeField(accTexts.join('\n\n'));
      const fullText = sanitizeField(`${header}\n${body}`);
      mergedWindows.push({
        source,
        breadcrumb,
        sectionTitle,
        header,
        body,
        fullText,
        estimatedTokens: estimateSubwordTokens(fullText),
        nodeIds: [...accNodeIds],
        provenanceIds: [...accProvIds],
        entityIds: Array.from(accEntityIds),
      });
      accTexts = [];
      accNodeIds = [];
      accProvIds = [];
      accEntityIds = new Set();
      accTokens = estimateSubwordTokens(header);
    };

    for (const pas of passages) {
      const clean = sanitizeField(pas.text_redacted);
      if (!clean) continue;
      const tok = estimateSubwordTokens(clean);
      if (accTexts.length > 0 && accTokens + tok > maxTokens) {
        flush();
      }
      accTexts.push(clean);
      accNodeIds.push(pas.node_id);
      accProvIds.push(provByNodeId.get(pas.node_id) || `prov:${pas.node_id}`);
      for (const entId of graph.entitiesByPas?.get(pas.node_id) || []) {
        accEntityIds.add(entId);
      }
      accTokens += tok;
      if (accTokens >= maxTokens) {
        flush();
      }
    }
    flush();
  }

  // Merge adjacent undersized windows from the same document if still below minTokens
  const packed = [];
  for (const win of mergedWindows) {
    const prev = packed[packed.length - 1];
    if (
      prev &&
      prev.source === win.source &&
      prev.estimatedTokens < minTokens &&
      prev.estimatedTokens + win.estimatedTokens <= maxTokens
    ) {
      const combinedBody = `${prev.fullText}\n\n${win.fullText}`;
      prev.fullText = sanitizeField(combinedBody);
      prev.body = sanitizeField(`${prev.body}\n\n${win.header}\n${win.body}`);
      prev.estimatedTokens = estimateSubwordTokens(prev.fullText);
      prev.nodeIds.push(...win.nodeIds);
      prev.provenanceIds.push(...win.provenanceIds);
      prev.entityIds = Array.from(new Set([...prev.entityIds, ...win.entityIds]));
      if (win.breadcrumb && prev.breadcrumb !== win.breadcrumb) {
        prev.breadcrumb = prev.breadcrumb ? `${prev.breadcrumb} ; ${win.breadcrumb}` : win.breadcrumb;
      }
    } else {
      packed.push({ ...win });
    }
  }

  return packed;
}

function buildTableRecords(graph) {
  const provByNodeId = new Map();
  for (const p of graph.provenance || []) {
    provByNodeId.set(p.node_id, p.provenance_id);
  }

  const tableRows = (graph.passages || [])
    .filter((n) => n.node_type === 'TABLE_ROW' && isKeepSafeNode(n))
    .sort(
      (a, b) =>
        String(a.props?.source || '').localeCompare(String(b.props?.source || '')) ||
        (a.props?.line_index ?? 0) - (b.props?.line_index ?? 0)
    );

  const byTable = new Map();
  for (const row of tableRows) {
    const source = row.props?.source || 'table';
    const breadcrumb = row.breadcrumb || 'Table';
    const key = `${row.doc_id || source}||${breadcrumb}`;
    let list = byTable.get(key);
    if (!list) {
      list = [];
      byTable.set(key, list);
    }
    list.push(row);
  }

  const records = [];
  let idx = 0;
  for (const rows of byTable.values()) {
    const source = rows[0].props?.source || 'table';
    const breadcrumb = rows[0].breadcrumb || 'Table';
    const headers = rows[0].props?.table_headers || [];
    const headerNames = headers.length
      ? headers.join(', ')
      : Array.from(
          new Set(
            rows.flatMap((r) =>
              String(r.text_redacted || '')
                .split(/\s*\|\s*/)
                .map((p) => p.split(':')[0]?.trim())
                .filter(Boolean)
            )
          )
        ).join(', ');

    const bodyLines = rows.map((r) => sanitizeField(r.text_redacted)).filter(Boolean);
    const body = bodyLines.join('\n');
    const provenanceIds = rows.map((r) => provByNodeId.get(r.node_id) || `prov:${r.node_id}`);
    const entityIds = Array.from(
      new Set(rows.flatMap((r) => graph.entitiesByPas?.get(r.node_id) || []))
    );
    const userPrompt = headerNames
      ? `List the structured schedule entries (${headerNames}) documented under "${breadcrumb}" in ${source}.`
      : `Extract the structured table records documented under "${breadcrumb}" in ${source}.`;
    const systemPrompt = 'Grounded compliance and domain assistant operating strictly over Versieve redacted records.';
    const assistantContent = sanitizeField(`[${source} > ${breadcrumb}]\n${body}`);
    const id = `sft:table:${idx++}`;

    records.push({
      id,
      mode: 'table_grounded',
      source,
      breadcrumb,
      table_headers: headers,
      text: assistantContent,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: assistantContent },
      ],
      estimated_tokens: estimateSubwordTokens(`${userPrompt}\n${assistantContent}`),
      entity_ids: entityIds,
      provenance_ids: provenanceIds,
      provenance_node_hash: computeNodeHash('graph_sft_table', { id, provenanceIds, assistantContent }),
    });
  }
  return records;
}

function buildMultiHopRecords(graph, options = {}) {
  const maxMultiHop = options.maxMultiHop ?? 64;
  const provByNodeId = new Map();
  for (const p of graph.provenance || []) {
    provByNodeId.set(p.node_id, p.provenance_id);
  }

  // Build entity -> KEEP_SAFE passages map
  const pasByEntity = new Map();
  for (const pas of graph.passages || []) {
    if (!isKeepSafeNode(pas)) continue;
    for (const entId of graph.entitiesByPas?.get(pas.node_id) || []) {
      let list = pasByEntity.get(entId);
      if (!list) {
        list = [];
        pasByEntity.set(entId, list);
      }
      list.push(pas);
    }
  }

  const records = [];
  let idx = 0;

  for (const [entId, passages] of pasByEntity.entries()) {
    if (records.length >= maxMultiHop) break;
    if (passages.length < 2) continue;

    // Prefer pairs spanning distinct breadcrumbs / sections
    const sorted = [...passages].sort((a, b) => (a.props?.line_index ?? 0) - (b.props?.line_index ?? 0));
    const pasA = sorted[0];
    const pasB = sorted.find((p) => p.node_id !== pasA.node_id && p.breadcrumb !== pasA.breadcrumb) || sorted[1];
    if (!pasB || pasB.node_id === pasA.node_id) continue;

    const entNode = graph.byId?.get(entId);
    const displayToken = entNode?.text_redacted || entId;
    const traced = graph.tracePath?.(pasA.node_id, pasB.node_id, { direction: 'both', maxHops: 4 });
    const hopPath = Array.isArray(traced) && traced.length >= 2 ? traced : [pasA.node_id, entId, pasB.node_id];

    const secA = pasA.breadcrumb || pasA.props?.source || 'Section A';
    const secB = pasB.breadcrumb || pasB.props?.source || 'Section B';
    const textA = sanitizeField(pasA.text_redacted);
    const textB = sanitizeField(pasB.text_redacted);
    const provA = provByNodeId.get(pasA.node_id) || `prov:${pasA.node_id}`;
    const provB = provByNodeId.get(pasB.node_id) || `prov:${pasB.node_id}`;

    const userPrompt =
      secA !== secB
        ? `Connect the findings across "${secA}" and "${secB}" regarding redacted entity ${displayToken}. What obligations, decisions, or thresholds link both sections?`
        : `Synthesize all linked evidence across passages for redacted entity ${displayToken} under "${secA}".`;

    const assistantContent = sanitizeField(
      `Across "${secA}" and "${secB}", redacted entity ${displayToken} links the following verified records:\n` +
      `1. [${secA}] ${textA}\n` +
      `2. [${secB}] ${textB}`
    );

    const id = `sft:multihop:${idx++}`;
    records.push({
      id,
      mode: 'multihop_graph_walk',
      source: pasA.props?.source || 'workspace',
      breadcrumb: secA === secB ? secA : `${secA} <-> ${secB}`,
      hop_path: hopPath,
      bridge_entity_id: entId,
      bridge_entity_token: displayToken,
      messages: [
        {
          role: 'system',
          content: 'Multi-hop grounded synthesis assistant operating strictly over Versieve redacted graphs and salted pseudonyms.',
        },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: assistantContent },
      ],
      estimated_tokens: estimateSubwordTokens(`${userPrompt}\n${assistantContent}`),
      entity_ids: [entId],
      provenance_ids: [provA, provB],
      provenance_node_hash: computeNodeHash('graph_sft_multihop', { id, hopPath, provA, provB }),
    });
  }

  return records;
}

function buildRedactedTriples(graph) {
  const provByNodeId = new Map();
  for (const p of graph.provenance || []) {
    provByNodeId.set(p.node_id, p.provenance_id);
  }

  const triples = [];
  const seen = new Set();
  const pushTriple = (triple) => {
    const key = `${triple.subject}|${triple.predicate}|${triple.object}|${triple.provenance_id}`;
    if (seen.has(key)) return;
    seen.add(key);
    triples.push(triple);
  };

  for (const pas of graph.passages || []) {
    if (!isKeepSafeNode(pas)) continue;
    const provId = provByNodeId.get(pas.node_id) || `prov:${pas.node_id}`;
    const source = pas.props?.source || 'document';
    const sectionLabel = pas.breadcrumb ? `${source} > ${pas.breadcrumb}` : source;
    const snippet = sanitizeField(pas.text_redacted).slice(0, 280);

    // 1. Structural section containment triple
    pushTriple({
      subject: sectionLabel,
      predicate: pas.node_type === 'TABLE_ROW' ? 'CONTAINS_TABLE_ROW' : 'CONTAINS_PASSAGE',
      object: snippet,
      provenance_id: provId,
      node_id: pas.node_id,
    });

    // 2. Salted entity mention + co-occurrence triples
    const entIds = graph.entitiesByPas?.get(pas.node_id) || [];
    for (const entId of entIds) {
      const entNode = graph.byId?.get(entId);
      const entToken = entNode?.text_redacted || entId;
      pushTriple({
        subject: entId,
        subject_label: entToken,
        predicate: 'MENTIONED_IN_SECTION',
        object: sectionLabel,
        context_snippet: snippet,
        provenance_id: provId,
        node_id: pas.node_id,
      });
    }
    for (let i = 0; i < entIds.length; i++) {
      for (let j = i + 1; j < entIds.length; j++) {
        pushTriple({
          subject: entIds[i],
          predicate: 'CO_OCCURS_WITH',
          object: entIds[j],
          provenance_id: provId,
          node_id: pas.node_id,
        });
      }
    }

    // 3. Table field triples from repeated header "Col: Val | Col2: Val2"
    if (pas.node_type === 'TABLE_ROW') {
      const pairs = String(pas.text_redacted || '')
        .split(/\s*\|\s*/)
        .map((seg) => {
          const colonIdx = seg.indexOf(':');
          if (colonIdx <= 0) return null;
          return [seg.slice(0, colonIdx).trim(), seg.slice(colonIdx + 1).trim()];
        })
        .filter((p) => p && p[0] && p[1]);
      if (pairs.length >= 2) {
        const rowSubject = `${pairs[0][0]}=${pairs[0][1]}`;
        for (let k = 1; k < pairs.length; k++) {
          pushTriple({
            subject: rowSubject,
            predicate: `TABLE_${pairs[k][0].toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
            object: pairs[k][1],
            provenance_id: provId,
            node_id: pas.node_id,
          });
        }
      }
    }
  }

  return triples;
}

/**
 * Builds canonical Graph-Grounded SFT records (`rtio-graph-sft.jsonl`) and
 * AtlasKV / KBLaM-compatible redacted triples (`triples.jsonl`) from a
 * `PortableDocumentGraph` (or raw KEEP_SAFE rows).
 */
export function buildGraphGroundedSft(graphOrInput, options = {}) {
  let graph = graphOrInput;
  if (!(graph instanceof PortableDocumentGraph)) {
    graph = new PortableDocumentGraph({ workspaceSalt: options.workspaceSalt });
    if (Array.isArray(graphOrInput?.documents)) {
      graph.indexDocuments(graphOrInput.documents);
    } else if (Array.isArray(graphOrInput)) {
      const keepSafe = graphOrInput.filter(
        (r) => r && (r.gatekeeper_action === undefined || r.gatekeeper_action === 'KEEP_SAFE')
      );
      const bySource = new Map();
      for (const row of keepSafe) {
        const src = row.source_file || row.source || row.source_mode || 'document';
        let list = bySource.get(src);
        if (!list) {
          list = [];
          bySource.set(src, list);
        }
        list.push({
          text: row.masked_text || row.text || row.raw_excerpt || '',
          breadcrumb: row.breadcrumb || '',
          sectionPath: row.section_path || (row.breadcrumb ? String(row.breadcrumb).split(/\s*>\s*/).filter(Boolean) : []),
          page_no: row.page_no ?? null,
          struct_role: row.struct_role || 'SECTION_BODY',
          table_headers: row.table_headers || null,
          gatekeeper_action: row.gatekeeper_action || 'KEEP_SAFE',
          entity_ids: row.entity_ids || null,
        });
      }
      const docs = Array.from(bySource.entries()).map(([source, blocks]) => ({ source, blocks }));
      if (docs.length > 0) graph.indexDocuments(docs);
    }
  }

  const includePackedPassages = options.includePackedPassages !== false;
  const includeSectionInstructions = options.includeSectionInstructions !== false;
  const includeTableRecords = options.includeTableRecords !== false;
  const includeMultiHopChains = options.includeMultiHopChains !== false;

  const sftRecords = [];
  const windows = buildSectionPassageGroups(graph, options);

  // 1. Section-contextualized long passages (packed_passage + diverse section_instruction)
  windows.forEach((win, idx) => {
    const entityTokens = win.entityIds
      .map((id) => graph.byId?.get(id)?.text_redacted)
      .filter(Boolean);

    if (includePackedPassages) {
      const id = `sft:passage:${idx}`;
      sftRecords.push({
        id,
        mode: 'packed_passage',
        source: win.source,
        breadcrumb: win.breadcrumb,
        text: win.fullText,
        estimated_tokens: win.estimatedTokens,
        entity_ids: win.entityIds,
        provenance_ids: win.provenanceIds,
        provenance_node_hash: computeNodeHash('graph_sft_passage', { id, provenanceIds: win.provenanceIds, text: win.fullText }),
      });
    }

    if (includeSectionInstructions) {
      const id = `sft:section:${idx}`;
      const userPrompt = selectDiverseSectionPrompt({
        source: win.source,
        breadcrumb: win.breadcrumb,
        sectionTitle: win.sectionTitle,
        mergedText: win.body,
        entityTokens,
        index: idx,
      });
      const systemPrompt = 'Verified domain assistant grounded in Versieve redacted sections and salted pseudonyms.';
      sftRecords.push({
        id,
        mode: 'section_instruction',
        source: win.source,
        breadcrumb: win.breadcrumb,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: win.fullText },
        ],
        estimated_tokens: estimateSubwordTokens(`${userPrompt}\n${win.fullText}`),
        entity_ids: win.entityIds,
        provenance_ids: win.provenanceIds,
        provenance_node_hash: computeNodeHash('graph_sft_section', { id, userPrompt, provenanceIds: win.provenanceIds }),
      });
    }
  });

  // 2. Table-header-bound records
  if (includeTableRecords) {
    sftRecords.push(...buildTableRecords(graph));
  }

  // 3. Multi-hop graph-walk Q&A chains
  if (includeMultiHopChains) {
    sftRecords.push(...buildMultiHopRecords(graph, options));
  }

  // 4. Future-compatible redacted triples.jsonl
  const triples = buildRedactedTriples(graph);

  // Quality & single-EOS invariant audit
  let trailingEosArtifacts = 0;
  let totalEstTokens = 0;
  const uniquePrompts = new Set();
  for (const rec of sftRecords) {
    totalEstTokens += rec.estimated_tokens || 0;
    if (typeof rec.text === 'string' && ANY_SPECIAL_EOS_RE.test(rec.text)) trailingEosArtifacts++;
    if (Array.isArray(rec.messages)) {
      for (const m of rec.messages) {
        if (ANY_SPECIAL_EOS_RE.test(m.content || '')) trailingEosArtifacts++;
        if (m.role === 'user') uniquePrompts.add(m.content);
      }
    }
  }

  return {
    sftRecords,
    triples,
    graph,
    stats: {
      totalRecords: sftRecords.length,
      packedPassageCount: sftRecords.filter((r) => r.mode === 'packed_passage').length,
      sectionInstructionCount: sftRecords.filter((r) => r.mode === 'section_instruction').length,
      tableGroundedCount: sftRecords.filter((r) => r.mode === 'table_grounded').length,
      multiHopCount: sftRecords.filter((r) => r.mode === 'multihop_graph_walk').length,
      tripleCount: triples.length,
      uniquePromptCount: uniquePrompts.size,
      meanEstimatedTokens: sftRecords.length ? Math.round((totalEstTokens / sftRecords.length) * 10) / 10 : 0,
      trailingEosArtifacts,
    },
  };
}

export function serializeGraphSftJsonl(sftRecords = []) {
  if (!sftRecords.length) return '';
  return sftRecords.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

export function serializeTriplesJsonl(triples = []) {
  if (!triples.length) return '';
  return triples.map((t) => JSON.stringify(t)).join('\n') + '\n';
}
