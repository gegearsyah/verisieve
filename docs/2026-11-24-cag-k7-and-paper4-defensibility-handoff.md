# CAG-vs-RAG-vs-Finetune Third Arm, Paper 4 Defensibility, and Conceptual-Upgrade Assessment Handoff

Stage K7 plus research. Spawned by the founder after the K3 results landed on
`feat/parked-followups`. The founder asked four things: run the missing deployment
arm (CAG) and the missing retrieval control (BM25), make Paper 4 more sound and
defensible with literature, extend the open-source data hunt, and assess whether
there is a conceptual upgrade in the CAG direction. This handoff packages all four.

## Binding constraints (read first)

1. **Branch from `feat/parked-followups`, in a NEW worktree.** The K3 artifact
   (`results/track-k-composition-head-to-head.json`), the K4 artifact, the open-estate
   artifacts, and the rewritten Paper 4 all live on that branch, not on `main`. Do not
   branch from `main` (you would not have the inputs) and do not work in the existing
   `matilda-parked` worktree (two writers on one tree corrupt each other).
2. **GPU required, founder-gated.** The K7 answering passes need the same local model
   K3 used (Qwen2.5-1.5B-Instruct, offline: `HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1`).
   The founder releases the GPU; if it is not released, do the CPU-only research items
   (Items 2, 3, 4) first and record the wait as a deviation.
3. **Honest-results discipline:** every paper number must trace to a checked-in raw
   artifact, enforced by `node scripts/check-paper-numbers.mjs` (currently 955 checks).
   If a K7 number is quoted in a paper, the artifact, the paper text, AND a checker
   needle land in one commit. Deviations are recorded, never smoothed.
4. **Word bans in papers and docs:** "mathematically grounded", /eliminat/ (eliminates/
   eliminating/eliminated), novelty-claim "first" ("first to", "the first", "for the
   first time", "our first"), "perceive everything", "atomic knowledge". No em-dashes.
5. **Verification bar:** `npm run test:ci` green end-to-end, `node bin/versieve.mjs
   audit-wasm` allVerified, no unintended `results/*.json` dirt (restore wallclock dirt
   with explicit-path `git checkout -- <paths>`, never `git add -A`; never touch the
   committed `results/open-estate-baseline.json` Enron aggregates — see the
   `OPEN_ESTATE_BASELINE_OUT` guard in `scripts/open-estate-baseline.mjs` for the
   pattern to copy for any artifact a test regenerates).
6. **No push.** Commits land on your branch; the founder gates pushes.
7. **Citations are pinned via arxiv.org abs pages or the export API
   (`http://export.arxiv.org/api/query?...`), never search snippets.** This is not
   ritual: during the lead's own CAG research, two search-snippet arXiv IDs were
   wrong — 2505.19012 is actually a movable-antenna paper and 2505.04865 is solar
   physics. Both were falsified by fetching their abs pages. Any ID you get from a
   snippet must be verified the same way before it appears in any repo file.
8. Binary-inspection tooling is never named in any repo file.
9. Paper style: titles hit the training-data question; privacy words never lead a
   title or abstract sentence.

## Context: what K3 measured and the founder's challenge

K3 (`results/track-k-composition-head-to-head.json`, commit `bc4afb3`) ran six arms at
an equal 25,755-token budget on the noisy estate: Graph-PPR retrieval (no finetune)
53.3% all EM (Q2 cross-document 83.3%), composed 11.7%, per-block 10.0%, flat 6.7%,
composed+pairs 1.7% and vaulted 1.7% (both at the untrained base floor), base 1.7%.
Canary exposure 8.48-8.57 bits trained vs 4.25 base. Judge agreement was low
(6.7-41.7%) — a known weakness Paper 4 must keep stating.

The founder then challenged the result twice, and both challenges are the reason this
handoff exists:

- **"Does the estate make retrieval artificially easy?"** Partly yes, and the honest
  boundaries are already in Paper 4: factoid verbatim-answer questions, a small estate,
  capacity-starved trained arms by design (equal budget). The missing control is a
  **non-graph retrieval baseline (BM25)**: without it, "retrieval wins" cannot be
  split into "retrieval is easy here" versus "the graph's join is what wins". Item 1
  closes this.
- **"Is our non-training arm KV-cache / CAG?"** No, and this correction is now part
  of the record: the K3 retrieval arm is plain per-question RAG — fresh prefill of the
  top-6 PPR contexts per question, KV cache discarded after each question, nothing
  reused across questions. CAG (precompute KV states once, reuse across queries,
  truncate back to the cache boundary between questions) was never run. Conceptually
  our composed per-entity records arguably favor CAG; that is a hypothesis until
  Item 1 measures it.

## Verified literature (lead's research, build on it, do not redo it)

- **arXiv:2412.15605** — Chan, Chen, Cheng, Huang, "Don't Do RAG: When
  Cache-Augmented Generation is All You Need for Knowledge Tasks" (WWW '25 short
  paper). Verified from the full text: SQuAD at 3/4/7 documents (21k/32k/50k tokens),
  HotpotQA at 16/32/64 documents (21k/43k/85k tokens), 500 QA per config; KV cache
  precomputed once, queries append-only, independent questions answered after
  truncation back to the cache boundary; BM25 and dense (LlamaIndex, top-1/3/5/10)
  baselines; Llama-3.1-8B/70B; BERTScore as the metric; CAG best in most configs at
  those sizes; the authors state preloading becomes "impractical for significantly
  larger datasets" and suggest a hybrid of preloaded base plus selective retrieval.
  Two caveats for any citation: their metric is BERTScore (not comparable to our EM
  without saying so), and their corpora are 21k-85k tokens — the same order as our
  per-arm budget (25,755) and small enough that one of our composed per-entity records
  is a comparable cache unit.
- **arXiv:2505.08261** — Agrawal, Kumar, "Enhancing Cache-Augmented Generation (CAG)
  with Adaptive Contextual Compression for Scalable Knowledge Integration" (verified
  via abs page). Independently confirms the CAG scaling problem and proposes adaptive
  compression plus a hybrid CAG-RAG framework. Useful as a second source for "the
  scale limit is acknowledged in the field".
- **arXiv:2607.28979** — KV cache translation across heterogeneous LLMs (verified via
  export API). Adjacent: the field is working toward reusing caches across model
  swaps. Do not over-claim from the abstract alone; read before citing beyond a
  related-work mention.
- Gaps you may close in Item 2 (verify before citing): long-context degradation
  literature ("lost in the middle" style results), RAG-vs-long-context comparison
  studies, and any CAG critique or follow-up that surfaces via the export API (a
  `all:"cache-augmented generation"` export-API query and an
  `all:"context caching" AND all:"CAG"` query were both run; the second returned 0 —
  that is absence of evidence, not evidence of absence).

## Item 1: Stage K7 — CAG arm and BM25 control on the K3 estate (GPU for answering)

Same estate, same 60 questions, same EM scoring, same model as K3. No training. The
K3 artifact is the binding input: `arms.retrieval.rows` carries the 60 rows
(`qid`, `stratum`, `attr`, `question`, `expectedValue`); `buildReceipts.pprContexts`
records what the graph retriever chose; `recipe` pins the model and generation
parameters. Reuse the question rows verbatim so K7 scores are directly comparable to
the K3 retrieval arm.

**Arm A, BM25 control (non-graph retrieval):** rank the same composed record blocks
the graph retriever saw, with a from-scratch BM25 (the estate is small; a
plain token-frequency BM25 in Node, no dependency, no `src/` import — anti-circularity
rules below). Take the top-6 contexts per question (same context count as the K3
retrieval arm), prompt identically, answer with base Qwen2.5-1.5B-Instruct, score with
the same EM machinery. This arm needs the model only for answering; the ranking is
CPU-side and can be built and unit-tested before the GPU is released.

**Arm B, CAG (cache-augmented):** follow arXiv:2412.15605's mechanism, not just its
name: prefill the composed per-entity records once, keep the KV states, answer each
question append-only, and truncate back to the cache boundary between independent
questions. Decide and record, before running: what gets cached (the natural unit is
the hub-capped composed record set covering the entities the 60 questions touch),
the cache token count, and any overflow handling — if the chosen record set exceeds
the model context, that is a result and a recorded deviation, not a reason to
silently trim. Record cache build time, per-question latency, and prefilled tokens
per question in both arms so the amortization comparison is a number, not an
assertion.

**Cache-validity check (CPU):** the amnesiac-corpus machinery already proves erasure
by byte-diff. Add the one-step extension: after a simulated erasure of one entity,
show the composed record's SHA pin no longer matches, so any cached KV state built
from the pre-erasure bytes is detectably stale by a byte check. One assert-style
test is enough; do not build a cache manager nobody asked for.

**Honesty rules for this item:**

- 60 questions is small: a few points of EM difference between arms is noise and the
  run record must say so plainly. Report per-stratum breakdown (Q1/Q2/Q3) — Q3
  (16.7% for the graph retriever) is where "retrieval is easy here" gets its honest
  test, because the disambiguation stratum is where a lexical retriever should fail
  differently than a graph one.
- Both arms must import only `node:` builtins for their retrieval/ranking logic; the
  engine never sees the answer key (the K3 anti-circularity note is the reference).
- If CAG underperforms RAG, that is the result; report it. The conceptual upgrade
  (Item 4) is gated on what this measures, not on what we hoped.

Deliverables: `results/track-k7-cag-vs-rag-vs-bm25.json` (deterministic, no wallclock
fields, seed pinned, SHA receipts for anything cached), external-behavior tests wired
into `test:ci` (mirror the K3/K4 test pattern; serialize any suite that regenerates
shared fixtures into its own `node --test` invocation — the K4 race is the recorded
precedent), checker needles if and only if a K7 number enters a paper, and a dated
run-record entry with every deviation.

## Item 2: Paper 4 defensibility research (CPU)

Paper 4 is `paper/versieve-graph-grounded-enterprise-corpus.tex` on
`feat/parked-followups` (compiles clean, 8 pages, 0 undefined refs; every number is
needled in `scripts/check-paper-numbers.mjs`). Its claims are already boundary-stated;
your job is to close the remaining reviewer attacks with literature and, where
literature cannot close them, with more honest boundaries:

1. **"Retrieval is easy on this estate."** After Item 1, the BM25 control is the
   answer in the paper: add the arm to the head-to-head table and one paragraph on
   what the graph did or did not add over lexical retrieval, per stratum. If BM25
   matches the graph retriever, say the graph's contribution on this estate is not
   retrieval quality — that is a defensible, honest claim, and the cross-table JOIN
   and Q3 results still stand on their own.
2. **"The CAG comparison is not in the literature you cite."** Add the verified
   related-work paragraph: CAG (2412.15605) evaluates on 21k-85k-token corpora with
   BERTScore and BM25/dense baselines and names its own scale limit; adaptive
   compression and hybrid CAG-RAG (2505.08261) respond to that limit. State plainly
   that our EM is not their BERTScore and our estate is not their corpus, and that
   Item 1 is our own controlled comparison, not a replication.
3. **"Judge agreement is low."** Already recorded in the artifact and stated in the
   paper. Check the literature for LLM-judge reliability norms so the caveat cites
   something rather than apologizing; if nothing load-bearing surfaces via the export
   API, leave the honest statement as-is.
4. **"Small n."** If you add any K7 numbers to a paper table, report the stratum
   counts alongside (24/24/12) and do not attach significance language to a few
   points.
5. Every new citation: pinned via abs page or export API (constraint 7), title and
   framing obey the word bans, and any number you quote from a paper is read from the
   paper itself, not from its abstract or a snippet.

## Item 3: extend the open-source data hunt (CPU)

The verified inventory and the rejection ledger live in
`docs/research-notes/2026-11-24-open-estate-dataset-hunt.md` (OpenSanctions is
CC BY-NC and Fisher is LDC fee-gated; do not revisit those). Extend it, do not rewrite
it, with candidates for a possible third estate, biased toward what Item 1 makes
interesting: document clusters that hang together **per entity**, because per-entity
composed records are the cache unit under test. Directions worth checking
(license-verify each via the primary source before it enters any table):

- NER/identity corpora with open licenses (CoNLL-2003, OntoNotes, WikiNER-style
  extractions) as real-mention sources for a synthetic overlay, same layered honesty
  as K6 (real mentions, overlay identity where relabeling real people would be
  dishonest).
- Knowledge-base-derived synthetic estates (Wikidata CC0/CDL-shaped licensing is the
  thing to verify, not assume).
- Anything meeting the K6 rule: downloads land outside the repo tree in a new empty
  directory until licensing is confirmed; NC or fee-gated stays out.

Scope: a dated research-note update with verified licenses and a recommendation.
Do not build a third estate in this handoff; that is a separate gate.

## Item 4: conceptual-upgrade assessment (CPU, gated on Item 1)

The candidate upgrade, stated as a hypothesis the founder asked us to assess: the
composed per-entity record is not just a training-data unit but a **bounded,
SHA-pinned KV-cache unit** — self-contained enough to cache whole (CAG's requirement),
small enough to fit the regime the CAG literature actually validated (21k-85k tokens),
and invalidatable at erasure granularity by a byte check (no external paper has this
handle; a cache built from erased bytes is detectably stale because the record SHA
changed). The graph becomes the router that picks which cache to load.

Rules for writing this up anywhere:

- **Measured-first:** no paper sentence claims the cache-unit property before Item 1
  produces numbers. If CAG loses to RAG on this estate, the upgrade dies and the run
  record says so; if CAG wins or ties within noise, the paper may state the measured
  part and mark the invalidation property as a mechanism the codebase already has
  (byte-diff receipts), not as a benchmarked win.
- The Amnesiac Corpus honest-framing rules bind: erasure is a property, not a
  headline; privacy words never lead.
- The novelty-claim "first" ban binds even when the temptation is strongest here.

Deliverable: one dated assessment section in the run record — what K7 measured, what
the upgrade claim would be, and whether it survives. If the founder wants it in
Paper 4 after that, it is a separate edit gated on the numbers.

## Reporting

Append dated run-record entries to
`docs/2026-11-24-versieve-novelty-and-remediation-handoff.md` (deviations recorded
never smoothed, commit shas included). Item 1 gets its own dated executed-run entry
with the full per-arm results verbatim, like the K3 entry. Explicit-path commits only.
When you finish, leave the branch unpushed and report: what ran, what is green, what
deviated, and what the founder must gate next.
