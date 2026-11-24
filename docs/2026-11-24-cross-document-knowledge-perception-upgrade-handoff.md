# Versieve Upgrade Handoff: Cross-Document Knowledge Perception (the "Knowledge Between All Data" Upgrade)

Authoring session 2026-11-24, branch `fix/spec-15-remediation`. This handoff is the fully-ready plan
for the founder-requested upgrade: *"make the perception literally perceive everything? including
knowledge between all the data?"* It is built from the completed novelty research
(`docs/research-notes/2026-11-24-graph-grounded-corpus-novelty-research.md`, this session) and
extends — does not replace — the remediation handoff
(`docs/2026-11-24-versieve-novelty-and-remediation-handoff.md`), whose standing rules, traps, and
open stages (Stage 4 sweep, GPU ablation backfill, push-to-main gate) all remain in force.

---

## 1. Standing Rules (carried over; binding)

All rules from the remediation handoff §1 apply unchanged. Deltas and reinforcements for this
track:

1. **The phrase "perceive everything" never enters a paper, README, or benchmark name.** The
   research verdict is binding: doc-level relation extraction (DocRED line), cross-document
   coreference (SciCo line), and OpenIE are established fields — a capability claim there is a
   rejection, not a contribution. The survivable object is the **modality + constraint package**:
   heterogeneous enterprise surfaces under zero-egress byte budgets, with identity merges and
   facts landed into training samples with receipts. The upgrade is named
   **cross-document knowledge perception**.
2. **"Atomic knowledge" is borrowed vocabulary** (FActScore line, GraphGen's atomic QA). The delta
   is stated as *provenance-bound, identity-bound units over the enterprise's own resolved graph*.
3. **Every downstream-training claim is gated on the K1 head-to-head** (Stage K1 below). Until it
   is measured, graph grounding is a property with receipts, not a training benefit — Paper 4 §7.3
   says so and stays so.
4. **Any sample-schema extension re-issues the corpus.** Cross-document fact fields landing in
   samples change corpus bytes → every frozen SHA-256 receipt, the byte-diff ablation, and the
   certificate pass rate must be regenerated under a bumped `AMNESIAC_ENGINE_VERSION` and
   re-measured. Never mix receipts across versions.
5. Citation pinning on `arxiv.org` only (search-snippet IDs failed verification 4/4 again this
   session — the running total of caught fabrications is 12+); binary-inspection tooling never
   named in any committed file; commits are explicit-path, no `git add -A`, no push without the
   founder.

## 2. State at Handoff Time — verified 2026-11-24 (this session)

- Paper 4 draft committed (`59e4e06`): "Standalone Knowledge, Not Stitched Chunks" — repositioned
  value-first per the founder's clarification; erasure is a property/section, never the headline.
- `scripts/check-paper-numbers.mjs`: **793 checks, 0 failures** (includes the 56-needle Paper 4
  block against `amnesiac-corpus-ablation.json`, `company-brain-slice.json`,
  `argon-parity-benchmark.json`).
- `npm run test:ci` green (includes the amnesiac, slice, and Argon suites); `audit-wasm` allVerified.
- Stage 4 PT-LM epoch/lr sweep running on GPU (background; 18 combos) — it owns the GPU queue until
  it finishes; the GPU ablation backfill is queued behind it, and K1 is queued behind that.
- Cross-department linking on the synthetic estate: 54/54 links, P/R/F1 = 100%, 16/16 GT people
  resolved — construction-validation numbers, scope note binding.
- Research verdict (the input to this plan): strongest novelty bet = the sample schema as a
  measured artifact; biggest hole = the downstream hypothesis is its own missing experiment;
  recommended upgrade = measurement families (1) identity-merge with failure taxonomy and
  (2) cross-document fact coverage K, with an open-estate variant, **only after** the flat-vs-
  grounded training comparison exists.

## 3. The Upgrade, Framed Honestly

The founder's request translates to a falsifiable claim, not an adjective:

> **Knowledge-perception coverage K** = the percentage of manifest facts that span ≥ 2 documents
> and are recoverable from perception output alone (no retrieval, no model query), at byte budget
> B, at zero egress — together with **cross-document identity receipts**: P/R/F1 of merges against
> manifest ground truth, with a **false-merge / false-split failure taxonomy** broken down by
> surface-form difficulty (ASR-variant/homophone, OCR-variant, abbreviation).

What the upgrade is NOT: an OpenIE-class capability claim; a "perceive everything" marketing
claim; a cross-doc-coref algorithm claim. We claim no new linkage algorithm — resolved identity is
a *field of the training unit* with receipts.

## 4. Stage Plan

Owners: lead + subagents (haiku default, sonnet on one failure, opus for hard problems); lead
verifies everything; subagent green reports carry no authority. One logical commit per stage,
explicit paths.

**Stage K1 — Flat-chunk vs graph-grounded adapter head-to-head (GPU; gates everything)**
- What: from the SAME estate and SAME budget, produce two corpora: (a) flat positional chunks of
  the same masked content (standard windowing, no entity fields), (b) the graph-grounded Amnesiac
  corpus. Train two LoRA adapters with the sealed recipe (r16/α32; steps/lr from the Stage 4 sweep
  — record which combo). Evaluate on: (i) multi-hop questions whose answers require facts spanning
  ≥ 2 departments/documents — authored from the manifest, never from engine output; (ii) blinded
  0–2 rubric judging via the permitted judge path (DeepSeek swarm, sanitized PII-free outputs
  only; canaries/decoys never leave; local-judge agreement column); (iii) Carlini canary exposure
  per adapter.
- Verify: `results/track-k-flat-vs-grounded.json`; needles in `check-paper-numbers.mjs`;
  `npm run test:ci`; anti-circularity assertion (eval questions manifest-authored).
- Report: win, loss, or tie, verbatim. A loss is a publishable result and re-scopes the paper —
  it is not smoothed.
- GPU queue: after the Stage 4 sweep and the pending ablation backfill. Abort rule: on VRAM
  conflict, shrink steps (recorded), never the corpus.
- Commit: `feat(bench): flat-chunk vs graph-grounded adapter head-to-head`.

**Stage K2 — Cross-document identity-merge failure taxonomy (CPU)**
- What: extend `scripts/run-company-brain-slice.mjs` scoring with false-merge vs false-split
  rates broken down by surface-form difficulty (ASR-variant/homophone, OCR-variant, abbreviation).
  Extend the estate generator (`scripts/gen-company-estate.mjs`) with a seeded difficulty knob
  emitting hard variants; GT lives only in the manifest; the engine never receives it. The
  current 100/100/100 linking row is the clean-variant ceiling — this stage exists to break it
  with honest sub-100 numbers.
- Verify: `results/crossdoc-identity-merge.json`; anti-circularity CI assertion;
  `check-paper-numbers.mjs` needles; `npm run test:ci`; estate regeneration is atomic-write safe
  (parallel-test race already fixed — keep it).
- Commit: `feat(bench): cross-document identity-merge failure taxonomy`.

**Stage K3 — Knowledge-perception coverage K (CPU)**
- What: extend the estate manifest with a cross-document fact list (facts spanning ≥ 2 documents,
  manifest-authored). Measure K = % of those facts recoverable from perception output + emitted
  samples alone, at the shipped byte budget (387,267 B), zero egress, with byte receipts. Recovery
  scoring lives in the scorer, not the engine. **This stage scores from perception output and
  existing sample fields only — no schema change, no receipt churn** (see Standing Rule 4: the
  schema-extension decision is Stage K5's, and it is gated on K1).
- Verify: `results/knowledge-perception-coverage.json`; anti-circularity assertion; needles;
  `npm run test:ci`.
- Commit: `feat(bench): knowledge-perception coverage K over cross-document manifest facts`.

**Stage K4 — Open-estate measurement (FOUNDER GATE before any real data)**
- What: one estate where truth is NOT by construction — even at small scale — run through the
  K2+K3 metrics, with failure cases published. The uniform-100% table is a fixture-signalling
  liability (research risk 4); this stage is the defense.
- Gate (founder chooses): (a) public-data estate with independently known entity overlap,
  (b) founder-supplied real documents (never leave the machine; certificates apply unchanged), or
  (c) a third-party/ differently-generated synthetic with hand-verified truth.
- Verify: `results/open-estate-*.json`; failure-case list checked in; needles; `npm run test:ci`.
- Commit: `feat(bench): open-estate cross-document perception measurement`.

**Stage K5 — Benchmark packaging + baselines (FOUNDER GATES: cloud baseline, release, schema extension)**
- What: package K1–K4 as a benchmark contribution: released fixtures, two baselines (one cloud
  LLM, one local pipeline), published failure cases. Decisions gated on the founder:
  - **Cloud baseline**: running a cloud LLM over estate documents is real egress — it conflicts
    with the zero-egress positioning. Permitted only on the public-estate variant (K4 option a)
    with founder approval; otherwise the cloud baseline ships as a documented *protocol* others
    run, not something this machine runs.
  - **Schema extension** (cross-document fact fields landing *in* samples — the difference
    between a training artifact and GraphRAG adjacency): costs an `AMNESIAC_ENGINE_VERSION` bump +
    full receipt re-issue + ablation/certificate re-measurement. Only worth it if K1 shows
    grounding matters; if K1 ties or loses, the benchmark claims stop at coverage K, and the
    sample schema stays as shipped.
- Commit: per piece (`feat(bench): ...`, `docs(bench): ...`).

**Stage K6 — Papers**
- What: once K1 lands, convert Paper 4 §7.3 (no downstream-training claim) into the measured
  result — whatever it says. The benchmark paper (cross-document knowledge perception:
  identity-merge taxonomy + coverage K) is drafted only after K5's gates close; artifact/datasets
  framing per research risk 6, never dressed as an algorithmic contribution.
- Verify: `check-paper-numbers.mjs` green; papers recompile 0 errors/0 undefined; word-ban grep
  clean (now also covering "perceive everything", "atomic knowledge").
- Commit: `docs(papers): flat-vs-grounded result + cross-document perception benchmark`.

## 5. Skill Map

- `mattpocock-skills:tdd` — K2/K3 scorer seams and estate-generator extensions.
- `code-review` — before any substantial-diff stage lands (K1 runner, K2 scorer, K5 packaging).
- `dataviz` — before any new figure (K(B) curve, taxonomy breakdown).
- `mattpocock-skills:research` / `grilling` — before any new claim enters a paper; the research
  note above is the current prior-art baseline.
- Issue tracker — any K-stage spec too large for a bullet goes to `gegearsyah/verisieve` issues
  with `ready-for-agent`, linked from the run record.

## 6. Known Traps (additions; the remediation handoff's 12 all remain)

13. **Schema extension = receipt re-issue.** Adding fields to JSONL lines changes the frozen
    corpus SHA-256, the byte-diff ablation baselines, and certificate artifact keys. Bump
    `AMNESIAC_ENGINE_VERSION`, regenerate everything, never mix versions in one table.
14. **"Perceive everything" and "atomic knowledge" are occupied.** Never in papers; see §1.1–1.2.
15. **Snippet-surfaced arXiv IDs failed 4/4 again this session** (DocRED mis-attributed twice,
    OpenIE survey, ACL Anthology ID). Pin via arxiv.org / export API only.
16. **No new all-100 table without a difficulty knob.** Uniform perfection signals fixtures; the
    honest artifact has sub-100 rows by construction (K2/K4 exist to produce them).
17. **GPU serialization**: Stage 4 sweep → ablation backfill → K1. One queue; no parallel VRAM
    claims.
18. **Cross-document facts must land in the samples or it collapses into GraphRAG** — but only
    after K1 justifies the receipt churn. Score-first (K3), extend-schema-later (K5).

## 7. Founder Gates

| Gate | Status |
|---|---|
| K1 head-to-head runs without further approval (judge path already settled) | SETTLED by this handoff |
| K4 open-estate source (public / founder-supplied real / third-party synthetic) | **OPEN — before Stage K4 touches data** |
| Cloud-baseline egress exception (public estate only, if ever) | **OPEN — Stage K5** |
| Sample-schema extension (engine-version bump + receipt re-issue) | **OPEN — decided by the K1 result** |
| Benchmark-paper venue/track (artifact/datasets framing) | **OPEN — Stage K6** |
| Push to `main` | **OPEN — standing gate from the remediation handoff** |

## 8. Definition of Done

- [ ] K1 head-to-head measured and reported verbatim (win/loss/tie); Paper 4 §7.3 converted to
      the measured result or kept honest.
- [ ] K2 identity-merge taxonomy: false-merge/false-split rates by surface-form difficulty,
      sub-100 rows included by design.
- [ ] K3 coverage K with byte receipts, zero egress, anti-circularity CI assertion.
- [ ] K4 open-estate measurement + checked-in failure cases (gate closed first).
- [ ] K5 benchmark packaged: fixtures + two baselines + failure cases (gates closed first).
- [ ] Every number through `check-paper-numbers.mjs`; word-ban grep clean (incl. new bans);
      `npm run test:ci` green; explicit-path commits; run record below filled.

## 9. Run Record

*What actually happened (appended by the executing session — commit shas and DEVIATIONS recorded
as they happened, not smoothed).*

**2026-11-24 (handoff-authoring session):** Research executed first
(`docs/research-notes/2026-11-24-graph-grounded-corpus-novelty-research.md` — repositioned-claim
novelty verdict, prior-art map, rejection-risk defenses, upgrade assessment; 15 citations pinned
this session, 4 snippet-fabricated IDs caught and rejected). This handoff authored from that
verdict with the "perceive everything" phrasing explicitly retired in favor of the two-metric
benchmark framing. No K-stage executed yet. GPU queue state at authoring: Stage 4 sweep running,
ablation backfill queued, K1 behind both.
