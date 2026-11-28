# W5 end-to-end handoff: v5 corpus lane through specialist retraining to final result

Date: 2026-11-29
Written by: the corpus-v5 lane agent, for the next agent working alone overnight
Branch: weft-corpus-v5 (worktree .claude/worktrees/corpus-v5)
Founder authorization: standing. The next agent runs everything end to end without asking: estate extension, spend, retraining, evaluation, release candidate. The founder is asleep and wants a final result to wake up to.

## 0. The mission in one paragraph

Weft is the theme-linking specialist inside the Versieve company brain: it links documents that carry the same talking point even when the wording, the department, the format, and the people all differ. The v5 corpus stage is complete (three org profiles, 18,750 coverage docs, 1,797 source-disjoint strata pairs). What remains is the estate extension the founder ruled on in issue #59 (source-kind axis, people-free knowledge units, non-knowledge negatives, knowledge-density filter, company-private knowledge units with byte-diff erasure receipts), then recompiling the training pairs, retraining the specialist with the strata in the mix, evaluating against the gates in section 6, and producing a release candidate with honest receipts. Stop condition: a retrained specialist that passes the gates, or a fully documented negative result with the numbers and the next decision framed for the founder.

## 1. Binding founder rulings (issue #59, comments 2 to 5, 2026-11-28)

These are rulings, not suggestions. Read #59 in full before starting.

1. The product is the company brain, not the people brain. The knowledge unit is the document or the event; a meeting is the identity of the unit and people are attributes of it.
2. Erasure operates on knowledge (recipes, trade secrets, board strategy, client data at contract end). Person erasure is the GDPR special case: map the person to their knowledge footprint, erase those units. The amnesiac corpus-regeneration mechanism is unchanged; what it erases is re-framed.
3. Binding naming everywhere you write: source = meeting/thread/ticket/document anchor, theme = knowledge, identity = the person erasure axis only. New strata labels prefer source-disjoint over identity-disjoint.
4. Knowledge is the unit; company is the motivating domain, not the boundary. Compliance corpora (APP rules, NIST AI RMF, ISO 42001) are valid source types.
5. A knowledge threshold exists. A greeting is not a knowledge unit and must not be linkable. If a knowledge-density filter is implemented, record the rule and its measured effect in a note.
6. Estate gaps to close (accepted): a source-kind axis on docs (doc.source is a licence string today), people-free knowledge units (no person entities), and a non-knowledge negative class.
7. Corpus ask #4 (accepted): company-private knowledge units. A recipe-like confidential thread spanning document + meetings + derivative notes, anchored with provenance, proven erasable by regenerate-minus-unit byte-diff receipts.

## 2. Hard style rules (violations have been rejected before)

- Never write the literal word formed by the letters f-i-r-s-t. Use "before any others" or restructure.
- Never write the literal word formed by e-l-i-m-i-n-a-t-e-s. Use "removes", "erases".
- Never write the literal two-word phrase "mathematically grounded".
- Never use the wording "identity-blind".
- No em-dashes anywhere in prose. Use commas, colons, or parentheses.
- LF line endings on everything you write.
- Honest framing is binding: teacher-claimed properties are labeled teacher-claimed; a corpus without a usage file is spend of unknown size, never zero; BM25 saturation is reported, not hidden.
- Paper style: titles hit the training-data question; privacy words never lead.

## 3. Operational rules

### Spend and the key
- Mistral API credit (~$102 at last count, roughly $15 to 20 spent since) has STANDING authorization: use it anytime, never ask, never wake the founder.
- The key lives in `.anthropic-key` at the MAIN checkout root (gitignored). Never commit it, never print values. Source it per run: `set -a && source "/c/Users/GEYE ARDIANSYAH/Downloads/Innovation Hub/matilda-portable/.anthropic-key" && set +a`, then `WEFT_TEACHER_KIND=api WEFT_TEACHER_LICENCE=mistral-api-tos node <script>`.
- GATE: before ANY new API spend path (new script, changed prompt, scaled run), run an Opus-tier pre-spend audit agent; it writes a verdict note (PASS / PASS-WITH-NOTES / FAIL) under docs/research-notes/ and gates the spend. A passing smoke (small paid run) comes before any scaled run when prompts changed.

### Model routing (founder ruling)
- Haiku: read-only search, verifying one fact, mechanical edits, commit and PR mechanics.
- Sonnet: implementation, design-heavy work, subagents that edit files.
- Opus: pre-spend audits, architecture decisions, debugging where the cause is unknown, adversarial verification.
- Escalate one tier per failed attempt before declaring anything impossible.

### Git and the worktree
- Work in the worktree `.claude/worktrees/corpus-v5`. NEVER bare `git stash` or `git stash pop`: the stash stack is shared across worktrees and other sessions. Use a WIP commit instead.
- Test runs dirty the tree with fixture drift (CRLF, timestamps). Leave drift unstaged, never commit it.
- Commits end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`. PR descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Push to origin/weft-corpus-v5 as you go. PRs target main.
- CRITICAL BRANCH STATE: weft-corpus-v5 is 48 commits behind main. Main carries the Weft v1 release (`release/weft-specialist-v1/`: MODEL_CARD.md, RELEASE-MANIFEST.json, CALIBRATION.svg) and the W5/W6/W7 work (quantized export, OOD routing, theme seam). Before compiling pairs or retraining, merge main into weft-corpus-v5 and re-run the test suites.

### Issue tracker
- Issues in gegearsyah/versieve via `gh`. Lane hygiene: decisions get recorded in research notes under docs/research-notes/ (append-only culture) and material rulings get a short comment on #59. Canonical labels are in docs/agents/triage-labels.md.

## 4. What exists right now (all committed on weft-corpus-v5)

### Coverage corpora (gitignored tmp pattern; deterministic from seed 20261130)
- results/weft-fullscale-live-corpus-v5-regional-logistics.tmp.json: 6,250 docs / 3,944 links, over300 135
- results/weft-fullscale-live-corpus-v5-hospital-network.tmp.json: 6,250 docs / 3,782 links, over300 114
- results/weft-fullscale-live-corpus-v5-municipal-office.tmp.json: 6,250 docs / 3,930 links, over300 129, max doc 527 words
- Total: 18,750 docs / 11,656 links / 378 docs past 300 words (v4 produced none past 240). Length distribution is shape-matched across profiles (p50 65 to 66, p90 204 to 219), so cross-shape transfer tests stay clean.

### Strata (committed deliverables)
- results/weft-paraphrase-strata-v5-{regional-logistics,hospital-network,municipal-office}/: strata-pairs.jsonl + receipt.json. 1,198 positives + 599 negatives, labels `source-disjoint-same-theme-positive` and `source-disjoint-near-topic-negative`, every pair carrying eventA/eventB compile-time event anchors (coverage link clusters, cluster id = lexically smallest doc id).
- The BM25-breaking crossing, replicated three times: positives 0.0347 / 0.0377 / 0.0354 lexical overlap (source-to-paraphrase) vs negatives 0.1436 / 0.1487 / 0.1609. A lexical matcher scores the wrong pairs higher on every profile. Positives sit under the 0.0718 same-theme baseline.

### Scripts
- scripts/generate-weft-live-corpus-v5.mjs: coverage driver (ORG_PROFILES, SEED 20261130, per-profile checkpoints and resume, PAIRS_TARGET 50000, length bands with longBandChunk 3).
- scripts/generate-weft-paraphrase-strata.mjs: strata driver (source-axis prompts, deriveEventClusters, fail-closed parseTeacherDocs with reject dumps to TEMP, one-pass remapIdentityCollisions, NEGATIVES_CAP 200, main-guarded, explicit --profile and --limit).
- scripts/build-weft-training-pairs.mjs: the pairs compiler. Exports you will reuse: completeWithRetry (typed WeftTeacherUnavailableError only, backoff [30000,60000,120000,300000,600000] ms, 6 attempts), parseLooseJson (escapes raw control characters inside JSON string literals; identity on valid JSON; Mistral emits illegal raw newlines), maskText, roleTokenMap, resolveLocalTeacher, TEACH_ATTEMPTS = 4, API_TEACHER_LICENCE.
- scripts/weft-mistral-teacher.mjs: API adapter (mistral-medium, typed JSON errors exit 2, retryable 429/5xx, usage on stderr as JSON lines, random_seed pinned).
- On main after the merge: scripts/train-weft-specialist.py (frozen MiniLM-L6-v2 base plus heads), scripts/analyze-weft-specialist-gate.py, scripts/run-weft-ablations.py, scripts/run-weft-baseline-shootout.py.

### Crash hardening already in place (do not weaken)
Chunk checkpoints with last-wins resume, 4 teach attempts per chunk with seed shift, parseLooseJson at every parse site, reject dumps to os.tmpdir() never the repo, profile skip when the corpus exists.

### Tests
- 51 weft tests green: run `node --test "test/"*weft*.test.js`. Suites: weft-paraphrase-strata (W-STRATA 1 to 9), weft-api-teacher-contracts (W-API, includes parseLooseJson and checkpoint-resume regressions), plus the driver, compiler, and estate suites. New non-trivial logic ships with a test; fail-closed paths must have one.

### Notes to read before acting
- 2026-11-29-w5-v5-stage-close.md: the stage accounting (spend, caveats, tables).
- 2026-11-28-w5-source-axis-strata-rework.md and 2026-11-28-w5-source-axis-strata-reaudit.md: the source-axis rework and its PASS-WITH-NOTES audit.
- 2026-11-29-w5-v5-corpus-driver.md and 2026-11-28-w5-v5-corpus-prespend-audit.md: the driver audit trail.
- 2026-11-28-w5-specialist-handoff.md: the specialist side (frozen base ruling, OOD tripwire design, quantized export under 30 MB, the numbers below).
- 2026-11-28-w4-specialist-research-handoff.md: gate history and the style-variance findings.

## 5. Measured facts your design must respect

1. Coverage is the boundary. Link head: 0.9652 pairwise F1 on covered style, 0.6695 on an unseen voice, 0.4798 when a single-voice head meets varied style. The head is only as wide as its training styles; v5's three org profiles exist to widen exactly this.
2. The pooled-cosine fallback is live-blind: 0.5304 to 0.5481 on every live holdout. It passed story-36 (0.9989 vs 0.9973 size-matched static baseline) on fixture-like data only. The story-36 gate is ruled-passed via pooled cosine; the link head is rescoped to abstention and calibration, and it scored 0.3617 on identity_disjoint, which is a head-design miss, not a data miss.
3. BM25 scores 1.0 on the old identity_disjoint bucket because same-theme docs share words. The paraphrase-hard strata exist precisely to fix that measurement; never claim theme-linking skill from a bucket BM25 saturates.
4. Identity overlap must not be a learnable shortcut: keep pair construction balanced so shared identities correlate with the label no better than chance. The v5 coverage corpora keep person identities as the erasure axis (valid per the rulings); the strata already enforce identity disjointness on positives.
5. Conformal calibration is in-domain only; the W4-v4 head's usable threshold was 0.6878 on its holdout.

## 6. The end-to-end plan

Phase 0, before anything: read #59 in full (all comments), read the notes in section 4, merge main into weft-corpus-v5, run `node --test "test/"*weft*.test.js`, confirm 51+ green.

Phase 1, estate extension (design, audit, smoke, spend):
- Design ONE coherent extension carrying, per the rulings: a source-kind axis on docs (meeting / thread / ticket / memo / compliance-doc), people-free knowledge units (documents with zero person entities; compliance PDFs are valid source types), a non-knowledge negative class (greetings and logistics chatter that must NOT link), the knowledge-density filter (record the rule and its measured effect in a note), and company-private knowledge units (a confidential thread spanning document + meetings + derivative notes, provenance-anchored, erasable, with a regenerate-minus-unit byte-diff receipt as proof).
- Sized benchmark-scale before product-scale. Opus pre-spend audit on the design and prompts, then a small paid smoke, then the scaled run. Budget guidance: the strata passes cost about 440K tokens per profile; keep the extension's smoke under that.
- Event anchoring follows the existing pattern: compile-time clusters, cluster id = smallest doc id. Reuse deriveEventClusters.

Phase 2, compile pairs: recompile training pairs per profile with the compiler, including the strata and the new estate classes. Keep the balance so identity overlap is not a learnable shortcut (fact 4). Record per-bucket counts in the compile receipt.

Phase 3, retrain: scripts/train-weft-specialist.py (after the merge brings in any v1-era updates), frozen MiniLM-L6-v2 base plus heads, v5 data including the source-disjoint strata, seed recorded in the training ledger (results/weft-specialist-training.json, append-only). The theme-linking objective is the product objective; the link head doubles as the abstention and calibration layer with the kNN OOD tripwire from the specialist handoff.

Phase 4, evaluate against the gates (section 7), with BM25 and the static baselines re-run on the paraphrase-hard bucket and the lexical-overlap gap reported honestly. Run scripts/analyze-weft-specialist-gate.py and run-weft-baseline-shootout.py against the new eval sets.

Phase 5, close: stage-close note with full accounting (calls, tokens, drops, caveats), release candidate under release/ following the v1 manifest pattern, PR to main with the attribution line, short comment on #59 recording what landed. If any gate fails, that is the result: document the numbers, the cause hypothesis, and the framed next decision. Do not hide a negative behind prose.

## 7. Success gates (the founder's tiers, ruled in conversation 2026-11-28)

1. Within-coverage pairwise F1 at or above 0.90 on the v5 holdouts (expect around 0.95; v1 measured 0.9652 on a 6-voice holdout).
2. Held-out shape: raw F1 at or above 0.75 on an unseen org profile (stretch 0.90; the current analog is 0.6695 on an unseen voice).
3. Accepted-pairs F1 at or above 0.90 with usable coverage (around 60 percent or more of pairs accepted) through the abstention and calibration layer.
4. The detector must actually flag out-of-coverage inputs; a detector that accepts everything fails this gate even if F1 looks good.
5. BM25 and the static baselines must not saturate the paraphrase-hard bucket; report the lexical-overlap gap in the eval note.
6. The non-knowledge negative class must not link: greetings and chatter score low, which is the knowledge-threshold gate made measurable.

## 8. Failure handling

- A failed attempt escalates one model tier (haiku to sonnet, sonnet to opus) before anything is declared impossible.
- Teacher API failures retry through completeWithRetry; a chunk that exhausts 4 attempts kills the run loudly. Resume from the per-profile checkpoint tmp file; never regenerate a completed profile (the driver skips existing corpora).
- A failed audit verdict blocks spend: fix, re-audit, then spend. Never spend around a FAIL.
- If the retrain misses a gate, run the ablation ladder before concluding: data volume, strata share, head width, seed. The ablation script and ledger exist for exactly this.

## 9. What the founder wakes up to

One message: gates passed or missed, the number table, where the release candidate lives, what it cost, and what decision (if any) needs them. Honest numbers beat good numbers.
