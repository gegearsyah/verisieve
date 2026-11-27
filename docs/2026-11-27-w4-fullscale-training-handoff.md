# W4 full-scale training handoff — 2026-11-27

For the next session (judge or agent) picking up the Weft thread. Written by the
W-API judge session after the full-scale data milestone. State below is verified
on origin/main at commit fd77cc9.

## Where things stand

- main = fd77cc9, pushed. History: e761a4e (W-API adapter+roster, #50 closed) →
  f7518ae (T11, sibling session, #38 closed) → 8cddbc1 (full-scale generation) →
  fd77cc9 (T11 judge wiring).
- Full-scale training data is committed and digest-pinned:
  `results/weft-training-pairs-fullscale-live/` — 49,070 pairs
  (24,206 identity-disjoint positives / 1,203 masked / 23,661 hard negatives),
  2,000-pair eval slice, `usage.json` records the honest API facts
  (631 mistral-medium calls, 305,162 prompt + 1,618,248 completion tokens, 2h30m).
- Raw generated corpus kept on disk (untracked, gitignored via `results/*.tmp.json`):
  `results/weft-fullscale-live-corpus.tmp.json` (6,252 docs / 3,603 links).
  Needed if a realism-audit follow-up runs; deleting it costs ~€15 to regenerate.
- Kaggle MCP is connected. GPU quota was 30h/0 used on 2026-11-27, refresh
  2026-11-28T00:00Z. Repo is public, so a Kaggle notebook can `git clone` it.

## The next step (not started)

W4 full-scale training: fine-tune the ~23M-param MiniLM-L6-v2 Weft specialist on
the 49,070 pairs, then run the W3 gate — identity-disjoint cross-department
pairwise F1 vs the static potion-base-32M baseline (0.998). Two open tickets
that bear on it: #45 (W5: quantization + conformal abstain) comes after, and
the founder's pending GRL-vs-INLP decision (from the #44 ablation results in
`results/weft-ablations.json`) should be re-surfaced with full-scale evidence
in hand. No ticket exists yet for the full-scale training run itself — file one
if the judge flow wants it tracked.

Existing machinery to reuse, not rewrite:

- W3 specialist trainer (came in with fc4a2f2/#43) — the full-scale run is the
  same recipe pointed at `results/weft-training-pairs-fullscale-live/train.jsonl`.
- The ablation harness from #44 (`scripts/run-weft-ablations.py`) if the founder
  picks GRL or INLP for the identity-suppression arm.

## Judge rules that keep biting (all enforced by tests)

- Gate = `npm run test:ci` + `node bin/versieve.mjs audit-wasm` +
  `node scripts/check-paper-numbers.mjs`. Expect exactly one failure: the
  track-k7 CRLF test (#48, known). Everything else must be 0 fail.
- Test runs dirty the tree: fixtures get CRLF rewrites and several
  `results/*.json` baselines get timing drift rewritten. Revert those before
  committing (`git checkout -- fixtures/ results/<those files>`); never commit
  the drift. `git diff --ignore-cr-at-eol --stat` shows what is real.
- Count claims (tests/files) live in three places and the checker enforces
  them: README.md ~line 490, both benchmark .tex papers. Currently
  220 tests / 38 files / $214$ core + $6$ MCP. Bump all three together.
- Banned words in weft code/tests/artifacts: "mathematically grounded",
  "eliminates", "first" (a code comment saying "runs first" failed W-API 7).
- Results artifacts are append-only; licence audit entries append at array end
  (W2 1 and W-Data 6 test the unchanged prefix, and one sibling test finds by
  id, not position).
- `.anthropic-key` at repo root holds MISTRAL_API_KEY (gitignored, never
  committed, never print values). Source it at run time:
  `set -a && source .anthropic-key && set +a` with
  `WEFT_TEACHER_KIND=api WEFT_TEACHER_LICENCE=mistral-api-tos`.

## Gotchas learned the hard way this session

- `git push` from the main checkout races sibling sessions: another session
  landed f7518ae mid-judge. `git merge --ff-only` from the worktree branch will
  fail if main moved — fetch, rebase the worktree branch, re-run the gate,
  then ff and push.
- Mistral API: 402 = valid key, no billing; the current key works. Adapter
  retries 429/5xx and transient socket errors; a single response truncation
  would still kill a long run at the second retry, so if a full-scale rerun
  ever dies twice, add per-chunk checkpointing instead of more retries.
- The pair compiler caps per-document pair emissions per pair type — keep that
  in mind before "optimizing" it back to a shared counter; a shared counter
  starves the disjoint positives to ~1.3k of 26k.
- Windows: `process.exit()` after fetch crashes libuv (the adapter uses
  `agent:false` + `process.exitCode`); `\\n` inside bash heredocs gets mangled
  (use the Edit tool).
