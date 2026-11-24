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
- What: arms — (1) flat positional chunks, (2) per-block entity-indexed corpus (today's artifact),
  (3) composed corpus (K1), (4) composed + identity-contrastive pairs (K2). All readable identity
  (readable view — the experiment default). Vaulted-cost ablation: one arm re-run on the vaulted
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
