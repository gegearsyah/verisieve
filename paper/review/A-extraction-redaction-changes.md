# Change log: Paper A (versieve-extraction-redaction-benchmark)

Revision agent for Paper A. Sources: `review/EDITOR-RULINGS.md` (binding) and `review/A-extraction-redaction-review.md`. Build verified with two `latexmk -pdf -interaction=nonstopmode -f` runs: exit 0, 9 pages, 0 undefined references or citations, 0 bibtex warnings, 0 overfull boxes.

## 1. Title (ruling 1; review R10)

- Old: `\mlsystitle{Versieve: Benchmarking Deterministic Document Extraction, Data Redaction, and Conformal Gatekeeping}`
- New: `\mlsystitle{What Training Data Should Lose: Local Extraction, Redaction, and Fail-Closed Gatekeeping}`
- Also updated both `\mlsystitlerunning` occurrences and `\hypersetup{pdftitle=...}`. Keywords: dropped `Graph-PPR` and `Cache-Augmented Generation` (Track C terms) to match the cut scope.

## 2. Abstract rewrite

- Old final two sentences: model-count claim ("a six-model open-weight compliance evaluation") plus the full Track C sentence (LoRA vs Graph-PPR, `p = 0.001` / `p = 0.0005`, `11/12 -> 0/12`, `4.93--5.70` bits, "at zero QA accuracy loss").
- New: abstract covers only extraction, redaction recall, conformal gatekeeping, and runtime substrates; Track C sentence and the six-model wording deleted entirely (the six-model evaluation no longer exists in this paper, so the count contradiction dissolves rather than being repointed).
- Kept verbatim: `8/8`, `8,134` lines, `55,099` words, `209.02` ms, `97.38%`, `78.6%` (`110/140`), `49.6%` (`118/238`), `31.0%` (`180/580`), `334`-word lexicon, `2.72x` (`5.46 -> 2.01`), `14.63% -> 0.0%` conditional FPR, `206 < 299`, `BinomCDF = 0.1261 > 0.05`, `14.12` / `106.22` / `12,917` ms.
- Changed wording only: "across all $26$ structured PII tags" -> "across the $26$ structured PII tags evaluated out of the dataset's $56$ span categories" (arithmetic: none changed; 180/580 unchanged).
- Added closing sentence scoping the certificate to the scanner-derived labels (review R2).
- "zero-egress document curation, conformal gatekeeping, and local retrieval engine" -> "document curation and conformal gatekeeping engine with no network egress by default" (retrieval eval no longer in this paper; egress softening per review R20).

## 3. Scope cut, Section 6.3 (formerly 5.3; ruling 7; review R1, R12, R16, R9)

- Section renamed `Runtime Substrates, Local Retrieval, and Open-Weight Adaptation` -> `Runtime Substrates and Training-Budget Scaling`; intro roadmap sentence updated; subsection renamed to `Downstream Value of the Curated Outputs`.
- Removed: the entire CAG vs Graph-PPR paragraph, Table 6 (`tab:trackc`, OAIC 12-probe results), the Cross-Family LoRA paragraph, the PII-Masking A/B / canary paragraph, and Table 7 (`tab:prompt-comparison`). Removed with them: the Carlini Secret-Sharer mentions (no longer cited in this paper), the `T0`/`T2-Chat`/`fair-shot` jargon, the "earlier flat $49.4$-token baseline" past-draft argument, the unexplained `1,050` denominator, and the resample-count problem (the `p = 0.0005` / `p = 0.001` claims moved to the companion, which already reports 2,000-resample permutations).
- New subsection is 3 sentences stating the downstream question and citing `\citep{ardiyansyah2026localtraining}`.
- Kept as unique to A: Section 6.1 substrate table, Section 6.2 scaling ablation (Gate BCE, VeRA BCE, Needle R@5).
- Conclusion: removed lessons (2) and (3) with all fine-tuning/canary numbers ("four-point-nine-three to five-point-seven bits", "zero QA accuracy loss") and the "five local open-weight LLMs" count; now two lessons plus a companion pointer.
- Limitations: removed the "Automated compliance metrics" bullet (its subject moved to the companion); the regex-over-masking limitation keeps its substance but the `$-0.062$` F1 tax now points to the companion instead of dangling from a removed table.

## 4. Gatekeeping: HC-CRC / E-LTT (ruling 7; review R8)

- Old: full paragraph defining `DEFF = 1 + (N_u_bar - 1)rho` and the Ville betting supermartingale, with zero evaluation in this paper.
- New, one sentence: "When calibration units arrive clustered within documents or as a stream rather than as independent chunks, the corresponding cluster-robust and anytime-valid streaming extensions (HC-CRC and E-LTT) are formulated and evaluated in the companion multimodal paper `\citep{ardiyansyah2026multimodal}`." No unevaluated formulas remain.

## 5. Label circularity (review R2)

- Section 3 (where the certificate labels are defined, after "826 unsafe / 381 safe"): added that the unsafe/safe labels are scanner-derived, independent only where a dataset supplies ground-truth spans (`ai4privacy-200k`), so a certificate means agreement with the format-validated labeling rule, not independent PII truth; the `31.0%` all-tag recall measures the scanner against `ai4privacy`'s human labels and bounds what the gate can catch.
- Limitations: added a "Certificate scope" bullet with the same statement, restated once.

## 6. Table 1 tag count (ruling 6; review R4)

- Old row: `$56$-tag PII span recall benchmark`
- New row: `$56$-tag dataset; $26$ structured tags evaluated`
- Added one sentence in Section 3: the dataset annotates 56 span categories; the evaluation scores the 26 structured token types the format-valid scanner emits against their ground-truth spans (180/580); remaining free-form categories are not counted toward the recall denominator. Denominator 580 unchanged.

## 7. Multi-axis conjunction rule (review R19; `src/gatekeeper.js` lines 380-396)

- Added to the multi-axis paragraph: "The conjunction applies a strict precedence across heads: it drops if any head drops, keeps only if all three heads keep and none abstains, and otherwise abstains (the aggregation implemented in `\texttt{src/gatekeeper.js}`)."
- Also removed the "Rather than masking insufficient calibration data behind an unverified threshold" argument-with-frame sentence head (ruling 2 style); the substantive fail-closed cost sentence stays.

## 8. Artifact availability (review R3, coordinator-fixed scope)

- New paragraph at the end of Section 3: every table is emitted by a checked-in runner at `https://github.com/gegearsyah/versieve`; benchmark manifests, prompts, and result JSON are included with the submission; the eight PMC identifiers are listed in the benchmark manifest; the Table 1 PMC citation is representative and the manifest carries each of the eight identifiers. No commit hash, DOI, or license invented.

## 9. Em-dashes (ruling 2; ruling 5 overturns the review's count of 14)

- `grep -n -- '---'` on the .tex and .bib now returns zero hits. Prose em-dashes converted: "8/8 documents---8,134 lines...---in" -> parentheses; "down to 128...---a 2.72x reduction" -> comma; "outliers---549.9 ms...41.9 s---skew" -> parentheses. Table empty-cell placeholders `---` converted to `--` in `tab:multiaxis`, `tab:substrates`, `tab:ablation`. The .bib had none. `--` en-dashes in name pairs and ranges kept.

## 10. Other style / scope hygiene

- Appendix A: "94 core/Track C tests" -> "94 core tests" (internal experiment name no longer leaks into the manuscript; review R23).
- Conclusion wording: "zero-egress client sandbox" -> "local sandbox"; "sub-millisecond graph retrieval" removed from the capability claim because no retrieval result is evaluated here.

## Arithmetic of corrected numbers

No measured number was corrected. All printed numbers in the retained sections were checked against the review's recomputation (split sums 607+301+299=1,207, 415+206+205=826, 192+95+94=381; BinomCDF values 0.1261 / 0.0486; ceiling 299; startup ratios 121.6x, 7.7x; 53.7% strip; 2.72x reduction; Fig. 3 BCE 0.2577->0.189 and 0.9432->0.6141). The 56-vs-26 tag discrepancy was resolved by relabeling per ruling 6, without arithmetic change: 500 records, 580 scored spans, 180 hits, 31.0% (180/580 = 0.3103) unchanged.

## Unresolved (needs new experiments or facts not in the artifacts)

- External NER baseline for the recall-ceiling claim (review R5, MAJOR): a Presidio/GLiNER row on the same 500 `ai4privacy` records requires a new run; not available in the artifacts. The ceiling claim is already scoped to "format-validated regex" and the neural-tagger limitation is kept.
- Corpus-scale ingestion throughput run (review R13, MAJOR): the startup/dedup micro-benchmarks remain fixture-scale; a 1,207-doc throughput number needs a new run.
- Verified-vs-asserted provenance table and salt/vault-compromise paragraph (review R14, MAJOR): needs an `strace`/capture demonstration to move "zero-egress" from asserted to verified; only the abstract-level softening ("no network egress by default") was in scope here.
- Abstention-workload characterization for human reviewers (review R15, MAJOR): what fraction of the corpus lands in `ABSTAIN` at the operating points is in Table 3 (up to 40.8%), but triage workload/latency needs deployment data.
- Per-document/record identifiers and split seeds beyond the manifest pointer (review R3 root): the artifact-availability paragraph now points to the checked-in runner and manifest, but the submission package must actually include the manifests; the author should paste the repository commit into the submission package (no hash invented here).
- Related-work section (review R7, MAJOR): a positioning section (Wasm edge systems, de-identification pipelines, conformal deployments) is editorially possible but was not in the coordinator's instruction list; the manuscript still cites the existing intro references only (`soldaini2024dolma`, `penedo2024fineweb`, `ai4privacy2023`, `presidio2021`, `jaume2019funsd`, `jin2019pubmedqa`, `wang2024bitnet`, `kopiczko2024vera`, `vaswani2017attention`, `angelopoulos2021ltt`, `miu_2017_pmc5773420`), and the previously-uncited keys `haas2017wasm`, `jangda2019notsofast`, `bates2021distributionfree`, `vovk2005algorithmic` remain unused in the .bib.

## Post-review artifact fill (coordinator)

The artifact paragraph now states the repository commit `1e35603`. The remaining identifier gap is the submission package's actual inclusion of the manifests, not the commit.

## T1 Reconciliation Pass (Issue #28, 2026-11-26)

- Reconciled WASM kernel count in Section 1 and Appendix A from 4 to all 5 zero-import WASM modules (`388,797 B` combined, adding `versieve_media.wasm` at `204,031 B` / `29` exports, evaluated in the companion multimodal paper).
- Reconciled MCP tool count in Appendix A from 14 to 18 tools (adding `ingest_enterprise_bundle`, `scan_enterprise_secrets`, `redact_audio_call`, and `audit_forensic_leaks` from `src/mcp-server.js`).
- Reconciled Node.js portable CI test count in Appendix A from `100/100` (`94` core + `6` MCP) to `181` tests across `31` portable CI test files (`175` core + `6` MCP, verified directly from `package.json` `test:ci`).
- Added primary-source verified prior-art citations in Section 1 and `.bib`: `lukas2023pii` (`arXiv:2302.00539`), `staab2024beyond` (`arXiv:2310.07298`), `abbasiyadkori2024abstention` (`arXiv:2405.01563`), `bhattacharjee2026curatorkit` (`arXiv:2606.21631`), `redakto2026incognito` (`arXiv:2608.18260`), and `cpa2026auditing` (`arXiv:2609.21340`). Clarified zero-egress scope (user bytes vs. offline-cached local weights).
- All previously measured benchmark numbers remain unchanged.
