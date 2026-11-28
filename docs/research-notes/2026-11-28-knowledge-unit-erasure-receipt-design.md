# Knowledge-unit erasure receipt design: source anchors and knowledge-unit ids as eraseEntity targets (2026-11-28)

Ticket #66, written before implementation per the ticket's own acceptance rule. The
binding premise is the same-day correction note
(`2026-11-28-company-brain-premise-correction.md`): knowledge is the unit, source
is the provenance anchor (the meeting, thread, or ticket), identity is reserved
for the person erasure axis. The open engineering question the ticket names: the
diff-receipt machinery was proven on single-entity byte spans, so a target that
touches several inputs needs its receipt semantics designed and stated before
anyone can promise the forget-the-recipe case works.

## 1. What already exists and is reused, not rebuilt

Three proven mechanisms carry over unchanged:

1. **Whole-document erasure is input removal plus regeneration.** The corpus is a
   pure function of (inputs, view, engine version), so erasing an entire input and
   rebuilding already produces a correct corpus with a fresh receipt. Nothing in
   this ticket rebuilds that; source-anchor erasure exists to give that operation
   a receipt that states the footprint, against a fixed corpus state, without
   requiring the caller to re-run perception over the surviving estate.
2. **`eraseEntity` regeneration and the fail-closed byte-diff check.** The
   machinery that regenerates samples, pins before/after corpus SHA-256, and
   throws instead of emitting a subtly-wrong diff is reused verbatim wherever a
   new target class can express its erasure as sample-level edits.
3. **The W6 theme re-proof.** Erasure over a theme-carrying corpus already
   invalidates the changed samples' chunk pairs and re-derives the agglomeration
   with the same policy version and model sha, receipted as
   `themeReDerived`, `themeInvalidatedPairCount`, and `changedThemeNodeIds`. A
   multi-sample target is just a larger changed-set, so the same re-proof applies
   without modification.

Person erasure stays exactly what it is. The entity path keeps its error
messages (the existing regression tests match them) and gains typed error codes
only; its regeneration, diff check, and receipt shape are untouched, so the
existing ablation tests stay green unmodified.

## 2. Target grammar and typed errors

`eraseEntity(state, target)` accepts a target string in one of three namespaces:

- `ent:...` (or any unprefixed string, for backward compatibility with existing
  callers): the existing entity path, unchanged in behavior.
- `source:NAME`: a source anchor. `NAME` must be non-empty and must match at
  least one sample's `source` in the corpus. Sample `source` values are the
  provenance anchors the perception layer already records (the input's file
  name or `source` field), so the anchor resolves deterministically against the
  built corpus.
- `unit:ID`: a knowledge-unit id. No current corpus state can resolve one (see
  section 4), so every `unit:` target fails closed.

Typed errors, following the `weft-theme-linker.js` pattern (an `Error` with a
`code` property):

- `AMNESIAC_ERASE_TARGET_MALFORMED`: the target is not a non-empty string, or is
  a `source:`/`unit:` target with an empty remainder.
- `AMNESIAC_ERASE_TARGET_UNKNOWN`: a well-formed target the corpus does not index
  (an unknown `source:` anchor; an unknown entity id, which keeps its existing
  "unknown entityId" message).
- `AMNESIAC_ERASE_TARGET_UNRESOLVED`: a well-formed `unit:` target the corpus
  model cannot resolve; the error names issue #59 as the missing representation.
- `AMNESIAC_ERASE_SOURCE_COMPOSED_UNSUPPORTED`: source erasure on a composed
  corpus (readable identity, `compositionPolicy: composed-v1`) is not designed in
  this ticket and fails closed rather than guessing at composed retraction
  semantics. Composed corpora remain erasable entity-by-entity exactly as today.
- `AMNESIAC_ERASE_DIFF_MISMATCH`: the mechanical post-check that the emitted
  diff is pure deletion of exactly the erased source's sample lines failed.

## 3. Source-anchor erasure and its receipt

**Semantics.** Erasing `source:NAME` removes every sample whose `source` is
`NAME` and regenerates the corpus over the survivors. It does not touch entities
that survive in other sources: a person mentioned in a meeting and a document
keeps the document mentions when the meeting is erased. The entity index is
re-derived: entities that lost samples keep their remaining `sampleIds` and their
`occurrences` count is decremented by exactly the number of removed samples that
mentioned them (one occurrence per block in the per-block corpus, so the
subtraction is exact); entities whose every sample came from the erased source
are dropped from the index, and the receipt lists them.

**Diff semantics.** The diff is pure deletion: the erased source's sample lines
disappear from the JSONL and every surviving line is byte-identical. The
 implementation verifies this mechanically (the surviving lines must equal the
 original lines minus exactly the removed samples' lines, in order) and sets
 `diffVerified: true` only if the check passes; otherwise it throws
 `AMNESIAC_ERASE_DIFF_MISMATCH`.

**Receipt.** The diff receipt carries the target's full footprint:

- `erasedTarget` (`source:NAME`), `erasedTargetKind: 'source'`,
- `removedSampleIds`, `removedSampleCount`, `removedSampleLineBytes` (the exact
  JSONL bytes deleted, lines plus separators),
- `removedEntityIds` (entities that existed only in the erased source),
  `changedEntityIds` (entities whose footprint shrank but survived),
- `unchangedSampleCount`, `corpusSha256Before` / `corpusSha256After`,
  engine pins, the theme re-proof fields when a theme channel is present, and
  the Merkle before/after roots when the corpus carries one.

**Cross-reference semantics, stated honestly.** Where a surviving document
references the erased source's content, the receipt must state what changed and
why. The current per-block corpus model records no cross-source reference
channel between samples: each sample carries its own source, and nothing links a
surviving sample to removed content by reference. The receipt therefore carries
a `crossReference` object whose `detectedInSurvivingSamples` list is produced by
whatever reference channel the model actually carries, which today is only the
theme channel: a surviving chunk whose pair partner lived in the erased source is
invalidated and reported through the existing `themeInvalidatedPairCount` /
`changedThemeNodeIds` fields, and the `crossReference.note` says explicitly that
the per-block model cannot assert that no surviving document references the
erased content. That is the honest limit. A real reference field (a surviving
note quoting the erased meeting) needs the corpus representation that #59 is
building, and it is where the receipt would report the reference as a changed
surviving sample with its reason. Until then the receipt refuses to over-claim;
it does not silently imply zero references.

## 4. Company-private knowledge units: designed, fail-closed for now

The realistic target (a recipe stated in one document, referenced across
meetings and derivative notes) is the multi-input case the receipt machinery has
not been proven on. The designed semantics, which this ticket states and does
not implement: erasing a knowledge unit removes or edits each sample that
carries it across every source, the diff must equal exactly the union of those
per-source edits, the receipt states the per-source footprint
(`removedSampleIds` grouped by source, per-source removed bytes) plus the
cross-reference statement for surviving documents that reference the unit, and
the theme re-proof runs over the whole changed set.

**Why it is not implemented now.** Resolving `unit:ID` requires a corpus
representation that maps a knowledge-unit id to its member samples across
sources. The current state model has no such index: it indexes entities, not
knowledge units, and building a speculative index before the #59 v5 corpus lands
would be scaffolding for a representation that does not exist yet. Every
`unit:` target therefore fails closed with `AMNESIAC_ERASE_TARGET_UNRESOLVED`,
whose message names issue #59 as the missing representation. This is the
fail-closed behavior the ticket asks for: no subtly-wrong corpus is possible
from an unresolvable target because no corpus is emitted at all.

**What waits for #59, exactly.** (a) The knowledge-unit index in the v5 corpus
that lets `unit:ID` resolve to samples; (b) the per-source footprint fields in
the diff receipt for a multi-source target; (c) the cross-reference field in
surviving samples and its `detectedInSurvivingSamples` reporting; (d) the
forget-the-recipe ablation mirroring the person-key ablation, whose honest
headline can only ever be certified detection recall plus measured canary
exposure, never a stronger claim.

## 5. Design decision and its limits

The decision: source anchors are erasable now, by reusing the existing
regeneration, byte-diff, and theme re-proof machinery with a pure-deletion diff
and a full-footprint receipt; knowledge units are designed but fail closed until
the #59 corpus gives them something to resolve against. Limits, stated plainly:

- Source erasure is per-block only; composed corpora fail closed
  (`AMNESIAC_ERASE_SOURCE_COMPOSED_UNSUPPORTED`). Entity erasure on composed
  corpora is unchanged and remains the proven erasure path there.
- The receipt cannot assert that no surviving document references erased
  content; it states what the model carries (theme invalidation) and refuses the
  stronger claim.
- Certificates attached to a regenerated corpus keep their existing meaning:
  certified detection recall plus measured canary exposure. Nothing in this
  ticket strengthens or re-labels that vocabulary.
- Append-only ledgers are untouched; no new configuration options; every new
  failure mode is fail-closed and typed.
