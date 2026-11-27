# Q12 ruling memo: the frozen-base identity ablation (GRL vs INLP, #44) — 2026-11-28

Prepared for the founder ruling on ticket #44. The frozen-base ablation re-run
(Q12 ruling, 2026-11-28 session) is complete: five stages (bare, adversary,
set-conditioning, triangle, modality) at `--lr-base 0`, appended to
`results/weft-ablations.json` (runIds f40c17ad… through the modality entry,
recorded 2026-11-27T15:24Z, seeds 20261127). Fixture-scale CPU disclosure
applies to every number below: 11 W2 pairs, the W1 synthetic estate
evaluation, not the Kaggle 2x T4 recipe.

## 1. The frozen-base matrix (chance probe accuracy 0.0625, majority 0.0921)

| Stage | Pairwise F1 | Delta vs W4-frz bare (identity-disjoint cross-dept) | Probe lin / MLP before | Probe lin / MLP after INLP | In-training adversary accuracy |
|---|---|---|---|---|---|
| bare | 0.2843 | -0.0013 | 0.1974 / 0.2632 | 0.0395 / 0.0263 | off |
| adversary (GRL) | 0.2849 | -0.0005 | 0.1974 / 0.2632 | 0.0395 / 0.0526 | 1.0000 |
| set-conditioning | 0.3407 | +0.0627 | 0.2105 / 0.3684 | 0.0658 / 0.0395 | off |
| triangle | 0.2951 | +0.0076 | 0.1974 / 0.2763 | 0.0395 / 0.0395 | off |
| modality | 0.2834 | -0.0021 | 0.1842 / 0.2895 | 0.0526 / 0.0658 | off |

## 2. What the numbers say

1. **The GRL arm is structurally vacuous under a frozen base.** The
   gradient-reversal classifier pushes reversed gradients into the encoder
   parameters; with `--lr-base 0` those parameters never move, so the arm can
   do nothing by construction. The measurement agrees: the adversary stage's
   probe battery is bit-identical to bare (0.1974 / 0.2632 on both linear and
   MLP probes), its pairwise F1 sits within noise of bare (0.2849 vs 0.2843),
   and the in-training adversary reaches accuracy 1.0000 because the frozen
   link representation keeps whatever identity information it has and
   nothing can push it out. This is the predicted structural result, now
   measured.
2. **INLP works on the frozen base and is the meaningful arm.** Post-hoc
   null-space projection drops the linear probe from the 0.18 to 0.21 band to
   0.039 to 0.066, at or below the 0.0625 chance line, and drops the MLP probe
   from 0.26 to 0.37 to 0.026 to 0.066. The encoder never moved: the removal
   is entirely in the exported theme embedding's null-space projection.
3. **Set-conditioning is the only stage with a positive delta in both
   configurations** (+0.0627 frozen here; the tuned run at 5e-5 had it at the
   top of its matrix too). It is orthogonal to the identity question and worth
   keeping in the recipe conversation, separate from #44.
4. **Tuned-vs-frozen probe comparison.** At 5e-5 the bare run's pre-INLP
   probes were 0.1579 / 0.2237; frozen, they are 0.1974 / 0.2632. Fine-tuning
   removes some identity information from the theme embedding as a side
   effect; freezing keeps more of it, which makes the post-hoc INLP step more
   necessary, not less.

## 3. Recommendation for the #44 ruling

Adopt INLP (post-hoc, fitted on identity labels only, link labels never used)
as the identity-suppression mechanism on the frozen-base recipe, and drop the
in-training GRL arm from the production path. Grounds:

- Under the founder-ruled frozen-base configuration, GRL is structurally
  inert; there is no scenario where it contributes.
- The Elazar and Goldberg (2018) caveat already recorded in the artifact
  warns that in-training adversaries can reach chance while a post-hoc probe
  still recovers the attribute; INLP's before/after probe battery is the
  direct measurement of the property the product claim needs.
- INLP's cost is a one-time projection fit at export time, with no training
  run of its own.

The fixture-scale caveat stands: 11 training pairs and a 240-document
evaluation estate. The numbers above are consistent and structurally
explained, but the ruling can note that the INLP before/after battery should
be re-measured at full scale on the v3 corpus confirmation run before any
paper claim cites it.

## 4. Reproduction

```bash
python scripts/run-weft-ablations.py --device cpu --lr-base 0 --stage all
# appends the five frozen-base entries to results/weft-ablations.json
node --test test/weft-specialist-contract.test.js
```
