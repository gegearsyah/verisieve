# W4 specialist post-mortem: what the three gate failures actually mean — 2026-11-27

Judge research note for the Weft track (#40, after closing #51 and #52). All numbers
below were computed locally from the committed artifacts and the saved W4-data model
(`models/weft-specialist`, digest `7ed0c546…`, verified against the recorded artifact
digest) plus the raw MiniLM-L6-v2 snapshot from the local HF cache. The fixture-gate
replication reproduced the committed W4-data numbers exactly (specialist 0.2220,
threshold 0.999835), which pins the analysis to the same model the gate judged.

## The four-corner table

| Scorer | Live eval (2,000 held-out pairs, in-domain) | Fixture gate (28,680 pairs, out-of-domain) |
|---|---|---|
| raw MiniLM-L6-v2 cosine, no training | 0.508 | **0.9977** |
| W4-data specialist, link head | **1.0000** | 0.2220 |
| W4-data specialist, pooled cosine | 1.0000 | 0.3679 |
| W4-data specialist, theme cosine | 1.0000 | 0.3321 |

(The static potion-base-32M baseline scores 0.9977 on the fixture gate; raw MiniLM
matches it, so the fixture estate is trivially separable by generic encoders.)

## What it says

1. **The training works.** Fine-tuning took in-domain competence from 0.508 (raw base)
   to a perfect 1.0000 on held-out pairs, including the pair types the base cannot
   separate: raw MiniLM misranks 287 identity-matched negatives (same person, different
   thread) and 191 disjoint different-theme negatives. The specialist genuinely learned
   the Company Brain discrimination task, not just the corpus.

2. **The gate does not measure that skill.** On the fixture estate every generic encoder
   already scores 0.9977, so the only signal the gate can register is damage. All three
   fine-tunes (W3 0.399, W4 0.213, W4-data 0.222) scored below zero-training because
   fine-tuning the base encoder at 5e-5 for 20 epochs catastrophically forgets the
   general representation that aces the fixture. The link head compounds this by
   saturating bimodally on out-of-domain text (gate-subset scores: 25% at 0.0000,
   24% above 0.99, almost nothing in between), so the max-F1 sweep has no usable
   operating point.

3. **The recipe fixes from #52 were real but secondary.** Closing the identity and
   chunk-style shortcuts doubled gate recall (0.44 to 0.70) and improved the
   contrastive loss materially (crossclr 0.85 to 0.67 against a harder negative pool),
   but ranking enrichment stayed ~1.6x on the gate subset because the binding
   constraint is forgetting, not pair-type shortcuts.

## What follows

- The release gate as written (beat 0.9977 on the fixture estate) demands a strict
  superset model: keep every general skill and add the specialist skill. That is a
  two-domain requirement and should be stated as one: a specialist that scores
  (a) at or above the raw base on the fixture estate and (b) clearly above the raw
  base on the live eval. Neither domain alone is an honest gate.
- The cheapest forgetting experiment is a frozen-base run (`--lr-base 0`, heads
  only) on the v2 pairs: if held-out live competence survives (it should, the task
  is linear-ish in pooled features) while the pooled representation stays raw, the
  recipe becomes heads-on-frozen-base plus an out-of-domain calibration path (which
  is W5 scope, #45). One Kaggle run, no API spend.
- Failing that, the standard ladder is small base LR, few epochs, or an anchor term
  that pins general cosine structure during training.

Numbers above are reproducible with `scripts/analyze-weft-specialist-gate.py`
(fixture-gate four-way comparison) against `models/weft-specialist` and the
committed pair artifacts.
