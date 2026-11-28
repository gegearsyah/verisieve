# H2 identity-blindness probe on the shipped artifacts — 2026-11-28

Ticket #60. The model card words identity-blindness as a measured post-hoc
probe result with the probe family fixed and reported, but no probe had run
on the shipped int4/int8 artifacts. This note records the numbers the probe
produced on 2026-11-28 and the honest verdict. The model card and the claim
audit ledger are untouched; the verdict here feeds paper 5.

## What ran

An externally trained attacker on the frozen representation, never the
in-training adversary, per the Elazar and Goldberg advice recorded in the
W7 full-text verification record. The attacker is trained post hoc on the
frozen pooling output and evaluated on held-out documents. Probe families,
fixed and reported: a 1-hidden-layer ReLU MLP with 64 hidden units
(primary, torch 2.10.0+cpu, AdamW, lr 1e-3, 400 epochs, seed 20261127) and
an RBF SVM with C 10 and gamma scale (secondary, scikit-learn 1.8.0).

Task: given a document's pooled embedding, predict the document's primary
identity key, multi-class over the 16 identity keys of the corpus, top-1
accuracy against the majority-class chance baseline.

## Data and split

Corpus: the W1 synthetic theme estate, committed code with identity labels
(scripts/run-weft-baseline-shootout.py, build_synthetic_estate, seed
20261127, estate sha256 f56da1134b86b6b64c0c307e7a8354fa5981545a473f1e424ed4de06625d54c9).
240 documents, 24 themes, the identity key of a document is its author
person entity (16 distinct authors occur). The live v4 corpus was not used
because it is committed as pairs only and carries no per-document identity
keys; the labeled estate is the reproducible choice.

Split: held out by document, stratified by identity key, 180 training and
60 eval documents, every identity key present in both sides, seed
20261127. The corpus has no voice axis, so the by-chunk/by-voice exclusion
that the live recipe uses could not apply here; this is stated plainly as
a limit of the reading.

## Conditions

Same corpus, same split, same seed, three conditions:

- control-frozen-base: fp32 all-MiniLM-L6-v2, masked-mean pooled.
- artifact-int4-matmulnbits: the shipped int4 artifact (sha256
  4690c5d459974b147afefe90531de14ebc0a705865c134259a14eb0a0eda2372).
- artifact-int8-dynamic: the shipped int8 artifact (sha256
  c8ebc947d4e10154053d77a4360d5e28fb725450b9d6a10dc1a6fa53ff36e5af).

Both shipped artifacts expose only scalar outputs (linkProb, themeSim), so
the probe reads each graph's internal pooled tensor through read-only graph
surgery on a temp copy: the pooled tensor /ReduceSum_output_0 (and its
candidate twin) feeding the theme projection was added to the graph's
outputs, the copy's initializer bytes were digested before and after to
prove the shipped weights did not change, and the artifact on disk was
never modified. Each run re-verified the artifact digests against
RELEASE-MANIFEST.json.

The shipped artifact's pooling is salience-weighted (the trained evidence
head); the control is a plain masked mean because the frozen base encoder
has no evidence head. Both pools are 384 dimensional. This pooling
asymmetry is part of the setup, stated here so no reader has to reconstruct
it.

## The numbers

Chance baseline: 0.100 (the eval split's majority identity holds 6 of 60
documents).

| condition | MLP top-1 | RBF-SVM top-1 |
| --- | --- | --- |
| control-frozen-base | 0.4167 | 0.1000 |
| artifact-int4-matmulnbits | 0.4500 | 0.1167 |
| artifact-int8-dynamic | 0.3500 | 0.0500 |

Versus chance: MLP +0.3167, +0.3500, +0.2500; SVM +0.0000, +0.0167,
-0.0500. The entry records belowChance flags, including the true negative
for the int8 SVM row, because a below-chance probe value is recorded as it
is measured, not hidden.

Every number is reproducible from the append-only ledger
results/weft-h2-identity-probe.json (runId 61d4becf1442d3ad9d2621e945031e86c629622554b95d104c9911a454010706);
a rerun with the same artifacts and libraries reproduces the runId and is a
no-op.

## Verdict

Identity is recoverable above chance from the frozen pooling output in
every condition, including the frozen MiniLM control. Quantization did not
erase the recoverable identity signal: the int4 artifact's MLP recovery
(0.4500) sits within two eval documents of the fp32 control (0.4167) with a
60-document eval set, and the int8 artifact stays ten points above the
majority-chance baseline (0.3500 vs 0.1000). The honest verdict for the
model-card wording is therefore: the shipped encoders are identity-blind
only in the measured post-hoc sense stated there, and the measurement now
exists. The word identity-blind stays scoped to a measured probe result;
the corpus and the shipped encoders do not make identity recovery
impossible, and the probe numbers above say so.

The RBF-SVM rows sit at or below chance in all three conditions while the
same representation gives the MLP a large margin. This replicates in
miniature the probe-family-specific reading from the W7 verification
record (the INLP precedent: nonlinear recovery is a property of the probe
family, and a near-chance linear-kernel probe does not certify
identity-blindness). The MLP remains the primary probe and the number to
quote.

Limits, recorded plainly: one corpus with 240 documents and 16 identity
keys, a 60-document eval set so single-condition swings of one or two
documents move the numbers by several points, an estate whose documents
carry the author's name as an identity surface so recovery is a
representation-fidelity measurement rather than a leak-of-a-hidden-pii
measurement, and no voice axis to stratify by. The probe did not run
against the live v4 corpus because its per-document identity keys are not
committed; if a later ticket commits that corpus with labels, rerunning the
probe on it is the natural stronger reading.

## Where

- Script: scripts/run-weft-h2-identity-probe.py (fail-closed, typed errors,
  append-only ledger with a content-addressed runId, temp file plus atomic
  rename).
- Ledger: results/weft-h2-identity-probe.json.
- Tests: test/weft-h2-identity-probe.test.js.
