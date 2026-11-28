# W6 execution plan: theme nodes in the estate seam and erasure re-proof — 2026-11-28

Ticket #46. Blockers T11 (#38) and T12 (#39) are closed. This plan binds the
design decisions before dispatch; the reconnaissance facts it rests on are
the seam map of 2026-11-28 (perceiveMulti at `src/perceive.js:2357`, the
connection-graph builder at `scripts/run-company-brain-slice.mjs:421-534`,
`eraseEntity` at `src/amnesiac-corpus.js:740`, the engine hash at
`src/amnesiac-corpus.js:29-33`, the exported pair graph outputs
`linkProb` + `themeSim` in `scripts/export-weft-quantized.py:744-749`).

## 1. Binding decisions

1. **Theme linking is opt-in on the seam.** `perceiveMulti(inputs, options)`
   gains `options.themeLinking` (object or true). Unset (the default): the
   output shape is byte-for-byte what it is today and every prior seam test
   stays green untouched. Set: the output gains `themeNodes`, `themeLinks`,
   and a `themeChannel` block, and the run fails closed (typed throw, no
   fallback similarity) when the Weft artifact or the onnxruntime-node module
   is absent. Fail-closed codes follow the W5 family:
   `WEFT_THEME_WEIGHTS_MISSING`, `WEFT_THEME_RUNTIME_MISSING` (the
   `src/neural-pii-onnx.js:116-141` precedent: dynamic import only when
   weights exist, `failClosed !== false` to degrade).
2. **The scorer consumes the W5 artifacts as exported.** The int4 artifact
   (`models/weft-specialist-quantized/weft-int4.onnx`, int8 reference as the
   fallback path) carries the tokenizer JSON, the OOD bank, the OOD threshold,
   and the manifest in its metadata props. New module `src/weft-theme-linker.js`:
   loads the session through a dynamic `import('onnxruntime-node')`, decodes
   the embedded tokenizer, and runs a pure-JS WordPiece tokenizer (vocab from
   the embedded tokenizer.json, max length 128, matching training). The model
   hash is the artifact sha-256 (read from the manifest metadata, verified
   against the file on load). No exporter changes: the pair graph's
   `linkProb` and `themeSim` outputs are the only model signals W6 consumes.
3. **Evidence spans are the member chunks' provenance.** Each theme node's
   evidence spans are the source item plus byte ranges of its member chunks,
   which the perception seam already records per chunk. Spans stay within
   source items by construction; acceptance criterion 1 holds without any
   model-side span output.
4. **Agglomeration is a pure, canonically ordered function.**
   `agglomerateThemeNodes(pairs, policy)` (exported for direct testing):
   candidate shortlist first (deterministic lexical-overlap top-N per chunk,
   N a policy constant; no pairs within the same source item), then joins
   where `linkProb >= policy.joinThreshold` AND `themeSim >= policy.simFloor`;
   everything else abstains (no link; the margin is recorded for routing).
   Union-find over the joins in canonical order (score descending, then the
   id pair ascending), representative = the lexicographically smallest member
   id. Permuting the input order cannot change the output because the sort
   happens inside the function. A theme node stores: id
   (`theme:` + sha-256 of the sorted member ids), members, anchor exemplars
   (first k members in canonical order, k a policy constant), evidence spans,
   the score distribution (min/median/max of linkProb and themeSim over the
   in-node joins), the policy version, and the model sha.
5. **Policy version enters the engine hash and bumps the corpus version.**
   New constant `THEME_POLICY_VERSION = 'weft-theme-agglomeration-v1'` in
   `src/amnesiac-corpus.js`. The engine hash input becomes
   `AMNESIAC_ENGINE_VERSION + '+' + THEME_POLICY_VERSION` (one bump, for
   every corpus, so erasure drift checks cannot mix policy versions); the
   corpus version stamp changes once. Version-pinning tests are updated to
   the new hash; committed artifacts that embed the old stamp are historical
   records and are not rewritten (append-only ruling), except where a test
   pins a live regeneration, which must be regenerated on this box.
6. **Erasure re-derives theme nodes and re-proves the diff.** `eraseEntity`
   on a theme-carrying corpus re-runs the same pure agglomeration over the
   post-erasure corpus (same model hash, same policy version) and the diff
   receipt gains `themeReDerived: true`, `themeNodeCountBefore/After`, and
   the changed theme node ids, with the existing byte-diff guarantees
   unchanged for non-theme bytes. The drift guard extends to the policy
   version: erasing against a corpus built under a different policy version
   throws.
7. **Two channels, one disagreement report.** The identity channel (the
   existing resolved entity graph) and the theme channel (Weft) are reported
   separately. The disagreement report lists scored candidate pairs where an
   identity edge exists between the two source items but the theme channel
   abstained or rejected (possible theme miss or a legitimately different
   theme; the scores travel with the entry so a human can tell). Joins with
   no shared identity are the desired cross-department outcome and are
   counted (`identityDisjointJoinCount`), not reported as disagreements.

## 2. Write scope (agreed at dispatch; T11/T12 are merged)

- New: `src/weft-theme-linker.js` (scorer + tokenizer + artifact verification),
  `test/weft-theme-nodes-and-erasure.test.js`,
  `docs/research-notes/2026-11-28-w6-theme-nodes-verdict.md` (results, at the
  end).
- Modified by role: `src/perceive.js` (the seam output type),
  `src/amnesiac-corpus.js` (the erasure re-derive path and the engine hash
  inputs), `scripts/run-company-brain-slice.mjs` (theme pass on the estate
  run), `test/company-brain-slice.test.js` and `test/amnesiac-corpus.test.js`
  (version pins and any shape additions), committed slice artifacts where a
  live regeneration is pinned.
- No committed paper baseline changes. No exporter changes. No new corpus
  builder (the user's parallel corpus lane stays untouched).

## 3. Test design

1. Agglomeration unit tests on synthetic score tables (no weights, no
   runtime): determinism under permuted input orderings, repeated runs,
   transitive counting (A~B, B~C land in one node), abstain on ambiguous
   pairs, evidence spans within source items.
2. Full-seam tests with the real int4 artifact: skipped with a loud skip
   note when the artifact or onnxruntime-node is absent (the W5
   skip-if-absent precedent); on this box onnxruntime-node is installed so
   the real path runs. Assertions on external behavior only: which chunks
   share a theme node, spans present and within items, the disagreement
   report shape, determinism across orderings.
3. Erasure re-proof: erase an entity on a theme-carrying corpus, assert the
   re-derive, the diff receipt fields, and the byte-diff guarantees.
4. Prior seam tests stay green with theme linking unset (acceptance 3).

## 4. Sequence

1. `src/weft-theme-linker.js` + unit tests (agglomeration pure function).
2. Seam wiring (`src/perceive.js`) + fail-closed contract.
3. Engine hash, erasure re-derive, version pin updates.
4. Estate run + committed artifact regeneration + the erasure proof.
5. Full suite, `audit-wasm`, `check-paper-numbers.mjs`; verdict note; PR.

## 5. Known risks (carried, not solved here)

- The byte-strict regeneration tests are Windows-CRLF sensitive (#48); if
  regeneration fails on this box for line-ending reasons, #48 lands first
  as its own PR and W6 rebases on it.
- The estate fixture is small; theme joins found there are construction
  validation, not a quality claim. No quality number goes in any paper.
- The 240-word length caveat and the unseen-style routing question stay
  open from W4/W5.
