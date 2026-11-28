# W5: v5 coverage corpus and source-disjoint strata, stage close

Date: 2026-11-29
Lane: weft-corpus-v5
Status: stage complete; estate extension is the next audited build

## What landed

Three coverage corpora (one per org profile, seed 20261130, teacher mistral-medium under the audited mistral-api-tos licence) plus three source-disjoint strata sets built on the #59 rulings (source = meeting/thread/ticket/document anchor, theme = knowledge, identity = the person erasure axis only).

| Profile | Coverage docs | Coverage links | over300 docs | Strata positives | Strata negatives |
|---|---|---|---|---|---|
| regional-logistics | 6,250 | 3,944 | 135 | 400 | 200 |
| hospital-network | 6,250 | 3,782 | 114 | 399 | 200 |
| municipal-office | 6,250 | 3,930 | 129 | 399 | 199 |

Totals: 18,750 docs, 11,656 links, 378 documents past 300 words (v4 produced none past 240; municipal-office reached 527). Drops are honest per receipt: one residual identity collision and two placeholder echoes across the three scaled strata passes; everything else passed the fail-closed validation.

## The crossing, replicated three times

The property the #59 acceptance asked for (BM25 must not saturate the bucket) is now replicated on three independently generated profiles:

| Profile | Positives overlap (source-to-paraphrase) | Negatives overlap |
|---|---|---|
| regional-logistics | 0.0347 | 0.1436 |
| hospital-network | 0.0377 | 0.1487 |
| municipal-office | 0.0354 | 0.1609 |

Negatives share 4 to 5 times more lexical content than positives on every profile, while positives stay under the 0.0718 same-theme baseline recorded in the smoke. A lexical matcher therefore scores the wrong pairs higher on all three profiles; the theme-linking signal in these strata is semantic, not word reuse. Anchor-to-paraphrase overlaps: 0.0280, 0.0320, 0.0292.

## Spend accounting

- Coverage, all three profiles end to end: 1,693 calls, 5,641,981 tokens (results/weft-api-usage-v5.tmp.json). This includes the resumed work after the three crashes; the crash-window loss before checkpointing exists (~65 calls of unknown size) is recorded in the 2026-11-29 corpus driver note and is not counted as zero.
- Scaled strata passes: 1,800 calls, 1,322,499 tokens across the three profiles (about 437K to 446K tokens each, roughly 31 to 39 minutes each).
- The strata smoke pass (small, prior to scaling) and its three debug failures are recorded in the rework and re-audit notes.
- Standing honesty rules: negatives' talking-point difference is teacher-claimed, not mechanically verified (receipt caveat on every profile); the paraphrase's department match is likewise teacher-claimed and visible in the per-pair receipts.

## Files

- Coverage corpora: results/weft-fullscale-live-corpus-v5-<profile>.tmp.json (tmp pattern, not committed; regenerate deterministically from seed if needed)
- Strata pairs and receipts: results/weft-paraphrase-strata-v5-<profile>/ (strata-pairs.jsonl, receipt.json; committed as the stage deliverable)
- Every strata pair carries eventA/eventB compile-time event anchors derived from coverage link clusters.

## Next

The estate extension per the #59 rulings, designed as one coherent build with its own pre-spend audit before any spend: the source-kind axis on generated docs, people-free knowledge units, a non-knowledge negative class, the knowledge-density filter (rule plus measured effect in a note), and company-private knowledge units proven erasable by regenerate-minus-unit byte-diff receipts. The optional head-retrain arm over these strata stays a follow-up, not a release dependency.
