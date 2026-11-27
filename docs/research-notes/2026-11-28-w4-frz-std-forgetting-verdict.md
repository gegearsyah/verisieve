# W4-frz and W4-std run verdict: the link head, not forgetting, fails the fixture gate — 2026-11-28

Two runs close out the founder handoff of
`docs/research-notes/2026-11-28-w4-specialist-research-handoff.md` (levers 1 and
the standard-recipe lever that replaced the inexecutable mixed-domain lever, see
the corpus-cap note below). Both are recorded in the append-only ledger
`results/weft-specialist-training.json` (tickets W4-std, W4-frz) and both are
honest negatives on the story-36 gate as it is written today.

## 1. The runs

| Ticket | Recipe | Data | Fixture gate F1 | Live holdout F1 (link head) |
|---|---|---|---|---|
| W4-data (committed) | 5e-5, 20 ep | live v2, 48k pairs | 0.2220 | 1.0000 |
| W4-std | 2e-5, 2 ep (SBERT-standard, arXiv:1908.10084) | live v2, unchanged | 0.3073 | 0.9950 |
| W4-frz | frozen base (--lr-base 0), heads only, 20 ep | live v2, unchanged | 0.2961 | 0.9748 |

Kaggle: `w4-std-specialist-train` v1 (kernel 147847019) and
`w4-fullscale-specialist-train` v5 (kernel 147789932). Both append to the ledger
from a fresh clone; both keep seed 20261127. The static baseline stays 0.9977.

## 2. The decisive matrix (W4-frz, frozen base)

Local reproduction: `python scripts/analyze-weft-specialist-gate.py`
(needs `models/weft-specialist` populated with the W4-frz weights, which is the
unzipped output of the v5 kernel).

| Scorer | Live holdout (2,000 pairs) | Fixture gate (23,256-pair subset) |
|---|---|---|
| raw MiniLM-L6-v2 cosine | 0.5081 | 0.9977 (26.13x enrichment) |
| W4-frz link head | 0.9748 (3.93x) | 0.2970 (7.55x), max-F1 threshold saturates at 1.000000 |
| W4-frz pooled cosine | (not scored) | **0.9977 (26.13x), identical to the raw base** |

The pooled-cosine row is structural, not measured luck: the encoder was frozen,
so its fixture representation is bit-identical to the raw model. The theme
projection scores 0.6404 on fixture (16.75x).

## 3. Verdict

Catastrophic forgetting is ruled out as the mechanism of the fixture-gate
failure. With the encoder provably untouched, the gate through the link head
still lands at 0.297, inside the same 0.21 to 0.40 band as every previous
recipe. The constant across all five ledger entries is the link head, not the
encoder. The post-mortem's forgetting verdict (commit af6b3af) was a correct
reading of the W4 evidence but is superseded by the frozen-base control.

At the same time the frozen run clears the founder's live-domain bar with room:
0.9748 against the 0.90 target, on frozen features, with the base's general
representation fully intact. Read through the pooled-cosine path, W4-frz
passes the two-domain gate on both halves (fixture 0.9977, live 0.9748). Read
through the link head, the fixture half fails. The release-gate question is now
a scoring-path question, and it needs a founder ruling: which path does the
fixture half of the gate read.

## 4. W4-std observations (why the recipe lever was worth one run anyway)

- Dose response, not a cliff: fixture gate 0.2220 to 0.3073 and pooled cosine
  0.3679 to 0.6740 when the recipe drops from 20 epochs at 5e-5 to 2 epochs at
  2e-5. Forgetting severity tracks tuning aggressiveness, but no severity
  reaches the 0.98 fixture bar, which is consistent with the frozen-base result.
- The OOD failure mode changed: W4-data's head was bimodal-saturated on the
  fixture subset (p50 near 1e-5, no usable threshold); W4-std's head spreads
  across the range (p10 0.19, p50 0.76) and a working threshold exists. The
  head degrades gracefully, it just does not transfer.
- The live domain is near-solved in every recipe (1.0000, 0.9950, 0.9748 for
  20-epoch-tuned, standard-recipe, frozen). The product-relevant variance is
  entirely out-of-domain.

## 5. Why mixed-domain replay was not run

The handoff's lever 2 assumed fixture pairs at scale. The in-repo fixture
corpus is 18 hand-written documents and caps at 44 pairs total (33 train), even
with `--target-pairs 5000` and both recipe flags on. Mixing 33 pairs into
48,000 live pairs is 0.07 percent replay and cannot test anything. The only
larger in-repo generator is the W1 gate estate itself, and training on the
guard's own domain would void the fixture half of the two-domain gate. The
founder ruling (2026-11-28 session) replaced lever 2 with the standard-recipe
run. Replay evidence at sentence-encoder scale, when a general-domain corpus
is available, is arXiv:2305.05968.

## 6. Consequences and queued decisions

1. **Scoring-path ruling (founder, no compute).** The two-domain gate passes on
   pooled cosine and fails on the link head. Ruling options: score the fixture
   half through cosine structure; or keep the link head and hand the OOD half
   to the W5 abstain card (#45).
2. **W5 conformal abstain (#45) inherits the OOD story.** The frozen run shows
   exactly the failure W5 must catch: an in-domain-calibrated head with a
   fixture distribution that no threshold serves (max-F1 sweeps to saturation
   at 1.000000). The conformal design question from the handoff (does it answer
   "refuse when out of domain" or need an explicit OOD detector) is answered by
   the 2026-11-28 literature pass: conformal abstention is valid only under
   exchangeability between calibration and test data, and the measured
   covariate shift breaks it (arXiv:2202.13439); a saturated binary head is
   the worst case because the calibration quantile is meaningless when the
   score distribution collapses. Recommended design, ranked: (a) an explicit
   OOD detector as the tripwire, kNN cosine distance in the frozen encoder's
   embedding space (arXiv:2204.13600), wired to a cosine-routing fallback for
   out-of-domain inputs (learning-to-defer basis, arXiv:2007.07361), with
   conformal used only inside the in-domain route; (b) cosine routing without
   the detector, which works but cannot distinguish handled from silently
   degraded; (c) conformal-only, which is not adequate as the OOD gate.
3. **Multi-style corpus regeneration (Mistral, standing-authorized credit) is
   still unspent.** It is now the confirmation run for a different claim than
   planned: the head's live competence at 0.9748 is measured on one style and
   one organization shape, and the head demonstrably does not transfer across
   synthetic domains. A multi-style corpus would show whether the head can be
   made style-robust or whether the pooled-cosine path plus abstain is the
   product answer.
4. **GRL vs INLP (#44) now has its base recipe.** The founder ruling on
   `results/weft-ablations.json` can proceed on the frozen-base configuration,
   which keeps the encoder stable while the identity ablation varies.
5. **Model artifacts.** The W4-frz weights are the current
   `models/weft-specialist`; the W4-data and W4-std weights are preserved as
   `models/weft-specialist-w4data` and `models/weft-specialist-w4std` (all
   gitignored). The contract test pins the newest ledger entry to W4-frz.

## 7. Literature anchors

- SBERT tuning recipe (2e-5, short schedules): arXiv:1908.10084
- Freeze vs tune decision for pretrained encoders: arXiv:1903.05987
- Forgetting in pretrained representations, replay mitigation: arXiv:2305.05968
- Saturated benchmarks stop discriminating (gate-design precedent):
  arXiv:2104.14337
- Rank-based embedding evaluation (the enrichment column above): arXiv:2210.07316
- Conformal coverage under shift (why conformal is not the OOD gate):
  arXiv:2202.13439, arXiv:1904.06019
- kNN distance as the OOD detector in embedding space: arXiv:2204.13600
- Learning-to-defer / routing to a fallback expert: arXiv:2007.07361

## 8. Reproduction

Both matrices are also recorded as committed artifact numbers in
`results/weft-specialist-analysis.json` (per-run scorer blocks, max-F1 sweeps,
enrichment factors, and the link-head score distributions).

```bash
python scripts/analyze-weft-specialist-gate.py        # section 2 matrix
node --test test/weft-specialist-contract.test.js    # 7 pass (newest entry = W4-frz)
npm run test:ci                                      # 198 pass / 0 fail (+12 skip)
                                                     # and 3 pass / 1 known fail
                                                     # (k7 CRLF, #48)
node scripts/check-paper-numbers.mjs                 # run before any paper cite
```

Kaggle notebook for the frozen run: `w4-fullscale-specialist-train` version 5;
the standard-recipe run: `w4-std-specialist-train` version 1. Changing only the
trainer-cell flags reproduces either run.
