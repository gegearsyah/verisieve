# Versieve Upgrade Handoff v2: Relational Sample Composition (the "Knowledge Between All Data" Upgrade)

Supersedes v1 (same file, 2026-11-24). Authoring session 2026-11-24, branch `fix/spec-15-remediation`.
Built from the founder's two rulings this session — (1) the product is a training-data engine whose
core value must stand with all privacy machinery stripped away, and (2) mechanism-level novelty, not
gap-filling, is the bar — and from three completed research notes:
`docs/research-notes/2026-11-24-graph-grounded-corpus-novelty-research.md` (the schema bet),
`docs/research-notes/2026-11-24-relational-sample-composition-novelty.md` (**the mechanism — novel
as a mechanism**), and `docs/research-notes/2026-11-24-identity-contrastive-sft-novelty.md`
(partially crowded; capability survives). Extends the remediation handoff
(`docs/2026-11-24-versieve-novelty-and-remediation-handoff.md`), whose standing rules and open
stages (Stage 4 sweep, GPU ablation backfill, push-to-main gate) remain in force.

---

## 1. Standing Rules (binding)

All rules from the remediation handoff §1 apply. Deltas, in priority order:

1. **Privacy machinery is the default, quietly — never oversold (founder ruling, 2026-11-24,
   correcting this handoff's own earlier "mode/upsell" framing).** The vault (salting, masking,
   certificates, erasure receipts) is simply how the engine works by default: it is not a product
   tier, not an upsell, and never the pitch. There is ONE product — the genuinely useful
   training-data engine — and its privacy properties are stated once, plainly, where required
   (e.g. the enterprise paper), never marketed. The readable identity view exists as an explicit
   opt-in seam for training-data fidelity (users who want their model to learn real names from
   their own documents) and as the default arm for capability experiments; it is not a "general
   mode" product tier and copy must never frame modes/tiers. No "general mode vs private mode"
   anywhere in product copy or papers.
2. **The claim discipline for the novel mechanism.** "Graph-grounded SFT data" as a phrase is TAKEN
   (GraphGen 2505.20416 owns graph-neighborhood→SFT; EmbGen 2605.19394 owns entity-unit reassembly).
   The only defensible claim is the full conjunction: **deterministic composition of the actual
   source bytes of multiple heterogeneous documents into one training sample, selected by
   traversing the resolved entity graph, with canonicalized versioned policies** — the join IS the
   training unit. In the vaulted default this additionally carries provenance + erasure receipts;
   in the readable view the pitch is simply: sample boundaries follow knowledge structure, not
   byte position.
3. **The window is narrowing.** EmbGen (2026) is structurally halfway (entity units + reassembly,
   embedding clusters instead of a resolved graph, generated QA instead of real spans). Ship before
   the seam closes; re-check the citing literature the week of any submission; read EmbGen's full
   text before any paper-level claim against it (the current verdict is abstract-level).
4. **"Perceive everything" and "atomic knowledge" never enter a paper.** DocRED/cross-doc-coref/
   OpenIE own the capability framing; FActScore/GraphGen own the vocabulary. We claim the
   measurement families (identity-merge taxonomy, coverage K) and the mechanism (composition), not
   the adjectives.
5. **Every benefit claim is gated on measurement.** The multi-arm head-to-head (Stage K3) converts
   the founder's hypothesis into numbers per mechanism; a loss is a publishable result and
   re-scopes the paper — never smoothed. Without the head-to-head and the false-merge
   amplification experiment, the composition claim is a schema property, not a mechanism result.
6. **Any sample-schema extension re-issues the corpus** under a bumped `AMNESIAC_ENGINE_VERSION`
   (composition policies are versioned pure functions; policy versions enter the engine hash).
   Never mix receipts across versions. Erasure must be re-proven on the composed corpus, not
   inherited.
7. Citation pinning on `arxiv.org` only (snippet IDs failed verification 19/19 across this
   session's three hunts — 7 + 12 rejections, plus 4 agent seed-guess failures); binary-inspection
   tooling never named in any committed file; explicit-path commits, no `git add -A`, no push
   without the founder.

## 2. State at Handoff Time — verified 2026-11-24 (this session)

- Paper 4 committed (`59e4e06`); `check-paper-numbers.mjs` **793 checks, 0 failures**; `test:ci`
  green; `audit-wasm` allVerified. Stage 4 sweep running on GPU (6/18 combos at handoff-v2 time);
  GPU ablation backfill queued behind it; K3 queued behind both.
- The corpus seam: `buildAmnesiacCorpus(inputs, view)` / `eraseEntity` — deterministic, entity-indexed,
  byte-diff-verified erasure, per-sample certificates; 54/54 cross-department links and 16/16 GT
  people resolved on the synthetic estate (construction-validation).
- **Mechanism verdicts (the input to this plan):**
  - *Relational sample composition* — **novel as a mechanism**: no found artifact composes actual
    source bytes from multiple heterogeneous documents into one deterministic training sample
    selected via a resolved entity graph. Closest: GraphGen/EmbGen/KELM (synthesize), Multi-News
    (topic-clustered, synthetic targets, no identity), EAE/KEPLER (objective, not unit),
    Atlas/REPLUG (runtime conditioning, not a data artifact). Adversarial core: false-merge blast
    radius inverts (one wrong merge poisons every composed sample for that entity while erasure
    receipts stay clean); dilution, hub near-duplication, and masked-span compounding are
    unmeasured.
  - *Identity-contrastive SFT* — **partially crowded**: BLINK owns pairs-from-index, GENRE/EntGPT
    own ID-as-target, Ditto owns pair-training over records. Surviving conjunct: pairs compiled
    deterministically from the enterprise's own cross-modal resolved graph (SQL↔ASR↔email
    positives), with the erasure lifecycle coupling. Under the mode ruling, the capability claim
    defaults to readable IDs (which train better); the salt-rotation experiment (train salt-A →
    eval salt-B) becomes the private-mode cost measurement, pre-registered both ways.

## 3. The Upgrade, Framed (mechanisms, mode-first)

The founder's request — *"perceive everything, including the knowledge between all the data"* —
translates into one mechanism and one capability, both measured:

> **Relational sample composition (the mechanism, novel):** the corpus builder traverses the
> resolved entity graph and emits one sample per entity (and per cross-document fact) rendering all
> evidence about it — a SQL row, an email signature, a transcript utterance, a deck bullet — as ONE
> training sample with multi-source provenance. Cross-document facts become within-sample facts.
> Sample boundaries follow knowledge structure, not byte position: the mechanical antithesis of
> place-and-stitch. In the readable view the identity anchors are real names; in the vaulted
> default the same
> composition carries vault-salted IDs, certificates, and byte-diff erasure receipts.
>
> **Identity binding as a trained capability (the capability, secondary):** the entity index
> deterministically compiles contrastive pairs (cross-modal same-entity positives, same-class
> near-miss negatives); the model learns who it is talking about. Measurement — unseen-entity
> false-merge/false-split, negative-hardness sweep, salt-rotation (private-mode cost) — is the
> novelty, not the loss shape.
>
> **Measurement families (the benchmark layer):** cross-document identity-merge P/R/F1 with a
> false-merge/false-split taxonomy by surface-form difficulty, and knowledge-perception coverage K
> — % of manifest facts spanning ≥2 documents recoverable from perception output alone, at byte
> budget B, zero egress.

## 4. Stage Plan

Owners: lead + subagents (haiku default, sonnet on one failure, opus for hard problems); lead
verifies everything; subagent green reports carry no authority. One logical commit per stage,
explicit paths. K0–K2 are CPU and can run while the GPU queue drains; K3 needs the GPU.

**Stage K0 — The identity-view seam: readable opt-in over one engine (CPU)**
- What: extend the existing `view` parameter of `buildAmnesiacCorpus(inputs, view)` with
  `identity: 'readable' | 'vaulted'` (vaulted stays the default — privacy machinery is how the
  engine works, quiet, byte-stable; the readable view is an explicit opt-in for training-data
  fidelity, not a product tier). Readable view: entity anchors are the
  canonical resolved names, content is NOT masked, no certificate ceremony in the output — the
  user's own data, their own model, names and all. Vaulted: exactly today's behavior. The
  corpus stays a deterministic pure function of (inputs, view, engine version) in both views;
  the view itself is part of the view hash.
- Verify: TDD at the seam (red first): determinism in both views; `eraseEntity` byte-diff exact in
  both views (in the readable view erasure is still mechanical regeneration — no protection claim
  made or needed); readable corpus contains zero `<PII:…>`/`<SECRET:…>` placeholders;
  `npm run test:ci`; `audit-wasm` unchanged (pure JS, zero WASM bytes).
- Commit: `feat(corpus): general-mode view — readable identity, no vault ceremony` (landed as
  `362c890`, before the founder's no-tiers correction — the commit message keeps the old framing;
  the code is correct).
- GATE: when the readable view surfaces in the Rtio app UI as an opt-in — founder decides timing.

**Stage K1 — Relational sample composition (CPU; the novel mechanism)**
- What: composed-sample emitter in the corpus builder: traverse the entity index; for each entity
  (and each manifest cross-document fact / entity pair) emit one sample rendering its evidence
  blocks with a multi-source provenance list. **Policies are canonicalized pure functions** per the
  adversarial findings: evidence ordering = fixed by source byte offset; hub cap = deterministic by
  degree class; every policy version enters the engine hash (composition is a schema change —
  Standing Rule 6: version bump, receipt re-issue, erasure re-proven on the composed corpus).
- Verify: TDD: composed-sample determinism (two runs → identical bytes), erasure on composed
  corpus (delete a high-degree entity → exactly its spans retracted, all containing samples
  regenerated or retracted), provenance lists enumerate every contributing document, hub-cap
  determinism. Artifact: `results/composed-corpus-receipts.json`; needles in
  `check-paper-numbers.mjs`; `npm run test:ci`.
- Commit: `feat(corpus): relational sample composition — the join as the training unit`.

**Stage K2 — Identity-contrastive pair compiler (CPU; capability, readable-first)**
- What: deterministic pair compilation from the entity index: positives = two masked/plain records
  of the same entity across departments/modalities/surface forms; negatives = same-class near-miss
  pairs (homonyms, ASR/OCR variants, abbreviations) — the estate's difficulty knob (v1's Stage K2)
  feeds the negative-hardness bins. Targets are readable canonical IDs by default; a vaulted
  variant exists for the private-mode cost ablation only. Entity-disjoint holdout reserved at
  construction time (entities excluded from pair generation, mentions retained as context) — the
  unseen-entity split is designed before any capability claim is written.
- Verify: TDD: pair determinism, holdout disjointness CI assertion, anti-circularity (GT only in
  manifest/scorer). Artifact: `results/identity-contrastive-pairs.json`; needles; `npm run test:ci`.
- Commit: `feat(corpus): identity-contrastive pair compilation from the entity index`.

**Stage K3 — Multi-arm head-to-head on the same estate, same budget (GPU; the decisive experiment)**
- What: arms, all at **equal token budget**: (1) flat positional chunks, (2) per-block
  entity-indexed corpus (today's artifact), (3) composed corpus (K1), (4) composed +
  identity-contrastive pairs (K2), (5) **retrieval over the same entity graph at inference time,
  no fine-tuning** (the track-C Graph-PPR path; the graph may pay off more as a retrieval index
  than as a training format; this skepticism is on the record in Paper 4's claims section and
  its design cites in-context pretraining and knowledge-capacity results, both pinned), (6)
  **base model, no fine-tuning**. All training arms readable identity (the experiment default,
  and where the knowledge claim lives: the vaulted default masks loss on vault spans and can
  only claim lineage/erasure). Vaulted-cost ablation: one arm re-run on the vaulted
  default (salted IDs + masked spans) — the "what does privacy cost" measurement. Recipe: sealed LoRA r16/α32, steps/lr from the Stage 4
  sweep (record which combo). Eval, per the composition note §5: **closed-book multi-hop recall
  stratified by facts living in 1 vs ≥2 documents** (the direct test of the mechanism's
  hypothesis); blinded 0–2 rubric judging via the permitted judge path (DeepSeek swarm, sanitized
  outputs, canaries never leave; local-judge agreement column); fluency/interference probe
  (perplexity + placeholder-emission rate on held-out clean text); Carlini canary exposure per arm;
  effective learnable-token efficiency after masked spans.
- Verify: `results/track-k-composition-head-to-head.json`; needles; `npm run test:ci`;
  anti-circularity (eval questions manifest-authored).
- Report: per-arm win/loss/tie, verbatim, stratified. A composed-corpus loss re-scopes the paper to
  the measurement families — it is not smoothed.
- GPU queue: after the Stage 4 sweep and the ablation backfill. Abort: on VRAM conflict shrink
  steps (recorded), never the corpora.
- Commit: `feat(bench): multi-arm corpus composition head-to-head`.

**Stage K4 — False-merge amplification + failure modes (CPU+GPU; the honesty experiment)**
- What: the table a reviewer reads first (composition note §5.4): induced controlled false merges
  on an open-world estate variant; relational-fact corruption rate in composed vs per-block
  corpora — the amplification factor, quantified. Plus hub-duplication analysis (MinHash
  near-duplicate fraction of the composed corpus; entity-degree vs benefit curve; benefit
  saturation by degree k). Optional and only if the "no-synthesis advantage" is ever claimed:
  composed-real-bytes vs GraphGen-style synthetic verbalization at matched budget, judged for
  factual precision — otherwise do not claim the advantage at all.
- Verify: `results/composed-corpus-failure-modes.json`; needles; `npm run test:ci`.
- Commit: `feat(bench): composed-corpus failure modes — false-merge amplification + hub duplication`.

**Stage K5 — Benchmark families: identity-merge taxonomy + coverage K (CPU)**
- What: v1's K2+K3, mode-independent. (a) Cross-document identity-merge P/R/F1 with false-merge/
  false-split taxonomy by surface-form difficulty (estate difficulty knob; sub-100 rows by
  design — Standing Rule: no new all-100 table without a difficulty knob). **Scoring is pairwise +
  B-cubed precision/recall including false-merge rate, not exact-match-only** (external-critique
  adoption: 54/54 on planted values is exact matching, not resolution; the estate's own PPRL
  benchmark already measures 4.88% false links at dev threshold on 500 common names, and that
  regime is what K5 must measure). Noise set (adoption): typos, nicknames/abbreviations, shared
  inboxes, same-name collisions, stale records. **Generator-independence rule:** the noisy estate
  variant must not be authored by the same generator that defines the truth it is scored against,
  otherwise the benchmark is solved by construction again. (b) Knowledge-perception
  coverage K: % of manifest facts spanning ≥2 documents recoverable from perception output alone,
  at the shipped byte budget (387,267 B), zero egress, byte receipts. Score from perception output
  + existing sample fields only — no further schema change in this stage.
- Noisy-estate spec (2026-11-24, lead-authored, binding for the fixture build):
  `docs/2026-11-24-noisy-estate-benchmark-spec.md`. World-first generation (truth = frozen world
  model, documents = seeded noisy projections), spec-authored noise N1–N8 (typos/OCR, nickname
  table, initials, case/format, shared inboxes, 20 same-name collision pairs, stale records,
  cross-doc disagreement), ~115 text documents, Q1/Q2/Q3 eval strata (24/24/12), person-level
  pairwise + B-cubed scoring with false-merge/false-split and miss attribution by noise type,
  anti-circularity rules (no engine imports in the generator, no post-hoc truth adjustment,
  no tuning), and a binding trivial-baseline acceptance gate: exact-match must score pairwise
  recall <90% and commit at least one false merge on collisions, else the estate is not a
  benchmark. Feeds K4's open-world variant, K5's scorer, and K3's stratified eval.
- Verify: `results/crossdoc-identity-merge.json`, `results/knowledge-perception-coverage.json`;
  anti-circularity assertions; needles; `npm run test:ci`.
- Commit: `feat(bench): identity-merge failure taxonomy + knowledge-perception coverage K`.

**Stage K6 — Open-estate measurement (FOUNDER GATE before any real data)**
- What: one estate where truth is NOT by construction, run through K4+K5 metrics, failure cases
  published — the defense against the uniform-100 fixture-signalling liability, and the natural
  host for the false-merge experiment's open-world variant.
- Gate (founder chooses): public-data estate with independently known entity overlap /
  founder-supplied real documents (never leave the machine) / third-party synthetic with
  hand-verified truth.
- Verified open-data inventory (2026-11-24, primary sources, lead re-checked the load-bearing
  licenses): `docs/research-notes/2026-11-24-open-estate-dataset-hunt.md`. Short version: AMI
  Meeting Corpus (CC BY 4.0, direct download, the only verified corpus with real named-person
  identity linked across its own modalities), ICSI (CC BY 4.0 at the AMI host, ~70 h more),
  Enron (1.7 GB, no stated license: internal use fine, redistribution is a founder question),
  Stack Exchange (92.3 GB CC BY-SA 4.0 bulk). 8 GB is trivially reachable; what exists nowhere is
  ground-truth cross-corpus identity, so the recommended design is a layered estate: real-identity
  audio (overlay honestly impossible), overlay-synthesized identities on text/email/docs/
  spreadsheets (truth by construction), the two layers labeled separately in the manifest.
- Commit: `feat(bench): open-estate cross-document perception measurement`.

**Stage K7 — Benchmark packaging + baselines (FOUNDER GATES: cloud baseline, release)**
- What: package K3–K6 as a benchmark contribution: released fixtures, two baselines (one cloud LLM,
  one local pipeline), published failure cases. Cloud baseline = real egress; permitted only on the
  public-estate variant with founder approval, else it ships as a documented protocol others run.
- Commit: per piece.

**Stage K8 — Papers + product copy**
- What: Paper 5 — *"the join is the training unit"* (relational composition: mechanism, multi-arm
  results, false-merge amplification, honest boundaries; confronts GraphGen/EmbGen/Multi-News by
  name; artifact/datasets framing). Paper 4 §7.3 converts to the measured result once K3 lands.
  Product copy for Rtio: point it at your documents → training data that knows your world. The
  privacy properties are stated once, plainly, where required — never marketed, never tiered
  (Standing Rule 1). Word-ban grep now also covers
  "perceive everything", "atomic knowledge", and any receipt/salt ceremony in product copy beyond
  a single plain statement.
- Verify: `check-paper-numbers.mjs` green; papers recompile 0 errors/0 undefined; word-ban clean.
- Commit: `docs(papers): relational composition paper + honest multi-arm results` /
  `docs(product): copy`.

## 5. Skill Map

- `mattpocock-skills:tdd` — K0/K1/K2 seams (external-behavior-only tests at the corpus seam).
- `code-review` — before any substantial-diff stage lands (K1 emitter, K3 runner, K4 scorer).
- `dataviz` — before any figure (amplification factor, degree-vs-benefit curve, K(B)).
- `mattpocock-skills:research` / `grilling` — before any new claim enters a paper; the three notes
  above are the current prior-art baseline; re-run the citing-literature check the week of
  submission (EmbGen watch).
- Issue tracker — any K-stage spec too large for a bullet goes to `gegearsyah/verisieve` issues
  with `ready-for-agent`, linked from the run record.

## 6. Known Traps (remediation-handoff 1–12 all remain; additions)

13. **Schema extension = receipt re-issue** (composition included): bump `AMNESIAC_ENGINE_VERSION`,
    regenerate, never mix versions in one table.
14. **"Perceive everything" / "atomic knowledge" are occupied**; "graph-grounded SFT data" as a
    phrase is TAKEN (GraphGen). Claim the conjunction: deterministic composition of actual bytes.
15. **Snippet-surfaced arXiv IDs failed 19/19 across this session's hunts** (including one
    hallucinated paper cluster and 4 plausible agent seed guesses — e.g. K-Adapter's real ID is
    2002.01808, not 2002.08769). Pin via arxiv.org / export API only; maintain the rejection ledger.
16. **No new all-100 table without a difficulty knob.**
17. **GPU serialization**: Stage 4 sweep → ablation backfill → K3. One queue.
18. **Composition policies are versioned pure functions or determinism dies** (evidence ordering,
    hub cap, pair selection): every policy version enters the engine hash.
19. **False-merge blast radius inverts in composed corpora**: a wrong merge poisons every composed
    sample for that entity while erasure receipts stay clean — determinism masks graph
    incorrectness. The amplification experiment (K4) is mandatory before the mechanism claim ships;
    own it in the paper, don't hide it.
20. **Hub entities ⇒ near-duplicate composed samples**: cap policies fix skew but are discretionary
    knobs — canonicalize and version them (trap 18), and report learnable-token efficiency after
    masking, not per-sample counts.
21. **Masked-span fraction compounds in composed samples (the vaulted default)**: one entity's
    render mentions it in every block — the model can train mostly on placeholder-shaped context
    and emit `<PII:…>`-shaped filler. The readable view has no masking; measure the fluency probe
    per view.
22. **"It may only recreate RAG at train time"**: if the composed-corpus benefit vanishes whenever a
    retriever is available at inference, the mechanism is engineering overhead — the head-to-head
    must report the closed-book vs retrieval-available conditions.
23. **EmbGen (2605.19394) verdict is abstract-level**: full-text read required before any
    paper-level claim against it; the seam is being approached — urgency is real.

## 7. Founder Gates

| Gate | Status |
|---|---|
| Privacy machinery = default, quiet, never oversold; readable identity = explicit opt-in seam (not a product tier) | **SETTLED 2026-11-24 (founder ruling; corrected same day from the earlier "mode/upsell" framing)** |
| Readable-view surfacing in the Rtio app UI as an opt-in (timing) | **OPEN — Stage K0 output exists; founder decides when it ships to the app** |
| K3 head-to-head runs without further approval (judge path already settled) | SETTLED by this handoff |
| K6 open-estate source (public / founder-supplied real / third-party synthetic) | **OPEN — before Stage K6 touches data** |
| Cloud-baseline egress exception (public estate only, if ever) | **OPEN — Stage K7** |
| Paper 5 venue/track (artifact/datasets framing) | **OPEN — Stage K8** |
| Push to `main` | **OPEN — standing gate from the remediation handoff** |

## 8. Definition of Done

- [ ] K0 mode seam shipped: readable/vaulted views, determinism + erasure proven in both, general
      mode contains zero vault ceremony.
- [ ] K1 composed corpus shipped: deterministic, erasure re-proven, canonicalized versioned
      policies, multi-source provenance.
- [ ] K2 pair compiler shipped with entity-disjoint holdout designed in and negative-hardness bins.
- [ ] K3 multi-arm head-to-head measured and reported verbatim per arm, stratified 1-doc vs
      ≥2-doc facts; private-mode cost ablation reported.
- [ ] K4 false-merge amplification factor + hub-duplication analysis published.
- [ ] K5 taxonomy + coverage K with byte receipts, zero egress, anti-circularity CI.
- [ ] K6 open-estate measurement + checked-in failure cases (gate closed first).
- [ ] K7 benchmark packaged (gates closed first); K8 papers + product copy with word-ban grep
      clean (incl. no receipt/salt ceremony in product copy beyond a single plain statement).
- [ ] Every number through `check-paper-numbers.mjs`; `npm run test:ci` green; explicit-path
      commits; run record below filled.

## 9. Run Record

*What actually happened (appended by the executing session — commit shas and DEVIATIONS recorded
as they happened, not smoothed).*

**2026-11-24 (v1, handoff-authoring session):** Research executed first
(`docs/research-notes/2026-11-24-graph-grounded-corpus-novelty-research.md`). v1 planned the
upgrade as measurement families (identity-merge taxonomy, coverage K) over the shipped per-block
corpus, with the flat-vs-grounded comparison as prerequisite. No K-stage executed.

**2026-11-24 (v2, same session — founder feedback incorporated):** The founder rejected
gap-filling novelty as the bar and the drift of every proposal back into privacy machinery
("it will always become receipts, salt hash and that"; general users without privacy needs are
first-class). Two mechanism-level novelty hunts executed in parallel:
`2026-11-24-relational-sample-composition-novelty.md` (**novel as a mechanism**; 18 pinned / 12
rejected-fabrication IDs) and `2026-11-24-identity-contrastive-sft-novelty.md` (partially crowded;
14 pinned / 11 rejected; the measurement suite — unseen-entity, salt-rotation, hardness sweep —
is the surviving novelty). Handoff rewritten v2: mode seam (K0) first, composition (K1) as the
mechanism, pair compiler (K2) readable-first, multi-arm head-to-head (K3) as the decisive
experiment, false-merge amplification (K4) mandatory, benchmark families demoted to K5 behind the
mechanism. GPU state at authoring: Stage 4 sweep 6/18 combos; ablation backfill and K3 queued.
DEVIATIONS: none yet — no K-stage code executed.

**2026-11-24 (Stage K0 — the mode seam, executed same session):** `view.identity:
'readable' | 'vaulted'` shipped at the existing `buildAmnesiacCorpus(inputs, view)` seam.
**Vaulted stays the default and is byte-untouched** — the v2 line "default general" was corrected
before execution (flipping the default would break byte-identical reproduction of every committed
receipt); the app passes `readable` explicitly. Readable mode: unmasked content (the user's own
data, names and all), entity anchors = canonical readable identity (`ent:<class>:<canonical>`,
canonical = lexicographically smallest raw surface form resolving to the entity — deterministic,
documented in code), no certificate/training-recipe ceremony, plain "provided context" system
prompt, `receipt.identity: 'readable'`, mode pins the view digest. `eraseEntity` is span-exact in
readable mode too (raw offsets recorded per sample, internal-only, never emitted into the JSONL),
with the same loud-failure byte-diff guards. Executed by a sonnet subagent (TDD red→green: Amnesiac
7/8/9); **lead-verified**: full diff review, suite 9/9, `test:ci` 138+6 green, and 793
paper-number checks 0 failures with zero check-script edits (the vaulted-regression pin:
corpus SHA `6c857e0a…`, asserted in Amnesiac 1). Lead fixes on top of the subagent's output:
(1) readable-id collision is impossible under value-salted identity but would silently merge
entities if that invariant ever breaks — now asserted loudly at build time; (2) removed a no-op
tautological assertion the subagent left in Amnesiac 7; (3) the estate's atomic tmp+rename write
EPERM'd flakily on Windows when two parallel test processes regenerate the estate concurrently
(rename over a still-open file) — bounded 10×50 ms EPERM retry added to `writeAtomic`; two
consecutive full `test:ci` runs green after the fix.
**Deviations recorded:** (a) derived-format entities with no raw offsets fall back to the vault
token as the readable anchor (placeholder-shaped id on those entities, best-effort, commented —
fixing it needs perception to emit raw values for derived formats; not blocking); (b) readable
per-sample diff receipts carry removedSpans only, with removedBytes aggregated in the diff receipt;
(c) the readable eraseEntity line-delta guard assumes no JSON-escaping length deltas between raw
span bytes and their serialized form — it fails loudly (never silently) if that ever trips;
(d) `results/*.json` wallclock fields regenerate on every suite run (pre-existing behavior) —
committed artifacts restored after verification runs. Zero WASM bytes (pure JS);
`audit-wasm` allVerified.

**2026-11-24 (founder correction — no tiers, no overselling):** The founder corrected this
handoff's own framing mid-execution: the privacy machinery is not a "mode" or an upsell — it is
the DEFAULT, quietly; "we didn't need to oversell them." Standing Rule 1, the K0/K8 stage text,
the gates table, and the framing section were reworded accordingly (the v2 title dropped
"Two-Mode Engine"). The K0/K1 code is unaffected: vaulted is the default view (byte-stable,
receipts reproduce), the readable view is an explicit opt-in seam for training-data fidelity and
the experiments' default arm — one product, privacy stated once where required, never marketed.
The K0 run-record entry above keeps its original "general mode" wording as history; this entry is
the correction of record.

**2026-11-24 (Stage K1 — relational sample composition, executed same session):**
`view.composition: 'per-block' | 'composed'` shipped (absent = per-block, byte-identical;
composed currently requires the readable view and throws a loud `TypeError` on vaulted — the
composed vaulted variant is a later stage). **composed-v1 policies (canonicalized, versioned):**
one composed sample per resolved entity; evidence blocks rendered as `[<source>] <content>`
segments joined by `\n` in canonical order (byte-ranged before derived; source name
lexicographic; source byte offset; content-digest block id); hub cap 8 (first 8 in canonical
order, deterministic — no sampling; truncation count internal-only); sample id =
sha256(`composed\0` + readableId + `\0` + sha256(content)); lines carry `target` + a
`sources` provenance array (one `{source, sourceRange}` per contributing block, canonical order);
`entities` = every entity anchored in rendered blocks, deduplicated first-appearance; receipt
records `compositionPolicy: 'composed-v1'` — the **policy version, not the engine version,
invalidates composed receipts** (the default per-block path's bytes are unchanged, so
`AMNESIAC_ENGINE_VERSION` is untouched and the pinned vaulted SHA `6c857e0a…` reproduces).
**Erasure re-proven on the composed corpus, not inherited:** target erase retracts exactly the
sample (receipt `sampleCount` updated; diff receipt gains `compositionPolicy`,
`retractedSampleCount`, `retractedSampleIds`); co-mention erase removes block-local raw spans,
re-derives render-coordinate spans, and a **lead-added guard asserts the two derivations of the
same erasure (render-span removal → serialized line; block-level removal → re-rendered spans)
agree byte-for-byte** — the silent-divergence class this seam forbids. Executed by a sonnet
subagent (TDD red→green: Amnesiac 10/11/12); **lead-verified**: full diff review, suite 12/12,
`test:ci` 141+6 green, 793 paper-number checks 0 failures with zero check-script edits.
**Deviations recorded:** (a) composed co-mention erase of a derived-format entity with no raw
offsets fails loudly by design (K0 deviation (a) carried into K1 — the build succeeds, the erase
refuses to guess); (b) JSON-escaping caveat carried over from K0 (loud failure direction);
(c) composed entity-index entries keep per-block `occurrences` and re-point `sampleIds` at
composed samples. Zero WASM bytes; `audit-wasm` unchanged.

**2026-11-24 (Stage K2 — identity-contrastive pair compiler, executed same session):**
`compileIdentityContrastivePairs(state, options)` shipped in
`src/identity-contrastive-pairs.js`, over the readable per-block seam only (vaulted and composed
states are loud `TypeError`s; the vaulted pair variant is a later stage). **pairs-v1 policies
(canonicalized, versioned):** positives = every cross-source block pair of one entity as a
two-message SFT sample (labeled records in; readable canonical id + canonical name out);
negatives = same-class different-entity near-misses (normalized Levenshtein ≥ 0.8 over
lowercased canonical anchors), assistant target names both ids (the model must split them);
**far negatives declined by default** (anti-triviality — the surface-similarity shortcut guard),
with the declined count still recorded in `hardnessBins` for the later hardness sweep
(`options.includeFarNegatives` is the knob); entity-disjoint holdout reserved BEFORE any pair is
emitted (every k-th entity in canonical id order, k = ceil(1/fraction), first entity included —
16/76 on the estate at the 0.2 default), holdout mentions retained as context in other pairs for
unseen-entity binding in K3; determinism: pair ids = sha256(`pair\0` + block ids + entity id(s)),
JSONL fixed-ordered by pair id, no timestamps. Runner
`scripts/run-identity-contrastive-pairs.mjs` → `results/identity-contrastive-pairs.json` +
`.jsonl`. **Estate receipts:** 323 pairs = 245 positives (233 cross-modal) + 78 near negatives;
hardness bins {homonym 0, near 131, far 286}; source = the committed company-brain-slice corpus
(24 samples / 76 entities). Executed by a sonnet subagent (TDD red→green: K2 1–6);
**lead-verified**: full diff review, K2 6/6 + Amnesiac 12/12, runner regeneration reproduces the
receipts exactly, full `test:ci` green with the test lead-wired into `test:ci`, 793 paper-number
checks 0 failures with zero check-script edits. **Lead fixes on top of the subagent's output:**
the smoke test ended with `fs.rmSync` on both artifacts — it would delete the committed receipts
on every CI run once wired in; it now restores the pre-test bytes byte-for-byte (and removes the
files only if they were absent). **Deviations recorded (implementer choices, lead-reviewed):**
(a) pair-id digest uses `\0` separators instead of bare concatenation; (b) holdout = indices
0, k, 2k… (first entity held out); (c) negative blocks = first canonical block per entity, pair
skipped when the chosen blocks coincide with no alternate; (d) a defensive extra guard rejects
composed-corpus states (the spec only mandated vaulted); (e) cross-modal = differing source file
extensions. Zero WASM bytes. Same-session adjacent commit: Paper 4 updated with the composition
section (built/receipted/unmeasured framing, four-arm K3 design, EAE/KEPLER/Multi-News/EmbGen
related work, zero new numbers — `95c7895`).

**2026-11-24 (external critique relayed by the founder; lead verified every checkable claim
before acting):** A well-informed external critique of Paper 4's value claims arrived mid-flow.
Verification first: the critique's repo-specific numbers are real (`pprlFalseLinkRateAtDevThrPct`
4.8818 in `results/reviewer-secrets-audio-pprl-benchmarks.json`; the track-C Graph-PPR retrieval
arm; redacted-target LoRA fragility in the track-D line). One claimed citation was wrong from
memory and was re-pinned on the abs page: the in-context pretraining paper is Shi et al.,
"In-Context Pretraining: Language Modeling Beyond Document Boundaries" (arXiv:2310.10638), which
groups related documents into shared training contexts and is genuinely the closest prior art to
composition; Allen-Zhu & Li knowledge capacity verified as arXiv:2404.05405. **Verdicts and
actions:** (1) "extracted without error" softened to "extracted exactly on the estate", scoped;
(2) vaulting-vs-learning stated explicitly: the vaulted default masks loss on vault spans, so it
claims lineage and exact erasure, not learned names; the knowledge-training claim, if any, lives
in the readable view, which the comparison runs; (3) `entities` is JSONL metadata in the per-block
export, the loss sees identity only where a view renders it into tokens; (4) certificate
circularity stated (detector-closed re-scan, n=24 is small-sample arithmetic); (5) Table 1
baselines score 0 by construction, real-extractor comparison stated as open work; (6) linking
unit is the value, not the person, 54/54 is exact matching on planted values; the 4.88% PPRL
false-link rate entered the paper with a new CI needle (check now 794/0); (7) K3 upgraded to six
arms at equal token budget: added retrieval-over-the-graph (Graph-PPR) and base-model arms, with
stated skepticism, and K5 upgraded to pairwise + B-cubed scoring with the noise set
(typos, nicknames, shared inboxes, name collisions, stale records) and a generator-independence
rule. The title ("How Training Data Should Look") is the founder's own repositioning and is
treated as a design-thesis title with the open comparison scoped in the abstract; a rename is a
founder gate if they want it. Committed: `4ef233f` (paper remediation + bib + needle),
`72665ed` (open-estate dataset hunt note, also this date; AMI/ICSI licenses re-verified by the
lead on the source pages).

**2026-11-24 (K4/K5 prep, lead-authored while the GPU queue drains):** The founder said "lets
wait for our current verdict, if u have some homework to do, do so". Homework executed: the
noisy-estate benchmark spec (`docs/2026-11-24-noisy-estate-benchmark-spec.md`), lead-authored,
which turns the external critique's benchmark demands (independent authorship, noise, B-cubed
scoring, failure-side reporting) into binding fixture-build rules. Design highlights: world-first
truth (the manifest is a frozen world model, documents are seeded noisy projections, truth is
never adjusted to match them); noise N1–N8 authored in the spec before implementation and not
derived from engine code (no engine imports in the generator, asserted); 20 same-name collision
pairs as the designed false-merge stress case; shared inboxes and stale records as the
false-split stress cases; Q1/Q2/Q3 question strata (single-doc / cross-doc / disambiguation)
authored by the manifest layer only; person-level pairwise + B-cubed scoring with miss
attribution by noise type; and a binding acceptance gate that the benchmark must be able to
fail: an exact-match baseline must score <90% pairwise recall and commit at least one false
merge, or the estate is regenerated with the failure documented. Audio/decks honestly out of
scope for v1 (identity overlay on real speech is not honest, per the dataset hunt). Fixture
build handed to a subagent against the spec; lead verification and wiring on completion.

**2026-11-24 (K4/K5 prep executed — noisy-estate fixture built, gated, and committed):**
Builder output lead-verified end-to-end before commit `99ba4f1`: all three source files read
(`scripts/gen-noisy-estate.mjs`, `scripts/noisy-estate-baseline.mjs`,
`test/noisy-estate.test.js`), spec constants checked against
`docs/2026-11-24-noisy-estate-benchmark-spec.md`, math checked by hand, estate tree clean under
`fixtures/`. **Receipts (2,368 mentions, 797 corrupted):** exact-match floor pairwise
P 0.9183 / R 0.2427 / F1 0.3839; B-cubed P 0.9671 / R 0.3203 / F1 0.4812; **257 false merges,
ALL on the designed N6 collision pairs**; false-split rate 0.7573 with miss histogram
N4 4081 / none 2194 / N5 1399 / N3 1093 / N2 784 / N6 705 / N7 683 / N1 300 / N8 191;
Q3 disambiguation accuracy 1/12 (exact matching genuinely fails the benchmark, not by
construction of the scorer but by construction of the world). **Binding gate PASS** (recall
<0.9, ≥1 collision false merge) — the benchmark can fail, and the trivial recipe does.
Engine blindness test-asserted (generator imports only `node:` builtins, zero `src/`
references); determinism test-asserted (seed 20261124, two generations byte-identical,
manifest pins the estate SHA-256 with its recipe, no wallclock fields). Test wired into
`test:ci`; full suite green; paper-number checks 794/0 with zero check-script edits.
**Deviations recorded (implementer choices, lead-reviewed):** (a) email volume 190 messages
across 40 threads (spec said ~160 — the N5 shared-inbox threads carry a 5th message);
(b) N3 initials withheld from collision-pair members and N1 from initials-only surfaces (the
spec's locally-unambiguous rule, so the collision stress case stays winnable); (c) fact
statements canonical-forced on occurrence idx 0 and variant-forced on idx 1, so multi-doc
facts join on genuinely different surfaces; (d) chat handles normalize onto canonical names
under the trivial recipe (honest consequence for baseline recall, not smoothed); (e) the
noise summary's N1 count is 35 name mentions at the spec's 6%-per-token rate (the rate is
low by design; the histogram in the baseline artifact carries the per-noise-type miss load).
K5's floor is now a committed artifact (`results/noisy-estate-baseline.json`); K4's
open-world variant builds on this estate next.

**2026-11-24 (Stage 4 verdict — the PT-LM epoch/lr sweep, executed and landed):** The GPU
sweep the founder waited on finished 18/18 and the verdict is clean on the headline:
**canary non-leakage is recipe-robust.** Across all 18 adapters (3 models × {80, 160, 240}
steps × {2e-4, 1e-4} lr, identical T2-Chat PT-LM data), trained canary exposure spans
2.62–4.49 bits and NO trained adapter exceeds its own model's untrained base (3.84 /
4.17 / 4.52 bits); the grid's origin (80 steps, 2e-4) reproduces the committed single-point
PT-LM held-out receipts exactly (16.2 / 36.2 / 25.0 judge), so the committed result is
the origin, not a selection. Secondary findings, reported as measured: OOS abstention is
learned, not default (0.0% at 80 steps everywhere; 10.0–80.0% at 160–240 steps, peak
Qwen2.5-1.5B 240/2e-4 at 80.0%, with zero canary cost); held-out utility stays modest
(strict judge 11.2–45.0%, best lfm3 160/1e-4 at 45.0%), consistent with Graph-PPR's lead.
**Dual-judge disagreement recorded, not smoothed:** the cross-family llama3.2:3b judge is
systematically more generous (41.2–53.8%) than the strict qwen2.5:7b judge, with row-level
agreement on the partial-credit threshold spanning only 31.4–62.9%; the paper reports both
side by side and the sweep artifact records the DeepSeek-swarm deviation (no API key on
the machine; votes backfill on re-run). **Execution incidents and fixes:** the first run
died of CUDA OOM at combo 11/18 (float32 full-vocab log-softmax at canary batch 64 on the
8 GB card, after 10 combos of allocator fragmentation); the fix was one line — canary
batch 64 → 16 at the sweep call site only (scores are per-candidate, batch size is pure
memory, zero number changes; the 4 committed main-arm call sites untouched) — and the
script's own checkpoint/resume preserved all 10 finished combos, so the relaunch cost was
8 combos, not 18. **Verification:** Paper 3 gained sec:ptlm-sweep (18-row table + three
findings), one abstract sentence, one discussion clause; compiled clean (9 pages, no
undefined refs); check-paper-numbers extended with 117 sweep needles (every table cell,
the ranges, value-vs-value baseline-reproduction and leak guards) — **911 checks, 0
failures**. No em-dashes in the new text; en-dash compounds avoided per the founder
ruling (numeric `--` ranges kept, matching this paper's committed convention). Zero WASM
bytes; no engine changes.

**2026-11-24 (founder delegation — K6 estate construction handed to a parallel agent):**
The founder assigned the open-estate benchmark construction (the K6 external-validity line,
source-choice gate) to a separate agent via
`docs/2026-11-24-parked-followups-handoff.md` (Item 3), alongside the two parked engine
follow-ups (chartSeries graph wiring; cross-table JOIN host bridge). Binding constraints
exported to that handoff: worktree off this branch, no GPU, needle discipline, word bans,
no push, licensing gates (Enron license and MeetingBank audio are ask-first founder gates;
anything NC or fee-gated stays out per the hunt note's rejection ledger), and construction
+ exact-match baseline only — model arms on that estate stay on THIS queue's GPU after K3.
The main queue is unaffected: K3 six-arm runs on the synthetic noisy estate; K6 model
comparisons are queued here after K3 and consume the parallel agent's estate artifact.

**2026-11-24 (Stage K3 executed — the six-arm head-to-head, full run):**
The decisive experiment ran to completion on the noisy estate (115 docs, 60 manifest
questions, Q1/Q2/Q3 = 24/24/12) at an equal training-token budget of 25,755 tokens per
arm, recipe sealed from the sweep combo `qwen15b-160steps-lr2e-4` (Qwen2.5-1.5B-Instruct,
LoRA r16/alpha32, 160 steps, lr 2e-4, canary batch appended identically to every arm).
Closed-book exact match, all 60 questions: Graph-PPR retrieval (no fine-tuning, track-C
topK 6) 53.3% with Q2 cross-document at 83.3%; composed 11.7%; per-block 10.0%; flat
6.7%; composed+pairs 1.7% (= base); per-block vaulted 1.7% (= base); base 1.7%. Every
trained arm shows the same canary exposure (8.5 bits vs base 4.3), so format choice did
not move memorization at this scale. Honest reading, recorded as it ran: (1) the graph
pays off as a retrieval index, not as a training format, at 1.5B/160-step scale —
retrieval beats the best trained arm by 4.6x overall and 6.7x on cross-document facts;
(2) among training formats the composed > per-block > flat ordering holds on every
stratum but the margins are small (11.7 vs 10.0 vs 6.7); (3) the composed+pairs arm
failed by the budget mechanism, not by the pair idea — pair rows displaced composed rows
down to 50 rows / 9,947 learnable tokens (vs 41 rows / 23,608 for composed alone), a
negative result reported with its mechanism; (4) vaulted identity scores exactly base on
closed-book identity questions — the privacy cost quantified (1.7 vs 10.0 readable
per-block). Judge agreement between the strict qwen2.5:7b judge and the cross-family
generous llama3.2:3b judge is low (6.7-41.7% row agreement across arms); both judges'
scores and the agreement rates are in the artifact and no judge is cherry-picked.
Deviations: the DeepSeek third judge did not run (no OpenRouter key on the machine;
votes backfill on re-run once a key exists — recorded in the artifact's `deepseek`
section); one HF-hub metadata hang during the earlier smoke run was an environment fault
(network-saturated hub check), resolved with HF_HUB_OFFLINE=1, not a code change; the
runner rewrites `results/track-k-composition-head-to-head.json` after every phase, so
the artifact is a complete run record with all per-row answers, canary exposures
(12 canaries x repetition 1/5/20), and held-out perplexity per arm. Corpora for all six
training arms are committed with SHA-256 receipts (`results/track-k-arm-receipts.json`)
and PPR contexts for the retrieval arm (`results/track-k-arm-ppr-contexts.json`).
