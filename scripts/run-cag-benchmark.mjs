#!/usr/bin/env node
/**
 * scripts/run-cag-benchmark.mjs
 * Native CAG (Cache-Augmented Generation) vs Graph-PPR Benchmark Harness (Track C4)
 *
 * Strictly zero data egress & zero hardcoded machine paths:
 * accepts corpus path via --corpus <path> or VERISIEVE_CORPUS_DIR.
 *
 * Usage:
 *   node scripts/run-cag-benchmark.mjs --corpus fixtures/clinical-study-sample.pdf --backend dry-run
 *   node scripts/run-cag-benchmark.mjs --corpus ./my-docs --backend llama-server --url http://127.0.0.1:8080 --budget 32768
 *   node scripts/run-cag-benchmark.mjs --corpus ./my-docs --backend ollama --model qwen2.5:1.5b --budget 32768
 */

import fs from 'node:fs';
import path from 'node:path';
import { extractPdfDetailed } from '../src/pdf-parser.js';
import { extractDocxText } from '../src/ingestor.js';
import {
  extractStructuredPdfBlocks,
  parseDelimitedRows,
  formatDelimitedTableBlocks,
  extractDocxStructured,
  extractMarkdownStructured,
} from '../src/structure-extractor.js';
import { PortableDocumentGraph } from '../src/graph-wasm.js';
import {
  buildCagDossier,
  registerCagArtifactInGraph,
  checkCagEviction,
  LlamaServerCagClient,
  OllamaCagClient,
} from '../src/cag-dossier.js';

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

function listFiles(targetPath) {
  const resolved = path.resolve(targetPath);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return [resolved];
  const out = [];
  for (const entry of fs.readdirSync(resolved, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(resolved, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function loadStructuredDocuments(corpusPath) {
  const files = listFiles(corpusPath);
  const docs = [];
  for (const full of files) {
    const ext = path.extname(full).toLowerCase();
    const source = path.basename(full);
    if (ext === '.pdf') {
      const diag = extractPdfDetailed(fs.readFileSync(full));
      if (diag.lineRecords?.length) {
        const { blocks } = extractStructuredPdfBlocks(source, diag.lineRecords);
        if (blocks.length) docs.push({ source, blocks });
      }
    } else if (ext === '.docx') {
      const buf = fs.readFileSync(full);
      const { blocks } = extractDocxStructured(source, buf);
      if (blocks.length) {
        docs.push({ source, blocks });
      } else {
        const legacy = extractDocxText(buf);
        if (legacy.lines.length) docs.push({ source, text: legacy.lines.join('\n') });
      }
    } else if (ext === '.csv' || ext === '.tsv') {
      const raw = fs.readFileSync(full, 'utf8');
      const { blocks } = formatDelimitedTableBlocks(source, parseDelimitedRows(raw, ext === '.tsv' ? '\t' : undefined));
      if (blocks.length) docs.push({ source, blocks });
    } else if (['.md', '.txt', '.json', '.jsonl'].includes(ext)) {
      const raw = fs.readFileSync(full, 'utf8');
      const { blocks } = extractMarkdownStructured(source, raw);
      if (blocks.length) docs.push({ source, blocks });
      else if (raw.trim()) docs.push({ source, text: raw });
    }
  }
  return docs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpusPath = args.corpus || process.env.VERISIEVE_CORPUS_DIR;
  if (!corpusPath) {
    console.error('Error: pass --corpus <file-or-dir> or set VERISIEVE_CORPUS_DIR.');
    process.exit(1);
  }
  if (!fs.existsSync(path.resolve(corpusPath))) {
    console.error(`Error: corpus path not found: ${corpusPath}`);
    process.exit(1);
  }

  const backend = String(args.backend || 'dry-run').toLowerCase();
  const budget = Math.max(256, Number.parseInt(String(args.budget || '32768'), 10) || 32768);
  const slotId = Number.parseInt(String(args['slot-id'] || '0'), 10) || 0;
  const keepAlive = String(args['keep-alive'] || '30m');

  const tLoad0 = performance.now();
  const docs = loadStructuredDocuments(corpusPath);
  const loadMs = Math.round((performance.now() - tLoad0) * 100) / 100;

  if (docs.length === 0) {
    console.error('Error: no readable documents extracted from corpus.');
    process.exit(1);
  }

  const tIdx0 = performance.now();
  const graph = new PortableDocumentGraph({ workspaceSalt: args.salt });
  const indexSummary = graph.indexDocuments(docs);
  const indexMs = Math.round((performance.now() - tIdx0) * 100) / 100;

  const tDossier0 = performance.now();
  const manifest = buildCagDossier(graph, { maxTokens: budget });
  registerCagArtifactInGraph(graph, manifest);
  const dossierMs = Math.round((performance.now() - tDossier0) * 100) / 100;

  let queries = [];
  if (args.queries) {
    const rawQ = JSON.parse(fs.readFileSync(path.resolve(args.queries), 'utf8'));
    queries = Array.isArray(rawQ) ? rawQ.map((q) => (typeof q === 'string' ? q : q.query || q.question)).filter(Boolean) : [];
  }
  if (queries.length === 0) {
    const firstSec = graph.sections[0]?.text_redacted;
    const secondSec = graph.sections[1]?.text_redacted;
    queries = [
      firstSec ? `Summarize key rules and thresholds under ${firstSec}.` : 'Summarize the key findings and rules in this workspace.',
      secondSec ? `What requirements are specified in ${secondSec}?` : 'What numeric thresholds or exceptions are documented?',
    ];
  }

  // Layer-1 Graph-PPR benchmark
  const pprRuns = [];
  for (const q of queries) {
    const t0 = performance.now();
    const res = graph.pprRetrieve(q, { topK: 6 });
    const latencyMs = Math.round((performance.now() - t0) * 100) / 100;
    pprRuns.push({
      query: q,
      latencyMs,
      returnedPassages: res.rankedPassages.length,
      seedSections: res.seedSections.length,
      seedEntities: res.seedEntities.length,
    });
  }

  // GDPR Art. 17 revocation blast-radius timing
  const sampleRevoked = manifest.taintEntityIds.slice(0, 1);
  const tEvict0 = performance.now();
  const evictionCheck = checkCagEviction(graph, manifest, sampleRevoked);
  const evictionCheckMs = Math.round((performance.now() - tEvict0) * 100) / 100;

  // Layer-2 CAG live backend benchmark (when requested)
  let cagLive = null;
  if (backend === 'llama-server') {
    const baseUrl = String(args.url || 'http://127.0.0.1:8080');
    const client = new LlamaServerCagClient(baseUrl);
    const warm = await client.warmDossier(manifest, { slotId });
    const turns = [];
    for (const q of queries) {
      turns.push(await client.queryWithDossier(manifest, q, { slotId }));
    }
    cagLive = { backend, baseUrl, warm, turns };
  } else if (backend === 'ollama') {
    const baseUrl = String(args.url || 'http://127.0.0.1:11434');
    const model = args.model;
    if (!model) {
      console.error('Error: --backend ollama requires --model <model-name>.');
      process.exit(1);
    }
    const client = new OllamaCagClient(baseUrl);
    const warm = await client.warmDossier(manifest, { model, keepAlive });
    const turns = [];
    for (const q of queries) {
      turns.push(
        await client.queryWithDossier(manifest, q, {
          model,
          keepAlive,
          baselineColdPromptTokens: warm.promptEvalCount,
        })
      );
    }
    cagLive = { backend, baseUrl, model, warm, turns };
  }

  const report = {
    schemaVersion: '1.0',
    backend,
    budgetTokens: budget,
    timingsMs: {
      loadDocumentsMs: loadMs,
      graphIndexMs: indexMs,
      cagDossierBuildMs: dossierMs,
      gdprEvictionCheckMs: evictionCheckMs,
    },
    graphSummary: {
      documentCount: docs.length,
      nodeCount: indexSummary.nodeCount,
      edgeCount: indexSummary.edgeCount,
      saltedEntityCount: indexSummary.entities.length,
    },
    cagManifest: {
      dossierSha256: manifest.dossierSha256,
      slotFilename: manifest.slotFilename,
      estimatedTokens: manifest.estimatedTokens,
      maxTokens: manifest.maxTokens,
      truncated: manifest.truncated,
      passageCount: manifest.passageCount,
      omittedPassageCount: manifest.omittedPassageIds.length,
      taintEntityCount: manifest.taintEntityIds.length,
    },
    gdprArt17EvictionAudit: evictionCheck,
    graphPprRuns: pprRuns,
    ...(cagLive ? { cagLive } : {}),
  };

  const jsonOut = JSON.stringify(report, null, 2);
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(path.resolve(args.out), jsonOut, 'utf8');
  }
  console.log(jsonOut);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
