# Seat 2 Report — Peer Reviewer 1 (Methodology)

Reviewer configuration card: Card #2, academic-paper-reviewer v1.11.1 panel, Round 1, 2026-11-25. Model family: sonnet (session routing, same family as all five seats). Fresh context, peer-blind: this seat has not seen any other seat's report.

---

## Manuscript Information
- **Title**: How Training Data Should Look: From Stitched Chunks to Records That Know What They Describe
- **Manuscript ID**: verisieve-graph-grounded-enterprise-corpus.tex (MLSys 2025 style)
- **Review Date**: 2026-11-25
- **Review Round**: Round 1

## Reviewer Information

### Reviewer Role
Peer Reviewer 1 (Methodology)

### Reviewer Identity
Quantitative evaluation methodologist for NLP benchmarks, specializing in small-sample evaluation of language-model systems: exact binomial (Clopper-Pearson) interval use, LLM-as-judge reliability and bias, canary-based memorization measurement, and controlled multi-arm training comparisons at matched budgets.

## Overall Assessment

### Recommendation
- [ ] Accept
- [ ] Minor Revision
- [x] **Major Revision** — Substantial revisions needed, re-review required after revision
- [ ] Reject

### Confidence Score
5

### Summary Assessment
The paper measures a ten-arm comparison of training formats and non-training controls over a synthetic noisy estate, scored by closed-book exact match, with three non-training controls (BM25, CAG cache, hybrid routing) dominating all five trained arms. Every number I recomputed from the committed artifacts reproduces exactly, including all eight Clopper-Pearson intervals, the canary bits (8.48 to 8.57 trained, 4.25 base), and the judge-agreement range; the 993-check CI chain passes and the checker is auditable. The core measured facts are sound and unusually well receipted. The weaknesses are inferential, not arithmetic: the paper never runs a statistical test and reads overlapping 95% intervals both as "statistically indistinguishable" and as "clears the upper bounds," when the paired structure of the 60 shared questions makes exact McNemar available and changes two conclusions in opposite directions; the claim that composition "wins over per-block and flat formats on every stratum" is contradicted by Table 3 itself (exact ties on Q1 and Q2); and the equal-token-budget design silently removes 1,065 of the composed arm's 1,106 samples by head truncation, an undisclosed coverage confound. None of these require new measurements; all are repairable from committed rows, but they require substantial rewriting and one design disclosure.

## Strengths

### S1: Full numerical reproducibility of Table 3 from committed per-row artifacts
Every cell of Table 3, all ten arms and all three strata, reproduces exactly from the committed exact_match booleans: BM25 14/21/1 (36/60), CAG 9/18/4 (31/60), hybrid 21/19/9 (49/60), retrieval 10/20/2 (32/60), flat 1/2/1, per-block 2/3/1, composed 2/3/2, pairs 1/0/0, vaulted 1/0/0, base 1/0/0. I recomputed these independently in a fresh script rather than trusting the checker.
**Evidence Anchor**: `table: Table 3 — all 10 arm rows; my recomputation from results/track-k7-cag-vs-rag-vs-bm25.json and results/track-k-composition-head-to-head.json matches every cell`

### S2: Reported Clopper-Pearson intervals are all correct
All eight intervals in "Uncertainty at n=60" reproduce to the digit from the row counts: Graph-PPR [40.0, 66.3], BM25 [46.5, 72.4], CAG [38.4, 64.8], hybrid [69.6, 90.5], composed [4.8, 22.6], per-block [3.8, 20.5], flat [1.8, 16.2], base [0.0, 8.9]. The checker's bisection convention (CDF of k-1 successes at 0.975 for the lower bound) is the correct exact binomial convention.
**Evidence Anchor**: `table: Table 3 — hybrid CI 69.6 to 90.5 recomputed for 49/60 matches to one decimal`

### S3: The interval-overlap statements that do survive are correctly derived
The claim that the hybrid arm's interval clears the graph retriever's and cache arm's upper bounds is arithmetically verified (69.6 > 66.3 and 64.8) and the overlap with BM25's top (69.6 < 72.4) is accurate. The large trained-versus-retrieval separation is robust under any reasonable test.
**Evidence Anchor**: `text: §7 "Uncertainty at n=60" "clears the graph retriever's and cache arm's upper bounds"`

### S4: Judge disclosure matches the artifact exactly
The caption states the three K7 arms ran no judges, and the K7 rows in the artifact carry no judge fields; the row-agreement range (6.7 to 41.7%) matches the artifact's judgeAgreement block across all seven scorer-supplied arms. The manuscript also cites the known judge-bias literature rather than claiming blind-judge neutrality.
**Evidence Anchor**: `dataset: track-k7-cag-vs-rag-vs-bm25.json — row schema has no judge field; manuscript Table 3 caption "with no judges run (recorded in the artifact)"`

### S5: Anti-circularity design is receipted, not asserted
The manifest is read scorer-side only; both head-to-head artifacts carry anti-circularity and zero-egress notes, and the artifact evalQuestions field repeats the Q1/Q2/Q3 partition (24/24/12) that Table 3's caption reports. The qid sets of the K3 and K7 arms are identical, so the "same estate, rows, and base model" caption claim holds.
**Evidence Anchor**: `dataset: track-k-composition-head-to-head.json — anti_circularity_note: "Training corpora are built ONLY from fixtures/noisy-estate/ documents"`

### S6: Construction-validation framing of Table 1 is explicit and repeated
The manuscript states twice that the flat-text baseline zeros are by construction and that the table "is construction validation, not an extractor comparison," with the scope note that uniform high columns validate the construction. A reader cannot reasonably mistake Table 1 for an extractor comparison. The non-zero baseline cells (55.56 speaker purity, 44.44 prosodic accuracy) have their conventional values documented in the artifact as the caption states.
**Evidence Anchor**: `text: §5 "Extraction fidelity" "so the table is construction validation, not an extractor comparison"`

### S7: Canary parity is a designed control, and the numbers verify
The 104-row canary batch is appended identically to every trained arm at build time and kept outside the capped estate budget, so exposure parity is structural, not incidental. The reported range (8.48 to 8.57 across the five trained arms, 4.25 for base) matches the artifact's per-arm canaryExposure values.
**Evidence Anchor**: `dataset: track-k-composition-head-to-head.json — canaryExposure.all_12_bits: 8.57 (flat) to 8.48 (vaulted), base 4.25`

### S8: The CI validation chain is auditable end to end
The checker derives manuscript substrings from committed artifacts and re-running it from a clean shell yields 993 checks and 0 failures, matching the paper's stated chain. The per-question exact-match rows make the whole headline table independently recomputable by anyone with the repo, which is how this review verified it.
**Evidence Anchor**: `dataset: scripts/check-paper-numbers.mjs — 993 paper-number checks, 0 failures, re-run by this reviewer`

## Weaknesses

### W1: No statistical test is run; interval overlap is used as the test, in both directions
**Problem**: The paper never performs a hypothesis test and instead reads overlapping 95% Clopper-Pearson intervals as "statistically indistinguishable" and non-overlap as separation. Overlapping 95% intervals do not establish indistinguishability (the combined-level test can still reject), and non-overlap implies a significance level of roughly 0.01, not 0.05, so the instrument the paper actually used is neither correct for its tie claims nor calibrated for its separation claims. Critically, the arms are paired: all ten arms answer the same 60 manifestations of the same questions, so exact McNemar is the correct instrument and is computable from the committed rows with no new measurement. I ran it. Three conclusions change. First, the ties the paper claims are real (BM25 vs Graph-PPR, p = 0.39; CAG vs Graph-PPR, p = 1.00), so those conclusions survive but rest today on the wrong arithmetic. Second, "statistically indistinguishable" is stated for a comparison the paired test neither confirms nor refutes at the stated basis. Third, and most consequential, the hybrid arm is significantly better than BM25 (p = 0.0146), Graph-PPR (p = 0.0023), and CAG (p = 0.0001), even though the paper's interval language ("overlapping only the top of BM25's") leaves the BM25 comparison unresolved. The paper understates its own strongest result while overstating the evidential basis of its tie claims.
**Evidence Anchor**: `text: §7 "Uncertainty at n=60" "are statistically indistinguishable from one another"`
**Why it matters**: The section is titled "Uncertainty at n=60" and is the paper's entire inferential apparatus. A reader who takes the stated logic away will believe CI overlap settles tie questions and CI non-overlap settles ordering questions; both beliefs are wrong at this n, and one of the two live conclusions (hybrid vs BM25) is left ambiguous when the paired data resolve it.
**Suggestion**: Add exact McNemar tests for the comparisons the paper makes (at minimum: hybrid vs the three non-training controls, BM25 vs Graph-PPR, CAG vs Graph-PPR, composed vs per-block, composed vs flat, trained arms vs base), computed from the same committed rows, with a multiplicity note (e.g., Holm correction across the handful of comparisons the paper actually narrates). Rewrite the tie and separation sentences to cite the paired tests. Flagging explicitly: this repair uses only committed rows and requires no new artifact.
**Severity**: Major
**Confidence**: 5 — core expertise: small-sample inference for paired binary evaluation

### W2: "Composition wins over per-block and flat formats on every stratum" is contradicted by Table 3
**Problem**: The conclusion and the claims section both state composition wins over per-block on every stratum. Table 3 shows composed and per-block exactly tied on Q1 (8.3% vs 8.3%) and on Q2 (12.5% vs 12.5%); the entire strict separation between the two best trained formats is one question on Q3 (16.7% vs 8.3%, i.e., 2 of 12 against 1 of 12). The section 7 phrasing "the design's ordering holds on every stratum" is a weak ordering (ties included) and is defensible only if stated as such; the conclusion's "wins... on every stratum" is a strict claim that is false on two of three strata. The differences among all trained formats are also individually non-significant even before correction (composed vs per-block, McNemar p = 1.00; composed vs flat, p = 0.55; per-block vs base, p = 0.13), which the paper half-acknowledges in section 7 but drops by the conclusion.
**Evidence Anchor**: `table: Table 3 — composed Q1 8.3 and Q2 12.5 vs per-block Q1 8.3 and Q2 12.5: exact ties, no win`
**Why it matters**: This is the paper's eponymous claim about the composed corpus's training benefit. An unhedged "wins on every stratum" over a one-question margin that vanishes on two of three strata is the kind of over-reading the paper's own honesty boundaries elsewhere explicitly disclaim, and it is the easiest claim in the paper for a methodological reviewer to falsify from the table alone.
**Suggestion**: State the weak ordering strictly: composed reaches or matches per-block on every stratum and strictly exceeds it only on Q3 by one question; "wins" in the conclusion should become "is never behind, and leads on only the disambiguation stratum by one item, within noise at these stratum sizes." The abstract's "the best trained format" should carry the same one-measurement caveat.
**Severity**: Major
**Confidence**: 5 — core expertise: evaluation of arm orderings under small-sample noise

### W3: The equal-token-budget design is an equal-cap design; the composed arm trains on 41 of its 1,106 samples and the selection rule is undisclosed
**Problem**: The design applies one budget (25,755 tokens, the smallest arm's total) and reaches parity by deterministic head truncation in corpus order. Per the artifact's budget block: flat keeps 100 of 178 rows (56% coverage), per-block keeps 194 of 216 (90%), composed keeps 41 of 1,106 (3.7%), composed pairs keeps 50 of 3,322, vaulted keeps all 216. So the trained-format comparison is not five formats at equal knowledge coverage; it is five formats at equal cap, under which the composed arm trains on the head prefix of its own corpus and discards 96% of it, while the per-block arm trains on nearly all of its corpus. The manuscript discloses this mechanism only where it flatters nothing: the pairs arm's displacement ("until only 50 rows with 9,947 learnable tokens survived") is reported, but the composed arm's own 41-of-1,106 survival, and the head-order selection rule, appear nowhere in the manuscript.
**Evidence Anchor**: `dataset: track-k-composition-head-to-head.json — budget.perArm.post: composed rows 41 of 1106 pre (truncatedRows 1065), per_block 194 of 216, flat 100 of 178`
**Why it matters**: This is a comparability confound in the comparison the artifact exists for. Composition's redundancy (the paper's own hub-duplication finding: 20,627 near-duplicate pairs, duplicate fraction 1.0) is precisely what blows its row count past any fixed cap, so the measured composed-over-per-block margin is a margin between one format at 90% coverage and another at 3.7% coverage under an undisclosed head-prefix selection. The true composed-versus-per-block effect at fuller coverage is unmeasured, and the current design cannot distinguish a format effect from a truncation-coverage effect. The capacity-starved framing partially covers this, but "capacity-starved" does not tell the reader that the composed format's corpus was not the corpus being compared.
**Suggestion**: Disclose the truncation rule and the per-arm coverage fractions (kept rows and entities, both already in the artifact) in the design paragraph and in a Table 3 footnote; restate the trained-format ordering as conditional on this truncation regime. If any coverage-matched comparison is desired (for example, composed at the per-block arm's coverage), flag that explicitly as requiring a new artifact; do not assert any coverage-matched number in prose until it is measured.
**Severity**: Major
**Confidence**: 5 — core expertise: controlled multi-arm training comparisons at matched budgets

### W4: The abstract's headline stratum statistic is a point estimate with no stratum size and no interval
**Problem**: The abstract gives "53.3% of questions exactly (83.3% on the cross-document stratum)". The stratum is 24 questions (20 of 24), and its Clopper-Pearson interval at n=24 is wide; the abstract presents the bare point value, in the one sentence most likely to be quoted, without the stratum size or interval that the body text properly supplies.
**Evidence Anchor**: `text: Abstract "(83.3% on the cross-document stratum)"`
**Why it matters**: At n=24 the interval spans roughly [62.6, 95.3]; quoting 83.3% bare invites an over-read the body spends a paragraph preventing.
**Suggestion**: Add the stratum size in the abstract parenthetical: "83.3% on the 24-question cross-document stratum." No new measurement; the interval already exists in the committed rows if the authors wish to quote it.
**Severity**: Minor
**Confidence**: 5

### W5: Canary and perplexity protocol descriptions are under-specified
**Problem**: For canaries, the manuscript gives the repetition structure (12 canaries at 1, 5, and 20 repetitions), the parity design, and the bits range, but never defines the exposure metric: it is Carlini-style rank-based exposure in bits, and the artifact also carries per-canary exposures and a rank-1 count (8 of 12 canaries at rank 1 for every trained arm versus 3 of 12 for base), neither of which is defined or mentioned. For perplexity, the manuscript reports 32.5, 43.9, and 26.1 with no description of the held-out set; per the artifact it is 10 fixed generic paragraphs totaling 380 tokens with no estate content, which is a very small probe and materially qualification for the numbers. Also, "degrades slightly" understates the vaulted arm's 26.1 to 43.9 movement (a 68% increase in perplexity).
**Evidence Anchor**: `dataset: track-k-composition-head-to-head.json — fluency.heldOutCleanText: "10 fixed generic paragraphs (380 tokens), no estate content", nllTokens 380`
**Why it matters**: The reader cannot tell what scale the bits are on, what reference set defines rank, or how small the perplexity probe is. The rank-1 counts in particular are a stronger and more interpretable memorization statistic than the aggregate bits and are already committed.
**Suggestion**: Add two or three sentences: define exposure as Carlini-style rank-based exposure in bits over the 12 planted canaries, state that all trained arms place 8 of 12 canaries at rank 1 against 3 of 12 for base, and state the held-out perplexity probe's composition (10 generic paragraphs, 380 tokens, no estate content). Replace "degrades slightly" with the actual range. No new artifact required.
**Severity**: Minor
**Confidence**: 4

### W6: Judge-score columns invite cross-arm reading across a disclosure gap the caption closes only for EM
**Problem**: The caption's disclosure is accurate and sufficient for exact-match comparisons, and no prose claim rests on judge scores across the K3/K7 split, which is the right call. The residual problem is presentational: Table 3 shows judge means and a Llama column only for the seven K3-scored arms, so the table's judge columns cannot be read within the non-training control group (BM25, CAG, and hybrid lack judges while Graph-PPR has them), and the judge means carry no variance quantification even within the K3 group. The agreement statistics (6.7 to 41.7% row agreement) disclosed in the design paragraph are themselves a warning that the judge means are noisy, but the table gives no hint of that noise.
**Evidence Anchor**: `table: Table 3 — judge columns present for Graph-PPR but empty for BM25, CAG, and hybrid rows`
**Why it matters**: A reader who weights the 1.05 Graph-PPR judge mean against empty cells for its peers could conclude the judges favor the graph arm, which is exactly the kind of unsupported cross-arm judge reading the disclosure was meant to prevent.
**Suggestion**: Either state in the caption that the judge columns are not comparable across the K3/K7 split and that no analysis uses them beyond within-K3 description, or backfill judges for the three K7 arms; the latter requires a new artifact and is optional. If kept as-is, the empty cells in the hybrid row should not sit adjacent to a "strongest arm" narrative without the explicit sentence that no judge-based reading of the hybrid is made or available.
**Severity**: Minor
**Confidence**: 4

### W7: The binomial intervals lack a stated sampling frame
**Problem**: The 60-question set is an authored manifest partitioned 24/24/12, not a random sample from a defined population, yet the "Uncertainty at n=60" paragraph presents Clopper-Pearson intervals without saying what superpopulation the interval covers (resampling of questions from this estate, this generator's question process, or deployment estates). The interval arithmetic is correct (S2); the missing piece is the one-sentence frame statement.
**Evidence Anchor**: `absence: §7 "Uncertainty at n=60" — expected a statement of the population the exact binomial intervals refer to`
**Why it matters**: At n=60 on one synthetic estate the superpopulation reading is the entire interpretive content of the interval; the paper is otherwise disciplined about scoping and this is the one place the scoping is left implicit.
**Suggestion**: One sentence in the paragraph: the intervals quantify sampling uncertainty over the 60 authored questions as the only randomization, and say nothing about other estates or question processes; cross-estate claims are the open K5 line. No new measurement.
**Severity**: Minor
**Confidence**: 5

## Detailed Comments

### Title & Abstract
- The abstract's number-to-receipt density is high and every figure I checked reproduces (S1, S7, S8). Two scoping gaps in the abstract: the stratum statistic without its n (W4), and "the best trained format, the composed corpus, reaches 11.7% against 10.0%" without the cap-coverage caveat from W3 or the noise caveat from W2. The hybrid arm's 81.7% is properly scoped ("routing consumes a correctly resolved identity rather than doing retrieval"), which is good.

### Introduction
- The "measured receipts rather than adjectives" framing is methodologically sound and the receipts are there. No methodology concerns.

### Methodology / Research Design
- The paired structure of the evaluation (ten arms, same 60 questions) is the design's biggest unexploited asset; the entire inferential section would be stronger and shorter with paired tests (W1).
- The estate's six-strata noise design and the binding gate (recall under 90% plus at least one collision false merge) are a genuinely good device for guaranteeing the benchmark is not a solved key; I verified the baseline floor receipts exist for both estates.
- One budget for five arms is a sound cost-matching principle; its execution via head truncation needs the W3 disclosure.

### Results / Findings
- Table 3: fully verified (S1, S2). The caption's K7 disclosure is accurate (S4). The per-stratum prose in "Non-training controls" ("a direction rather than an inferential claim, at stratum sizes of 24, 24, and 12") is exactly the right posture and is the posture W2 asks the conclusion to adopt.
- The pairs arm's failure reported as mechanism (row displacement, 50 rows, 9,947 learnable tokens) rather than as a verdict on the pair idea is verifiable in the artifact and well done.

### Discussion / "What This Paper Does Not Claim"
- The scale-boundaries item is the right list, but item 3's "wins over per-block and flat formats on every stratum" repeats the W2 error in the paper's most claim-bearing section.

### Conclusion
- "composition wins over per-block and flat formats on every stratum by small margins" is the strict-claim error (W2). The retrieval-index and router claims are the ones the data actually support, and the paper's own honest framing of the router (resolution supplied, not performed) should be the template for the composition sentence.

## Questions for Authors

1. Which composed-sample head prefix survived the 25,755-token cap, and was the head-order truncation policy chosen before or after the composed arm's results were seen? (Determines whether W3 is a disclosure fix or also a sensitivity analysis; if the latter, flagging it as requiring a new artifact is acceptable.)
2. Do you accept adding exact McNemar (or equivalent paired) tests from the committed rows for the narrated comparisons? If not, what is the basis for "statistically indistinguishable" at these intervals?
3. Were the 60 manifest questions authored before the K7 arm designs (BM25, CAG, hybrid routing) were proposed, and is there any authoring document from which the question-authoring process could be described in the paper?
4. Should the K7 arms receive judge scores for symmetry (requires a new artifact), or will the paper rely on exact match only for cross-arm claims and say so explicitly in the caption?

## Minor Issues

### Figures and Tables
- Table 3: consider adding the per-arm kept-row counts (100/178, 194/216, 41/1106, 50/3322, 216/216) as a footnote; the numbers are committed and directly qualify the "one budget" reading (see W3).
- Table 3 caption: "scored by exact match only" for the K7 arms is accurate, but note explicitly whether judge scores could be added without re-scoring; as written a reader cannot tell whether the "--" cells mean unavailable or suppressed-by-design. Per the artifact it is the latter (absent at scoring time), and the caption's "(recorded in the artifact)" does convey this, but the phrase "no judges run" would be even clearer as "judges not run for these arms at scoring time".

### Layout
- The design paragraph's "one budget of 25,755 training tokens each" is slightly imprecise: per the artifact the actual per-arm totals are 25,724, 25,740, 25,088, 25,565, and 25,755 (the cap, not the realized budget, is 25,755). "Capped at" would be exact.

## Criterion-Bound Judgements

Calibration status: `NOT_CALIBRATED`

| Dimension | Judgement | Evidence | Rationale | Decision bearing? |
|---|---|---|---|---|
| Methodological Rigor | PARTLY_MEETS | W1, W2, W3, S1, S2, S5, S8 | Receipts, anti-circularity, and reproducibility are exemplary; inference is absent and one design confound is undisclosed | Yes |
| Evidence Sufficiency | PARTLY_MEETS | W1 (paired tests), W3 (coverage), S2 | Evidence exists for stronger conclusions than stated (hybrid significance) and weaker support than stated (trained-format ordering) | Yes |
| Argument Coherence | PARTLY_MEETS | W2 (conclusion vs Table 3), claims item 3 | Strong hedges in §7 are dropped by conclusion and claims section | Yes |
| Writing Quality | MEETS | S6 | Honest, scoped, self-limiting prose; isolated overreach items in W2, W5 | No |
| Significance & Impact | PARTLY_MEETS | W1, W3 | The retrieval-index and routing results are solid and useful; the composition training-benefit claim needs the repairs above before it can carry weight | Yes |
| Originality / Literature Integration | NOT_ASSESSED | | Out of seat scope | No |

**Recommendation rationale**: The unresolved decision-bearing criteria are Methodological Rigor (no test, CI-overlap inference, W1), Evidence Sufficiency (composed-arm coverage confound, W3), and Argument Coherence (conclusion overclaims against its own Table 3, W2). All are repairable from committed rows by rewrite plus arithmetic already possible; none requires a new measurement, though a coverage-matched sensitivity run would and should remain flagged as such. Major Revision, re-review after revision.

---

Seat disclosure: no independent reproduction of model runs; all recomputation was from committed rows. Based on the 60 committed questions of one estate.
