# v4 corpus re-audit: PASS-WITH-NOTES, W4-v4 confirmation run launched — 2026-11-28

The v4 regeneration (6 voices, invented per-chunk casts, seed 20261129,
632 calls, 2,362,136 tokens) was probed statistically and re-audited at the
Opus tier before any training spend. The re-audit verdict is PASS-WITH-NOTES
and the confirmation Kaggle run is live: kernel `w4-fullscale-specialist-train`
version 6, ticket W4-v4, frozen base (--lr-base 0), 20 epochs, seed 20261127,
data `results/weft-training-pairs-fullscale-live-v4` (48,000 train / 2,000
eval), cloned from the `worktree-agent-afc5090c558c3fa39` branch because the
v4 pairs are not on main.

## 1. What the re-audit confirmed

- The voice axis genuinely moved: six distinguishable registers co-exist
  within every major format (the email format alone splits into
  subject-line, bare-terse, quoted-dialogue, Hey-opener, and Dear-opener
  families; 1,268 distinct openers across 1,484 emails). The v3 per-format
  skeletons are broken apart: transcripts run 1 to 25 lines, tables 1 to 28
  rows, and "SCAN:" openers dropped to 40 of 768 scans.
- No new positive-side construction shortcut: voice consistency (0.409
  positive vs 0.428 negative), format combination, length asymmetry,
  greeting artifacts, rare-token co-occurrence, and verbatim n-gram sharing
  are all flat between labels. The v3 marker class ([PERSON_n] and
  OCR-mangled text) is absent entirely, zero occurrences in either label.
- Statistical probes on the compiled pairs: zero same-teacher-call pairs,
  zero negative pairs inside any link component, and the shared-person
  surface cue collapsed from 5,852 negatives / 8 positives (v3) to 1 / 0.
- Theme drift is fixed (6,250 of 6,250 exact) and the person cast
  diversified from 43 to 1,223 distinct surfaces.

## 2. The notes that survive the pass

1. **Length.** The 300 to 600 word band was not honored (max 240, p90 95).
  The run tests style generalization only and says nothing about
  long-document competence; no morning claim may extend it there. A corpus
  driver fix and a v5 retry are the documented path before any length
  claim.
2. **Identity asymmetry (policy constant, not a regression).** All
  positives are identity-disjoint by the weft-pairs-v1 policy, so "same
  identity surface in both texts" implies negative (189 of 189 on eval,
  zero same-thread counterexamples), while 28.2 percent of real
  within-component doc pairs share an identity key. Verified: the v2
  baseline (the 0.97 comparison point) was compiled under the identical
  policy and identical recipe flags, so the confirmation delta reads as
  style robustness, not as a policy change. The ruled product decision
  (bucket design stands, generator-level fix only) is recorded in
  `2026-11-28-w4-v3-corpus-audit-fail.md`.
3. **Tics.** "EOD" sits at 8.3 percent (v3: 7.3), "Hey <roster name>" at
  177 documents, 606 documents recycle an 8-gram from another document
  (never within a sampled pair), Northwind Supply Co appears as the vendor
  for everything in 1,281 documents, and 97 table-format documents contain
  no pipes. Credibility costs for a skeptical reader; none are label
  cues.
4. **Masked positives are absent on v4** (v2 carried 529, v3 carried 246
  only through the now-fixed chunk-marker hole): structural links are
  within-chunk by construction, so the working within-chunk exclusion
  removes the bucket, and identity masking therefore moves to W5.

## 3. Compiler fix on the way (committed, dbd2b6f)

The within-chunk exclusion had silently voided whenever the teacher emitted
ids without the `-doc-` substring: every doc became its own chunk and
`--exclude-within-chunk` matched nothing. The compiler now parses the
`-c<digits>-` chunk marker that `generateTeacherEstates` always writes.
Retroactively this explains v3's 246 masked positives (within-chunk pairs
that escaped the broken exclusion) and would have let about 23,000
same-voice positive candidates into v4's pool unfixed. All 27 Weft tests
pass; fixture digests stayed byte-stable.

## 4. Reading the result when it lands

The confirmation question: does the head's live competence hold at 0.97
when the corpus voice varies, or was 0.97 partly style memorization.
Because the recipe is identical to W4-frz (frozen base, same seed, same
trainer) and only the data changes, the live-holdout delta W4-v4 minus
W4-frz (0.9748 on v2) is the style-robustness measurement. The story-36
fixture gate is expected to stay near the frozen-base band (0.28 to 0.30
through the link head, 0.9977 through pooled cosine) and is not the
variable this run tests.
