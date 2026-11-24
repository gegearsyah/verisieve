# Versieve Novelty & Remediation Handoff: Fix the Phase I Record, Adopt Our Own Mechanism, Then Build Phase II on It

- **Date:** 2026-11-24
- **One-line goal:** From the *verified-but-biased* state (`fix/spec-15-remediation` @ `9472c26`, 108/108 CI green, 5 zero-import WASM kernels, 369,646 B total) to a **credible paper record reconciled to raw data** plus an **adopted novelty thesis** ("Leakage-Certified Scene Perception", founder-gated) that Phase II's perception pillars serve — instead of "we did this because the paper says so".

**Inputs this handoff was written from (all checked in):**
- [docs/research-notes/2026-11-24-argon-parity-feasibility-audit.md](2026-11-24-argon-parity-feasibility-audit.md) — codebase reality check; every reviewer claim tested against raw JSONs
- [docs/research-notes/2026-11-24-argon-parity-literature-review.md](2026-11-24-argon-parity-literature-review.md) — primary-source verdicts on every statistical/citation claim
- [docs/research-notes/2026-11-24-versieve-novelty-bet-research.md](2026-11-24-versieve-novelty-bet-research.md) — the Unlimited-OCR leverage recipe and the novelty-bet ranking

---

## 1. Standing Rules (founder-set, binding)

**Founder-wide (carried from the MLE standing list, revision 2026-11-16):**
- Lead model only decides/judges/verifies/integrates; outside Cursor, code writing and search go to haiku subagents (escalate one tier on failure, never start high); ponytail full mode.
- Binary-inspection tooling is never named in any repo file ("binary inspection", local note only).
- `git status` before every staging; stage explicit paths; never `git add -A`.
- Founder gates are asked, never assumed. Commits do not add a Co-Authored-By trailer. Push only when this doc's stage plan says push or the founder says push.
- The founder reads numbers in GRAPHS in documents; tables okay; chat stays prose (read the dataviz skill before any chart code).
- No claim changes — verdicts and receipts are settled; deviations are recorded, not smoothed.

**Repo-specific (matilda-portable; founder rulings 2026-11-24):**
1. **Naming:** brand spelling is **Versieve** in prose/titles of all docs and papers; repo/npm/module identifiers remain `verisieve`; never mix spellings within one document.
2. **Fix-first:** no Phase II feature commit lands before Stage 1 (paper-data remediation) is complete.
3. **Honest-reporting word ban:** never write "mathematically grounded", "eliminates", or "first" in papers. The design-effect adjustment in HC-CRC is reported as a survey-sampling heuristic, not a guarantee (literature verdict Q1).
4. **Every paper number traces to a checked-in raw artifact**, enforced by a CI check (built in Stage 1). Citations are pinned via arxiv.org directly, never via search snippets (the research agents caught the search tooling fabricating 8+ arXiv IDs this session).
5. **Zero host imports** (`imports.length === 0`), **zero hardcoded user paths**, clean-room naming — non-negotiable.
6. **Cloud egress discipline:** the only permitted external service is the DeepSeek judge agent (`deepseek-v4.1-flash`, judging-only), receiving only sanitized PII-free eval outputs; canaries/decoys never leave the machine.
7. **Novelty-first:** no new capability is added "because the paper says so" — every Phase II stage must serve the adopted thesis or be cut (founder, 2026-11-24).

---

## 2. State at Handoff Time — Verified NOW (2026-11-24, this session)

| Item | Measured value (re-measured, not quoted) |
|---|---|
| Branch / tip | `fix/spec-15-remediation` @ `9472c26`, **ahead 2** of `origin/fix/spec-15-remediation` |
| Working tree | clean except untracked `.cursor/` and `docs/research-notes/` (this session's 3 research files) |
| CI suite | `npm run test:ci` → **108/108 pass, 0 fail** (single serial run) |
| `node bin/verisieve.mjs audit-wasm` | `allVerified: true` — 5 binaries, 0 host imports each |
| WASM sizes | clean 14,633 + dl 60,096 + graph 54,402 + media 190,873 + sql 49,642 = **369,646 B** total |
| Media headroom | 190,873 / 215,000 B cap → **~24 KB left** for all planned new kernels |
| Local Ollama judges | `qwen2.5:7b`, `lfm3:latest`, `llama3.2:3b` (no DeepSeek local) |
| SR-MP ring | 512 slots, `pii_secrets.rs:1244`; 27 exports on media wasm — verified against the shipped binary |

**Phase I result integrity (from raw JSONs, audit §2):**
- **Audio SR-MP 20.62%→8.25% is CIRCULAR**: ring seeded from `pii_checks` — the scoring answer key (`run-reviewer-secrets-audio-pprl.py:372-379`). A legitimate self-seeding path exists at `tab-node-helper.mjs:489-496`.
- **TAB SR-MP loses at the paper's own operating points** (F1 73.27 < 74.20 at τ=0.50; 45.32 < 45.91 all-maskable), and the tex τ=0.70 "win" row (F1 74.91) **exists in no artifact or git history** (raw: 40.78).
- **Table `tab:secrets` matches stale commit `62eb0e1`** (0.13/2.97/0.66 MB/s) while Figure E2 matches HEAD (0.11/2.51/1.72); "4.5× vs Gitleaks" is really ~1.46×.
- **HC-CRC tex α=0.02/0.05 rows have no source**; prose "fails closed at α=0.01" contradicts the JSON (`certified: true` at α=0.01; it is **E-LTT** that fails at α≤0.02).
- **PT-LM is the strongest honest result**: tag echo 85%→65%→**0%**, false refusals 0%, Carlini exposure unchanged (2.63–3.51 bits), hyperparams recorded in `run-track-d-fair-lora.py` (r16/α32, lr 2e-4, 80 steps, bs 2×4, maxlen 768) — but not in the paper, and the trainer lives in **matilda + Rtio, not MLE**.
- Brand drift: "Versieve"/"verisieve" 31/18, 14/23, 19/7 across the three .tex.

**Literature verdicts (primary-source, full file in research-notes):**
- Design-effect n-shrinkage in a binomial tail: **not a proven guarantee** — real hierarchical-conformal primaries are Dunn/Wasserman/Ramdas (arXiv 1809.07441) and Lee/Barber/Willett (arXiv 2306.06342).
- E-LTT betting form is **defensible** (Ramdas et al. arXiv 2210.01948; Waudby-Smith & Ramdas arXiv 2010.09686); validity needs sequential conditional-mean control, not exchangeability.
- Submodular cost-benefit greedy is **(1−1/e)/2** (Nemhauser 1978; Khuller-Moss-Naor 1999; Sviridenko 2004; Minoux 1978 lazy greedy) — the plan's "(1−1/e) under budget" claim must be fixed or the algorithm upgraded.
- Chart axis-calibration is **known** (DePlot is arXiv **2212.10505** — the circulating 2212.10902 is wrong; MatCha 2212.09662; ChartQA 2203.10244; Pix2Struct 2210.03347) → systems novelty only.
- Retrieval-beats-fine-tuning cites verified: Ovadia 2312.05934, Mallen 2212.10511, Kandpal 2211.08411.
- Diarization: YIN (de Cheveigné & Kawahara, JASA 111(4), 2002), BIC (Chen & Gopalakrishnan, ICASSP 1998); pyannote 3.1 reference (HF model card): strict full DER AMI 18.8% / DIHARD 21.7% / VoxConverse 11.3% under different protocols. No classical-2-speaker-synthetic benchmark exists — our numbers are an own experiment.
- Judge bias primaries: Zheng 2306.05685; Wang et al. 2305.17926; Panickssery 2404.13076.

**Novelty research verdict:** the leverage recipe behind Unlimited-OCR's R-SWA/SR-SWA (name a constant-cost mechanism against an unbounded-feeling constraint, ablate against the simplest strawman, own the benchmark arena) is documented in the research note. Dead as theses: frame triage (25+ papers in 2026, e.g. MarKey 2609.15408) and deterministic compilation (Docling industrializes it). **Primary bet alive: "Leakage-Certified Scene Perception"** — every scene-graph element (text span, diarized speaker, chart series, image region) emits a finite-sample non-leakage certificate computed by the same O(1)-memory sketch that persists entity identity, inside a <500 KB zero-egress kernel. Secondary: **SREM (Sketch-Referenced Entity Memory)** as its mechanism chapter. Unresolved risk flagged: a possible unindexed "conformal PII sanitization" paper (C-P3L) could not be confirmed either way — do a targeted search before writing any novelty claim (and the word "first" is banned anyway).

---

## 3. Stage Plan

Owners: lead = this session's model; subagents = haiku default, sonnet on one failure, opus for hard problems. Every stage: run the verify commands yourself; subagent green reports carry no authority. One logical commit per stage, explicit paths.

**Stage 1 — Paper-data remediation (fix-first; no Phase II work before this lands)**
- What: in all three `paper/*.tex`: regenerate `tab:secrets` from HEAD `results/reviewer-secrets-audio-pprl-benchmarks.json` (0.11/2.51/1.72 MB/s; restate speedup as ~1.5×, hedged 2.51–2.97 only if re-measured); fix HC-CRC α=0.02/0.05 rows from `results/reviewer-tab-and-ltt-benchmarks.json` (0.92/7.45/35.64/10.07 and 2.53/9.55/39.89/21.47); correct the α=0.01 narrative (HC-CRC certifies; **E-LTT** fails at α≤0.02); delete the unsupported τ=0.70 SR-MP row or replace with the raw τ=0.70 values (P 91.94 / R 26.20 / F1 40.78); add the omitted losing ablation row (hybrid+SRMP 45.32 < 45.91); report hyperparameters (r16/α32, lr 2e-4, steps 80, bs 2×4, maxlen 768) in Paper 3; global prose pass to "Versieve"; apply the word ban; fix all citations per §2; fix the submodular bound to (1−1/e)/2.
- Build: a CI check script (e.g. `scripts/check-paper-numbers.mjs`) asserting every number in the tex tables greps to a raw JSON value — this is the permanent anti-drift receipt.
- Verify: `node scripts/check-paper-numbers.mjs` → all green; `npm run test:ci` → 108/108; papers recompile (pdflatex+bibtex, MLSys style) with zero undefined references.
- Abort: if a tex number cannot be sourced from any artifact, it is **deleted**, never hand-tuned.
- Commit: `fix(papers): reconcile all three papers to raw result artifacts + naming + citations`.

**Stage 2 — Audio SR-MP honest re-run (dev machine; needs whisper.cpp)**
- What: remove the answer-key seeding at `run-reviewer-secrets-audio-pprl.py:372-379`; seed **only** via the self-seeding path (`tab-node-helper.mjs:489-496`); add three conditions: plain fuzzy-match baseline on the same anchor list, partial/wrong-record anchors, third-party names absent from anchors; add a CI assertion that no scoring token can reach `contextAnchors`/seed arguments.
- Verify: re-run produces a new JSON; the anti-circularity assertion holds; publish the honest number whatever it is (if SR-MP no longer beats fuzzy-matching, the paper says so).
- Abort: if whisper.cpp is unavailable on the machine, stop and ask the founder — do not synthesize.
- Commit: `fix(audio-bench): self-seeded SR-MP re-run + anti-circularity guard`.

**Stage 3 — TAB SR-MP statistical honesty (dev machine)**
- What: add the paired permutation test the reviewer demanded (same-doc matched pairs); plot the isolated τ=0.70 row from real data; add the dumb baseline (propagate every detected name to later mentions in the same document); state in prose that SR-MP is worse than baseline at the paper's optimal thresholds unless the re-run says otherwise.
- Verify: new rows in the results JSON + updated `fig_e1` regenerated by `paper/figs/build_track_e_figures.py`; `node scripts/check-paper-numbers.mjs` green.
- Commit: `fix(tab-bench): paired tests + coreference baseline + isolated tau=0.70 row`.

**Stage 4 — Paper 3 judge upgrade + PT-LM recipe repair (dev machine, RTX 4070)**
- What: integrate the **DeepSeek agent swarm** as primary judge (`deepseek-v4.1-flash` via the existing OpenRouter agent setup from `MLE/trials/agent-race/run7leg3.mjs:48`): N agent instances, each reads the eval JSONL files and grades `held_50q`/`seen_20q` **question by question** with the blinded 0–2 rubric; strip any think-block output; keep local judges (`qwen2.5:7b`, `llama3.2:3b`) for an agreement column; canaries/decoys never sent. Then sweep the PT-LM recipe: epochs 80 → 160/240 (and lr 2e-4 vs 1e-4) to attack the "loses to its own base model on seen docs" finding; report the OOS column that vanished from Table 3.
- Verify: judge outputs land in a new `results/track-d-ptlm-ablation-*.json`; agreement rate reported; every number flows through `check-paper-numbers.mjs`.
- Abort: if the OpenRouter agent errors, fall back to local judges for the run and record the deviation — do not block the epoch sweep.
- Commit: `feat(paper3): DeepSeek agent-swarm judge + PT-LM epoch/lr sweep`.

**Stage 5 — GATE: adopt the novelty thesis**
- **Founder gate — ask, never assume.** Adopt **"Leakage-Certified Scene Perception"** (every scene-graph element carries a finite-sample non-leakage certificate computed by the same O(1) sketch that persists entity identity, in a <500 KB zero-egress kernel) as the thesis all Phase II work serves, with **SREM** as the mechanism chapter? Before asking, the lead runs the one unresolved prior-art check (the C-P3L "conformal PII sanitization" question) so the gate is decided on complete information.
- No commit; this decision rewrites Stage 6–10 framing.

**Stage 6 — Vector-side perception (pure JS; zero WASM bytes)**
- What: `parsePptxBuffer` extracts `<p:cxnSp>` connector arrows (`diagramEdges`) and `ppt/charts/chart*.xml` series (`chartSeries`); PDF content-stream vector-path parsing (`m/l/re/S/f`) for ruling-line tables in born-digital PDFs; wire edges into `verisieve_graph.wasm` (edge types already exist).
- Verify: TDD in `test/track-e-multimodal-enterprise.test.js` (red → green); `npm run test:ci`; `audit-wasm` unchanged sizes.
- Commit: `feat(perceive): DrawingML connector + chart series + PDF vector table extraction`.

**Stage 7 — Real JOIN in the Rust SQL kernel (founder ruling Q7: option B)**
- What: implement equi-JOIN (INNER, at least; LEFT if cheap) in `rust/verisieve-sql`; flip the rejection tests in `test/sql-wasm.test.js:84-150` into acceptance tests; watch the 49,642 B binary size (report delta in the commit).
- Verify: `cargo test --manifest-path rust/verisieve-sql/Cargo.toml`; rebuilt wasm keeps `imports.length === 0`; `npm run test:ci` + `audit-wasm` green; provenance JSON regenerated by the owning script, never by hand.
- Abort: if JOIN pushes the sql binary beyond its size ceiling and code golf fails, fall back to a JS merge layer and record the deviation — do not renegotiate the ceiling silently.
- Commit: `feat(sql-wasm): inner equi-join support`.

**Stage 8 — IB-AMP triage, honestly bounded (smallest WASM delta)**
- What: `vs_media_perceptual_dhash64` (~1-2 KB no_std kernel over caller-supplied RGB); JS lazy-greedy selector (Minoux) with the **(1−1/e)/2** claim only (or full (1−1/e) via a Sviridenko-style partial enumeration if implemented); measure the pruning-rate curve on the keyframe fixtures to earn the "90–98% pruning" number or delete it.
- Verify: `cargo test --manifest-path rust/verisieve-media/Cargo.toml`; `audit-wasm` shows media wasm ≤ 215,000 B; pruning curve lands in a results JSON + a figure (dataviz skill first).
- Commit: `feat(media-wasm): dHash64 + lazy-greedy triage with measured pruning curve`.

**Stage 9 — Prosody kernel v1 on already-decoded PCM (no ASR dependency)**
- What: in `audio_dsp.rs`: per-VAD-segment integer-autocorrelation F0 (YIN-style), RMS, ZCR, wpm; speaker-clustering-lite (BIC-style, cosine on timbre-pitch features, K≤8, static buffers) on Workspace-3-style synthetic dialogues. Presented as an **own experiment** next to pyannote 3.1 reference DERs (AMI 18.8% etc. under different protocols) — no classical-benchmark claim.
- Verify: `cargo test`; a synthetic 2-speaker fixture with known turn boundaries → purity ≥ target set by the founder; `audit-wasm` size check (24 KB headroom is shared with Stage 8 — if exceeded, GATE the size ceiling).
- Commit: `feat(media-wasm): F0/prosody + speaker clustering-lite on PCM`.

**Stage 10 — Argon-Perceive-Bench v1 + thesis integration + paper updates**
- What: 6 workspaces with **GT-by-construction** (no "Argon oracle" at runtime; Argon is the inspiration and one static reference column only, if the founder wants it); **Workspace 4 is keyframes + WAV + VTT — no mp4-decode claim** (video decode stays fail-closed external); anti-circularity CI assertion on every workspace (no GT token may reach any seed argument — the codebase has already demonstrated this failure mode once); frame the benchmark around the adopted thesis: coverage/leakage certificates per scene-graph element, byte-budget frontier (50/215/500 KB), ablations vs Presidio / PerceptFence-style rules / plain Bloom / unbounded dictionary.
- Verify: `node scripts/eval-argon-parity-benchmark.mjs` → `results/argon-parity-benchmark.json`; `npm run test:ci`; `check-paper-numbers.mjs` green; papers + README updated; figures follow the dataviz skill.
- Commit: `feat(bench): Argon-Perceive-Bench v1 (GT-by-construction, anti-circularity)` then `docs(papers): Phase II results`.
- GATE: pushing to `main` — founder decides.

---

## 4. Skill Map

- `mattpocock-skills:tdd` — Stages 6–9 seams (`test/track-e-multimodal-enterprise.test.js`, Rust crate tests).
- `code-review` — before any merge/push of substantial diff (Stages 4, 7, 10).
- `dataviz` — before any figure code (Stages 3, 8, 10); the founder reads numbers in graphs.
- Binary-inspection MCP — artifact/WASM shape checks; never named in any committed file.
- `mattpocock-skills:research` / `grilling` — for the Stage 5 prior-art check and any new claim before it enters a paper.
- `mle-handoff` — this formula, for the next closeout.

## 5. Known Traps (accumulated; add, never silently drop)

1. **Evaluator circularity is a proven failure mode here** (audio SR-MP was seeded from the scoring key). Every new benchmark seeds only from engine-observable context; GT lives in the scorer; CI-assert it.
2. **Tex-vs-JSON drift**: Table 5 matched a stale commit. `check-paper-numbers.mjs` is the permanent receipt; never regenerate a number by hand.
3. **arXiv ID hallucination**: web-search summaries fabricated 8+ IDs this session. Pin every citation via arxiv.org directly.
4. **~24 KB media-wasm headroom** shared by Stages 8+9; total 369,646 B against a "<400 KB" claim — the size story must be renegotiated openly (GATE) before Phase II adds bytes.
5. **SQL engine rejects JOIN today**; ASR and video decode are fail-closed externals; there is no no_std JPEG decode and PNG decode lives only in JS — every "perception" benchmark run needs the dev machine.
6. **`verisieve_graph.wasm` ships with no in-repo Rust source or provenance JSON** — restore ownership or document its provenance before leaning the thesis on it.
7. **The trainer lives in matilda + Rtio, not MLE**; the previous handoff's "Phase 4 in MLE" pointed at the wrong repo.
8. Judge egress discipline: only sanitized eval outputs to the DeepSeek agent; strip think blocks; canaries never leave.
9. R1-style reasoning models are unstable for rubric judging — pin the rubric, parse only the final verdict.
10. The reviewer's banned words ("mathematically grounded", "eliminates", "first") will keep coming back in drafts — grep for them in Stage 1 CI too.

## 6. Founder Gates

| Gate | Status |
|---|---|
| Fix-first ordering (Stage 1 before any Phase II feature) | SETTLED 2026-11-24 (yes) |
| Naming: "Versieve" prose / `verisieve` identifiers | SETTLED 2026-11-24 |
| Cloud DeepSeek agent-swarm judging of sanitized outputs | SETTLED 2026-11-24 (yes — judging only) |
| Real JOIN in the Rust SQL kernel (option B) | SETTLED 2026-11-24 (B) |
| Adopt "Leakage-Certified Scene Perception" as thesis | **OPEN — Stage 5** |
| Size-ceiling renegotiation (media 215 KB / total <400 KB) | **OPEN — triggers on Stage 8/9 overflow** |
| Push to `main` | **OPEN — end of Stage 10** |

## 7. Definition of Done

- [ ] All three papers reconcile 100% to raw artifacts; `check-paper-numbers.mjs` green in CI.
- [ ] Audio SR-MP number re-measured self-seeded, with fuzzy baseline + partial/wrong-record conditions; anti-circularity assertion in CI.
- [ ] TAB SR-MP reported with paired test, dumb coreference baseline, isolated τ=0.70 row from real data; losing rows not omitted.
- [ ] Paper 3 graded by DeepSeek agent swarm + local-judge agreement column; PT-LM epoch/lr sweep reported; hyperparameters and OOS column in the paper.
- [ ] Novelty thesis adopted (gate closed) and the C-P3L prior-art question resolved.
- [ ] Vector diagram/chart extraction, SQL JOIN, dHash triage, prosody kernel shipped behind green TDD + unchanged import discipline (`audit-wasm` allVerified).
- [ ] Argon-Perceive-Bench v1 runs end-to-end GT-by-construction with anti-circularity CI; no mp4-decode claim.
- [ ] Every new number in papers traces to a results JSON; word-ban grep clean.
- [ ] `npm run test:ci` green (≥108 tests), all commits explicit-path, run record below filled.

## 8. Run Record

*What actually happened (appended by the executing session — commit shas and DEVIATIONS recorded as they happened, not smoothed).*
