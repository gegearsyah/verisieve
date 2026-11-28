# Paper 5 brief: Weft, the theme-linking specialist — 2026-11-28

Companion to `paper3-curation-research-brief.md` (which owns the corpus question and consumes gate-passed Weft as one arm). Paper 5 asks the model question. Drafting starts now, in parallel with the v5 corpus lane (issue #59) and the H2 probe (issue #60); both land in slots below, so nothing blocks the draft.

## Founder ruling that frames the paper (2026-11-28, recorded in the release manifest)

Weft's purpose was never identity-based linking; the product point is theme linking: two people in the same company talking about the same talking point should be linked and support each other's claims. Identity-blindness is a privacy property of the shipped artifact, reported as a measured post-hoc probe result with the probe family fixed, never a headline claim. The story-36 gate is ruled passed on the pooled-cosine theme-linking path (0.9989 vs the size-matched static baseline 0.9973 on identity_disjoint; manifest `releaseGate`, status `ruled-passed`).

## Title direction (house rules: the title hits the training-data question; privacy words never lead)

A small quantized specialist for linking same-topic documents across authors, and what that buys for enterprise corpus and training-data construction. Theme linking leads; the identity property is a measured subsection.

## Claim set (each traced in `release/weft-specialist-v1/`; claim audit runId a329df3692e9, 40 of 40 verified)

1. The model: int4 artifact F1 0.9572 (20,458,033 bytes, sha 4690c5d4...), int8 F1 0.9652 (23,642,917 bytes, sha c8ebc947...), clean-runtime readings int4 0.9655 and int8 0.9825 on the 200-pair sample.
2. The product case, measured: the identity_disjoint bucket positives are same-theme, zero-shared-identity, cross-department pairs; the specialist's pooled-cosine path scores 0.9989, above the size-matched static baseline 0.9973 (the ruled scoring path; the story-36 gate).
3. The abstention machinery: conformal threshold 0.5000 at both alphas, coverage 16.1 percent (310 of 2000 pairs answered), the certified 5.0 percent bound at alpha 0.05, test-half point estimate 11 of 161 (6.8 percent, wide-noise labeled).
4. The novelty position: the conjunction (identity- or attribute-targeted nullspace or linear erasure on a multimodal encoder with linking as the task) is not found in prior art as of 2026-11-28; the six mandatory neighbours (CLEAR, ISP, LANCER, the deconfounding line, SPD, JVSB) are cited and differentiated row by row in `docs/research-notes/2026-11-28-w7-fulltext-verification-record.md`; no single component is claimed.
5. The methods contribution: the scripted fail-closed claim audit itself (typed errors, content-addressed runId, idempotent re-run) as a reproducibility artifact reviewers can rerun.

## Honest limits stated in the paper (never hidden)

The BM25 1.0 finding: on the current synthetic estate, same-theme documents share vocabulary, so the identity_disjoint bucket measures lexical overlap as well as theme adjacency; the paraphrase-hard stratum is the follow-up that isolates learned theme adjacency (slot 1 below). The 240-word envelope; the style-blind out-of-distribution tripwire (both provenances stated: the W5 note live-eval 6.7 percent and the ledger 0.0669 v4-eval rate); uncalibrated theme thresholds on heterogeneous corpora (the v5 lane owns recalibration); unseen-voice transfer partial at 0.6695 and single-voice 0.4798.

## Slots (land when their lanes land; the draft does not wait)

1. **Paraphrase-hard bucket** (issue #59, the v5 corpus lane): same talking point, different wording, different people; with BM25 and the static baselines re-run on it so the lexical-overlap gap is visible. This is the measurement that isolates the paper's core claim.
2. **H2 probe numbers** (issue #60, in flight): post-hoc identity recovery from the shipped int4/int8 pooled embeddings, MLP and RBF-SVM families, accuracy vs chance, held-out split. Reported whichever way it lands.
3. **Optional head-retrain arm** (issue #59, only if the strata land): a retrained link head with a theme-linking objective, evaluated against the rescoped baseline. The released head keeps its abstention role either way.

## Structure

Abstract (theme linking, the measured product case, the abstention certificate, the claim-audit methods note) → related work (the verification record's table, differentiated row by row) → the specialist (architecture, quantization, digests) → the benchmark and the ruled gate → calibration and abstention → identity as a measured property (slot 2) → limits (the BM25 finding leads the limits section) → the claim audit as reproducibility practice. Paper 1 and paper 2 results are cited, never restated.

## Style rules (binding, from the standing rulings)

No em-dashes anywhere. Banned in prose: "mathematically grounded", "eliminates", the standalone word "first", "identity-removed", "perceive everything", "atomic knowledge". Novelty wording is exactly "not found in prior art as of this audit"; no single component is claimed. Every number in the paper must be traceable to a committed ledger or note (the claim-audit discipline, extended to the .tex by the standing paper-claims checkpoint).
