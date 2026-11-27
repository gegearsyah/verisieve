# Swarm-Judge Handoff: Weft Theme-Linking Track (#40)

- **Date:** 2026-11-27
- **Repository:** `gegearsyah/versieve` (`main` @ `eca05c7`)
- **Primary Role of Next Session:** **Lead Judge & Swarm Coordinator for the Weft track.** The lead agent never writes bulk implementation code; it publishes the W1-W7 sub-issues (bodies in the orchestration spec, below), dispatches one swarm worker per unblocked frontier ticket at the **cheapest capable tier (DeepSeek/Haiku)**, independently runs verification commands (worker green reports carry zero authority), escalates one model tier only after a failed attempt, enforces standing repo rules, and integrates passing work one logical commit per ticket.

---

## 1. Verified State & Canonical References (Do Not Duplicate — Read Directly)

| Artifact | Location / URL | Purpose |
|---|---|---|
| **Parent Spec** | https://github.com/gegearsyah/versieve/issues/40 (`ready-for-agent`) | 38 user stories, implementation/testing decisions, single confirmed seam (the public estate perception call) |
| **Ticket Decomposition (issue bodies)** | `docs/2026-11-27-weft-orchestration-spec.md` | W1-W7 in T11/T12 issue format with disjoint write scopes, acceptance criteria, judge gates, dependency DAG |
| **Original Research** | `docs/research-notes/2026-11-26-tiny-theme-linker-research.md` | Architecture, H1-H9, phasing P0-P5, open founder questions |
| **Verified Novelty Re-check + Licence Audit** | `docs/research-notes/2026-11-27-weft-novelty-recheck-and-licence-audit.md` | 23 adversarially verified claims; H2 redefinition; Multi-News banned; OpenAI teachers barred; citation-and-differentiation table inputs |
| **Concurrent Orchestration (antigravity)** | conv `ff0d7d57...`, T11 worker at `0fb4d68d...` | T11 in flight on #38; T12 (#39) queued behind it. They own the GPU window and `scripts/`, `results/`, `test/` paths listed in their issues. **Do not start W6 before T11/T12 land; do not take the GPU window while T11/T12 need it.** |
| **Issue Tracker & Triage Rules** | `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md` | Sub-issue + native `blocked_by` commands (`gh`) |
| **Prior Swarm Handoff (T1-T12)** | `docs/2026-11-26-swarm-judge-handoff.md` | Standing judge rules, ticket format, execution loop — this handoff inherits all of them |

**Working tree at handoff:** untracked `.claude/`, `0_MwqEsP6YWzxVmaPT.gif`, the docs/research-notes files, `docs/versieve-landscape-and-research-backlog.md`, and the two 2026-11-27 Weft docs. Always `git status` and stage explicit paths; never `git add -A`. T11's worker may have staged files in the working tree — commit only Weft-track paths, one logical commit per ticket.

---

## 2. Binding Judge Rules (inherited from the 2026-11-26 handoff, plus Weft-specific)

1. **Judge Independently:** run `npm run test:ci`, `node bin/versieve.mjs audit-wasm`, and `node scripts/check-paper-numbers.mjs` yourself before accepting any worker's ticket.
2. **Zero-Import WASM Invariant** and size ceilings; any Weft export artifact must respect them.
3. **Append-Only Scientific Integrity:** never invent a number, never overwrite committed paper baseline values, fail closed if GPU/LLM runtimes are missing, record seeds, resample counts, model digests, and licences in every new JSON artifact.
4. **Honest-Reporting Word Ban:** never write "mathematically grounded", "eliminates", or "first"; no em-dashes in LaTeX; identity-orthogonality is worded "identity-blind", never "identity-removed"; no "perceive everything" / "atomic knowledge" framing.
5. **Claim Discipline:** every novelty statement cites the 2026-11-27 re-check; the conjunction survives, no single component does. H2 is measured against post-hoc nonlinear probes only.
6. **Licence Gates:** Multi-News never enters the public training recipe; hosted teachers must be permissively-licensed open-weight models (OpenAI barred); the licence audit is a hard release gate.
7. **Worker Tier Rule:** workers run at the cheapest capable tier (DeepSeek/Haiku). The lead judge escalates one tier per failed attempt before declaring a ticket stuck, and surfaces judgment calls (licences, thresholds, paper claims) to the founder instead of guessing.
8. **Commit Hygiene:** one logical commit per completed ticket; explicit staged paths; push only when the founder says so.

---

## 3. Weft Ticket DAG (7 tickets; issue bodies in the orchestration spec)

```text
IMMEDIATE (CPU, disjoint from T11/T12 — dispatch now)
  ├── W1 (#40) Theme-linking benchmark harness + baseline shootout [CPU, fail-closed LLM judge]
  └── W2 (#40) Training-data compilation + licence audit gate [CPU, fail-closed teacher]
GPU TRACK (queue behind T11/T12's window)
  ├── W3 (#40) Train un-quantized specialist [GPU]  <-- W1, W2
  ├── W4 (#40) Ablative extras: adversary / set-conditioning / triangle / modality [GPU]  <-- W3
  └── W5 (#40) QAT export + conformal abstain [GPU]  <-- W4
SEAM + RELEASE (strictly after T11/T12 land)
  ├── W6 (#40) Theme nodes in estate seam + erasure re-proof [CPU]  <-- W5, T11, T12
  └── W7 (#40) Claim audit, model card, release packaging [CPU]  <-- W6
```

| ID | Parent | Blocked By | Host | Key Gate |
|---|---|---|---|---|
| W1 | #40 | none | CPU | Baselines reproduce; per-bucket honest-competitor numbers recorded; fail-closed LLM judge |
| W2 | #40 | none | CPU | Licence audit green (Multi-News dropped, teacher verified); three pair types with provenance |
| W3 | #40 | W1, W2 | GPU | Bare specialist beats static-embedding threshold on identity-disjoint F1, else honest negative result |
| W4 | #40 | W3 | GPU | One extra per stage, honest deltas; H2 post-hoc nonlinear probe battery; GRL-vs-INLP decided on evidence |
| W5 | #40 | W4 | GPU | H5, H7 measured honestly; fail-closed absent weights; size/latency per quant level |
| W6 | #40 | W5, T11, T12 | CPU | Seam determinism, erasure receipts hold, no committed-baseline changes |
| W7 | #40 | W6 | CPU | Citation table complete; banned-word sweep clean; release blocked if story-36 gate fails |

---

## 4. Swarm Judge Execution Loop (Weft-specific deltas from the 2026-11-26 loop)

1. **Bootstrap:** publish W1-W7 as GitHub sub-issues under #40 from the orchestration spec bodies, label `ready-for-agent`, wire native `blocked_by` edges including cross-track edges (W6 blocked_by T11's and T12's issues, #38 and #39).
2. **Query Frontier:** W1 and W2 only, until T11/T12 finish. Verify the antigravity orchestration state (conv `ff0d7d57...`) before touching the GPU queue or the seam.
3. **Dispatch Isolated Workers:** one worker per frontier ticket, isolated worktrees, cheapest capable tier, exact ticket number + write scope + external-behavior acceptance criteria in the brief.
4. **Judge & Integrate:** inspect diffs against acceptance criteria; run the ticket gate plus the full suite yourself; remediate or escalate one tier; commit explicit paths; close the ticket with a verification receipt comment; dispatch newly unblocked tickets.
5. **Founder Checkpoints:** surface for decision — GRL vs INLP after W4's evidence; weights/dataset licence after W2's audit; training compute source before W3; any paper-level claim before W7.

---

## 5. Suggested Skills for the Next Session

- `mattpocock-skills:implement-spec` / `mattpocock-skills:tdd` — inside each swarm worker's vertical slice.
- `mattpocock-skills:code-review` — the Lead Judge's pre-merge audit of each worker branch.
- `mattpocock-skills:grilling` — before accepting W4's ablation claims and W7's model-card claims.
- Deep-research workflow (Workflow tool) — the W7 full-text literature sweep, at haiku-tier fan-out.
