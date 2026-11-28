# W5 v5 corpus pre-spend audit: PASS-WITH-NOTES and the launch - 2026-11-28

The v5 corpus driver, the org profiles, the per-call length bands, and the
opt-in masked-structural slice were re-audited at the Opus tier before any
API spend. The verdict is PASS-WITH-NOTES, spend is approved, and the
generation was launched the same day under the standing Mistral
authorization.

## 1. What was audited

The v5 driver `scripts/generate-weft-live-corpus-v5.mjs` plus the compiler
changes in `scripts/build-weft-training-pairs.mjs` on branch weft-corpus-v5
(commits 59adcde, c60afbd, e52c00f). The review was an adversarial
re-verification, not a read-through: every claim in the driver research note
was checked against the code and the fixture behaviour. Zero API calls were
made during the audit.

## 2. What passed

- Committed receipts are byte-stable without the new flags: the pre-v5
  compiler and the head compiler produce identical prompts and pairs, 29 of
  29 tests pass, and the v4 receipt digest pins hold.
- The three org profiles are disjoint: departments, vendor pools, and person
  rosters are all pairwise DISJOINT, and Northwind is absent from every
  profiled prompt.
- Length bands are mechanically verified: the band is chosen deterministically
  by the chunk seed, long-band calls ask for exactly 3 documents, and the band
  text carries an explicit minimum in all sampled calls.
- Masked markers appear in BOTH labels when the flags are paired: role-token
  substitution is the same mechanism in both buckets.
- Both 5 percent hash slices are deterministic across runs with distinct
  prefixes.
- The driver research note is honest against the code.
- The spend guard is clean: a no-arg run fails typed with no network, and no
  MISTRAL_API_KEY is read, printed, or logged in the diff.

## 3. The caveats

1. `--include-masked-structural` without `--dilute-masked-markers` is a
   perfect positive-only cue, so the flags must always be paired (now
   documented in the driver note).
2. The masked bucket is negative-leaning at full scale: roughly 10 to 200
   masked positives vs roughly 1,000 masked negatives per 50,000-pair
   profile, P(positive given masked) roughly 1 to 15 percent. Dilution has
   never run at full scale, so the ratio is untested against a real corpus.
   If the masked-positive lesson is not learned, widening the structural
   slice is the documented next lever, not re-architecting.
3. The length fix relies wholly on teacher compliance, with no validator by
   design. Acceptance is `lengthObserved.over300` in the per-profile usage
   files and must be checked before the compile is consumed. If over300
   lands near zero again, the minimal stronger change is a structure
   instruction on the long-band line only.
4. The hash slices coincide across profiles (doc-id based, shared id
   scheme), which is harmless while each profile compiles into its own
   dataset.

## 4. Verdict

PASS-WITH-NOTES. Spend is approved, and the generation was launched
(2026-11-28) under the standing Mistral authorization.

## 5. Reproduction

The audit re-ran the four weft test files (`node --test
test/weft-api-teacher-contracts.test.js
test/weft-data-generation-contracts.test.js
test/weft-training-data-and-licence.test.js
test/weft-specialist-contract.test.js`) and used stub-teacher compiles.
Scratch harnesses were TEMP-only.
