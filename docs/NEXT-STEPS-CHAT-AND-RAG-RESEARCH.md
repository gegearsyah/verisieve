# Next Steps & Open Research: Redacted RAG Verification vs. Maincode / Matilda Retraining Loop

- **Status:** Draft Research Note & Queued Next Steps (Implementation intentionally deferred pending validation with Maincode / Luke)
- **Date:** 2026-11-16
- **Context:** Sibling UI (`Rtio/frontend`) now includes a `Chat` tab (`Clean -> Data -> Chat -> Train`) plus inline `Data` row editing, live PII checks, `IndexedDB` local learning (`rtio-verisieve-local-v1`), and reusable `rtio-dataset.json` / `rtio-filter.json` exports. This note records what is verified, whether RAG is actually necessary for Maincode's pipeline, and the concrete next steps if verified RAG belongs in the loop.

---

## 1. Key Research Question: Is RAG Even Necessary for the Maincode / Matilda Pipeline?

### What Maincode / Matilda Publicly Does (Observed Primary Sources)
Based on public documentation (`maincode.com`, `matilda.com`) and the two customer problems identified with Luke:
1. **Matilda & Matilda Train (Sovereign Fine-Tuning & RL):** Private organizational deployments trained/retrained on local/Australian sovereign GPU clusters (`https://train.matilda.com/mcp/research`, MCP-first job validation via `research_validate`, open-weight fine-tuning, and RL/MCPO post-training algorithms).
2. **Customer Correction & Retraining Loop:** Organizations improve private models over time using their own internal documents and people's ongoing **corrections**, while keeping sensitive data isolated.
3. **VeriSieve / MLE Pitch to Luke:** Focuses on **pre-training / retraining preparation** inside the customer boundary:
   - **Problem 1 (Unstructured Data):** Deterministic, reproducible capture -> strip boilerplate -> dedup -> mask `<PII:...>` -> tokenize -> emit manifest + clean shards **before** data enters Matilda Train.
   - **Problem 2 (Client-Side Gatekeeping):** Tiny on-device models (`verisieve_dl.wasm` + `Safe · Useful · Topic` LTT conformal calibrator) that learn from customer labels/corrections locally and decide which chunks are safe and high-signal to enter the retraining loop.

### Verdict: Core Necessity vs. Supporting Role

| Question | Honest Verdict | Reasoning |
| :--- | :--- | :--- |
| **Is RAG strictly required for Maincode's retraining-loop integration?** | **No.** | The core integration with Matilda Train / Matilda Code needs **deterministic capture & cleaning** (`ingest_and_tokenize`, `ingest_url_or_links`), **PII safety verification**, and **client-side curation / correction filtering** (`train_multiaxis_gatekeeper`, `gatekeeper_decide_multiaxis`, `rtio-train.jsonl`, `rtio-manifest.json`), NOT a chatbot. |
| **Why keep Redacted RAG (`Chat` tab & `verisieve_dl.wasm` Needle) as an optional companion?** | **High diagnostic & hybrid value if validated.** | 1. **Human Sanity-Check Demo:** Dropping a messy PDF/CV and asking a question proves immediately that `<PII:...>` redaction preserved usable semantics without leaking raw emails/SSNs.<br>2. **Hybrid Production Stack:** Organizations often pair fine-tuned models (weights for behavior/workflows) with external retrieval for volatile docs; VeriSieve already proved (`docs/CLAIM-AUDIT-AND-MOAT-ANALYSIS.md` Test 5 & `matilda-portable` Needle R@5 `60.0%`) that pre-filtering removes noisy scan/boilerplate distractors from retrieval too.<br>3. **Human-in-the-Loop Triage:** Reviewing bad RAG answers in `Chat` is a natural way to spot bad source chunks and feed corrections back into the gatekeeper. |

**Positioning Recommendation Until Confirmed with Luke:**
- Lead with **Deterministic Unstructured Curation + Client-Side Conformal Retraining Gate (`Clean -> Data -> Train`)** as **P0** for Maincode.
- Treat **`Chat` (Redacted RAG)** as **Optional / Interactive Triage Mode**, and confirm directly with Luke before investing engineering sprints into full RAG verification infrastructure.

---

## 2. Current RTIO `Chat` Baseline vs. Missing Grounding Guarantees

In `Rtio/frontend/lib/verisieve/sandbox-chat.ts` and `ChatTab.tsx`, the current `Chat` pipeline executes 5 steps:
1. **Input Quarantine (`retrieveRedactedContext`):** Strictly excludes `DROP_OR_QUARANTINE` rows and `raw_excerpt`; searches only `masked_text` (`KEEP_SAFE`, plus opt-in `ABSTAIN_HUMAN_REVIEW`).
2. **Hybrid Local Ranking:** Combines `verisieve_dl.wasm` (`searchNeedleWasm`, 64-dim) with keyword overlap (`0.55 * sem + 0.45 * lex`), selecting top `6` chunks within `12,000` characters (`[1]..[6]`).
3. **Grounded Prompt (`buildSandboxRagMessages`):** Instructs the model (`temperature = 0.2`) to answer strictly from `[1]..[6]`, never guess hidden `<PII:...>`, and include `[n]` citations.
4. **Local or BYOK Execution:** Streams via loopback Ollama (`http://127.0.0.1:11434/api/chat`) or user BYOK keys encrypted in IndexedDB (`keyVault` / `llmRouter`).
5. **Visual Traceability Only:** Renders a collapsible `"Grounded in X redacted excerpt(s)"` drawer so a human can manually compare answers against the cited excerpts.

### Honest Gaps in Answer Verification Today
1. **Outbound question and history are masked.** `checkTextForPii` rewrites the current question and the last eight stored turns, including a `name_likely` hit, before Ollama or a BYOK call. The transcript on screen stays as typed. Ranking still uses the raw question, so a masked token is not what the search sees.
2. **No retrieval floor.** `retrieveRedactedContext()` still returns up to `topK = 6` with no minimum score. On the 125 held-out PubMedQA questions, 0 of 125 hybrid top scores are below 0.15 and 1 is below 0.30 (`docs/2026-11-16-rag-redaction-verdict.md`). That set has a gold passage for every query, so it does not set an abstention cutoff.
3. **Citation index check only.** After streaming, the drawer says when an inline `[n]` is outside `1..chunks.length`. Nothing yet checks that the sentence is supported by chunk `n`.
4. **Disconnected Citation Feedback:** Users cannot click *"Bad/noisy chunk -> Drop"* on a `[n]` citation inside `Chat` to feed `IndexedDB` local learning (`learnAndPersistLocalModel`) directly.

---

## 3. Open Research Questions (To Validate Before Building RAG Verification)

1. **Maincode Pipeline Consumption:** Does Maincode's retraining loop ingest only cleaned training batches (`.jsonl` / `.parquet` + `manifest.json`) + `Safe/Useful/Topic` calibration models, or do Matilda Workspace deployments also bundle per-tenant RAG retrieval indices?
2. **Matilda Code MCP Boundary:** Which local guarantees would Matilda Code actually invoke via MCP (`matilda-portable/src/mcp-server.js` currently exposes 8 tools)? Specifically, would Matilda Code call a pre-prompt PII scrubber / chunk gatekeeper (`gatekeeper_decide_multiaxis`), or would it also call a redacted retrieval / citation-verification tool?
3. **AI-in-the-Loop vs. Deterministic Audit:** For enterprise compliance teams evaluating Matilda/VeriSieve, do they want **zero-AI retrieval + conformal abstention** cleanly separated from any optional LLM layer so hallucination risk never contaminates training-data certification claims?
4. **Needle 64-dim ceiling vs. lexical, measured on the 125.** Cosine-only recall@5 is 75/125 (60%). The sandbox blend is 120/125 (96%), and lexical alone is 123/125 (98.4%), because these questions repeat the passage (`docs/2026-11-16-rag-redaction-verdict.md`). BM25 and a downloaded embedding were not run. A local VeRA reorder of the blend's top 30 drops gold-in-top-6 from 121/125 to 39/125.

---

## 4. Queued Engineering Next Steps (If Confirmed Useful for Maincode)

Should follow-up research / feedback from Luke confirm that **Verified Redacted RAG** adds value alongside the core curation & gatekeeper pipeline:

- [x] **Step 1 — Question-side and history PII redaction (`sandbox-chat.ts`):** The current question and earlier turns are masked, including `name_likely`, before Ollama or BYOK. The on-screen transcript stays as typed. Ranking still uses the raw question.
- [ ] **Step 2 — Calibrated weak-retrieval abstention (`ABSTAIN` before generation):** A floor was counted on the 125 PubMedQA questions (0/125 hybrid top scores below 0.15, 1/125 below 0.30). Do not install a cutoff from that set. An abstention rule needs questions whose passage is absent.
- [ ] **Step 3 — Sentence support check:** The drawer now marks an inline `[n]` that is outside `1..chunks.length`. A sentence-level overlap score against the cited chunk is still open. Do not label that heuristic as a conformal LTT guarantee unless it is calibrated on a labeled QA set.
- [ ] **Step 4 — Citation -> Correction Loop (`Chat` -> `Data` / `IndexedDB`):** Allow users to flag unhelpful or leaky chunks directly inside the `Chat` citation drawer (`Mark Removed & Learn`), updating `user_corrected` rows and `rtio-verisieve-local-v1` IndexedDB memory in one click.
- [ ] **Step 5 — Portable MCP / CLI Parity Test (`matilda-portable`):** If promoted into `matilda-portable`, expose a cleanly separated retrieval/verification helper alongside the 8 existing MCP tools in `src/mcp-server.js` (coordinated after `fix/spec-15-remediation` merges cleanly) without altering core zero-egress LTT training/certification receipts.
