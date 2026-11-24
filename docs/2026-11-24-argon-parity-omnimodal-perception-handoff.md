# Research & Engineering Handoff: Versieve ("Perceive-Everything") Phase II — Achieving "Gemini Argon Parity" in Local Client-Side Omnimodal Perception

- **Date:** 2026-11-24
- **Primary Repository:** `c:\Users\GEYE ARDIANSYAH\Downloads\Innovation Hub\matilda-portable` (`gegearsyah/verisieve`, `main` @ commit `951f25a`)
- **Sibling Browser Sandbox Repository:** `c:\Users\GEYE ARDIANSYAH\Downloads\Innovation Hub\Rtio` (`gegearsyah/RTIO`, live at `https://www.rtio.io/sandbox`)
- **Sibling GPU Training Repository:** `c:\Users\GEYE ARDIANSYAH\Downloads\Innovation Hub\MLE`
- **Foundation Completed in Phase I (`951f25a`):**
  - [docs/2026-11-24-perceive-everything-theoretical-framework.md](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/docs/2026-11-24-perceive-everything-theoretical-framework.md) (`HC-CRC`, `E-LTT`, `SR-MP`, `PT-LM` formal proofs)
  - Zero-import `verisieve_media.wasm` (`190,873 B`, `27` exports, `512`-slot `SR-MP` Salted Reference Sketch Ring)
  - All three MLSys benchmark papers compiled and verified (`108/108` CI tests passing, `0` WASM host imports)

---

## 1. Executive Vision: "Gemini Argon as Our Own Benchmark"

The overarching goal of **Versieve ("Perceive-Everything")** goes beyond privacy redaction and conformal gatekeeping:

> *"Right now, like Gemini Argon, as an AI agent model you are really smart in reading all the video, voices, presentations, and all of this data. I want to make Perceive-Everything as smart as you—literally perceiving everything—but 100% local on the client side, cheap, small, and usable by everyone! You are my own benchmark!"*

### Why Is It Possible for a `< 500 KB` Client-Side WASM + Micro-Model Engine to Rival a Frontier Model on Multimodal Perception?

A 100B+ frontier multimodal model spends **$>98\%$ of its parameters** on open-ended world knowledge, creative prose synthesis, and multilingual parameter memorization. By contrast, **Multimodal Perception**—transforming raw presentations (`.pptx`), spreadsheets (`.xlsx`), PDFs, raster charts/diagrams (`.png`/`.jpg`), voice recordings (`.wav`), and videos (`.mp4`) into a structured, queryable **Omnimodal Scene Graph (`OSG`)**—is an **inverse-rendering, signal-processing, and structural-alignment problem**.

Where current `perceive()` ([src/perceive.js](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/src/perceive.js)) still falls short of Gemini Argon is clear:
1. **Visual Blindness Beyond Flat OCR:** On a presentation slide, video keyframe, or PDF page containing a **bar/line chart, an architecture flowchart (boxes & arrows), or a multi-header table**, current `perceive()` only extracts flat text lines or disconnected word boxes. It cannot perceive `(Box A) --[arrow]--> (Box B)`, cannot read quantitative `[x, y]` data series out of a raster chart image, and does not automatically compile perceived visual tables into `verisieve_sql.wasm` for exact relational queries.
2. **Acoustic & Speaker Blindness in Voice/Audio:** On a voice recording or meeting video, current `perceive()` treats transcript segments as a single monotone text stream. It does not perceive **who is speaking** (speaker diarization: `SPEAKER_01` vs. `SPEAKER_02`), **how they are speaking** (acoustic prosody: pitch $F_0$, emphasis/stress, rising-question intonation, speaking rate), or **non-speech acoustic cues**.
3. **No Deictic Audio-Visual Grounding in Video & Presentations:** When a speaker in an `.mp4` presentation says at `t = 00:42.500`, *"As you can see in this top-right chart, Q4 latency dropped by 60%"*, Gemini Argon binds the spoken demonstrative (*"this top-right chart"*) to the visual chart region on the active video keyframe at `t = 00:42.500`. Current `perceive()` leaves the audio block and keyframe block unlinked.
4. **No Active Coarse-to-Fine Compute Budgeting:** Processing a 60-minute video or 150-slide deck on a laptop/browser tab requires **Information-Bottleneck Active Perception**—using sub-millisecond `#![no_std]` WASM perceptual sketches to skip 95% of redundant frames/regions and zoom compute only onto high-surprisal visual/acoustic regions.

---

## 2. Four New Pillars of Theoretical & Systems Novelty to Execute

### Pillar I — `WASM-VIG`: Vector & Inverse-Graphics Visual Perception (Charts, Diagrams, Flowcharts & Relational Tables)

#### 1. Mathematical & Algorithmic Formulation
Treat a visual page, slide, or video keyframe $I \in \mathbb{R}^{H \times W \times 3}$ (or vector container $V$) as a composition of typed structural primitives $\mathcal{G}_{\text{vis}} = (\mathcal{V}_{\text{regions}}, \mathcal{E}_{\text{spatial}}, \mathcal{T}_{\text{tables}}, \mathcal{Series}_{\text{charts}})$:

1. **Native Vector & DrawingML Scene-Graph Extraction ([src/enterprise-parsers.js](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/src/enterprise-parsers.js) & [src/pdf-parser.js](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/src/pdf-parser.js)):**
   - **PowerPoint (`.pptx`) DrawingML Graph & Chart Recovery:**
     - Parse `<p:sp>` shape geometries (`<a:off x="..." y="..."/>`, `<a:ext cx="..." cy="..."/>`), `<p:cxnSp>` **connector arrows** (`<a:stCxn id="..." idx="..."/>` $\to$ `<a:endCxn id="..." idx="..."/>`), and `ppt/charts/chart*.xml` (`<c:ser>`, `<c:cat>`, `<c:val>` numeric caches).
     - Emit explicit directed diagram edges `(Shape_A) --[CONNECTOR:label]--> (Shape_B)` into `verisieve_graph.wasm` and exact structured chart series JSON without needing raster OCR.
   - **PDF Vector Path & Ruling-Line Graph Recovery:**
     - Parse PDF content-stream vector path operators (`m`, `l`, `re`, `S`, `s`, `f`) alongside text matrices (`Tm`, `Td`) to reconstruct exact vector table grids and box-and-arrow diagrams in born-digital PDFs.
2. **Zero-Import `#![no_std]` Rust Raster Inverse-Graphics Kernel (`rust/verisieve-media/src/visual_perception.rs` $\to$ `verisieve_media.wasm`):**
   - Add two zero-allocation exports to `verisieve_media.wasm`:
     - `vs_media_segment_layout_regions(rgb_ptr, width, height, out_ptr, out_cap) -> usize`:
       - Runs fast integral-image adaptive thresholding, horizontal/vertical run-length projection profiles, and 8-connected component labeling in static memory to classify regions into `REGION_TEXT_BLOCK`, `REGION_TABLE_GRID`, `REGION_CHART_PLOT`, and `REGION_DIAGRAM_NODE`, plus traced arrow connectors (`EDGE_DIRECTED_ARROW`) between diagram boxes.
     - `vs_media_invert_chart_series(rgb_ptr, width, height, axis_bbox_ptr, out_ptr, out_cap) -> usize`:
       - Given a detected `REGION_CHART_PLOT` (bar chart or line plot) and OCR-anchored axis tick labels $\{(y_k, v_k)\}$, fits the affine pixel-to-value calibration $\hat{v}(y) = a \cdot y + b$ via least squares and measures column color-cluster bar heights / curve centroids across $x$-bins, recovering quantitative data series $\{(x_i, \hat{v}_i)\}$ directly from raw pixels!
3. **Automatic Table-to-SQL Compilation into `verisieve_sql.wasm` ([src/sql-wasm.js](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/src/sql-wasm.js) & [src/perceive.js](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/src/perceive.js)):**
   - Every table perceived from `.xlsx`, `.csv`, HTML, `.pptx`, PDF vector grids, or raster table layouts is automatically normalized into a typed relational schema and loaded into `verisieve_sql.wasm`, exposing `result.querySql("SELECT ...")` and auto-computing column summaries (`MIN`, `MAX`, `SUM`, `AVG`, outliers) inside the `<BLOCK role="TABLE_RELATIONAL">` metadata.

---

### Pillar II — `WASM-APSD`: Acoustic Prosody, Zero-Import Speaker Diarization & Deictic Audio-Visual Grounding

#### 1. Zero-Import `#![no_std]` Rust Acoustic Prosody & Speaker Diarization (`rust/verisieve-media/src/audio.rs` $\to$ `verisieve_media.wasm`)
- Export `vs_media_analyze_prosody_and_diarize(pcm16_ptr, sample_count, sample_rate, segments_ptr, segment_count, out_ptr, out_cap) -> usize` in `verisieve_media.wasm`:
  1. **Per-Segment Acoustic Feature Vector ($\mathbf{a}_s \in \mathbb{R}^{16}$):**
     - **Fundamental Pitch ($F_0$ mean, std, and terminal slope $\Delta F_0$):** Computed via fast integer YIN / autocorrelation lag over voiced `20 ms` frames (`75–400 Hz`). A positive terminal slope ($\Delta F_0 > +18\text{ Hz}$) deterministically tags rising-intonation questions/uncertainty; high pitch variance + high RMS dB delta tags `emphasis="high"`.
     - **Vocal-Tract Spectral Timbre ($\mathbf{c}_s \in \mathbb{R}^{12}$):** 12-band log-energy filterbank + spectral centroid + zero-crossing rate + formant-proxy energy ratios.
  2. **Zero-Allocation Online Speaker Clustering (Diarization without PyAnnote):**
     - Clusters segment timbre-pitch embeddings $\{(\mathbf{c}_s, \bar{F}_{0,s})\}$ using BIC-regularized spherical $k$-means / agglomerative cosine clustering ($K \le 8$ speakers in a `4 KB` static buffer), assigning each speech turn a consistent `speaker="SPEAKER_01"`, `prosody={ pitchHz, emphasis, intonation, wpm }`, and seeding speaker voiceprint sketches into the `SR-MP` ring!

#### 2. Cross-Modal Deictic & Temporal Co-Attention (`resolveDeicticCrossModalBindings` in [src/perceive.js](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/src/perceive.js))
- When an audio/voice segment $u_i$ at timestamp $[t_{i,0}, t_{i,1}]$ co-occurs with visual slides or video keyframes $\{v_j\}$:
  - Detect **deictic & structural cues** in $u_i$ (spatial demonstratives: *"top-right"*, *"bottom table"*, *"this chart"*, *"slide 3"*, *"row 2"*; visual attributes: *"red bar"*, *"peak"*, *"arrow"*; or shared entity/numeric tokens).
  - Compute the **Cross-Modal Grounding Score**:
    $$G(u_i, v_j) = \sigma\!\Bigl(\alpha_{\text{time}} \cdot \operatorname{IoU}_{\text{time}}(u_i, v_j) + \alpha_{\text{spatial}} \cdot \operatorname{Match}_{\text{spatial}}(u_i, \text{bbox}(v_j)) + \alpha_{\text{sem}} \cdot \operatorname{Sim}_{\text{SR-MP}}(u_i, v_j)\Bigr)$$
  - Link every grounded speech turn to its visual target region via a `GROUNDED_TO` edge in `verisieve_graph.wasm` and `groundedVisualBlockId` in both `perceptionStream` and `sceneTimeline`.

---

### Pillar III — `IB-AMP`: Information-Bottleneck Active Matryoshka Perception (Submodular Budgeted Triage)

#### Theoretical Framework
Let $\mathcal{U} = \{u_1, \dots, u_N\}$ be all candidate perception units in a long document, slide deck, or video stream (e.g., $N = 3{,}600$ video frames or $500$ page tiles). Let Pass-0 in `verisieve_media.wasm` compute an ultra-fast (`< 0.05 ms`) `64-bit` structural-perceptual sketch $\phi(u) \in \{0,1\}^{64}$ (`vs_media_perceptual_dhash64`) and local entropy/change score $h(u) \in [0, 1]$.

Under a strict client-side latency budget $B_{\text{ms}}$, selecting the subset $S \subseteq \mathcal{U}$ of units to promote to heavy Pass-1/Pass-2 perception (OCR, chart inversion, neural NER, VLM crop) maximizes the **Facility-Location + Surprisal Submodular Objective**:
$$F(S) = \sum_{u \in \mathcal{U}} \max_{s \in S} \operatorname{Sim}_{64}(\phi(u), \phi(s)) + \lambda \sum_{s \in S} h(s) \quad \text{s.t.} \quad \sum_{s \in S} c(s) \le B_{\text{ms}}$$

- **Proposition 4 (Monotone Submodularity & $(1 - 1/e)$ Approximation Guarantee):** $F(S)$ is monotone non-decreasing and submodular ($\Delta F(u \mid A) \ge \Delta F(u \mid B)$ for $A \subseteq B$). Cost-normalized lazy greedy selection in `src/perceive.js` achieves a $(1 - 1/e)/2$ worst-case (and $(1 - 1/e)$ uniform-cost) approximation to the optimal omniscient frame/tile subset in $O(N \log N)$ time while pruning $90\%$--$98\%$ of redundant video frames and blank/boilerplate tiles.

---

### Pillar IV — `Argon-Perceive-Bench`: Using Gemini Argon as the Ground-Truth Teacher & Parity Benchmark

To prove empirically that `perceive()` / `perceiveMulti()` achieves **Gemini Argon-level structural perception** locally on the client side, construct a self-contained, reproducible benchmark suite (`scripts/eval-argon-parity-benchmark.mjs` $\to$ `results/argon-parity-benchmark.json`):

#### The 6 Multimodal Workspaces in `Argon-Perceive-Bench`
1. **Workspace 1 — Presentation Deck with Flowchart & Native Chart (`.pptx`):**
   - Multi-slide enterprise architecture & Q1–Q4 metrics deck containing DrawingML box-and-arrow connectors (`<p:cxnSp>`), an embedded `<c:chart>` series, speaker notes, and a hidden financial appendix slide.
2. **Workspace 2 — Raster Scientific/Financial Bar & Line Charts + Diagram Image (`.png`):**
   - Synthesized high-resolution raster bar/line chart and box-and-arrow system diagram with known ground-truth numeric series $\{(x_k, y_k)\}$ and directed edges $E_{\text{GT}}$, testing `verisieve_media.wasm` pixel-to-data inversion (`RelErr <= 2%`) and arrow topology recovery.
3. **Workspace 3 — Multi-Speaker Voice Recording with Prosody & Spoken Data (`.wav`):**
   - Multi-turn 2-speaker PCM16 dialogue with distinct vocal fundamental frequencies ($F_0 \approx 115\text{ Hz}$ vs. $210\text{ Hz}$), prosodic emphasis bursts, rising-pitch questions, spoken identifiers, and metric corrections.
4. **Workspace 4 — Synchronized Screen-Recorded Video with Deictic Voiceover (`.mp4` / Keyframes + Audio):**
   - Multi-scene video where the presenter transitions across 3 slides (title, architecture diagram, Q4 latency table/chart) and makes explicit deictic statements (*"As shown in the top-right box of this diagram..."*, *"Look at row 3 of this latency table..."*).
5. **Workspace 5 — Relational Spreadsheet & Multi-Column Table Join (`.xlsx` + PDF Table $\to$ `verisieve_sql.wasm`):**
   - Cross-document relational tables where answering multi-hop quantitative questions requires joining the perceived `.xlsx` sheet and PDF table inside `verisieve_sql.wasm` (`SELECT ... JOIN ... GROUP BY`).
6. **Workspace 6 — Omnimodal Enterprise Project Bundle (`perceiveMulti`):**
   - All modalities together (`.eml` + `.pptx` + `.xlsx` + `.wav` + `.png` + `.vtt`), testing cross-modal `SR-MP` entity linking, `WASM-VIG` chart/diagram/table extraction, `WASM-APSD` speaker/deictic grounding, and `Graph-PPR + SQL` multi-hop QA.

#### Five Quantitative "Argon-Parity" Metrics
Compare **Isolated Baseline Parser (Flat Text/OCR)** vs. **Versieve `Perceive-Everything` (Phase II)** against the **Gemini Argon Ground-Truth Oracle (`100%` Reference)**:
1. **Visual Topology & Diagram Edge F1 (`%` of Argon Oracle):** Precision/Recall/F1 on recovered box-and-arrow directed edges and layout hierarchy.
2. **Chart Pixel-to-Data & Table SQL Numerical Accuracy (`%` of Argon Oracle):** Mean relative error (`RelErr %`) on raster chart series recovery and exact-match accuracy on relational table SQL aggregations.
3. **Speaker Diarization Purity & Prosodic Intent Accuracy (`%` of Argon Oracle):** Turn-level speaker clustering purity (`1 - DER`) and prosodic emphasis/question classification accuracy.
4. **Deictic Audio-Visual Grounding Recall (`%` of Argon Oracle):** Accuracy of binding spoken deictic turns ($t \in [t_0, t_1]$) to the referenced visual region/chart/table row.
5. **End-to-End Omnimodal Multi-Hop QA Parity (`%` of Argon Oracle) & Pareto Efficiency:** Score on 60 multi-hop questions across the 6 workspaces, alongside binary size (`< 400 KB` total zero-import WASM), latency (`ms`), and cloud egress (`0 B`).

---

## 3. Exact Execution Checklist for the Next Agent Session (In Order)

- [ ] **Step 1 — Formalize Phase II Theory (`docs/2026-11-24-perceive-everything-theoretical-framework.md`):**
  - Append Section 6 (`WASM-VIG` Inverse-Graphics Chart & Diagram Recovery Bounds), Section 7 (`WASM-APSD` Spectral-Prosodic Diarization & Deictic Co-Attention), and Section 8 (Proposition 4: `IB-AMP` Submodular Budgeted Triage $(1 - 1/e)/2$ Guarantee — plain cost-benefit greedy under a budget is $(1-1/e)/2$ (Khuller–Moss–Naor 1999); the full $1-1/e$ requires Sviridenko-style partial enumeration. Corrected 2026-11-24 per the literature-review verdict Q3.).
- [ ] **Step 2 — Compile `WASM-VIG`, `WASM-APSD`, and `IB-AMP` Kernels into `rust/verisieve-media` (`verisieve_media.wasm`):**
  - Implement in `#![no_std]` Rust (`rust/verisieve-media/src/`):
    1. `vs_media_perceptual_dhash64` (`64-bit` dHash + edge/entropy score for `IB-AMP` submodular triage).
    2. `vs_media_segment_layout_regions` (connected-component & projection-profile table/chart/diagram box + arrow detector).
    3. `vs_media_invert_chart_series` (least-squares axis tick calibration + RGB bar/line series value extractor).
    4. `vs_media_analyze_prosody_and_diarize` (YIN pitch $F_0$, 12-band spectral timbre, emphasis/question prosody, and zero-allocation online speaker clustering).
  - Run `cargo test --manifest-path rust/verisieve-media/Cargo.toml`, compile `vendor/wasm/verisieve_media.wasm` (strictly keeping `imports.length === 0` and `< 215 KB`), sync to `../Rtio/frontend/public/wasm/verisieve_media.wasm`, and expose in [src/media-wasm.js](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/src/media-wasm.js).
- [ ] **Step 3 — Upgrade `.pptx`/`.pdf` Vector Diagram & Chart Parsers + Auto-SQL Table Bridge:**
  - Upgrade `parsePptxBuffer` in [src/enterprise-parsers.js](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/src/enterprise-parsers.js) to extract `<p:cxnSp>` connector arrows (`diagramEdges`) and `ppt/charts/chart*.xml` numeric series (`chartSeries`).
  - Wire perceived tables (`.xlsx`, HTML, PDF grids, raster tables, and chart series) in [src/perceive.js](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/src/perceive.js) into `verisieve_sql.wasm` ([src/sql-wasm.js](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/src/sql-wasm.js)) so every `perceive()` / `perceiveMulti()` result exposes `.querySql(sql)` and structured relational summaries.
- [ ] **Step 4 — Wire Deictic Audio-Visual Grounding & `IB-AMP` Submodular Triage into `src/perceive.js`:**
  - Implement `selectSubmodularPerceptionUnits` (`IB-AMP`), `resolveDeicticCrossModalBindings` (`WASM-APSD`), and emit a full **`omnimodalSceneGraph`** (`nodes`, `diagramEdges`, `chartSeries`, `relationalTables`, `speakerTurns`, `deicticBindings`) from `perceive()` and `perceiveMulti()`.
- [ ] **Step 5 — Run `Argon-Perceive-Bench` (`scripts/eval-argon-parity-benchmark.mjs`) & Update Papers / README:**
  - Build and execute `scripts/eval-argon-parity-benchmark.mjs` across all 6 multimodal workspaces, comparing Flat Text/OCR Baselines vs. Versieve Phase II against the Gemini Argon Reference Oracle (`results/argon-parity-benchmark.json`).
  - Add TDD unit tests in [test/track-e-multimodal-enterprise.test.js](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/test/track-e-multimodal-enterprise.test.js), update Paper 2 (`paper/verisieve-multimodal-sanitization-benchmark.tex`) and [README.md](file:///c:/Users/GEYE%20ARDIANSYAH/Downloads/Innovation%20Hub/matilda-portable/README.md), verify `npm run test:ci` + `node bin/verisieve.mjs audit-wasm`, and commit.

---

## 4. Hygiene & Architecture Guardrails (Non-Negotiable)

1. **Zero Host Imports (`imports.length === 0`):** All 5 WASM binaries in `vendor/wasm/` must remain 100% `#![no_std]` with zero host imports (`node bin/verisieve.mjs audit-wasm` $\to$ `allVerified: true`).
2. **Zero Hardcoded User Paths:** Never hardcode `C:/Users/...` in `src/`, `scripts/`, `test/`, `bin/`, or `demo/` (enforced by `test/t9-portable-benchmarks.test.js`).
3. **Clean-Room Naming:** Never mention internal reverse-engineering tool names in any repository file.
4. **Honest Scientific Reporting:** Report exact measured parity numbers (`% of Argon Oracle`), error bars, and genuine boundaries where a `< 500 KB` deterministic/micro-model engine excels (exact SQL table joins, vector diagram topology, pixel-calibrated chart series, acoustic $F_0$ prosody, zero-egress speed) versus where open-world VLM semantic reasoning is still complementary.
