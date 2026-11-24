# Seat 1 Report — Journal-Fit Reviewer (EIC)

Reviewer configuration card: Card #1, academic-paper-reviewer v1.11.1 panel, Round 1, 2026-11-25. Model family: sonnet (session routing, same family as all five seats). Fresh context, peer-blind: this seat has not seen any other seat's report.

---

## Manuscript Information
- **Title**: How Training Data Should Look: From Stitched Chunks to Records That Know What They Describe
- **Manuscript ID**: paper/verisieve-graph-grounded-enterprise-corpus.tex (single-file submission, no ID supplied)
- **Review Date**: 2026-11-25
- **Review Round**: Round 1

## Reviewer Information

### Reviewer Role
Journal-Fit Reviewer (EIC seat, internal role EIC)

### Reviewer Identity
Senior scholar in ML systems for NLP, specializing in training-data infrastructure and reproducible benchmark artifacts, with long editorial experience on systems-and-benchmark submissions including artifact-evaluation practice. No target venue is confirmed, so this review assesses venue-general pre-submission readiness for peer-reviewed ML-systems and applied-NLP venues and names no venue as a target or recommendation.

### Reviewer Config Card Focus (Phase 0, Card #1)
Contribution coherence across abstract/introduction/conclusion; evaluable central claim; pending-measurement structural gap; reader accessibility.

## Overall Assessment

### Recommendation
- [ ] Accept
- [ ] Minor Revision
- [x] **Major Revision**
- [ ] Reject

### Confidence Score
4 (mostly within my area of expertise: training-data infrastructure, benchmark artifact practice, editorial readiness)

### Summary Assessment
The paper builds a deterministic pipeline that turns heterogeneous enterprise documents into a training corpus whose samples carry entity identities, provenance byte-ranges, and per-sample certificates, and it measures the downstream comparison of that corpus against positional chunking at one budget on one synthetic estate. From my seat, the reproducibility practice is exemplary: every number is computed from checked-in artifacts by a CI check, and the manuscript includes controls that tie its own design (BM25 tying the graph retriever) rather than suppressing them. The self-scoping section, Section 10, largely succeeds at keeping the central claim evaluable and bounded. The problems are presentation and claim placement at the frame level. The abstract is roughly 580 words in a single paragraph and carries nearly every number in the paper; the conclusion describes the training-format benefit as "real" although the paper's own uncertainty paragraph reports overlapping intervals for the two formats compared; and the adapter half of the erasure property, one of three load-bearing properties, is a pending recipe while the abstract reads as if the erasure path is finished. Project-internal labels (K3, K7, Stage K5, "the spec") appear in the central table captions without definition. Major revision is warranted: no new science is demanded for most of it, but the framing layer must be rebuilt so that one measured sentence survives in abstract, introduction, and conclusion in the same form.

## Strengths

### S1: Every manuscript number is recomputed from checked-in artifacts by CI
The manuscript states its number provenance explicitly and the supplied CI script confirms the practice at 993 checks with 0 failures. For a benchmark-artifact submission this is the strongest possible response to the most common post-acceptance complaint (unverifiable numbers), and it is stated up front rather than relegated to a supplement.
**Evidence Anchor**: `text: §5, first line "All numbers in this section are computed from checked-in artifacts by a CI check; none are hand-tuned"`

### S2: Controls that tie the design are measured and reported as ties
The paper's own thesis (training-format composition) is undercut by its strongest reported arm being a training-free router, and a lexical BM25 control ties or edges the graph retriever. Reporting these as plain results with per-stratum counts, rather than burying them, matches the stated design commitment and is verifiable in the checked artifact.
**Evidence Anchor**: `text: §7 "the answer recorded whether or not it flatters the design"`

### S3: The boundary-conditions section makes the central claim evaluable rather than hedged into nothing
Section 10 item 3 states the motivating hypothesis, states the measured point estimates with their small margins, names the capacity-starved regime and the single-estate scope, and names which behaviors at larger budgets are open work. A skeptical reader can state what was claimed, what was measured, and what would falsify the claim at a larger scale. The phrase "The boundaries of that measurement are the claim" is the right editorial instinct.
**Evidence Anchor**: `text: §10 item 3 "The boundaries of that measurement are the claim"`

### S4: Composition is positioned against its nearest structural neighbors honestly
The related-work section separates composition from graph-based synthetic sample generation (GraphGen, EmbGen), from in-context pretraining (the closest prior art), and from summarization-style multi-document units, and it declines comparability to CAG's reported numbers explicitly. The positioning sentence about composing actual source bytes with per-sample provenance is a defensible statement of what is structurally new, made about the artifact rather than about a result.
**Evidence Anchor**: `text: §2 "To our knowledge no prior artifact composes the actual source bytes of multiple heterogeneous documents into one deterministic training sample"`

### S5: Pending measurements are held out with no placeholder values
The three GPU-dependent adapter measurements are declared pending, structured as `pending-gpu` in the artifact, and excluded from all tables, and the manuscript says so plainly. Refusing to ship unmeasured numbers is the correct artifact-evaluation behavior and it keeps the measured/recipe boundary explicit in at least one place.
**Evidence Anchor**: `text: §9 "No placeholder values are shown"`

## Weaknesses

### W1: The conclusion asserts a training-format benefit as "real" that the paper's own uncertainty analysis does not support
**Problem**: The conclusion states that records that know what they describe are worth building, that "their training-format benefit is real and must be claimed at the scale it was measured", and that "composition wins over per-block and flat formats on every stratum by small margins". The paper's own §8 uncertainty paragraph reports closed-book exact-match intervals of 11.7% (4.8 to 22.6) for composed and 10.0% (3.8 to 20.5) for per-block at n=60: the two formats' intervals overlap heavily, and the only separation the analysis licenses is trained arms versus retrieval arms. The abstract handles this correctly ("composition's format benefit is directionally positive and small"); §10 item 3 handles it correctly ("small measured benefit at the scale measured"); the conclusion upgrades it to a positive existence claim.
**Evidence Anchor**: `text: §11 "their training-format benefit is real and must be claimed at the scale it was measured"`
**Why it matters**: The conclusion is the last thing a reviewer and a reader carry away, and it is the one place in the manuscript where the headline claim drifts past what the measured comparison supports. At pre-submission stage this is the single cheapest place to lose a paper: a reviewer who reads the conclusion first and the interval paragraph second will read the drift as result inflation, and the drift is in the primary-contribution sentence, not a side remark.
**Suggestion**: Rewrite the conclusion's claim sentence to match the abstract's wording: the entity graph pays off as a retrieval index and router at this scale, composition's format benefit is directionally positive and small with overlapping intervals at n=60, and its costs are measured. No new measurement is required; this is a prose repair using numbers already in the paper.
**Severity**: Major
**Confidence**: 4 (core expertise: benchmark-claim calibration at ML-systems venues)

### W2: The erasure property is one of three load-bearing claims, and its adapter half is a pending recipe where the abstract and conclusion read it as complete
**Problem**: Section 1 names erasure as the third load-bearing property. Section 9 is candid that only the corpus half is measured and that the three adapter measurements (retrain cost, SISA comparison, canary exposure before and after retrain) are pending. Table 2's caption says the same. But the abstract writes "with a sealed LoRA retrain recipe completing the erasure path for the adapter trained on it", which reads as the property being complete; §11 concludes that the records "are worth building for erasure" without any scoping of which half is measured. A reader who reads abstract plus conclusion never learns that half of the property Section 1 calls load-bearing has no measured numbers.
**Evidence Anchor**: `text: Abstract "with a sealed LoRA retrain recipe completing the erasure path for the adapter trained on it"`
**Why it matters**: For venue-general ML-systems readers, the erasure path is likely one of the two reasons this artifact is interesting, and it is precisely the half whose measurement is outstanding. The current phrasing lets the strongest operating-property claim inherit credibility from the measured corpus half. The §9 disclosure is good practice, but disclosure in one section does not neutralize a completion claim in the abstract.
**Suggestion**: Two acceptable repairs, either of which is prose-only if the measurements stay unmeasured: (a) word the abstract as "a sealed LoRA retrain recipe specified to complete the erasure path; the three adapter measurements are pending and shown nowhere", matching the Table 2 caption's discipline, and add one scoping clause to the conclusion's erasure sentence; or (b) if the authors can run the three pending adapter measurements before submission, the completion wording becomes earned. Option (b) requires a new artifact and is optional; option (a) does not.
**Severity**: Major
**Confidence**: 4 (core expertise: artifact-evaluation and claim-completeness standards)

### W3: The abstract is a single roughly 580-word paragraph containing nearly every number in the paper
**Problem**: The abstract runs as one paragraph of about 580 words in which I count more than 25 inline numeric values spanning two different estates, three training-free arms, five trained arms, certificate bounds, erasure fractions, false-merge amplification factors, and duplicate-pair counts. It ends with a sentence stacking the routing arm, the composition direction, and the failure modes into one clause chain.
**Evidence Anchor**: `text: Abstract "Enterprises sit on scattered, heterogeneous documents (SQL dumps, spreadsheets, email, meeting transcripts and audio, decks, notes)"`
**Why it matters**: A reader outside the project cannot state in one sentence what was built and what was learned from this abstract, and most will not extract the actual finding hierarchy: at this scale the graph pays off as a retrieval index and router, the training-format benefit is small, and the operating properties are the durability story. Abstracts of this length also get desk-filtered at peer-reviewed venues before review quality is even consulted. The measured comparison genuinely supports a compact story; the abstract just refuses to compress it.
**Suggestion**: Restructure to roughly 200 words: (1) the positional-chunking deficiency, two sentences; (2) what the artifact is (schema, WASM stack, receipts), two sentences; (3) the three headline measured results (retrieval 53.3%, best trained format 11.7%, strongest arm 81.7% with the routing scoping), three sentences; (4) one sentence on erasure with the pending-adapter scoping from W2; (5) one sentence of honesty boundaries. All numbers exist; no new measurement is needed. The certificate numbers and the near-duplicate counts can move to §5 and §6, where they are already discussed.
**Severity**: Major
**Confidence**: 5 (core expertise: editorial practice for systems-and-benchmark venues)

### W4: Project-internal identifiers appear in the central table captions and prose without definitions an outside reader can use
**Problem**: Table 3's caption references "on the same estate, rows, and base model as the K3 arms"; no section defines what K3 denotes. §2 refers to "the K7 arm that prefills this paper's composed records as a cache unit" and Table 2 and §8 continue to use K7; §5 and §10 refer to "the open Stage K5 measurement" and "the Stage K5 resolution-scoring line"; §7 states the noise types come from "the spec", an unexplained internal reference. "Sealed" (for the recipe) and "receipt" (for a measured, artifact-backed claim) are used dozens of times and are never crisply defined for outside readers, though "receipt" is inferrable from context.
**Evidence Anchor**: `text: Table 3 caption "on the same estate, rows, and base model as the K3 arms"`
**Why it matters**: These labels gate comprehension of the central results table, the related-work positioning, and the boundary-conditions section. A reader outside the project has no way to know that K3 and K7 are internal stage milestones, what order they ran in, or why the arms are grouped that way; the grouping is the paper's own comparison structure, so an unexplained grouping label partly unexplains the table.
**Suggestion**: Replace stage labels in manuscript text with descriptive names (for example "the trained-format arms", "the cache-based training-free arms") and reserve stage identifiers for the artifact itself, where they are load-bearing; define "the spec" out of existence by naming the artifact file. One sentence in §5 introducing "receipt" as the manuscript's term for a CI-verified, artifact-pinned measurement would fix the vocabulary issue at the source. Prose-only; requires no new measurement.
**Severity**: Minor
**Confidence**: 4 (core expertise: accessibility of benchmark papers to outside reviewers)

## Detailed Comments

### Title & Abstract
The title states a normative claim ("How Training Data Should Look") that the measured content supports in a qualified form: at the measured scale, records that know what they describe pay off for retrieval, routing, erasure, and provenance, while the training-format benefit is small. The subtitle captures the artifact accurately and is appealing. The abstract is the manuscript's largest presentation problem (W3) and its erasure wording is its second (W2). The contribution ordering itself is consistent across abstract, §1, and §11: in all three, the training-data format leads and the operating properties are weighted as ride-along properties, which matches the stated intent that privacy machinery is "the price" of operating the corpus. I found no ordering contradiction; the problems are length and one overclaim.

### Introduction
§1 is well built: the deficiency framing (records that are anonymous to the pipeline) is concrete, the three load-bearing properties are enumerated with receipts rather than adjectives, and §1 explicitly scopes "exactly" to construction validation. Two notes. First, the sentence "Neither is the pitch on its own" is admirably honest but leaves a first-time reader briefly unsure what the primary contribution is; §10 item 3 resolves this, and the resolution should be visible by the end of §1. Second, the introduction promises the head-to-head as "the measured comparisons" of the design's own composition idea; the introduction does not preview that the strongest measured arm is a training-free router, and a one-clause preview there would make the eventual result feel recorded-honestly rather than reluctantly reported.

### Literature Review / Theoretical Framework
Mostly another seat's territory. From the journal-fit side: the related work is unusual in a good way in that it declines number-comparability with CAG explicitly, and it positions composition against its two nearest structural neighbors with concrete structural differences rather than citation name-dropping. No revision needed from my seat beyond the K7 label fix in §2 (W4).

### Methodology / Research Design
Not my seat's depth. Editorial notes only: the same-estate, same-budget, sealed-recipe design is described compactly enough for a reader to summarize, which is what a systems venue needs, and the blinded-judge setup with recorded judge disagreement is presented with its sensitivity caveats attached.

### Results / Findings
The results hierarchy survives re-reading: trained formats cannot beat training-free retrieval at the measured scale; among trained formats the design's ordering holds on point estimates with overlapping intervals; composition's costs are quantified, not hidden. Table 3 is the central evidence and is well organized, but its caption carries the only mention of the K3/K7 grouping convention (W4), and the section heading "The Six-Arm Head-to-Head, Measured" describes ten table rows (five trained, graph retrieval, base, and three K7 arms). The uncertainty paragraph (§8, "Uncertainty at n=60") is the paper's statistical honesty anchor and should be treated as binding on abstract and conclusion (W1).

### Discussion
The limitations discussion is distributed rather than centralized: §5 scope notes, §6 costs, §8 honesty boundaries, §9 pending measurements, §10 claims, §11 closing. The distributed placement works in a systems-paper register, and nothing important is missing from it; the one gap is that the pending-adapter disclosure never reaches abstract or conclusion (W2).

### Conclusion
The conclusion's closing thesis sentence ("worth building for erasure, provenance, and retrieval, their training-format benefit is real and must be claimed at the scale it was measured") is where the manuscript's claim discipline finally slips (W1). Everything else in the conclusion is within the evidence: the 53.3% retrieval result, the 81.7% routing arm with its scoping, the measured costs.

### References
Not my seat's depth. Citation use is functional: the CAG, long-context, knowledge-capacity, and machine-unlearning anchors are each attached to a claim they actually bound.

## Questions for Authors

1. The conclusion calls the training-format benefit "real" while §8's interval paragraph shows the composed and per-block intervals overlapping at n=60. Which wording do you intend to defend, and can abstract, §10, and §11 state it identically once you choose?
2. Will the three `pending-gpu` adapter measurements be measured before submission? If not, will the abstract's "completing the erasure path" and the conclusion's unqualified "worth building for erasure" be rewritten to the recipe-level claim §9 supports?
3. What do K3, K7, and Stage K5 denote, and can the table captions and §2 use descriptive names so an outside reviewer can parse the arm grouping without the artifact?
4. If a reader may take one sentence from the head-to-head, what is it, and is that sentence "the entity graph pays off as a retrieval index and router at this scale, while the training-format benefit is small and interval-overlapping"? If your one sentence differs, where in the abstract do you state it?

## Minor Issues

**Non-finding channel:** copyedit-level items below the finding threshold.

### Language / Grammar
- Abstract, final sentence: a single sentence stacks the routing arm, the composition direction, and the failure modes across roughly 60 words with comma-spliced clauses; split into two or three sentences.
- §7, "Eight designed noise types of the spec": name the artifact file instead of "the spec".
- §6 heading "Relational Composition: Built, Receipted, Measured" reads as a project log entry; consider "Relational Composition" plus one sentence carrying the three claims.
- The word "sealed" for the training recipe appears eleven times; one definition in §4 or §8 is enough, then use it sparsely.

### Citation Format
- No problems observed from the journal-fit seat.

### Figures and Tables
- Table 3's caption states judge columns are empty for the K7 arms "recorded in the artifact"; the in-table em-dash cells plus this sentence are fine, but the caption carries no indication for the three K7 rows of why no judges were run; one clause would remove the question.
- Table 2's caption includes a project-status sentence ("GPU-dependent measurements are pending and appear in no table until measured"); if the adapter measurements are later measured, remember to update this sentence; if not measured at submission, the wording is correct as is.
- Section heading "The Six-Arm Head-to-Head, Measured" versus a ten-row table; either rename (for example "Head-to-Head, Measured") or state the row count in the first paragraph.

### Layout
- The manuscript uses a venue-specific style package (`mlsys2025`, accepted mode) with a hand-adjusted copyright string while no venue is confirmed; harmless in review, but note it will need retargeting per venue, and the pdfsubject "Systems for Machine Learning" ties the paper to that assumed track.

## Criterion-Bound Judgements

Calibration status: `NOT_CALIBRATED`

| Dimension | Criterion source | Judgement | Evidence anchor(s) | Rationale | Uncertainty / scope limit | Decision bearing? |
|---|---|---|---|---|---|---|
| Originality | quality_rubrics.md | MEETS | `text: §2 "To our knowledge no prior artifact composes the actual source bytes of multiple heterogeneous documents into one deterministic training sample"` | Composition of actual source bytes with resolved identity and provenance is positioned against the nearest prior art with stated structural differences, and the paper claims it for the artifact, not a result | Novelty-depth assessment is not my primary seat; Reviewer 2 should confirm | No |
| Methodological Rigor | quality_rubrics.md | NOT_ASSESSED | | Other seats own statistics and entity-resolution mechanics | Outside my seat's assigned depth | No |
| Evidence Sufficiency | quality_rubrics.md | PARTLY_MEETS | `text: §9 "No placeholder values are shown"` | Core head-to-head is measured and CI-recomputed; but one of three load-bearing properties is half-unmeasured, and the central comparison runs at one scale on one estate | Scale-dependent behavior at larger budgets is genuinely open, and the paper says so | Yes |
| Argument Coherence | quality_rubrics.md | PARTLY_MEETS | `text: §11 "their training-format benefit is real and must be claimed at the scale it was measured"` | The claim chain is coherent from abstract through §10; the conclusion breaks it by upgrading a small, interval-overlapping ordering into a "real" benefit | Repairable in prose using existing numbers | Yes |
| Writing Quality | quality_rubrics.md | PARTLY_MEETS | `text: Abstract "Enterprises sit on scattered, heterogeneous documents (SQL dumps, spreadsheets, email, meeting transcripts and audio, decks, notes)"` | Approximately 580-word single-paragraph abstract, undefined internal identifiers in central captions | Fully repairable without new content | Yes |
| Literature Integration | quality_rubrics.md | MEETS | `text: §2 "we do not replicate the CAG corpora, models, or baselines, so our numbers are not comparable to theirs"` | Related work is attached to claims it bounds, and incomparability is declared where it exists | Depth check belongs to Reviewer 2 | No |
| Significance & Impact | quality_rubrics.md | PARTLY_MEETS | `table: Table 3, row "CAG hybrid routing (K7)", column All = 81.7` | The retrieval/router result at this scale is a real, useful finding; the significance of the training-format thesis the title advertises depends on measurements that cannot be made at the current regime | One-estate scope limits generality of the significance judgement | Yes |

The recommendation is Major Revision. The decision-bearing criteria are Evidence Sufficiency, Argument Coherence, and Writing Quality, and all three are repairable without new science with one exception: if the authors choose to earn "completing the erasure path" wording rather than soften it, that repair requires new artifact measurements and is optional, since the recipe-level scoping in §9 and the Table 2 caption is already the honest fallback. No strength on one criterion offsets these; the measured core is sound and the CI discipline is genuinely above common practice, which is why this is a revision and not a rejection.

---

Seat disclosure: I did not recompute any confidence interval myself (statistics belong to another seat; I took the §8 values as stated) and I verified only three of the head-to-head arm numbers against the supplied artifact. If other seat findings change the conclusion wording this review targets, the synthesizer should reconcile the two framings before repair.
