/**
 * Faithful APP retrieval isolation dump:
 * - extract via matilda-portable extractPdfDetailed (same text-layer path as portable/Rtio)
 * - chunk via versieve_clean.wasm chunkByTokenWindow (256/24)
 * - rank via Needle 0.55/0.45 hybrid (sandbox-chat formula, no diversity)
 * - compare full APP folder vs Chapter B only
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
const APP_DIR = path.resolve(
  ROOT,
  '..',
  'Compliance Research',
  'APP'
);
// Founder path is under Downloads, not Innovation Hub sibling
const APP_DIR_ALT =
  process.env.VERSIEVE_APP_CORPUS_DIR ||
  path.resolve(ROOT, '..', '..', 'Compliance Research', 'APP');
const OUT_DIR = path.resolve(
  ROOT,
  '..',
  'Rtio',
  'docs',
  'feature-development',
  'app-rag-probe'
);

const COS_W = 0.55;
const LEX_W = 0.45;
const MAX_TOKENS = 256;
const OVERLAP = 24;
const DIM = 64;
const SEED = 42;

const ORIGINAL =
  'Tell me about list of company that obligate with APP rules in australia?';
const REWRITTEN =
  'which organisations are APP entities under the Privacy Act; small business operator exemption; annual turnover $3 million';

const GOLD_RE =
  /\$\s*3(?:\s*|,)?(?:000(?:\s*,?\s*000)?)?\s*(?:million)?|3\s*million|small business operator|annual turnover/i;

const CHAPTER_B = 'OAIC-APP-Guidelines-Chapter-B-December-2022.pdf';

function resolveAppDir() {
  if (fs.existsSync(APP_DIR_ALT)) return APP_DIR_ALT;
  if (fs.existsSync(APP_DIR)) return APP_DIR;
  throw new Error(`APP corpus not found at ${APP_DIR_ALT}`);
}

function queryTokens(q) {
  return [...new Set(String(q).toLowerCase().match(/\b[a-z0-9]{2,}\b/g) || [])];
}

function lexicalScore(tokens, text) {
  if (!tokens.length) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const tok of tokens) if (lower.includes(tok)) hits++;
  return hits / tokens.length;
}

function preview(text, n = 180) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, n);
}

function extractPdfText(filePath) {
  const buf = fs.readFileSync(filePath);
  const diag = extractPdfDetailed(buf);
  const text = (diag.lines || []).join('\n');
  return {
    diagnosticReason: diag.diagnosticReason,
    pageCount: diag.pageCount,
    lineCount: (diag.lines || []).length,
    isLikelyScanned: !!diag.isLikelyScanned,
    encrypted: !!diag.encrypted,
    chars: text.length,
    text,
  };
}

function buildChunks(docs, cleanEngine) {
  const chunks = [];
  for (const doc of docs) {
    const windows = cleanEngine.chunkByTokenWindow(doc.text || '', {
      maxTokens: MAX_TOKENS,
      overlapTokens: OVERLAP,
    });
    if (windows.length === 0 && doc.text.trim()) {
      chunks.push({
        id: `${doc.source}#0`,
        source: doc.source,
        chunkIndex: 0,
        masked_text: doc.text,
        tokenCount: null,
        isGold: GOLD_RE.test(doc.text),
      });
      continue;
    }
    windows.forEach((win, idx) => {
      const body = win.text || '';
      chunks.push({
        id: `${doc.source}#${idx}`,
        source: doc.source,
        chunkIndex: idx,
        masked_text: body,
        tokenCount: win.tokenCount ?? null,
        isGold: GOLD_RE.test(body),
      });
    });
  }
  return chunks;
}

function embedDocs(texts) {
  const out = [];
  const BATCH = 16;
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const part = embedNeedleWasm(slice, { dim: DIM, seed: SEED });
    if (!Array.isArray(part) || part.length !== slice.length) {
      throw new Error(`embed batch failed at ${i}`);
    }
    out.push(...part);
  }
  return out;
}

function rankAll(chunks, query, vectors, queryVector) {
  const tokens = queryTokens(query);
  const rows = chunks.map((c, i) => {
    const lexical = lexicalScore(tokens, c.masked_text);
    const cosine = cosineSimilarityUnitNorm(queryVector, vectors[i]);
    const combined = COS_W * cosine + LEX_W * lexical;
    return {
      ...c,
      lexical: Number(lexical.toFixed(4)),
      cosine: Number(cosine.toFixed(4)),
      combined: Number(combined.toFixed(4)),
      queryTokenHits: tokens.filter((t) => c.masked_text.toLowerCase().includes(t)),
    };
  });
  rows.sort((a, b) => b.combined - a.combined || a.id.localeCompare(b.id));
  return rows.map((r, rank) => ({ rank: rank + 1, ...r }));
}

function summarize(ranked, query) {
  const goldRanks = ranked.filter((r) => r.isGold).map((r) => r.rank);
  const top = (n) =>
    ranked.slice(0, n).map((r) => ({
      rank: r.rank,
      id: r.id,
      source: r.source,
      combined: r.combined,
      cosine: r.cosine,
      lexical: r.lexical,
      isGold: r.isGold,
      queryTokenHits: r.queryTokenHits.slice(0, 10),
      preview: preview(r.masked_text),
    }));
  return {
    query,
    chunkCount: ranked.length,
    goldChunkCount: goldRanks.length,
    bestGoldRank: goldRanks[0] ?? null,
    goldInTop6: goldRanks.filter((r) => r <= 6).length,
    goldInTop50: goldRanks.filter((r) => r <= 50).length,
    goldRanksFirst20: goldRanks.slice(0, 20),
    top6: top(6),
    top12: top(12),
    top50: top(50),
    alfrinkInTop12: ranked
      .slice(0, 12)
      .filter((r) => /Alfrink/i.test(r.source))
      .map((r) => r.rank),
  };
}

function runCorpus(label, docs, cleanEngine, qOrig, qRew) {
  const chunks = buildChunks(docs, cleanEngine);
  const vectors = embedDocs(chunks.map((c) => c.masked_text));
  const rankedOrig = rankAll(chunks, ORIGINAL, vectors, qOrig);
  const rankedRew = rankAll(chunks, REWRITTEN, vectors, qRew);
  return {
    label,
    sources: docs.map((d) => d.source),
    extract: docs.map((d) => ({
      source: d.source,
      diagnosticReason: d.diagnosticReason,
      pageCount: d.pageCount,
      lineCount: d.lineCount,
      chars: d.chars,
    })),
    chunkCount: chunks.length,
    goldChunkCount: chunks.filter((c) => c.isGold).length,
    original: summarize(rankedOrig, ORIGINAL),
    rewritten: summarize(rankedRew, REWRITTEN),
  };
}

function mdSection(run) {
  const lines = [];
  lines.push(`## Corpus: ${run.label}`);
  lines.push('');
  lines.push(
    `Sources (${run.sources.length}): ${run.sources.map((s) => `\`${s}\``).join(', ')}`
  );
  lines.push(`Chunks: **${run.chunkCount}** · gold marker chunks: **${run.goldChunkCount}**`);
  lines.push('');
  for (const d of run.extract) {
    lines.push(
      `- \`${d.source}\`: ${d.diagnosticReason}, pages=${d.pageCount}, lines=${d.lineCount}, chars=${d.chars}`
    );
  }
  lines.push('');
  for (const side of [run.original, run.rewritten]) {
    const name = side.query === ORIGINAL ? 'original' : 'rewritten';
    lines.push(`### ${name}`);
    lines.push('');
    lines.push(`\`${side.query}\``);
    lines.push('');
    lines.push(
      `- Best gold: **${side.bestGoldRank ?? 'none'}** · in top-6: **${side.goldInTop6}** · in top-50: **${side.goldInTop50}**`
    );
    if (side.alfrinkInTop12?.length) {
      lines.push(`- Alfrink ranks in top-12: ${side.alfrinkInTop12.join(', ')}`);
    }
    lines.push('');
    lines.push('| Rank | Comb | Cos | Lex | Gold | Source | Preview |');
    lines.push('| --- | ---: | ---: | ---: | --- | --- | --- |');
    for (const r of side.top12) {
      lines.push(
        `| ${r.rank} | ${r.combined} | ${r.cosine} | ${r.lexical} | ${r.isGold ? 'Y' : ''} | \`${r.source}\` | ${r.preview.replace(/\|/g, '/')} |`
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const appDir = resolveAppDir();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cleanEngine = loadCleanWasmSync();

  const pdfs = fs
    .readdirSync(appDir)
    .filter((n) => n.toLowerCase().endsWith('.pdf'))
    .sort();
  const skipped = fs
    .readdirSync(appDir)
    .filter((n) => !n.toLowerCase().endsWith('.pdf'));

  const allDocs = [];
  for (const name of pdfs) {
    const full = path.join(appDir, name);
    const ex = extractPdfText(full);
    allDocs.push({ source: name, path: full, ...ex });
    console.log(
      `extract ${name}: ${ex.diagnosticReason} pages=${ex.pageCount} lines=${ex.lineCount} chars=${ex.chars}`
    );
  }

  const [qOrig, qRew] = embedNeedleWasm([ORIGINAL, REWRITTEN], { dim: DIM, seed: SEED });
  const full = runCorpus('full_app_folder', allDocs, cleanEngine, qOrig, qRew);
  const chapterOnlyDocs = allDocs.filter((d) => d.source === CHAPTER_B);
  if (chapterOnlyDocs.length !== 1) {
    throw new Error(`Expected ${CHAPTER_B} in corpus`);
  }
  const chapter = runCorpus('chapter_b_only', chapterOnlyDocs, cleanEngine, qOrig, qRew);

  const payload = {
    task: 'Faithful APP sandbox-ranker isolation (matilda-portable extract + clean.wasm chunk)',
    extractor: 'matilda-portable/src/pdf-parser.js#extractPdfDetailed',
    chunker: 'versieve_clean.wasm chunkByTokenWindow maxTokens=256 overlap=24',
    ranker: '0.55*Needle cosine + 0.45*lexical hit-rate (no diversity)',
    appDir,
    skippedNonPdf: skipped,
    full,
    chapter,
    delta: {
      originalBestGold: {
        full: full.original.bestGoldRank,
        chapterB: chapter.original.bestGoldRank,
      },
      rewrittenBestGold: {
        full: full.rewritten.bestGoldRank,
        chapterB: chapter.rewritten.bestGoldRank,
      },
      originalGoldInTop6: {
        full: full.original.goldInTop6,
        chapterB: chapter.original.goldInTop6,
      },
      chunkCount: { full: full.chunkCount, chapterB: chapter.chunkCount },
      alfrinkInTop12OriginalFull: full.original.alfrinkInTop12,
    },
  };

  const outJson = path.join(OUT_DIR, 'faithful-top50-dump.json');
  const outMd = path.join(OUT_DIR, 'faithful-top50-dump.md');
  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));

  const md = [];
  md.push('# Faithful APP retrieval dump (matilda-portable extract + clean.wasm chunk)');
  md.push('');
  md.push(`Corpus: \`${appDir}\``);
  md.push(`Skipped non-PDF: ${skipped.map((s) => `\`${s}\``).join(', ') || '(none)'}`);
  md.push('');
  md.push('| Corpus | Chunks | Orig best gold | Orig gold@6 | Rewritten best gold | Rewritten gold@6 |');
  md.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  md.push(
    `| full folder | ${full.chunkCount} | ${full.original.bestGoldRank} | ${full.original.goldInTop6} | ${full.rewritten.bestGoldRank} | ${full.rewritten.goldInTop6} |`
  );
  md.push(
    `| Chapter B only | ${chapter.chunkCount} | ${chapter.original.bestGoldRank} | ${chapter.original.goldInTop6} | ${chapter.rewritten.bestGoldRank} | ${chapter.rewritten.goldInTop6} |`
  );
  md.push('');
  md.push(
    `Alfrink in full-folder original top-12 ranks: **${full.original.alfrinkInTop12.join(', ') || 'none'}**`
  );
  md.push('');
  md.push(mdSection(full));
  md.push(mdSection(chapter));
  md.push('## Verdict');
  md.push('');
  const fo = full.original.bestGoldRank;
  const co = chapter.original.bestGoldRank;
  if (fo != null && fo > 6 && (co == null || co <= 6)) {
    md.push(
      `- Full folder keeps gold outside top-6 (rank ${fo}); Chapter B alone moves it to rank ${co} → **extra PDFs are costing recall into the sandbox window**.`
    );
  } else if (fo != null && co != null) {
    md.push(
      `- Original best gold: full=${fo}, Chapter B only=${co}. Rewrite full=${full.rewritten.bestGoldRank}, Chapter B=${chapter.rewritten.bestGoldRank}.`
    );
  }
  md.push(
    `- Extractor/chunker are the portable stack; prior PyMuPDF dump remains in \`top50-dump.*\` for comparison only.`
  );
  md.push('');
  fs.writeFileSync(outMd, md.join('\n'));

  console.log('delta', JSON.stringify(payload.delta, null, 2));
  console.log('wrote', outJson);
  console.log('wrote', outMd);
}

main();
