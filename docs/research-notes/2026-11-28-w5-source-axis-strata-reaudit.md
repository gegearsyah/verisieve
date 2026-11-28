# W5 re-audit: source-axis paraphrase strata before the scaled paid pass

Date: 2026-11-28
Lane: weft-corpus-v5
Scope: commit 541543a, diff 6ee24b8..541543a over scripts/generate-weft-paraphrase-strata.mjs and test/weft-paraphrase-strata.test.js
Verdict: **PASS-WITH-NOTES** (required fixes: none; three recommendations below)

## Q1: Prompt soundness

The reworked prompts implement the ruling. The positive prompt (driver line 77) frames the output as a DIFFERENT source ("a different meeting, thread, or ticket in the same company that happens to cover the same talking point"), keeps theme pinned as knowledge, and treats identities only as invented-name erasure metadata. The third-department rule is kept as an org attribute for lexical difficulty, and the receipt records the axis note (line 458) so no downstream reader mistakes the framing. Identity-as-axis framing is not reintroduced in labels, counts, or pair fields.

Notes, not blockers:

- Source-disjointness of the paraphrase is teacher-claimed, not mechanically verified. `normalizedDoc` (line 269) accepts any `department` the teacher returns (defaulting to "unknown") and never checks it against the assigned `paraphraseDepartment`; a paraphrase echoing the source department or format still becomes a paid pair. The pair stays a valid paraphrase positive, only lexically easier, and the per-pair overlap in the receipt makes the drift visible to the smoke gate. Recommendation 3 below.
- The instruction opens with "Rewrite it into ONE new document", which pulls toward in-place rewriting; the "comes from a DIFFERENT source" clause follows immediately and W-STRATA 1 pins it. Acceptable.
- Positives carry no receipt caveat analogous to `negativesCaveat`, although the different-source property is equally teacher-claimed. Cosmetic.

All three prior lane failures are mechanically closed and tested: missing docs array and empty-text docs are rejected by `parseTeacherDocs` (lines 190 to 191, non-empty `text` on every doc, `minDocs` count; W-STRATA 8), raw control characters inside JSON strings are escaped by `parseLooseJson` (build-weft-training-pairs.mjs:68, identity function on valid JSON; W-API 12), and the per-attempt seed shift (line 168) produces a fresh sample per retry.

## Q2: deriveEventClusters

Correct on every edge case, verified statically and by direct in-memory exercise (no teacher call): self-links and links to unknown ids are skipped (line 102), duplicate links are no-ops (`ra === rb` continue, line 105), chains are transitive through union-find, and the cluster id is always the lexically smallest doc id of the component, so the final mapping is independent of link order.

Recursion depth: union-by-smallest is not union-by-rank, so an adversarial link order builds a path as long as the chain; a full 3,999-link descending chain ran in ~82ms with no stack overflow, and a 6,250-doc corpus caps the depth at 6,249, well inside V8's default stack. No path compression exists, which is fine at this scale.

Minor notes: duplicate doc ids silently dedupe in the Map (line 96); unreachable from the driver path because the upstream compiler throws on duplicate doc ids. In `findParaphraseCandidates`, when one source doc has several eligible links the anchor is whichever link comes earliest in the corpus file (the `seen` set keeps the earliest), so candidate selection is not fully link-order independent; the corpus file is fixed content though, so re-run determinism holds.

## Q3: Fail-closed paths

No malformed or empty sample can become a paid pair: acceptance requires a JSON object, a docs array of the required count, and non-empty trimmed text on every doc; placeholder echoes and identity key/surface collisions get one remap pass and are then dropped, each counted in its own receipt key. Tests W-STRATA 2, 7, 8 pin these.

The no-eligible-third-department path (lines 358 to 361) increments `droppedIdentityCollisions`, which is a mislabel: it is a department-configuration drop, not an identity collision, and it happens before any teacher call so it costs no spend. Severity is low for three reasons: it predates this diff (present verbatim in 6ee24b8), it is unreachable with the three current six-department profiles (a source and an anchor use at most two, leaving four eligible), and it only misleads a receipt reader, never a pair. Recommendation 2 below. Note that a semantically empty but well-formed sample (one-word text, ignored department instruction) does pass through; the driver has no hard semantic gate by design, and the per-pair overlap receipts make such samples visible to the smoke gate.

## Q4: Spend bounds

Bounded and explicit. `--limit` must be a positive integer (line 308), `--profile` must name a known profile, the spending path is main-guarded, positives are capped by candidate availability under the limit, and negatives are capped at `min(limit, NEGATIVES_CAP)` with `NEGATIVES_CAP = 200` (line 56). Worst case per candidate is `TEACH_ATTEMPTS` (4) samples times `completeWithRetry`'s 1 + 5 retry attempts = 24 API calls; the retry loop in `completeWithRetry` (build-weft-training-pairs.mjs:284) terminates on `n >= delays.length`, and `parseTeacherDocs` terminates on the attempt count. A candidate that exhausts all four samples throws and kills the run loudly rather than looping. No unbounded call path exists.

## Q5: Determinism

Prompts are byte-identical on re-run: `pairSeed` is SEED plus an FNV-1a hash of the source id (line 160), candidates are sorted by source id (line 145), the masked source and department pick are pure functions of the doc and seed, and the negatives pass seeds as `(SEED * 1000003 + i * 9176)` over a sorted theme list (lines 419 to 422). Pairs are reproducible only as far as Mistral honors `random_seed`: the adapter pins `random_seed` from the prompt's Seed line and temperature 0.7 (weft-mistral-teacher.mjs:132 to 141), which is provider cooperation, not a byte guarantee. The receipt's `wallclockMs` differs across runs; prompts and pairs do not depend on it.

## Q6: Test adequacy

W-STRATA 1 pins the source framing ("comes from a DIFFERENT source") and the other-department line; W-STRATA 3 pins `eventA`/`eventB`, the axis note, and the new count keys; W-STRATA 5 pins `sourceEventId` on candidates; W-STRATA 8 pins the empty-text fail-closed; W-API 12 pins control-char escaping. All 20 tests in the two allowed suites pass (verified this audit).

Gap: `deriveEventClusters` is exported but not imported by the test file; its edge cases (chains, self-links, unknown-id links, duplicate links, multi-doc clusters) are exercised only through the single-link fixture. I verified these directly (see Q2), so this does not block spend, but one small test should land with or before the scaled pass since `eventA` is the axis metadata on every positive. Minor: the negative prompt's "two DIFFERENT sources" clause is not asserted, though the verbatim prompt is recorded in the receipt.

## Q7: Old-label downstream safety

A repo-wide grep excluding `results/` finds `paraphrase-hard-positive` and `paraphrase-hard-negative` only in this rework note (as the rename record); no script, test, or doc expects the old pair labels or the old receipt count keys. The old smoke output under `results/weft-paraphrase-strata-v5-regional-logistics/` is untracked historical artifact and is read by nothing.

## Required fixes

None. The scaled pass may spend with the code as it stands.

## Recommendations (non-blocking, land whenever convenient)

1. Add one `deriveEventClusters` edge-case test (chain, self-link, unknown-id link, duplicate link; cluster id = smallest doc id).
2. Give the no-eligible-third-department path its own receipt counter (for example `droppedNoThirdDepartment`) so `droppedIdentityCollisions` stops miscounting; unreachable today, misleading tomorrow.
3. Validate the paraphrase's returned `department` against the assigned `paraphraseDepartment` (drop or count on mismatch), so the different-source property is not purely teacher-claimed.

## Spend readiness

Approved. For `--limit 400` per profile, three profiles:

- Expected calls: 600 per profile (400 positives + 200 negatives), 1,800 total.
- Worst case: 24 calls per candidate (4 teach attempts x 6 completion attempts) = 14,400 per profile, 43,200 total, assuming the teacher never once succeeds; a run that exhausts a candidate dies loudly instead of reaching the bound.
- Worst-case wallclock per failed candidate: about 4 x 18.5 minutes of synchronous retry sleep; realistic runs see none of it.
- Estimated cost: about $2 to $3 per profile at ~600 calls, $6 to $9 total, matching the operator's estimate. Spend stays explicit per run through the required `--limit` and `--profile` flags.
