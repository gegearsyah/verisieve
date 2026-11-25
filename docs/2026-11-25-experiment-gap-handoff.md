# Handoff: the four experiment gaps after the review round

Date: 2026-11-25
Repository: `gegearsyah/verisieve`, commit `1e35603` plus the uncommitted paper revisions in `paper/`
Scope: produce the four missing measurements, then update the papers and change logs. No redesign, no new claims.

## State

All four manuscripts have been revised through the five-seat review and compile cleanly. Every gap answerable from the repository is closed: artifact paragraphs name commit `1e35603`, kernel sizes and SHA-256 prefixes, checkpoint and judge identifiers, training seed 42, and TAB resampling settings. The remaining gaps are measurements that do not exist in `results/` and cannot be derived from it.

Read these before touching a paper:

- `paper/review/EDITOR-RULINGS.md` is binding on titles, voice, numbers, and companion citations.
- `paper/review/A-extraction-redaction-changes.md` and the B, C, D change logs carry each paper's `Unresolved` list.
- `paper/review/A-extraction-redaction-review.md` and the B, C, D reviews carry the finding identifiers used below.
- `docs/agents/issue-tracker.md` for how a run should be filed.

## Ground rules

1. Never invent a number. If a run cannot complete, leave the gap open and say so.
2. Preserve every measured value already printed. A new run adds a row or a sentence; it does not overwrite an old one.
3. Style rulings apply to README and docs as well as papers: no LaTeX `---` em-dashes, no meta-commentary, each boundary stated once.
4. Update the paper section, the matching change log, and `npm run test:ci` output in the same change. The number-check chain in `scripts/check-paper-numbers.mjs` must stay at 0 failures.
5. Do not promote an upper bound to a deployment claim. Paper B's 81.7% is conditional on a correctly resolved identity until the router arm below exists.

## 1. Paper A: external NER baseline (review R5)

Question: what do Presidio and GLiNER-Edge recall on the same 500 `ai4privacy-200k` records and the same 580 scored spans the regex layer is measured on?

Why it matters: the paper's recall ceiling is scoped to "format-validated regex." Without an external row the reader cannot tell whether 31.0% all-tag recall is a regex limit or a task limit.

Runner: extend `scripts/run-scale-benchmark.mjs`, which already loads the 500 records and computes the 26-tag denominator. Add a Presidio arm and a GLiNER-Edge arm behind a flag; keep the existing path byte-identical.

Acceptance: 500 records, 580 spans, same 26 tags. Report precision, recall, and a 95% interval per arm. Name the model version and the spaCy pipeline. Add one row to the Paper A table and one sentence to Section 5.3.

Environment: `presidio-analyzer`, `spacy`, `en_core_web_lg`, and the GLiNER runtime are absent from the current shell. Run on the host that produced `results/scale-and-paradigm-benchmark.json`.

## 2. Paper B: end-to-end router on the engine's own resolution (review DA1)

Question: what does per-question cache routing answer when the engine resolves identity itself, rather than receiving manifest-resolved entities?

Why it matters: the measured 81.7% routing arm answers given a correct resolution. Section 7 now calls it an upper bound. The deployment number requires the resolver in the loop.

Runner: `scripts/run-track-k-composition-head-to-head.py` already has `retrieval` (manifest resolution, Graph-PPR contexts) and `base`. Add a `retrieval_engine` arm that builds contexts from `buildAmnesiacCorpus` entity ids produced by the engine, then answers with the same prompt, model, budget, and judge protocol.

Acceptance: 60 manifest questions, the same 24/24/12 strata, same token budget, both judges. Report exact match overall and by stratum, plus the same McNemar or permutation test used for the other arms. Keep the 81.7% row and relabel it as the conditional upper bound; the new row is the measured router. Do not compare the two rows without naming the condition.

GPU: 8 GB RTX 4070 Laptop or equivalent, `torch`, `transformers`, `peft`, local Ollama for judges.

## 3. Paper C: masking-only ablation (review R4, the PT-LM bundle)

Question: how much of the PT-LM effect comes from backward loss masking alone, with no forward surrogate substitution?

Why it matters: the paper attributes the effect to a masking-plus-substitution bundle and says a masking-only run is unavailable. One run per model closes the attribution.

Runner: `scripts/run-track-d-fair-lora.py`. Add an arm that trains on the Safe corpus with `labels[t] = -100` on placeholder spans and no forward substitution. Run the three models at the main 80-step recipe with seed 42, then evaluate with the existing seen-document F1, tag-echo, false-refusal, and canary probes.

Acceptance: a third column next to Safe and PT-LM in Table 2 or a sentence in Section 4.2 and the limitations. If masking alone recovers most of the effect, say so and narrow the bundle claim. If it does not, the bundle stands.

GPU: same 8 GB host. Three training runs plus evaluations.

## 4. Paper D: guarantee baseline and the tau=0.70 interval (reviews DA-3, ME-7)

Two independent items.

(a) Guarantee-based hierarchical baseline: run the Dunn et al. two-layer split on the same 67 calibration and 127 held-out rulings, with the same alpha grid. Report FPR and Safe Yield next to HC-CRC. The paper currently calls HC-CRC a conservative heuristic. This row is the comparison that statement needs.

(b) tau=0.70 SR-MP F1 interval: `results/reviewer-tab-and-ltt-benchmarks.json` stores point estimates, not the per-document TP/FP/FN arrays. Re-run the tau=0.70 arm in `scripts/run-reviewer-tab-and-ltt.py` with seed 42 and 1,000 bootstrap resamples, write the per-document arrays to the artifact, and fill the `--` placeholder in Table 1.

Acceptance: both rows in the artifact and the paper; the placeholder disappears; the 5,000-permutation count already printed at Fig. 1 stays.

Also record, while in that runner: per-corpus licenses and the non-TAB seeds. The change log lists them as unrecorded.

## Environment

The current shell has Python 3.12 with matplotlib and Pillow, but no `torch`, `transformers`, `peft`, `datasets`, `presidio`, `spacy`, or `gliner`, and no GPU. The host that produced `results/` is required for every item above. Start each runner with `--help` and use the flags printed there; the defaults target the original artifact paths.

## Suggested skills

- `orx-experiment-tree` to register each run and its parent artifact before launching.
- `orx-results` to write result JSON with seeds and resample counts.
- `orx-figures` and `orx-paper` for the table or figure change.
- `mattpocock-skills:tdd` for a small runner test that pins the new arm's input shape.
- `mattpocock-skills:code-review` before merging a runner change.
