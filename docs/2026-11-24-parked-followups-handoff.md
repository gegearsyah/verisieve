# Parked Follow-ups Handoff (CPU-side, no GPU)

Two recorded follow-ups from the novelty-and-remediation handoff's run record, parked until
the main queue (GPU ablation backfill, then the K3 six-arm head-to-head) drains. They are
safe to execute concurrently with the main queue because they touch neither the GPU nor
`results/track-d-*` nor the amnesiac line.

## Binding constraints (read first)

1. **Work in a worktree, off `fix/spec-15-remediation`.** The main session commits to that
   branch continuously; two writers on one tree will corrupt each other. Branch from
   `main` unless told otherwise.
2. **No GPU.** The main queue owns the machine's GPU until further notice. Everything in
   this handoff is CPU-side.
3. **Honest-results discipline:** every paper number must trace to a checked-in raw
   artifact, enforced by `node scripts/check-paper-numbers.mjs`. If your change alters a
   number quoted in a paper (e.g., a WASM size), update the artifact, the paper, AND the
   checker needle in one commit. Deviations are recorded, never smoothed.
4. **Word bans in papers and docs:** "mathematically grounded", "/eliminat/" (eliminates/
   eliminating), novelty-claim "first" ("first to", "the first", "for the first time",
   "our first"), "perceive everything", "atomic knowledge". No em-dashes (`---`);
   en-dashes (`--`) only in name pairs (e.g., Clopper--Pearson) and numeric ranges already
   in committed text.
5. **Verification bar for every item:** `npm run test:ci` green end-to-end (it ends with
   the paper-number check), `node bin/verisieve.mjs audit-wasm` allVerified, no new
   WASM binary exceeding its committed cap (`verisieve_media.wasm` < 215,000 B;
   `verisieve_sql.wasm` < 400 KB total-wasm claim must keep holding), `git status` clean
   of unintended `results/*.json` dirt (restore wallclock-dirtied artifacts with explicit
   `git checkout -- <paths>`, never `git add --A`; the live `results/track-d-ptlm-sweep.json`
   and any GPU artifact are untouchable).
6. **No push.** Commits land on your branch; the founder gates pushes.
7. Citations (if any) are pinned via arxiv.org abs pages or the export API directly,
   never search snippets.
8. Binary-inspection tooling is never named in any repo file.

## Item 1: wire `chartSeries` into the graph (small)

Context (novelty handoff run record, Stage 6): `parsePptxBuffer` in
`src/enterprise-parsers.js` already extracts `chartSeries` from embedded charts, but it is
extraction-only — the recorded deviation. `diagramEdges` (same stage) shows the full
pattern to copy: graph wiring in `src/graph-wasm.js` (extracted edges become PASSAGE nodes
plus RELATES_TO edges) and capture in `src/perceive.js`.

Work:
- Route each extracted chart series into the graph the way `diagramEdges` is routed
  (PASSAGE node per series text + RELATES_TO edges to the source deck/section).
- Add external-behavior tests to `test/track-e-multimodal-enterprise.test.js`
  (the suite is 11/11 today): a fixture deck with a chart must yield the series node and
  its edges in the built graph; a deck without charts must be unchanged.
- Zero WASM bytes (pure JS glue, same as the diagramEdges wiring).

## Item 2: cross-table JOIN host bridge (medium)

Context (novelty handoff run record, Stage 7): the Rust kernel already implements INNER
equi-JOIN over aliased instances of one loaded table (binary 54,105 B; `build.sh` owns
provenance regeneration; Rust toolchain is WSL-only, repo convention). End-to-end
cross-table JOIN is blocked by the host bridge: `src/sql-wasm.js` probes exactly one table
and encodes one buffer, so the kernel never sees a second table's bytes.

Work:
- Add the host ABI change: a second-table probe/encode path and a kernel entry
  (`vs_sql_exec2` or equivalent) receiving two encoded tables.
- Keep the failure modes fail-closed: non-equi JOIN, `SELECT *` inside JOIN, and any
  second-table shape the kernel cannot encode must return the same typed errors as today.
- The JS fallback (`executeSqlSubsetFallback`) keeps rejecting JOINs (recorded deviation —
  parity is blocked by the same ownership boundary; do not fake it).
- Rust side: `cargo test` in WSL green including the existing JOIN tests; binary size will
  change — update `vendor/wasm/verisieve_sql.wasm`, the `<400 KB` total claim if it moves,
  BOTH papers' size receipts, and the checker `statSync` needle (currently 54,105) in one
  commit. `build.sh` regenerates provenance; never hand-write the JSON.

## Reporting

Append a dated entry to the run record of
`docs/2026-11-24-versieve-novelty-and-remediation-handoff.md` (commit shas and deviations
recorded as they happened, not smoothed), same style as the existing entries.
