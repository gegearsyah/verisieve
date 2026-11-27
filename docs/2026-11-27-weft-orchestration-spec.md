# Weft Implementation Orchestration Spec: ticket decomposition of #40

Date: 2026-11-27. Parent spec: https://github.com/gegearsyah/versieve/issues/40 (`ready-for-agent`). Research basis: `docs/research-notes/2026-11-26-tiny-theme-linker-research.md` (H1-H9, phasing P0-P5) and `docs/research-notes/2026-11-27-weft-novelty-recheck-and-licence-audit.md` (verified novelty re-check, licence audit, H2 redefinition).

This doc decomposes #40 into 7 granular tickets (W1-W7) ready to publish as GitHub sub-issues with `ready-for-agent` and native `blocked_by` edges. It does not duplicate #40's 38 user stories; each ticket states which of them it delivers. Each ticket body below is the issue text, in the established T11/T12 format.

## Problem Statement

Issue #40 is a parent spec, too coarse for a single swarm worker. Its phasing (P0-P5) has hard gates, GPU-dependent stages, and one stage that must not start until T11/T12 land. Concurrent agents (T11/T12 in another orchestration) own the GPU window and are modifying the benchmark harness and the empirical-validation territory, so the Weft track needs disjoint write scopes, explicit dependency edges, and judge gates per ticket.

## Solution

Seven tickets with disjoint write scopes, three of which (W1, W2) can start immediately on CPU without touching anything T11/T12 own. The Lead Judge (orchestrator model) decomposes, dispatches workers at the cheapest capable tier (DeepSeek/Haiku), verifies every ticket independently, and holds commits until each gate is green. Theme-node integration into the estate seam (W6) is hard-blocked behind T11/T12 completion.

## Ticket DAG

```text
IMMEDIATE (CPU, disjoint from T11/T12 — can start now)
  ├── W1  Benchmark harness + baselines [CPU, fail-closed LLM judge]
  └── W2  Training-data compilation + licence audit [CPU, fail-closed teacher]
         │
GPU TRACK (queue behind T11/T12's GPU window)
  ├── W3  Train un-quantized specialist [GPU]  <-- blocked by W1, W2
  ├── W4  Ablative extras: adversary, set-conditioning, triangle, modality [GPU]  <-- blocked by W3
  └── W5  QAT export + conformal abstain [GPU]  <-- blocked by W4
         │
SEAM + RELEASE (strictly after T11/T12 land)
  ├── W6  Theme nodes in the estate seam + erasure re-proof [CPU]  <-- blocked by W5, T11, T12
  └── W7  Claim audit, model card, public release packaging [CPU]  <-- blocked by W6
```

As-built diagram of the shipped half (W1-W4; W5-W7 not shipped): `docs/architecture-weft-theme-linking.gif`, source `paper/figs/build_weft_architecture.py`.

## User Stories (delivered per ticket)

Coverage of #40's 38 stories: W1 delivers 28, 30, 31, 34; W2 delivers 29, 32; W3 delivers 36 (gate); W4 delivers 5, 6, 12 (mechanisms); W5 delivers 14, 15, 27, 28; W6 delivers 1-4, 7-13, 16, 17, 19; W7 delivers 33, 37, 38. Stories 18, 20-25 are covered across W5 (thresholds, aspect) and W6 (suggestions, audit trail); story 35 is delivered by W4's ablation matrix.

## Ticket bodies

### W1: Theme-linking benchmark harness and baseline shootout

Part of #40 (P0). Blocked by: none. Independent of T11/T12 (disjoint write scope, CPU).

**Scope**
1. Build the theme-linking benchmark runner over the synthetic noisy estate plus public CDCR slices (WEC-Eng/ECB+ via uCDCR formatting) with the three buckets: cross-department, cross-modality, identity-overlap vs identity-disjoint; leave-one-department-out and leave-one-modality-out splits.
2. Implement the baseline set in one harness: BM25; Model2Vec static embedding plus threshold (potion-base-32M); all-MiniLM-L6-v2 cosine; BERTopic-style clustering; a local LLM judge as upper reference (fail closed when the local runtime is absent, mirroring the T11 fail-closed pattern).
3. Metrics: pairwise P/R/F1, cluster metrics (B-cubed, CoNLL-style), false-merge rate and blast radius, abstain coverage at target error, per-bucket results, artifact size and latency.

**Write Scope (Disjoint)**
- New: `scripts/run-weft-baseline-shootout.py`, `test/weft-benchmark-and-baselines.test.js`
- Append-only: `results/weft-baselines.json`
- No edits to any file T11/T12 own; no edits to committed paper baselines.

**Acceptance Criteria**
1. Runner fails closed when optional runtimes are missing and records seeds, model digests, licences, and resample counts in every artifact.
2. Baselines reproduce on the synthetic estate; per-bucket numbers are written for every baseline including the static-embedding-plus-threshold competitor (the honest competitor the release gate is measured against).
3. Contract tests verify schema and the three buckets are observable behavior, not model internals.

**Judge Verification Gate**
- Contract test green; `npm run test:ci`, `node bin/versieve.mjs audit-wasm`, `node scripts/check-paper-numbers.mjs` all pass with 0 failures and no change to committed paper numbers.

### W2: Training-data compilation and licence audit gate

Part of #40 (P0). Blocked by: none. Independent of T11/T12 (disjoint write scope, CPU).

**Scope**
1. Licence audit artifact for every candidate source, verified from primary terms, before any corpus is compiled: WEC-Eng/ECB+/uCDCR constituents, Wikipedia dumps (CC BY-SA 4.0: record share-alike implications for the released dataset), Needle 3 (still unverified), and the chosen teacher. **Multi-News is excluded from the public training recipe** (verified non-commercial-only, bespoke LILY Lab agreement, no IP licence granted).
2. Pair compiler producing the three pair types from public linked structure plus synthetic multi-format estates: identity-masked positives, identity-matched theme-different hard negatives, identity-disjoint same-theme positives.
3. Synthetic estate generation via a **permissively-licensed open-weight LLM teacher only** (OpenAI-hosted teachers are barred by usage policy; verify each teacher's terms). ASR-noise, OCR-noise, and slide-fragmentation augmentation applied as text transforms.
4. Scale: ~50-100k labeled pairs for the first specialist; a small hand-checked evaluation slice.

**Write Scope (Disjoint)**
- New: `scripts/build-weft-training-pairs.mjs`, `test/weft-training-data-and-licence.test.js`
- Append-only: `results/weft-licence-audit.json`, `results/weft-training-pairs/` (JSONL)

**Acceptance Criteria**
1. Licence audit artifact is complete and green for every source actually used; any source failing audit is dropped and recorded as dropped.
2. The three pair types are present with known labels and verifiable provenance; no pair derives from a non-permissive source.
3. Live teacher generation fails closed when the local runtime is absent; fixture-based contract tests still pass.

**Judge Verification Gate**
- Licence audit artifact independently re-checked by the Judge against primary sources; contract test green; full suite green with no committed-baseline changes.

### W3: Train the un-quantized Weft specialist (no extras)

Part of #40 (P1). Blocked by W1 (harness), W2 (data), and the GPU window (queue behind T11/T12).

**Scope**
1. Train a ~20-35M attention-based text encoder specialist on W2's pairs: anchor-set plus candidate chunk interface, link logit, extractive evidence pointers, theme embedding. Contrastive loss with CrossCLR-style false-negative and hub handling. No adversary, no set-conditioning extras, no triangle term: this ticket establishes the bare-specialist bar.
2. Initialize from an existing small open encoder or distillation, never pretraining from scratch.
3. Evaluate through the W1 harness on identity-disjoint cross-department F1.

**Write Scope (Disjoint)**
- New: `scripts/train-weft-specialist.py`, `test/weft-specialist-contract.test.js`
- Append-only: `results/weft-specialist-training.json` (seeds, digests, hyperparameters)
- Model artifact stored outside `vendor/wasm/`; only its digest and size enter results.

**Acceptance Criteria**
1. Records exact seeds, base-encoder digest and licence, and training data digest.
2. Bare specialist beats the static-embedding-plus-threshold baseline on identity-disjoint cross-department F1, else the ticket reports the honest negative result and the release gate (story 36) is marked at risk.
3. Fails closed when GPU/training runtime is absent.

**Judge Verification Gate**
- Judge re-runs the evaluation through the W1 harness; contract test green; full suite green.

### W4: Ablative extras, one at a time

Part of #40 (P2). Blocked by W3, GPU window.

**Scope**
1. Add, one at a time with per-stage evaluation: (a) identity adversary, (b) set-conditioning over anchor sets, (c) triangle-consistency term, (d) modality-invariance term.
2. Identity-suppression decision experiment: gradient-reversal probe during training versus INLP-style post-hoc null-space projection on the exported encoder (both positioned against the verified prior art; INLP is the canonical linear-erasure baseline, nonlinear recovery is known).
3. **H2 redefined: the leak probe is a post-hoc classifier battery including nonlinear probes, never the in-training adversary alone.** Wording everywhere is "identity-blind", never "identity-removed", with the Elazar & Goldberg caveat quoted in the model card.
4. Hypotheses tested: H1 (adversary improves identity-disjoint F1), H2 (post-hoc probe accuracy near chance while link F1 holds), H3 (set-conditioning beats pair-only on bridged themes), H6 (triangle term reduces false-merge blast radius), H4 (FFN ablation).

**Write Scope (Disjoint)**
- New: `scripts/run-weft-ablations.py`, `test/weft-ablation-contracts.test.js`
- Append-only: `results/weft-ablations.json`

**Acceptance Criteria**
1. One addition per recorded stage; every stage reports honest deltas, positive or negative, versus the W3 bare specialist.
2. H2 probe battery includes post-hoc nonlinear classifiers; results reported even when they show leakage.
3. Fails closed without GPU; synthetic-fixture contract tests still pass.

**Judge Verification Gate**
- Ablation artifact sanity-checked by the Judge (stages actually independent); contract test green; full suite green.

### W5: Quantization-aware export and conformal abstain

Part of #40 (P3). Blocked by W4, GPU window.

**Scope**
1. Quantization-aware training to the 10-25 MB target (2/3/4-bit ablated); WASM/ONNX export as a single artifact loadable in browser or Node.
2. Conformal abstain calibrated with the existing Learn-Then-Test machinery; claim abstention at the application level only (conformally calibrated thresholds are prior art; no new calibration method is claimed).
3. Published latency, memory, and size numbers per quantization level; low-margin routing hooks to a larger local model or human review.
4. Fail-closed load when weights are absent (no silent degradation).

**Write Scope (Disjoint)**
- New: `scripts/export-weft-quantized.py`, `test/weft-export-failclosed.test.js`
- Append-only: `results/weft-export-latency.json`
- Any new WASM binary keeps the zero-import invariant and size ceilings.

**Acceptance Criteria**
1. H5 (at least 90% of the local LLM judge's pairwise F1 at most 1/50 latency, under 30 MB) and H7 (abstain holds false-merge rate under alpha with usable coverage) measured honestly, including failures.
2. Absent weights produce a typed error, never a fallback similarity.
3. Export artifacts hashed; digests recorded in results.

**Judge Verification Gate**
- Judge independently loads the exported artifact in a clean runtime and reproduces the fail-closed behavior; `audit-wasm` green; full suite green.

### W6: Theme nodes in the estate seam and erasure re-proof

Part of #40 (P4). **Blocked by W5, T11, and T12. Do not start while T11/T12 are in flight: this ticket touches the estate perception seam and the benchmark harness they are modifying.**

**Scope**
1. Extend the public estate perception call (the single confirmed seam) so its output gains theme nodes and links: members, anchor exemplars, evidence spans, score distributions, typed as graph nodes.
2. Deterministic, order-independent incremental agglomeration over Weft scores; assignment is a pure function of (corpus, model hash, policy version); policy version enters the engine hash and bumps the corpus version.
3. Erasure re-derives theme nodes and the verified byte-diff receipt still holds.
4. Identity and theme channels reported separately with an explicit disagreement report.

**Write Scope (Disjoint)**
- New: `test/weft-theme-nodes-and-erasure.test.js`
- Modified by role (not path): the estate perception output type, the erasure re-derive path, the engine hash inputs. Exact files agreed at dispatch after T11/T12 merge.
- No committed paper baseline changes.

**Acceptance Criteria**
1. Tests drive the seam and assert external behavior only: shared theme nodes, evidence spans within source items, abstain on ambiguous pairs, determinism across repeated runs and input orderings, erasure producing a verified diff.
2. Determinism verified across input orderings; corpus hash stable under re-runs.
3. All prior seam tests still green (no regression from the output-shape addition).

**Judge Verification Gate**
- Full suite, `audit-wasm`, and `check-paper-numbers.mjs` green with 0 failures; Judge re-runs the erasure diff personally.

### W7: Claim audit, model card, and public release packaging

Part of #40 (P5). Blocked by W6.

**Scope**
1. Model card with intended use, failure modes, calibration plot, and the **citation-and-differentiation table** covering, at minimum: Elazar & Goldberg 2018 and Coavoux et al. 2018 (adversarial removal limits), INLP and the nullspace-erasure line including diffusion-era extensions, Wang et al. AAAI 2020 (HIN adversarial identity linking with generated negatives), AspectSim and AspectCSE (aspect-conditioning), Conformal Abstention 2024 (calibrated thresholds), and the CDCR family (Barhom 2019, WEC 2021, uCDCR 2026) as benchmark substrate.
2. Literature re-check: full-text reading of the closest prior art plus the LEACE-for-multimodal-encoders sweep (open question 1 of the 2026-11-27 note) before any paper-level claim.
3. Release packaging: open weights, reproducible training recipe, the W1 benchmark, licence audit as the hard gate.
4. Wording compliance: no "first", no "eliminates", no "mathematically grounded"; theme linking positioning, never "perceive everything" or "atomic knowledge" framing; identity-blind, not identity-removed.

**Write Scope (Disjoint)**
- New: model card and release manifest alongside the W5 artifact; `results/weft-claim-audit.json`
- Paper edits are out of scope unless the founder explicitly opens a paper ticket.

**Acceptance Criteria**
1. Every external claim in the model card traces to a measured result or a verified citation; no claim of the conjunction's novelty beyond "not found in prior art as of this audit".
2. Release blocked if the specialist does not beat the size-matched static-embedding baseline on identity-disjoint pairs (story 36).
3. Benchmark released with per-bucket results for every baseline.

**Judge Verification Gate**
- Judge spot-checks citations against primary sources; banned-word sweep clean; full suite green.

## Testing Decisions

- **Single seam (confirmed with the founder in #40):** the public estate perception call. W6 is the only ticket that touches it; all other tickets test through their own runners and contract tests.
- A good test checks observable behavior only: theme membership, evidence spans within sources, abstain on ambiguous pairs, determinism across runs and orderings, erasure verified diffs, fail-closed behavior. Never model internals.
- Prior art for contract-test shape: the T-series pattern (synthetic fixtures, fail-closed prerequisites, append-only schema-validated artifacts, seeds and digests recorded).
- Model training is offline and outside the seam; only the exported artifact and its hash are consumed.

## Out of Scope

- Identity resolution changes; native audio/vision encoders, ASR, OCR improvements; generative chain-of-thought explanations; pretraining from scratch; a fixed theme taxonomy; hosted inference; Multi-News in the public recipe (licence-barred); OpenAI-hosted teachers (policy-barred); publishing any model derived from private customer data; paper edits (separate ticket if the founder opens one); any change to T11/T12 territory.

## Further Notes

- Worker tier: cheapest capable model per ticket (DeepSeek/Haiku); the orchestrator model judges and gates, never writes bulk implementation. Escalate one tier per failed attempt before declaring a ticket stuck.
- W1 and W2 are safe to dispatch immediately; W3-W5 need the GPU window after T11/T12; W6 strictly after T11/T12 land.
- Open founder decisions to surface at dispatch: GRL vs INLP (W4 runs both and decides on evidence); weights/dataset licence (recommend Apache-2.0 weights, dataset licence from the W2 audit); training compute source (recommend the existing 8 GB RTX window, small scale).
- Publication of W1-W7 as GitHub sub-issues under #40 with `ready-for-agent` and native `blocked_by` edges is the launch step; this doc holds the issue bodies.
