# Versieve Upgrade Handoff v2: Relational Sample Composition + the Two-Mode Engine (the "Knowledge Between All Data" Upgrade)

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

1. **Privacy is a mode, not the product (founder ruling, 2026-11-24).** General mode = readable
   entity identity (real names), no masking, no vault ceremony, no receipts in anyone's face.
   Private mode = vault-salted IDs, masked content, certificates, erasure receipts — the enterprise
   overlay. Every capability experiment defaults to readable identity; salted-vs-readable is an
   ablation axis ("what does the privacy mode cost"), never the headline mechanism. Receipts,
   salting, and diff ceremonies are designed inside the private mode and must never leak back into
   the general-mode product surface or the framing of new mechanisms.
2. **The claim discipline for the novel mechanism.** "Graph-grounded SFT data" as a phrase is TAKEN
   (GraphGen 2505.20416 owns graph-neighborhood→SFT; EmbGen 2605.19394 owns entity-unit reassembly).
   The only defensible claim is the full conjunction: **deterministic composition of the actual
   source bytes of multiple heterogeneous documents into one training sample, selected by
   traversing the resolved entity graph, with canonicalized versioned policies** — the join IS the
   training unit. In private mode this additionally carries provenance + erasure receipts; in
   general mode the pitch is simply: sample boundaries follow knowledge structure, not byte
   position.
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
> place-and-stitch. In general mode the identity anchors are real names; in private mode the same
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

**Stage K0 — The mode seam: general mode over one engine (CPU; product unlock)**
- What: extend the existing `view` parameter of `buildAmnesiacCorpus(inputs, view)` with
  `identity: 'readable' | 'vaulted'` (vaulted stays the default so every committed receipt
  reproduces byte-identically; the app passes `readable` explicitly). Readable mode: entity anchors are the
  canonical resolved names, content is NOT masked, no certificate ceremony in the output — the
  user's own data, their own model, names and all. Vaulted mode: exactly today's behavior. The
  corpus stays a deterministic pure function of (inputs, view, engine version) in both modes;
  the mode itself is part of the view hash.
- Verify: TDD at the seam (red first): determinism in both modes; `eraseEntity` byte-diff exact in
  both modes (in readable mode erasure is still mechanical regeneration — no protection claim
  made or needed); readable corpus contains zero `<PII:…>`/`<SECRET:…>` placeholders;
  `npm run test:ci`; `audit-wasm` unchanged (pure JS, zero WASM bytes).
- Commit: `feat(corpus): general-mode view — readable identity, no vault ceremony`.
- GATE: when general mode surfaces in the Rtio app UI — founder decides timing.

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
- What: arms — (1) flat positional chunks, (2) per-block entity-indexed corpus (today's artifact),
  (3) composed corpus (K1), (4) composed + identity-contrastive pairs (K2). All readable identity
  (general mode). Private-mode cost ablation: one arm re-run vaulted (salted IDs + masked spans) —
  the "what does privacy cost" measurement. Recipe: sealed LoRA r16/α32, steps/lr from the Stage 4
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
  design — Standing Rule: no new all-100 table without a difficulty knob). (b) Knowledge-perception
  coverage K: % of manifest facts spanning ≥2 documents recoverable from perception output alone,
  at the shipped byte budget (387,267 B), zero egress, byte receipts. Score from perception output
  + existing sample fields only — no further schema change in this stage.
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
  General-mode product copy for Rtio: point it at your documents → training data that knows your
  world, names and all; private mode as the enterprise upsell layer. Word-ban grep now also covers
  "perceive everything", "atomic knowledge", and any receipt ceremony in general-mode copy.
- Verify: `check-paper-numbers.mjs` green; papers recompile 0 errors/0 undefined; word-ban clean.
- Commit: `docs(papers): relational composition paper + honest multi-arm results` /
  `docs(product): general-mode copy`.

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
21. **Masked-span fraction compounds in composed samples (private mode)**: one entity's render
    mentions it in every block — the model can train mostly on placeholder-shaped context and emit
    `<PII:…>`-shaped filler. General mode has no masking; measure the fluency probe per mode.
22. **"It may only recreate RAG at train time"**: if the composed-corpus benefit vanishes whenever a
    retriever is available at inference, the mechanism is engineering overhead — the head-to-head
    must report the closed-book vs retrieval-available conditions.
23. **EmbGen (2605.19394) verdict is abstract-level**: full-text read required before any
    paper-level claim against it; the seam is being approached — urgency is real.

## 7. Founder Gates

| Gate | Status |
|---|---|
| Mode ruling: general mode = readable identity, no ceremony; private mode = the overlay | **SETTLED 2026-11-24 (founder ruling, this session)** |
| General-mode surfacing in the Rtio app UI (timing) | **OPEN — Stage K0 output exists; founder decides when it ships to the app** |
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
      clean (incl. no receipt ceremony in general-mode copy).
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
