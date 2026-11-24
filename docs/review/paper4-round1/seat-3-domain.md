# Seat 3 Report — Peer Reviewer 2 (Domain)

Reviewer configuration card: Card #3, academic-paper-reviewer v1.11.1 panel, Round 1, 2026-11-25. Model family: sonnet (session routing, same family as all five seats). Fresh context, peer-blind: this seat has not seen any other seat's report.

---

## Manuscript Information
- **Title**: How Training Data Should Look: From Stitched Chunks to Records That Know What They Describe
- **Manuscript ID**: verisieve-graph-grounded-enterprise-corpus (K7 branch)
- **Review Date**: 2026-11-25
- **Review Round**: Round 1

## Reviewer Information

### Reviewer Role
Peer Reviewer 2 (Domain)

### Reviewer Identity
NLP and information retrieval researcher specializing in retrieval-augmented and cache-augmented generation and in training-data curation for fine-tuning; familiar with the chunking, in-context pretraining, entity-centric pretraining, and machine unlearning literatures this manuscript positions itself against.

## Overall Assessment

### Recommendation
- [ ] Accept
- [x] **Minor Revision**
- [ ] Reject

### Confidence Score
4

### Summary Assessment
The manuscript builds a graph-grounded, erasable enterprise training corpus and measures a six-arm head-to-head plus three non-training controls on a noisy synthetic estate, reporting that retrieval over the entity graph (53.3%) beats every trained format (best 11.7%) and that identity-keyed routing (81.7%) is the strongest arm, with small, honestly bounded margins among trained formats. From my domain seat this is a solid, verifiably calibrated positioning: I recomputed every cell of Table 3 from the raw per-question rows in the supplied artifacts and matched all ten arms; the Table 2 erasure byte arithmetic reconciles exactly (24+27=51, 71+146=217, 999+1407=2406); the failure-mode and hub-duplication numbers match their artifact bit for bit, including the honest null amplification at the two lowest merge rates; and the CAG, GraphGen, in-context pretraining, Multi-News, and EmbGen descriptions hold against the sources, with the novelty sentence properly scoped by structural qualifiers. The weaknesses I found are all scoping and clarity defects, none fatal: the 16,607-token prefill is described as inside a cited regime whose stated floor is 21k tokens; the hybrid routing arm's attribution to the CAG hybrid invites conflation with a retrieval-fallback design; the Layer R explanation contradicts its own measured over-merge numbers; and Table 2's column naming lags the body's span definition. Minor Revision, no re-review of measurements needed.

## Strengths

### S1: The erasure-receipt numerics reconcile exactly with the supplied artifact
I verified all three deletion fractions against results/amnesiac-corpus-ablation.json. For 1%: token spans 24 plus one entity-list delta of 27 equals the measured delta of 51 bytes; for 5%: 71 plus (29+58+30+29) equals 217; for 20%: 999 plus a 1,407 entity-list delta equals 2,406. Per-entity sub-receipts are present, before and after SHA-256 pins are recorded, the unchanged-sample counts (23, 21, 3) are consistent with the changed-sample counts, and the artifact's byteDiff carries exact: true and diffVerified: true in all three runs. The caption's explanation of what the delta includes is accurate.
**Evidence Anchor**: `dataset: results/amnesiac-corpus-ablation.json — fractions 0.01/0.05/0.20 byteDiff (removedSpanBytes 24/71/999, measuredDeltaBytes -51/-217/-2406, exact true) vs Table 2`

### S2: The CAG comparison is grounded in the cited paper's actual scoping, and the non-comparability statement is honest
The §2 claims that the CAG evaluation uses corpora of 21k to 85k tokens, scores with BERTScore, scopes to limited and manageable size, and proposes a hybrid preloading a foundation context, all verify against the cited paper: the corpus sizes and BERTScore appear in its results tables, and both quoted phrases are verbatim from it. The manuscript's follow-through ("we do not replicate the CAG corpora, models, or baselines, so our numbers are not comparable to theirs") is stated plainly rather than waved at, which is the correct posture given different metric (exact match vs BERTScore) and different corpora.
**Evidence Anchor**: `text: §2 "Cache-augmented generation" "Its evaluation uses corpora of 21k to 85k tokens, scores answers with BERTScore"`

### S3: Every headline percentage traces to a row-level artifact; I reproduced all ten rows of Table 3
I recomputed exact-match counts from the per-question rows in results/track-k-composition-head-to-head.json and results/track-k7-cag-vs-rag-vs-bm25.json: flat 4/60 (6.7, strata 1/2/1), per-block 6/60 (10.0), composed 7/60 (11.7 with 2/24, 3/24, 2/12), composed+pairs 1/60 (1.7), vaulted 1/60 (1.7), Graph-PPR 32/60 (53.3 with 10/24, 20/24, 2/12), base 1/60 (1.7), BM25 36/60 (60.0 with 14/24, 21/24, 1/12), fixed cache 31/60 (51.7), hybrid routing 49/60 (81.7 with 21/24, 19/24, 9/12). Every published cell, the stratum percentages, the judge means, and the 6.7 to 41.7% judge-agreement range match. The CI chain reports 993 paper-number checks, 0 failures (I reran it).
**Evidence Anchor**: `table: Table 3 — all ten arm rows recomputed from row-level exact_match flags`

### S4: The novelty sentence is properly scoped and its structural qualifiers are artifact-backed
The claim is framed as "To our knowledge no prior artifact composes..." and is qualified by five checkable structural conditions (actual source bytes, heterogeneous documents, deterministic, selected by traversing a resolved entity graph, per-sample provenance). I checked the distinctions against the sources: GraphGen generates new synthetic QA from a graph rather than grounding actual samples; in-context pretraining groups by retrieval similarity with no resolved identity, provenance, or erasure; Multi-News clusters real documents for human-written targets; EmbGen (verified against its abstract) decomposes into entity-description pairs, reassembles by embedding similarity, and produces synthetic QA, with no resolved graph or receipts; SISA claims are accurate and explicitly disclaim an approximate-unlearning-replacement claim. Each stated difference holds.
**Evidence Anchor**: `text: §2 "Entity-centric objectives versus composed units" "To our knowledge no prior artifact composes the actual source bytes"`

### S5: The external-validity layer design separates real and overlay identity cleanly, and its disclosures verify
Layer R / layer O separation is enforced per-layer in the artifact (gate on layer O only, layer R explicitly ungated and described there as a calibration number, never an engine-adjacent win), matching the manuscript. I verified the numbers: layer O 61.46% recall, 76.10% precision, 2,303 false merges all on the 12 designed collision pairs; layer R recall 1.0 at precision 0.227885 (22.79%); Enron 26.60% recall, 82.06% precision, 273 false merges of which 260 on collision pairs. The Enron disclosure (external slice, no stated license, aggregates plus an archive SHA-256, zero bytes in repository) matches the artifact's own note verbatim in substance. The blanket "the underlying corpus is CC BY 4.0" claim for AMI and ICSI also checks against the ICSI corpus site's CC BY 4.0 release statement and AMI's standard license.
**Evidence Anchor**: `dataset: results/open-estate-baseline.json — layers.layerR.pairwise (recall 1, precision 0.227885), layers.layerO falseMerges 2303/onCollisionPairs 2303, enron.scores.pairwise`

### S6: The failure-mode costs are measured, honest about their nulls, and trace to the artifact
The ladder numbers match results/composed-corpus-failure-modes.json exactly: 0.3214 vs 0.0224 corruption at the 25% rate (factor 14.32), 0.5512 vs 0.0431 at 50%, composed at 0.1329 and 0.1786 where per-block is zero, amplification reported as null rather than smoothed at the two lowest rates, false-identity occurrences 148 through 614, and the hub-duplication block (20,627 near-duplicate pairs, 12,569 exact, fraction 1.0, six hub-cap samples near-duplicate-free) matches, including the artifact's finding that the cap policy is not the cause. Reporting null amplification factors instead of an undefined ratio is the right call.
**Evidence Anchor**: `dataset: results/composed-corpus-failure-modes.json — falseMergeAmplification rates 0.05/0.1/0.25/0.5 and hubDuplication overall (20627, 12569, fraction 1)`

## Weaknesses

### W1: The CAG regime claim contradicts the paper's own statement of that regime
**Problem**: §7 states the fixed-cache arm prefills 16,607 tokens "inside the corpus-size regime the CAG literature evaluates", while §2 states that same literature's corpora span "21k to 85k tokens". A 16,607-token prefill is about 21% below the cited regime's lower bound. The mechanism-level comparisons (greedy set-cover over 52 question persons, one-time prefill, 15 mean appended tokens) all verify against the artifact, so the defect is confined to this one scoping clause, but the clause overstates fitness to the regime on the paper's own criteria.
**Evidence Anchor**: `text: §7 "Non-training controls" "inside the corpus-size regime the CAG literature evaluates"`
**Why it matters**: A reader checking the citation for regime fit will find the prefill is below the cited range; a scoping claim that its own citation contradicts is exactly the kind of looseness the paper otherwise refuses elsewhere.
**Suggestion**: Reword to say the prefill is comparable to, though below, the smallest corpus the CAG literature evaluates, or report the gap explicitly (16.6k vs the cited 21k floor). No new measurement needed.
**Severity**: Minor
**Confidence**: 4

### W2: The hybrid routing arm's citation invites conflation with a materially different hybrid design
**Problem**: §7 bills the strongest arm with "the hybrid direction the CAG literature itself proposes" (citing chan2024cag). The cited hybrid design is a cache that falls back to retrieval on failure; the measured arm does no retrieval at all: it selects records whose own target carries the question person's canonical identity key (verified in the artifact's cagHybridSelectionRule, subject records keyed on name, email, or phone digits) and prefills the asked person's records. The arm's true mechanism and its scoping ("routing consumes a correctly resolved identity rather than doing retrieval") are stated later in the same paragraph and again in the abstract, so this is not misreporting, but the citation-adjacent framing lets a reader map the 81.7% arm onto the CAG hybrid when its information flow (oracle identity routing, not retrieval) is the load-bearing difference.
**Evidence Anchor**: `text: §7 "Non-training controls" "the hybrid direction the CAG literature itself proposes"`
**Why it matters**: The 81.7% figure is the paper's headline result; readers who trace it to the CAG hybrid will misattribute what caused the gain (per-question identity routing with correct resolution) and what was not measured (resolution itself).
**Suggestion**: Add one clause distinguishing the two: the cited hybrid uses retrieval as fallback, whereas this arm's per-question selection is identity-keyed and performs no retrieval. No new numbers.
**Severity**: Minor
**Confidence**: 4

### W3: The Layer R explanation contradicts its own measured numbers
**Problem**: §8 describes the Layer R floor (100% recall at 22.79% precision) with "because exact-match transitive closure over identically normalized surfaces collapses nothing by design there (corpus role labels repeat verbatim across meetings)". The artifact records the opposite of "collapses nothing": 2,037,812 false merges, a 77.2% false-merge rate, and 7,449 mentions resolved into only 21 string groups. What actually happens is massive collapsing of distinct real people who share verbatim role labels across meetings, producing near-total recall with very low precision. The paper's number is correct (22.79% matches the artifact to two decimals), but the explanation as written is inconsistent with it.
**Evidence Anchor**: `text: §8 "The floor on real data" "collapses nothing by design there (corpus role labels repeat verbatim across meetings)"`
**Why it matters**: This is the paper's disclosure layer, and its job is to make an unintuitive number (100% recall at 22.79% precision is not an engine achievement) legible. The current sentence does the reverse: it gives an explanation implying trivial non-resolution while the mechanism is aggressive over-merging.
**Suggestion**: Rewrite to name the actual mechanism: closure merges every verbatim-repeating role-label surface, so distinct speakers in different meetings collapse into one group, which yields full recall at 22.79% precision. Align the artifact's own note in the same pass.
**Severity**: Minor
**Confidence**: 4

### W4: Table 2's "Span bytes removed" column conflicts with the body's definition of spans
**Problem**: §5 defines the verified byte-diff as the erased entities' spans, "token bytes in content plus the entity-ID entries in the per-sample lists", yet the Table 2 column labeled "Span bytes removed" contains only the token content spans (24, 71, 999); the entity-ID entries appear only inside the other column's total. Applying the body's own definition to the column header, a reader expects 51, 217, 2,406 there. The caption does state that the measured delta includes both components, and the arithmetic reconciles (I verified all three), so the defect is terminology drift between body and table, not a numeric error.
**Evidence Anchor**: `text: §5 "Erasure" "token bytes in content plus the entity-ID entries in the per-sample lists"`
**Why it matters**: The commensurability of the two columns is provided only by the caption; the header actively invites the wrong reading, and this is the paper's core erasure-receipt table.
**Suggestion**: Rename the column to "Token span bytes" (or "Content span bytes") so the body's span definition and the table column are the same object. No new measurement.
**Severity**: Minor
**Confidence**: 5

### W5: The heading "The Six-Arm Head-to-Head" undersells a ten-arm table whose strongest arm is a non-training control
**Problem**: The section is headed as a six-arm comparison (the five trained arms plus Graph-PPR, with base as reference), but its table carries ten rows, including three K7 controls scored by exact match only, one of which (identity-keyed routing at 81.7%) is the paper's headline number. A title that names the smaller family inside a ten-row table blurs the taxonomy exactly where the reader needs it most.
**Evidence Anchor**: `text: §6 heading "The Six-Arm Head-to-Head, Measured"`
**Why it matters**: The strongest measured arm is a control, not one of the six; the framing should let the reader see that before reading the table, not afterwards in the caption.
**Suggestion**: Retitle (for example, "The Measured Comparison: Six Trained and Format Arms Plus Three Non-Training Controls") or state the taxonomy in the first sentence of §6. No new numbers.
**Severity**: Minor
**Confidence**: 4

## Detailed Comments

### Title & Abstract
- The title frames the contribution as a training-data-format thesis, which matches the §11 claim's actual scope. Accurate at this round.
- The abstract is a single very long paragraph carrying roughly thirty distinct numbers, all of which I verified (53.3, 11.7, 10.0, 6.7, 1.7, 81.7, 51.7, 60.0, 83.3, 95.8333, 81.7108, 14.32, the 1.0 near-duplicate fraction, 61.46, 2,303). Every recurrence across Abstract, §5, §6, §7, §8, §11, and the Conclusion is consistent with the artifacts and with Table 3. The one editorial risk is density: the router scoping clause ("routing consumes a correctly resolved identity rather than doing retrieval") sits far from its 81.7% figure. Consider moving the scoping clause adjacent to the figure.

### Introduction
- The three load-bearing properties are each anchored to a measured receipt, and the intro separates the composition construction from the composition benefit ("builds and receipts but does not claim benefit for"), which keeps the §7 and §11 measured boundaries honest. No domain objection.

### Literature Review / Related Work
- All six positioning statements verified as descriptions of the cited methods: GraphGen (synthetic QA from a graph, long-tail focus), in-context pretraining (retrieval-based grouping, no identity, no provenance, no erasure), Multi-News (topic/event clusters, human targets), EmbGen (entity-description pairs, embedding reassembly, synthetic output; verified against its abstract), SISA (sharding with shard retrains), TOFU (approximate unlearning benchmark). The two direct CAG quotes are verbatim in the source and the 21k to 85k corpus range appears in its results tables.
- The novelty sentence's structural qualifiers are each artifact-backed, and the SISA paragraph's "we do not claim approximate unlearning is unnecessary" is the right stance given the adapter half is structurally pending (the SISA head-to-head is disclosed as pending-gpu, consistent with §2's claims being about the corpus axis).
- Suggestion, not a requirement: a single pointer to the direct RAG-versus-fine-tuning comparison literature (for example Luo et al. 2024, arXiv:2401.08406) would anchor the head-to-head's design lineage, since the comparison's real question is trained-format versus question-time-retrieval, a question that line of work has already framed.

### Methodology / Research Design
- The equal-budget rule and its consequences are disclosed where they matter: §7 states the composed corpus trains on 41 rows and 23,608 learnable tokens under the shared budget, against 194 rows for per-block, and the pairs arm's displacement is explained by mechanism. Entity coverage survives truncation comparably (908 vs 1029 kept entities per the receipt), so the format ordering is not a coverage artifact. The vaulted composed arm's absence is recorded as a deviation in the artifact rather than silently dropped; I consider the disclosure adequate.

### Results / Findings
- Table 3: every cell reproduced from raw rows (see S3). Table 2: arithmetic reconciles (see S1, W4). The hub-duplication and amplification numbers all match, including the null reporting at the two lowest merge rates and the cap-not-the-cause finding for the six hub samples.

### External Validity
- The layer design's per-layer gating is real in the artifact, not just asserted, and the Enron slice's conditional framing ("no stated license; benchmarked on the authors' machine only") matches the artifact's own external-slice note and its archive SHA-256 pin. W3 is the one clarity defect in this layer.

### Conclusion
- The closing thesis ("records that know what they describe are worth building for erasure, provenance, and retrieval") is exactly what the measurements support; the training-format benefit is claimed at the scale measured. No over-inference found.

### References
- 22 entries, all cited except tan_lora_memorization (see Minor Issues). The two in-line quotes taken from chan2024cag are verbatim in that source.

## Questions for Authors

1. The fixed-cache prefill is 16,607 tokens and §7 calls it inside the corpus-size regime the CAG literature evaluates, while §2 reports that regime as 21k to 85k tokens. Do you intend a rewording (below the cited floor, comparably sized), or is there a CAG source whose regime includes 16k tokens?
2. Can the hybrid routing arm's selection rule be restated in the manuscript with the same precision the artifact carries (subject records keyed on normalized name, email, or phone digits, per-question prefill, cap 31,744 tokens), so it is unmistakably distinct from the cited retrieval-fallback hybrid?
3. Is "collapses nothing by design" in §8 the intended description of a floor that produces 2,037,812 false merges on Layer R, or should the mechanism be stated as over-merging of verbatim-repeating role labels?

## Minor Issues

### Language / Grammar
- The abstract's single-paragraph density is at the edge of readability; consider splitting at the "Three non-training controls" sentence (copyedit level).

### Citation Format
- The bib entry tan_lora_memorization is uncited; either cite it where the canary-exposure boundary is discussed (the 8.48 to 8.57 bit range is exactly its subject) or remove it.
- Several entries truncate author lists with "and others" (fevry2020entities, wang2019kepler, shi2023incontext, hu_lora, bourtoule2020machine, zheng2023judging, wang2023fair); many venues require complete author lists at camera-ready.

### Figures and Tables
- Table 3: empty judge cells for the three K7 arms are explained in the caption as "no judges run (recorded in the artifact)"; consider marking the cells with an explicit placeholder marker (for example "\textendash\ or N.R.") so visually they read as intentional notches rather than typesetting gaps.

## Criterion-Bound Judgements

Calibration status: `NOT_CALIBRATED`

| Dimension | Judgement | Evidence | Rationale | Decision bearing? |
|---|---|---|---|---|
| Originality | MEETS | `text: §2 novelty sentence` | Novelty sentence scoped by structural qualifiers, artifact-backed, no "first" language; the erasure-plus-provenance corpus is not positioned by any cited prior work | No |
| Methodological Rigor | MEETS | `table: Table 3 all rows recomputed` | Row-level reproduction of every table cell from checked-in artifacts; equal-budget rule disclosed with its truncation consequences | No |
| Evidence Sufficiency | EXCEEDS | `dataset: results/amnesiac-corpus-ablation.json byteDiff exact true all fractions` | 993-check CI chain reran clean; all six artifacts I checked agree with the manuscript to the decimal; GPU-pending halves are explicitly withheld, which strengthens rather than weakens this criterion | No |
| Argument Coherence | PARTLY_MEETS | W1, W2, W3 | Two internal inconsistencies (W1 regime claim, W3 Layer R explanation) and one attribution drift (W2) sit on load-bearing scoping sentences; all are single-sentence repairs; core claims unaffected | Yes |
| Writing Quality | MEETS | W4, W5 | Precise throughout; heading taxonomy and Table 2 column naming are the remaining clarity defects | No |
| Literature Integration | MEETS | `text: §2 CAG quotes verbatim` | All checked characterizations are faithful to the cited sources; one regime-fit clause needs rescoping (W1) | No |
| Significance & Impact | MEETS | `dataset: track-k7 cag_hybrid eval all 81.7` | The router result and the honest retrieval-beats-training finding are both decision-relevant for practitioners at small-model scale; one estate, n=60, oracle resolution disclosed at every recurrence | No |

The recommendation follows from Argument Coherence being the only decision-bearing criterion: its three defects (W1, W2, W3) are single-sentence, no-new-measurement repairs, which is why Minor Revision rather than Major. Nothing in the findings requires a new artifact; all proposed fixes restate numbers already measured.

---

Seat disclosure: I did not check the 4.88% PPRL false-link figure, the 8.48 to 8.57-bit canary numbers, the 92-node/208-edge connection graph, or the 24.27%-floor gate logic against their artifacts beyond confirming the CI chain passes; I did not re-derive the Clopper-Pearson bounds. The 22-entry bib's 2026-dated citations (CLIOPATRA, LeakageBench, EmbGen, tan_lora_memorization) were verified only at abstract level or not all; if any is preprint-only, the venue may want archived DOIs. The "to our knowledge no prior artifact" sentence rests partly on two 2026 citations I could only verify at abstract level; a literature-sweep pass before submission would harden it.
