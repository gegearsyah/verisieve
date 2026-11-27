# v3 corpus audit: FAIL, regenerated as v4 with an explicit style axis — 2026-11-28

The multi-theme corpus ruling (Q11, 2026-11-28 session) was executed overnight:
`scripts/generate-weft-live-corpus-v3.mjs` regenerated the live corpus with 10
themes (mistral-medium, 630 calls, 1,980,358 tokens, seed 20261128, 6,250 docs,
3,639 links), pairs were compiled (48,000 train / 2,000 eval, both #52 recipe
flags on), and an Opus-tier corpus audit ran before spending the confirmation
Kaggle run, per the founder's higher-tier ruling for data synthesis and
verification. The audit failed the corpus. The confirmation run was not
launched. This note records what failed, what was fixed, and what still needs a
founder decision.

## 1. The audit verdict

**FAIL for the confirmation run as scoped in the W4-frz/W4-std verdict note
(section 6.3).** The corpus is mechanically sound but does not contain the
variable the confirmation run exists to test.

What the audit confirmed clean:

- Labels agree with the link graph. Zero negative pairs sit inside any
  connected component (union-find over all link types), and the compiler's
  own disjointness checks enforce the same property.
- Within-chunk verbatim exclusion works: shared 4-gram overlap between pair
  sides is identical for positives and negatives (mean 0.02 each).
- Length and department cues are balanced across labels.
- Theme-field drift (295 of 6,250 docs carry title-like theme strings) is
  cosmetic metadata noise: labels come from links, and every drifted string
  still contains a canonical theme keyword, so the pairs are unaffected.

What failed:

1. **The style axis never moved.** One teacher voice across all 10 themes:
   the same email skeleton, the same register, rigid per-format templates
   (every transcript is a 3 to 6 line exchange, every table is 2 to 4 pipe
   rows), and the same 12-name cast in every department. Corpus-wide tics:
   "EOD" in 7.3% of documents, "Best," in 9.2%. Lengths sit in the same
   9 to 94 word envelope as v2 (mean 33.6 words, no document over 94). The
   driver's own assumption that per-chunk seeds produce style variance is
   wrong: seeds reshuffle content, not voice. A confirmation run on v3 would
   test theme robustness only; a high score would be indistinguishable from
   the style memorization already suspected at 1.0000.
2. **A deterministic text-level label cue: shared person name implies
   negative.** 5,870 train pairs mention the same person surface on both
   sides; 5,852 are negative (99.7%), and on the eval slice it is 257 of 257.
   Root cause is the bucket design: identity-disjoint positives never share
   identity keys, identity-matched negatives must share at least one, and
   chunk-unique identities reused roster surfaces, so name co-occurrence
   tracks the negative label. This is not a v3 regression (v2: 98.7%) but it
   is backwards relative to real enterprise data, where same-thread documents
   usually do mention the same people.
3. **Masked-positive construction markers leak the label.** Literal
   placeholder tokens ([PERSON_1] family) and OCR-mangled text occur only in
   positives (174 of 174 train, 5 of 5 eval): the compiler applied masking
   and text augmentation only on the masked-positive pair type. Small
   coverage but perfectly exploitable, and it is the positive-side twin of
   the negative-side artifact #52 closed.

## 2. What was fixed before regenerating (all tested, all flag-gated)

- **Prompt style axis** (`scripts/build-weft-training-pairs.mjs`):
  `generateTeacherEstates` now accepts per-chunk voice hints and a length
  mix; the base prompt no longer asks for "short documents"; the prompt now
  requires chunk-unique identities to use invented names distinct from the
  roster surfaces (attacks finding 2 at the generator), pins the theme
  field to the exact theme string (closes the drift), and bars identity key
  strings (emp-/vendor- prefixes) from document text.
- **Masked-marker dilution** (same file, opt-in `--dilute-masked-markers`):
  a deterministic 5% hash-slice of identity-matched negatives now receives
  the same masking and augmentation as masked positives, so the markers stop
  being a label cue while the negative lesson keeps its cue. Recorded in
  `recipeOptions` only when on, so the committed v2 receipts keep their
  exact committed shape on a recompile. Fixture default digests verified
  byte-stable; all 27 Weft tests pass.
- **v4 driver** (`scripts/generate-weft-live-corpus-v4.mjs`): 6 voices
  (terse operational, formal executive, chatty informal, technical
  jargon-heavy, procedural compliance, narrative meeting), a length mix
  (half 30-80 words, a third 100-250, the rest 300-600), seed 20261129.
  Launched overnight; the v4 compile will add
  `--dilute-masked-markers` to both #52 flags.

## 3. The v3 spend and where it stands

The 630-call, 1.98M-token generation bought 4 new themes and department
spread, not style variance. The v3 artifacts stay on disk (untracked) for
reference: `results/weft-fullscale-live-corpus-v3.tmp.json`,
`results/weft-training-pairs-fullscale-live-v3/` (compiled, not committed),
`results/weft-api-usage-v3.tmp.json` (moved into the pairs dir). Nothing v3
enters the ledger; no training run consumes it.

## 4. Still needing a founder decision (morning list)

1. **mistral-medium vs mistral-large.** The escalation trigger the founder
   set (confirmation run fails the style-variance test) has fired one step
   early, at the corpus audit. The audit's finding is that the style failure
   is a prompt-design problem, not a model-quality problem, so v4
   regenerates on mistral-medium under the same standing authorization and
   the same green audit entry. If the v4 audit still shows a single voice,
   the model switch is the remaining lever and needs a new licence-audit
   entry for founder review.
2. **The shared-name negative rule.** Dilution of markers fixes the
   positive-side artifact, but the identity-disjoint-positive bucket design
   is a product question: is "identity-disjoint positives, identity-matched
   negatives" the intended lesson (link without identity cues, never link
   on shared identity), or should the corpus also carry same-identity
   positives from structural links so name co-occurrence stops being a
   negative cue? The audit argues the current rule inverts the real-world
   signal; the product claim (identity-blind linking) argues it is the
   point. This ruling stays with the founder.
3. **Q12/GRL-vs-INLP (#44)**: the frozen-base ablation memo
   (`2026-11-28-w4-ablation-frozen-base-ruling-memo.md`) is ready for
   ruling; recommendation INLP over the structurally vacuous GRL arm.

## 5. Reproduction

```bash
node --test test/weft-api-teacher-contracts.test.js \
  test/weft-data-generation-contracts.test.js \
  test/weft-training-data-and-licence.test.js \
  test/weft-specialist-contract.test.js     # 27 pass
node scripts/generate-weft-live-corpus-v4.mjs          # regenerates the corpus (API spend)
node scripts/build-weft-training-pairs.mjs --mode live \
  --corpus results/weft-fullscale-live-corpus-v4.tmp.json \
  --out results/weft-training-pairs-fullscale-live-v4 \
  --target-pairs 50000 --eval-size 2000 \
  --include-disjoint-negatives --exclude-within-chunk \
  --dilute-masked-markers
```
