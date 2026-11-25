# Review: Versieve-MM: Zero-Import WebAssembly Multimodal Enterprise Sanitization, Ground-Truth Conformal Gating, and Noisy Cross-Modal Erasure

Panel run: academic-paper-reviewer, single manuscript, five role-separated seats. Manuscript: `paper/versieve-multimodal-sanitization-benchmark.tex` (MLSys 2025 style, `[accepted]` mode). Bibliography: `paper/versieve-multimodal-sanitization-benchmark.bib`.

Role separation here is procedural, not epistemic: all five seats were executed by one reviewing process over the same evidence base, so findings are not independent samples from five error processes. Seats are kept separate only to force distinct evaluation lenses (fit, statistics, domain depth, deployment, adversarial). Cross-seat agreement therefore carries no calibration value beyond what the evidence itself supports.

## Coverage (what was read, what was not)

Read in full:
- The manuscript TeX (all 360 lines: abstract, Secs. 1-6, Fig. 1-3 captions, Tables 1-6, appendix audit table).
- The complete `.bib` (24 entries; 17 used per `.blg`), the `.blg`, and compile-log warnings.
- Companion Paper 1 (`versieve-extraction-redaction-benchmark.tex`) HC-CRC/E-LTT paragraph (lines 267-268) and all three companion titles, for the distinctness check.
- All cited arithmetic recomputed from the tables (see Seat 2).

Not read / not verifiable in this review:
- The four figure PDFs (not rendered for inspection; panel-A/B contents are taken from the paper's own captions).
- The actual WASM binary, CI scripts (`scripts/eval-gccrc-benchmark.mjs`, the E-LTT/HC-CRC gatekeeper source, the SR-MP seed-argument CI assertion), or any results artifact. Claims about implementation behavior are therefore accepted as stated.
- The TAB dataset internals, the `Hodfa71/pstu-synthetic-secrets` corpus, the Yelp `test_data`, and MBPP sample composition.
- Whether the paper compiles to a PDF without overlapping figure regions (log shows duplicate hyperref destinations only).

---

## Seat 1 Journal-Fit

**JF-1 (MAJOR) Abstract claims HC-CRC/E-LTT as a contribution that already exists, verbatim, in companion Paper 1.**
- Location: Abstract, "makes three contributions: ... (2) **Hierarchical Cluster-Robust Conformal Risk Control (`HC-CRC`)** and **Anytime-Valid Ville Betting Martingales (`E-LTT`)**"; duplicated in "Scope of Novelty"
- Evidence anchor: `versieve-extraction-redaction-benchmark.tex:267-268` defines the identical cluster loss $L_m(\lambda) = |U_m|^{-1}\sum \mathbb{I}[f(c)\ge\lambda]$, the identical DEFF $=1+(\bar N_u-1)\rho$ and $N_{\text{eff}}=\lfloor n_0/\text{DEFF}\rfloor$ inversion, and the identical Ville supermartingale $\mathcal E_t(\lambda)=\prod(1+\gamma_m(\alpha-L_m(\lambda)))$. The multimodal paper's Sec. 3 repeats the same formulas with only the detector score swapped for $\hat p_{\text{safe}}(c)$.
- Why it matters: contribution (2) of three named contributions is not new to this manuscript. The genuinely new content is the *empirical TAB evaluation* (1,999 held-out paragraphs, five regimes, ICC/DEFF measured) and the finding that naive-i.i.d. LTT overshoots. Claiming the mechanism as a contribution in the abstract invites a "novelty already claimed in a companion submission" review outcome.
- Minimal fix: restyle contribution (2) as "first empirical cluster-robust validation of the companion HC-CRC/E-LTT gatekeepers on human-annotated multi-paragraph legal text, including measured DEFF=2.62 and the naive-i.i.d. overshoot," and cross-reference the companion mechanism definition explicitly.

**JF-2 (MAJOR) Binding author style ruling (b) violated: the title leads entirely with mechanism/privacy words and contains no training-data content.**
- Location: Title and `\pdftitle`, "Versieve-MM: Zero-Import WebAssembly Multimodal Enterprise Sanitization, Ground-Truth Conformal Gating, and Noisy Cross-Modal Erasure"
- Evidence anchor: ruling text applied verbatim; "Zero-Import", "Sanitization", "Conformal Gating", "Cross-Modal Erasure" all lead; no reference to extraction, training data, or corpora.
- Why it matters: this is a stated binding ruling of the author's own style canon (titles must hit the training-data question first, privacy words must not lead); a panel that ignores it reports a non-compliant title.
- Minimal fix: propose a title such as "Multimodal Enterprise Sanitization for Corpora and Training Data: a Verified Zero-Import WASM Kernel with Cluster-Robust Gatekeeping" (leading with corpus/training-data use, mechanism trailing).

**JF-3 (MAJOR) Binding author style ruling (a) violated: em-dashes appear in 14 lines.**
- Location: throughout; notable in the abstract ("leak-prone containers---emails", "in-call detections---though a plain Jaro-Winkler baseline"), Exp. 1 (three in the "Seven honest lessons" paragraph), Fig. 1/3 captions, Exp. 4 itemized results.
- Evidence anchor: `grep -c -- '---'` = 14 lines (one is the Table 1 missing-CI placeholder for the τ=0.70 row, which should become "--" or blank).
- Why it matters: the author's no-em-dash ruling is motivated as an AI-writing tell; the current text reads exactly like the pattern the ruling bans.
- Minimal fix: global rewrite of those 14 sites with commas/colons/parentheses/sentence splits; keep `--` en-dashes only.

**JF-4 (MINOR) Internal draft language leaks into a submitted abstract.**
- Location: Abstract, "($+$28.65 F1 over **Paper 1 regex**)"; Sec. 4.1, "Paper 1 Regex+Lexicon" row; Sec. 2.2, "fuses Paper 1 regexes"
- Evidence anchor: self-reference to an unpublished companion technical report (`ardiyansyah2026versieve`, "Technical Report"); "Paper 1" is house numbering a reviewer has no way to resolve beyond one citation.
- Why it matters: opaque jargon in the abstract degrades readability and, under a future double-blind setting, self-identifies the authorship lineage.
- Minimal fix: call it "the companion Versieve text pipeline's regex+lexicon baseline" and cite it on first use in the abstract.

**JF-5 (MINOR) Fit to MLSys main track is defensible but the systems claim is thin relative to the empirical claims.**
- Location: Abstract, "single 204,031 B Rust-to-WebAssembly kernel (29 exports, zero host imports) shared byte-identically"
- Evidence anchor: the kernel is real and load-time auditable (Tab. 1, Tab. 7), but the empirical core is NER accuracy, conformal calibration, and small-benchmark audio redaction; MLSys readers will ask what the systems contribution is beyond consolidation (no latency/memory envelope, no throughput under concurrency, no deployment cost numbers beyond 2.51 MB/s).
- Why it matters: fit is fine; significance is average without a systems-efficiency section.
- Minimal fix: add a short paragraph reporting memory footprint, cold/warm latency envelope for full-pipeline ingestion, and one deployment-scale figure.

---

## Seat 2 Methodology

**ME-1 (CRITICAL) Table 2's provenance and set are internally contradictory; whether the central claims are in-sample is undecidable.**
- Location: Table 2 caption: "on held-out TAB ECHR (1,999 paragraphs across 127 rulings: ... ICC=0.1276, DEFF=2.62)"; Sec. 4.2 prose: "certifying at α=0.01 as well (0.18% FPR, 32.98% Safe Yield) **on this calibration set**"; "crosses the anytime-valid Ville wealth barrier ... at cluster t=64/67"; Sec. 4.2: "ICC = 0.1276 across the M0=67 unsafe calibration rulings"
- Evidence anchor: the ICC/DEFF is computed on the 67-ruling calibration set, but the caption attaches it to the 1,999-paragraph, 127-ruling test set; the E-LTT crossing times are calibration events; the table's abstract framing ("On TAB's 1,999 **held-out** paragraphs ... HC-CRC removes the α=0.10 naive i.i.d. FPR overshoot") is ambiguous about whether the reported FPR columns of the certified regime are measured on the same rulings whose losses were used to certify λ.
- Why it matters: if the ≤α rows are reported on the calibration data (which the 0.18% at α=0.01 row strongly suggests, since λ was inverted from that same data), the paper's headline guarantee is an in-sample statement with no held-out replication, and the caption is wrong. If they are genuinely held-out, the prose sentence is wrong and the DEFF/ICC attribution is wrong. Either way one load-bearing sentence is false.
- Minimal fix: disentangle explicitly: report λ-certification (calibration, 67 rulings) and FPR/yield evaluation (held-out 127 rulings) as two separate columns/rows, correct the caption's ICC/DEFF attribution to the calibration set, and state clearly that the abstract's numbers are the held-out evaluation.

**ME-2 (CRITICAL) Prose cites HC-CRC results at α=0.15 and α=0.20 that Table 2 does not contain.**
- Location: Sec. 4.2, the paragraph after Table 2, "holding Conditional FPR strictly below α ... 12.57% ≤ 15%, and 15.77% ≤ 20%"
- Evidence anchor: Table 2's last row is α=0.10; no α=0.15 or α=0.20 rows exist anywhere in the manuscript, and the Limitations section item 2 also stops at α=0.01-0.10.
- Why it matters: two quantitative claims about the paper's central method appear with no supporting table or figure. This is the exact pattern (prose numbers unsupported by tables) that the check list targeted, and it is confirmed present.
- Minimal fix: add the α=0.15/0.20 rows to Table 2 (with the same 4-tuple format) or delete the two unsupported numbers, and re-derive the "across every budget" sentence to stop at α=0.10.

**ME-3 (MAJOR) Limitations item 1 contains arithmetic that matches no pair of Table 1 numbers.**
- Location: Sec. 5 item 1, "outperforms our 45.8 MB edge GLiNER model by +33.35 F1 on All-Maskable entities and +11.36 F1 on PERSON"
- Evidence anchor: the sentence's own named comparison (Presidio+code 79.26 vs. hybrid 45.91) gives +43.35, not +33.35; on PERSON, 86.27 vs. 74.20 (Dev-Filtered GLiNER) is +12.07 and vs. 73.27 (SR-MP) is +13.00; no pair yields +11.36.
- Why it matters: a self-acknowledged negative result, the paper's strongest honesty claim, is stated with numbers that do not reconcile; a checker who tries one subtraction finds the error and distrusts the rest.
- Minimal fix: recompute both deltas from Table 1 (they are +43.35 and +12.07 against Dev-Filtered GLiNER) and state which system is the base of each delta.

**ME-4 (MAJOR) N_eff arithmetic is inconsistent with the printed DEFF.**
- Location: Sec. 4.2, "DEFF = 1 + (N̄_u − 1)ICC = 2.62 and reducing effective sample size from n0=916 paragraphs to N_eff=350"
- Evidence anchor: floor(916/2.62) = 349; 350 requires DEFF ≈ 2.617 to hold before rounding.
- Why it matters: trivial, but visible; the DEFF=2.62 headline is propagated to the abstract.
- Minimal fix: print DEFF to three decimals (2.614) or N_eff=349.

**ME-5 (MAJOR) The E-LTT martingale is not reproducible from the paper: the betting strategy γ_m is never specified.**
- Location: Sec. 4.2, "track the non-negative Ville betting supermartingale E_t(λ) = ∏ (1 + γ_m(α − L_m(λ))) and certify λ whenever max E_s(λ) ≥ 1/δ = 20.0"
- Evidence anchor: E_max = 23.76 (α=0.05) and 26.84 (α=0.10) depend entirely on the γ sequence (fixed, plug-in, online γ*, universal mixture, etc.); none is named; no reference implementation is cited; the Ville validity condition is asserted to hold "as independent parent documents provide" without a stated or tested condition.
- Why it matters: a reader cannot re-derive the certification crossing times or check the "fails to certify at α ≤ 0.02 (E_max=1)" claim, which is itself a headline (fail-closed) result.
- Minimal fix: one sentence naming the exact γ scheme (with citation), plus a citation or proof sketch for the sequentially-valid condition the cluster losses are claimed to satisfy.

**ME-6 (MINOR) Identical numeric quadruples in two different table rows are unexplained.**
- Location: Table 2, α=0.01 HC-CRC row and α=0.05 E-LTT row: both 0.18% / 6.35% / 32.98% / 2.36% (3)
- Evidence anchor: plausibly both certified the same λ, but the paper does not say so.
- Why it matters: reads either as an error or as strong structure; one clause removes the ambiguity.
- Minimal fix: footnote that both gatekeepers selected the same λ and therefore the same release set.

**ME-7 (MINOR) Significance reporting is floor-collapsed and one table row has no CI.**
- Location: Sec. 4.1/Fig. 1 caption, three different comparisons all at "p=0.0002"; Table 1 τ=0.70 SR-MP row, F1 CI shown as "---"
- Evidence anchor: p=0.0002 is the minimum of 5,000-permutation reports; the number of permutations and the τ=0.70 baseline row (27.88% is used in prose but has no table row) are unstated.
- Why it matters: identical floor p-values across three comparisons suggest reporting-limited rather than evidence-limited inference; the missing row blocks verification of the "27.88% → 40.78%" headline.
- Minimal fix: state permutation count; add the Dev-Filtered GLiNER τ=0.70 row (or its CI) to Table 1.

**ME-8 (MAJOR) Reproducibility is below the bar the methodology promises.**
- Location: Sec. 3, "All experiments ran locally on a Windows 11 laptop (Node.js v24.13.1, Python 3.12 CPU ONNX Runtime, Rust 1.99.1)"
- Evidence anchor: no hardware model (laptop only), no random seeds for the 1,000-resample bootstrap and permutation tests, no artifact URL or Zenodo DOI, no package versions, no license statements for TAB, `aeslc`, MBPP, `pstu-synthetic-secrets`, or Yelp `test_data`.
- Why it matters: the paper's central evidentiary mode is single-machine small-sample measurement; without (a) an artifact and (b) seeds, its numbers cannot be re-obtained exactly, which the small-sample widths (n=97 audio tokens) make consequential.
- Minimal fix: add a reproducibility statement with artifact DOI, seeds, hardware spec, and per-corpus licenses; this is a one-paragraph addition.

---

## Seat 3 Domain

**DO-1 (MAJOR) The audio retention claim "100.0% non-PII business speech retained" is never operationalized.**
- Location: Abstract, "21/25 calls zero leak, 100% non-PII speech retained"; Exp. 4, "while preserving 100.0% non-PII business speech"
- Evidence anchor: the paper never defines the retention metric (word recall over non-PII tokens, duration ratio, WER delta?), who measured it, or against what reference transcript. The nearest definitional content is the redaction parameterization (60 ms padding, 5 ms cosine fade).
- Why it matters: with TTS speech and silence-based excision, 100% is plausible, but as stated it is an undefined metric repeated in abstract, body, and caption; a reader cannot tell whether it means "the redaction only touched matched spans" (true by construction and uninformative) or "no collateral damage was measurable" (informative and unmeasured).
- Minimal fix: define the metric (e.g., non-PII word recall under `small.en` transcription of the redacted vs. ground-truth-aligned transcript), state that it is measured on the same transcription pass, and report the number with that definition.

**DO-2 (MAJOR) SR-MP's audio contribution is statistically indistinguishable from, and slightly worse than, a trivial Jaro-Winkler baseline on the paper's own evidence.**
- Location: Exp. 4 bullets, "WASM SR-MP ... 8.25% (Wilson 95% CI [4.24%, 15.44%])" vs. "Plain Jaro-Winkler Baseline (same anchors): 7.22% (CI [3.54%, 14.15%])"
- Evidence anchor: 8/97 vs. 7/97 planted tokens; the abstract admits "the salted ring's contribution is anchor privacy, not matching accuracy," and this caveat is then repeated in the Fig. 3 caption and again in Limitations item 3.
- Why it matters: the headline audio number (8.25%, bold in the abstract) is not evidence for the mechanism; the mechanism's only claimed audio benefit is anchor privacy, which is itself unquantified (see DO-6). The honest statement is buried under a bolded number, and the caveat is stated four times, violating binding ruling (c).
- Minimal fix: state once, in the abstract, that the ring's accuracy on audio is at parity with (here, marginally worse than) plain fuzzy matching on identical anchors, and that its contribution is the salted-anchor privacy property.

**DO-3 (MAJOR) Exp. 3's precision result and the Gitleaks recall deficit are corpus artifacts the paper under-weights.**
- Location: Exp. 3, "Because MBPP files are short scripts, all three hit 0/375 clean FP, so precision under noisy production repos remains to be stress-tested"; "Gitleaks's lower 49.66% recall stems largely from a fixture quirk (0/35 on single-line PEM headers)"
- Evidence anchor: the clean corpus is 375 short (78.1 KB total across 520 files) trivially clean scripts; 0 FP there is near-guaranteed for any tuned scanner; the PEM "fixture quirk" penalizes Gitleaks on fixtures the authors assembled; and the prose never states that Yelp `detect-secrets` at 86.27% F1 beats Versieve's 72.25% on accuracy, though the table shows it.
- Why it matters: the abstract advertises "0% clean FP" and "1.5x-22.8x faster" while the accuracy ranking of the three scanners (detect-secrets first) is left implicit; the precision claim is empty on this corpus.
- Minimal fix: drop the "0% clean FP" headline from the abstract, state the accuracy ranking in prose ("detect-secrets leads F1; Versieve and Gitleaks trail"), and either repair the PEM fixtures or report recall with and without the PEM class.

**DO-4 (MAJOR) Only one strong independent NER baseline, and no combination experiment.**
- Location: Table 1 and Table 3 (datasets): "Presidio (lg+Code), GLiNER"
- Evidence anchor: the TAB paper publishes its own baselines; spaCy `en_core_web_lg` raw, Flair-based, or rule+statistical hybrids are absent as independent references; and there is no "Presidio + WASM SR-MP" row, although SR-MP is proposed as a portable cross-paragraph add-on that is orthogonal to model quality, making the combination the natural experiment and it is never run.
- Why it matters: the edge-vs-server comparison is honest (Presidio wins decisively, and the paper says so at p=0.0002, which is a genuine strength), but without a second independent anonymizer and without the Presidio+SR-MP combination, the reader can see neither the field position nor whether the mechanism complements a strong detector rather than a weak one.
- Minimal fix: add at least one independent published TAB baseline and the Presidio(+regex)+SR-MP row.

**DO-5 (MAJOR) The 25-call audio benchmark is clean TTS with wide CIs; SR-MP's Bloom false-positive cost is unmeasured; Eq. (1) has undefined terms.**
- Location: Exp. 5, SR-MP equation S_SR-MP = 1 − (1 − s_local)(1 − γ max Sim(...) (1 + β d_{a,c}^{-1})); Exp. 4, "synthesize 25 realistic customer-service calls locally via offline Windows SAPI TTS (97 planted PII tokens)"
- Evidence anchor: γ, β, the distance d, and the similarity function are not given default values anywhere; the 128-bit 2-gram Bloom filters in each 32 B slot will raise false anchors, and no FP-rate measurement for the ring exists; the audio has no noise model, one TTS voice, and 8-vs-7-event precision.
- Why it matters: the ring's central algorithmic object is underdetermined (cannot be re-implemented) and unfalsified for its own FP mode; the audio result's statistical weight cannot support a "3x/2.5x reduction" narrative.
- Minimal fix: specify the equation parameters and report the ring's measured query-FP rate; keep the audio claim scoped to "under clean synthetic telephony-free speech" (which Limitations item 3 already says once; delete the repetition).

**DO-6 (MINOR) The SR-MP/PPRL salts and their threat surface are unexplained.**
- Location: Exp. 5, "small Bloom encodings are vulnerable to frequency-analysis cryptanalysis ... treated as a local-only noisy erasure index"
- Evidence anchor: salts' generation, storage, and lifetime are never described; the same frequency-style attack against 128-bit Bloom PPRL filters applies to the SR-MP ring's 2-gram filters when the attacker holds candidate lists, and the ring is compiled into a binary (if the salt is a compile-time constant, a binary holder can test candidates directly, which weakens the "anchor privacy" story to "anchor list not in plaintext at rest").
- Why it matters: the paper's only claimed SR-MP advantage is anchor privacy; "privacy against whom, with what key custody" determines whether the claim is true.
- Minimal fix: one sentence: where the salt lives, its rotation policy, and the adversarial model the salt defends against.

**DO-7 (MINOR) Uncited baselines and tooling.**
- Location: Exp. 3 (Gitleaks v8.30.1, Yelp detect-secrets), Exp. 4 (faster-whisper)
- Evidence anchor: `gitleaks2025`, `yelp2018detectsecrets`, `radford2023whisper`, `knowledgator2025glineredge`, `zhang2019aeslc`, `ai4privacy2023` are in the `.bib` but never cited (BibTeX used 17 of 24 entries); faster-whisper is a CTranslate2 reimplementation and differs from the Whisper paper in decoding behavior.
- Why it matters: baselines named without citation in a benchmark paper.
- Minimal fix: cite Gitleaks and detect-secrets at the table, cite a faster-whisper reference, and either cite or drop the unused entries.

**DO-8 (MINOR) The cross-modal GC-CRC suite (60 cases, 240 blocks) is a self-authored evaluation with no external composition description.**
- Location: Exp. 5, "across a 60-case, 240-block (4-modality) cross-modal stress suite (scripts/eval-gccrc-benchmark.mjs) ... recovers 76.11% ... with zero extra domain false positives (75 FPs, 77.74% precision, 75.18% F1)"
- Evidence anchor: the suite's data provenance, case construction, and FP ground truth are entirely internal; no external reference labels exist; the same system defines both the mechanism and the eval script.
- Why it matters: 77.74% precision and "zero extra FPs" rest on a corpus designed in the same commit as the mechanism.
- Minimal fix: one sentence describing how the 60 cases and their labels were constructed, and who could contest them.

---

## Seat 4 Perspective

**PE-1 (MAJOR) "Zero-egress" is asserted at system level while only "zero-import" is verified, and the paper itself uses both terms without keeping them apart.**
- Location: Fig. 1 caption, "End-to-end Versieve-MM **zero-egress** architecture"; Sec. 2.1, "enforces imports.length === 0 at instantiation in both Node.js and browser Web Workers"; Appendix, "the local MCP server exposes 18 zero-egress tools, verified by Node.js CI (108/108)"
- Evidence anchor: the load-time verified fact is that the kernel has zero host imports (Tab. 1, Tab. 7 audit table with byte counts, which is real and checkable); the system-level zero-egress claim spans Node CLI, MCP, next.js workbench, and an ONNX worker that downloads/loads `ort-wasm-simd-threaded.*.wasm`, gliner-pii-edge weights, whisper-tiny q8, and `/ocr/*` into a browser; the "18 tools" figure and "verified by CI" have no named test or path; Stage 3B inference runs outside the kernel in Node/Python.
- Why it matters: security-adjacent claims in this register must separate what is mechanically verified (module import surface) from what is procedurally asserted (no network calls anywhere in the stack). The paper oscillates between the two registers within the same sentence, and auditors will read "zero-egress" as a stronger, system-level commitment than the paper's evidence supports.
- Minimal fix: state once: verified = kernel import surface (mechanical, load-time); asserted = rest-of-stack egress (list the audit method), and drop "zero-egress architecture" from the Fig. 1 caption in favor of "zero-import kernel, local-only stack".

**PE-2 (MINOR) Stakeholder analysis is absent: who bears the cost of each failure mode.**
- Location: Sec. 5 Limitations (system-facing only); Sec. 1 problem statement (compliance-facing only)
- Evidence anchor: call participants (consent for recording and re-identification of residual 8.25% leaks), employees whose corpora are sanitized (what does an over-masked 65% Safe Yield mean for their workflows), and auditors who must rely on the ≤α statements (their reliance inherits the ME-1 calibration/held-out ambiguity) are never discussed; "GDPR Article 17" appears only in the keyword list, not in the body.
- Why it matters: a 1 ML-Sys systems paper whose purpose is privacy compliance should say, in one paragraph, whose risk is reduced and whose is residual.
- Minimal fix: one short paragraph mapping the three measured failure modes (secret recall 56.55%, audio residual leak 8.25%, auto-release 18.91% at α=0.10) to their bearing stakeholders.

**PE-3 (MINOR) The "so what" for 56.55% secret recall is left to the reader.**
- Location: Exp. 3, "Recall remains honestly 56.55% (missing generic JWT_SECRET= assignments caught by detect-secrets)"
- Evidence anchor: a deployment that adopts Versieve-MM's zero-egress story over Gitleaks/detect-secrets misses ~43% of credentials; the paper does not state the obvious operational consequence (use Versieve-MM as the fast frontend, keep detect-secrets for accuracy).
- Why it matters: this is the deployment guidance the paper's own numbers imply but never states.
- Minimal fix: one sentence of guidance in Lim. 3.

---

## Seat 5 Devil's Advocate

**DA-1 (CRITICAL) The strongest counter-argument to the core claim: after the paper's own concessions, the residual hard claim is a small kernel plus honest benchmarking, and the abstract's two boldest numbers are either concession-adjacent or unsupported.**
- Location: Abstract, "makes three contributions"; the bolded "8.19% ≤ 10%", "8.25%", "certifies anytime-valid bounds"
- Evidence anchor (the decomposition, in the paper's own admissions): (i) Sec. 4.1 concedes the 400.7 MB Presidio baseline "beats our 45.8 MB edge model decisively on OOD legal prose (p=0.0002)": the accuracy claim is not the contribution; (ii) Exp. 4 concedes plain Jaro-Winkler on the same anchors reaches 7.22% vs. the ring's 8.25%: the audio mechanism claim reduces to anchor privacy; (iii) Sec. 4.2 concedes the HC-CRC guarantee is "a conservative heuristic, not a proven finite-sample guarantee": the theoretical claim is not the contribution; (iv) the E-LTT certification fails at α ≤ 0.02 and certifies only from α=0.05 up; (v) ME-1/ME-2 leave the ≤α claims either in-sample or partially unsupported (α=0.15/0.20 absent from Table 2).
- What survives: a verifiable 204 KB zero-import kernel with a real audit table, tabular container forensics, steady-state secret-scanning throughput honesty (7.8x → 1.5x after removing start-up bias, and the paper does the removal), and a benchmark that includes its own losing comparisons. That is a legitimate systems-engineering contribution, but it is not the abstract's contribution list, and cherry-picking is present in the headline structure: the ring's best operating point (τ=0.70, F1 27.88 → 40.78) headlines while the paper's own τ=0.30 operating point shows the ring *lowering* All-Maskable F1 (45.91 → 45.32), and the τ=0.70 baseline row (27.88) that grants the comparison has no table entry or CI.
- The "so what" test: for an MLSys reader, the deployable delta is "bring the Presidio-class model with you and the kernel gives you containers+secrets+audio+conformal gating locally"; that is real but modest, and the α=0.10 "overshoot removal" corrects a 0.47 pp overshoot (10.47% → 8.19%) measured on ~1,600 unsafe paragraphs, i.e., a two-paragraph-scale margin correction, while the 0.18% at α=0.01 rests on 3 events.
- Why it matters: the abstract's salience ranking does not match the paper's evidence ranking; a hostile reviewer will compress the paper to "engineering consolidation, benchmarks at small n, mechanism gains equivalent to trivial baselines."
- Minimal fix: reorder the abstract so contribution (1) (the audited kernel) leads with its verified properties, present HC-CRC as *empirical* overshoot correction (ME-1 fixes) with confidence intervals rather than as "removal," and lead the audio result with the parity statement, not the bolded 8.25%.
- Adjudication: confirmed. The concessions are individually honest (a strength), but their cumulative effect is never reconciled with the abstract's claim ranking. This is cherry-picking by framing, not by fabrication: no number is invented; the issue is which numbers are bolded.

**DA-2 (MAJOR) Repeated defensive meta-commentary violates binding ruling (c) and weakens the DA surface, not the science.**
- Location: "Seven honest lessons" (Sec. 4.1); "completes the honest picture" (Exp. 4); "Recall remains honestly" (Exp. 3); "Evaluating honestly against strong third-party baselines" (Conclusion); "the original answer-key-seeded run is **superseded and archived in the results artifact**" (Exp. 4); the JW-parity caveat appears four times (abstract, Exp. 4, Fig. 3 caption, Lim. 3); "conservative heuristic, not a proven finite-sample guarantee" twice (Sec. 4.2, Lim. 2)
- Evidence anchor: ruling (c) forbids meta-commentary on experiment status and repeated defensive hedging; ruling (d) forbids arguing with past drafts, and "superseded ... archived" is the closest d-adjacent instance (a self-directed status remark rather than an argument, so d itself is otherwise satisfied).
- Why it matters: the paper argues with its own review history instead of stating boundaries once where the claim is made.
- Minimal fix: apply ruling (c) wholesale: each boundary stated once, at the claim, then silence.

**DA-3 (MAJOR) Missing robustness axis: no negative-control for HC-CRC selection.**
- Location: Sec. 4.2, HC-CRC "inverts the binomial tail after shrinking the calibration count by the survey-sampling design effect"
- Evidence anchor: the paper presents the Kish-style DEFF correction against the naive baseline but never tests a simpler alternative with a guarantee (the two cited hierarchical conformal methods, `dunn2022hierarchical`, `lee2023hierarchical`, are mentioned only as "guarantee-based ... alternatives" without being run on the same TAB split); nor is a stratified/cluster bootstrap permutation baseline run.
- Why it matters: the paper's chosen heuristic has two published replacements with actual guarantees on hand; the reader is not told whether either would yield the same FPR control at better Safe Yield on this exact data.
- Minimal fix: run one guarantee-based hierarchical baseline (e.g., the two-layer split method of Dunn et al.) on the same 67-rule calibration / 127-rule test split and report the row in Table 2.

---

## Editorial Decision

**Major Revision.** Rationale: the paper is honest to a fault in its body (Presidio wins and is said to; a trivial baseline matches the audio mechanism; the heuristic nature of HC-CRC is stated; cold-start padding is removed from the speedup), the kernel audit is real, and the table arithmetic is almost entirely internally consistent. But it is blocked by (1) two CRITICAL reporting defects in the central calibration results (calibration/held-out ambiguity and α=0.15/0.20 numbers with no supporting table), (2) a contribution statement that claims as novel a mechanism whose defining text appears verbatim in the companion paper, (3) unsupported arithmetic in Limitations (+33.35/+11.36), an undefined headline metric (100% audio retention), a non-reproducible martingale (γ unspecified), and no seeds/artifact/licenses, and (4) wholesale non-compliance with three binding author style rulings (em-dashes, title ordering, repeated hedging). None of these is a flaw in the underlying measurements; all are fixable without new hardware.

## Consensus and disagreements

- All five seats agree ME-1/ME-2 (calibration ambiguity and the missing α=0.15/0.20 rows) must be fixed before any claims survive.
- Seats 3 and 5 agree the honest concessions are simultaneously the paper's best feature and, in aggregate, its biggest unresolved framing problem (DA-1); Seat 1 does not go that far and would be satisfied by the abstract reorder.
- Seat 2 rates the reproducibility gap MAJOR; Seat 3 would accept a one-paragraph fix as MINOR. Resolved as MAJOR because the small-sample CIs make exact re-derivation consequential.
- No seat disputes the arithmetic in Tables 1, 3-6 (verified during Seat 2); the disputes are confined to Tab. 2 provenance, Limitations deltas, and N_eff rounding.

## Revision Roadmap

| ID | Severity | Location | Issue | Exact fix |
|----|----------|----------|-------|-----------|
| ME-1 | CRITICAL | Tab. 2 caption; Sec. 4.2 "on this calibration set" | Calibration/held-out conflation; ICC/DEFF attributed to wrong set | Split λ-certification (67 rulings) from evaluation (127 rulings); correct caption; state abstract numbers are held-out |
| ME-2 | CRITICAL | Sec. 4.2 "12.57% ≤ 15%, and 15.77% ≤ 20%" | α=0.15/0.20 claims absent from Table 2 | Add rows or delete the two numbers and trim "every budget" to ≤ 0.10 |
| DA-1 | MAJOR | Abstract; Sec. 4.2; Sec. 4.1 | Salience ranking does not match evidence; HC-CRC claimed as novel theory; τ=0.70 headline with no baseline row | Reorder abstract around contribution (1); present HC-CRC as empirical correction; verify 27.88 row into Tab. 1 |
| JF-1 | MAJOR | Abstract contribution (2) | HC-CRC/E-LTT defined verbatim in companion Paper 1 (lines 267-268) | Restyle as companion mechanism's first TAB validation; cite the definition |
| ME-3 | MAJOR | Lim. 1 "+33.35 F1 ... +11.36 F1" | Neither delta matches any Tab. 1 pair (correct: +43.35, +12.07) | Recompute from Table 1 and name the base system |
| DO-1 | MAJOR | Abstract; Exp. 4 "100.0% non-PII business speech" | Retention metric undefined | Define metric (non-PII word recall under the attacker transcription) and keep one statement |
| DO-3 | MAJOR | Exp. 3 "0/375 clean FP"; "fixture quirk (0/35 PEM)" | Precision empty on trivial corpus; Gitleaks penalized by authors' fixtures; accuracy ranking unstated | Drop "0% clean FP" headline; state detect-secrets leads F1; repair or disaggregate PEM fixtures |
| DO-4 | MAJOR | Tab. 1; Tab. 3 | Single independent NER baseline; no Presidio+SR-MP combination | Add one published TAB baseline and the combination row |
| DO-5 | MAJOR | Eq. (1); Exp. 5 | γ, β, d undefined; ring FP rate unmeasured; clean-TTS-only audio | Specify parameters; measure ring query-FP; scope audio claim to clean synthetic speech once |
| ME-5 | MAJOR | Sec. 4.2 martingale | γ_m betting scheme unspecified; E_max not re-derivable | Name the γ scheme with citation; cite the sequential validity condition |
| ME-8 | MAJOR | Sec. 3; throughout | No seeds, no artifact DOI, no hardware spec, no licenses | Add reproducibility paragraph with all four |
| JF-2 | MAJOR | Title / `\pdftitle` | Ruling (b) violated: mechanism words lead, no training-data question | Retitle leading with corpora/training-data use |
| JF-3 | MAJOR | 14 lines incl. abstract | Ruling (a) violated: `---` em-dashes | Replace with commas/colons/parentheses; keep `--` |
| DA-2 | MAJOR | "Seven honest lessons"; "superseded and archived"; JW caveat x4 | Ruling (c) violated: meta-commentary, status remarks, repeated hedging | State each boundary once at the claim; delete status remarks |
| PE-1 | MAJOR | Fig. 1 caption "zero-egress architecture" | Verified (import surface) vs. asserted (stack egress) conflated | Separate the two registers; rename caption to "zero-import kernel, local-only stack" |
| ME-4 | MINOR | Sec. 4.2 N_eff=350 | floor(916/2.62)=349 | Print DEFF=2.614 or N_eff=349 |
| ME-6 | MINOR | Tab. 2 identical rows (0.01 HC-CRC = 0.05 E-LTT) | Unexplained duplicate quadruple | Footnote: same certified λ |
| ME-7 | MINOR | Tab. 1 τ=0.70 row; three p=0.0002's | Missing CI; floor p-values; permutation count unknown | Add CI and state permutation count |
| DA-3 | MINOR | Sec. 4.2 | Cited guarantee-based hierarchical alternatives never run on this split | Run one and add a Table 2 row |
| JF-4 | MINOR | Abstract "Paper 1 regex" | Internal draft numbering in abstract | Rename to named baseline with citation |
| PE-2 | MINOR | Sec. 5; keywords | No stakeholder paragraph; GDPR Art. 17 only in keywords | Add one stakeholder paragraph |
| DO-6 | MINOR | Exp. 5 salts | Salt custody and adversary model unstated | One sentence on salt storage, rotation, adversary |
| DO-7 | MINOR | Exp. 3/4 citations | Gitleaks, detect-secrets, faster-whisper uncited (BibTeX 17/24 used) | Cite baselines; purge unused entries |
| DO-8 | MINOR | Exp. 5 GC-CRC suite | Self-authored 60-case eval, composition undocumented | Describe construction and labels in one sentence |

## DA CRITICAL adjudication

DA-1 is confirmed as the single most important framing issue, and it interacts with JF-1 and ME-1: the abstract's ranking of three contributions inverts the manuscript's true evidence order. The claim set that survives the paper's own concessive text is: (1) a verified 204,031 B zero-import WASM kernel with an auditable load-time import surface (Tab. 1/7) and honest steady-state timing; (2) an empirical demonstration on human-annotated TAB that paragraph-i.i.d. LTT overshoots by ~0.5-4.0 pp on realistic α budgets and that a DEFF-shrunk correction restores ≤α in-sample (pending ME-1 resolution); (3) a null-plus-parity result on audio: the salted ring does not beat plain Jaro-Winkler, it stores anchors privately, and that property is itself underspecified until DO-6. The mechanism numbers the abstract bolds (8.19%, 8.25%, 40.78%) are each individually correct but each is the *most favorable* framing of what the paper itself elsewhere concedes. Adjudicated consequence: the paper is not rejected for it, because the underlying measurements and audit table are real, but the abstract must be rewritten before the central gating claims (ME-1) can be believed.

## Not verified / limits of this review

- All implementation-behavior claims (CI assertion on SR-MP seed arguments, `imports.length === 0` enforcement, 18-tool zero-egress CI, WASM byte/export counts, `scripts/eval-gccrc-benchmark.mjs` results) were accepted as stated; no binary, CI log, or results artifact was inspected.
- The four figure PDFs were not opened; caption claims about panel contents (e.g., Fig. 1B plateau of the dumb baseline, Fig. 3B 6,090 vs. 337 false links) rest on the paper's internal consistency.
- The α=0.15/0.20 HC-CRC numbers (ME-2) could not be sourced from any figure caption either; if they exist in a figure, the fix is a pointer, not deletion.
- Whether the identical HC-CRC/E-LTT text in the companion Paper 1 is published, concurrently submitted, or unpublished was not determined; the distinctness finding (JF-1) holds for any of the three cases but its severity varies (most severe if both are under MLSys review simultaneously).
- Statistical re-runs (bootstrap/permutation recomputation from raw TAB spans) were not performed; Seat 2 verified arithmetic against printed tables only, and cross-checked count-level identities (FPR x 1,623, yields x 376, released-fractions x 1,999) where possible.
- The retention figure of 100% (DO-1), E_max values (23.76, 26.84), crossing times (t=64/67, 60/67), and the ICC estimation method (one-way ANOVA? exchangeable correlation under which estimator?) are uncorroborated by any shown computation.
- Data licensing for TAB, `aeslc`, MBPP, Yelp `test_data`, and `pstu-synthetic-secrets` was not checked against the sources; only its absence from the paper is confirmed.
