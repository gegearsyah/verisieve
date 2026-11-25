# Change log: Paper B (versieve-graph-grounded-enterprise-corpus)

Major Revision, executed per `review/EDITOR-RULINGS.md` section 9 (B1-B12). Build verified: `latexmk -pdf -interaction=nonstopmode -f` exits 0 on two consecutive runs, no undefined references or citations, no overfull hboxes. Page count: 11 (unchanged). All `---` removed from the .tex and the .bib (grep returns zero), including the GDPR entry, which now reads `Article 17: Right to Erasure`.

## 1. Title (B1, J1)

Old: `Records That Know What They Describe: A Deterministic Entity-Indexed Enterprise Corpus with Byte-Verified Erasure`
New: `How Training Data Should Look: From Stitched Chunks to Records That Know What They Describe`

Changed in `\mlsystitle`, both `\mlsystitlerunning` occurrences, and `\hypersetup{pdftitle=...}`. Verified in the rendered PDF first page. The old subtitle's "Byte-Verified Erasure" claim (the adapter half is unmeasured) no longer appears anywhere.

## 2. Abstract (B1)

Full replacement with the ruling B1 text (numbers unchanged: 388,797 B; 25,755 tokens; 53.3%; 83.3%; 60.0%; 11.7%; 10.0%; p=1.00; 81.7%; 14.32; 1.0).

Deleted from the abstract per ruling:
- "the best trained format, the composed corpus, reaches 11.7%, never behind per-block (10.0%) on any stratum"
- "a lexical BM25 control ties it at 60.0%" (now "answers 60.0%, numerically above it and within noise at n=60")
- "the strongest arm measured"
- "its three GPU-dependent measurements pending, with no placeholder values shown" (now "the adapter half is a sealed retrain recipe whose GPU measurements are not reported here")
- Added "co-mention reuse makes every composed sample part of a near-duplicate pair (fraction 1.0)" per DA3.

## 3. The null result (B2, DA2)

Three sites rewritten from superlative to null:

- Section 7 "The reading": old "composed is never behind per-block on any stratum ... composed leads only on the 12-question disambiguation stratum" -> new "the trained formats do not separate: composed (11.7%), per-block (10.0%), and flat (6.7%) sit within a margin that no McNemar comparison separates, composed against per-block is p=1.00 and composed against base is p=0.07, so this study makes no trained-format claim. The point difference lands on the 12-question disambiguation stratum (16.7% against 8.3%): one question of twelve." The one-run-one-budget limitation is kept.
- Section 10, paragraph 3 (was item 3): same null statement, "the whole point difference between the two formats is one question on the 12-question disambiguation stratum".
- Conclusion: old "Among the trained formats, composed is never behind per-block on any stratum and leads only on ... by one question" -> new "The trained formats sit near the base: composed (11.7%) and per-block (10.0%) do not separate at n=60 (McNemar p=1.00), so the study makes no trained-format claim."
- "4.6 times the best trained arm" (Sec 7) and "4.6 times over (53.3%)" (Sec 10) both now name the comparator: "4.6 times the composed arm's 11.7%". BM25's 60.0% and its "numerically above" relation to Graph-PPR are stated in both the abstract and Sec 7 (DA3).

## 4. The 81.7% arm (B3, DA1)

- Every mention carries the condition in the same sentence: abstract ("given a correctly resolved identity rather than resolving it"); Sec 7 Non-training controls ("the arm scores routing given a correct resolution, not resolution itself"); Uncertainty paragraph ("hybrid routing 81.7% (69.6 to 90.5; routing given a correctly resolved identity)"); conclusion ("given a correctly resolved identity rather than doing retrieval").
- New sentence in Section 7, verbatim per ruling: "End-to-end routing on the engine's own resolution is not measured in this paper; 81.7% is therefore an upper bound on the routing arm, not a deployment measurement."
- "the strongest arm in the table" (Sec 7) and "the strongest measured arm" (conclusion) replaced with "the routing upper bound".

## 5. Table 3 protocol split (B4, M1)

One table with an explicit `Scored` column: `EM+J` (exact match plus the two blinded judges; the seven arms of the judge protocol) versus `EM` (exact match only; BM25, CAG set-cover, hybrid routing). Rows are grouped that way. Two fixes from the old layout: `Base` rows moved into the EM+J group (it was scored with judges), and `CAG over composed records` was renamed `CAG set-cover*` with the asterisk resolving in the caption.

- Deleted: "The three arms added by the second run", "their judge cells are intentional notches ($--$)". New caption: "as a design choice they are scored by exact match only, with no judges run at scoring time, on the same estate, rows, and base model as the other arms ..., so the judge columns are comparable only within the EM+J rows and no cross-protocol judge analysis is made."
- The design paragraph's "two blinded judges for the trained arms" corrected to name the actual judge coverage: the trained arms plus the Graph-PPR and base controls.
- CAG upper-bound caption clause: "$^{*}$The CAG set-cover arm is an evaluation-informed upper bound: its cache contents are optimized against the question population itself, which deployment cannot do." The one in-text disclosure sentence is kept ("an evaluation-informed upper bound for fixed-cache CAG (marked in Table 3)").
- No numbers re-scored; every cell value unchanged.

## 6. Recipe selection (B5, M2)

Old: "The recipe is sealed, meaning fixed before the head-to-head ran, from a prior 18-combination epoch and learning-rate sweep: Qwen2.5-1.5B-Instruct, ..."
New: "The recipe is sealed, meaning fixed before the head-to-head ran, from a prior 18-combination epoch and learning-rate sweep; the sweep belongs to the companion local-training study~\cite{ardiyansyah2026localtraining}, and it selected on that study's compliance QA, not on the 60 manifest questions used here. Qwen2.5-1.5B-Instruct, ..."

"Compliance QA" is the artifact-supported wording (it is the evaluation set named throughout Paper C's manuscript), so the ruling's stronger form is used.

## 7. Artifact availability (B6, M3)

New paragraph appended to the measurement setup (Section 5), verbatim per ruling, with the repository URL `https://github.com/gegearsyah/versieve`. No commit hash, kernel hash, or identifier is invented; see Unresolved.

## 8. Bound convention (B7, M4)

Section 5 "Detection and certificates", inserted after the certified bound: "All bounds are one-sided 95% Clopper--Pearson bounds. The certified lower bound of 81.7108% is the one-sided bound on 23/24 (the two-sided bound is 78.88%); the per-class bounds assume zero detected misses against manifest ground truth." Clopper--Pearson and Learn-Then-Test are cited at their Section 3 first use (`clopper1934binomial`, `angelopoulos2021ltt`) and Clopper-Pearson again at this sentence.

## 9. Count reconciliations (B8, M5)

- 76 versus 24: new opening sentence in the Section 5 Erasure paragraph: "The corpus indexes 76 engine entities while the manifest holds 24 ground-truth entities: ground-truth entities are canonical, so a person is one entity across name, email, and phone, whereas the corpus indexes each distinct detected value as its own salted engine entity." Neither number changed. Arithmetic note: 16 people x 3 values + 4 orgs + 4 codenames = 56 detected values of manifest-truth origin; the remaining engine entities come from non-manifest detected values. This derivation is not printed because the artifact does not record it; see Unresolved.
- 1,106 versus 1,113: the Section 6.1 Hub-duplication paragraph now states both receipts with their SHA-256 prefixes (`9290b008` for the 1,113-sample failure-mode build, `32fa477f` for the 1,106-sample training-arm receipts) as "two receipted builds of the same composition policy, and no claim in this paper compares counts across the two builds". The Section 7 site ("composed 41 of 1,106") carries a pointer to Section 6.1. No cause asserted.
- 14.32: raw fractions printed at the factor: "an amplification factor of 14.32 (raw fractions 0.321364 and 0.022442)". Verified arithmetic: 0.321364 / 0.022442 = 14.3195 -> 14.32; the rounded printed rates divide to 0.3214 / 0.0224 = 14.35, which is why the raw fractions are now printed. 14.32 kept.
- 54/54 linking: scoped in Section 5: "defines 54 (entity, department-pair) cross-department links on the IT and business sides, the two departments the linking check covers ... and all 16 ground-truth people resolve to the same vault identifiers across those two departments." It no longer reads as estate-wide over four departments.

## 10. Citations (B9, D1-D4)

Added to the .bib (and cited at first use): `angelopoulos2021ltt` (arXiv:2110.01052, as given in the ruling), `clopper1934binomial` (Biometrika 26(4):404-413, 1934), `broder1997resemblance` (Sequences 1997), `lee2022dedup` (ACL 2022), `bagga1998bcubed` (LREC 1998), `christen2012datamatching` (Springer 2012), `haveliwala2002topic` (WWW 2002), `robertson2009bm25` (FnTIR 3(4):333-389, 2009), `graves2021amnesiac` (AAAI 2021), plus `ardiyansyah2026localtraining` (companion, required by B5). Citation sites: LTT and Clopper-Pearson at the Section 3 certificate bullet; Graves at the Section 1 Amnesiac Corpus naming with the ruling's one-sentence differentiation ("Exact deterministic regeneration differs from amnesiac retraining, which forgets batches without a byte-diff receipt"); Broder and Lee et al. at Section 6.1 (Lee with one sentence: "Corpus-level duplication is documented to amplify verbatim memorization in language models, so this near-duplicate structure is a memorization risk and not only a storage artifact"); B-cubed and PPRL/Christen at Section 5; Haveliwala at Section 3's personalized PageRank; BM25 at the Section 7 control. No arXiv ID, DOI, or URL invented; venue/year uncertainties were not present for any of the nine.

## 11. Governance, salt, costs (B10, P1-P3)

- Readable view (Section 4): added, after the certificate-inapplicable sentence: "The operator is accountable for the lawful basis of the opt-in. The readable export carries no certificates. Erasure of a readable-derived adapter follows the retrain path, not corpus regeneration." The preceding sentence's duplicate clause "and no per-sample certificates" was removed so the fact is stated once.
- Salt lifecycle: new `\paragraph{Salt lifecycle.}` at the end of Section 9 with the ruling's three sentences verbatim.
- Deployment costs: new `\paragraph{Deployment costs.}` at the end of Section 9: per-sample certificate computation, vault and salt custody, the erasure receipt a data subject can receive, and third-party verification as a re-run of the pinned build against the recorded corpus hash.

## 12. Composition's standing and Section 10 restructure (B11, DA4)

- Added to Section 10, paragraph 3: "on these measurements the deployment-recommendable artifact is the per-block corpus plus the entity index plus the router, which carries the same erasure receipts and routing gain without the 14.32x amplification or the near-duplicate corpus. Composition remains a view to test at larger budgets." (Added in Section 10, not Section 6, per B11's either/or.)
- Section 10 is no longer an enumerate of disclaimers; it is four prose paragraphs (certificate, generalization, downstream claim, approximate unlearning), one boundary each. "The retrain path is the honest completion of erasure" became "The retrain path completes erasure from the corpus to the adapter". "Two honesty measurements" became "Two failure-mode measurements". Every real limitation is kept; each stated once.

## 13. Style and presentation (B12)

- All `---` removed from tex and bib (grep zero; the gdpr_art17 entry now uses "Article 17: Right to Erasure", which also removes the em-dash the old .bbl rendered into the PDF).
- Removed: "A receipt, throughout this paper, is a hash-pinned artifact field ..., not a prose claim" (now "A receipt is a hash-pinned artifact field: a corpus SHA-256, an engine-version hash, or a diff receipt"); "this is recorded, not smoothed" (now "the schema marks them as derived-format in the sample id"); "the amplification factors there are reported as null, not smoothed over" (now "no amplification factor is defined where the per-block rate is zero"); the Table 2 caption's "GPU-dependent measurements are pending and appear in no table until measured" (the pending boundary is stated once, in Section 9) and the Introduction item 3's duplicate pending clause; the duplicated "Uniform high columns validate the construction, not generalization" sentence in Section 5; the vaulted-ablation's "not a privacy-cost measurement:" register (kept as "a construction-consistency check: a privacy-cost measurement would need a utility battery indifferent to identity, and none is run here", per DA5).
- Thousands separators fixed: `$16607$` -> `$16{,}607$` (both occurrences), and `$2940$` -> `$2{,}940$`, `$1004$` -> `$1{,}004$` for consistency with the house format ($25{,}755$, $2{,}368$).
- Three overfull hboxes fixed: (i) Table 1 (105.2pt): the paired "F1 / match" and "link / QA" rows were split one metric per row, `prosodic-intent accuracy` abbreviated to `prosodic-intent acc.`, the W2 baseline's "100 (none recovered)" abbreviated to `100$^{\dagger}$` with a caption dagger note, W4 shortened to `keyf.+WAV+VTT`, and `\tabcolsep` tightened to 3pt; (ii) the estate-spec file path (46.6pt) is now breakable at a hyphen (`\allowbreak` inside the \texttt); (iii) Table 3 (13.3pt): addressed by the restructure above plus `\tabcolsep` 3pt. Final log: zero overfull boxes.

## Verified arithmetic

- 0.321364 / 0.022442 = 14.3195 -> printed as 14.32 (kept); rounded rates give 14.35, which is now covered by printing the raw fractions.
- 0.5512 / 0.0431 = 12.79 (unchanged).
- 23/24 = 95.8333%; one-sided 95% Clopper-Pearson lower bound on 23/24 = 81.7108% (unchanged, convention now stated); two-sided = 78.88% (added).
- 41/1106 = 3.71% (unchanged, now cross-referenced as a separate receipted build).
- 53.3/11.7 = 4.56 -> "4.6 times the composed arm's 11.7%" (comparator now named).

## Pre-existing review items not in the binding rulings

- J2 (companion-positioning paragraph): only the B5 companion citation was added; the binding rulings (which override the review) require no positioning paragraph and no other companion citations.
- M8 (exact rate-to-merged-class function on the merge ladder), M9 (decoding/normalization spec for exact match on generated text), M7 table-shrink beyond the overfull fix, M10 (move judge columns to the artifact): not part of B1-B12 and not changed; the artifact cannot supply the missing specifications, so doing them would require author input (see Unresolved).

## Unresolved (author action)

1. The submission package must be completed by the author: paste the actual repository commit hash, the five per-kernel SHA-256 values, and the Qwen2.5-1.5B-Instruct and judge-model checkpoint identifiers into the artifact-availability statement of Section 5 (B6 deliberately leaves them out; none may be invented).
2. No end-to-end router measurement exists. 81.7% is an upper bound conditional on correctly resolved identity; Section 7 now says so in one sentence, and the number should not be promoted to a deployment claim in any derivative material.
3. The 76-vs-24 derivation is stated as canonical-people versus value-level engine entities exactly as the ruling frames it; a per-class breakdown of the 76 engine entities (beyond the 56 derivable from ground truth) is not printed because no artifact note provides it.
4. The two receipted-build SHA-256 prefixes are printed truncated (`32fa477f`, `9290b008`) as recorded; the full hashes should go into the submission package's artifact list.
5. Review items M8, M9, M10 above are open and would need author-provided detail (merge-ladder mapping, decoding parameters, judge-protocol rationale) if the venue's camera-ready round demands them.

## Post-review artifact fill (coordinator)

The Section 5 artifact paragraph now carries the repository commit `1e35603`, all five kernel sizes, their SHA-256 prefixes, and the Qwen2.5-1.5B-Instruct and judge identifiers. Item 1 is closed except that the submission package should still list the full digests; they are reproducible with `sha256sum vendor/wasm/*.wasm` at that commit.
