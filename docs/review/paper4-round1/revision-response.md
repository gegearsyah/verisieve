# Response to Reviewer Comments — Paper 4, Round 1

## Manuscript Information
- **Title**: A Graph-Grounded Enterprise Corpus (working title; source: `paper/versieve-graph-grounded-enterprise-corpus.tex`)
- **Manuscript ID**: paper4-round1 (pre-submission panel review, academic-paper-reviewer v1.11.1)
- **Original Submission Date**: 2026-11-25
- **Revision Submission Date**: 2026-11-25
- **Review Round**: Round 1 revision
- **Decision**: Major Revision (seats 1, 2, 4 Major; seat 3 Minor; union governs)

---

## Summary of Changes

The revision executes all thirteen required revisions, all eighteen suggested revisions, and answers the thirteen questions for the authors. It lands as three commits on `feat/k7-cag-bm25`:

1. **`ed0b350` — voice and claims.** The false "wins on every stratum" ordering is replaced by its interval-backed strict form (composed is never behind per-block on any stratum, ties per-block on the single-document and cross-document strata, and leads only on the 12-question disambiguation stratum by one question, a margin within noise at n=60), consistently in the abstract, Section 7, Section 10, and the conclusion. The abstract is restructured from ~580 words to ~240 per the EIC plan, with recipe-level erasure wording and the cap stated as a cap. The frame layer is re-voiced per the author directive: meta-frames and defensive liturgy are removed, headings renamed descriptively, each boundary stated once, plainly, at its claim site.
2. **`0ee0e96` — paired tests and coverage.** Exact McNemar tests over the committed per-question rows, Holm-corrected within each claim's declared comparison family, computed by the CI checker (not hand-carried); the sampling-frame sentence (60 fixed authored questions, the entire frame, not a sample); interval-overlap sentences rewritten so overlap decides nothing in either direction; the truncation regime disclosed (selection rule, realized totals, kept-row and kept-entity counts) with the ordering scoped to that regime; canary batch defined with rank-1 counts; per-class certified bounds surfaced.
3. **`1c0984b` — privacy boundaries.** Article 17 recharacterized as the regulatory question the artifact supports but does not settle; the erasure receipt scoped corpus-side from the code (vault holds no raw values; entries and salt retained); the readable view stated to skip the certificate ceremony; the Layer R over-merge mechanism corrected and quantified; stage labels replaced with descriptive names; bib housekeeping.

**Checker discipline**: every revision that introduced or moved a number went through the CI chain in the same commit (artifact + paper + checker). The check count grew from 993 to **1044 checks, 0 failures**. No check was deleted or weakened; broken needles were re-pointed to the new prose with their artifact-derived value expressions unchanged.

**Deviations from the response template, declared**: changes are marked by commit and section anchor rather than by page number or tracked-change highlighting, because the manuscript is revised from source under version control; the commit hashes above are the change tracking. Judge scores for the second-run arms remain absent by design (S8, G7).

---

## Response to Required Revisions

| # | Required Revision | Status | Response Summary | Location | House flag |
|---|---|---|---|---|---|
| R1 | Conclusion claim rewrite to interval-backed form | Completed | Strict form everywhere: never behind per-block on any stratum, ties on Q1/Q2, leads only on the 12-question disambiguation stratum by one question, within noise at n=60; one consistent wording in abstract, §7, §10, conclusion | Abstract; §7 The reading; §10 item 3; Conclusion | Prose-only, numbers already committed (`ed0b350`) |
| R2 | Strict weak ordering in §7, §10, abstract | Completed | Same rewrite as R1; the "best trained format" phrasing carries its caveat; stratum ties stated explicitly | Abstract; §7; §10 | Prose-only (`ed0b350`) |
| R3 | Paired tests with multiplicity note | Completed | Exact McNemar over committed per-question rows; Holm within four declared claim families (hybrid vs the other three non-training arms; trained formats vs one another and base; retrieval/fixed-cache arms vs one another; the twenty retrieval-or-cache-versus-trained comparisons); raw and adjusted p reported; all p recomputed by the CI checker | §7 Uncertainty at n=60 | CI needle added: `track-k-composition-head-to-head.json` + `track-k7-cag-vs-rag-vs-bm25.json`, paper §7, checker — one commit (`0ee0e96`) |
| R4 | Interval sampling-frame sentence | Completed | The 60 questions stated as a fixed authored set, the entire frame, written into the manifest before any arm ran; intervals quantify per-question variability, not sampling error | §7 Uncertainty paragraph | Prose-only (`0ee0e96`) |
| R5 | Cache arm framed as eval-informed bound | Completed | The set-cover's optimization against the question population stated; the arm called an evaluation-informed upper bound for fixed-cache CAG | §7 Non-training controls, CAG paragraph | Prose-only (`ed0b350`) |
| R6 | Truncation coverage and selection rule disclosure | Completed | Deterministic head truncation in corpus file order (hash-id, ground-truth-blind); realized per-arm totals; kept-row counts per arm (composed 41 of 1,106, 3.7%); kept-entity counts 908 vs 1,029; composed-over-per-block ordering explicitly scoped to this truncation regime; caption carries the kept-row table | §7 The design; Table 3 caption | CI needle added: `budget.perArm` from the head-to-head artifact, paper, checker — one commit (`0ee0e96`) |
| R7 | Erasure-path wording at recipe level | Completed | Abstract, §1, and conclusion state the sealed LoRA recipe is specified to complete the path with the three GPU measurements pending and no placeholder values shown anywhere | Abstract; §1 item 3; Conclusion; §9 adapter bullet | Prose-only (`ed0b350`) |
| R8 | Layer R explanation mechanism rewrite | Completed | "Collapses nothing by design" corrected: closure merges every verbatim-repeating surface, distinct speakers sharing a label string collapse into one group (7,449 mentions into 21 string groups, 2,037,812 false merges, none on collision pairs) | §8 The floor on real data | CI needle added: `layers.layerR` from `open-estate-baseline.json`, paper §8, checker — one commit (`1c0984b`) |
| R9 | Vault disposition under eraseEntity | Completed | Stated from the code: erasure is corpus-side; the vault holds no raw values (salted HMAC identifiers); vault entries and workspace salt retained so non-erased entities keep stable identifiers; source-input disposition named as deployment policy outside the receipt | §9 corpus-half bullet | Prose-only, code-grounded (`1c0984b`) |
| R10 | Readable-view certificate and opt-in boundary | Completed | Stated from the code: the readable view runs no certificate ceremony; the readable export carries the corpus and SHA-256 receipts and no per-sample certificates; the conformal bound is a property of the vaulted default only | §4 view-dimensions paragraph | Prose-only, code-grounded (`1c0984b`) |
| R11 | Article 17 recharacterization | Completed | Reframed as a regulatory question the artifact does not settle; what it supplies is the evidence a settlement would need, in two halves | §9 opening | Prose-only (`1c0984b`) |
| R12 | Abstract restructure | Completed | ~240 words: deficiency (2 sentences), artifact (2), three headline results with scoping adjacent to each number, erasure with recipe-level scoping, boundaries; certificate and near-duplicate numbers moved to §5/§6; four-decimal figures no longer in the abstract | Abstract | Prose-only (`ed0b350`) |
| R13 | Frame-layer re-voicing per author directive | Completed | "Measured, not promised", "the scope note is binding", "recorded as it ran", "The measurement exists now", the honest-reading recitals, and the meta-frames removed; §6/§7 headings renamed descriptively; each boundary stated once, plainly, at its claim site; the measured-first discipline is unchanged | Paper-wide | Prose-only (`ed0b350`) |

---

## Response to Suggested Revisions

| # | Suggested Revision | Status | Response Summary |
|---|---|---|---|
| S1 | Stratum size on the abstract's 83.3% | Adopted | "the 24-question cross-document stratum" in abstract and conclusion (`ed0b350`) |
| S2 | Descriptive names for stage labels; name the spec; define receipt and sealed | Adopted | K7/Stage K5 labels replaced throughout; the estate spec named as the committed doc; "receipt" defined once in §5; "sealed" defined once in §7 (`0ee0e96`, `1c0984b`) |
| S3 | Ten-row taxonomy in heading and opening | Adopted | Heading now "The Head-to-Head, Measured"; opening states ten arms (`ed0b350`) |
| S4 | Table 2 column rename | Adopted | "Token span bytes" (`1c0984b`) |
| S5 | CAG regime clause | Adopted | "slightly below the 21k-to-85k corpus-size regime the CAG literature evaluates" (`ed0b350`) |
| S6 | Hybrid vs retrieval-fallback distinction | Adopted | The arm is distinguished from the cited preload-plus-retrieval hybrid in the sentence that cites the direction (`ed0b350`) |
| S7 | Two-decimal certificate figures in abstract register | Adopted (subsumed by R12) | The four-decimal figures left the abstract entirely; §5 retains them with the small-sample caveat adjacent |
| S8 | Judge-column comparability in Table 3 caption | Adopted | Caption states the notch cells are intentional, judge columns not comparable across the split, no cross-arm judge analysis; (K7) suffixes dropped (`0ee0e96`) |
| S9 | Qualify the 4.88% generalization | Adopted | "a designed-collision stress reading, not a representative rate for real estates" (`ed0b350`) |
| S10 | Vaulted ablation as construction-consistency check | Adopted | Reframed; a utility battery indifferent to identity named as the measurement a real cost claim would need, and not run here (`ed0b350`) |
| S11 | Canary definitions, rank-1 counts, perplexity probe | Adopted | Batch defined (12 canaries, email/phone/name, 1/5/20 repetitions, Carlini-style rank-based exposure); rank-1 counts 8/12 all trained arms vs 3/12 base, all names; probe described (10 generic paragraphs, 380 tokens, zero placeholder emissions); "degrades slightly" replaced with the movement (`0ee0e96`) |
| S12 | "Capped at" | Adopted | Design paragraph and abstract state the cap (`ed0b350`, `0ee0e96`) |
| S13 | Enumerate the nine trapped surfaces and the window | Adopted | All nine surfaces enumerated from the committed egress receipt (connect, createConnection, fetch, get, lookup, request, resolve, resolve4, resolve6) with the trap window as recorded (`1c0984b`) |
| S14 | Name the three implicit roles | Adopted | Readable-flip operator (§4), certificate-reliant operators and exposed subjects (§10 item 1) (`1c0984b`) |
| S15 | Per-class certified recall lower bounds | Adopted | PERSON 98.06% over 153 down to GITHUB_PAT 5% over 1, with the class-rarity note (`0ee0e96`) |
| S16 | Citation housekeeping | Adopted | tan_lora_memorization cited at the canary paragraph; full author lists verified from arXiv and completed for bourtoule2020machine, hu_lora, shi2023incontext, fevry2020entities, wang2019kepler; zheng2023judging and wang2023fair retain "and others" (already-long lists, camera-ready item) (`1c0984b`) |
| S17 | Certificate boundary at the edges | Adopted | Conclusion: "bounded for residual detectable PII at a stated confidence"; §1 notes the certified figure is an estate-level bound (`ed0b350`, `1c0984b`) |
| S18 | Copyedit set | Adopted | Quarantine behavior clarified (the sample ships marked and fails its certificate); Table 2 caption states 23 of 24 passing; "at stated 95%" fixed; K7-judges clause covered by S8; no venue-retargeting note exists in the manuscript to remove (`1c0984b`) |

---

## Response to Gated Measurements

None of the following appears in the revised manuscript as prose; the measured-first rule (no number enters the paper except through the CI check chain, artifact + paper + checker in one commit) is restated and enforced for all of them.

| # | Gated Measurement | Status | Note |
|---|---|---|---|
| G1 | Pending-GPU adapter trio (retrain vs scratch, SISA head-to-head, pre/post canary exposure) | will_address | Structured in the artifact as `pending-gpu`; no placeholder values shown; measured when GPU access exists |
| G2 | Trained-arm comparison at a substantially larger budget (e.g. 10x tokens) | will_address | Parked as a gated measurement; the capacity-starved scope of the current claim is stated in §7 and §10 |
| G3 | Coverage-matched trained-arm comparison | will_address | R6 is disclosure-only in this revision; G3 stays gated and would test the ordering independent of the truncation regime |
| G4 | Deterministic roster-lookup baseline | will_address | Parked; the question regime is described exactly (single-person keyed lookups over four attribute families) |
| G5 | DA alternative arms, including person-filtered BM25 | will_address | Parked; see the answer to Question 13 for how §7 frames the strongest arm in the meantime |
| G6 | Vaulted-view utility battery | will_address | Parked; S10 states in prose that no such battery is run |
| G7 | Judge backfill for the second-run arms | will_address | Parked; S8's caption states the interim position |

---

## Answers to the Questions for the Authors

1. **Head prefix and policy timing.** The kept rows are the head of the composed corpus in canonical corpus file order (hash-id order, blind to ground truth): the first 41 of 1,106 rows. The truncation policy, the arm corpora, and the composed-arm results were committed together in one commit (`bc4afb3`), so the policy is honestly described as deterministic and ground-truth-blind by construction, not as pre-registered before the results. R6 is therefore disclosure-only in this revision, and G3 stays gated as the sensitivity test. The paper now says both.
2. **Paired tests.** Yes, accepted and added (R3). The interval language ("statistically indistinguishable") is gone; the decisive test is exact McNemar with declared Holm families, recomputed by the CI checker from the committed rows.
3. **Question authorship.** The 60 questions and their four attribute families were authored with the noisy-estate benchmark spec and committed before the K7 arms were designed or run. The committed spec is now named in §7, and the questions are described as a fixed authored set (R4).
4. **Vault disposition.** Retained, not deleted: the vault stores no raw values at all (identifiers are salted HMAC derivations; raw values live only in the source inputs, which erasure does not touch), and vault entries plus the workspace salt persist so non-erased entities keep stable identifiers. The limitation now lives in the claim boundary itself: the §9 corpus-half bullet states the receipt's scope as corpus-side and names source-input and vault-entry disposition as deployment policy outside it (R9).
5. **Readable view and the gate.** The conformal gate does not run in the readable view: the readable export carries the corpus and its SHA-256 receipts and no per-sample certificates, because there is no masking to certify. Stated in §4 at the claim site (R10).
6. **GPU measurements.** Not measured at this submission. R7's recipe-level wording is the intended form, and it is now consistent across the abstract, §1, the conclusion, and §9: specified to complete the path, three measurements pending, no placeholder values shown anywhere.
7. **Per-class bounds.** Yes, surfaced in §5 with checker needles (S15).
8. **CAG regime.** Rewording intended; there is no CAG source whose regime includes 16k. The paper now says "slightly below the 21k-to-85k corpus-size regime the CAG literature evaluates" (S5).
9. **Layer R.** The over-merging mechanism is now stated: closure merges every verbatim-repeating surface, distinct speakers sharing a label string collapse into one group, quantified from the artifact (R8).
10. **Stratum size and hybrid distinction.** Yes to both: 83.3% carries "the 24-question cross-document stratum" in the abstract and conclusion, and the hybrid routing sentence distinguishes identity-keyed per-question selection from the cited preload-plus-retrieval-fallback hybrid (S1, S6).
11. **K7 judge scores.** The caption states the position: intentional notches, no cross-arm judge reading, exact match only for those arms (S8). G7 stays gated.
12. **Stage IDs.** K3, K7, and Stage K5 are internal benchmark-stage identifiers from the research log. They are removed from the manuscript's prose and captions in favor of descriptive names ("the three arms added by the second run", "the resolution-scoring line"); the stage IDs remain in the artifacts and commits (S2).
13. **The person-filtered BM25 beam.** The router paragraph's framing answers it directly: the strongest arm scores routing given a correctly resolved identity, not resolution itself, and in deployment that resolution is the identity graph's own task. If a person-filtered BM25 reached the same number, what would remain of the graph's contribution to that arm is exactly what G5 is gated to measure; the revised prose claims the arm as routing-given-resolution and does not claim the graph as the router's unique enabler until that control runs. The panel's non-requirement of the arm is respected, and the McNemar family for the hybrid arm is stated so its BM25 margin (raw 0.0146) is read at its true strength.

---

## Change Log

| Commit | Files | Change |
|---|---|---|
| `ed0b350` | tex + checker | Abstract restructure, claim calibration paper-wide, re-voicing (R1, R2, R5, R7, R12, R13; S1, S3, S5, S6, S9, S10, S12) |
| `0ee0e96` | tex + checker | McNemar/Holm machinery, sampling frame, coverage disclosure, canary and certificate-class needles (R3, R4, R6; S8, S11, S15, S2 partial) |
| `1c0984b` | tex + bib + checker | Privacy boundaries, Layer R mechanism, stage labels, bib housekeeping (R8, R9, R10, R11; S2, S4, S13, S14, S16, S17, S18) |

**Checker**: 993 → 1044 checks, 0 failures across all three commits.
**Abstract word count**: ~580 → ~240.

## Closing Statement

The panel found the receipt infrastructure sound and the frame layer asserting more than the tables license; this revision takes that finding as its whole agenda. Every decision-bearing defect was repaired from committed numbers, the three sentences a reader carries away now say exactly what the tables support, and the author's own register directive (value stated directly, boundaries once, plainly, where the claim is made) is enforced paper-wide and needle-deep: 1044 checks, 0 failures. The gated measurements remain gated, and the manuscript undergoes another round of review when the panel is ready.
