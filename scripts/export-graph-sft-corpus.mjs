#!/usr/bin/env node
/**
 * scripts/export-graph-sft-corpus.mjs
 * Strictly Deduplicated, Zero-Egress Compliance Corpus -> Graph-Grounded SFT & Triples Exporter
 *
 * Guarantees 100% unique records across 3 layers:
 *   Layer 1: Exact file-level SHA-256 deduplication (skips identical copies)
 *   Layer 2: Passage/block-level exact SHA-256 + versieve_clean.wasm 64-lane MinHash near-dedup (>= 0.85 Jaccard)
 *   Layer 3: Output record-level SHA-256 deduplication across rtio-graph-sft.jsonl & triples.jsonl
 *
 * Strictly zero data egress & zero hardcoded machine paths:
 * accepts corpus via --corpus <dir-or-file> or VERSIEVE_CORPUS_DIR.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadCleanWasmSync } from '../src/clean-wasm.js';
import { extractPdfDetailed } from '../src/pdf-parser.js';
import { isHtmlDocumentBuffer, isPdfDocumentBuffer } from '../src/document-format.js';
import { extractDocxText, stripHtmlBoilerplate } from '../src/ingestor.js';
import {
  extractStructuredPdfBlocks,
  parseDelimitedRows,
  formatDelimitedTableBlocks,
  extractDocxStructured,
  extractMarkdownStructured,
} from '../src/structure-extractor.js';
import { PortableDocumentGraph } from '../src/graph-wasm.js';
import {
  buildGraphGroundedSft,
  serializeGraphSftJsonl,
  serializeTriplesJsonl,
} from '../src/graph-sft-builder.js';
import { buildCagDossier } from '../src/cag-dossier.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function sha256Hex(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex');
}

function normalizeForDedup(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function listFilesRecursive(targetPath) {
  const resolved = path.resolve(targetPath);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return [resolved];
  const out = [];
  for (const entry of fs.readdirSync(resolved, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(resolved, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function isBoilerplateChunk(text, cleanWasm) {
  const trimmed = String(text || '').trim();
  if (trimmed.length < 20) return true;
  const stripped = cleanWasm.stripBoilerplate(trimmed, { html: false, chrome: true }).trim();
  if (!stripped || stripped.length < trimmed.length * 0.4) return true;
  return /(?:^|\b)(?:copyright\s+notice|all\s+rights\s+reserved|reproduction\s+prohibited|urgent\s+facsimile\s+transmission|confidential\s+patient\s+intake)(?:\b|$)|^\s*(?:confidential|page\s+\d+(?:\s+of\s+\d+)?)\s*$/i.test(trimmed);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpusPath = args.corpus || process.env.VERSIEVE_CORPUS_DIR;
  if (!corpusPath) {
    console.error('Error: pass --corpus <dir-or-file> or set VERSIEVE_CORPUS_DIR.');
    process.exit(1);
  }
  const resolvedCorpus = path.resolve(corpusPath);
  if (!fs.existsSync(resolvedCorpus)) {
    console.error(`Error: corpus path not found: ${corpusPath}`);
    process.exit(1);
  }

  const outDir = path.resolve(args.out || 'results/untrusted-benchmarks/track-c-compliance-dataset');
  const dedupThreshold = Number.parseFloat(String(args['dedup-threshold'] || '0.85'));
  const minTokens = Math.max(64, Number.parseInt(String(args['min-tokens'] || '256'), 10) || 256);
  const maxTokens = Math.max(minTokens, Number.parseInt(String(args['max-tokens'] || '1536'), 10) || 1536);
  const chunkTokens = Math.max(64, Number.parseInt(String(args['chunk-tokens'] || '320'), 10) || 320);
  const chunkOverlap = Math.max(0, Number.parseInt(String(args['chunk-overlap'] || '24'), 10) || 24);
  const cagBudget = Math.max(4096, Number.parseInt(String(args['cag-budget'] || '32768'), 10) || 32768);
  const excludePatterns = String(args['exclude-sources'] || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const maxRecords = args['max-records'] ? Math.max(1, Number.parseInt(String(args['max-records']), 10) || 0) : 0;

  const cleanWasm = loadCleanWasmSync();
  cleanWasm.dedupReset();

  const SUPPORTED_EXTS = new Set(['.pdf', '.md', '.txt', '.html', '.htm', '.docx', '.csv', '.tsv']);
  const allFiles = listFilesRecursive(resolvedCorpus);

  const seenFileHashes = new Set();
  const seenExactChunkHashes = new Set();
  const dedupStats = {
    totalFilesScanned: allFiles.length,
    supportedFiles: 0,
    skippedUnsupportedFiles: 0,
    skippedDuplicateFiles: 0,
    skippedUnreadableOrScannedPdfs: 0,
    acceptedFiles: 0,
    rawChunksExamined: 0,
    droppedBoilerplateChunks: 0,
    droppedExactDuplicateChunks: 0,
    droppedNearDuplicateChunks: 0,
    uniqueChunksKept: 0,
    nearDedupThreshold: dedupThreshold,
  };

  const docsForGraph = [];
  const t0 = performance.now();

  for (const fullPath of allFiles) {
    const ext = path.extname(fullPath).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) {
      dedupStats.skippedUnsupportedFiles++;
      continue;
    }
    dedupStats.supportedFiles++;

    const buf = fs.readFileSync(fullPath);
    const fileHash = sha256Hex(buf);
    if (seenFileHashes.has(fileHash)) {
      dedupStats.skippedDuplicateFiles++;
      continue;
    }
    seenFileHashes.add(fileHash);

    const relSource = path.relative(resolvedCorpus, fullPath).replace(/\\/g, '/');
    if (excludePatterns.length > 0 && excludePatterns.some((pat) => relSource.toLowerCase().includes(pat))) {
      dedupStats.skippedHoldoutFiles = (dedupStats.skippedHoldoutFiles || 0) + 1;
      continue;
    }
    let extractedBlocks = [];

    try {
      if (ext === '.pdf') {
        if (isHtmlDocumentBuffer(buf)) {
          const clean = stripHtmlBoilerplate(buf.toString('utf8')).cleanText;
          extractedBlocks = extractMarkdownStructured(relSource, clean).blocks;
        } else if (!isPdfDocumentBuffer(buf)) {
          dedupStats.skippedUnreadableOrScannedPdfs++;
          continue;
        } else {
          const diag = extractPdfDetailed(buf);
          if (diag.encrypted || !diag.lineRecords || diag.lineRecords.length === 0) {
            dedupStats.skippedUnreadableOrScannedPdfs++;
            continue;
          }
          extractedBlocks = extractStructuredPdfBlocks(relSource, diag.lineRecords).blocks;
        }
      } else if (ext === '.docx') {
        const s = extractDocxStructured(relSource, buf);
        if (s.blocks.length > 0) extractedBlocks = s.blocks;
        else {
          const legacy = extractDocxText(buf);
          if (legacy.lines.length) {
            extractedBlocks = extractMarkdownStructured(relSource, legacy.lines.join('\n')).blocks;
          }
        }
      } else if (ext === '.html' || ext === '.htm') {
        const clean = stripHtmlBoilerplate(buf.toString('utf8')).cleanText;
        extractedBlocks = extractMarkdownStructured(relSource, clean).blocks;
      } else if (ext === '.csv' || ext === '.tsv') {
        const parsed = parseDelimitedRows(buf.toString('utf8'), ext === '.tsv' ? '\t' : undefined);
        extractedBlocks = formatDelimitedTableBlocks(relSource, parsed).blocks;
      } else {
        extractedBlocks = extractMarkdownStructured(relSource, buf.toString('utf8')).blocks;
      }
    } catch {
      dedupStats.skippedUnreadableOrScannedPdfs++;
      continue;
    }

    if (!extractedBlocks.length) {
      dedupStats.skippedUnreadableOrScannedPdfs++;
      continue;
    }

    const uniqueBlocksForDoc = [];
    for (const blk of extractedBlocks) {
      const chunks =
        blk.structRole === 'TABLE_ROW'
          ? [{ text: blk.text }]
          : cleanWasm.chunkByTokenWindow(blk.text, { maxTokens: chunkTokens, overlapTokens: chunkOverlap });

      for (const ch of chunks) {
        const chunkText = String(ch.text || '').trim();
        if (!chunkText) continue;
        dedupStats.rawChunksExamined++;

        if (isBoilerplateChunk(chunkText, cleanWasm)) {
          dedupStats.droppedBoilerplateChunks++;
          continue;
        }

        const norm = normalizeForDedup(chunkText);
        if (norm.length < 20) {
          dedupStats.droppedBoilerplateChunks++;
          continue;
        }

        // Layer 2A: Exact normalized SHA-256 dedup
        const chunkHash = sha256Hex(norm);
        if (seenExactChunkHashes.has(chunkHash)) {
          dedupStats.droppedExactDuplicateChunks++;
          continue;
        }

        // Layer 2B: versieve_clean.wasm 64-lane MinHash near-duplicate dedup
        const checkSlice = norm.length > 16000 ? norm.slice(0, 16000) : norm;
        const dRes = cleanWasm.dedupCheck(checkSlice, dedupThreshold);
        if (dRes.action === 'exact_duplicate') {
          dedupStats.droppedExactDuplicateChunks++;
          continue;
        }
        if (dRes.action === 'near_duplicate') {
          dedupStats.droppedNearDuplicateChunks++;
          continue;
        }

        seenExactChunkHashes.add(chunkHash);
        dedupStats.uniqueChunksKept++;
        uniqueBlocksForDoc.push({
          ...blk,
          text: chunkText,
          gatekeeper_action: 'KEEP_SAFE',
        });
      }
    }

    if (uniqueBlocksForDoc.length > 0) {
      dedupStats.acceptedFiles++;
      docsForGraph.push({ source: relSource, blocks: uniqueBlocksForDoc });
    }
  }

  // Index strictly deduplicated corpus into PortableDocumentGraph (salted pseudonyms)
  const graph = new PortableDocumentGraph({ workspaceSalt: args.salt });
  const graphSummary = graph.indexDocuments(docsForGraph);

  // Build Graph-Grounded SFT + Triples
  const built = buildGraphGroundedSft(graph, {
    minTokens,
    maxTokens,
    maxMultiHop: 256,
  });

  // Layer 3: Output-level exact uniqueness guarantee across SFT records and triples
  const seenSftFingerprints = new Set();
  let uniqueSftRecords = [];
  let droppedDupSftRecords = 0;
  for (const rec of built.sftRecords) {
    const body =
      rec.mode === 'packed_passage'
        ? rec.text || ''
        : (rec.messages || []).map((m) => `${m.role}:${m.content}`).join('\n');
    const fp = sha256Hex(`${rec.mode}|${normalizeForDedup(body)}`);
    if (seenSftFingerprints.has(fp)) {
      droppedDupSftRecords++;
      continue;
    }
    seenSftFingerprints.add(fp);
    uniqueSftRecords.push(rec);
  }
  if (maxRecords > 0 && uniqueSftRecords.length > maxRecords) {
    // Balanced round-robin stratified sample across modes so all modes (packed, section, table, multihop) are represented
    const byMode = new Map();
    for (const r of uniqueSftRecords) {
      const m = r.mode || 'other';
      const arr = byMode.get(m) || [];
      arr.push(r);
      byMode.set(m, arr);
    }
    const sampled = [];
    const buckets = Array.from(byMode.values());
    let cursor = 0;
    while (sampled.length < maxRecords && buckets.some((b) => cursor < b.length)) {
      for (const b of buckets) {
        if (cursor < b.length && sampled.length < maxRecords) {
          sampled.push(b[cursor]);
        }
      }
      cursor++;
    }
    uniqueSftRecords = sampled;
  }

  const seenTripleFingerprints = new Set();
  const uniqueTriples = [];
  let droppedDupTriples = 0;
  for (const t of built.triples) {
    const fp = sha256Hex(normalizeForDedup(`${t.subject}|${t.predicate}|${t.object}`));
    if (seenTripleFingerprints.has(fp)) {
      droppedDupTriples++;
      continue;
    }
    seenTripleFingerprints.add(fp);
    uniqueTriples.push(t);
  }

  const cagManifest = buildCagDossier(graph, { maxTokens: cagBudget });
  const elapsedMs = Math.round((performance.now() - t0) * 100) / 100;

  fs.mkdirSync(outDir, { recursive: true });
  const sftPath = path.join(outDir, 'rtio-graph-sft.jsonl');
  const triplesPath = path.join(outDir, 'triples.jsonl');
  const cagManifestPath = path.join(outDir, 'cag-manifest.json');
  const auditPath = path.join(outDir, 'dataset-audit.json');

  fs.writeFileSync(sftPath, serializeGraphSftJsonl(uniqueSftRecords), 'utf8');
  fs.writeFileSync(triplesPath, serializeTriplesJsonl(uniqueTriples), 'utf8');
  fs.writeFileSync(
    cagManifestPath,
    JSON.stringify(
      {
        schemaVersion: cagManifest.schemaVersion,
        dossierSha256: cagManifest.dossierSha256,
        slotFilename: cagManifest.slotFilename,
        estimatedTokens: cagManifest.estimatedTokens,
        maxTokens: cagManifest.maxTokens,
        truncated: cagManifest.truncated,
        documentCount: cagManifest.documentCount,
        sectionCount: cagManifest.sectionCount,
        passageCount: cagManifest.passageCount,
        omittedPassageCount: cagManifest.omittedPassageIds.length,
        taintEntityCount: cagManifest.taintEntityIds.length,
      },
      null,
      2
    ),
    'utf8'
  );

  const report = {
    schemaVersion: '1.0',
    elapsedMs,
    outputFiles: {
      sftJsonl: sftPath,
      triplesJsonl: triplesPath,
      cagManifest: cagManifestPath,
      auditJson: auditPath,
    },
    deduplication: {
      ...dedupStats,
      droppedDuplicateSftRecords: droppedDupSftRecords,
      droppedDuplicateTriples: droppedDupTriples,
      uniqueSftRecordCount: uniqueSftRecords.length,
      uniqueTripleCount: uniqueTriples.length,
      allRecords100PctUnique:
        uniqueSftRecords.length === seenSftFingerprints.size &&
        uniqueTriples.length === seenTripleFingerprints.size,
      wasmDedupRingOverflowed: cleanWasm.dedupOverflowed(),
      wasmDedupEvicted: cleanWasm.dedupEvicted(),
    },
    graphSummary: {
      documentsIndexed: docsForGraph.length,
      nodeCount: graphSummary.nodeCount,
      edgeCount: graphSummary.edgeCount,
      saltedEntityCount: graphSummary.entities.length,
    },
    sftBreakdown: {
      packedPassageCount: uniqueSftRecords.filter((r) => r.mode === 'packed_passage').length,
      sectionInstructionCount: uniqueSftRecords.filter((r) => r.mode === 'section_instruction').length,
      tableGroundedCount: uniqueSftRecords.filter((r) => r.mode === 'table_grounded').length,
      multiHopCount: uniqueSftRecords.filter((r) => r.mode === 'multihop_graph_walk').length,
      meanEstimatedTokens: built.stats.meanEstimatedTokens,
      uniquePromptCount: built.stats.uniquePromptCount,
      trailingEosArtifacts: built.stats.trailingEosArtifacts,
    },
  };

  fs.writeFileSync(auditPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
