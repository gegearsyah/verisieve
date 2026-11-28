# v5 corpus driver with org profiles, length bands, and a masked-structural slice (2026-11-29)

Status: **driver built, audit pending, zero API spend.** The two v4 re-audit
notes (2026-11-28) left three gaps on the W5 path: one company shape per
corpus, a length band that never landed (max 240 words, p90 95), and an empty
identity-masked-positive bucket caused by the working chunk-marker exclusion.
The v5 track answers all three in one regeneration, and the whole change is
flag-gated so the committed fixture baseline stays byte-stable.

## 1. Org profiles

`generateTeacherEstates` takes an optional `orgProfile` ({ id, context,
departments, formats, vendorPool, nameCultures }). Absent, the prompt is
byte-identical to the v4 prompts. Present, the prompt pins the profile's
industry context line, restricts formats and departments to the profile's
mixes, and swaps the generic identity roster for a profile roster: people are
drawn round-robin from the profile's name cultures (12, keys derived as
deterministic slugs, deduplicated) and vendors come from the profile's own
vendor pool, which retires the "Northwind Supply Co is every vendor" tic.
Chunk-unique invented names are additionally steered by the roster's naming
cultures.

The v5 driver (`scripts/generate-weft-live-corpus-v5.mjs`, seed 20261130,
pairs target 50000, the v4 10 themes and 6 voices unchanged) loops three
company shapes, one corpus per profile:

| profile | departments | vendor pool sample | name cultures |
| --- | --- | --- | --- |
| regional-logistics | operations, warehouse, dispatch, fleet-maintenance, customer-service, finance | Brantling Freight Systems, Ostmark Pallet Supply, Calder & Rime Insurance | Flemish-Dutch, Polish, Ghanaian |
| hospital-network | clinical, nursing, pharmacy, procurement, compliance, facilities | Medivar Supply Group, Corvale Diagnostics, Halbrook Sterilization | Nordic, Filipino, German |
| municipal-office | permits, public-works, clerks, parks, utilities, communications | Gresham Civil Contractors, Perrine Asphalt & Supply, Cobblestone Fleet Leasing | Southern US, Vietnamese, Catalan |

Outputs: `results/weft-fullscale-live-corpus-v5-<profileId>.tmp.json` and
`results/weft-api-usage-v5-<profileId>.tmp.json` per profile, plus the combined
`results/weft-api-usage-v5.tmp.json` (v4 usage shape plus a per-profile
breakdown). The spending path is main-guarded, so importing the driver module
(offline smoke tests, the audit) makes no teacher call.

## 2. Length bands

Diagnosis of the v4 failure: the length hint was one free-form line mixed into
every chunk prompt, nothing forced a minimum, and the compiler has no
deterministic length validation (a known gap, not fixed here). The v5 fix:

- `generateTeacherEstates` takes optional `lengthBands` ([{ label, min, max }]).
  Present, the free-form hint line is replaced by a per-call band line stating
  that every document in the call must fall inside the band and that a shorter
  document is a failed sample. The band is picked deterministically by the
  chunk seed, uniform across short (30 to 80), medium (100 to 250), and long
  (300 to 600) thirds of calls.
- A long-band call asks for at most 3 documents (`longBandChunkSize`), so a
  single teacher completion has room to write 3 documents at 300 or more words
  instead of truncating at its per-call output limit.

What the fix relies on, stated honestly: the teacher honoring an explicit
per-call minimum that was previously absent. This cannot be verified without
the real API run, so the driver records the observed word-count distribution
per profile (`lengthObserved`, min / p50 / p90 / max / over300) into the usage
files, and the acceptance bar for the audit is a nonzero and material
`over300` count, not the prompt text. There is no deterministic length
validation in the compiler; adding one was deliberately skipped, because a
hard validator would silently drop teacher output mid-run and reshape the
corpus without a review step.

## 3. Masked-structural slice

New opt-in flag `--include-masked-structural` on the pair compiler. With
`--exclude-within-chunk` on, a deterministic 5 percent hash slice of
within-chunk structural links that the exclusion would drop is re-emitted as
`identity-masked-positive` pairs with full role-token masking (the masked
bucket v3 carried only through the chunk-marker hole, and v4 lost entirely).
Links with no shared resolved identity stay excluded, since there is nothing
to mask. The flag is recorded in `recipeOptions` only when on, next to the
other sparse flags, so the committed v2 and v4 receipts keep their exact
committed shape on a recompile. Same-voice caveat: rescued pairs are
within-chunk by construction, which is part of the trade and goes to the audit
gate with the corpus.

## 4. What is deliberately not done

- No deterministic length validation landed (see section 2).
- The masked-structural slice is not wired into the driver itself; it is a
  recompile flag, exactly like the other #52 recipe flags.
- No API spend of any kind: every test and every smoke run in this work used
  stub teachers that return canned JSON. The driver spends only when run by
  the operator after the audit gate.

## 5. Reproduction (after the audit gate)

```bash
node --test test/weft-api-teacher-contracts.test.js \
  test/weft-data-generation-contracts.test.js \
  test/weft-training-data-and-licence.test.js \
  test/weft-specialist-contract.test.js     # 29 pass (27 baseline + 2 new)
WEFT_TEACHER_KIND=api WEFT_TEACHER_LICENCE=mistral-api-tos \
  node scripts/generate-weft-live-corpus-v5.mjs        # 3 corpora (API spend)
node scripts/build-weft-training-pairs.mjs --mode live \
  --corpus results/weft-fullscale-live-corpus-v5-<profileId>.tmp.json \
  --out results/weft-training-pairs-fullscale-live-v5-<profileId> \
  --target-pairs 50000 --eval-size 2000 \
  --include-disjoint-negatives --exclude-within-chunk \
  --dilute-masked-markers --include-masked-structural \
  --org-profile <profileId>
```

The pre-spend audit gate (Opus tier) runs on this note plus the driver and
compiler diff, before any API spend.
