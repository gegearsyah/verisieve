# Paper D revision change log (multimodal-sanitization-benchmark)

Build: `latexmk -pdf -interaction=nonstopmode -f` run twice, both exit 0, no undefined references or citations, zero overfull boxes. Final page count: 9 pages (was 10). `grep -- '---'` on .tex and .bib: 0. `grep '\*\*'` on .tex: 0.

## 1. Title

- Old: `Versieve-MM: Zero-Import WebAssembly Multimodal Enterprise Sanitization, Ground-Truth Conformal Gating, and Noisy Cross-Modal Erasure`
- New: `What Training Data Should Keep Out: Multimodal Sanitization and Fail-Closed Release`
- Applied to `\mlsystitle`, both `\mlsystitlerunning` occurrences, and `\hypersetup{pdftitle=...}`. Running title: `What Training Data Should Keep Out: Multimodal Sanitization`.

## 2. Calibration vs held-out (ME-1) — wording fixed, no numbers changed

- Sec. 4.2 prose: "certifying at α=0.01 as well (0.18% FPR, 32.98% Safe Yield) **on this calibration set**" -> "**on the held-out paragraphs**".
- Table 2 caption rewritten: performance columns (FPR, Auto-Rel., Safe Yield, E2E Leak) attributed to the 1,999 held-out paragraphs (1,623 unsafe, 376 safe across 127 rulings, δ=0.05); ICC=0.1276 and DEFF=2.62 attributed to the 67 unsafe calibration rulings on which λ is certified.
- Figure 1(B) caption now says "ICC=0.1276 and DEFF=2.62 estimated on the 67 unsafe calibration rulings".
- No metric value changed anywhere.

## 3. Table 2: alpha 0.15 / 0.20 rows added (ME-2)

From ruling section 6, verbatim:

| α | Regime | FPR | Auto-Rel | Safe Yield | E2E Leak |
|---|--------|-----|----------|------------|----------|
| 0.15 | HC-CRC | 12.57% | 23.46% | 70.48% | 40.72% (191) |
| 0.15 | E-LTT  | 10.10% | 20.91% | 67.55% | 38.52% (161) |
| 0.20 | HC-CRC | 15.77% | 26.51% | 72.87% | 44.72% (237) |
| 0.20 | E-LTT  | 15.77% | 26.51% | 72.87% | 44.72% (237) |

Existing naive rows kept. Table is inside `\resizebox{\columnwidth}`; no rows dropped. The prose sentence "12.57% ≤ 15%, and 15.77% ≤ 20%" now has table support; "across every budget" kept for the same reason.

Also (ME-6): caption adds one clause — rows sharing an identical numeric quadruple arise from the same certified λ (e.g., HC-CRC at α=0.01 and E-LTT at α=0.05).

## 4. Arithmetic (ME-3)

- Limitations item 1: `+11.36` -> `+12.07` for PERSON versus Dev-Filtered GLiNER: `86.27 - 74.20 = 12.07`. The sentence now names each base: All-Maskable delta is versus the Hybrid edge system (`79.26 - 45.91 = 33.35`), PERSON delta versus Dev-Filtered GLiNER (`86.27 - 74.20 = 12.07`).
- `+33.35` kept (reviewer's +43.35 was wrong: 79.26 - 45.91 = 33.35).
- `N_eff = 350` unchanged (916 / 2.6169 = 350.03; reviewer's 349 was wrong).

## 5. Non-PII retention defined (DO-1)

- Before: undefined "100% non-PII speech retained" in abstract, Exp. 4, Fig. 3 caption, wrong-record bullet.
- After: defined at first body use in Exp. 4: "Non-PII retention is a pre-declared word-recall count, not a claim that all non-PII speech survived: the benchmark declares 59 non-PII context words across the 25 calls and checks whether the attacker ASR (small.en) still recognizes each of them in the redacted audio." Abstract now says "the attacker transcription still recognizes 100% of the 59 pre-declared non-PII context words". Wrong-record bullet reads "non-PII retention (all 59 words)"; Fig. 3 caption reads "with all 59 pre-declared non-PII context words retained". Value (100%) unchanged.

## 6. E-LTT betting fraction (ME-5)

- Added in Sec. 4.2 after the Ville supermartingale: "the implementation uses a predictable Kelly-bounded betting fraction γ_m = min(γ_max, max(0.35, 0.75 / max(0.10, α + 0.05))) with a fixed cap γ_max < 1, so every reported E_max is re-derivable from the cluster losses."
- The sequential conditional-mean validity sentence was already present and is unchanged.

## 7. Claim scope (JF-1)

- Abstract contribution (2): "(2) HC-CRC and E-LTT, which this paper **formulates and evaluates** (the gatekeeper formulation is shared with the companion extraction study, \cite{ardiyansyah2026extraction}) ..." (was "makes three contributions: ... HC-CRC ..." implying novel mechanism).
- Scope of Novelty item (2): "Versieve-MM introduces ..." -> "Versieve-MM contributes ... which this paper formulates and evaluates ...; the gatekeeper formulation is shared with the companion extraction study \cite{ardiyansyah2026extraction}, and the empirical validation on human-annotated TAB rulings, including the measured design effect and the naive-i.i.d. overshoot correction, is new to this paper."
- Bib: added the four companion entries from rulings section 4 (`ardiyansyah2026extraction`, `ardiyansyah2026graphcorpus`, `ardiyansyah2026localtraining`, `ardiyansyah2026multimodal`). `ardiyansyah2026verisieve` key kept; its title replaced with Paper A's title and `howpublished` set to "Companion manuscript" (was "Technical Report, Versieve Project"). No fine-tuning comparison exists in D, so `\cite{ardiyansyah2026localtraining}` is not cited in text.

## 8. Markdown leak

- Exp. 5: `**plaintext non-private ceilings**` -> `\textbf{plaintext non-private ceilings}`. No other `**` existed.

## 9. Voice (DA-2)

- "Seven honest lessons" -> "Seven findings".
- "the original answer-key-seeded run is superseded and archived in the results artifact" deleted (the CI seed-assertion statement is kept).
- "Four anchor-quality conditions complete the honest picture" -> "...complete the comparison".
- "Recall remains honestly 56.55%" -> "Recall is 56.55%".
- Conclusion "Evaluating honestly against strong third-party baselines confirms" -> "Evaluation against strong third-party baselines confirms".
- JW-parity caveat stated once: kept in the abstract ("a plain Jaro-Winkler baseline on the same anchor list reaches 7.22%, so the salted ring's contribution is anchor privacy, not matching accuracy"); removed from the Fig. 3 caption, Limitations item 3, and the conclusion; the Exp. 4 Jaro-Winkler row remains as a measured condition, not editorializing. Every real limitation (TTS-only audio, PE­M/MBPP fixtures, Bloom cryptanalysis, Presidio loss, heuristic HC-CRC, E-LTT fail-closed at α ≤ 0.02) is retained.
- The Presidio loss statement is kept in abstract, lessons (i)/(iii), Limitation 1, and the conclusion.
- "conservative heuristic, not a proven finite-sample guarantee" now appears once (Sec. 4.2); Limitation 2 points to Sec. 4.2 instead of restating it.

## 10. "Paper 1" house numbering (JF-4)

- Abstract: "+28.65 F1 over Paper 1 regex" -> "+28.65 F1 over the companion regex baseline"; abstract also drops "0% clean FP" (the 0/375 clean-FP fact stays in Exp. 3 with its corpus caveat, DO-3).
- Lesson (iv): "over Paper 1 regex" -> "over the companion regex baseline".
- Table 1 row: "Paper 1 Regex+Lexicon" -> "Companion Regex+Lexicon \cite{ardiyansyah2026verisieve}".
- Sec. 2.2: "fuses Paper 1 regexes" -> "fuses the companion text pipeline's regexes \cite{ardiyansyah2026verisieve}".

## 11. Em-dashes (JF-3) — all `---` removed (18 occurrences in 14 lines), `--` kept

- Abstract: "containers---emails" -> "containers: emails"; "detections---though" -> "detections, although".
- Table 1 τ=0.70 CI placeholder `\scriptsize{---}` -> `\scriptsize{--}` (missing-CI marker, ME-7 adjacent).
- Fig. 1 caption: "F1---the ring's ... (p=0.0002)---and" -> commas.
- Lessons (vi)/(vii): ") ---so" and ") ---the ring's" -> semicolons/commas.
- Sec. 4.2: "correlated documents---guarantee-based" -> semicolon; "at α=0.10---and certifying" -> "and certifying".
- Exp. 4 bullets: five ") ---" -> comma/semicolon.
- Exp. 5: "(...)---3.7x fewer" -> comma; "bounded memory---inspired...perception---we compile" -> parentheses.
- Conclusion: "legal text---while" -> comma.
- .bib had no `---`.

## 12. Zero-egress vs zero-import registers (PE-1)

- Fig. 1 caption: "End-to-end Versieve-MM zero-egress architecture" -> "End-to-end Versieve-MM architecture: a zero-import kernel in a local-only stack."
- Sec. 2.1 adds one sentence separating the registers: load-time import surface is mechanically verified; no network calls in the rest of the stack is a construction property asserted by CI test counts.
- Appendix: "18 zero-egress tools, verified by Node.js CI (108/108)" -> "18 tools, verified by the local test suite (Node.js CI 108/108, ...)".
- Conclusion: "when zero-egress constraints prohibit server-side stacks" -> "under local-only constraints that prohibit server-side stacks".

## 13. Accuracy ranking and fixture wording (DO-3)

- Exp. 3 now states the F1 ranking supported by Table 3: "By F1, Yelp detect-secrets leads (86.27%), verisieve_media.wasm sits between (72.25%), and Gitleaks trails (66.36%)". The 0/375 clean-FP rate is reported with its corpus caveat (all three scanners; MBPP short scripts), and the abstract no longer headlines it.
- "fixture quirk" -> "likewise concentrated in our fixtures' single-line PEM headers (0/35)" (fixture-set attribution).

## 14. Citations for named baselines (DO-7)

- Added at first use: `\cite{gitleaks2025}` and `\cite{yelp2018detectsecrets}` (Table 2/datasets row), `\cite{radford2023whisper}` (Exp. 4 Whisper transcriber), `\cite{knowledgator2025glineredge}` (lesson (i), the 45.8 MB GLiNER-Edge model), `\cite{zhang2019aeslc}` (Enron micro-benchmark row). No new entries invented; `ai4privacy2023`, `jin2019pubmedqa` remain unused in the .bib.

## 15. Reproducibility statement (ME-8, partial)

- Sec. 3 adds: "Every number printed in the tables below is emitted by a checked-in runner in the project repository (\url{https://github.com/gegearsyah/verisieve}), whose result JSON files record the corpus identifiers and run outputs behind this paper; per-experiment random seeds are not yet recorded in those files, so exact resampling re-runs are pending."

## 16. Overfull box

- The pre-existing overfull display equation (SR-MP score, log line 960, 78.9pt over) is now wrapped in `\resizebox{\columnwidth}{!}{...}`; the build reports zero overfull boxes.

## Numbers verified / unchanged

- +33.35 kept: 79.26 - 45.91 = 33.35 (review did not change it; ruling 5 confirms).
- +12.07: 86.27 - 74.20 = 12.07 (was +11.36; corrected with arithmetic shown in section 4 above).
- N_eff = 350 kept: 916 / 2.6169 = 350.03.
- All Table 2 values, including the four added rows, unchanged from the artifact values in ruling section 6.
- Conformal metric values not re-labeled as calibration results anywhere.

## Unresolved

1. DO-4 (MAJOR): no second independent published TAB baseline and no Presidio+SR-MP combination row; requires new runs the artifact does not contain. Not fabricated.
2. DA-3 (MINOR): no guarantee-based hierarchical baseline (Dunn et al. two-layer split) run on the same 67/127 split. Requires a run.
3. ME-7 (MINOR): the τ=0.70 SR-MP F1 CI remains a `--` placeholder (no CI in the artifact), and the permutation-test resample count (5,000 per review) is not printed anywhere the paper can verify; left as-is rather than inventing.
4. ME-8 (MAJOR, remainder): seeds, per-corpus licenses, and a hardware model/laptop spec are not in the paper and could not be sourced from the artifact; the artifact-availability paragraph added covers runners and result JSONs only. The repo commit hash and kernel SHA-256s still need to be pasted into any submission package (see rulings B6 note).
5. DO-5 (MAJOR, remainder): the ring FP-rate measurement and concrete Eq. (1) parameter defaults (γ, β, the distance d) are not in the artifact; the audio claim stays scoped to clean synthetic TTS speech (Limitation 3), but the FP-rate row would need a run.
6. JF-5 / PE-2 (MINOR): no added systems-efficiency paragraph or stakeholder paragraph; the instruction set did not direct these and they would need new material beyond the rulings.
7. `alpha` provenance: the new 0.15/0.20 rows come from the ruling's artifact JSON (`results/reviewer-tab-and-ltt-benchmarks.json`); the LaTeX cites no separate result file beyond the repo runners.

## Post-review artifact fill (coordinator)

Item 3 is half closed: the paired permutation count is now printed at Fig. 1 (5,000 permutations), but the tau=0.70 SR-MP F1 CI is still absent from the artifact and remains a placeholder. Item 4 is partly closed: the artifact paragraph now states commit `1e35603`, the TAB resampling seed 42, 1,000 bootstrap resamples, and 5,000 paired permutations. Per-corpus licenses and non-TAB seeds remain unrecorded.
