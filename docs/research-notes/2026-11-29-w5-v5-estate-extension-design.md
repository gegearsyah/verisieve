# W5 v5 estate extension design (pre-spend audit input)

Date: 2026-11-29
Lane: weft-corpus-v5
Status: design written, code pending, zero spend. The Opus pre-spend audit gates everything below.

## 0. Mission

Close the three estate gaps the framing audit recorded on #59 (source-kind axis, people-free knowledge units, non-knowledge negative class), implement the knowledge-density filter with a recorded rule and a measured effect, land the company-private knowledge units with a regenerate-minus-unit byte-diff erasure receipt, and add one held-out org profile so gate 2 (held-out shape) is measurable at all. One coherent build, one audited driver, then recompile, retrain, evaluate, close.

## 1. What gets built

### 1.1 Extension driver: scripts/generate-weft-estate-extension-v5.mjs

Same shape as the strata driver: main-guarded, `--profile` plus `--limit` required so spend stays explicit, api-only licence gate, fail-closed parse, reject dumps to os.tmpdir(), per-class receipt counters, deterministic seeds derived from SEED 20261130. It reads the existing coverage corpus for theme lists and knowledge-side anchors (no re-spend). Outputs `results/weft-estate-extension-v5-<profile>/extension-pairs.jsonl` plus `receipt.json`, and a per-profile private-unit overlay corpus `results/weft-private-unit-corpus-v5-<profile>.tmp.json` ({ docs, links, knowledgeUnits } shape) that the erasure proof consumes.

Pairs are emitted in the compiler pair format (id, policy, pairType, label, textA, textB, provenance) so Phase 2 merging is concatenation plus dedupe plus a deterministic eval slice, with no schema conversion.

Classes, per profile (limit applies to each pair class):

1. **People-free compliance knowledge units** (`source-disjoint-compliance-positive`, `compliance-near-requirement-negative`). One teacher call per pair. The positive prompt asks for the SAME control requirement excerpted from two DIFFERENT invented compliance frameworks (an APP-rules-like corpus, a NIST AI RMF-like framework profile, an ISO 42001-like management standard): same knowledge, different source, zero people. The negative prompt asks for two ADJACENT but genuinely DIFFERENT requirements sharing as much jargon as possible. Mechanical validation on both: the identities array must be empty (people-free is verified, never teacher-claimed), every doc must pass the knowledge-density filter, and the near-requirement difference stays teacher-claimed exactly like the strata negatives (same caveat wording in the receipt).
2. **Non-knowledge negative class** (`non-knowledge-negative`, `non-knowledge-vs-knowledge-negative`). The chatter prompt asks for two short non-knowledge documents (greetings, scheduling, logistics small talk, no factual substance). Mechanical validation: every doc must FAIL the knowledge-density filter, so the class stays pure by construction (a chatter doc that passes the filter is dropped and counted, never emitted). The second sub-class pairs one chatter doc against a same-theme coverage document: the greeting must not link to real knowledge on the same topic, which is the sharpest form of the knowledge-threshold gate. Caveat recorded: length is a visible cue for this class (chatter is short), so the eval note reports per-class F1 and the receipt records the word-count distribution; the eval also carries chatter docs in the 60 to 90 word range where the prompt can reach it.
3. **Company-private knowledge units** (`private-unit-positive`, `private-unit-cross-negative`). Two units per profile, one teacher call each. The prompt asks for ONE confidential knowledge unit (a recipe-like proprietary process: a routing formula, a sterilization protocol variant, a permit fast-track rule) carried across sources: the master document stating it, two meeting transcripts referencing it, and one derivative note applying it. Every doc carries knowledgeUnitId, confidential true, a sourceKind, and people as attributes (identities allowed; the event is the unit, people are attributes of it). Pairs: within-unit doc pairs are positives (the docs share the unit's content, so this class is not paraphrase-hard and never gets benchmarked as theme linking skill); cross-unit pairs are negatives (same genre, different knowledge). Event anchors: eventA and eventB are the knowledgeUnitId, the event being the identity of the knowledge unit.

### 1.2 Source-kind axis

`deriveSourceKind(doc)`, exported and deterministic: transcript to meeting, ticket to ticket, email to thread, memo to memo, everything else to document. Coverage docs get the axis by derivation at compile time (no re-spend on corpora that already exist); extension docs carry a teacher-emitted sourceKind validated against the closed set {meeting, thread, ticket, memo, compliance-doc, document}, falling back to derivation when the teacher omits it. The receipt records the per-class source-kind distribution so the axis is auditable.

### 1.3 Knowledge-density filter (the rule, recorded per the ruling)

Rule: a document is a knowledge unit iff it has at least 12 distinct content words (tokens of length 4 or more, lowercased) AND at least one digit anywhere in the text. This is a lexical-density heuristic, honestly labeled: it is not a semantics test. Measured effect (recorded in the receipt and the stage note): the pass rate over all coverage docs per profile, over the compliance docs (expect all pass), over the private-unit docs (expect all pass), and over the non-knowledge docs (expect none pass; any pass is a drop, counted). The 12-word floor sits under the coverage corpus's p50 (65 to 66 words), so the filter should keep almost all coverage docs; the receipt states the exact rate rather than the expectation.

### 1.4 Erasure proof: scripts/prove-weft-private-unit-erasure.mjs

Offline, deterministic, no teacher. Input: the private-unit overlay corpus plus a knowledgeUnitId. It regenerates the corpus artifact minus that unit's footprint (docs with the unit id, links touching them, the unit record), writes `results/weft-private-unit-corpus-v5-<profile>-minus-<unitId>.tmp.json`, and emits a byte-diff receipt: sha256 and byte size before and after, the removed doc ids, the removed link count, the first differing byte offset, and the assertion that every byte outside the unit's footprint is unchanged (stable JSON assembly makes the regenerated file identical to the original except for the removed records). Fail-closed: an unknown unit id, a doc claiming the unit but absent from the overlay, or a link referencing a removed doc after regeneration is a typed error. One fixture test pins the receipt shape and the unchanged-bytes assertion. Scope, stated honestly: this proves erasability of the unit inside the Weft corpus artifact the lane owns; the full amnesiac corpus-regeneration mechanism (src/) is the engine that will consume the same unit footprint later, and no claim is made here about its pipeline.

### 1.5 Held-out org profile (gate 2 becomes measurable)

Gate 2 reads "raw F1 at or above 0.75 on an unseen org profile". All three v5 profiles are training profiles, so without a fourth profile the gate is unmeasurable. The corpus driver gains `--profile` and `--pairs-target` flags (small, additive, byte-stable defaults), and a fourth profile is added to the driver as a held-out shape: `university-campus` (registrar, facilities, IT, research-office, procurement, student-services; a genuinely different company shape with its own vendor pool and name cultures). Run at pairs-target 9,600 (about 1,200 docs, roughly 360K tokens, one profile), compiled to eval-only pairs, plus one small strata pass at `--limit 100` (200 calls, about 150K tokens) so the BM25 gate is also measurable on the unseen shape. The held-out profile never enters training.

Skipped, named: leave-one-profile-out retraining (a second, free way to estimate transfer) triples training cost for one extra number; the held-out profile measures the gate directly. Extension classes are not generated for the held-out profile; the gates do not ask for them on unseen shape.

## 2. Pair and eval integration (Phase 2 preview)

The compiler runs per profile over the coverage corpora with the v5 flags (exclude-within-chunk, include-masked-structural, dilute-masked-markers, disjoint negatives), then a small merge step concatenates compiler train/eval with the strata and extension pairs of the same profile, dedupes by pair id, and deterministically slices 25 percent of each specialty class (strata positives, strata negatives, every extension class) into eval, the rest into train. Coverage pairs keep the compiler's own 2000-pair eval. Identity-overlap balance is recorded per class in the merge receipt (fact 4: shared identities must correlate with the label no better than chance; the specialty classes are identity-disjoint by construction, and the receipt states it).

## 3. Spend plan (all behind the audit)

| Stage | Calls | Tokens (estimate) | Notes |
|---|---|---|---|
| Smoke, 1 profile, small limit | about 12 | about 10K | prompts changed, so a paid smoke comes before any scaled pass |
| Extension scaled, 3 profiles | about 546 | about 400K | 180 calls per profile at limit 60 per class, 740 tokens per call observed on the strata passes |
| Held-out corpus | about 340 | about 360K | 1,200 docs at the observed 301 tokens per doc |
| Held-out strata | 200 | about 150K | --limit 100 |
| Total | about 1,100 | about 0.9M | roughly $7 to $9 at the observed mistral-medium rates |

Every stage is separately invokable; a failure at any stage stops only that stage. Worst case per call remains 4 teach attempts x 6 completion attempts = 24 calls, same bound as the strata driver.

## 4. What the retrain will consume (Phase 3 preview)

Three profiles of compiled pairs plus strata plus extension classes, one specialist, frozen MiniLM-L6-v2 base plus heads, seed recorded in the training ledger. The abstention, calibration, and OOD tripwire layers are the already-merged export path (conformal Learn-Then-Test plus the kNN bank), re-calibrated on the v5 eval. Training device: the local box has an RTX 4070 Laptop (8 GB) with a CPU-only torch today; CUDA torch installs when the network window opens, else the Kaggle pattern runs the same trainer. No decision needed from the founder.

## 5. Gates this design serves

Gate 2 (held-out shape) gets its measurement instrument (the university-campus profile). Gate 5 (BM25 must not saturate) keeps the three strata sets plus the held-out strata pass. Gate 6 (non-knowledge must not link) becomes measurable through the two non-knowledge pair classes and the density-filter receipt. The source-kind axis makes source-disjoint same-theme measurable beyond the strata. The erasure receipt gives the company-private ruling its proof artifact.

## 6. Honest-framing ledger for this design

- People-free is mechanically verified (empty identities), not teacher-claimed.
- Compliance-theme sameness and near-requirement difference are teacher-claimed, same caveat class as the strata negatives.
- The knowledge-density filter is a lexical heuristic, not semantics; its measured effect is recorded, whatever it turns out to be.
- The erasure receipt proves the artifact-level property inside the Weft corpus; it makes no claim about the full amnesiac pipeline.
- The non-knowledge class carries a visible length cue; per-class eval and word-count receipts keep it measurable rather than hidden.
