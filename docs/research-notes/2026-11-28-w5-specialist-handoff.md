# Founder Research Handoff: W5 quantized export and the OOD routing card (#45) — 2026-11-28

Written for the founder and the W5 worker. Everything below is either a
committed artifact, a number reproducible by one command, or an explicit
open question. W4 is closed by the confirmation verdict
(`2026-11-28-w4-v4-confirmation-verdict.md`); this note carries its
consequences into W5.

## 1. The situation in one paragraph

The specialist (MiniLM-L6-v2 + heads, frozen base) is honestly good on the
ground it was trained on: 0.9652 pairwise F1 on a 6-voice live holdout
(precision 0.9932), above the founder's 0.90 bar. The confirmation run also
proved the head does not generalize beyond its training coverage: a
single-voice-trained head collapses to 0.4798 under style variance, and the
6-voice head transfers only partially to the unseen voice (0.6695). No
scorer in the arsenal is competent on unseen-coverage live data (the pooled
cosine measures 0.5304 to 0.5481 in every live cell). W5's job is to make
that boundary a product feature instead of a silent failure: detect
out-of-coverage inputs, abstain or route instead of guessing, and ship the
specialist at browser scale under 30 MB with fail-closed loading.

## 2. What W4 left behind (all committed, append-only)

| Artifact | Content |
|---|---|
| `results/weft-specialist-training.json` | 6 entries, newest W4-v4 (frozen base, v4 style-varied data, seed 20261127) |
| `results/weft-specialist-analysis.json` | W4-std / W4-frz / W4-v4 scorer matrices plus the styleRobustness cross-cells |
| `results/weft-ablations.json` | 10 entries: 5 tuned, 5 frozen (stages `bare-frozen` etc., both delta fields) |
| `models/weft-specialist` | W4-v4 weights (93,378,35 bytes, sha256 a9d78b79…, gitignored) |
| `models/weft-specialist-w4frz`, `-w4data`, `-w4std` | preserved prior weights (gitignored) |
| `results/weft-training-pairs-fullscale-live-v4/` | 48,000 train / 2,000 eval, 6 voices, receipt + usage (mistral-medium, 632 calls, 2.36M tokens) |

Reproduce the matrices with `python scripts/analyze-weft-specialist-gate.py`
(optionally `--eval-jsonl results/weft-training-pairs-fullscale-live-v4/eval.jsonl`
and `--model-dir models/weft-specialist-w4frz` for the cross cells).

## 3. The measured facts W5 must design against

1. **Coverage is the boundary.** Link head: 0.9652 on covered style,
   0.6695 on the unseen voice, 0.4798 when a single-voice model meets varied
   style. The head is only as wide as its training styles.
2. **The pooled-cosine fallback is live-blind.** 0.5304 to 0.5481 on every
   live holdout, both models. Its competence is fixture-only (0.9989 on the
   W1 estate, above the 0.9977 raw baseline). Cosine routing helps
   fixture-like domains; it does NOT rescue unseen-coverage live data.
3. **Conformal is in-domain only.** Exchangeability breaks under the
   measured covariate shift (arXiv:2202.13439); a saturated head makes the
   calibration quantile meaningless. The W4-v4 head is better-behaved
   (usable threshold 0.6878 on the v4 holdout) but the principle stands.
4. **The story-36 gate stays negative through the link head** (0.3617,
   band 0.21 to 0.40) and passes through pooled cosine (0.9989). The
   founder's scoring-path ruling is still open and decides the release gate.

## 4. The W5 design (ruled, from the W4 verdict + the 2026-11-28 rulings)

Ranked architecture, adopted as the working design:

1. **kNN OOD detector as the tripwire:** cosine distance to the training
   corpus in the frozen encoder's embedding space (arXiv:2204.13600). It
   answers "have I seen this kind of document" before any score is trusted.
2. **Route by coverage:**
   - covered (detector says in-distribution) → link head with conformal
     abstention calibrated in-domain (Learn-Then-Test, existing machinery,
     H7 acceptance: false-merge rate under alpha with usable coverage);
   - out-of-coverage → **abstain or route to human review**, not to cosine;
     the measured live-blindness of cosine is the reason.
   - fixture-like domains (the W1 estate family) → pooled cosine is
     competent and may serve as the fallback there.
3. **Learning-to-defer framing** (arXiv:2007.07361) for the routing hooks
   already in scope item 3 of #45 (low-margin routing to a larger local
   model or human review).

## 5. W5 ticket scope (from #45, with W4 additions)

1. Quantization-aware training to the 10 to 25 MB target (2/3/4-bit
   ablated); WASM/ONNX export, single artifact, browser and Node; zero-import
   invariant and size ceilings hold.
2. Conformal abstain per the design above; application-level claims only.
3. Latency, memory, and size numbers per quantization level (append-only
   `results/weft-export-latency.json`); H5 (90% of the local LLM judge's
   pairwise F1 at 1/50 latency, under 30 MB) measured honestly.
4. Fail-closed load when weights are absent (typed error, never a fallback
   similarity). New: `scripts/export-weft-quantized.py`,
   `test/weft-export-failclosed.test.js`.
5. **Moved into W5 from W4: identity masking robustness.** The v4 pairs
   carry zero masked positives (structural links are within-chunk, so the
   fixed exclusion removes the bucket); W5 must either generate masked
   eval data or accept the masked-robustness claim is unmeasured.
6. **Length caveat stays:** the corpus tops out at 240 words; no
   long-document competence claim before a driver fix and a v5 corpus.

## 6. Open decisions for the founder (no compute)

1. **Story-36 scoring path:** fixture half through pooled cosine (passes,
   0.9989) or the link head (fails, 0.3617)? This single ruling decides the
   release gate's status.
2. **PR #53 merge** (founder-only, ready now).
3. **Whether W5 trains its detector on v4 or a fresh corpus** is a worker
   decision inside the ruled design.

## 7. Literature anchors

- kNN distance as the OOD detector in embedding space: arXiv:2204.13600
- Learning-to-defer / routing to a fallback expert: arXiv:2007.07361
- Conformal coverage under covariate shift (why in-domain only):
  arXiv:2202.13439, arXiv:1904.06019
- INLP null-space projection (the adopted identity suppression, #44):
  arXiv:2004.07667 (Elazar & Goldberg caveat on probe reliability)

## 8. Standing rules (carry into W5 work)

- Worker tier: cheapest capable model per task; code, PR mechanics, and
  small chores go to Haiku (founder ruling, 2026-11-28). Escalate one tier
  per failed attempt before declaring a ticket stuck.
- Honest-reporting word ban: never write the banned literal terms;
  identity-orthogonality is worded "identity-blind".
- Append-only ledgers; fail-closed everywhere; no em-dashes in prose.
- GPU window: Kaggle 2x T4 via the established notebook pattern
  (`w4-fullscale-specialist-train` v6 is the template).
