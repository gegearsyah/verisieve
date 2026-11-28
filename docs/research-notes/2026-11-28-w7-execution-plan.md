# W7 execution plan: claim audit, model card, and public release packaging — 2026-11-28

Ticket #47 (part of #40 P5). Blocked-by chain is clear: W4, W5, W6 are
merged, #48 (the checkout/results hygiene) landed as bd500f5 so the byte
strict regeneration gates now hold on this box. This plan binds the
decisions before dispatch; the two read-only literature agents (full text
prior art verification, and the LEACE-for-multimodal-encoders sweep plus
licence P0 verifications) run in parallel and their reports are inputs to
the model card, not to the structure decided here.

## 1. Binding decisions

1. **The model card and release manifest live in a committed directory,
   `release/weft-specialist-v1/`** (MODEL_CARD.md, RELEASE-MANIFEST.json,
   CALIBRATION.svg). The ticket says "alongside the W5 artifact", but
   `models/` is gitignored by standing rule (trained weights stay on disk,
   digests in results/); the card must be versionable, so the manifest
   carries the artifact sha-256 digests and sizes (from
   `results/weft-export-latency.json`, append-only) and points at the
   recipe instead of embedding weights.
2. **The claim audit is a scripted, append-only ledger**
   (`results/weft-claim-audit.json`, schema version 1) built by a new
   `scripts/run-weft-claim-audit.mjs`, following the W5 `write_entry`
   pattern: content-addressed runId (sha-256 of the canonical entry JSON),
   banned-word scan before append, temp file + atomic rename. The script
   walks every external claim row declared in the model card (a claims
   table in the card front matter or a companion section), checks each
   against its traced source (a results/ ledger digest for measured
   claims, or the 2026-11-28 full text verification record for citations),
   and refuses to append when any claim is untraced. Re-running without
   card changes must be a no-op (idempotence by runId).
3. **Citation and differentiation table content comes from full text
   reading, not the abstract-level re-check.** The 2026-11-27 note §1
   table is the row set (adversarial removal, nullspace erasure line
   including the diffusion extension, HIN adversarial linking with
   generated negatives, aspect conditioning, conformal abstention, the
   CDCR family); each row cites the primary source with a one-sentence
   differentiation (what Weft does differently). The novelty statement is
   exactly the surviving conjunction wording: "not found in prior art as
   of this audit", never a stronger claim; no single component is claimed.
   The 2026-11-28 LEACE-multimodal sweep (open question 1 of the
   2026-11-27 note) closed unoccupied and added mandatory neighbours the
   model card must cite and differentiate, absent from the earlier note:
   CLEAR (multimodal nullspace de-redundancy for recommendation matching,
   2026, the closest mechanical neighbour), ISP (linear identity-subspace
   removal from image encoders with verification as the task, 2026),
   LANCER (EMNLP 2024) and the document-deconfounding line (erasure
   serving text retrieval and document similarity), SPD and JVSB
   (bias-subspace erasure on CLIP). The diffusion-erasure line is cited
   through the full-text-verified records only: Gandikota et al.,
   "Erasing Concepts from Diffusion Models", arXiv:2303.07345 (ECCV 2024);
   "Unified Concept Editing in Diffusion Models", arXiv:2308.14761 (WACV
   2024); and SPEED, arXiv:2503.07392 (ICLR); characterized as
   fine-tuning and closed-form concept editing, never as nullspace
   projection of encoders. The 2406.07137 id in the 2026-11-27 note was
   wrong (a physics paper) and is corrected in that note with a dated
   marker, as are five other misattributed ids found by the same pass
   (RLACE 2201.12091, the kernel line 2201.12191, conformal-under-shift
   1904.06019, kNN-OOD 2204.06507, learning-to-defer 2006.01862; full
   mapping in 2026-11-28-w7-fulltext-verification-record.md).
4. **H2 wording and probe scope are fixed by the 2026-11-27 ruling**:
   identity-blind, never identity-removed; leak probes are post-hoc
   nonlinear, not the in-training adversary; the Elazar and Goldberg
   caveat is quoted in the card's failure modes. The masked-eval
   no-damage reading (W5) is reported as measured on the v4 masked eval
   only, with the 240 word length caveat carried.
5. **The public recipe admits green sources only.** Multi-News is dropped
   (verified against the HF dataset card's LILY Lab agreement verbatim:
   "non-commercial research and educational purposes only", no IP licence
   granted, HF licence field "other"); the teacher is restricted to
   permissively licensed open weight models (Mistral usage per the
   standing authorization is an internal training matter, and the public
   recipe documents the teacher contract without shipping teacher
   outputs that carry restrictive terms); Wikipedia-derived pairs stay
   out of the public set unless the founder chooses share-alike dataset
   licensing (binding default: excluded; surfaced at the founder
   checkpoint). Needle 3 (Cactus-Compute needle3, the on-device model the
   2026-11-26 note left unverified) is Apache-2.0 on its HF repo;
   uCDCR is cited only, never redistributed: the compilation is tagged
   CC BY-SA 4.0, the card and the LREC 2026 paper state no per-corpus
   licence for its 12 constituents, and ECB+ is CC BY-NC-SA (espRA,
   registration-gated; that clause rests on search snippets and a human
   re-checks espRA before any corpus decision touches ECB+).
   `results/weft-licence-audit.json` statuses are updated from these
   verifications before the manifest is finalized; the licence audit is
   the hard gate: no green, no release.
6. **The story-36 release gate is recorded honestly as blocked pending
   the founder's scoring-path ruling.** Measured (W1 benchmark,
   identity_disjoint bucket, synthetic estate): the size-matched static
   embedding baseline scores F1 0.9973, the specialist's link head 0.3617
   (band 0.21 to 0.40), pooled cosine 0.9989. Acceptance criterion 2
   blocks the release while the specialist's ruled scoring path does not
   beat the static baseline; the manifest carries the gate status and
   the numbers, and the founder checkpoint surfaces the open ruling.
   The release packaging itself ships regardless; "release" here means
   the public artifact publication decision, which is the founder's.
7. **The onnxruntime-node range tightens from ^1.31.1 to ~1.31.1** in
   package.json optionalDependencies. The W6 metadata read scans the
   ONNX protobuf field 14 directly because onnxruntime-node 1.31.1
   exposes no model-metadata API; the tested version is recorded in the
   manifest with the coupling note. Minor floats are exactly what broke
   Kaggle runs before (onnx-ir), so the range does not float silently.
8. **The calibration plot is a small committed SVG** (CALIBRATION.svg)
   generated by a script in the release directory build step, reusing
   the paper/figs drawing utilities style: the certified threshold
   (0.5000 at alpha 0.05 and 0.10), the coverage point (16.1 percent of
   pairs answered), and the test-half false-merge point estimate (11 of
   161 answered, 6.8 percent) with the bound labeled as the certificate
   and the point estimate labeled as wide-noise. The card carries the
   same numbers as a table so the plot is not the only carrier.
9. **The W1 benchmark ships as pointers, not a copy**: the release
   manifest cites `results/weft-baselines.json` (per-bucket results for
   every baseline: bm25, model2vec static threshold, MiniLM cosine,
   BERTopic-style, local LLM judge) and the reproduction command
   (`scripts/run-weft-baseline-shootout.py`), with the harness digests
   already recorded in that ledger.
10. **Wording compliance is mechanical**: the claim-audit script runs the
    banned-word sweep ("mathematically grounded", "eliminates", "first"
    as substrings; "identity-removed"; "perceive everything"; "atomic
    knowledge") over every file in `release/` and the new note, and the
    append fails closed on any hit.

## 2. Write scope

- New: `release/weft-specialist-v1/MODEL_CARD.md`,
  `release/weft-specialist-v1/RELEASE-MANIFEST.json`,
  `release/weft-specialist-v1/CALIBRATION.svg`,
  `scripts/run-weft-claim-audit.mjs`, `results/weft-claim-audit.json`
  (the initial entries), `test/weft-claim-audit.test.js`,
  `docs/research-notes/2026-11-28-w7-release-verdict.md` (at the end).
- Modified: `package.json` (onnxruntime-node ~1.31.1),
  `results/weft-licence-audit.json` (statuses from the P0
  verification report), README and paper count pins for the new tests.
- Paper .tex edits are out of scope (founder ruling; only the count pins
  that check-paper-numbers.mjs already verifies are touched).
- No committed baseline values change; no ledger entry is ever edited.

## 3. Test design

1. Claim audit round trip: run the audit script, assert the ledger
   gains exactly one entry whose claims array covers every claim row in
   the card; re-run, assert no new entry (idempotence).
2. Fail closed: a model card with an untraced claim row (temp copy)
   makes the script exit non-zero with a typed error and append nothing.
3. Banned-word sweep: the audit script scans `release/**` and the note;
   the test plants each banned token in a temp copy and expects refusal.
4. Licence gate: the test asserts every `usedInRecipe: true` source in
   the licence audit has status green, and that Multi-News is not in the
   recipe.
5. Story-36 gate honesty: the manifest's releaseGate block matches the
   measured numbers cited above and the blocked-pending-ruling status.
6. The full suite plus `check-paper-numbers.mjs` (0 failures) and the
   count pins updated for the new test file.

## 4. Sequence

1. Literature agents (running): full text verification of the §1 row
   set; LEACE-multimodal sweep; licence P0s.
2. This note finalized with their verdicts folded into the card content
   row set (the verdict note at the end records any refuted or
   corrected claim).
3. Dev agent builds the release directory, the audit script, the
   ledger, the tests, the dependency pin, and the licence-audit status
   update.
4. Verification on this box: full suite, paper-number checks, the
   before/after of the licence statuses, the manifest digest checks
   against `results/weft-export-latency.json`.
5. Verdict note, PR, founder checkpoint (story-36 scoring path ruling,
   Wikipedia share-alike decision, any paper-level claim the founder
   wants to make from the card).

## 5. Known risks (carried, honest)

- The full text pass may refute or sharpen abstract-level claims; any
  such correction lands in the card and the verdict note with the
  primary-source quote, not silently.
- The LEACE sweep may find adjacent work that erodes the cross-modal
  leg; if so the card's novelty row narrows to the verified wording and
  the founder checkpoint says so plainly.
- The 240-word envelope and the unseen-style routing gap stay open from
  W4/W5 and are stated as limits in the card, not hidden.
