# APP coverage query: Sandbox RAG quality diagnosis

Date: 2026-11-17. Primary sources only (Rtio sandbox code + prior matilda-portable probes). Prompt for diagnosis: user asked which organisations must follow the Australian Privacy Principles; Matilda answered from weak excerpts (extraterritorial “doing business”, AGHS noise, computer-program transparency) while the corpus contains the $3M / small-business structure. A web-search answer got the structure right.

## What the pipeline actually does

Source: `Rtio/frontend/lib/verisieve/sandbox-chat.ts`.

1. **No query rewrite.** `runSandboxChatTurn` passes `params.question` straight into `retrieveRedactedContext` ([sandbox-chat.ts](../../Rtio/frontend/lib/verisieve/sandbox-chat.ts) ~606–609). There is no HyDE, multi-query, synonym expansion, or legal-term rewrite step.

2. **Eligibility.** Only rows with non-empty `masked_text` and `KEEP_SAFE`, or `ABSTAIN_HUMAN_REVIEW` when `includeReviewRows` is true (default). `DROP_OR_QUARANTINE` and empty masks are out (`eligibleRows`, ~207–213).

3. **Lexical score.** Query tokens = unique matches of `\b[a-z0-9]{2,}\b` on the lowercased question. Score = fraction of those tokens that appear as substrings in the chunk (`lexicalScore`, ~121–128, ~332).

4. **Hybrid rank (when WASM loads).** `score = 0.55 * cosine(Needle_64(query), Needle_64(chunk)) + 0.45 * lexical` (~351–355). Cosine is a unit-vector dot of 64-dim Needle embeddings (`embedNeedleWasm`, dim 64). If WASM fails, rank is lexical only (~364–365).

5. **Selection.** `selectDiverseIndexes` takes the top 24 by score, then greedily picks `topK` (default 6, hard cap 12) with a 0.35 redundancy penalty (~152–191, ~378). Char budget `MAX_CONTEXT_CHARS = 12_000` (~54, ~386). **No minimum score** — unrelated questions still get six chunks.

6. **Generation contract.** `buildSandboxRagMessages` system prompt: answer **strictly** from redacted excerpts; cite `[n]`; if excerpts lack the answer, say so (~460–468). No sufficiency retry / second retrieval pass.

## Why this failure mode fits the code (not the PubMedQA probe)

The held-out PubMedQA probe in `results/rag-retrieval-probe.json` / `docs/2026-11-16-rag-redaction-verdict.md` shows lexical recall@5 at 98.4% and hybrid at 96% **because those questions repeat the passage**. That number does **not** transfer to:

> “list of company that obligate with APP rules in australia”

Legal coverage text typically says **APP entity**, **organisation**, **small business operator**, **annual turnover**, **$3 million** — not “company”. Lexical overlap therefore rewards chunks that literally contain `company` + `australia` (doing-business / extraterritorial / incidental “company” mentions) over the threshold chunk that never says “company”.

64-dim bag-of-ngram Needle cosine is a weak semantic bridge for that paraphrase gap. Diversity then spreads the top-6 across near-duplicate “Australia / company” surface hits, which matches the cited noise (AGHS, computer programs, privacy-policy agency wording).

The generator behaved as prompted: it stayed inside the six bad excerpts and hedged. That is **faithful generation on bad retrieval**, not a primary prompt bug. Mild prompt contribution: it did not refuse hard enough (“excerpts do not contain the answer”) and stretched inferences (agency coverage guessed from APP 1.7–1.9 policy text).

## Ranked suspects for this query

1. **Query ↔ document vocabulary mismatch under lexical-heavy hybrid** (most likely). Raw user wording; no rewrite; 0.45 lexical on exact tokens.
2. **Weak first-stage semantic** (64-dim Needle) for legal paraphrase; no BM25/IDF, no cross-encoder rerank (confirmed absent in `docs/RAG-RERANK-RESEARCH.md`).
3. **Cutoff / diversity** — if the $3M chunk is in the top-24 but not selected after diversity + topK=6, that is ranking; only a score dump confirms.
4. **Chunking / masking** — only if `$3,000,000` / “small business operator” was split or stripped from `masked_text`; not evidenced from the answer alone.
5. **Prompt** — weakest primary cause; enforces corpus-only answering. Fix retrieval first; optionally add a sufficiency second pass.

## Isolation (still the right next measurement)

Dump top-50 hybrid scores for this question against the loaded APP corpus and locate the $3M / small-business-operator chunk:

| Where $3M chunk lands | Meaning |
| --- | --- |
| Rank 1–6, unused in answer | Generation / prompt |
| Rank 7–50 | topK / diversity / cutoff |
| Absent from top 50 | embed / lexical / query / chunk text |

Paste that chunk into context by hand. If the answer flips, the generator is fine. Rewrite the query to “APP entity organisation small business operator annual turnover 3 million” and re-retrieve; if it surfaces, mismatch is confirmed.

## Fixes (payoff order, sandbox constraints)

- Query rewrite / multi-query before `retrieveRedactedContext` (legal synonyms: company→organisation/APP entity).
- Widen shortlist (e.g. 30) then diversify/rerank; keep air-gapped if using local VeRA carefully — prior VeRA reorder probe **hurt** PubMedQA gold@6 (`docs/2026-11-16-rag-redaction-verdict.md`).
- Contextual chunk headers (document title + defined terms) at ingest.
- Sufficiency check: if excerpts do not mention coverage thresholds / APP entity definitions, second retrieval with rewritten query instead of hedging.
- Do **not** treat PubMedQA hybrid 96% as evidence this legal query will retrieve well.

## Skills note

`orx-*` skills under `~/.claude/skills` are OpenResearch experiment tooling, not Matilda RAG eval. No `mle_handoff` / `rea` skill file was found under `.agents` / `.claude` in this pass; RAG handoffs live as markdown in `MLE/docs/` and `matilda-portable/docs/`.
