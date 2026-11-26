# Paper C revision changes (versieve-local-training-benchmark)

Scope: `paper/versieve-local-training-benchmark.tex` and `.bib` only. Applied: EDITOR-RULINGS.md (binding) + all CRITICAL/MAJOR findings from `review/C-local-training-review.md`, plus the revision-agent instructions. Build: `latexmk -pdf -interaction=nonstopmode -f` run twice, exit 0 both times, 10 pages, 0 undefined references/citations, 0 overfull boxes, 0 `---` in .tex and .bib (grep-verified).

## 1. Title
`\mlsystitle`, both `\mlsystitlerunning`, and `\hypersetup{pdftitle}`:
- old: `Versieve: Benchmarking Sanitized Data for Local Open-Weight Model Training and Retrieval` / running `Versieve: Benchmarking Sanitized Data for Local Model Training`
- new: `What Training Data Should Carry: Local Fine-Tuning, Loss Masking, and the Retrieval That Beats It` / running `What Training Data Should Carry: Local Fine-Tuning and Loss Masking`

## 2. Reframe (CRITICAL S5.1 / R1)
Abstract and conclusion rewritten. The abstract now opens with the training-data question and ends: "zero-training retrieval remains the stronger default at this scale ... PT-LM's niche is therefore the case where weight-held redacted fine-tuning is required for reasons outside QA: offline or re-indexing-free deployment." The conclusion's "In short, ... delivers the strongest accuracy-latency Pareto frontier" bullet run became: "The deployment reading is therefore conditional rather than universal", retrieval as default, PT-LM niche named for weight-held offline/re-indexing-free generation. Retrieval is a first-class finding, not a footnote; every number kept (8.25--8.40, 2.63--3.51, 6/12 Rank-1, 11/12→0/12, Δ=0.0%, −0.062, 11.8×--16.6×, 69.0%/62.0%, 75.0%, p=0.0005, 18.8→36.2, 6.2→16.2, 17.5→25.0, 0.077→0.271, 0.103→0.190, 0.083→0.200, all three p-values).

## 3. Significance honesty (S2.3, S3.1, R5, R6)
- Abstract: "+251\% (p=0.0005) and +84\% (p=0.001) on the Qwen models, and 0.083→0.200 on LFM3-1.7B, which is not significant (p=0.083)". Conclusion: "significant on both Qwen models (p=0.0005 and p=0.001) and not significant on \texttt{LFM3-1.7B} (p=0.083)".
- LFM3 PT-LM Rank-1 written once as "2/12 against its base's 1/12, a one-question difference" (Section 5.1 and conclusion bullet 1). Neither described as a win; rank-1 memorization explicitly "reduced across models but not eliminated".
- The 0/12 Rank-1 cell is always scoped to Qwen2.5-1.5B and paired with the 2/12 context.
- Abstract false-refusal range corrected to 20\%--47.5\% (was 30--47.5, omitting LFM3's 20\%; conclusion already had 20).
- "six open-weight models" → "three fine-tuned models ... plus three quantized Ollama inference comparators" (abstract, conclusion).

## 4. Mechanism rename (S2.2, S5.2, R3)
"Redaction-Token Subspace Hijacking" (3 occurrences) → "placeholder-token gradient domination" (abstract, Section 4.2 bullet, Section 5.2 item 1). Added immediately after the definition: "The name is operational: gradient allocation into the placeholder subspace was not measured directly, and a surface-format imitation account, in which the adapter copies a frequent literal string present in the targets, predicts the same tag echoes and is removed by the same fix. No measured mechanism is claimed." The Section 5.2 item now says the mechanism "correlates with" the echoes, and the conclusion says the changes "are measured rather than the placeholder-subspace account itself".

## 5. PT-LM attribution to the bundle (S2.1, R4)
- Removed the implication that PT-LM introduces abstention turns ("while retaining zero raw PII in $\texttt{input\_ids}$ and scope-balancing abstention turns" → "...$\texttt{input\_ids}$. The abstention turns are the same $10\%$ explicit abstention turns already present in both \texttt{T2-Chat} arms."; Section 5.2 now says "the $10\%$ abstention turns shared by both arms induce $20.0$--$47.5\%$ in-scope false refusals").
- New limitation bullet: "The PT-LM comparison is attributed to a bundle, not to masking alone: the ablation changes backward loss masking and forward-surrogate substitution together, and a masking-only run (Safe data with masking, no substitution) is not available in this paper. The shared 10% abstention turns mean the false-refusal drop may also carry a data-level component common to both arms." Cross-referenced from abstract item 1 in Section 5.2.

## 6. Canary wording (S2.5, R7)
- Abstract: "no adapter exceeds its base exposure, with the smallest margin $0.03$ bits (\texttt{LFM3-1.7B}, $80$ steps, $1\mathrm{e}{-4}$) reported without an interval."
- Section 5.3 and Table 4 caption: "the smallest margin is $0.03$ bits (\texttt{LFM3-1.7B}, $80$ steps, $1\mathrm{e}{-4}$: $4.49$ against $4.52$), a difference of two means over $12$ canaries each and reported without an interval." Conclusion bullet 1 carries the same sentence. Caption's flat "No trained adapter exceeds its base" replaced by the precise statement.
- Causal gloss softened: "Longer training does not buy memorization because the secrets are absent from the training bytes, not merely down-weighted" → "This is consistent with the secrets being absent from the training bytes as a matter of data design; the grid varies the PT-LM arm only, so it does not by itself rule out a long-budget effect in the Raw arm" (S3.5).

## 7. Grid abstention claim corrected (S4.1)
- old: "$160$--$240$-step adapters reach $10.0\%$--$80.0\%$"
- new: "every $80$-step adapter abstains on $0.0\%$ ... abstention reaches up to $80.0\%$ at $240$ steps (peak: \texttt{Qwen2.5-1.5B} at $240$ steps, $2\mathrm{e}{-4}$), and several $160$-step adapters remain at $0.0\%$ (both learning rates on \texttt{Qwen2.5-0.5B} and the $1\mathrm{e}{-4}$ point on \texttt{Qwen2.5-1.5B})"
- Arithmetic: Table 4 has three 160-step rows at 0.0\% (0.5B 160/2e-4, 0.5B 160/1e-4, 1.5B 160/1e-4), so the old "160--240-step adapters reach 10.0--80.0\%" was false for those rows; the maximum (80.0\%) matches the 1.5B 240/2e-4 row.
- Added operator warning: at the main 80-step recipe refusal must come from the retrieval layer or a classifier (S4.1/R10).

## 8. Untested superlatives (S2.4, R8)
- "surpassing both Base $0.145$ and Raw $0.129$" → "numerically above Base $0.145$ and Raw $0.129$; the \texttt{PT-LM} interval $[0.127, 0.175]$ overlaps the Base interval $[0.129, 0.164]$, no test is run against Base, and the rise is not claimed as significant."
- Judge-score doubling: numbers kept as raw pairs (the 2.6x/1.4x 0.5B and LFM3 multipliers now visible as pairs), plus "these judge-score differences are reported without a confidence interval" (Section 5.2, and Section 3.3 states the summary cells carry no interval).
- Statistics sentence now states the pairing unit (shared question set) and that "permutation $p$-values are reported uncorrected" (S2.9, R8; no corrected p-values invented).

## 9. Meta-commentary removed (S5.6, R13)
- Deleted: the planned-DeepSeek-swarm sentence and its "deviation recorded in the sweep artifact; the swarm votes backfill on a re-run".
- Rewrote "The obvious objection is under-training" (negation-contrast frame) to a plain statement ("Longer training would give the adapter more exposure...").
- Removed "committed fair-shot receipts" → "the main-suite $80$-step result".
- T1 demoted to one design-motivation sentence in Section 5.1 (all T1 numbers kept: 90--92\% collapse, 45--46/50 empty, 4.45→8.54 bits, 5/12 vs 0/12 Rank-1) and the T1 bullet stays in Section 4.2; T1 removed from the abstract and from research question 2.
- "superseded and archived": absent from this manuscript; instruction moot.
- API cross-check absence: stated once in limitations ("No API-based cross-check of the blinded local judges was run; the two local judges disagree (row-level agreement on the partial-credit threshold between $31.4\%$ and $62.9\%$ on the grid)").
- Added limitation that each adapter cell is a single training run with no seed variation (fact of the printed tables).

## 10. Hybrid-arm anomaly (S2.7, R14)
New paragraph after the Section 5.2 findings: the T3-Chat+PPR hybrid collapses on 1.5B (0.092 F1, 90.0\% refusals, 3.8\% judge) yet reaches 0.242 F1 (best closed-book cell on LFM3), its held-out tag echo (2--8\%) sits far below its Safe parent's (18--28\%), the harness does not explain it, and the paper's utility claims rest on the T0+Graph-PPR vs closed-book gap.

## 11. Denominators
First use now "$0$ of $210$: three models $\times$ $70$ questions" (abstract and Section 5.2). Arithmetic: 3 models x 70 questions = 210; 210 = 50 held-out + 20 seen responses per model. ✓

## 12. Companion positioning (R2 partially; editor ruling 7 wins)
- Introduction: one sentence citing `\cite{ardiyansyah2026extraction}` for the extraction/redaction pipeline.
- Section 3: one sentence citing `\cite{ardiyansyah2026multimodal}` for the gatekeeper.
- Bib: added the two exact `@misc` entries from EDITOR-RULINGS section 4 (`ardiyansyah2026extraction`, `ardiyansyah2026multimodal`).
- Per ruling 7, the Track C / CAG / canary material (Sections 5.4, 5.5, Tables 3, 5) is NOT cut; this paper is its home. The review's R2 compress-to-pointer instruction is therefore overridden where it conflicts.

## 13. Artifact availability
New `\paragraph{Artifact availability.}` at the end of Section 3.3: every table emitted by a checked-in runner in \url{https://github.com/gegearsyah/versieve}; the recipe-grid sweep JSON and adapter metadata included with the submission. No commit hash, DOI, license, HF revision, or checkpoint-release claim invented.

## 14. Fair-shot defined (S5.4)
Added at the T2-Chat bullet: fair-shot means matched compute and recipe budget across arms, not matched information access (636 rows vs 22,539 indexed chunks that retrieval sees at inference). Added the grid's best strict-judge cell (45.0\%, LFM3 160/1e-4, still below T0+Graph-PPR's 52.5\%) as the explicit rebuttal of an under-training objection.

## 15. "Zero-accuracy-loss" replaced (S4.2, R10)
Conclusion bullet 3: "Redacted retrieval preserves accuracy rather than being free: it matches raw unredacted compliance QA accuracy on \texttt{qwen2.5:7b} ($75.0\%$, $\Delta=0.0\%$) at a measured lexical cost ($-0.062$ F1), whose downstream failure mode is the regex-over-masked legal phrase shown in Table~\ref{tab:prompt-examples}." Final-paragraph "zero-accuracy-loss security boundary" removed.

## 16. Related-work position (S5.5)
Section 2 now opens the contribution with the replication-amplification framing (extends ovadia2023finetuning / mallen2023when / kandpal2023longtail to 0.5--1.7B on one 8 GB GPU with a privacy twist). Em-dash in that paragraph removed.

## 17. Style
- All 27 `---` occurrences removed: prose ones (abstract x2, Section 2, Section 3.3 x2, Section 5.2, conclusion x3 in 339/344) replaced with commas/parentheses/sentence splits; the 20 Table 2 N/A cells `(---)` → `(--)` with a caption note that "--" marks arms the third judge did not grade. `--` en-dashes kept everywhere else (0---46, Clopper--Pearson-style ranges unaffected). `.bib` had zero `---`.
- No Markdown in LaTeX; `\textbf{}` used.

## 18. Overfull box fixed
Table 2 was 27.4pt overfull after the abstract/intro edits era (16.6→11.2pt across retries). Fixed by: `\tabcolsep` 2.9→2.0pt, stacking the two long judge headers with `\shortstack`, and shortening condition labels (Base / Raw / Safe / PT-LM / T3-Chat+PPR / T0+Graph-PPR) with the full names spelled out in the caption. Log now reports 0 overfull boxes.

## 19. Count fix
Section 5.2 lead said "Four findings emerge" while enumerating three items; changed to "Three findings" (the hybrid anomaly is a flagged paragraph, not a numbered finding).

## Arithmetic notes
- $4.52 - 4.49 = 0.03$ bits (grid margin, as printed).
- $0.200-0.083 = 0.117$; $0.117/0.083 = +141\%$ ✓ (kept). $0.271-0.077=0.194$; $0.194/0.077=+252\% \approx +251\%$ (printed, kept). $0.190-0.103=0.087$; $0.087/0.103=+84.5\%$; the paper prints $+83.8\%$, kept as printed (possible rounding path in the artifact; see Unresolved).
- Judge multipliers: $16.2/6.2 = 2.6\times$, $36.2/18.8 = 1.9\times$, $25.0/17.5 = 1.4\times$; "nearly doubling" is now replaced by the three raw pairs, and only the 1.5B pair was ever "nearly double".
- Rank-1 LFM3: $2/12 - 1/12 = 1$ question.
- $12 \times 18 = 216$; grid has $18$ adapters $\times\, 5$ metrics as printed ✓.

## Unresolved
1. Masking-only ablation (Safe data + loss masking, no forward substitution) not run; the attribution to the mask+substitute bundle is stated in Section 4.2 and Limitations. Needs one run per model by the author.
2. No API-based cross-check of the judges; stated once in Limitations. Any correction awaits that re-run.
3. $+83.8\%$ for $0.103 \to 0.190$ is arithmetically $+84.5\%$ from the printed F1s; kept as printed per the preserve-numbers ruling (the artifact may round from raw counts). Author should confirm against the artifact.
4. No BM25 or dense-retrieval arm exists; the comparison is scoped in Limitations instead of adding a baseline (zero-GPU arm still available to the author).
5. Seeds, framework versions (transformers/peft, Python), wall-clock hours, and QA-turn authorship provenance are not recorded in the manuscript or artifacts I could see; not invented. The artifact-availability paragraph names the repo where the runners live.
6. The "superseded and archived" phrase from the instruction list does not exist in this manuscript; treated as a Paper-D artifact of the instruction list.
7. The submission package must carry the actual sweep JSON/adapter metadata; the paragraph says "included with the submission" as instructed, and the author must make that true at packaging time.

## Post-review artifact fill (coordinator)

Item 3 is closed: the three derived percentages were replaced with exact absolute F1 deltas ($+0.194$, $+0.087$, $+0.117$), avoiding the unrounded-denominator ambiguity. The artifact paragraph now also states the repository commit `1e35603` and the training seed 42. Item 5 remains open for framework versions and QA-turn provenance.

## T1 Reconciliation Pass (Issue #28, 2026-11-26)

- Added primary-source verified loss-masking, surrogate-substitution, and inference-privacy citations in Section 2 and `.bib`: `lin2024rho1` (`arXiv:2404.07965`), `hans2024goldfish` (`arXiv:2406.10209`), `wang2025slung` (`arXiv:2505.03052`), `joshi2025rmft` (`arXiv:2512.03310`), `tyagi2026surprise` (`arXiv:2610.22988`), `albanese2026anonymous` (`arXiv:2603.17217`), and `staab2024beyond` (`arXiv:2310.07298`).
- Narrowed `PT-LM` positioning in Section 2 to mitigating placeholder-token tag echo and in-scope false refusal on `0.5B--1.7B` LoRA adapters via bundled `-100` placeholder masking + grammatical-role forward surrogates, noting pending masking-only vs. surrogate-only ablation.
- Added explicit caveats in Section 5 and Section 6: (a) `Qwen2.5-1.5B` `PT-LM` seen-doc token F1 (`0.190`) remains below the untrained base (`0.202`), and (b) the 12 planted canaries use scanner-detectable formats (emails, phones, SSNs, structured names), not scanner-missed formats.
- All measured numbers remain unchanged.
