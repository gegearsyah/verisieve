# W4-v4 confirmation verdict: live competence was style memorization, and style coverage buys it back — 2026-11-28

The confirmation run is complete and the answer to the launch question
(`2026-11-28-w4-v4-corpus-reaudit-and-launch.md`, section 4) is measured, not
assumed. Kaggle kernel `w4-fullscale-specialist-train` version 6, ticket
W4-v4: frozen base, 20 epochs, seed 20261127, identical recipe to W4-frz, only
the data changed (v4 style-varied corpus, 48,000 pairs, 6 voices). Both models
were then cross-scored on both live corpora, which is the matrix the
single-corpus runs could never show.

## 1. The style-robustness matrix (link head, 2,000-pair holdouts)

| Model (training data) | v2 eval (single voice) | v4 eval (6 voices) |
|---|---|---|
| W4-frz (v2, single voice) | 0.9748 | **0.4798** |
| W4-v4 (v4, 6 voices) | 0.6695 | **0.9652** |

The 0.9748 was substantially style memorization. The v2-trained head loses
roughly half its F1 (0.9748 to 0.4798) the moment the corpus voice varies, on
frozen features, with the recipe untouched. Training on six voices restores
competence on style-varied data (0.9652, above the 0.90 bar) but the transfer
to the one unseen voice is partial (0.6695). Style robustness is a
training-coverage property of the head, not a property it already had.

One boundary on the headline: the v4 eval shares its six voices with the v4
training corpus, so 0.9652 is within-coverage competence. Unseen style (the
v2 cell) is not solved by the head and remains the W5 routing question.

## 2. The two-domain gate reading (unchanged scoring-path caveat)

On the reading used in the W4-frz verdict (live half through the link head,
fixture half through cosine structure), **W4-v4 passes both halves**: live
0.9652 against the 0.90 target, fixture 0.9989 through the fine-tuned pooled
cosine, which is above the 0.9977 baseline rather than below it (the salience
pooling is part of the head, so it learned something the raw encoder does not
have). Through the link head the fixture half still fails (0.3617, within the
0.21 to 0.40 band of every recipe so far; the Kaggle in-run gate printed
0.3610 cross-department). The founder's pending scoring-path ruling from the
W4-frz verdict is unchanged by this run and still decides the release gate.

Full fixture matrix (W4-v4): link head 0.3617 (9.23x), pooled cosine 0.9989
(26.16x), theme projection 0.7231 (18.61x), raw MiniLM cosine 0.9977
(26.13x).

## 3. The pooled-cosine fallback is live-blind

All four cross cells of the fine-tuned pooled cosine on live holdouts land in
0.5304 to 0.5481 (W4-frz/v2 0.5481, W4-frz/v4 0.5304, W4-v4/v2 0.5476,
W4-v4/v4 0.5393). Its competence is fixture-only. For the W5 routing design
this sharpens the ruled architecture (kNN OOD detector, cosine fallback,
conformal only in-domain): the cosine route is a fallback for fixture-like
domains, not a live-domain scorer. Live domains keep the head, and the head's
coverage is only as wide as the styles it was trained on, which is exactly
the condition the OOD detector exists to detect.

## 4. Consequences

1. **The mistral-large escalation trigger did not fire.** The documented
   trigger (v4 audit still shows a single voice, or style still fails) is
   unmet: the voice axis moved and within-coverage style competence holds at
   0.9652. The remaining failure (unseen-style transfer) is a data-coverage
   property, not a model-quality signal, so no new licence-audit entry is
   needed for the style axis.
2. **The length caveat stands.** Nothing in this run reaches past the
   240-word envelope, so no claim about long-document competence follows. A
   corpus-driver fix and a v5 retry stay the documented path before any
   length claim.
3. **Model artifacts.** The W4-v4 weights are the current
   `models/weft-specialist`; W4-frz is preserved as
   `models/weft-specialist-w4frz` (all gitignored). The contract test pins
   the newest ledger entry to W4-v4 and the v4 pairs.
4. **Story-36 release status is unchanged**: the gate delta is negative
   (-0.6367) and the release stays at risk; the honest product reading is
   the two-domain one above plus the W5 abstain card (#45) for the
   out-of-coverage route.

## 5. Reproduction

```bash
python scripts/analyze-weft-specialist-gate.py            # W4-v4 fixture + v2 live
python scripts/analyze-weft-specialist-gate.py \
  --eval-jsonl results/weft-training-pairs-fullscale-live-v4/eval.jsonl   # v4 live
python scripts/analyze-weft-specialist-gate.py \
  --eval-jsonl results/weft-training-pairs-fullscale-live-v4/eval.jsonl \
  --model-dir models/weft-specialist-w4frz                 # the 0.4798 cell
node --test test/weft-specialist-contract.test.js          # 7 pass (newest = W4-v4)
```

The matrix and the cross cells are committed as the W4-v4 run block of
`results/weft-specialist-analysis.json`; the run itself is entry 6 of
`results/weft-specialist-training.json` (append-only, prefix verified
byte-identical to the committed five entries). Kaggle notebook:
`w4-fullscale-specialist-train` version 6.
