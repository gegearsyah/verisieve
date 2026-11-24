# Parked Follow-ups Handoff (CPU-side, no GPU)

Three recorded follow-ups from the novelty-and-remediation and cross-document handoffs,
parked until the main queue (GPU ablation backfill, then the K3 six-arm head-to-head)
drains. They are safe to execute concurrently with the main queue because they touch
neither the GPU nor `results/track-d-*` nor the amnesiac line.

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

## Item 3: open-estate benchmark construction from available online enterprise data (large, CPU-side)

Context: the founder opened the K6 estate-source line to a parallel agent. The verified
dataset inventory lives in `docs/research-notes/2026-11-24-open-estate-dataset-hunt.md`
(primary-source-verified licenses, plus a rejection ledger of what may NOT be used —
OpenSanctions is CC BY-NC, Fisher is LDC fee-gated; do not revisit those). The synthetic
noisy estate (commit `99ba4f1`) is the in-repo reference for construction discipline:
read its spec (`docs/2026-11-24-noisy-estate-benchmark-spec.md`), generator
(`scripts/gen-noisy-estate.mjs`), scorer (`scripts/noisy-estate-baseline.mjs`), and floor
(`results/noisy-estate-baseline.json`) before building.

Goal: a second, external-validity estate assembled from real and/or openly licensed
enterprise-like data available online (synthetic overlay is acceptable and, for identity,
preferred), scored by the same person-level machinery (pairwise + B-cubed + false-merge/
false-split + miss attribution), with the same anti-circularity rules: the generator/
builder imports only `node:` builtins and nothing from `src/`; the engine never sees the
answer key; the trivial exact-match baseline must be able to fail (and is recorded as the
floor, per the noisy-estate gate pattern).

Layered design from the hunt note (binding on honesty):
- **Real-identity audio (AMI, CC BY 4.0; ICSI, CC BY 4.0 at the AMI host):** real speech,
  real participants. Identity overlay on real speech is NOT honest — use these as-is for
  cross-modality identity resolution, never relabel who is speaking.
- **Text modalities:** overlay-synthesized identities are preferred and acceptable
  (plant synthetic people/facts over real documents). Enron (1.7 GB email) has no stated
  license — **founder gate before it enters the repo or any redistribution path; ask,
  do not assume**. MeetingBank text is CC BY 4.0 but its HF audio is CC BY-NC-SA — the
  audio may not enter the redistribution path. Stack Exchange (CC BY-SA) is fine for
  artifact/text modalities. Anything NC or fee-gated stays out (rejection ledger).
- Nothing leaves the machine during construction; downloads go into a new empty
  directory outside the repo tree until licensing is confirmed, then fixtures are
  checked in as data, not as scripts.

Scope boundary: **estate construction + exact-match baseline + scorer only — CPU-side.**
Any arm that trains or queries a model (the K3-style comparisons on this estate) stays on
the main queue's GPU; do not train anything for this item. The main queue's K3 six-arm
head-to-head runs on the synthetic noisy estate, so this item does not block or collide
with it.

Deliverables: estate fixtures + manifest (frozen answer key, versioned, deterministic,
no wallclock fields, estate SHA pinned with its recipe), exact-match baseline artifact
under `results/`, external-behavior tests wired into `test:ci` (determinism, coverage,
trivial-baseline gate, engine blindness, noise/span completeness — mirror
`test/noisy-estate.test.js`), and a dated run-record entry with every deviation recorded.

## Reporting

Append a dated entry to the run record of
`docs/2026-11-24-versieve-novelty-and-remediation-handoff.md` (commit shas and deviations
recorded as they happened, not smoothed), same style as the existing entries.
