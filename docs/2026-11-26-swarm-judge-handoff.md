# Swarm-Judge Handoff: Landscape-Parity Capabilities (#26) & Empirical Validation Suite (#27)

- **Date:** 2026-11-26
- **Repository:** `gegearsyah/versieve` (`main` @ `5769d13`)
- **Primary Role of Next Session:** **Lead Judge & Swarm Coordinator.** The lead agent never writes bulk implementation code directly when spawning workers; it breaks `#26` and `#27` into tickets (if not already published as sub-issues), dispatches one swarm worker per unblocked frontier ticket, independently runs verification commands (worker green reports carry zero authority), enforces standing repo rules, and integrates passing work one logical commit per ticket.

---

## 1. Verified State & Canonical References (Do Not Duplicate — Read Directly)

| Artifact | Location / URL | Purpose |
|---|---|---|
| **Deep Research Report (APA 7.0)** | `docs/research-notes/2026-11-26-versieve-landscape-prior-art-and-novelty-report.md` | Verified 38 tools/papers, 15 newly added peers (incl. audio lane), 5 rejected unverified citations, 6 unwritten theoretical mechanisms |
| **Spec A (Seam 1 — Product Capabilities)** | https://github.com/gegearsyah/versieve/issues/26 (`ready-for-agent`) | 26 user stories: pluggable detectors, shadow audit, NumGuard, forensics/PDF irreversibility, HIPAA + restore, fail-closed MCP, exporters, `versieve sanitize`, frontier hooks |
| **Spec B (Seam 2 — Validation & Claims)** | https://github.com/gegearsyah/versieve/issues/27 (`ready-for-agent`) | 21 user stories: P0 README/citation fixes, P1 Tier-A/B decisive experiments, gated `AC-CRC` / `IB-PT-LM` frontier spikes |
| **Open Paper Review Gaps** | `docs/2026-11-25-experiment-gap-handoff.md` | Exact Paper A R5, Paper B DA1, Paper C R4, Paper D DA-3/ME-7 acceptance specs & host requirements |
| **Original Landscape Backlog** | `docs/versieve-landscape-and-research-backlog.md` | Superseded on competitor verification by the 2026-11-26 report; retain as P0–P3 checklist |
| **Issue Tracker & Triage Rules** | `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md` | GitHub sub-issue + native `blocked_by` dependency commands (`gh`) and label mapping |
| **Swarm Model Rule** | `.cursor/rules/swarm-model.mdc` | In Cursor, spawn swarm workers on `grok-4.7-high` (no `Co-Authored-By` trailers); outside Cursor, use smaller worker tier and escalate on failure |

**Working Tree at Handoff (`main` @ `5769d13`):**
Untracked files currently in workspace: `.claude/`, `0_MwqEsP6YWzxVmaPT.gif`, `docs/research-notes/2026-11-25-prompt-gateway-feasibility.md`, `docs/research-notes/2026-11-26-versieve-landscape-prior-art-and-novelty-report.md`, `docs/versieve-landscape-and-research-backlog.md`, and this handoff file. Always run `git status` and stage explicit paths; never `git add -A`.

---

## 2. Binding Judge Rules (Non-Negotiable)

1. **Judge Independently:** Run `npm run test:ci`, `node bin/versieve.mjs audit-wasm`, and `node scripts/check-paper-numbers.mjs` yourself before accepting any worker's ticket. Never trust a worker's self-reported pass.
2. **Zero-Import WASM Invariant:** All five binaries in `vendor/wasm/` must keep `imports.length === 0`. Any Rust/WASM edit must preserve `audit-wasm` green and stay under size ceilings (`versieve_media.wasm` cap: `215,000 B`).
3. **Append-Only Scientific Integrity:** Never invent a number, never overwrite committed paper baseline values, and fail closed if GPU/Presidio/GLiNER runtimes are missing. Record seeds, resample counts, model digests, and licenses in every new JSON result artifact.
4. **Honest-Reporting Word Ban:** Never write *"mathematically grounded"*, *"eliminates"*, or *"first"* in README or papers; no LaTeX `---` em-dashes; never cite the 5 unverified tools rejected in the 2026-11-26 report (`Cloak` PII app, `OSpipe`, `open-redactor`, `ALDS`, `mask-llm`).
5. **Commit Hygiene:** One logical commit per completed ticket; explicit staged paths; no `Co-Authored-By` trailer; push only when explicitly instructed by the founder.

---

## 3. Swarm Ticket DAG (12 Tracer-Bullet Tickets Across 4 Waves)

> **Important:** `#26` and `#27` are parent **specs**, too coarse for single swarm workers. Step 0 for the Lead Judge (unless already published as GitHub sub-issues prior to pickup) is to create these 12 sub-issues under `#26` and `#27` with label `ready-for-agent` and wire **native GitHub `blocked_by` edges** per `docs/agents/issue-tracker.md` (`gh api --method POST repos/gegearsyah/versieve/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`).

### Dependency Graph

```text
WAVE 0 (Immediate Frontier — 4 parallel CPU/Node workers, disjoint write scopes)
  ├── T1 (#27) README, Citation & Claim Consistency Reconciliation [CPU]
  ├── T2 (#26) Pluggable Stage 3B Detector Adapter + Gate Diagnostics & E-Value Hook [CPU]
  ├── T3 (#26) Forensic Hidden-Channel Parity & PDF Irreversibility Gate [CPU]
  └── T4 (#26) HIPAA Validator Pack, Opt-In Vault Restore & Fail-Closed MCP [CPU]
         │
WAVE 1 (Unlocks as Wave 0 passes Judge review — 3 parallel CPU workers)
  ├── T5 (#26) Shadow Audit, Residual Leakage Report & NumGuard Numeric Hashing [CPU]  <-- blocked by T2
  ├── T6 (#26) Multi-Framework Exporters (LLaMA-Factory/Unsloth/Oumi/NeMo) & `versieve sanitize` CLI [CPU]  <-- blocked by T2, T3, T4
  └── T7 (#27) Paper D Guarantee Baselines (Dunn/Lee/HG-CRC), tau=0.70 Bootstrap CI & LTT Cross-Check [CPU]  <-- blocked by T1
         │
WAVE 2 (External Detector, Competitor & GPU Shootouts — 3 parallel workers by host)
  ├── T8 (#27) Gate-Over-Best-Detector (HC-CRC + Presidio/GLiNER), Paper A ai4privacy-200k & Stitched TAB Shootout [Python Presidio/GLiNER]  <-- blocked by T1, T2
  ├── T9 (#27) Competitor Benchmarks (screenleak, unmasker specimens, MAT2) & Ease Benchmark [CPU/ONNX]  <-- blocked by T2, T3, T5, T6
  └── T10 (#27) Paper C PT-LM Multi-Seed Ablation (>=3 seeds) & Paper B End-to-End Engine-Resolution Router [8 GB RTX GPU]  <-- blocked by T1
         │
WAVE 3 (Adversarial Privacy, Scale Training & Gated Theoretical Novelty Spikes)
  ├── T11 (#27) Scanner-Missed Canaries, CPA Attacker Re-ID Audit & Scale QA Training (>=500 Qs) [8 GB RTX GPU]  <-- blocked by T6, T10
  └── T12 (#27) Exploratory Theoretical Frontier Spikes: AC-CRC Dual-Channel E-Gate & IB-PT-LM [8 GB RTX GPU]  <-- blocked by T2, T7, T10, T11
```

### Ticket Summary & Judge Verification Gates

| ID | Parent | Blocked By | Host | Write Scope (Conflict Avoidance) | Judge Pass Gate |
|---|---|---|---|---|---|
| **T1** | `#27` | None | CPU | `README.md`, `paper/*.bib`, `paper/*.tex`, `scripts/check-paper-numbers.mjs` | `node scripts/check-paper-numbers.mjs` = 0 fails; all 8 README fixes + 18 verified cites present; 0 banned words / 0 unverified tool cites |
| **T2** | `#26` | None | CPU | `src/perceive.js`, `src/gatekeeper.js`, new detector-adapter test | Plugged mock/local text+image adapter feeds `GC-CRC` + `HC-CRC`; missing runtime fails closed; rejection-reason codes + secondary e-value slot verified |
| **T3** | `#26` | None | CPU | `src/pdf-parser.js`, `src/enterprise-parsers.js`, `src/pdf-image-pipeline.js`, forensic test | Opaque-overlay text, PDF revisions, rendering-mode-3/white-on-white/off-page, recursive attachments caught; PDF irreversibility re-extraction asserts 0 residual |
| **T4** | `#26` | None | CPU | `src/secret-scanner.js`, `src/graph-wasm.js`, `src/mcp-server.js`, HIPAA/MCP tests | DEA/MBI/MRN/CLIA validated; opt-in `restore()` property-based round-trip passes; irreversible mode blocks restore; injected MCP faults return 0 raw bytes |
| **T5** | `#26` | T2 | CPU | `src/perceive.js` (receipt/shadow-audit/numguard), `src/amnesiac-corpus.js`, audit test | Shadow audit catches injected residual leak; NumGuard flags altered non-PII numbers while ignoring redacted PII numbers; optional Merkle root + ego-graph degree telemetry emitted |
| **T6** | `#26` | T2, T3, T4 | CPU | Exporters module, `bin/versieve.mjs`, CLI/exporter tests | LLaMA-Factory/Unsloth/Oumi/NeMo JSONL schema tests pass; `versieve sanitize <file>` writes clean file + accurate before/after diff report |
| **T7** | `#27` | T1 | CPU | `scripts/run-reviewer-tab-and-ltt.py`, `results/`, Paper D table/changelog | Dunn/Lee/HG-CRC rows + `τ=0.70` seed-42 1,000-resample CI + licenses/seeds written; `check-paper-numbers.mjs` green |
| **T8** | `#27` | T1, T2 | Python | `scripts/run-scale-benchmark.mjs`, TAB shootout runner, `results/` | Paper A Presidio/GLiNER 500-rec/580-span row + `HC-CRC`-over-Presidio/GLiNER + stitched TAB shootout saved with 95% CIs; fails closed if runtimes missing |
| **T9** | `#27` | T2, T3, T5, T6 | CPU/ONNX | Competitor & ease benchmark scripts, `results/` | `screenleak` (text + IoU image), `osint-shifu/unmasker` specimens, `MAT2` fixtures, and README ease table generated reproducibly |
| **T10** | `#27` | T1 | 8 GB GPU | `scripts/run-track-d-fair-lora.py`, `scripts/run-track-k-composition-head-to-head.py`, `results/` | ≥3-seed `PT-LM` vs. masking-only vs. surrogate-only vs. Safe + `retrieval_engine` arm (60 Qs, 2 judges, McNemar/perm test); 81.7% kept labeled as conditional upper bound |
| **T11** | `#27` | T6, T10 | 8 GB GPU | Canary, CPA attacker, & scale-training runners, `results/` | Scanner-missed canary exposure bits/rank-1, `CPA` released vs. withheld re-ID rate, and ≥500-Q 3-seed trained vs. retrieval gap recorded |
| **T12** | `#27` | T2, T7, T10, T11 | 8 GB GPU | Exploratory `AC-CRC` & `IB-PT-LM` runners, `results/` | Strictly labeled exploratory artifacts; reports honest positive or negative delta vs. `HC-CRC` / `PT-LM` across ≥3 seeds |

---

## 4. Swarm Judge Execution Loop

1. **Bootstrap:** Check open sub-issues under `#26` and `#27` (`gh issue list --state open`). If sub-issues T1–T12 do not yet exist, publish them in dependency order (Wave 0 → Wave 3) with `ready-for-agent` and native `blocked_by` links.
2. **Query Frontier:** Identify all open tickets with `issue_dependencies_summary.blocked_by == 0` and no assignee whose required host environment matches the current machine (CPU tickets can always run first; GPU/Presidio tickets require the RTX/Python host).
3. **Dispatch Isolated Workers:** Spawn one swarm worker per unblocked frontier ticket using isolated worktrees/branches (`workspace: "share"` or git worktrees) so parallel Wave 0/1 workers never collide. Assign each worker its exact ticket number, write scope, and external-behavior acceptance criteria.
4. **Judge & Integrate:** For each returning worker:
   - Inspect diff against `to-spec` / ticket acceptance criteria and write-scope boundaries.
   - Run the ticket's Judge Pass Gate + `npm run test:ci` + `node bin/versieve.mjs audit-wasm` on the merged integration branch yourself.
   - If failing, send targeted remediation feedback to that worker (or escalate one model tier if stuck). Never accept unverified output.
   - Once green, commit with explicit paths (no `Co-Authored-By`), close the GitHub ticket with a concise verification receipt comment, and immediately dispatch the newly unblocked frontier tickets.

---

## 5. Suggested Skills for the Next Session

- `mattpocock-skills:to-tickets` — if T1–T12 have not yet been published as GitHub sub-issues with native `blocked_by` links.
- `mattpocock-skills:implement-spec` / `mattpocock-skills:tdd` — for external-behavior TDD inside each swarm worker's vertical slice.
- `mattpocock-skills:code-review` — for the Lead Judge's pre-merge audit of each worker branch.
- `swarm_pane` (if using Antigravity native swarm UI) — to track waves and worker status cleanly.
- `orx-experiment-tree`, `orx-results`, `orx-figures`, `orx-paper` — for T7–T12 empirical runs and paper table updates.
