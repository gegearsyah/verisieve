# Review: "Records That Know What They Describe: A Deterministic Entity-Indexed Enterprise Corpus with Byte-Verified Erasure"

Panel: five role-separated seats (academic-paper-reviewer, academic-research-skills v1.11.1), one manuscript, MLSys main-track standard. Role separation is a division of reading labor, not an independent error process: one reviewer read everything, five voices wrote up what they found, and the editorial seats reconciled them. Claims of inter-seat independence in this document are not claims of independent sampling.

Manuscript: `paper/versieve-graph-grounded-enterprise-corpus.tex` (282 lines, 11 sections, 3 tables, 1 figure)
Bibliography: `paper/versieve-graph-grounded-enterprise-corpus.bib` (22 entries)

Binding author style rulings applied as review criteria: (a) no em-dashes; (b) title must hit the training-data question first; (c) each stated boundary stated once, plainly; (d) no arguing with past drafts or a prior scaffold.

## Coverage (what was read, what was not)

Read in full: the manuscript, the .bib, the .aux (all 22 citations resolved, no undefined references or citations), the LaTeX log (three overfull hboxes, no errors), the .blg (BibTeX clean, 22 entries used), and the abstracts of the three sibling papers in the same directory (`versieve-extraction-redaction-benchmark.tex`, `versieve-local-training-benchmark.tex`, `versieve-multimodal-sanitization-benchmark.tex`) to adjudicate companion-paper distinctness.

Arithmetic recomputed independently: every exact-match percentage reachable from the table (n=60: 32, 36, 31, 49, 7, 6, 4, 1, 2, 3, 20 correct), all eight Clopper-Pearson 95% intervals printed in Section 7, the certificate pass rate 23/24 = 95.8333%, the certified lower bound (81.7108% reproduces exactly as a one-sided 95% Clopper-Pearson lower bound on 23/24), all six per-class lower bounds (98.06, 94.88, 89.85, 86.09, 36.84, 5.00 all reproduce as 0.05^(1/n), i.e., one-sided with x = n), the composed/per-block/flat keep fractions (41/1106 = 3.7%), the 53.3/11.7 = 4.6x ratio, and the 50%-rate amplification factor 0.5512/0.0431 = 12.79.

Not read / not verifiable: the committed artifacts, per-question McNemar rows, CI checker, MinHash output, manifest and estate generators (none were provided alongside the manuscript); the four 2026-dated arXiv citations cannot be resolved from this reviewer's knowledge; the exact McNemar p-values were checked for internal consistency and plausibility, not recomputed from rows (no rows available).

## Seat 1 Journal-Fit

**Genuine strengths.** The paper answers a question upstream of most fine-tuning work (what should the training unit be, given identity and erasure constraints), which is a real MLSys readership question. The measurement discipline (paired McNemar over the full 60-question frame, no judge cherry-picking, failure modes measured rather than mentioned) is above the section's usual bar, and the honest labeling of the CAG set-cover arm as an evaluation-informed upper bound and of the hybrid router as conditional on correct resolution is exemplary in kind, if excessive in repetition (see C1).

**J1. MAJOR. The title violates binding ruling (b).**
Location: `\twocolumn[\mlsystitle{...}]` line 33 and `\hypersetup{pdftitle=...}` line 23.
Evidence anchor: "Records That Know What They Describe: A Deterministic Entity-Indexed Enterprise Corpus with Byte-Verified Erasure."
Why it matters: The settled title per the author's own binding ruling is "How Training Data Should Look: From Stitched Chunks to Records That Know What They Describe." The current title leads with a metaphor for the mechanism, not the training-data question, and leads the privacy word ("Erasure") in the subtitle, exactly what rule (b) forbids. It also front-loads a claim ("Byte-Verified Erasure") whose adapter half the paper itself marks pending (Sections 1, 9, Table 2 caption), so the widest-visibility sentence in the paper claims more than the evidence covers.
Minimum fix: adopt the settled title; if a second clause is needed, draw it from the training-data question, not the mechanism.

**J2. MAJOR. Companion-paper distinctness is asserted by silence rather than established by citation.**
Location: entire paper; most load-bearing at "from a prior 18-combination epoch and learning-rate sweep" (Section 7, "The design") and the certificate/Graph-PPR/canary machinery (Sections 3, 5, 7).
Evidence anchor: The bib contains no reference to the three sibling papers, yet (i) the "prior 18-combination epoch" is Paper 2's "18-adapter epoch and learning-rate grid," (ii) the Learn-Then-Test gatekeeper, Graph-PPR retrieval, Qwen2.5-1.5B-Instruct recipe, and two-judge protocol all first appear in Papers 1 and 2, and (iii) Paper 2 already reports the qualitative result "zero-training Graph-PPR significantly outperforms closed-book LoRA."
Why it matters: A main-track reader cannot tell what is new here versus published in the sibling submissions; the head-to-head's retrieval-beats-training result is a noisy-estate extension of Paper 2's headline, and duplicate publication of the same experimental grid across concurrent submissions is a desk-concern at any venue.
Minimum fix: cite the three companions in one positioning paragraph; state explicitly which receipts and which of the ten arms are new to this paper; drop or cite-inherit numbers already reported there.

**J3. MINOR. Abstract carries bookkeeping prose.**
Location: abstract, "its three GPU-dependent measurements pending, with no placeholder values shown."
Evidence anchor: same.
Why it matters: A build-management statement (nothing shown because nothing measured) is not abstract content; it reads as an internal experiment log artifact.
Minimum fix: "the adapter-side retrain measurements are pending" or drop entirely; the paper says it again properly at the claim site (Section 9).

## Seat 2 Methodology

**Genuine strengths.** This is the paper's strongest seat. The uncertainty paragraph is unusually good: CIs are correct to the decimal (all eight recompute exactly), and the paper states the 60 questions are a fixed authored frame, not a sample from a question population, so intervals quantify per-question variability rather than sampling error, which is the correct reading. Paired-binomial testing with Holm correction over declared comparison families, with every p recomputed by CI, is well above the norm. Canary construction (identical batch across arms, cross-arm comparability), truncation disclosure (kept-row counts per arm), and the coverage-is-part-of-the-protocol paragraph are all honest and specific.

**M1. MAJOR. Table 3 mixes two experimental runs with different scoring protocols, and the caption says so in a way that violates binding ruling (d).**
Location: Table 3 caption, "The three arms added by the second run (BM25, fixed-cache CAG, per-question hybrid routing) train nothing and were scored by exact match only, with no judges run at scoring time... their judge cells are intentional notches ($--$)."
Evidence anchor: same; repeated at Section 7, "Non-training controls," "with no judges run, on the same estate, rows, and base model as the other seven arms."
Why it matters: One results table with two scoring protocols makes the judge columns structurally non-comparable and exposes revision history in an unrevised paper. "Added by the second run" and "intentional notches" are arguments with an earlier scaffold of the experiment, which ruling (d) forbids; the reader should meet one protocol.
Minimum fix: either re-score the three non-training arms under the identical judge protocol, or present them in a separate table with the protocol stated once as design ("non-training arms are scored by exact match only"), and delete all run-provenance wording.

**M2. MAJOR. The recipe's selection process is not connected to any stated criterion, leaving a possible eval-set leakage hole.**
Location: Section 7, "The design," "sealed, meaning fixed before the head-to-head ran, from a prior 18-combination epoch and learning-rate sweep."
Evidence anchor: same. The identical grid appears in Paper 2's abstract ("An 18-adapter epoch and learning-rate grid confirms this protection is recipe-robust").
Why it matters: "Fixed before the head-to-head ran" fixes the recipe, but does not say what the sweep optimized. If any of the 18 combinations was selected using the same 60 manifest questions or the same estate, the head-to-head inherits selection on test. The paper's central null results (trained arms at or near base) could also be an artifact of a recipe tuned for a different objective (Paper 2's compliance QA).
Minimum fix: state the sweep's objective, the data it was selected on, and that the selection set is disjoint from (or identical to) the 60 eval questions, in one sentence at the recipe.

**M3. MAJOR. No artifact availability or version-pinning statement exists in the paper.**
Location:全文 (absent), most acutely Sections 5 and 7 where "checked-in artifacts by a CI check" and "SHA-pinned in the artifact" are asserted.
Evidence anchor: no URL, DOI, or repository commit hash appears anywhere in the .tex or bib; no checksum for the five WASM kernels that total "$388{,}797$ B"; no checkpoint revision for Qwen2.5-1.5B-Instruct or the two judge models.
Why it matters: The paper's epistemology is entirely artifact-based ("a receipt... is not a prose claim") while the artifacts themselves are unreachable by the reader. For MLSys, whose artifact track exists for exactly this, that is the gap between a measured claim and a story.
Minimum fix: one paragraph (or footnote) with the artifact repository, commit hash, engine-version hash values, per-kernel SHA-256, and model checkpoint identifiers.

**M4. MAJOR. The certificate's confidence bound convention is never stated, and the per-class bounds silently assume x = n.**
Location: Section 5, "Detection and certificates," "with a certified lower bound of $81.7108\%$ at the stated $95\%$ confidence" and the per-class list ("PERSON $98.06\%$ over $153$ detections...").
Evidence anchor: Recomputation: 81.7108% is the one-sided 95% Clopper-Pearson lower bound on 23/24; the two-sided 95% bound is 78.88%. Every per-class figure reproduces as 0.05^(1/n) with zero observed misses assumed among detections.
Why it matters: A reader applying the conventional two-sided reading gets 78.9%, a materially different certificate statement, and the per-class bounds are construction assertions (the scanner missed nothing against manifest truth, so the bound is over an assumed-perfect detection count), which the text does not say at the list.
Minimum fix: state once at first use: "one-sided 95% Clopper-Pearson bounds; the per-class bounds assume zero detected misses against manifest ground truth." See C3 for the repeated-boundary cleanup.

**M5. MINOR. Four internal-count inconsistencies.**
Locations and anchors: (i) "$76$ indexed entities" (Section 5, "Erasure") versus "24 ground-truth entities" (Section 5, first paragraph): identity is value-level (3 values per person), but 16×3+4+4 = 56, not 76; the denominator provenance is unstated. (ii) "composed $41$ of $1{,}106$" (Section 7 design) versus "$1{,}113$ samples" (Section 6.1, Hub duplication): the same corpus, two counts, no reconciliation. (iii) "an amplification factor of $14.32$" (abstract, Section 6.1) versus the displayed rates: 0.3214/0.0224 = 14.35; 14.32 may come from unrounded values, but as printed the factor and rates disagree. (iv) "all $16$ ground-truth people resolve to the same vault identifiers on the IT and business sides" (Section 5, Cross-department linking): the estate has four departments and links are claimed per (entity, department-pair); the linking verification is scoped to two departments while the 54/54 claim reads as estate-wide.
Why it matters: small denominators are this paper's whole risk surface; any denominator the reader cannot reconstruct undermines the claims built on it.
Minimum fix: give the 76-entity derivation; reconcile 1,106 versus 1,113 in one clause; recompute the factor from unrounded values or print the raw fractions; scope the person-resolution claim explicitly.

**M6. MINOR. One training run per arm, no variance over training.**
Location: Section 7, "The reading," "the margins are small, and 60 questions make every cell a handful of items."
Evidence anchor: single 160-step run per arm; no repeated-seed runs reported for the trained arms, PPL, or canary exposure.
Why it matters: at 7 versus 6 correct answers, training-side (data-order, adapter-init) variance is the plausible source of the composed/per-block ordering the abstract highlights.
Minimum fix: state single-run design plainly at the table; if determinism of the recipe over seed is claimed, say so with the seed variance measured or unmeasured.

**M7. MINOR. Table 1 carries no discriminative information and its caption half-acknowledges it.**
Location: Table 1 and Section 5, "Extraction fidelity," "Uniform high columns validate the construction, not generalization. The flat-text baseline scores 0 by construction... so the table is construction validation, not an extractor comparison."
Evidence anchor: every Versieve column is 100 or near-zero error against fixtures built to match.
Why it matters: a results table that cannot, in principle, disconfirm anything is decoration; the sibling Paper 3 demonstrates the authors can run real comparison baselines (Presidio, GLiNER, Gitleaks), which makes this table's non-comparability conspicuous.
Minimum fix: state once, plainly, "the fixtures were generated by the same code that defines the metrics; the table checks implementation, not extraction quality" (ruling c), and shrink the table or move secondary rows to the artifact.

**M8. MINOR. The false-merge ladder's rate-to-class mapping is under-specified and internally strained.**
Location: Section 6.1, "the 20 designed collision pairs always merged, plus a seeded prefix of disjoint random pairs, 0 to 72 merged person classes."
Evidence anchor: at a 25% rate of 72 classes the ladder would place 18 merged classes below the 20 always-merged pairs.
Why it matters: the 14.32x amplification headline sits on this ladder; a reader who tries to reproduce the rate grid cannot.
Minimum fix: give the exact function from rate to merged-class count (or merge-rate definition) in one sentence.

**M9. MINOR. Exact-match scoring on generative outputs is unspecified.**
Location: Section 7, "The design," "exact match against manifest values."
Evidence anchor: no statement of decoding constraints, normalization, or how free-form completions are matched to manifest values.
Why it matters: EM on generated text is protocol-sensitive; 60 questions at 53.3% versus 60.0% leaves the protocol as a possible confound between arms scored identically in name only.
Minimum fix: one sentence: decoding parameters and the normalization applied before EM.

**M10. MINOR. Judge columns carry almost no signal and are prominently displayed.**
Location: Table 3, Judge and Llama columns; Section 7, "whose row agreement ($6.7$ to $41.7\%$ across arms) is recorded."
Evidence anchor: trained-arm agreement of 6.7% between judges means the two judges effectively cannot agree on anything these arms produce.
Why it matters: publishing judge means alongside EM implies adjudication utility the numbers refute; the paper says "neither is cherry-picked," which is about fairness, not informativeness.
Minimum fix: move judge columns to the artifact with a one-line reliability statement at the table.

## Seat 3 Domain

**Genuine strengths.** The related-work paragraphs show real reading: the GraphGen distinction (grounding actual samples versus generating synthetic ones) is sharp and correct; the CAG paragraph engages the cited paper's own scoping and hybrid proposal rather than a strawman; the in-context-pretraining and Multi-News distinctions (resolved identity, receipts, no generative target) are accurate and to the point; claims about Carlini/Lukas memorization and the CLIOPATRA/LeakageBench framing of redaction-as-nonguarantee are positioned correctly. Coverage of SISA/TOFU and the retrieval-versus-long-context line (liu2023lost, li2024raglc) is accurate as described.

**D1. MAJOR. The certificate machinery's statistical citations are missing.**
Location: Section 3, "fixed-sequence Learn-Then-Test over the shipped binomial CDF kernel"; Section 3, "Certificates" bullet; Section 5 pass rates.
Evidence anchor: no citation for Learn-Then-Test (Angelopoulos, Bates, Candès, Jordan, Zrnic), conformal prediction generally, or Clopper-Pearson.
Why it matters: the per-sample certificate is one of the paper's three load-bearing properties; its machinery is borrowed methodology and the borrowed-ness is invisible.
Minimum fix: cite LTT at first use, one conformal survey citation, Clopper-Pearson at the bound.

**D2. MAJOR. "Amnesiac Corpus" collides with an established prior name and the paper does not cite or distinguish it.**
Location: Section 1, item 3, "(the property we call the Amnesiac Corpus)"; Table 2 caption; Section 9.
Evidence anchor: Graves, Nagisetty, Ganesh, "Amnesiac Machine Learning" (AAAI 2021) is prior terminology for post-hoc forgetting of training batches.
Why it matters: a reviewer or reader will meet the collision first and wonder whether it is deliberate; the paper's mechanism (deterministic regeneration) genuinely differs from amnesiac batch forgetting and the differentiation helps the paper.
Minimum fix: cite it and add one sentence: exact regeneration differs from amnesiac retraining, which forgets batches without verification.

**D3. MAJOR. The deduplication literature is absent from a paper whose headline failure mode is corpus-wide duplication.**
Location: Section 6.1, "Hub duplication," "every composed sample sits in a near-duplicate pair (fraction $1.0$)."
Evidence anchor: MinHash (32 bands of 4 rows, 16-char shingles) used with no citation to Broder; no engagement with "Deduplicating Training Data Makes Language Models Better" (Lee et al., 2022) or the near-duplicate-corpus effects on memorization it documents.
Why it matters: the near-duplicate finding connects directly to known memorization amplification by duplication; omitting that literature weakens the cost analysis and makes the MinHash protocol untraceable.
Minimum fix: cite Broder for MinHash/LSH and Lee et al. where the near-duplicate rate is reported; one sentence on expected memorization interaction.

**D4. MAJOR. The entity-resolution spine is nearly uncited.**
Location: Section 5, "Cross-department linking" and "the open measurement of the benchmark line."
Evidence anchor: B-cubed precision/recall used with no citation (Bagga and Baldwin, 1998); "The estate's own PPRL benchmark" with no PPRL citation (Christen 2012; Vatsalan et al. survey); no entity-resolution survey (Christen; Papadakis et al. blocking; Mudgal et al. deep ER) anywhere in the paper, though entity resolution is the paper's stated spine; Graph-PPR uncited (Haveliwala 2002; PPR-based KBQA such as GraftNet); Okapi BM25 uncited (Robertson and Zaragoza 2009).
Why it matters: the paper claims a domain ("training-data curation, entity resolution") whose core measurement vocabulary it uses without attribution, and the "open resolution-scoring measurement" has an established literature the paper should place itself in.
Minimum fix: cite B-cubed, one PPRL source, one ER survey at Section 5; Haveliwala and BM25 at the two arms in Section 7.

**D5. MINOR. No real-resolution baseline is run even though the capability exists one directory over.**
Location: Section 5, "Noise-tolerant resolution... is the open measurement of the benchmark line."
Evidence anchor: the only real-estate numbers are floors of the trivial exact-match baseline; sibling Paper 3 runs Presidio and GLiNER baselines on real text.
Why it matters: "open" is stated three times; a phonetic or out-of-the-box linkage baseline on the noisy estate would convert one "open" into a measured gap, at modest cost.
Minimum fix: not required for correctness; if accepted as future work, say so once (ruling c) rather than three times.

**D6. MINOR. Coverage of 2026-dated citations cannot be verified from this review.**
Location: bib entries `annamalai2026cliopatra`, `kumar2026leakagebench`, `lenin2026embgen`, `tan_lora_memorization`.
Evidence anchor: arXiv IDs 2603.09781, 2609.02207, 2605.19394, 2607.21351 predate this reviewer's verifiable literature and could not be checked; the in-text descriptions are internally consistent with their bib titles.
Why it matters: "the nearest structural neighbor to our composition" (EmbGen) is load-bearing for the originality argument and rests on an unverifiable source.
Minimum fix: none for the authors other than confirming IDs at submission; flagged as unverifiable here.

## Seat 4 Perspective

**Genuine strengths.** The paper refuses the usual privacy theater: it declines to call redaction a guarantee, ties its limits to CLIOPATRA/LeakageBench, and the "detector-closed" scoping is stated (and restated; see C3). The readable view as an explicit opt-in seam rather than a mode or upsell is coherent with the author's standing product rulings, and the paper correctly refuses to measure the vaulted arm as a privacy-cost result.

**P1. MAJOR. The readable view's governance is a one-line seam whose beneficiaries and consenting parties are unnamed.**
Location: Section 4, "an explicit \texttt{readable} opt-in for the user training a model on their own documents who wants it to learn real names: unmasked content and canonical readable entity anchors, with no extra ceremony."
Evidence anchor: same; "with no extra ceremony" is the entire control description.
Why it matters: in the paper's own deployment frame (enterprise estates, Article 17), the documents describe other people. "The user training on their own documents" is rarely the person the documents describe; the readable view converts third parties' names into training tokens, and the certificate ceremony does not run in that view (correctly disclosed). Who may flip the view, on what lawful basis, and what the data subjects' erasure recourse is in a readable-trained adapter are exactly the questions Article 17 framing sets up and the paper does not answer.
Minimum fix: one plain paragraph at Section 4: the operator is accountable for the lawful basis of the opt-in, the readable export carries no certificates, and the erasure path for a readable-derived adapter is the retrain, in that order of clauses.

**P2. MAJOR. The stakeholder map is thin, and the one sentence it has for data subjects is load-bearing for the erasure story.**
Location: Section 10, item 1, "the people the corpus describes, whom the vaulted default exists to protect, hold the erasure receipt as their recourse."
Evidence anchor: data subjects appear here and nowhere else; operators appear once ("an operator relying on it for a release decision..."); auditors appear only via the detector-closed caveat.
Why it matters: three stakeholders carry this paper's claims and only one is sketched. The data subject's "recourse" is a receipt the subject cannot independently read or trigger; the operator bears unspecified costs (per-sample certificate computation, vault maintenance, salt custody) with no magnitudes; the auditor is told the certificate is not for them but not what is.
Minimum fix: a short deployment-costs paragraph: what an operator must run and store, what a data subject can actually receive, and what third-party instrument (re-run of the trapped build, OS-level egress accounting) can verify a receipt.

**P3. MAJOR. Salt lifecycle and cross-workspace linkability are unaddressed despite the salt being the erasure-certificate linchpin.**
Location: Section 9, corpus-half bullet, "raw values live only in the source inputs, which erasure does not touch"; Section 3, "an HMAC of the workspace salt over the value's class and canonical form."
Evidence anchor: salt rotation, salt compromise, and whether the same person across two workspaces resolves to linkable identifiers are all unstated.
Why it matters: salt leakage makes entity identifiers linkable across deployments (a privacy property the salt was chosen to buy); rotation breaks the "(inputs, view, engine version)" determinism contract and the certificate receipts; an enterprise deployment decision needs this and the paper is silent.
Minimum fix: one paragraph: who holds the salt, what its compromise implies, and whether rotation is supported at what determinism cost.

**P4. MINOR. The measured canary level is reported as a null result and its level is left undiscussed as a privacy fact.**
Location: Section 7, "Canary exposure and fluency," "Exposure is flat across trained arms ($8.48$ to $8.57$ bits over the 12 canaries, against $4.25$ bits for the untrained base)."
Evidence anchor: same.
Why it matters: "flat across arms" is the narrative-relevant statement; the level (fine-tuning roughly doubles canary exposure versus base at this scale) is the privacy-relevant one, and in the readable view (the view the trained arms used) names are in the learnable tokens. Both facts belong to the same sentence.
Minimum fix: one clause stating that fine-tuning raised exposure above base, at all formats, in the readable view.

## Seat 5 Devil's Advocate

**DA1. MAJOR. The paper's strongest number is conditional on a capability the paper has not measured: the flagship 81.7% is oracle-assisted.**
Location: abstract, "routing each question's cache to the asked person's own records, given a correctly resolved identity rather than doing retrieval, answers $81.7\%$, the strongest arm measured"; Section 7, "the arm scores routing given a correct resolution, not resolution itself"; Section 7, "Its router receives the question's resolved person identity instead of doing retrieval."
Evidence anchor: the router is handed a gold label; the questions "state the full name" (Section 7); the paper's own resolution floors on real data are the trivial exact-match baseline's 24.27% recall (noisy estate, synthetic text) and an unmeasured engine resolution line on the open estate ("identity resolution on this estate is the open resolution-scoring measurement," Section 8).
Why it matters: the deployment claim travels as "the entity graph, as a router, is the strongest arm measured." In deployment the router runs on the engine's own resolution, whose quality on real text this paper explicitly leaves open, and the same resolution failure whose composed-corpus cost the paper measures at 14.32x is what would degrade routing. The paper discloses the condition everywhere, but the abstract's superlative carries the number and the condition is parenthetical.
Minimum fix: report the router both conditional on gold resolution and end-to-end with the engine's own resolution (even if the end-to-end number is much lower), and demote the abstract superlative to the conditional form it already has.

**DA2. MAJOR. The paper's central hypothesis (standalone-knowledge samples train better) has no supported positive instance, yet "never behind on any stratum" travels in the abstract as a finding.**
Location: abstract, "the best trained format, the composed corpus, reaches $11.7\%$, never behind per-block ($10.0\%$) on any stratum, ahead only on the $12$-question disambiguation stratum by one question"; Section 7, "The reading," "composed is never behind per-block on any stratum."
Evidence anchor: the paper's own statistics: composed versus per-block p = 1.00, composed versus base p = 0.07, composed versus flat p = 0.55, "no trained-format comparison separates"; every trained arm sits between base (1.7%) and 11.7% under a 160-step, 25,755-token budget the paper itself calls repetition-starved (Allen-Zhu and Li).
Why it matters: "never behind on any stratum" is a true sentence about a null result. At 7 versus 6 correct answers with p = 1.00, a reader cannot distinguish "composed is better" from a coin that happened not to land behind. The claims section states the margin is "within noise at $n{=}60$" and the conclusion calls it "one measurement at one starved scale," but the abstract's framing ("the best trained format") asserts a superlative the hypothesis test does not license.
Minimum fix: replace the abstract's "the best trained format, the composed corpus, reaches 11.7%, never behind..." with "composed (11.7%) and per-block (10.0%) do not separate at n=60 (McNemar p = 1.00); no trained-format claim is made." One boundary sentence, at the claim (ruling c), in the exact direction the data support.

**DA3. MINOR. Asymmetric failure-mode and magnitude reporting favors the graph story.**
Location: abstract (reports "false merges amplify by a factor of $14.32$ when resolution is wrong"; omits the near-duplicate fraction 1.0 entirely) and Section 7, "The reading," "retrieval with no fine-tuning answers $53.3\%$ exactly, $4.6$ times the best trained arm."
Evidence anchor: the same table gives BM25 60.0% (5.1 times the best trained arm, and numerically above Graph-PPR's 53.3%); Table 3 gives BM25 Q1 58.3% versus Graph-PPR 41.7%.
Why it matters: the abstract carries the measured cost that implicates a rival capability (resolution) and omits the one that implicates the paper's own construction (the whole composed corpus is near-duplicates); the quoted 4.6x uses the weaker comparator when both appear in the same table. The paper's prose elsewhere is scrupulous; the abstract is not.
Minimum fix: include "near-duplicate fraction 1.0" in the abstract's cost sentence and quote both retrieval ratios or neither.

**DA4. MINOR. The ignored alternative: erasure and routing do not require composition, and composition's benefit is measured as null while its costs are measured as large.**
Location: Section 10, item 3, "Composition at the scale measured is a small benefit with measured costs attached."
Evidence anchor: measured in the paper itself: composed versus per-block null (p = 1.00), amplification 14.32x at 25% merge, near-duplicate fraction 1.0, composed PPL 32.5 versus base 26.1; while erasure receipts and \texttt{eraseEntity} need only the entity index ("the graph names exactly the samples and spans an entity owns," Figure 1 caption), which per-block already has.
Why it matters: by the paper's own numbers, the deployment-recommendable artifact is the per-block corpus plus the entity index plus the router: identical erasure receipts, no amplification, no duplication, and the routing win intact. The paper measures this conclusion and never states it. This is the "so what" test pointed at composition specifically, and the paper's own failure-mode measurements point at the same place.
Minimum fix: one sentence at Section 6 or 10: on the measurements reported, composition is a not-yet-justified view, retained pending evidence at larger budgets; the erasure and routing benefits do not depend on it.

**DA5. MINOR. The CAG set-cover arm is disclosed as evaluation-informed, but the disclosure sits six paragraphs deep.**
Location: Section 7, "Non-training controls," "the set-cover optimizes the cache contents against the question population itself, which deployment cannot do, so this arm is an evaluation-informed upper bound for fixed-cache CAG."
Evidence anchor: same; Table 3 row "CAG over composed records 51.7" carries no marker to that effect.
Why it matters: a table row that is an oracle-selected upper bound should be visually denominated as one, or a reader comparing 51.7 against 53.3 and 60.0 reads three comparable retrievers.
Minimum fix: mark the arm in the table caption as an upper bound (one clause; the disclosure sentence itself follows ruling c and can stay as the single instance).

## Editorial Decision

**Major Revision.**

Rationale. The measurement discipline is genuinely above the bar, the artifact idea is sound, and nothing in the arithmetic I could recompute was wrong except one displayed factor. The revision is major because: (1) the title violates the author's binding ruling and claims erasure beyond the measured half (J1); (2) companion-paper positioning is absent while results and recipes overlap Paper 2 (J2, M2); (3) Table 3 mixes two runs with different protocols, violating ruling (d) (M1); (4) the abstract states a superlative ("best trained format") the paper's own tests refute, and launders a null result through "never behind" (DA2); (5) the flagship arm is conditional on an unmeasured capability (DA1); (6) no artifact availability exists for an artifact-epistemology paper (M3); (7) core methodology (LTT, conformal bounds, ER vocabulary, dedup) is uncited (D1-D4) with a name collision (D2). None of these require new experiments except two small ones (router end-to-end, recipe-selection statement); most are reframing, citation, and one-table repairs.

## Consensus and disagreements

Agreed by all five seats: M1 (two-run table), J1 (title), M3 (artifacts), DA2's arithmetic (the null is real; the disagreement is only about framing weight), and the correctness of the numbers that could be recomputed.

Seat-1 versus Seat-5 on significance: Seat 1 holds the training-data-curation framing is a legitimate, motivating MLSys contribution even with the trained-format null, because the schema, receipts, and routing measurements stand on their own; Seat 5's "so what" reduces composition's role, which is not the same as reducing the paper. Resolved in the decision: the paper is publishable at this track if it re-centers on schema plus erasure receipts plus routing and demotes the training-format superlatives.

Seat-2 versus Seat-5 on the floors: Seat 2 reads the Section 8 floor numbers as properly labeled calibration (each carries "floors for engine claims on real data, not engine claims"), Seat 5 notes they are the only real-data resolution numbers in the paper and therefore dominate the resolution picture a reader carries away. Resolved: they are honestly labeled; the risk is carried in DA1's end-to-end fix, not in relabeling.

Seat-4 accepts the boundaries as accurate but rules the volume a violation of ruling (c); Section 10, as an entire list of disclaimers, is itself the anti-pattern the ruling targets.

## Revision Roadmap

| ID | Severity | Location | Issue | Exact fix |
|---|---|---|---|---|
| J1 | MAJOR | Title (lines 23, 33) | Title leads mechanism/privacy, violates ruling (b); "Byte-Verified Erasure" exceeds measured scope | Replace with "How Training Data Should Look: From Stitched Chunks to Records That Know What They Describe" |
| J2 | MAJOR | Related Work; Section 7 design | No citations to the three companion papers; overlapping recipe and result | Add companion citations and one positioning paragraph naming what is new here |
| M1 | MAJOR | Table 3 caption; "Non-training controls" | Two-run mixing, judge cells missing for 3 arms, run-provenance prose violates ruling (d) | Re-score uniformly or split tables; delete "added by the second run" and "intentional notches" |
| M2 | MAJOR | Section 7 "The design" | Recipe-sweep selection criterion unstated; possible eval leakage | One sentence: sweep objective, selection data, disjointness from the 60 questions |
| M3 | MAJOR | (absent throughout) | No artifact URL, hashes, kernel checksums, model revisions | Availability paragraph with repository, commit, engine-version hash, per-kernel SHA-256 |
| M4 | MAJOR | Section 5 "Detection and certificates" | Bound convention (one-sided) and x=n assumption unstated; two-sided reading gives 78.9% | State convention and assumption once at the bound |
| D1 | MAJOR | Section 3 Certificates | Learn-Then-Test, conformal, Clopper-Pearson uncited | Cite Angleopoulos et al. (LTT), one conformal survey, Pearson at the bound |
| D2 | MAJOR | Section 1 item 3 | "Amnesiac Corpus" collides with Amnesiac Machine Learning (2021) | Cite and differentiate in one sentence |
| D3 | MAJOR | Section 6.1 | MinHash/Broder and training-data dedup literature uncited | Cite Broder; cite Lee et al. 2022 at the near-duplicate finding |
| D4 | MAJOR | Sections 5, 7 | B-cubed, PPRL, ER surveys, PPR, BM25 uncited | Add the five citations at their first uses |
| DA1 | MAJOR | Abstract; Section 7 | 81.7% headline is gold-resolution-conditional; end-to-end routing unmeasured | Add end-to-end router measurement or scope the headline number in every mention |
| DA2 | MAJOR | Abstract; Sec 7 reading; Sec 10 item 3 | "Best trained format" / "never behind" assert a null as a superlative | Replace with "do not separate (p=1.00); no trained-format claim is made" |
| P1 | MAJOR | Section 4 readable view | No lawful-basis or consenting-party statement for identity unmasking | Add the governance paragraph specified in P1 |
| P2 | MAJOR | Section 10 item 1 | Stakeholders: one sentence for data subjects, operator/auditor costs absent | Add deployment-costs paragraph and a third-party verification statement |
| P3 | MAJOR | Section 9; Section 3 | Salt rotation, compromise, cross-workspace linkability unstated | Add salt-lifecycle paragraph |
| C1 | MINOR | Abstract; multiple | Meta-commentary and "receipts/honesty" vocabulary (15 "receipt", 24 flagged lines; erasure-pending stated in 6 places) violates ruling (c) | State each boundary once at its claim site; delete repetitions; rewrite "recorded, not smoothed", "not smoothed over", "the honest completion of erasure", "Two honesty measurements" as plain boundary statements |
| C2 | MINOR | Section 7; Section 5 | "A receipt... is not a prose claim" and similar self-referential definitions argue with prior drafts (ruling d) | Replace with plain definition of a receipt as a hash-pinned artifact field, said once |
| C3 | MINOR | Table 3 caption; table row | CAG set-cover arm is an evaluation-informed upper bound, unmarked in the table | One clause in the caption; keep the single in-text disclosure |
| DA3 | MINOR | Abstract | Omits near-duplicate fraction 1.0; quotes 4.6x not 5.1x; "ties it" where BM25 numerically leads | Report both failure modes and both retrieval ratios |
| DA4 | MINOR | Section 6; Section 10 | Missing statement that erasure and routing do not require composition, per the paper's own measurements | One sentence recommending per-block-plus-index as the deployment default pending composition evidence |
| DA5 | MINOR | Section 9 | "The arm is a construction-consistency check, not a privacy-cost measurement" hedging pattern | Keep the fact, drop the register; one plain sentence |
| M5 | MINOR | Sections 5, 6.1, 7 | 76 vs 24 entities; 1,106 vs 1,113; 14.32 vs 14.35; IT-business-only linking scope | Four one-clause reconciliations as specified |
| M6 | MINOR | Section 7 | Single training run; no seed variance | State single-run design at the table |
| M7 | MINOR | Table 1; Section 5 | Non-discriminative 100%-column table | Plain one-sentence scope statement, shrink table |
| M8 | MINOR | Section 6.1 | Rate-to-class mapping contradiction (20 pairs vs 25% of 72) | Specify the mapping in one sentence |
| M9 | MINOR | Section 7 "The design" | EM-on-generation protocol unspecified | One sentence on decoding and normalization |
| M10 | MINOR | Table 3 | Judge columns uninformative (6.7-41.7% agreement) | Move to artifact with reliability note |
| B1 | MINOR | .tex/.bib | Three overfull hboxes (log lines 137-152 [105pt Table 1], 205-206, 215-231); em-dash renders into PDF from bib entry gdpr_art17 ("Article 17 --- Right to Erasure"), violating ruling (a) in output | Widen Table 1 or abbreviate metric names; replace bib em-dash with a colon; no new em-dashes in fixes, and none introduced by the fixes above |
| M4b | MINOR | tex line 237 "$16607$" | Missing thousands separator against house format ("$25{,}755$", "$20{,}627$") | "$16{,}607$" and "$2940$" similarly checked; keep as is only if intentional |

## DA CRITICAL adjudication

No CRITICAL finding was confirmed. Three candidates were adjudicated:

1. **Fabricated-appearing arithmetic in Table 3.** Not critical: every exact-match percentage, CI, and lower bound reproduced exactly under independent recomputation; the single unreproducible figure is the 14.32 amplification factor, which is off by 0.03 against the displayed rounded rates and is plausibly correct against unrounded internals. MAJOR as M5, not CRITICAL.
2. **The 81.7% headline as an undisclosed oracle.** Adjudicated as MAJOR (DA1): the condition is disclosed in the abstract sentence itself ("given a correctly resolved identity"), so the claim is not hidden; the finding is that a disclosed condition at sixth-mention depth does not survive as a superlative in an abstract and conclusion, and the end-to-end number is missing.
3. **"Byte-Verified Erasure" in the title against a pending adapter half.** Adjudicated under J1: internally scoped everywhere in the body, but the title is the paper's widest-scoped claim and doubles as the ruling-(b) violation. MAJOR.

## Not verified / limits of this review

- The four 2026-dated arXiv entries (CLIOPATRA 2603.09781, LeakageBench 2609.02207, EmbGen 2605.19394, tan_lora_memorization 2607.21351) and the exact quoted phrases from chan2024cag ("limited and manageable size", and the hybrid "preload a foundation context" wording) could not be checked against the sources; the descriptions are consistent with the bib titles.
- Exact McNemar p-values were verified for internal consistency (raw values fit plausible discordant-cells patterns; every adjusted value matches its raw value under the stated Holm family sizes, e.g. 3x, 2x, 1x in the hybrid family) but not recomputed from per-question rows, which were not provided.
- All artifact-backed claims ("checked-in artifacts by a CI check", corpus SHA-256 receipts, engine-version hash, MinHash output, per-question manifest, estate generator, the Enron subset's handling, W2's 0.0187% RelErr) were taken as reported; no repository was evaluated.
- The companion papers were skimmed at abstract level only, sufficient for the distinctness judgment, not for a full overlap audit.
- One recomputed discrepancy remains open for the authors: 14.32 versus 14.35. Everything else this panel recomputed, including all eight CIs, the certificate bounds, and the McNemar adjustment consistency, matched exactly.
