# Prompt-Boundary Gateway: Feasibility Against Versieve (research note, 2026-11-25)

**Question.** Instead of an extraction-and-redaction library, should Versieve become a gateway between the user's prompt (text, attachments, audio, tool payloads) and any AI chat or agent, redacting keys and passing only task-necessary context?

**Verdict in one line.** The redaction half is a crowded security-product category that Versieve is not currently built to survive; the "only the necessary thing" half is the read path of the Company Brain and is the only differentiating part. Do not reposition the product around the gateway.

**Decision (2026-11-25, founder).** Not a repositioning and not a context compiler. Scope is redaction only, as a small additional capability: one-way, no re-identification, no proxy, no streaming rewrite. See section 8.

---

## 1. The idea is two ideas

| Half | What it actually does | Status |
|---|---|---|
| "Redact the keys" | Replaces direct identifiers with tokens before egress, optionally re-identifies the response | Commodity. Skyflow LLM Privacy Vault, Nightfall, Private AI, Presidio, LLM Guard and every gateway's guardrail hooks already sell it |
| "Only the necessary thing" | Selects the minimum estate context that answers the request, with identity resolved across sources | Differentiated. This is `pprRetrieve` + `buildCagDossier`, i.e. the read path of the Company Brain |

Redaction preserves information content minus identifiers. Minimization removes information. They share a pipeline but solve different problems: the first is a privacy control, the second is a context-quality control. The friend's sentence merges them, and the value sits in the second.

## 2. What the repo already supplies

- `redactEnterpriseText` (`src/secret-scanner.js:173`): deterministic WASM plus regex pseudonymization, stable per-entity token, no network. Measured in-session: **0.86 ms average for a 2,076-character prompt** over 200 iterations on this machine (warm, Node 22). Text-path latency is not the problem.
- `scanEnterprisePiiAndSecrets` (`src/secret-scanner.js:64`): structured secret detectors (AWS, OpenAI, GitHub PAT, JWT verified).
- `perceiveMulti` / `perceive`: 12 file types, OCR, ASR, pixel blackout, forensic hidden channels. Attachment redaction exists, but at seconds per file, not inline.
- `pprRetrieve` (`src/graph-wasm.js:902`): query to entity-seeded PPR plus BM25 fusion, returns redacted passages with breadcrumbs.
- `buildCagDossier` (`src/cag-dossier.js:80`): token-budgeted, provenance-tagged dossier of KEEP_SAFE blocks.
- `decideMultiAxisGatekeeper` (`src/gatekeeper.js:374`): safe / useful / topic decisions with finite-sample calibration.
- MCP server (`src/mcp-server.js`): 18 tools, including secret scan, graph ingest, PPR retrieve, audio redaction.

A minimum text gateway is roughly a hundred lines over these. That is the trap: the primitives are cheap, the product is not.

## 3. What the repo does not supply, and why it matters

**(a) Re-identification does not exist, by design.** `SaltedPseudonymVault` (`src/graph-wasm.js:197`) stores `entity_id`, `display_token`, `pii_kind`, `mention_count`. It never stores the raw value. `redactEnterpriseText` returns spans but not values either. Masking is one-way. Re-identifying the model's answer requires a new raw-to-token map, held client-side, which is exactly the artifact the paper review flagged as "a personal-data store in its own right" (`docs/review/paper4-round1/seat-4-cross-disciplinary.md`). Adding it changes the threat model of the whole engine.

**(b) Detector recall is the product in a gateway.** The repo's own outbound-chat probe (`docs/2026-11-16-rag-redaction-verdict.md`) measured regex recall on prompt-like text: contact 83.6%, bare names 47.1%, structured tags 30.7%. In-session spot checks missed `Please ask Marco to review the deck.` (bare first name) and generic assignments (`db_password = Zx9!kP2mQ7vR4t`, `api_secret: ...`). In a batch corpus a miss is bounded by the gate and human review. In a gateway a miss is a live leak to a third party, and the first thing a buyer's security team will test. GLiNER-class neural spans lift this, at tens to hundreds of milliseconds per prompt and a model to ship.

**(c) Streaming and structure.** Re-identification over a token stream must handle tokens split across chunks (`<PII:PERSON_01>` arrives in pieces). Tool-call JSON is worse: if an agent needs to send an email or call an API, redacting the address or identifier breaks the call. The agent either fails or the gateway must let real values through, and then it is not a privacy boundary. Redaction gateways work for chat Q&A; they do not work for acting agents. That is a scope limit, not an implementation detail.

**(d) Attachments are lossy and slow.** To keep a PDF/DOCX safe for an external model you must re-render or rewrite the bytes. Pixel blackout is proven in-repo, but it costs a render and loses fidelity; audio and video scrub costs seconds to minutes. Fine for a batch corpus, not fine on the send button.

**(e) The perimeter moves to you.** A proxy or extension through which every prompt passes is the highest-value target in the deployment. It needs fail-open or fail-closed policy, availability, signed updates, and a supply chain story. This is a security appliance business, not a library.

**(f) "Necessary" is not decidable inline in general.** `pprRetrieve` returns top-6 by relevance, not a proof of sufficiency. A gateway that drops context can silently make answers worse, and the user cannot tell.

## 4. Surfaces and their failure modes

| Surface | Covers | Fails at |
|---|---|---|
| SDK / fetch wrapper | code you control | nothing else; no distribution |
| Local OpenAI-compatible proxy | API agents, BYOK apps | web chat UIs; TLS interception is a non-starter; install friction |
| Browser extension | ChatGPT / Claude / Gemini web | DOM and streaming fragility; API and desktop agents bypass it; broad permissions |
| MCP proxy | Claude Code, Cursor and MCP agents | already-composed context; tool arguments must stay real |
| Desktop / email | the largest real leak surface | highest build cost, platform per platform |

The cheapest surface that matches this repo is an MCP tool or proxy, because one already ships. The most valuable surface is the browser, because that is where people paste things, and it is also the most hostile engineering environment.

## 5. Fit with the product definition

The binding definition (`docs/research-notes/`, memory `versieve-product-definition`) is the client-side Company Brain: perfect capture, cross-source connection, zero egress, training artifacts. Privacy is the quiet default, never the pitch (`versieve-privacy-default-quiet`). A redaction gateway inverts both: its only reason to exist is the privacy promise, and it is a second product with a different buyer, different reliability bar, and a different sales motion.

The reframe that fits: the gateway is not a firewall, it is the **question-time read path** of the same brain. Ask a question, resolve it to entities, pull the graph-minimal context, redact quietly, answer. That reuses `pprRetrieve`, `buildCagDossier`, the entity graph and the vault. It also stays clear of the "ask your company anything chatbot" trap already documented in the market note, because the artifact is the context packet, not another chat UI.

## 6. Cheapest test that would actually decide this

Do not build a proxy first. Measure utility cost on 50 to 100 real prompts:

1. Answer each prompt with the raw context and with the redacted context, same model, blind judge.
2. Record the drop in answer quality and the rate at which the task needs a redacted value back.
3. Record detector recall and latency per prompt.

If utility loss is small and recall is high, a gateway is defensible. If utility loss is large, the honest product is a per-send privacy mode, which is a feature, not a company. If recall is below ~90% on the identifier types the buyer cares about, the gateway is a liability in its first security review.

## 7. Decision: what the cute capability is

`redactEnterpriseText` (`src/secret-scanner.js:173`) already is the capability. It takes text, returns masked text plus an entity legend with spans, keeps no plaintext, and runs in under a millisecond. The addition is a named surface, not a new engine:

- **Library:** nothing to build. It is already exported through `src/index.js`.
- **MCP:** one tool, `redact_prompt`, alongside `scan_enterprise_secrets`. Text in, masked text and legend out. No vault handle, no detokenize.
- **CLI:** optional `versieve redact --stdin`, only if shell use is real.

Rules that keep it cute instead of a liability:

1. One-way. No raw-value map, no re-identification. That is what made the gateway design expensive and dangerous.
2. Say "redacts detected PII and secrets", never "safe to paste". Bare-name recall on prompt-like text is 47.1% in the repo's own probe.
3. If prompt text is the target, fix two measured gaps first: bare first names (`Marco`) and generic secret assignments (`db_password = ...`). The existing `neuralSpans` option already accepts GLiNER spans if more recall is wanted.
4. Attachments reuse `perceive` but are seconds per file, so they stay an explicit call, not an implicit part of a send button.

## 8. Claude Code plugin as the surface (verified 2026-11-25)

A plugin is the strongest cheap surface for "the agent never sees detected PII in what it reads", because hooks run in the harness, not in the model. Verified against `code.claude.com/docs/en/hooks`:

| Hook | Block | Rewrite input | Replace result model sees | Add context |
|---|---|---|---|---|
| `PreToolUse` | yes | yes, `updatedInput` (authoritative) | no | yes |
| `PostToolUse` | no undo | no | yes, `updatedToolOutput` / `updatedMCPToolOutput` | yes |
| `UserPromptSubmit` | yes | **no** | n/a | yes |

Consequences:

- **Tool output can be redacted before the model sees it.** One `PostToolUse` hook matching `Bash|Read|mcp__.*` covers every channel the agent reads through, including `cat` and `grep`. The output shape must match the tool's (Bash: `stdout`, `stderr`, `interrupted`, `isImage`); a mismatch is ignored and the original is used. `updatedToolOutput` is version-gated in practice.
- **It is late.** The command already ran, and telemetry keeps the original output. This stops the provider from seeing PII, not the machine from reading it, and not a `curl` from exfiltrating it.
- **The user's typed prompt cannot be sanitized.** `UserPromptSubmit` can block or inject context only. The honest options are block-with-a-message or let it through.
- **Built-ins cannot be rerouted through MCP.** Gating `Read`/`Bash` means a visible `PreToolUse` denial plus a redirect to a plugin tool, not silent substitution.
- **Installing the plugin runs hooks with full user permissions, outside the sandbox.** The redaction plugin becomes a high-value supply-chain target. Enterprise deployments need `allowManagedHooksOnly` and pinned, signed releases.
- **Distribution is cheap.** A git repo plus `marketplace.json`, no submission form; the Anthropic directory is separate and reviewed.

Minimal shape: one plugin bundling `hooks/hooks.json`, a `PostToolUse` redactor calling `redactEnterpriseText`, a `UserPromptSubmit` blocker for detected secrets, one `skills/versieve/SKILL.md`, and optionally `.mcp.json` for `read_redacted` and `scan_text`. No new engine, and it reuses the library's one-way vault.

## 9. Sources and open verification

Repo evidence above is cited by file and line. Incumbent claims and regulatory drivers in `docs/research-notes/2026-11-24-company-brain-market-landscape.md` (Skyflow, Nightfall, Private AI, Presidio) are one day old and were checked against vendor pages then. The independent web verification run for this note was still in its fetch/verify phase at the time of writing; its confirmed findings should be appended here before this note is used externally.
