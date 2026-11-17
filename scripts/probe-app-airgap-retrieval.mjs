/**
 * Follow-up research probe (no LLM):
 * 1) Shortlist-K sweep: at what K does gold enter under sandbox hybrid?
 * 2) Air-gap expansions: legal synonym multi-query, BM25, RRF fuse, light RM3-style
 * Uses matilda-portable extractPdfDetailed + verisieve_clean.wasm chunking.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPdfDetailed } from '../src/pdf-parser.js';
import { loadCleanWasmSync } from '../src/clean-wasm.js';
import {
  embedNeedleWasm,
  cosineSimilarityUnitNorm,
} from '../src/wasm-needle-dl.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = String.raw`C:\Users\GEYE ARDIANSYAH\Downloads\Compliance Research\APP`;
const OUT_DIR = path.resolve(
  ROOT,
  '..',
  'Rtio',
  'docs',
  'feature-development',
  'app-rag-probe'
);
const CHAPTER_B = 'OAIC-APP-Guidelines-Chapter-B-December-2022.pdf';
const ORIGINAL =
  'Tell me about list of company that obligate with APP rules in australia?';
const LLM_STYLE =
  'which organisations are APP entities under the Privacy Act; small business operator exemption; annual turnover $3 million';

const GOLD_RE =
  /\$\s*3(?:\s*|,)?(?:000(?:\s*,?\s*000)?)?\s*(?:million)?|3\s*million|small business operator|annual turnover/i;

const COS_W = 0.55;
const LEX_W = 0.45;
const DIM = 64;
const SEED = 42;
const MAX_TOKENS = 256;
const OVERLAP = 24;
const K_SWEEP = [6, 10, 12, 20, 30, 50, 100, 160, 200];

/** Air-gap expansions: no LLM — dictionary / template only */
const AIRGAP_QUERIES = [
  ORIGINAL,
  'APP entity organisation Privacy Act Australia',
  'small business operator annual turnover 3 million exemption',
  'companies organisations obligated comply Australian Privacy Principles APP',
  'who must comply with the Australian Privacy Principles organisations agencies',
  LLM_STYLE, // oracle upper bound (still no LLM call; hardcoded string)
];

function tokenize(text) {
  return String(text).toLowerCase().match(/\b[a-z0-9]{2,}\b/g) || [];
}

function uniqueTokens(q) {
  return [...new Set(tokenize(q))];
}

function lexicalHitRate(tokens, text) {
  if (!tokens.length) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const tok of tokens) if (lower.includes(tok)) hits++;
  return hits / tokens.length;
}

function preview(text, n = 140) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, n);
}

function extractDocs(sourcesFilter = null) {
  const names = fs
    .readdirSync(APP_DIR)
    .filter((n) => n.toLowerCase().endsWith('.pdf'))
    .sort();
  const docs = [];
  for (const name of names) {
    if (sourcesFilter && !sourcesFilter.includes(name)) continue;
    const buf = fs.readFileSync(path.join(APP_DIR, name));
    const diag = extractPdfDetailed(buf);
    const text = (diag.lines || []).join('\n');
    docs.push({
      source: name,
      text,
      diagnosticReason: diag.diagnosticReason,
      chars: text.length,
    });
  }
  return docs;
}

function chunkDocs(docs, cleanEngine) {
  const chunks = [];
  for (const doc of docs) {
    const windows = cleanEngine.chunkByTokenWindow(doc.text || '', {
      maxTokens: MAX_TOKENS,
      overlapTokens: OVERLAP,
    });
    windows.forEach((win, idx) => {
      const body = win.text || '';
      chunks.push({
        id: `${doc.source}#${idx}`,
        source: doc.source,
        chunkIndex: idx,
        text: body,
        isGold: GOLD_RE.test(body),
        tokens: tokenize(body),
      });
    });
  }
  return chunks;
}

function embedAll(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 16) {
    const slice = texts.slice(i, i + 16);
    out.push(...embedNeedleWasm(slice, { dim: DIM, seed: SEED }));
  }
  return out;
}

function buildBm25Index(chunks) {
  const N = chunks.length;
  const df = new Map();
  const docLens = chunks.map((c) => c.tokens.length);
  const avgdl = docLens.reduce((a, b) => a + b, 0) / Math.max(1, N);
  for (const c of chunks) {
    for (const t of new Set(c.tokens)) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = new Map();
  for (const [t, n] of df) {
    // BM25+ style idf, floored at 0
    idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }
  return { N, avgdl, idf, k1: 1.2, b: 0.75 };
}

function bm25Score(queryTokens, chunk, index) {
  const { avgdl, idf, k1, b } = index;
  const tf = new Map();
  for (const t of chunk.tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const dl = chunk.tokens.length || 1;
  let score = 0;
  for (const t of new Set(queryTokens)) {
    const f = tf.get(t) || 0;
    if (!f) continue;
    const idfV = idf.get(t) || 0;
    const denom = f + k1 * (1 - b + (b * dl) / avgdl);
    score += idfV * ((f * (k1 + 1)) / denom);
  }
  return score;
}

function hybridScores(chunks, query, qVec, docVecs) {
  const tokens = uniqueTokens(query);
  return chunks.map((c, i) => {
    const lexical = lexicalHitRate(tokens, c.text);
    const cosine = cosineSimilarityUnitNorm(qVec, docVecs[i]);
    return {
      i,
      id: c.id,
      isGold: c.isGold,
      source: c.source,
      lexical,
      cosine,
      hybrid: COS_W * cosine + LEX_W * lexical,
      bm25: 0,
    };
  });
}

function attachBm25(rows, chunks, query, index) {
  const tokens = tokenize(query);
  for (const r of rows) {
    r.bm25 = bm25Score(tokens, chunks[r.i], index);
  }
  return rows;
}

function rankBy(rows, key) {
  return [...rows].sort((a, b) => b[key] - a[key] || a.id.localeCompare(b.id));
}

function bestGoldRank(ranked) {
  const hit = ranked.find((r) => r.isGold);
  return hit ? ranked.indexOf(hit) + 1 : null;
}

function goldInTopK(ranked, k) {
  return ranked.slice(0, k).filter((r) => r.isGold).length;
}

function rrfFuse(rankLists, k = 60) {
  const scores = new Map();
  for (const list of rankLists) {
    list.forEach((row, idx) => {
      const rank = idx + 1;
      const add = 1 / (k + rank);
      scores.set(row.i, (scores.get(row.i) || 0) + add);
    });
  }
  return scores;
}

/** Light RM3-style: take top fbDocs by BM25, add top fbTerms by df-weighted tf in those docs (exclude query stop-ish). */
function rm3Expand(query, chunks, index, rankedBm25, fbDocs = 8, fbTerms = 12) {
  const qset = new Set(tokenize(query));
  const feedback = rankedBm25.slice(0, fbDocs);
  const termScore = new Map();
  for (const row of feedback) {
    const c = chunks[row.i];
    const tf = new Map();
    for (const t of c.tokens) {
      if (t.length < 3) continue;
      if (qset.has(t)) continue;
      tf.set(t, (tf.get(t) || 0) + 1);
    }
    for (const [t, f] of tf) {
      const idf = index.idf.get(t) || 0;
      termScore.set(t, (termScore.get(t) || 0) + f * idf * (row.bm25 || 1));
    }
  }
  const added = [...termScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, fbTerms)
    .map(([t]) => t);
  return `${query} ${added.join(' ')}`.trim();
}

function sweepK(rankedHybrid) {
  const best = bestGoldRank(rankedHybrid);
  return K_SWEEP.map((k) => ({
    k,
    goldInTopK: goldInTopK(rankedHybrid, k),
    bestGoldRank: best,
    coversBestGold: best != null && best <= k,
  }));
}

function summarizeMethod(name, ranked, extra = {}) {
  return {
    name,
    bestGoldRank: bestGoldRank(ranked),
    goldInTop6: goldInTopK(ranked, 6),
    goldInTop30: goldInTopK(ranked, 30),
    goldInTop50: goldInTopK(ranked, 50),
    top6: ranked.slice(0, 6).map((r) => ({
      rank: ranked.indexOf(r) + 1,
      id: r.id,
      isGold: r.isGold,
      hybrid: Number((r.hybrid || 0).toFixed(4)),
      bm25: Number((r.bm25 || 0).toFixed(4)),
      preview: preview(chunksRef[r.i]?.text || ''),
    })),
    ...extra,
  };
}

let chunksRef = [];

function runCorpus(label, docs, cleanEngine) {
  const chunks = chunkDocs(docs, cleanEngine);
  chunksRef = chunks;
  const goldCount = chunks.filter((c) => c.isGold).length;
  const docVecs = embedAll(chunks.map((c) => c.text));
  const index = buildBm25Index(chunks);

  const qOrigVec = embedNeedleWasm(ORIGINAL, { dim: DIM, seed: SEED });
  let base = hybridScores(chunks, ORIGINAL, qOrigVec, docVecs);
  base = attachBm25(base, chunks, ORIGINAL, index);
  const rankedHybrid = rankBy(base, 'hybrid');
  const rankedBm25 = rankBy(base, 'bm25');
  const rankedLex = rankBy(base, 'lexical');
  const rankedCos = rankBy(base, 'cosine');

  // Multi-query air-gap: RRF over hybrid ranks for each expansion (except skipping duplicate)
  const expansionRankLists = [];
  const expansionResults = [];
  for (const q of AIRGAP_QUERIES) {
    const qv = embedNeedleWasm(q, { dim: DIM, seed: SEED });
    let rows = hybridScores(chunks, q, qv, docVecs);
    rows = attachBm25(rows, chunks, q, index);
    const rh = rankBy(rows, 'hybrid');
    const rb = rankBy(rows, 'bm25');
    expansionRankLists.push(rh);
    expansionResults.push({
      query: q,
      hybridBestGold: bestGoldRank(rh),
      hybridGoldInTop6: goldInTopK(rh, 6),
      bm25BestGold: bestGoldRank(rb),
      bm25GoldInTop6: goldInTopK(rb, 6),
    });
  }

  const rrfHybrid = rrfFuse(expansionRankLists);
  const rrfRows = chunks.map((c, i) => ({
    i,
    id: c.id,
    isGold: c.isGold,
    source: c.source,
    rrf: rrfHybrid.get(i) || 0,
    hybrid: base[i].hybrid,
    bm25: base[i].bm25,
  }));
  const rankedRrf = rankBy(rrfRows, 'rrf');

  // RRF of original hybrid + original BM25 only
  const rrfHb = rrfFuse([rankedHybrid, rankedBm25]);
  const rankedHb = rankBy(
    chunks.map((c, i) => ({
      i,
      id: c.id,
      isGold: c.isGold,
      rrf: rrfHb.get(i) || 0,
    })),
    'rrf'
  );

  // RM3 expand original via BM25 feedback, then hybrid+bm25
  const expanded = rm3Expand(ORIGINAL, chunks, index, rankedBm25, 8, 12);
  const qRm3 = embedNeedleWasm(expanded, { dim: DIM, seed: SEED });
  let rm3Rows = hybridScores(chunks, expanded, qRm3, docVecs);
  rm3Rows = attachBm25(rm3Rows, chunks, expanded, index);
  const rankedRm3Hybrid = rankBy(rm3Rows, 'hybrid');
  const rankedRm3Bm25 = rankBy(rm3Rows, 'bm25');

  // Oracle LLM-style string alone
  const qOracle = embedNeedleWasm(LLM_STYLE, { dim: DIM, seed: SEED });
  let oracleRows = hybridScores(chunks, LLM_STYLE, qOracle, docVecs);
  oracleRows = attachBm25(oracleRows, chunks, LLM_STYLE, index);
  const rankedOracle = rankBy(oracleRows, 'hybrid');

  return {
    label,
    sources: docs.map((d) => d.source),
    chunkCount: chunks.length,
    goldChunkCount: goldCount,
    shortlistSweep: sweepK(rankedHybrid),
    methods: {
      hybrid_original: {
        bestGoldRank: bestGoldRank(rankedHybrid),
        goldInTop6: goldInTopK(rankedHybrid, 6),
        goldInTop30: goldInTopK(rankedHybrid, 30),
        goldInTop50: goldInTopK(rankedHybrid, 50),
        top6: rankedHybrid.slice(0, 6).map((r, idx) => ({
          rank: idx + 1,
          id: r.id,
          isGold: r.isGold,
          hybrid: Number(r.hybrid.toFixed(4)),
          preview: preview(chunks[r.i].text),
        })),
      },
      bm25_original: {
        bestGoldRank: bestGoldRank(rankedBm25),
        goldInTop6: goldInTopK(rankedBm25, 6),
        goldInTop30: goldInTopK(rankedBm25, 30),
      },
      lexical_original: {
        bestGoldRank: bestGoldRank(rankedLex),
        goldInTop6: goldInTopK(rankedLex, 6),
      },
      cosine_original: {
        bestGoldRank: bestGoldRank(rankedCos),
        goldInTop6: goldInTopK(rankedCos, 6),
      },
      rrf_hybrid_bm25_original: {
        bestGoldRank: bestGoldRank(rankedHb),
        goldInTop6: goldInTopK(rankedHb, 6),
        goldInTop30: goldInTopK(rankedHb, 30),
      },
      airgap_multiquery_rrf_hybrid: {
        bestGoldRank: bestGoldRank(rankedRrf),
        goldInTop6: goldInTopK(rankedRrf, 6),
        goldInTop30: goldInTopK(rankedRrf, 30),
        expansions: expansionResults,
      },
      rm3_then_hybrid: {
        expandedQuery: expanded,
        bestGoldRank: bestGoldRank(rankedRm3Hybrid),
        goldInTop6: goldInTopK(rankedRm3Hybrid, 6),
        goldInTop30: goldInTopK(rankedRm3Hybrid, 30),
      },
      rm3_then_bm25: {
        bestGoldRank: bestGoldRank(rankedRm3Bm25),
        goldInTop6: goldInTopK(rankedRm3Bm25, 6),
        goldInTop30: goldInTopK(rankedRm3Bm25, 30),
      },
      oracle_hardcoded_statutory_hybrid: {
        bestGoldRank: bestGoldRank(rankedOracle),
        goldInTop6: goldInTopK(rankedOracle, 6),
        goldInTop30: goldInTopK(rankedOracle, 30),
      },
    },
  };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cleanEngine = loadCleanWasmSync();
  const allDocs = extractDocs();
  const chapterDocs = extractDocs([CHAPTER_B]);

  const full = runCorpus('full_app_folder', allDocs, cleanEngine);
  const chapter = runCorpus('chapter_b_only', chapterDocs, cleanEngine);

  const payload = {
    task: 'APP air-gap expansion + shortlist-K sweep (no LLM calls)',
    stack: 'extractPdfDetailed + verisieve_clean chunkByTokenWindow + Needle hybrid/BM25/RRF/RM3-lite',
    originalQuery: ORIGINAL,
    full,
    chapter,
  };

  const outJson = path.join(OUT_DIR, 'airgap-shortlist-probe.json');
  const outMd = path.join(OUT_DIR, 'airgap-shortlist-probe.md');
  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));

  const md = [];
  md.push('# APP air-gap retrieval + shortlist-K probe (no LLM)');
  md.push('');
  md.push('Stack: `extractPdfDetailed` + `verisieve_clean.wasm` chunk + Needle/BM25/RRF/RM3-lite.');
  md.push('');
  for (const run of [full, chapter]) {
    md.push(`## ${run.label} (${run.chunkCount} chunks, ${run.goldChunkCount} gold)`);
    md.push('');
    md.push('### Shortlist-K sweep (sandbox hybrid on original query)');
    md.push('');
    md.push('| K | gold count in top-K | covers best gold? |');
    md.push('| ---: | ---: | --- |');
    for (const row of run.shortlistSweep) {
      md.push(
        `| ${row.k} | ${row.goldInTopK} | ${row.coversBestGold ? 'yes' : 'no'} (best=${row.bestGoldRank}) |`
      );
    }
    md.push('');
    md.push('### Methods (best gold rank / gold@6 / gold@30)');
    md.push('');
    md.push('| Method | Best gold | @6 | @30 |');
    md.push('| --- | ---: | ---: | ---: |');
    for (const [name, m] of Object.entries(run.methods)) {
      md.push(
        `| ${name} | ${m.bestGoldRank ?? '—'} | ${m.goldInTop6 ?? '—'} | ${m.goldInTop30 ?? '—'} |`
      );
    }
    if (run.methods.rm3_then_hybrid.expandedQuery) {
      md.push('');
      md.push(`RM3-expanded query: \`${run.methods.rm3_then_hybrid.expandedQuery}\``);
    }
    md.push('');
  }
  md.push('## Verdict seeds for handoff');
  md.push('');
  md.push(
    `- Widen shortlist alone: check whether any K≤50 covers gold on hybrid_original (full=${full.methods.hybrid_original.bestGoldRank}, chapter=${chapter.methods.hybrid_original.bestGoldRank}).`
  );
  md.push(
    `- Air-gap multi-query RRF gold@6 full=${full.methods.airgap_multiquery_rrf_hybrid.goldInTop6}, chapter=${chapter.methods.airgap_multiquery_rrf_hybrid.goldInTop6}.`
  );
  md.push(
    `- Oracle statutory string hybrid gold@6 full=${full.methods.oracle_hardcoded_statutory_hybrid.goldInTop6}.`
  );
  md.push('');
  fs.writeFileSync(outMd, md.join('\n'));
  console.log(
    JSON.stringify(
      {
        fullBest: full.methods.hybrid_original.bestGoldRank,
        fullSweepCover50: full.shortlistSweep.find((s) => s.k === 50)?.coversBestGold,
        fullAirgapRrf6: full.methods.airgap_multiquery_rrf_hybrid.goldInTop6,
        fullBm25: full.methods.bm25_original.bestGoldRank,
        fullRm3: full.methods.rm3_then_hybrid.bestGoldRank,
        fullOracle: full.methods.oracle_hardcoded_statutory_hybrid.bestGoldRank,
        chapterBest: chapter.methods.hybrid_original.bestGoldRank,
        chapterAirgapRrf6: chapter.methods.airgap_multiquery_rrf_hybrid.goldInTop6,
        chapterOracle: chapter.methods.oracle_hardcoded_statutory_hybrid.bestGoldRank,
      },
      null,
      2
    )
  );
  console.log('wrote', outJson);
  console.log('wrote', outMd);
}

main();
