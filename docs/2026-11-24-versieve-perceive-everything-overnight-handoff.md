# Overnight Research & Engineering Handoff: Versieve ("Perceive-Everything") — Theoretical Framework & Algorithmic Novelty Across All 3 Papers

- **Date:** 2026-11-24
- **Primary Repository:** `c:\Users\GEYE ARDIANSYAH\Downloads\Innovation Hub\matilda-portable` (`gegearsyah/versieve`, synced on `main` and `fix/spec-15-remediation` @ commit `b0b9c40`)
- **Sibling Browser Sandbox Repository:** `c:\Users\GEYE ARDIANSYAH\Downloads\Innovation Hub\Rtio` (`gegearsyah/RTIO`, `main` @ commit `7c0b4cb`, live at `https://www.rtio.io/sandbox`)
- **Sibling GPU Training Repository:** `c:\Users\GEYE ARDIANSYAH\Downloads\Innovation Hub\MLE`

---

## 1. Executive Context & Why This Overnight Session Exists

Across our two rounds of peer-review hardening (from both Gemini and Claude reviewers) on the three **Versieve** MLSys-formatted papers in `paper/`:
1. **Paper 1:** [versieve-extraction-redaction-benchmark.pdf](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/paper/versieve-extraction-redaction-benchmark.pdf) (*Deterministic Document Extraction, Data Redaction, and Conformal Gatekeeping*)
2. **Paper 2:** [versieve-multimodal-sanitization-benchmark.pdf](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/paper/versieve-multimodal-sanitization-benchmark.pdf) (*Versieve-MM: Zero-Import WASM Multimodal Sanitization, Hybrid Neural NER, and Cross-Modal GDPR Erasure*)
3. **Paper 3:** [versieve-local-training-benchmark.pdf](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/paper/versieve-local-training-benchmark.pdf) (*Benchmarking Sanitized Data for Local Open-Weight Model Training and Retrieval*)

The systems engineering and external baseline comparisons (`TAB` $N=1,268$ ECHR court cases, Microsoft Presidio `en_core_web_lg` + custom code regex, `Gitleaks v8.30.1`, Yelp `detect-secrets v1.5.0`, `faster-whisper base.en/small.en`, `124,750`-pair PPRL scale test, and 6-model RTX 4070 evaluation) are now verified and reproducible.

**However, the core critique from reviewers remains:**
> *"Individually, the components (standard IID LTT, GLiNER, NFKC, Bloom filters, Carlini exposure, PPR) are established. If you want Versieve ('Perceive-Everything') to stand as a true research contribution—similar to how Baidu's `Unlimited-OCR` introduced `SR-SWA` (Sparse Reference Sliding Window Attention) on top of a VLM backbone to solve unbounded multi-page context—you need a rigorous theoretical framework and genuinely novel algorithms proved on the real datasets, not just a synthetic prototype."*

In commit `b0b9c40`, we scaffolded an initial prototype in [src/perceive.js](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/src/perceive.js) (`perceive`, `perceiveMulti`, and `runGraphCoupledConformalRedaction` / `GC-CRC`) and a synthetic 60-case probe ([scripts/eval-gccrc-benchmark.mjs](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/scripts/eval-gccrc-benchmark.mjs)). **Your overnight mission is to replace ad-hoc heuristics with a rigorous, mathematically grounded theoretical framework and prove it empirically on our real public benchmarks (`TAB`, `FUNSD`/`PubMedQA`, `Whisper` Audio, and the 3-model RTX 4070 training suite).**

---

## 2. Recommended Skills & Workflows for the Next Agent

Before writing code, the incoming agent should invoke the following installed skills (located in `c:\Users\GEYE ARDIANSYAH\Downloads\Innovation Hub\Rtio\.agents\skills\` and `.agents\skills\`):

1. **`research`** (`Rtio/.agents/skills/research/SKILL.md`):
   - Conduct primary-source literature & code research on:
     - **Hierarchical / Clustered Conformal Prediction & Conformal Risk Control** (Angelopoulos et al. 2022 *Conformal Risk Control*; Lee et al. 2023 / Dunn et al. *Hierarchical / Clustered Conformal Prediction* for non-IID grouped paragraphs; Ramdas et al. 2023 *Game-Theoretic Statistics and Safe Anytime-Valid Inference / E-Processes*).
     - **Sparse Reference Memory in Long-Horizon Perception** (`baidu/Unlimited-OCR` & `Unlimited-OCR-2` `SR-SWA` architecture; streaming state-space entity tracking).
     - **Token-Level Loss Decoupling & Privacy-Preserving SFT** (Lukas et al. 2023 *Analyzing Leakage of PII in Language Models*; Tan et al. 2025 *LoRA Memorization*; selective token loss masking / ghost tokens).
2. **`grill-me` / `grill-with-docs` / `to-spec`** (`Rtio/.agents/skills/grill-with-docs/SKILL.md`, `to-spec/SKILL.md`):
   - Stress-test each mathematical definition and experimental design against the reviewer critiques in [docs/CLAIM-AUDIT-AND-MOAT-ANALYSIS.md](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/docs/CLAIM-AUDIT-AND-MOAT-ANALYSIS.md) before locking the spec.
3. **`prototype` & `tdd`** (`Rtio/.agents/skills/prototype/SKILL.md`, `tdd/SKILL.md`):
   - Follow strict Red $\rightarrow$ Green TDD in `test/track-e-multimodal-enterprise.test.js` and `rust/versieve-media/src/lib.rs`.
4. **`rag-eval`** (`Rtio/.agents/skills/rag-eval/SKILL.md`):
   - Evaluate downstream retrieval & QA impact on the frozen 50-question held-out and 20-question seen-document compliance suites.
5. **Clean-Room Binary & WASM Kernel Engineering**:
   - When optimizing or porting perception primitives into `rust/versieve-media` (`versieve_media.wasm`), inspect binary table layouts and operator hot loops cleanly while **never** mentioning any internal reverse-engineering tool names in any public repository file (`.md`, `.tex`, `.js`, `.ts`, `.rs`).

---

## 3. Three Pillars of Genuine Theoretical & Algorithmic Novelty to Execute Overnight

### Pillar 1 (Papers 1 & 2 — Statistical Theory): Hierarchical Cluster-Robust Conformal Risk Control (`HC-CRC`) & Anytime-Valid Streaming E-Processes (`E-LTT`)

#### The Reviewer Critique to Solve
In Paper 2 (`Section 4.2`), when standard Learn-Then-Test (LTT) is calibrated on `1,999` `TAB` ECHR paragraphs, empirical false-release rate at $\alpha = 0.10$ overshoots to `11.2%` because **paragraphs inside the same court judgment are not IID exchangeable**—if a rare entity format is missed in paragraph 1 of a ruling, it is missed in paragraphs 2–15 of the same ruling.

#### Theoretical Framework & Implementation Plan
1. **Formulate Document-Clustered Conformal Risk Control (`HC-CRC`):**
   - Let $D_1, \dots, D_M$ be $M$ exchangeable documents (or meeting recordings), where document $D_m = \{c_{m,1}, \dots, c_{m,N_m}\}$ contains $N_m$ arbitrarily correlated blocks across text, audio, and video.
   - Define the **cluster-weighted non-conformity loss** at threshold $\lambda$:
     $$L_m(\lambda) = \frac{1}{|U_m|} \sum_{c \in U_m} \mathbb{I}\bigl[\hat{S}_{\text{GC}}(c) \ge \lambda\bigr] \in [0, 1]$$
     where $U_m \subseteq D_m$ are the ground-truth unsafe blocks in document $D_m$.
   - Because $L_1(\lambda), \dots, L_M(\lambda) \in [0,1]$ are bounded and **exchangeable at the document cluster level**, apply the finite-sample **Bentkus / Hoeffding-LTT upper confidence bound** $p_{\text{cluster}}(\lambda)$ over documents $m \in \mathcal{I}_{\text{cal}}$ (plus compare against sequential **Ville's Inequality Betting Martingale / E-Process** $E_t(\lambda) = \prod_{m=1}^t (1 + \eta ( \alpha - L_m(\lambda) ))$ for streaming 3-hour meetings).
2. **Real Dataset Experiment (`TAB` $N=1,268$ ECHR Court Cases):**
   - Implement `HC-CRC` in [src/gatekeeper.js](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/src/gatekeeper.js) and [scripts/tab-node-helper.mjs](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/scripts/tab-node-helper.mjs).
   - Run the head-to-head comparison on the real `TAB` corpus (`Naive Paragraph-IID LTT` vs. `Document-Clustered HC-CRC` vs. `Streaming Martingale E-LTT`) across $\alpha \in \{0.01, 0.02, 0.05, 0.10, 0.15, 0.20\}$ and prove empirically that `HC-CRC` eliminates the intra-document correlation FPR overshoot while preserving safe yield!

---

### Pillar 2 (Paper 2 & Core Rust/WASM Engine): `SR-MP` (Sparse-Reference Multimodal Perception) Tested on Real `TAB` & Real Whisper Audio

#### The Problem with the Current Prototype
Currently, `runGraphCoupledConformalRedaction` in [src/perceive.js](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/src/perceive.js) was only benchmarked on the 60-case synthetic script ([scripts/eval-gccrc-benchmark.mjs](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/scripts/eval-gccrc-benchmark.mjs)) and runs in JavaScript rather than inside the zero-import `versieve_media.wasm` kernel.

#### Theoretical & Systems Plan
1. **Compile the Fixed-Capacity `SR-MP` Reference Sketch Ring into `rust/versieve-media` (`versieve_media.wasm`):**
   - Inspired by `baidu/Unlimited-OCR`'s `SR-SWA` (which keeps a bounded $K=512$ reference pool so memory is $O(1)$ regardless of document length), add a zero-allocation `512`-slot **Salted Reference Sketch Ring** directly inside `rust/versieve-media/src/pii_secrets.rs`:
     - Each slot (`32 bytes` $\times 512 = 16\text{ KB}$ static buffer) stores `(u128 bloom_bits, u32 phonetic_code, u16 entity_id, u16 block_idx, u16 confidence_q15, u16 flags)`.
     - Export `vs_media_srmp_reset()`, `vs_media_srmp_seed_anchor()`, and `vs_media_srmp_couple_candidates()` from `versieve_media.wasm` (keeping `0` host imports and `< 200 KB` binary size!).
2. **Prove `SR-MP` on Two Real Benchmarks (Zero Synthetic Saturation):**
   - **Benchmark A — Real `TAB` ECHR Multi-Paragraph Court Rulings (`scripts/run-reviewer-tab-and-ltt.py`):**
     - In `TAB`, each court ruling has 10–50 paragraphs where the applicant, judges, or relatives are introduced with full context in early paragraphs and referenced by bare surname or OCR-variant spelling in later paragraphs.
     - Run `Stage 3A + Stage 3B GLiNER + SR-MP` across the full threshold sweep $\tau \in \{0.20, 0.25, 0.35, 0.50, 0.70\}$ on the real `TAB` test split and plot the new **4th PR curve** in `fig_e1_tab_pr_and_gt_ltt.pdf` against Microsoft Presidio (`en_core_web_lg` + Custom Code), vanilla GLiNER, and isolated Hybrid!
   - **Benchmark B — Real 25-Call End-to-End `faster-whisper` Audio Benchmark (`scripts/run-reviewer-secrets-audio-pprl.py`):**
     - Seed the `SR-MP` Reference Sketch Ring from the call's companion metadata/context (or first high-confidence mention) and measure the exact reduction in `faster-whisper small.en` attacker residual leakage (`20.62% -> target < 12%`) when `SR-MP` phonetic coupling silences ASR-corrupted names (`"Elena Vans"`, `"Marcus Torn"`).

---

### Pillar 3 (Paper 3 — Local LLM Training): Privacy-Token Loss Masking (`PT-LM`) & Grammar-Preserving Surrogate SFT

#### The Reviewer Critique to Solve
In Paper 3 (`Table 3`), fair-shot `T2-Chat Safe` LoRA scored **lower than the untouched Base model even on seen training documents** (`Qwen2.5-1.5B`: `7.5%` vs. `32.5%` blinded judge) because:
1. Training causal LM cross-entropy loss directly on `<PII:PERSON_01>` tokens caused the LoRA adapter to **hallucinate/echo `<PII:...>` tags in `13/20` (`65%`) of seen-document answers**!
2. Adding `10%` ungrounded abstention turns caused the closed-book adapter to **over-refuse `19/40` (`47.5%`) of in-scope questions**.

#### Theoretical Framework & Implementation Plan
1. **Derive the Subspace Hijacking Effect of Redaction Placeholder Tokens:**
   - Show mathematically why replacing diverse natural-language proper nouns (high entropy, spread across vocabulary $V$) with a small set of deterministic bracket tokens `<PII:PERSON_01>` concentrates gradient energy $\nabla_W \mathcal{L}_{\text{CE}}$ onto the bracket tokens, shifting their unconditioned logits by $+\Delta z$ and causing autoregressive decoding to fall into `<PII:...>` attractors.
2. **Implement Two Principled Training Algorithms in `src/perceive.js` & `src/graph-sft-builder.js`:**
   - **Algorithm 3A — `PT-LM` (Privacy-Token Loss Masking):**
     - During SFT tokenization, identify every token span belonging to `<PII:...>` or `<SECRET:...>` in the assistant response and set `labels[t] = -100` (masked from cross-entropy loss while remaining in the conditioning context $y_{<t}$, or replaced by a type-consistent surrogate token whose loss is masked).
     - Result: The model receives **zero gradient** pushing it to emit `<PII:...>` tokens at inference time, while **zero raw PII ever enters the forward or backward pass** (so Carlini $20\times$-canary exposure remains at the baseline floor of `2.70–3.32` bits!).
   - **Algorithm 3B — Contrastive Evidence-Conditioned Abstention (Fixing Over-Refusal):**
     - Instead of training closed-book abstention turns that teach the model to guess *"Not covered"* whenever a question looks hard, pair every in-scope training turn with a positive vs. negative anchor cue so in-scope false refusal drops from `47.5%` (`19/40`) to `< 10%`.
3. **Run the Live RTX 4070 Ablation & Cross-Family Judge Verification:**
   - Train `T2-Chat-PTLM` (`Qwen2.5-0.5B`, `Qwen2.5-1.5B`, `LFM3-1.7B`) on the 8 GB RTX 4070 Laptop GPU (~15 minutes total across the 3 adapters).
   - Measure:
     1. `<PII:...>` tag echo rate on `seen_20q` (`65.0% -> target 0.0%`) and `held_50q` (`22.5% -> target 0.0%`).
     2. Seen-document factual recall (`seen_20q`) and held-out compliance QA (`held_50q`).
     3. Carlini $20\times$-canary exposure ($N=1,000$ decoys, verifying privacy protection is 100% preserved).
     4. Grade with both local `qwen2.5:7b` AND a **cross-family judge** (`llama3.2:3b` / external Gemini judge rubric) to eliminate same-family judge bias!

---

## 4. Exact Execution Checklist for the Overnight Agent (In Order)

- [ ] **Phase 1 — Literature & Theoretical Formalization (`research` + `to-spec` skills):**
  - Write formal mathematical propositions and proofs for `HC-CRC` (Document-Clustered Conformal Risk Control), `SR-MP` (Sparse-Reference Multimodal Perception in $O(1)$ memory), and `PT-LM` (Privacy-Token Loss Masking) in `docs/2026-11-24-perceive-everything-theoretical-framework.md`.
- [ ] **Phase 2 — Zero-Import Rust→WASM `SR-MP` Kernel Upgrade (`tdd` skill):**
  - Implement the `512`-slot (`16 KB`) Salted Reference Sketch Ring inside `rust/versieve-media/src/pii_secrets.rs`, recompile `vendor/wasm/versieve_media.wasm` (verify `imports.length === 0` and `< 200 KB`), sync to `Rtio/frontend/public/wasm/versieve_media.wasm`, and wire into `src/perceive.js`.
- [ ] **Phase 3 — Real Benchmark Execution for Pillar 1 (`HC-CRC`) & Pillar 2 (`SR-MP`):**
  - Run `HC-CRC` and `SR-MP` on the real `1,268`-doc `TAB` ECHR corpus (`python scripts/run-reviewer-tab-and-ltt.py`) and the `25`-call `faster-whisper small.en` audio benchmark (`python scripts/run-reviewer-secrets-audio-pprl.py`).
  - Regenerate vector figures (`python paper/figs/build_track_e_figures.py`).
- [ ] **Phase 4 — Real RTX 4070 Training Execution for Pillar 3 (`PT-LM`):**
  - Run `PT-LM` assistant-masked LoRA fine-tuning across `Qwen2.5-0.5B-Instruct`, `Qwen2.5-1.5B-Instruct`, and `LFM3-1.7B-Base` in `MLE`, evaluate on `held_50q` + `seen_20q` + Carlini $N=1,000$ canary exposure + cross-family judge, and regenerate `fig2-track-d-results.pdf`.
- [ ] **Phase 5 — Recompile All 3 MLSys Papers & Sync `README.md`:**
  - Update and recompile:
    - `paper/versieve-extraction-redaction-benchmark.pdf`
    - `paper/versieve-multimodal-sanitization-benchmark.pdf`
    - `paper/versieve-local-training-benchmark.pdf`
  - Run `npm run test:ci` (`107+` tests), `npm run audit-wasm`, and `Rtio/frontend` `npm run build` + `9/9` browser unit tests, then commit and push to `main`.

---

## 5. Toolchain & Environment Reference on This Machine

- **Rust / WASM Toolchain (PowerShell):**
  ```powershell
  $env:RUSTUP_HOME="D:\mle-ticket03-tools\rustup"
  $env:CARGO_HOME="D:\mle-ticket03-tools\cargo"
  $env:PATH="D:\mle-ticket03-tools\cargo\bin;$env:PATH"
  cargo build --manifest-path rust/versieve-media/Cargo.toml --target wasm32-unknown-unknown --release
  ```
- **Verification Suite:**
  ```powershell
  npm run test:ci
  node bin/versieve.mjs audit-wasm
  node --test test/t9-portable-benchmarks.test.js test/track-e-multimodal-enterprise.test.js
  ```
- **Hygiene Guardrails:**
  - Never hardcode `C:/Users/...` paths in `src/`, `scripts/`, `test/`, `bin/`, or `demo/` (`test/t9-portable-benchmarks.test.js` enforces this).
  - Never mention internal reverse-engineering tool names in any public repository file (`.md`, `.tex`, `.js`, `.ts`, `.rs`).
