# Founder Research Handoff: the W4 specialist gate question — 2026-11-28

Written for founder-led deep research (no agent needed). Everything below is
either a committed artifact, a number reproducible by one command, or an explicit
open question. Companion note: `docs/2026-11-27-w4-specialist-postmortem.md`
(the judge's verdict note, commit af6b3af).

## 1. The situation in one paragraph

The Weft track trains a theme-linking specialist (MiniLM-L6-v2 + heads) to decide
whether two documents belong to the same thread. The story-36 release gate says the
specialist must beat a static embedding baseline (potion-base-32M) on
identity-disjoint cross-department pairwise F1 over the W1 synthetic estate
(`scripts/run-weft-baseline-shootout.py`, seed 20261127). Three training runs later,
the specialist scores **0.399 / 0.213 / 0.222** against a baseline of **0.9977**.
The post-mortem found the failure is not the data (both label shortcuts were closed,
#52) and not the head: it is catastrophic forgetting. The fine-tune takes the base
encoder's in-domain competence from 0.508 to a perfect 1.0000 on held-out live
pairs, while destroying the general representation that scores 0.9977 on the fixture
estate. The open question is now a design question, and it belongs to the founder.

## 2. Run ledger (all committed, append-only)

| Run | Ticket | Training data | Gate F1 (specialist) | Baseline | Verdict |
|---|---|---|---|---|---|
| W3 fixture | #40 W3 | fixture pairs (results/weft-training-pairs) | 0.3993 | 0.9977 | negative |
| W4 full-scale | #51 | live v1, 33k pairs (mistral teacher) | 0.2129 | 0.9977 | negative; two label shortcuts found |
| W4-data retrain | #52 | live v2, 48k pairs, both shortcuts closed | 0.2220 | 0.9977 | negative; shortcuts were real but secondary |

Artifact: `results/weft-specialist-training.json` (3 entries, runIds verified,
`appendOnly: true`). Pairs: `results/weft-training-pairs-fullscale-live-v2/`
(train.jsonl 48,000 pairs + eval.jsonl 2,000 + receipt.json with recipeOptions).
Compiler: `scripts/build-weft-training-pairs.mjs`. Trainer:
`scripts/train-weft-specialist.py` (`--ticket`, `--data-scale` flags recorded in
the entry). Model saved at `models/weft-specialist` (gitignored, 93,377,839 bytes,
sha256 7ed0c546… matches the artifact-recorded digest).

## 3. The decisive experiment matrix (all reproduced by one command)

`python scripts/analyze-weft-specialist-gate.py` (needs the local HF cache and
`models/weft-specialist`; runs on CPU in ~3 min) prints:

| Scorer | Live holdout (2,000 pairs, in-domain) | Fixture gate (23,256-pair subset, out-of-domain) |
|---|---|---|
| raw MiniLM-L6-v2 cosine, no training | 0.5081 | **0.9977** (26.13x enrichment) |
| W4-data specialist, link head (gate's path) | **1.0000** | 0.2220 (1.62x) |
| W4-data specialist, pooled cosine | 1.0000 | 0.3679 (9.17x) |
| W4-data specialist, theme cosine | 1.0000 | 0.3321 (8.35x) |

Supporting observations:

- Raw MiniLM's live-holdout errors at its best threshold: 287
  identity-matched-theme-different-negative, 191 disjoint-different-theme-negative,
  156 disjoint-same-theme-positive, 7 masked-positive. The base cannot separate
  same-person-different-thread from same-thread — exactly the skill Company Brain
  needs. The specialist separates all of it.
- Link-head scores on the gate subset are bimodal: p50 ≈ 0.000007, p75 0.897,
  23.65% above 0.99. There is no usable threshold out-of-domain; the max-F1 sweep
  lands at 0.9998 and the F1 collapses.
- All three fine-tunes cluster at 0.21-0.40 while every zero-training encoder
  (potion-32M static baseline, raw MiniLM) scores 0.9977. The fixture estate is
  ceilinged for generic encoders: the gate can only register damage, never gain.
- The #52 recipe fixes did move real things: gate recall 0.44 -> 0.70, contrastive
  loss 0.85 -> 0.67 against a harder negative pool. They just were not the binding
  constraint.

## 4. Verdict (judge's, already committed)

Catastrophic forgetting / domain overfit. Fine-tuning the base at 5e-5 for 20 epochs
teaches the live corpus and loses the general representation. Not a head problem
(the head is fine in-domain, saturated out-of-domain), not a pair-recipe problem
(fixed, gate barely moved).

## 5. Open questions for founder deep research

These are the seams where outside literature and product judgment matter:

1. **Is the fixture estate a valid gate at all?** A ceiling effect (0.9977 for any
   generic encoder) means the gate has no headroom to measure a specialist gain.
   What would an honest gate look like: a harder synthetic estate, a real corpus,
   rank-based metrics (enrichment at k) instead of thresholded F1, or the two-domain
   formulation below?
2. **Two-domain gate.** Proposal on the table (post-mortem, #40 comment): the release
   gate should read "at or above the raw base on the fixture estate AND clearly
   above the raw base on the live eval". Is that the right product requirement, and
   what margin counts as "clearly"?
3. **Forgetting mitigation ladder.** In rough cost order: freeze the base
   (`--lr-base 0`, heads only — one Kaggle run, free); shrink base LR / fewer
   epochs; an anchor/distillation term that pins general cosine structure
   (learning-without-forgetting style); parameter-efficient tuning (LoRA-style
   adapters — would need new code, currently absent); mixed-domain training
   (fixture pairs + live pairs in one run — both datasets are already on disk).
   What does the literature say is the right ladder for a 22M-parameter encoder
   with ~50k pairs?
4. **Is the 1.0000 live score itself trustworthy?** The live corpus is
   teacher-generated in one style, one organization shape. Even with both label
   shortcuts closed, residual style cues could remain. The standing-authorized
   Mistral credit (~$120) exists precisely for this: regenerate a multi-theme,
   multi-style corpus and re-test. The recipe flags for this already exist in the
   compiler.
5. **Out-of-domain calibration.** The link head's bimodal saturation suggests the
   scoring path needs an abstain/temperature story out-of-domain — this overlaps
   W5 (#45, quantization + conformal abstain), which is still queued. Does the
   conformal design already answer "refuse when out of domain", or does it need
   an explicit OOD detector?
6. **GRL vs INLP (#44)** — still awaiting a founder ruling on
   `results/weft-ablations.json`, but this decision is now downstream of the
   forgetting question: pick the forgetting recipe first, then re-run the
   identity-ablation on top of it.

## 6. Ranked experiment levers (cheapest decisive test first)

1. **Frozen-base retrain** on the v2 pairs (`--lr-base 0`). Free, one Kaggle run.
   Decides: does live competence survive on frozen features? If yes, the recipe is
   heads-on-frozen-base + an OOD scoring path, and the forgetting question is
   answered without any new mechanism.
2. **Mixed-domain training** (fixture + live pairs together). Free recompile of
   training data plus one Kaggle run. Tests the replay-style fix directly against
   the current gate.
3. **Multi-theme corpus regeneration** with the Mistral credit, then retrain.
   Decides whether the 1.0000 is real skill or residual style.
4. **Gate redesign** (founder ruling, no compute): two-domain statement, or a
   regenerated harder estate.
5. LoRA/adapters or anchor-loss training code — only if 1 and 2 both fail.

## 7. Reproduction and verification commands

```bash
python scripts/analyze-weft-specialist-gate.py        # every number in section 3
node --test test/weft-specialist-contract.test.js    # artifact schema + digests
npm run test:ci                                      # expect 210 pass / 0 fail (+12 skip)
                                                     # and track stage 4 tests / 1 known
                                                     # fail (k7 CRLF, #48)
node bin/versieve.mjs audit-wasm                     # allVerified: true
node scripts/check-paper-numbers.mjs                 # 1619 checks, 0 failures
```

Kaggle notebook (version 4, the W4-data run):
`gegeardiyansyah/w4-fullscale-specialist-train`, kernel 147789932. Changing only
`--lr-base` in the trainer cell reproduces lever 1.

## 8. If the research produces a written note

Standing rules that apply to any new doc: append-only results (never overwrite
committed baselines), the three-term honest-reporting word ban (see
`test/weft-specialist-contract.test.js` for the exact list), no em-dashes in
LaTeX, honest negative results are publishable as-is,
and paper-style rulings (privacy words never lead; titles hit the training-data
question). The novelty re-check to cite for claims is
`docs/research-notes/2026-11-27-weft-novelty-recheck-and-licence-audit.md`.
