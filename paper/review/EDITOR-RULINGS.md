# Editor rulings for the revision pass (binding)

These rulings govern every revision agent in this session. The review reports are advisory; this file resolves conflicts.

## 1. Titles (apply exactly)

The founder's standing ruling: titles hit the training-data question first; privacy or mechanism words never lead.

- Paper A (extraction-redaction-benchmark):
  `What Training Data Should Lose: Local Extraction, Redaction, and Fail-Closed Gatekeeping`
- Paper B (graph-grounded-enterprise-corpus):
  `How Training Data Should Look: From Stitched Chunks to Records That Know What They Describe`
- Paper C (local-training-benchmark):
  `What Training Data Should Carry: Local Fine-Tuning, Loss Masking, and the Retrieval That Beats It`
- Paper D (multimodal-sanitization-benchmark):
  `What Training Data Should Keep Out: Multimodal Sanitization and Fail-Closed Release`

Update `\mlsystitle`, `\mlsystitlerunning`, `\hypersetup{pdftitle=...}`, and any self-reference in the text.

## 2. Voice

- No em-dashes. Remove every `---` in prose. Replace with a comma, colon, parentheses, or a sentence split. Keep `--` en-dashes in name pairs (Clopper--Pearson) and numeric ranges.
- State each boundary once, plainly, where the claim is made. Remove meta-commentary about experiment status, "honesty" liturgy, negation-contrast frames ("measured, not promised"), and arguments with a previous draft of the paper.
- Keep the substance of every real limitation. Change the voice, not the scope.
- No Markdown syntax in LaTeX. Use `\textbf{}`.
- Do not add a claim, baseline, citation, experiment, or number that the manuscript and its printed tables do not support.

## 3. Numbers

- Preserve every printed number unless this file or the paper's own table proves it wrong.
- If a number is corrected, say so in the change log with the arithmetic.
- Never convert a non-significant result into a significant one. Never drop a non-significant result from a summary.

## 4. Companion papers (use these exact BibTeX entries where needed)

```
@misc{ardiyansyah2026extraction,
  author = {Ardiyansyah, Gege},
  title = {{What Training Data Should Lose: Local Extraction, Redaction, and Fail-Closed Gatekeeping}},
  year = {2026},
  howpublished = {Companion manuscript}
}
@misc{ardiyansyah2026graphcorpus,
  author = {Ardiyansyah, Gege},
  title = {{How Training Data Should Look: From Stitched Chunks to Records That Know What They Describe}},
  year = {2026},
  howpublished = {Companion manuscript}
}
@misc{ardiyansyah2026localtraining,
  author = {Ardiyansyah, Gege},
  title = {{What Training Data Should Carry: Local Fine-Tuning, Loss Masking, and the Retrieval That Beats It}},
  year = {2026},
  howpublished = {Companion manuscript}
}
@misc{ardiyansyah2026multimodal,
  author = {Ardiyansyah, Gege},
  title = {{What Training Data Should Keep Out: Multimodal Sanitization and Fail-Closed Release}},
  year = {2026},
  howpublished = {Companion manuscript}
}
```

If a paper already has `ardiyansyah2026versieve`, keep the key and replace its title with the Paper A title above.

## 5. Reviewer findings that are WRONG and must not be applied

- Paper D: the review says `+33.35` should be `+43.35`. That is wrong: `79.26 - 45.91 = 33.35`. Keep `+33.35`.
- Paper D: `N_eff = 350` is correct. The artifact's DEFF is `2.6169`, and `916 / 2.6169 = 350.03`; floor is 350. Do not change it to 349.
- Paper A: the review's "14 em-dashes" undercounts. Remove all `---` occurrences found by `grep -o -- '---'`, not 14.
- Paper A: the dataset has 56 tag types, but the evaluation covers the 26 structured types. Both numbers are real; fix the table label, do not change the evaluated denominator.

## 6. Verified artifact facts the reviewers could not see

- Paper D conformal metrics (`testConditionalFprPct`, `testSafeYieldPct`, etc.) are computed on the 1,999 held-out paragraphs (`testUnsafe=1623`, `testSafe=376`). ICC and DEFF are computed on the 67 unsafe calibration rulings. The prose phrase "on this calibration set" is wrong and must become "on the held-out paragraphs".
- Paper D, Table 2 missing rows (from `results/reviewer-tab-and-ltt-benchmarks.json`):
  - HC-CRC alpha 0.15: FPR 12.57, Auto-Rel 23.46, Safe Yield 70.48, E2E Leak 40.72 (191)
  - HC-CRC alpha 0.20: FPR 15.77, Auto-Rel 26.51, Safe Yield 72.87, E2E Leak 44.72 (237)
  - E-LTT alpha 0.15: FPR 10.10, Auto-Rel 20.91, Safe Yield 67.55, E2E Leak 38.52 (161)
  - E-LTT alpha 0.20: FPR 15.77, Auto-Rel 26.51, Safe Yield 72.87, E2E Leak 44.72 (237)
- Paper D non-PII retention: the benchmark counts 59 pre-declared non-PII context words across the 25 calls and checks whether the attacker ASR still recognizes them in the redacted audio; 100% are retained.
- Paper D E-LTT betting fraction: the implementation uses a predictable Kelly-bounded fraction, `gamma = min(gamma_max, max(0.35, 0.75 / max(0.10, alpha + 0.05)))`. State this in Exp. 2 so `E_max` is re-derivable.
- Paper D arithmetic: `86.27 - 74.20 = 12.07`, so the PERSON gap versus Dev-Filtered GLiNER is `+12.07`, not `+11.36`. `79.26 - 45.91 = 33.35` is correct.
- Paper A tag labels: `ai4privacy-200k` has 56 span categories; the paper evaluates the 26 structured token types (180/580). Table 1 should say so.

## 7. Cross-paper scope

- Paper A is the systems paper for extraction, redaction, conformal gatekeeping, and runtime substrates. Its Track C / LoRA / canary section (5.3) duplicates Paper C. Compress 5.3 to a short pointer citing `ardiyansyah2026localtraining`; keep the substrate and scaling results that are unique to A.
- Paper A's HC-CRC / E-LTT paragraph duplicates Paper D without evaluation. Replace it with a one-sentence pointer citing `ardiyansyah2026multimodal`.
- Paper C is the full study for local fine-tuning, PT-LM, and retrieval. It keeps its Track C / CAG / canary material.
- Paper D is the home of HC-CRC and E-LTT evaluation. It keeps them.
- Paper B is distinct; no scope cut is required.

## 8. Compilation

Run `latexmk -pdf -interaction=nonstopmode -f <file>.tex` twice. The build must exit 0 with no undefined references or citations. Record the page count. Do not leave aux files inconsistent.

## 9. Paper B specific rulings (graph-grounded corpus)

B is a Major Revision. The paper's measurements stand; its framing does not. Re-center the paper on schema, erasure receipts, and routing. Demote the training-format comparison to the null result the paper's own tests report.

### B1. Abstract (replace it; keep every number)

Use this text, adjusted only for line wrapping:

> Enterprises turn scattered, heterogeneous documents into fine-tuning data by positional chunking: slice each file into windows, concatenate, train. The result is text that does not know what it describes: no record of which entities a sample mentions, no shared identity across documents, no byte-level provenance, and no way to remove one person's data exactly. This paper presents a graph-grounded training corpus in which every sample is standalone knowledge: a record that knows its entities, their classes, and the source byte-ranges it came from, built by a zero-host-import, zero-egress pipeline of five WebAssembly kernels totaling $388{,}797$\,B, with values vaulted behind salted placeholders by default and a per-sample certificate bounding residual detectable PII at a stated confidence. Erasure is measured on the corpus half: deleting an entity regenerates the corpus with a byte-diff of exactly that entity's spans; the adapter half is a sealed retrain recipe whose GPU measurements are not reported here. The measured comparison runs on a noisy 115-document estate with 60 manifest questions, ten arms, and one token budget capped at $25{,}755$ tokens. Retrieval over the entity graph, with no fine-tuning, answers $53.3\%$ exactly ($83.3\%$ on the 24-question cross-document stratum); a lexical BM25 control answers $60.0\%$, numerically above it and within noise at $n{=}60$. Trained formats sit near the base: the composed corpus reaches $11.7\%$ and per-block $10.0\%$, with McNemar $p{=}1.00$ between them, so this study makes no trained-format claim. Routing each question's cache to the asked person's own records, given a correctly resolved identity rather than resolving it, answers $81.7\%$; that is an upper bound on the router, because end-to-end routing on the engine's own resolution is not measured here. All results are construction-validation on synthetic or overlay estates at one 1.5B-parameter, capacity-starved scale, and the certificate is detector-closed, not differential privacy. False merges amplify by a factor of $14.32$ when resolution is wrong, and co-mention reuse makes every composed sample part of a near-duplicate pair (fraction $1.0$).

Delete from the abstract: "the best trained format", "never behind", "ties it", "the strongest arm measured", "its three GPU-dependent measurements pending, with no placeholder values shown".

### B2. The null result

Anywhere the paper says composed is "best", "never behind", or "ahead" without the test, replace with: composed $11.7\%$ versus per-block $10.0\%$ do not separate at $n{=}60$ (McNemar $p{=}1.00$); composed versus base is $p{=}0.07$; no trained-format comparison separates. Keep the one-question disambiguation observation but label it as one question. Do not delete the limitation that this is one run at one starved budget.

### B3. The 81.7% arm

Keep the number. Every mention must carry its condition in the same sentence: the router is given a correctly resolved identity; it does not resolve. Add one sentence in Section 7: "End-to-end routing on the engine's own resolution is not measured in this paper; 81.7% is therefore an upper bound on the routing arm, not a deployment measurement." Do not invent an end-to-end number. In the conclusion, replace "the strongest measured arm" with "the routing upper bound".

### B4. Table 3 protocol split

Split the ten arms into two tables, or one table with an explicit protocol column: trained arms (exact match plus two judges) and non-training arms (exact match only). State the non-training scoring protocol once as design. Delete every run-provenance phrase: "added by the second run", "intentional notches", "their judge cells are intentional notches ($--$)". Do not re-score anything. Mark the CAG set-cover row as an evaluation-informed upper bound in its caption, next to the number.

### B5. Recipe selection

At the sealed-recipe sentence, add: "The 18-combination epoch and learning-rate sweep belongs to the companion local-training study~\cite{ardiyansyah2026localtraining}; it selected on that study's compliance QA, not on the 60 manifest questions used here, and the recipe was fixed before this head-to-head ran." If the artifact does not support "compliance QA", write "on that study's own evaluation set" instead. Do not claim a disjointness the artifact does not record.

### B6. Artifact availability

Add one paragraph at the end of the measurement setup:

> Artifact availability. Every number in this paper is emitted by a checked-in runner in the project repository (\url{https://github.com/gegearsyah/versieve}); the result JSON files carry the corpus SHA-256, the engine-version SHA-256, and the seed. The submission package pins the repository commit and lists the per-kernel SHA-256 values for the five WebAssembly kernels and the checkpoint identifiers for Qwen2.5-1.5B-Instruct and the two judge models.

Do not invent a commit hash, a DOI, or a license. Note in the change log that the author must paste the actual commit and kernel hashes into the submission package.

### B7. Bound convention

At first use of the certificate, state once: "All bounds are one-sided 95% Clopper-Pearson bounds. The certified lower bound of $81.7108\%$ is the one-sided bound on $23/24$ (the two-sided bound is $78.88\%$); the per-class bounds assume zero detected misses against manifest ground truth."

### B8. Count reconciliations (use these exact derivations)

- 24 versus 76: the artifact's coverage note says ground-truth entities are canonical (a person is one entity: name + email + phone), while the corpus indexes each distinct detected value as its own salted engine entity. Add that sentence where 76 first appears. Do not change either number.
- 1,106 versus 1,113: these are two builds of the same composition policy. The equal-budget training arm receipt records $1{,}106$ samples (corpus SHA-256 `32fa477f...`); the failure-mode analysis records $1{,}113$ (corpus SHA-256 `9290b008...`). Add one clause naming them as separate receipted builds and state that no claim compares counts across them. Do not assert a cause the artifact does not record.
- 14.32: the artifact's unrounded rates are $0.321364$ and $0.022442$; their ratio is $14.32$. The paper's rounded rates divided give $14.35$. Print the raw fractions parenthetically at the factor, or print the rates to six decimals. Keep $14.32$.
- Cross-department linking: scope the 54/54 claim to the IT and business sides, which is what was verified; do not let it read as all four departments.

### B9. Citations (add only these; do not invent identifiers)

Add minimal, correct entries at first use:
- Learn-Then-Test: Angelopoulos, Bates, Cand\`es, Jordan, Zrnic, "Learn then Test: Calibrating Predictive Algorithms to Achieve Risk Control," arXiv:2110.01052, 2021.
- Clopper--Pearson: Clopper and Pearson, "The Use of Confidence or Fiducial Limits Illustrated in the Case of the Binomial," Biometrika 26(4):404--413, 1934.
- MinHash: Broder, "On the Resemblance and Containment of Documents," Compression and Complexity of Sequences, 1997.
- Dedup: Lee et al., "Deduplicating Training Data Makes Language Models Better," ACL 2022.
- B-cubed: Bagga and Baldwin, "Algorithms for Scoring Coreference Chains," LREC 1998.
- PPRL/ER: Christen, "Data Matching," Springer, 2012.
- PPR: Haveliwala, "Topic-Sensitive PageRank," WWW 2002.
- BM25: Robertson and Zaragoza, "The Probabilistic Relevance Framework: BM25 and Beyond," Foundations and Trends in Information Retrieval 3(4):333--389, 2009.
- Amnesiac ML: Graves, Nagisetty, Ganesh, "Amnesiac Machine Learning," AAAI 2021. Differentiate in one sentence: exact deterministic regeneration differs from amnesiac retraining, which forgets batches without a byte-diff receipt.

If any entry's venue or year is uncertain, cite author, title, and year only. Never invent an arXiv ID or DOI.

### B10. Governance paragraphs (short, factual)

- Readable view: "The operator is accountable for the lawful basis of the opt-in. The readable export carries no certificates. Erasure of a readable-derived adapter follows the retrain path, not corpus regeneration."
- Salt lifecycle: "The operator holds the workspace salt. Salt compromise permits offline confirmation of guessed low-entropy values; different salts make the same value unlinkable across workspaces. Rotating the salt changes every identifier and therefore invalidates stored receipts unless receipts are versioned against the salt."
- Deployment costs, one short paragraph: per-sample certificate computation, vault and salt custody, and the receipt a data subject can receive; third-party verification is a re-run of the pinned build against the recorded corpus hash.

### B11. Composition's standing

Add one sentence at the end of Section 6 or in Section 10: "On the measurements reported, the deployment-recommendable artifact is the per-block corpus plus the entity index plus the router: the same erasure receipts and routing gain, without the $14.32\times$ amplification or the near-duplicate corpus. Composition remains a view to test at larger budgets." Then make Section 10 state each boundary once, not as a list of disclaimers.

### B12. Style

Remove all `---` in B's .tex and in B's .bib (the GDPR entry contains one). Remove "receipts, not prose claims" self-definitions, "Two honesty measurements", "recorded, not smoothed", and the abstract bookkeeping. Keep the facts. Fix the missing thousands separator `$16607$` to `$16{,}607$`. Fix the three overfull hboxes flagged in the log (widen Table 1 or abbreviate metric names).
