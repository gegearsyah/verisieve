PASS-WITH-NOTES

# W5 v5 pre-spend audit: estate extension before the scaled paid pass

Date: 2026-11-29
Lane: weft-corpus-v5
Scope: commit 7276657, the design note 2026-11-29-w5-v5-estate-extension-design.md, scripts/generate-weft-estate-extension-v5.mjs, scripts/prove-weft-private-unit-erasure.mjs, the additive diff to scripts/generate-weft-live-corpus-v5.mjs, and test/weft-estate-extension.test.js (W-EXT 1 to 9)
Verdict: **PASS-WITH-NOTES** (required fixes: none; eight recommendations below)

Audit method: full read of the design note and the four code files, cross-read against the handoff rules (sections 1 to 8), the strata driver and the shared compiler exports, plus a local re-run of every weft suite (84 pass, 0 fail, 4 GPU-gated skips; the driver reported 88 tests total, the handoff's 81 was the pre-merge count). No teacher call was made and no driver was run with real env.

## Q1: Prompt soundness

The four prompts implement the #59 rulings faithfully.

- Compliance positive (driver line 133): the SAME control requirement excerpted from two DIFFERENT invented frameworks, zero people with the empty identities array pinned in the schema itself, sourceKind and department pinned, ids pinned. Same-knowledge-different-source is exactly the ruling's people-free knowledge unit with the source-kind axis attached.
- Compliance negative (line 137): ADJACENT but genuinely DIFFERENT requirements sharing as much vocabulary as possible, mirroring the strata negative design so BM25 cannot separate the class on word overlap. People-free rules identical to the positive.
- Chatter (line 141): zero knowledge content with concrete low-substance examples, same-thread and shared-people allowed (which usefully muddies any identity-overlap shortcut), length 15 to 40 words.
- Private unit (line 145): ONE recipe-like confidential process carried across five sources in a pinned order and kind sequence, people as attributes with naming cultures supplied, knowledgeUnitId and confidential pinned in both the instruction and the schema, links of type thread requested. This is corpus ask 4 as ruled.

Notes, not blockers:

- The chatter prompt asks for text about a theme whose name alone contributes content words, at 15 to 40 words. The density filter needs 12 distinct content words plus a digit, so a teacher that stuffs vocabulary or a room number can push a sample past the filter; that sample dies to a counted drop (droppedChatterDensity) after the call was paid. This is the one prompt that can plausibly bleed spend into fail-closed drops. The smoke run gates exactly this: if the class 2a or 2b drop rate is high, tighten the prompt (no digits, cap vocabulary) rather than raising the limit.
- The compliance positive's same-requirement property is teacher-claimed and carries no receipt caveat line; only the negatives get negativesCaveat wording. Same cosmetic gap the strata rework carried.
- Label-shortcut exposure is clean: within the compliance family, positives and negatives share department, sourceKind, and length band, so no structural field reads off the label; identity overlap is mixed across labels (compliance classes carry zero identities on both labels, chatter negatives and private-unit positives may share invented people), and every pair records identityOverlap and identityDisjoint for the merge receipt.

## Q2: Fail-closed paths

No malformed sample can become a paid pair. parseTeacherDocs requires a JSON object with a docs array of the required count and non-empty trimmed text on every doc, dumps rejects to os.tmpdir() with an exclusive-create flag, and retries with a seed shift bounded by TEACH_ATTEMPTS. Per-class validation directions are correct and not inverted: the compliance classes require the density filter to pass (drop on fail), the chatter classes require it to fail (drop on pass), both directions pinned by W-EXT 5. Chatter length bounds (5 to 90 words, drop outside) are enforced and counted. The unit shape check requires five docs, a links array, a claimed knowledgeUnitId equal to the driver's unitId (mismatch drops the unit whole, W-EXT 6), per-doc density, the five source kinds in order, and link remapping that rewrites u-N ids to the overlay namespace and filters unknown endpoints and self-links, so no dangling link can enter the overlay the erasure proof consumes.

Gaps, all metadata-level (none let a malformed pair through, and each is visible in the receipt or the code):

- confidential is parsed as raw.confidential !== false, so an explicit confidential:false doc is accepted into a unit whose record hardcodes confidential:true. A rule-violating flag becomes a paid pair and an internally inconsistent overlay, with no drop and no counter.
- A teacher that omits knowledgeUnitId gets the expected id filled in (claimedUnit || unitId). Acceptable because the driver owns the id, but it means the echo is never verified, only the mismatch is.
- Filtered or invalid unit links are silently discarded with no drop counter; a unit can land with zero links and the erasure receipt will honestly report removedLinks 0, but the receipt reader gets no signal that links were requested and lost.
- format and sourceKind coherence per doc is not validated (a sourceKind memo doc may carry format transcript); the source-kind distribution stays correct, the formats field in provenance can disagree with it.
- In class 2b, a theme whose coverage docs all fail the density filter skips the pair after the call was made (continue with no counter); the spend is traceable only in usage. The coverage corpora should pass the filter at a high rate, so the path is unlikely, but it is an uncounted drop.

## Q3: Spend bounds

Bounded and explicit everywhere. runExtension requires a positive integer --limit, a known profile, and an api-kind teacher; the CLI path goes through resolveLocalTeacher, which requires WEFT_TEACHER_KIND=api, licence mistral-api-tos, and a green licence-audit entry, so no env combination reaches spend without all three. The spending path is main-guarded. Worst case per candidate remains 4 teach attempts x 6 completion attempts = 24 calls; a candidate that exhausts kills the run loudly. Critically, rule-violating samples do not retry: retries happen only on malformed JSON inside parseTeacherDocs, so a density or identities drop costs exactly one call.

No silent double spend. Class 2b makes Math.ceil(limit/2) calls and emits at most limit pairs (the inner loop is capped by (i * 2 + n) < limit), so it spends half per pair, not double. Private units are a fixed 2 calls per profile regardless of limit.

The design's spend table needs one arithmetic correction before the scaled pass (a note edit, no code change): at limit 60 the code makes 60 (class 1a) + 60 (1b) + 60 (2a) + 30 (2b) + 2 (units) = 212 calls per profile, so 636 over three profiles, not the table's 546. The table's 180 per profile counts three classes plus the two unit calls and omits the 30 class 2b calls. At the observed 740 tokens per call the extension stage is about 470K tokens, not 400K. Grand total: 636 extension + 340 held-out corpus + 200 held-out strata = about 1,176 calls and about 980K tokens (470K + 360K + 150K), so the plan stays under the 1M token ceiling but with roughly 2 percent headroom, not the 10 percent the 0.9M row implies. Treat 1M as a hard cap and stop if any stage's observed per-call tokens run over the estimates.

The held-out corpus estimate is plausible from the compiler's own arithmetic: pairs-target 9600 gives perTheme = ceil(9600 / 8 / 25 themes) = 48, so 1,200 docs, matching the design; 340 calls is consistent with the chunk shape.

One stage is unreachable as committed, loudly and without spend leak: the held-out strata pass. generate-weft-paraphrase-strata.mjs looks the profile up in ORG_PROFILES only (line 300), so --profile university-campus throws profile-unknown before any teacher call, and the design's 200-call held-out strata stage (gate 5 on the unseen shape) cannot run. The failure is typed and pre-spend, and the stage is separately invokable, so this does not block the extension scaled pass; it must be fixed before that stage (recommendation 1).

## Q4: Determinism

Prompts are byte-identical on re-run. Every prompt input is a pure function of SEED, the loop index, the sorted corpus theme list, and the fixed framework table; seeds per class are disjoint by construction (different multipliers and offsets per class); the retry seed shift is a string replace on the literal "Seed: N." prefix, which every prompt starts with. pickFrameworks' fallback branch is dead code (the index arithmetic can never make a and b equal) but harmless. Pair ids are sha256 over pairType plus the sorted doc ids, and output order is the fixed class order, so pairs are stable as far as Mistral honors random_seed (provider cooperation, not a byte guarantee, same as the strata precedent). Receipt wallclockMs differs across runs; prompts and pairs do not depend on it.

The corpus driver's default path is preserved: with no flags, profilesToRun stays ORG_PROFILES and pairsTarget stays PAIRS_TARGET, so generateTeacherEstates receives the identical inputs, and existing corpora are skipped by the exists check, so nothing already generated is rewritten; the corpus artifact is byte-identical. Two receipt-level notes: the per-profile usage file gains a pairsTarget field (so a re-run of a fresh profile writes a slightly different usage record than the pre-change shape, the corpus itself is unchanged), and the combined summary hardcodes orgProfiles to the three training ids regardless of what ran, while a held-out run overwrites the same combined tmp file the training run wrote. Harmless while these stay tmp artifacts; worth knowing when reading the ledger.

## Q5: Test adequacy

The 9 W-EXT tests pin the load-bearing rules: the filter rule and both boundary directions (W-EXT 1), source-kind derivation plus the closed kind set and fallback (2), the prompt rules including people-free and unit anchoring (3), the full-run shape with compiler pair format, receipt caveats, and overlay shape (4), mechanical people-free and inverted chatter purity (5), unit drop-whole on shape violation (6), config fail-closed and the api-only gate (7), the erasure receipt shape, unchanged-bytes assertion, and digest determinism (8), and fail-closed on unknown unit, inconsistent footprint, and dangling links (9). All weft suites were re-run for this audit: 84 pass, 0 fail, 4 GPU-gated skips.

Gaps a test should close:

- droppedChatterLength (the 5 to 90 word bounds) is enforced but untested.
- The unit knowledgeUnitId mismatch drop (claimedUnit not equal to unitId) is untested.
- The extension-local parseTeacherDocs malformed paths (no JSON, missing docs array, empty text) are untested; the strata suite tests its own copy, and this one is new code.
- Link remap filtering (unknown endpoint, self-link) is untested; W-EXT 4 exercises only the happy path.
- The confidential flag is neither validated nor tested (Q2 gap).

The erasure receipt's unchanged-violation throw is structurally unreachable in the current wiring (regeneration keeps the original object references, so retained records serialize identically by construction), so no test is needed for it, but see Q7 for the claim it makes.

## Q6: Ruling compliance in code and note

Naming follows the binding rules: pair types prefer source-disjoint (ruling 3), the receipt carries the axis line "source-kind axis on docs; theme = knowledge; identity = the person erasure axis only", and private-unit event anchors are the knowledgeUnitId, matching "the event is the identity of the unit". Knowledge is framed as the unit throughout; compliance corpora are named as valid source types with invented framework stand-ins rather than real copyrighted text.

Banned literals: the design note (line 35) and the proof script's comments (lines 14 and 139) contain the literal word formed by the letters f-i-r-s-t ("the first differing byte offset", "First differing byte"). The receipt key firstDiffOffset is an identifier and does not trip the word-boundary regex the claim audit uses, but the prose and comments do. Older research notes use the word freely, so lane practice has been loose in notes and strict in release material; the handoff rule is unconditional, and the fix is mechanical ("earliest differing byte offset"). No other banned literal appears in the audited material; no em-dashes.

Honest framing holds where it matters: the receipts label the mechanically verified (peopleFreeRule, nonKnowledgeRule) against the teacher-claimed (negativesCaveat), the density filter is labeled a lexical heuristic with its measured effect recorded rather than asserted, the length cue on the non-knowledge class is recorded rather than hidden, and the erasure receipt's scopeNote claims only the artifact-level property. Two overstatements to correct: the proof script's header says fail-closed means "nothing is written", which is true for the typed pre-regeneration errors but not for the unchanged-violation path (Q7), and the design's blanket "people-free is verified" should always be read with its own parenthetical "(empty identities)", since the check covers the identities array, not name-like tokens in the text.

## Q7: The erasure proof

The proof is sound at what it claims. regenerateCorpusMinusUnit removes exactly the unit's footprint (its claimed docs, the links touching them, its unit record), fails closed with typed reasons on an unknown unit, an empty claim, a claimed doc absent from the overlay, a doc carrying the id that the unit does not claim back (footprint-inconsistent), and a retained link that would dangle after regeneration. The receipt records sha256 and byte size before and after, the removed doc ids and link keys, the earliest differing byte offset, and the unchanged-bytes assertion at record granularity: every retained doc, link, and unit record serializes byte-identically in the regenerated artifact. W-EXT 8 and 9 pin the receipt shape, the digests, and every failure path. The record-granular claim is the honest one for a stable JSON assembly, and the receipt says exactly that rather than claiming a byte-level diff outside the footprint. The scope note is adequate: it claims erasability inside the Weft corpus artifact only and names the full amnesiac mechanism as downstream and unclaimed.

Two notes on the mechanism:

- The assertion is a structural invariant in the current wiring, not an independent check: the regenerated arrays hold the original object references, so a retained record cannot fail to serialize identically. The claim wording matches the mechanism, so there is no honesty problem, but an independent variant (deep-copy each retained record, or re-extract its text from the original file) would make the assertion non-tautological.
- The regenerated minus-file is written (proof line 147) before the unchanged-bytes assertion is enforced (line 176), so on that path the header's "nothing is written" sentence does not hold. Unreachable today; move the write after the check or fix the comment.

## Required fixes

None. The extension scaled pass may spend with the code as it stands.

## Recommendations (non-blocking, ranked)

1. Extend the strata driver's profile lookup to [...ORG_PROFILES, ...ORG_PROFILES_HELDOUT] before the held-out strata stage; as committed the stage throws profile-unknown and gate 5 stays unmeasured on the unseen shape. The change is mechanical (no prompt, seed, or validation change), so it may land without a fresh Opus audit; ship it with the updated profile-unknown test and still smoke the stage at a small limit before the 100 run.
2. Correct the design note's spend table before the scaled pass: 212 calls per profile at limit 60 (636 total, about 470K tokens) and about 1,176 calls / 980K tokens grand total, so the 1M ceiling is explicit and thin.
3. Validate the unit's confidential flag: drop or count a doc whose teacher-emitted confidential is explicitly false, so the overlay cannot contradict its own unit record.
4. Add drop counters for filtered unit links and for the class 2b no-coverage-anchor skip, so no paid call can vanish without a receipt trace.
5. Land the four missing W-EXT tests (chatter length bounds, unit id mismatch, parseTeacherDocs malformed paths, link remap filtering) with or before the scaled pass.
6. Move the erasure proof's minus-file write after the unchanged-bytes check (or correct the header comment), and consider making the assertion independent of object identity.
7. Reword the f-i-r-s-t literals in the design note and the proof script comments to "earliest"; keep the firstDiffOffset identifier as is.
8. Either add a name-surface scan to the people-free classes or add one receipt line stating the check covers the identities array only, so the design's "verified, never teacher-claimed" claim stays exactly as strong as the mechanism.

## Spend readiness

Approved, with the corrected arithmetic:

- Smoke, one profile, limit 2: 9 calls (2 + 2 + 2 + 1 + 2) plus retry overhead, well under the 15K token guidance; prompts changed, so the smoke precedes any scaled pass and its drop counters decide whether the chatter prompt needs tightening.
- Extension scaled, 3 profiles at limit 60: 212 calls per profile, 636 total, about 470K tokens at the observed 740 per call; worst case 24 calls per candidate, and a run that exhausts a candidate dies loudly instead of reaching the bound.
- Held-out corpus: --profile university-campus --pairs-target 9600, about 340 calls, about 360K tokens, 1,200 docs, eval-only, never entering training.
- Held-out strata: 200 calls, about 150K tokens, blocked until recommendation 1 lands.
- Total about 1,176 calls and 980K tokens, roughly $8 to $10 at the observed mistral-medium rates; under the 1M ceiling with thin headroom, so treat 1M as a hard cap and stop the plan if observed per-call tokens exceed the estimates.
