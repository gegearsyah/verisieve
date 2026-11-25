# Editorial Decision

## Manuscript Information
- **Title**: How Training Data Should Look: From Stitched Chunks to Records That Know What They Describe
- **Manuscript ID**: paper/versieve-graph-grounded-enterprise-corpus.tex (MLSys 2025 style, accepted mode; no venue confirmed)
- **Review Date**: 2026-11-25
- **Decision Date**: 2026-11-25
- **Review Round**: Round 1 (panel review, paper 4)
- **Panel reports**: docs/review/paper4-round1/seat-1-journal-fit.md through seat-5-devils-advocate.md (attached by reference, not re-pasted)

---

## Decision

### Major Revision

Substantial revision and re-review required. No new science is demanded by the panel; nearly all repairs are prose and arithmetic on numbers already committed to checked-in artifacts. Three seat reports (Seats 1, 2, 4) recommend Major Revision; Seat 3 recommends Minor Revision; Seat 5 (Devil's Advocate) raises two CRITICAL findings, one of which is validated on direct verification. The measured core (Table 3, the erasure receipts, the CI chain) reproduces exactly, but the framing layer, the inferential section, one design disclosure, and the compliance-facing claim boundaries must be repaired before the manuscript can carry its claims.

---

## Review Panel Provenance

This panel's provenance is recorded in this letter rather than by script. The installed marketplace copy of the academic-paper-reviewer plugin ships no scripts directory, so the advisory check scripts and the panel-provenance schema validator did not run in this install (see Appendix). No typed provenance artifact with SHA-256 pins exists for this panel; the values below are recorded from the dispatching session's setup and are rendered without inference.

| Seat | Role | Context | Peer outputs visible | Model family | Human reviewer |
|---|---|---|---|---|---|
| 1 | Journal-Fit Reviewer (EIC) | Fresh, session-local | None before committing | sonnet | none |
| 2 | Peer Reviewer 1 (Methodology) | Fresh, session-local | None before committing | sonnet | none |
| 3 | Peer Reviewer 2 (Domain) | Fresh, session-local | None before committing | sonnet | none |
| 4 | Peer Reviewer 3 (Cross-disciplinary/Practical) | Fresh, session-local | None before committing | sonnet | none |
| 5 | Devil's Advocate (fixed seat) | Fresh, session-local | None before committing | sonnet | none |

| Provenance axis | Status |
|---|---|
| Role-separated | true |
| Within-panel invocation-context separation (fresh context) | true |
| Blind to peer outputs | true |
| Model-family distinct | false (all five seats: sonnet) |
| Provider distinct | false |
| Human-reviewer distinct | false |

- **Binary independence claim**: Not computed. Role diversity proves only role separation. This panel is not a set of independent reviewers and is not described as one anywhere in this letter.
- **Correlated-error disclosure (required, model-family axis)**: All five seats ran on one model family (sonnet), each in a fresh context, peer-blind. Role separation is real but is not statistical independence. Shared training priors mean the seats can fail in correlated ways: a misreading inherited from the same priors could appear in several reports and still look like multi-seat consensus. Corroboration counts in this letter therefore measure agreement across roles within one model family, not independent estimates of the same fact. The decision's most load-bearing findings are additionally anchored to verification outside the panel: the Editorial Decision directly verified the "every stratum" claim against Table 3 of the manuscript text, and one seat (Seat 2) independently recomputed all ten arm rows and all eight Clopper-Pearson intervals from committed per-question artifacts with a fresh script. The truncation-coverage arbitration in this letter was verified against the manuscript text by the synthesizer.

---

## Blocking Issues

| Transport ref | Blocking issue | Source reviewer(s) | Evidence anchor | Resolving roadmap item |
|---|---|---|---|---|
| BL1 | The trained-format ordering is overstated against the paper's own table: "wins on every stratum" and its conclusion-grade "real" version are contradicted by Table 3's exact Q1 and Q2 ties (composed 8.3 vs 8.3, 12.5 vs 12.5) | DA Issue 1 (validated), R1-Methodology W2, EIC W1 | `table: Table 3, composed vs per-block Q1 8.3/8.3, Q2 12.5/12.5` | R1, R2 |
| BL2 | The inferential apparatus reads overlapping 95% intervals as a test in both directions, while the paired structure makes exact McNemar available from committed rows; and the equal-token budget is executed by head truncation whose per-arm coverage and selection rule are not disclosed in the manuscript | R1-Methodology W1, W3 | `text: §7 "Uncertainty at n=60" "statistically indistinguishable"; abstain: design paragraph, no kept-row denominators` | R3, R6 |
| BL3 | The compliance-facing claim boundaries are incomplete where the claims are strongest: the abstract and conclusion read the pending adapter half as complete, the vault's disposition under erasure is unstated, the readable view's certificate behavior is unstated, and Article 17 is presented as settled model-extending law | EIC W2, R3-Practical W1, W2, W3, DA Issue 4 | `text: Abstract "completing the erasure path"; §9 "must extend to models trained on it"` | R7, R9, R10, R11 |

---

## Reviewer Summary

| Reviewer | Role | Recommendation | Confidence |
|----------|------|---------------|------------|
| Journal-Fit Reviewer | Senior scholar, ML systems for NLP, benchmark-artifact practice | Major Revision | 4 |
| Reviewer 1 | Methodology: small-sample inference for paired binary evaluation | Major Revision | 5 |
| Reviewer 2 | Domain: retrieval/cache-augmented generation, training-data curation | Minor Revision | 4 |
| Reviewer 3 | Cross-disciplinary: applied privacy and data-protection engineering | Major Revision | 4 |
| Devil's Advocate | Fixed adversarial seat | N/A, findings only | N/A, per-finding only |

---

## Consensus Analysis

### Points of Agreement (Consensus)

**[CONSENSUS-4]** (all four scoring reviewers agree):
1. **The measured core reproduces exactly and the receipt infrastructure is exemplary.** Seat 1 S1 verified the 993-check CI chain and the artifact-pinned number provenance; Seat 2 S1/S2/S8 independently recomputed all ten Table 3 rows and all eight Clopper-Pearson intervals with a fresh script, plus the canary exposure range and the judge-agreement range; Seat 3 S1/S3/S6 verified the erasure byte arithmetic, all ten arm rows, the failure-mode ladder, and the hub-duplication block; Seat 4 S4/S5 verified the zero-egress receipt and the byte-exact erasure receipts. This strength is the reason the decision is a revision and not a rejection.
2. **The pending GPU half of the erasure path is honestly marked where the sections report it.** Seat 1 S5 and Seat 4 S2 both independently cite the same discipline (no placeholder values, pending-gpu structuring, exclusion from all tables) as correct artifact-evaluation behavior. The consensus on the section-level behavior does not extend to the abstract and conclusion, where the completion wording is contested (R7).

**[CONSENSUS-3]** (3 of 4 scoring reviewers; the fourth silent):
1. **The abstract is a single roughly 580-word paragraph carrying most of the paper's numbers and cannot be compressed by the reader.** EIC W3 (Major), R1 (title and abstract comments: high number-to-receipt density, two scoping gaps), R2 (title and abstract comments: roughly thirty numbers verified, density at the edge of readability). DA Issue 9 raises the adjacent precision-presentation point (four decimals on n=24). None of the four disputes the density finding.
2. **The router scoping ("routing consumes a correctly resolved identity rather than doing retrieval") is present and honest wherever it is stated.** R1 (abstract comment: properly scoped), R2 (abstract comment: scoping clause noted), R3 S6 (explicitly a strength). Seat 1 is silent on this specific point. The DA disputes the sufficiency of this scoping for the abstract and conclusion; that disagreement is adjudicated under DA CRITICAL 2 below.
3. **The measured hierarchy is stated plainly even where it does not flatter the design:** trained formats lose to training-free retrieval, and a lexical BM25 control ties or edges the graph retriever. EIC S2, R1 S3 and results comments, R2 S3. This is the paper's best register and is retained as-is.

### Below the Consensus Bar

**[CORROBORATED]** (2 scoring reviewers, none disputes; DA counts as corroboration, not as an independent vote):
1. **The "wins on every stratum" claim is false against Table 3.** R1-Methodology W2 states the ties directly; DA Issue 1 states the same sub-claim with the same table cells; the synthesizer verified the manuscript directly (Table 3: composed and per-block tie at 8.3 on Q1 and 12.5 on Q2; the only strict separation is Q3, 16.7 vs 8.3, one question). EIC W1 carries the adjacent conclusion-level drift ("real"). DA-corroborated, plus direct table verification. Basis of BL1.
2. **Section and table taxonomies blur the ten-arm structure.** R2 W5 (heading says six arms, table carries ten rows including the headline arm), EIC W4 (K3/K7/Stage K5 labels undefined) and the six-arm heading note. Basis of S3.

**[SINGLE-REVIEWER]** (raised by one scoring reviewer, none disputes; criterion and anchor decide):
1. **Vault disposition under erasure** (R3-Practical W1, Major). The DA's missing-stakeholder section notes the adjacent concern (who benefits from the flagship property) but does not state this sub-claim. Elevated to the roadmap on criterion: the erasure path is the artifact's load-bearing compliance property. Basis of R9.
2. **Readable-view certificate behavior and access boundary** (R3-Practical W2, Major). No other seat examined the readable view's certificate semantics. Basis of R10.
3. **Truncation coverage disclosure** (R1-Methodology W3, Major), seconded by the arbitration below. Basis of R6.
4. All remaining minor findings below are single-seat items with anchors; the panel record carries no dispute of any of them.

### Points of Disagreement

**Disagreement 1: Truncation-coverage disclosure adequacy (R1-Methodology W3 vs R2-Domain, Methodology detailed comments)**
- **R1 (Seat 2) view**: (Major) The composed arm trains on 41 of 1,106 samples (3.7% coverage) under head truncation; the fraction, the denominator, and the head-order selection rule are undisclosed. The format comparison is a cap comparison, not a coverage comparison, and the artifact's per-arm kept-row counts (flat 100 of 178, per-block 194 of 216, composed 41 of 1,106, pairs 50 of 3,322, vaulted 216 of 216) are nowhere in the manuscript. The true composed-versus-per-block effect at fuller coverage is unmeasured.
- **R2 (Seat 3) view**: "The equal-budget rule and its consequences are disclosed where they matter: §7 states the composed corpus trains on 41 rows and 23,608 learnable tokens under the shared budget, against 194 rows for per-block". Seat 3 adds that kept-entity coverage survives truncation comparably (908 vs 1029 per the receipt) and concludes the disclosure is adequate.
- **Disagreement type**: Severity disagreement (both seats agree the design fact exists; they disagree on whether the manuscript text is adequate).
- **Synthesizer verification against the manuscript text**: §7 "The design" states only "one budget of 25,755 training tokens each" and never mentions truncation. §7 "The reading" states "until only 50 rows with 9,947 learnable tokens survived (against 41 rows and 23,608 learnable tokens for composed alone)". So: the 41-row count for composed is disclosed (Seat 3 is right about that); the 1,106-row denominator is not in the manuscript; the 3.7% fraction is not; per-block's 194-of-216 coverage is not (Seat 3's parenthetical "against 194 rows for per-block" does not appear in the manuscript, only in the artifact; Seat 3's citation of it is an artifact citation, not a manuscript citation); the head-order selection rule is not; and the kept-entity counts (908 vs 1029) are artifact-side only. A reader of the manuscript alone cannot compute per-arm coverage, cannot learn that per-block trains on nearly all of its corpus while composed trains on a small slice of a much larger one, and cannot learn that the surviving slice is the corpus's head prefix.
- **Editor's Resolution**: Seat 2's core point stands; Seat 3's factual contribution is incorporated but does not neutralize the finding. Disclosure of "41 rows" without its denominator does not let a reader see the comparability confound, and the entity-coverage counter-evidence is nowhere in the manuscript text. The format ordering must restated as conditional on this truncation regime, with the per-arm kept-row counts and the selection rule disclosed.
- **Resolution Rationale**: The text is what the reader reads; the artifact is not load-bearing for disclosure claims the manuscript makes. This is a severity disagreement resolved by direct text verification: the denominator and the selection rule are absent from the text, so the disclosure is materially incomplete. Tracked as R6 (disclosure), and the coverage-matched comparison is parked as a gated measurement (G3), not required prose.

**Disagreement 2: Overall severity (R2's Minor Revision vs the three other scoring seats' Major Revision)**
- **R2 view**: Single-sentence repairs on Argument Coherence are the only decision-bearing defects; measurements unaffected.
- **R1, EIC, R3 view**: Repairable-without-new-science but substantial, spanning inference, disclosure, abstract, and compliance boundaries.
- **Disagreement type**: Severity disagreement.
- **Editor's Resolution**: Major Revision.
- **Resolution Rationale**: R2's seat scope (literature and domain accuracy) simply did not surface the inference, coverage, and privacy-boundary findings; her single most load-bearing criterion (Argument Coherence) is itself PARTLY_MEETS in her own table. With one validated DA CRITICAL on the table and three seats at Major across disjoint non-overlapping grounds, the union of decision-bearing defects is large even though each is individually repairable. No seat's recommendation is discounted; the union governs.

**Disagreement 3: Sufficiency of the 81.7% router scoping (DA vs R1, R2, R3)**
- **DA view (Issue 2, CRITICAL)**: A headline number conditioned on resolving the very problem the paper declares open is a CRITICAL unsupported premise, not a prose caveat.
- **R1, R2, R3 view**: The scoping is present, honest, and repeated at every stated recurrence.
- **Disagreement type**: Severity disagreement over the same anchor.
- **Editor's Resolution**: See the DA CRITICAL adjudication section. Spoiler: rejected as CRITICAL, retained as a required placement-and-calibration item.

---

## Devil's Advocate CRITICAL Adjudication

Both DA CRITICAL rows are adjudicated here in visible form, as required.

### DA CRITICAL 1: "Wins on every stratum" contradicted by the ten-arm table. VALIDATED.

- **The claim under test**: §7 "The reading" states "the design's ordering holds on every stratum: composed (11.7%) over per-block (10.0%) over flat (6.7%)"; §10 item 3 and the conclusion state "composition wins over per-block and flat formats on every stratum".
- **Adjudication evidence**: Verified directly against the manuscript's Table 3 by the synthesizer: on Q1, composed and per-block tie at 8.3 against 8.3; on Q2, they tie at 12.5 against 12.5; the only strict separation between them is Q3, 16.7 against 8.3, one question out of twelve. Against flat, composition is strictly above on all three strata. Two seats independently corroborated before the panel closed: R1-Methodology W2 reads the same ties from the artifact rows, and EIC W1 carries the conclusion-level version of the drift. The dispatcher's direct table verification plus two independent seat recomputations is three-source agreement on a fact readable from the paper's own central table.
- **Effect on the decision**: This finding alone blocks acceptance: it is the paper's eponymous claim, and the strict form of it is false. It is, however, repairable in prose without any new measurement, because the honest form of the claim survives untouched (never behind on any stratum, leads only on the disambiguation stratum by one item, within noise at stratum sizes of 24, 24, and 12). Tracked as R1 and R2. Note on anchoring: the DA cites the ten-arm table as "Table 2"; in the manuscript it is Table 3. The table number mis-anchor does not affect the finding; the cells cited are correct.
- **Note on the DA's wider beam** ("a lexical retriever does everything the stack is measured to do"): the DA's own non-defect list concedes the honest reading; the 4.6x trained-versus-retrieval separation is interval-backed and the paper states it. The beam's rhetorical conclusion overreaches its own premise set, but the two CRITICAL rows under it survive in calibrated form. The synthesizer records the beam as rejected-what-is-unargued and validated-what-is-table-backed, per row.

### DA CRITICAL 2: The 81.7% headline arm is oracle-conditioned on a problem the paper declares open. REJECTED AS CRITICAL; RETAINED AS A REQUIRED CALIBRATION ITEM IN WEAKENED FORM.

- **The claim under test**: The strongest arm receives the asked person's correctly resolved identity from the manifest, on an estate where the paper measures exact-match resolution at a 24.27% pairwise recall floor; the number still leads the abstract and conclusion.
- **Adjudication evidence**: The DA's factual basis is correct and verified in the manuscript (§7: "the arm scores routing given a correct resolution, not resolution itself"; the 24.27% floor is stated in §5 and in §7's estate paragraph). But the DA's CRITICAL framing asserts the number leads "with the scoping... as a prose caveat"; the manuscript does more than caveat. The abstract's own sentence carrying 81.7% carries the scoping in the same breath: "routing each question to the asked person's records, the graph-as-router reading, answers 81.7%, the strongest arm measured, with the scoping that routing consumes a correctly resolved identity rather than doing retrieval". Three of four scoring reviewers recorded this scoping as a strength (CONSENSUS-3 above), and no scoring reviewer found any recurrence where the resolution dependence is dropped. The premise is disclosed, not hidden; a disclosed oracle-conditioned headline is a claim-calibration question, not an unsupported premise.
- **What survives**: The residual is real and is tracked. The conclusion's recurrence of 81.7% is thinner than the abstract's (it names the prefill mechanism but not the resolution dependence), and §9's own K5 line makes the dependency chain explicit without the conclusion carrying it. The repair is required and prose-only: the conclusion's router sentence must carry the same resolution-dependence the abstract carries, and the abstract must keep the scoping clause adjacent to the figure (R2 also asks for adjacency). This resolves Disagreement 3: the DA is right that the premise is load-bearing, wrong that it is unsupported; the calibration item stands in R1's cluster.
- **Effect on the decision**: Alone it would not block acceptance, since the scoping exists at the load-bearing recurrences. It does not change the decision, which is already Major Revision on the validated CRITICAL 1, Seat 2's inference and coverage findings, and Seat 4's boundary findings.

---

## Decision Rationale

The decision is a Major Revision because the manuscript's strongest material (the receipt infrastructure) and its weakest (the frame layer's claim placement) are both real, and neither can be left as is. Three grounds, none requiring new science:

1. **The conclusion and claims section make a strict claim the paper's own table refutes.** "Winning on every stratum" fails on two of three strata with the strata as printed (validated DA CRITICAL 1; R1-Methodology W2; EIC W1). The honest weak ordering survives on the same numbers; the repair is rewrite-only.
2. **The inferential section uses interval overlap as a hypothesis test in both directions while the paired data license exact tests that change the reading in opposite directions.** R1's recomputed McNemar results (seat-computed arithmetic from committed per-question rows, not published manuscript numbers) show the hybrid control is significantly better than all three retrieval/cache arms, which the interval language leaves ambiguous, while the paper's "statistically indistinguishable" tie claims rest on the wrong arithmetic. R1's W3 truncation-coverage confound, verified against the text in Disagreement 1, makes the trained-format comparison a cap comparison whose coverage structure the manuscript does not reveal.
3. **The compliance-facing boundaries are incomplete where the claims are strongest.** The abstract reads the pending adapter half as complete (EIC W2, DA Issue 4, adjacent), the vault and readable view carry no stated disposition or certificate behavior (R3 W1, W2), and Article 17 is asserted as settled model-extending law (R3 W3).

Why not Minor Revision: R2's Minor recommendation is respected on its own seat scope; the union across seats is broader than her seat saw. Why not Reject: every decision-bearing defect is repairable from committed rows and receipts, all four scoring seats verified the core numbers as reproducing exactly, and the artifact discipline (CI chain, anti-circularity notes, pending-structure honesty) is above common practice. The revision must, however, re-trip the re-review gate, because two of the three grounds change what the abstract and conclusion claim.

Disagreements 1 and 3 are resolved above with text-verified arbitration; Disagreement 2 by union of seat scopes.

---

## Required Revisions

Grouped by theme. The Reviewer Summary column carries seat attributions. Every item carries the house-discipline flag per the author's standing rule: any change putting a new number in the paper must derive that number through the CI checker chain (artifact-derived needles in scripts/check-paper-numbers.mjs, artifact plus paper plus checker in one commit); items needing unmeasured numbers are parked as gated measurements, not prose. None of the required items below requires a new artifact.

**Theme A. Claim calibration (the trained-format ordering and the router)**

**R1: Rewrite the conclusion's claim sentences to the interval-backed form.**
- **Problem**: The conclusion states the training-format benefit "is real and must be claimed at the scale it was measured" and "composition wins over per-block and flat formats on every stratum by small margins"; the §8-adjacent uncertainty paragraph shows the composed and per-block intervals overlapping heavily at n=60 (11.7%, 4.8 to 22.6 vs 10.0%, 3.8 to 20.5) and the table shows exact ties on Q1 and Q2.
- **Source**: EIC W1; R1-Methodology W2; DA Issue 1 (validated; see adjudication).
- **Requirement**: Replace "real" and "wins on every stratum" with the form R1 proposes: the entity graph pays off as a retrieval index and router at this scale; composition's format benefit is never behind per-block on any stratum, leads only on the disambiguation stratum by one item, and is within noise at these stratum sizes, with overlapping intervals at n=60. The abstract, §10 item 3, and the conclusion must then state the calibrated claim identically once each.
- **House flag**: prose-only, numbers already committed.
- **Acceptance criteria**: No sentence in abstract, §10, or the conclusion asserts a strict per-stratum win over per-block; the three locations carry one consistent calibrated wording.

**R2: State the weak ordering strictly in §7, §10 item 3, and the abstract.**
- **Problem**: §7's "the design's ordering holds on every stratum" is a weak-ordering sentence decorated with all-60 percentages in a way that invites the strict reading; the abstract's "the best trained format" carries no one-measurement caveat.
- **Source**: R1-Methodology W2; DA Issue 1.
- **Requirement**: Keep the weak ordering but say it in weak-ordering words at the point of the stratum cells; add the small-margin, one-measurement caveat to the abstract's best-trained-format sentence.
- **House flag**: prose-only, numbers already committed.
- **Acceptance criteria**: A reader cannot derive "wins everywhere" from the §7, §10, or abstract text.

**R3: Add exact paired tests for the narrated comparisons and rewrite the tie and separation sentences.**
- **Problem**: No statistical test is run; overlapping 95% intervals are read as "statistically indistinguishable" and non-overlap as separation. The arms are paired (same 60 questions), so exact McNemar is computable from the committed rows. R1's seat-computed results (from committed rows, not manuscript numbers): the tie claims survive but on the wrong arithmetic (BM25 vs Graph-PPR p=0.39, CAG vs Graph-PPR p=1.00, composed vs per-block p=1.00), and the hybrid arm is significantly better than BM25 (p=0.0146), Graph-PPR (p=0.0023), and CAG (p=0.0001), which the interval language leaves ambiguous.
- **Source**: R1-Methodology W1.
- **Requirement**: Add exact McNemar (or equivalent paired) tests for the comparisons the paper narrates, with a multiplicity note (Holm over the narrated set); rewrite the "Uncertainty at n=60" sentences to cite the paired tests. The understate-and-overstate asymmetry must land: the paper's strongest result gets its actual support.
- **House flag**: requires CI-needle addition (committed numbers; new computed statistics derived from committed per-question rows through the checker chain in one commit).
- **Acceptance criteria**: Every inferential sentence in §7's uncertainty paragraph traces to a paired test recomputed by a checker needle; the checker passes.

**R4: State the sampling frame of the intervals.**
- **Problem**: The 60 questions are an authored manifest partition, not a random sample; the Clopper-Pearson intervals are presented without stating what they quantify uncertainty over.
- **Source**: R1-Methodology W7.
- **Requirement**: One sentence: the intervals quantify sampling uncertainty with the 60 authored questions as the only randomization and say nothing about other estates or question processes; cross-estate claims are the open K5 line.
- **House flag**: prose-only, numbers already committed.
- **Acceptance criteria**: The superpopulation question is answered in the paragraph that presents the intervals.

**R5: Frame the cache arm's selection rule as an eval-informed bound.**
- **Problem**: The fixed-cache arm's 8 records were selected by greedy set-cover over the 52 unique question persons, so the cache is optimized against the evaluation population; this is disclosed in one clause and not framed as a validity condition on the arm's reading, including the per-stratum contrast the analysis draws from it.
- **Source**: DA Issue 5 (MAJOR).
- **Requirement**: One clause upgrade in §7: name the selection as question-population-informed and state that the arm's percentage is an eval-informed upper bound for this arm, not a deployment-realizable number; carry the same qualification into any sentence reasoning from the cache arm's per-stratum behavior.
- **House flag**: prose-only, numbers already committed.
- **Acceptance criteria**: No reading of the cache arm proceeds from its percentage without the eval-informed qualifier.

**Theme B. Disclosure (truncation coverage, erasure-path completion, Layer R)**

**R6: Disclose the per-arm truncation coverage and the head-order selection rule.**
- **Problem**: The equal-token budget is executed by deterministic head truncation; the manuscript states "one budget of 25,755 training tokens each" and discloses only the composed arm's 41-row and 23,608-token survival in the pairs-arm displacement sentence. The 1,106-row denominator, the per-arm kept-row shares (flat 100 of 178, per-block 194 of 216, composed 41 of 1,106, pairs 50 of 3,322, vaulted 216 of 216), and the head-order rule are not in the manuscript. Disagreement 1 adjudicates this as materially incomplete.
- **Source**: R1-Methodology W3; arbitration of Disagreement 1; R1 question 1 (whether the truncation policy predates results is a disclosure-vs-sensitivity question, see Q1 in the authors' list).
- **Requirement**: In the design paragraph plus a Table 3 footnote: state the truncation rule and the five per-arm kept-row counts, and restate the trained-format ordering as conditional on this truncation regime. State kept-entity coverage only if quoted from the artifact through the checker (it is a committed number).
- **House flag**: requires CI-needle addition (committed numbers).
- **Acceptance criteria**: A reader can compute per-arm coverage from the manuscript and the ordering carries the truncation-conditional qualifier wherever stated.

**R7: Repair the erasure-path wording in the abstract, conclusion, and §1.**
- **Problem**: The abstract's "with a sealed LoRA retrain recipe completing the erasure path for the adapter trained on it" reads as the property being complete; the conclusion claims the records "are worth building for erasure" without scoping which half is measured; §1's "each is a measured receipt rather than an adjective" covers a property whose adapter half is explicitly pending.
- **Source**: EIC W2; DA Issue 4; R3-Practical detailed comments (adjacent, defensible-but-flagged).
- **Requirement**: Word the abstract at the recipe level the §9 and Table 2 captions already support (specified to complete, with the three adapter measurements pending and shown nowhere); add one scoping clause to the conclusion's erasure sentence; in §1, state that the corpus half is measured and the adapter half is a structured pending recipe. All repairs at the recipe level are prose-only; the alternative repair (measuring the three pending adapters to earn the completion wording) is G1 and is not required.
- **House flag**: prose-only, numbers already committed.
- **Acceptance criteria**: Abstract and conclusion contain no completion wording for the erasure path beyond what §9 and the Table 2 caption support.

**R8: Repair the Layer R explanation to match its own measured numbers.**
- **Problem**: §8 explains the Layer R floor (100% recall at 22.79% precision) with "collapses nothing by design there", while the artifact records the mechanism as massive collapsing (over-merging of verbatim-repeating role labels, 7,449 mentions resolved into 21 string groups). The paper's explanation contradicts its own number. This is elevated from R2's Minor at editorial discretion because it sits in the paper's disclosure layer.
- **Source**: R2-Domain W3.
- **Requirement**: Rewrite the sentence to state the actual mechanism: exact-match transitive closure merges every verbatim-repeating surface, distinct speakers in different meetings collapse into one group, which yields full recall at 22.79% precision; align the artifact's note in the same pass.
- **House flag**: prose-only, numbers already committed.
- **Acceptance criteria**: The §8 explanation is mechanism-consistent with the artifact's false-merge counts.

**Theme C. Privacy and compliance boundaries**

**R9: State the vault's disposition under erasure.**
- **Problem**: The erasure receipts cover corpus regeneration and (pending) the adapter, but the manuscript never states whether eraseEntity removes the erased subject's vault entries and salt or retains them; the vault is where unmasked values and salts live, and the salt table is a re-identification key for every placeholder in the surviving corpus.
- **Source**: R3-Practical W1 (Major).
- **Requirement**: One paragraph in §9 or a sentence in §10 stating the disposition explicitly: deleted with a receipt if implemented, or stated as a boundary of the claim with the retention rationale (for example, preserving cross-modal linking for non-erased subjects) and the retained salt's protection. If a receipt for vault erasure already exists, cite it; if a number is quoted, it goes through the checker chain.
- **House flag**: prose-only, numbers already committed (any quoted receipt number via CI needle).
- **Acceptance criteria**: eraseEntity's vault behavior is stated in the manuscript and its status (receipted or boundary) is unambiguous.

**R10: State the readable view's certificate behavior and the opt-in control surface.**
- **Problem**: §4 specifies what the readable opt-in emits and for whom, but not what the conformal gate does in that view (runs on unmasked content with no placeholders to subtract, fails by construction, or does not run) and not the authorization or audit property of the flip. Meanwhile the flagship comparison and strongest arm run on the readable view.
- **Source**: R3-Practical W2 (Major).
- **Requirement**: Two sentences in the §4 identity paragraph: the gate's behavior under the readable view, and the explicit opt-in as the sole control surface recorded in the receipt. Statements of existing mechanism only.
- **House flag**: prose-only, numbers already committed.
- **Acceptance criteria**: An operator can answer "does the certificate still apply when readability is on" from the manuscript.

**R11: Recharacterize the GDPR Article 17 grounding.**
- **Problem**: §9 opens with "Under GDPR Article 17, erasure of personal data must extend to models trained on it", asserted as settled law; the question of how Article 17 reaches a model is open in applicable guidance, and the regulation's qualifying grounds and exemptions, plus controller-level determinations, are outside the artifact's receipts.
- **Source**: R3-Practical W3 (Major).
- **Requirement**: Reword to a cautious characterization (R3's proposed wording is acceptable): Article 17 gives data subjects a right to erasure whose application to trained models is an open regulatory question; the artifact provides the receipts a controller would need to honor such a request for the corpus and the adapter, with the adapter half pending.
- **House flag**: prose-only, numbers already committed.
- **Acceptance criteria**: §9 asserts no settled-law model-extension requirement; the receipts' role is stated as support, not settlement.

**Theme D. Presentation (abstract and tables)**

**R12: Restructure the abstract.**
- **Problem**: A single roughly 580-word paragraph carries more than 25 inline numeric values across two estates, three training-free arms, five trained arms, certificate bounds, erasure fractions, and duplicate counts; the reader cannot state in one sentence what was built and what was learned. Three seats and the DA converge here.
- **Source**: EIC W3 (Major); R1 abstract comments; R2 abstract note; DA Issue 9 (precision-presentation part).
- **Requirement**: Restructure per EIC's plan, roughly 200 words: deficiency in two sentences; the artifact in two sentences; the three headline measured results in three sentences (retrieval 53.3%, best trained format 11.7% with the calibrated caveat from R2, strongest arm 81.7% with the scoping adjacent to the figure per R1's W2-related note); one sentence on erasure carrying the R7 scoping; one sentence of boundaries. Certificate and near-duplicate numbers move to §5 and §6 where they are already discussed. While restructuring, resolve the DA Issue 9 precision presentation: the four-decimal certificate figures (95.8333%, 81.7108%) should appear at two decimals in the abstract's register.
- **House flag**: prose-only, numbers already committed.
- **Acceptance criteria**: The abstract states the artifact and the finding hierarchy in a form a reader can restate; no number not already in the checker's needles appears.

**Theme E. Voice and register (author directives, binding)**

**R13: Re-voice the frame layer per the author's directives.**
- **Problem and directive (recorded verbatim as the author's register guidance)**: Value statements state value directly, with no meta-frames (the abstract's "measured, not promised" is a meta-frame) and no experiment-status commentary. No arguing with the paper's own earlier drafts: the defensive liturgy ("the scope note is binding" in §5, "recorded as it ran" as a heading and framing device, repeated per-section hedging invocations) is removed, with each boundary stated once, plainly, where the claim is made. The measured-first discipline (numbers never oversold, intervals carried) is unchanged; only the voice changes.
- **Source**: Author directive (binding); corroborated by EIC's §6 heading note ("Relational Composition: Built, Receipted, Measured" reads as a project log entry) and by DA Issue 4's framing complaint on "measured receipts".
- **Requirement**: Remove meta-frames and status commentary from the abstract and body; rename the §7 reading heading to a descriptive one; state each boundary exactly once at its claim site and delete its other invocations; apply R7's recipe-level wording so the boundary statements carry the load the liturgy was carrying.
- **House flag**: prose-only, numbers already committed.
- **Acceptance criteria**: No meta-frame sentence remains; each boundary appears once, at its claim site; the measured-first sentences are unchanged.

---

## Suggested Revisions

| Ref | Item | Severity | Source | Location | What to change | House flag |
|---|---|---|---|---|---|---|
| S1 | Add the stratum size to the abstract's 83.3% parenthetical ("the 24-question cross-document stratum") | major (transported minor) | R1-Methodology W4 | Abstract | One phrase | prose-only, numbers already committed |
| S2 | Replace K3/K7/Stage K5 labels in text with descriptive names; reserve stage IDs for the artifact; name the artifact file instead of "the spec"; define "receipt" once in §5; define "sealed" once | minor | EIC W4 | §2, §5, §7, Table 3 caption, §8, §10 | Prose repair | prose-only, numbers already committed |
| S3 | Rename "The Six-Arm Head-to-Head, Measured" and state the ten-row taxonomy in the opening sentence | minor | R2-Domain W5; EIC results note | §7 | Heading plus one sentence | prose-only, numbers already committed |
| S4 | Rename Table 2's "Span bytes removed" column to "Token span bytes" so body and column agree | minor | R2-Domain W4 | Table 2 | Column header | prose-only, numbers already committed |
| S5 | Fix the CAG regime clause: 16,607 tokens is below the cited 21k floor; say comparably-sized-but-below, or report the gap | minor | R2-Domain W1; R2 question 1 | §7, CAG paragraph | One clause | prose-only, numbers already committed |
| S6 | Distinguish the hybrid routing arm from the cited retrieval-fallback hybrid in the same sentence that cites the direction | minor | R2-Domain W2; R2 question 2 | §7, hybrid paragraph | One clause | prose-only, numbers already committed |
| S7 | Round the abstract's four-decimal certificate figures (95.8333%, 81.7108%) to two decimals in abstract register | minor | DA Issue 9 | Abstract | Prose rounding (R12 covers if adopted) | prose-only, numbers already committed |
| S8 | State in the Table 3 caption that judge columns are not comparable across the K3/K7 split and that no cross-arm judge analysis is made; mark empty judge cells as intentional notches | minor | R1-Methodology W6; R2 table note | Table 3 caption | Caption sentence plus cell marker | prose-only, numbers already committed |
| S9 | Qualify the 4.88% false-link generalization clause ("that is the regime real estates live in") to one estimate on one collision set | minor | DA Issue 8 | §5 cross-department linking | One clause | prose-only, numbers already committed |
| S10 | Reframe the vaulted ablation as a construction-consistency check of the identity-masking design, not as "the privacy cost quantified"; a utility-side privacy-cost measurement is G6 | minor | DA Issue 7 | §7 reading bullet 4 | Prose reframe | prose-only, numbers already committed |
| S11 | Define canary exposure (Carlini-style rank-based exposure in bits over the 12 planted canaries), add the rank-1 counts (8 of 12 trained vs 3 of 12 base), describe the held-out perplexity probe (10 generic paragraphs, 380 tokens, no estate content), and replace "degrades slightly" with the actual movement | minor | R1-Methodology W5 | §7 honesty boundaries | Two to three sentences | requires CI-needle addition (committed numbers) |
| S12 | Change "one budget of 25,755 training tokens each" to "capped at" (realized per-arm totals differ) | minor | R1-Methodology layout note | §7 design paragraph | One word | prose-only, numbers already committed |
| S13 | Enumerate or point at the nine trapped network surfaces and state the trap window (corpus seam covered; output emitted after traps restored) | minor | R3-Practical W6 | §3 | Footnote or sentence | prose-only, numbers already committed |
| S14 | Name the three implicit roles once each (readable-flip operator, exposed subjects, certificate-reliant operators while the adapter half is pending) | minor | R3-Practical W7 | §4 or §10 | Three sentences | prose-only, numbers already committed |
| S15 | Surface the per-class certified recall lower bounds (ADDRESS 36.84%, GITHUB_PAT 5%) or their range, noting class-level bounds degrade with rare classes | minor | R3-Practical W5; R3 question 4 | §5 detection and certificates | One sentence | requires CI-needle addition (committed numbers) |
| S16 | Citation housekeeping: cite or remove tan_lora_memorization; complete truncated author lists (fevry2020entities, wang2019kepler, shi2023incontext, hu_lora, bourtoule2020machine, zheng2023judging, wang2023fair) at camera-ready; consider adding a RAG-versus-fine-tuning lineage pointer (R2's suggestion, non-binding) | minor | R2-Domain minor issues; R2 related-work note | Bibliography | Bib edits | prose-only, numbers already committed |
| S17 | Repair the certificate boundary at the edges: conclusion's "clean at a stated confidence" to "bounded for residual detectable PII at a stated confidence"; §1's per-sample phrasing to note the certified figure is an estate-level bound | minor | R3-Practical W4 | §1, conclusion | Two phrases | prose-only, numbers already committed |
| S18 | Copyedit set: split the abstract's 60-word final sentence (moot if R12 adopted), Table 2 caption's clarifying phrase on 24-sample vs 23-of-24 counts, "at stated 95%" phrasing, the §5 quarantine-ambiguity clause, §7's K7-judges clause ("judges not run for these arms at scoring time"), the venue-style retargeting note | minor | EIC minor issues; R3 minor issues; R1 minor issues | Various | Copyedit | prose-only, numbers already committed |

---

## Revision Roadmap

### Source-traceability checklist

Required (obligation must_fix):

- [ ] R1, must_fix, Theme A: conclusion claim rewrite to interval-backed form. House flag: prose-only, numbers already committed.
- [ ] R2, must_fix, Theme A: strict weak ordering in §7, §10, abstract. House flag: prose-only, numbers already committed.
- [ ] R3, must_fix, Theme A: paired tests with multiplicity note. House flag: requires CI-needle addition (committed numbers).
- [ ] R4, must_fix, Theme A: interval sampling-frame sentence. House flag: prose-only, numbers already committed.
- [ ] R5, must_fix, Theme A: cache arm framed as eval-informed bound. House flag: prose-only, numbers already committed.
- [ ] R6, must_fix, Theme B: truncation coverage and selection rule disclosure. House flag: requires CI-needle addition (committed numbers).
- [ ] R7, must_fix, Theme B: erasure-path wording in abstract, conclusion, §1. House flag: prose-only, numbers already committed.
- [ ] R8, must_fix, Theme B: Layer R explanation mechanism rewrite. House flag: prose-only, numbers already committed.
- [ ] R9, must_fix, Theme C: vault disposition under eraseEntity. House flag: prose-only, numbers already committed (quoted receipt numbers via CI needle).
- [ ] R10, must_fix, Theme C: readable-view certificate and opt-in boundary. House flag: prose-only, numbers already committed.
- [ ] R11, must_fix, Theme C: Article 17 recharacterization. House flag: prose-only, numbers already committed.
- [ ] R12, must_fix, Theme D: abstract restructure. House flag: prose-only, numbers already committed.
- [ ] R13, must_fix, Theme E: frame-layer re-voicing per author directive. House flag: prose-only, numbers already committed.

Suggested (obligation should_fix or consider):

- [ ] S1 through S18 as tabled above; S11 and S15 require CI-needle additions (committed numbers), the rest are prose-only.

### Gated measurements (separate from required; none may enter the paper as prose before measurement through the check chain)

- [ ] G1: The three pending-gpu adapter erasure measurements (retrain versus scratch, SISA head-to-head, canary exposure pre and post retrain). Already structured pending-gpu. Measuring G1 earns the completion wording R7 currently softens (EIC W2 option b, DA Issue 4).
- [ ] G2: Trained-format comparison at a substantially larger token budget (DA Issue 6's 10x-budget demand); until then the calibrated caveat language stands.
- [ ] G3: Coverage-matched composed-arm comparison (for example, composed at the per-block arm's coverage) if the authors want the format effect deconfounded from truncation coverage (R1-Methodology W3 optional arm; explicitly not required).
- [ ] G4: A deterministic person-to-field roster-lookup baseline with no language model, for the single-attribute question regime (DA Issue 3).
- [ ] G5: DA's alternative-path arms: full-estate prefill, person-filtered BM25 over the same passage pool as the router control, and retrieval-augmented SFT as the trained-format competitor (DA ignored-alternatives list).
- [ ] G6: A utility battery the vaulted view can in principle answer (structure, counts, relations), if the vault privacy-cost claim is to be empirical rather than definitional (DA Issue 7).
- [ ] G7: Judge backfill for the three K7 arms if cross-arm judge comparison is ever wanted (R1-Methodology W6 option b; otherwise S8's caption sentence is the required path).

---

## Questions for the Authors

1. Which composed-sample head prefix survived the 25,755-token cap, and was the head-order truncation policy chosen before or after the composed arm's results were seen? (R1; determines whether R6 is disclosure-only or also a sensitivity question, in which case G3 applies.)
2. Do you accept adding exact paired tests for the narrated comparisons? If not, what is the stated basis for "statistically indistinguishable" at these intervals? (R1.)
3. Were the 60 manifest questions, and the four attribute families they key on (worksIn, ownsProject, titled, joinedOn), authored before the hybrid routing and roster-lookup designs were considered? Is a question-authoring description available for the paper? (R1; DA.)
4. When eraseEntity runs, what happens to the erased entity's raw values, salt, and vault entries: deleted with a receipt, or retained for linking? If retained, where does the limitation belong in the claim boundary? (R3.)
5. Under the readable identity view, does the conformal gate still run, and if so what does it bound when no masking has occurred? Is the same re-scan machinery applied to readable exports? (R3.)
6. Do you intend to measure the three pending-gpu adapter measurements before submission? If not, confirm R7's recipe-level wording is the intended form. (EIC; R3; DA.)
7. Do you intend to surface the per-class certified recall lower bounds (ADDRESS 36.84%, GITHUB_PAT 5%) in §5? (R3.)
8. §7 calls the 16,607-token CAG prefill inside the regime the CAG literature evaluates, and §2 reports that regime as 21k to 85k tokens: rewording intended, or is there a CAG source whose regime includes 16k? (R2.)
9. Is "collapses nothing by design" the intended description of a floor that produces over two million false merges on Layer R, or should the over-merging mechanism be stated? (R2.)
10. Will the abstract's 83.3% stratum figure carry its stratum size, and will the hybrid routing sentence carry the identity-keyed distinction from the cited fallback hybrid? (R1; R2.)
11. Should the K7 arms receive judge scores (G7), or will the caption state that no cross-arm judge reading is made and rely on exact match only? (R1.)
12. What do K3, K7, and Stage K5 denote, and will the table captions use descriptive names? (EIC.)
13. The DA's beam asks directly: if a person-filtered BM25 with the question's person string as a filter over the same 216-passage pool were run (G5), and reached the hybrid's 81.7%, what would remain of the graph's contribution to the strongest arm? The panel does not require this arm; the authors' answer positions how §7's router paragraph should pre-empt it. (DA, converted to a framing question.)

---

## Journal-Supplied Deadline

- **Exact deadline from source letter**: NOT PROVIDED. This is a pre-submission panel review with no venue confirmed; no deadline is inferred.

---

## Response Letter Instructions

Please respond to every roadmap item item by item, using the revision-response template. For each Required Revision: the response, the change, and the house-discipline flag (if a CI needle was added, name the artifact, the paper, and the checker in the same commit). For each Suggested Revision: adopted, or the reason for not adopting. For each Gated Measurement: will_address, wont_address, or not_on_point, with the note that no gated number may appear in prose before measurement through the check chain. Mark all changes in the revised manuscript.

---

## Closing

The reviewers found the receipt infrastructure exemplary and the measured core sound, and the same reviewers found the frame layer asserting more than the tables license at the three sentences a reader is most likely to carry away. Every decision-bearing defect is repairable from committed numbers; the repairs are concentrated in the abstract, the conclusion, §7, §9, §10, and the §4 and §5 boundary statements. The revision should also carry the author's own register directive, which asks for exactly the discipline the panel's findings point toward: value stated directly, boundaries stated once, plainly, where the claim is made. The panel looks forward to the revised manuscript, which will undergo another round of review.

---

## Appendix: Advisory Checks and Provenance Notes

- The plugin's advisory check scripts (acronym check, suggested-reference check, reviewer claim check) did not run in this install: the installed marketplace copy of the academic-paper-reviewer plugin ships no scripts directory. Advisory results are therefore absent from this letter, and no acronym, suggested-reference, or reviewer-claim verification is claimed.
- The panel-provenance artifact is recorded in the Panel Provenance section of this letter rather than by script, as noted there. No artifact SHA-256 pins exist for this panel; the table's values come from the dispatching session's setup.
- The template's three advisory attachment sections (suggested-reference check, reviewer claim check, acronym check) are left out per the template's own instruction; the dispatching session may append them after the decision is final.
- Seat-report anchoring correction: the DA's Issue 1 cites the ten-arm table as "Table 2"; in the manuscript it is Table 3 (the third table). The cells cited are correct and the finding is unaffected.
- Seat-computed arithmetic provenance: the McNemar values quoted in this letter (p = 0.0146, 0.0023, 0.0001 for hybrid versus BM25, Graph-PPR, CAG; p = 0.39, 1.00, 1.00 for BM25 versus Graph-PPR, CAG versus Graph-PPR, composed versus per-block) are Seat 2's computations from committed per-question rows. They are not published manuscript numbers and are cited here only as the evidential basis for R3.
