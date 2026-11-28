# W5 Execution Plan: quantized export, OOD routing, conformal abstain (#45) — 2026-11-28

Engineering plan derived from the W5 handoff plus a full infra survey.
Design decisions are binding unless the founder overrules them.

## Binding decisions

1. **Artifact format: ONNX, single file.** The bitnet/transformer kernels in
   `versieve_dl.wasm` are a scratch-model family (hash embeddings, ternary
   weights) and cannot host the MiniLM specialist, so a new WASM binary is
   out. The ticket wording sanctions ONNX, and the house fail-closed runtime
   precedent is `src/neural-pii-onnx.js` (dynamically imported
   `onnxruntime-node`, typed `NER_WEIGHTS_REQUIRED` / `NER_RUNTIME_REQUIRED`
   errors, runtime not a committed dependency). No new WASM binary ships, so
   `audit-wasm` stays green unchanged and the zero-import invariant is
   untouched. The single `.onnx` file carries everything in
   `metadata_props`: tokenizer JSON, the kNN OOD bank, conformal thresholds,
   and the manifest with sha256 digests. Loadable in Node via
   `onnxruntime-node` and in the browser via `onnxruntime-web`.
2. **QAT recipe: heads-only, fake-quantized frozen base.** The W4-v4 base is
   frozen (manifest `learningRateBase: 0.0`). For each bit width in {2, 3, 4}
   the base weights get per-channel fake quantization at that width and the
   heads retrain on the v4 48k pairs under the fake-quant base (default 3
   epochs, head lr 1e-3, seed 20261127). Heads export at int8.
3. **Ship level vs ablate level.** ORT supports int8 dynamic quantization and
   4-bit MatMulNBits. 2- and 3-bit have no ORT runtime: they are ablated for
   quality in torch only and reported honestly as quality-only rows. The
   shipped candidate is the 4-bit artifact; int8 is measured as the
   upper-bound reference.
4. **Judge reference for H5** (`results/weft-baselines.json`, local LLM
   judge): Qwen2.5-0.5B-Instruct, pairwise F1 0.6667, 691.6-877.3 ms/pair.
   So H5 concretely: quantized pairwise F1 at or above 0.600 (90% of 0.6667),
   latency at or below 13.8 ms/pair, artifact under 30 MB. All three
   measured, reported including failures.
5. **kNN OOD tripwire.** Embed the v4 train anchor sets with the frozen fp32
   base, compress with k-means (k = 1024, seed 20261127) to int8 centroids
   plus per-centroid scales, and calibrate a cosine-distance threshold on
   the v4 eval (in-coverage) against the unseen-voice sample. The bank and
   threshold travel in the artifact metadata. Out-of-coverage means abstain
   or route to human review, never cosine (measured live-blind at
   0.5304-0.5481).
6. **Conformal abstain stays in-domain and score-level.** The v4 eval splits
   (seed 20261127) into calibration and test halves. The Learn-Then-Test
   rule is the existing one: sweep thresholds, accept the highest-coverage
   threshold with `binomCdf(k, n_cal, alpha) <= delta`, alpha in {0.05,
   0.10}, delta 0.05; fail closed to threshold null, coverage 0 when no
   threshold certifies (the shootout already fails closed this way). Claims
   stay application-level; prior art, no new calibration method.
7. **Masked robustness moves to measurement.** The pair compiler already
   emits `identity-masked-positive` rows; a masked eval set built with the
   existing flags scores through the quantized model, closing the W4 gap or
   recording an honest negative.

## New and touched files (disjoint write scope)

- New: `scripts/export-weft-quantized.py` (QAT, export, calibrate, measure;
  `--mode plan` and `--emit-kaggle-notebook` run without torch so CI can
  exercise them; typed fail-closed errors, exit 2, JSON stderr line, per
  the `train-weft-specialist.py` pattern).
- New: `test/weft-export-failclosed.test.js` (mirrors the contract-test
  family: missing weights produce a typed error and write nothing, plan
  pins digests, notebook pinned, ledger append-only, banned-word sweep).
- Append-only: `results/weft-export-latency.json` (new ledger, kind
  `weft-export-latency`, one entry per bit width per run: artifact size and
  sha256, pairwise F1, conformal certification, latency and peak RSS).
- `package.json` test:ci list gains the new test.

## Error codes (fail-closed contract)

`WEFT_WEIGHTS_MISSING`, `WEFT_EXPORT_DATA_MISSING`, `WEFT_QUANT_UNSUPPORTED`,
`WEFT_ONNX_RUNTIME_MISSING`, `WEFT_LEDGER_INCOMPATIBLE`; exit 2, last
stderr line `{error, detail, kind: "weft-export-error"}`.

## Run sequence

1. Local: script + test land on branch `w5-quantized-export`; contract
   tests and the full suite green; plan mode and notebook emission verified.
2. GPU window (Kaggle 2x T4, notebook `w5-quantized-export` v1): QAT at
   2/3/4-bit, per-level eval, ONNX export + quantization, OOD bank build,
   conformal calibration, ledger entries from the GPU box (marked device).
3. Local clean-runtime pass: download artifacts into `models/` (gitignored),
   run `--measure-artifact` on this CPU box for honest latency/RSS numbers,
   verify fail-closed behavior with weights absent, record digests.
4. Docs and ledgers updated; PR; judge verification gate (clean-runtime
   load, `audit-wasm` green, full suite green).

## Honest-reporting reminders

Word ban in force; identity-orthogonality is "identity-blind"; no em-dashes
in prose; conformal claims application-level only; 2/3-bit rows are labeled
quality-only when no runtime can execute them; H5 failures are recorded,
not massaged.
