# Company-Brain Market Landscape — Versieve (research note, 2026-11-24)

Primary-source market research for the "Versieve Company Brain" thesis: 100% client-side, zero-egress ingestion of a company's entire data estate → (1) perfect capture, (2) cross-source connection graph, (3) zero cloud egress, (4) training-ready exportable artifacts with certified zero PII leakage.

Method note: every entry below was checked against vendor docs/pricing pages or regulator/vendor press sources. Items marked **[unverified]** could not be confirmed on a primary page during this session and should be re-checked before use in external material.

---

## 1. Landscape table

| Vendor / stack | What it ingests | Where the data goes | Training-ready export? | Cross-source connection graph? | Client-side? |
|---|---|---|---|---|---|
| **Glean** | 100+ SaaS connectors, on-prem file shares via connector runtime | Glean cloud (GCP) index; **VPC deployment** on Enterprise plans keeps index in customer's AWS VPC | No — retrieval only | Internal people/knowledge graph powers ranking **[vendor claim; page 404'd this session — re-verify at glean.com]** | No (VPC ≠ client-side) |
| **Hebbia Matrix** | Folder drop of PDFs/transcripts/emails into "columns" | Vector DB in Hebbia's cloud; customer-managed KMS keys (AWS/GCP/Azure), VPC option, SOC 2 Type II | No — analysis/citations only | No (table/workflow UI) | No |
| **Dust** | SaaS connectors via OAuth (read-only) | Dust cloud; US/EU residency per provider | No | No | No |
| **Amazon Q Business** | ~50 connectors incl. DBs, wikis, cloud storage | AWS Q index (one index per tenant per region); Claude/Mistral paths **cross regions** | No | No | No |
| **Microsoft 365 Copilot** | Microsoft 365 tenant content via Graph | Inside tenant boundary; semantic index de-identified/pseudonymized; "not used to train foundation models" — learn.microsoft.com/copilot/microsoft-365/microsoft-365-copilot-privacy | No | No | No (still Microsoft cloud) |
| **Gemini for Workspace** | Workspace apps | Google cloud; "do not use your prompts/responses to train our AI models" — workspace.google.com/ai; admin opt-in caveat reported | No | No | No |
| **Elastic Enterprise Search** | Customer's own connectors | **Self-managed option**: docs.elastic.co/guide/en/enterprise-search/8.18/self-managed.html (own DC/private cloud) — genuinely on-customer-infra, but still a server, not browser/client-side | No | No | Partially (self-hosting only) |
| **Pinecone / LlamaIndex (DIY)** | Whatever the builder feeds it | Pinecone cloud ($50/mo Standard + usage credits, pinecone.io/pricing); LlamaIndex Cloud is custom-priced | No — retrieval infra only | No | No |
| **Cognistx SQUARE** | Documents, sites, DBs, images | On-prem/private-cloud deployment offered (cognistx.com) | No | No | Partially (server on-prem) |
| **Exa** | The **public web**, not company data | Exa cloud API | N/A | N/A | No (different category entirely — not a company-data competitor) |
| **Onna** | Slack, email, Zendesk, Jira, GitHub, Zoom, etc. | Onna cloud, retention policies, EDRM/JSON/PDF export | Export is raw records (eDiscovery), not training corpora | No | No |

### 1b. Data-prep / synthetic-data vendors

| Vendor | What it does | Where data goes | Training-ready export? | Client-side? |
|---|---|---|---|---|
| **Tonic Textual** | Parse PDF/DOCX/PPTX/HTML → structured format; PII redact/synthesize; outputs JSON/JSONL for fine-tuning (blogs: redacting a JSONL fine-tune set then uploading to OpenAI FT endpoint) | Tonic cloud SaaS; **$0.04/page** Pro, free tier 500 pg/mo (tonic.ai/pricing) | **Yes — this is the closest existing "training-ready corpus" vendor** | No |
| **Cleanlab Studio** | Finds/fixes label errors, outliers, dupes in text/tabular/image/audio; curates RAG & instruction-tuning eval sets (cleanlab.ai) | Cloud | Yes (curated datasets) | No |
| **Gretel** | Synthetic tabular/text data; states "We train in your environment. Never expose your data externally" — Docker/trainer runs in customer VPC or laptop (gretel.ai blog), open-source Apache 2.0 trainer | Model training in customer env; synthesis can be local | Synthetic corpora, yes | Partially (trainer runs locally, but it's a server-side tool, not browser/client-side) |
| **Mostly AI** | Synthetic data for banking/insurance/telco; on-prem/VPC "data never leaves" positioning **[vendor positioning; verify directly]** | Customer VPC/on-prem | Synthetic corpora | Partially |
| **Datology AI** | Automated data curation for **frontier model labs** ($46M Series A, TechCrunch Feb 2025) — not a corporate-estate product; curation happens as a service | Vendor side | Curated subsets | No |
| **Scale / Surge** | Human annotation + enterprise data | Vendor side | Annotated corpora | No |

### 1c. Privacy / redaction tooling

| Vendor | What it does | Client-side? |
|---|---|---|
| **Presidio (Microsoft)** | Open-source PII detect/redact/mask/hash/encrypt (Analyzer + Anonymizer + Image Redactor), ~30 recognizers, extensible NER (github.com/microsoft/presidio). Runs wherever you host it — but it is a **component**, not a whole-estate product | Toolkit — you host it |
| **Private AI** | PII/PHI/PCI redaction API; <15MB model deployable **on-prem/air-gapped/in-VM — "PII never leaves your secure environment"** (private-ai.com). $25M Series A | Yes (can be fully local) — but redaction only, no ingestion, no connection graph, no training corpus |
| **Skyflow LLM Privacy Vault** | Tokenizes PII before prompts hit external LLMs; detokenizes on output; region residency (skyflow.com) — vault is a **cloud service** | No |
| **Nightfall** | Inline DLP for AI agents/MCP/shadow-AI — detects and **blocks**, not redact-and-export (nightfall.ai) | No |

### 1d. Open-source / local-first

| Stack | Notes |
|---|---|
| **Docling (IBM/LFAI)** | MIT-licensed document parser; explicitly markets "Local execution capabilities for sensitive data and air-gapped environments"; PDF/DOCX/PPTX/XLSX/HTML/audio/**video**/email; exports Markdown/HTML/JSON (github.com/DS4SD/Docling). This is the closest open-source overlap with Versieve's ingestion layer — but it is a **parser**, no graph, no redaction certification, no training-artifact pipeline |
| **Unstructured.io** | 50 formats → RAG JSON/Markdown; OSS lib + hosted platform (per-page pricing) and AWS Bedrock pay-per-1k-pages; hosted path means data leaves |
| **h2oGPTe (H2O.ai)** | Enterprise RAG marketed as air-gapped/on-prem with offline LLM backends **[vendor positioning — re-verify on docs.h2o.ai]** |
| **Ollama/WebLLM stacks** | Fully local inference; DIY — no ingestion estate, no export, no graph |

---

## 2. Buyer pains, ranked (with sources)

1. **"Data leaves our perimeter / can't prove what leaves."** Gartner's June 2025 press release: across 30+ Gen-AI surveys since April 2023, **data security and privacy was the top-placed obstacle** to Gen-AI implementation in most surveys (gartner.com newsroom; earlier survey: 53% named it #1, via CIO Dive). Samsung is the canonical story: three confidential-code/meeting leaks to ChatGPT in 20 days → company-wide generative-AI ban, May 2023 (CNBC/The Economist Korea).
2. **"Can't get data AI-ready / governance gap."** Snowflake 2025 State of AI Data Governance (1,500+ leaders): 96% feel pressure to adopt AI, only 27% have AI in production; **92%** say weak AI data governance creates security/privacy/legal risk; 87% said their data is not AI-ready; 86% cite security/compliance as top scaling barrier (snowflake.com press materials; DBTA/Techzine coverage).
3. **"Fine-tuning on our own data is feared, not done."** HN practitioner commentary mirrors pain #1 — e.g., a commenter on the "era of the enterprise LLM stack" thread: *"But no way I'm sending our confidential customer data to some random cloud service and their fine-tuning pipeline"* (HN item 48308457 — quote from search index; thread fetch showed limited comment visibility this session, treat as directional).

Regulatory backdrop that makes pain #1 structural: **EDPB Opinion 28/2024** (Dec 17, 2024) — a model may only count as anonymous if there is zero likelihood of outputting personal data; legitimate interest for training requires documented three-step balancing (edpb.europa.eu). **Garante fined OpenAI €15M** (Dec 2024) in part for lacking a legal basis for training on personal data. Both mean enterprises training on employee/customer data carry real, quantified fine risk — the compliance story is not hypothetical marketing.

---

## 3. Wedge verdict

**(a) Is anyone selling "client-side, zero-egress, whole-company ingestion"?** No — as a product category. Nearest neighbors are all *server-side*: Glean VPC (index in customer's cloud, still Glean-run infra), Gretel/Mostly AI (training runs in customer env, but synthetic-data niche, no whole-estate capture), Private AI (redaction only, no estate ingestion), Elastic self-managed (search only), Docling (parser library). "Zero-egress RAG" exists as an architecture **pattern** written up by practitioners (opends.ai/zero-egress-rag, katanaml.io) — i.e., the demand is articulated, but no vendor productizes it end-to-end, and nothing runs *in the browser*.

**(b) Is anyone selling "training-ready corpus + visualization of connections" as one deliverable?** No. Tonic Textual ships training-ready JSONL but only for documents fed to it, unilaterally, no graph. Data-lineage vendors (Atlan, Collibra, Alation, IBM/Manta) ship cross-department graph visualization but for **structured pipelines/metadata** — nobody connects the unstructured estate (meetings, decks, PDFs, email) into a connection graph *and* exports a training corpus from it.

**(c) Is anyone selling *certified* zero-leakage training data?** No. Presidio/Private AI/Tonic redact with accuracy claims (Tonic: "~99% precision" [vendor claim]); none offer a **certification** of zero PII egress — and post-EDPB, "we redacted it" is weaker than "the processing never left your perimeter and the artifact is certifiably de-identified." The certification layer is genuinely unserved.

**Verdict:** The wedge is the **conjunction of pillars 3+4**: certified zero-PII training artifacts produced where the data lives (client-side), with the connection graph as the *visual proof of work* that makes the trust claim inspectable. Pillar 3 alone is crowded (VPC/on-prem everyone); pillar 4 alone is crowded (Tonic/Cleanlab/Gretel); 3+4 together, whole-estate, client-side, is unoccupied. Pillar 3 is the *mechanism* that makes the certification (pillar 4) defensible — you can certify "zero PII egress" credibly only if no egress happens at all.

**Top 3 defensible claims:**
1. Only product delivering whole-company training artifacts **with zero cloud egress by construction** (verified: no competitor pairs these).
2. Certified zero-leakage export (post-EDPB compliance artifact) — redaction vendors stop at "we redacted."
3. Cross-department connection graph over the **unstructured** estate — lineage vendors do structured metadata only.

**Pricing anchors:**
- Per-seat knowledge/RAG: Glean list ~$100/user/yr; deals reported $40–$100/user/yr at volume (Glean pricing page/G2; sales-quoted, not fully public). Pinecone $50/mo + $1 per 1k read/write units.
- Per-page data prep: Tonic Textual $0.04/page ($40/1k pages) Pro, 500 free pages/mo; Unstructured per-page custom / Bedrock per-1k-pages; Reducto ~$0.028/page, Grid ~$0.036/page (community comparisons).
- Enterprise curation (Datology $46M A; Scale/Surge custom) — priced as frontier-lab service, irrelevant anchor for mid-market.
→ Versieve pricing implication: anchor between per-seat RAG (Glean) and per-page prep (Tonic); lander could be flat-rate per-estate since zero-egress means near-zero marginal cloud cost.

---

## 4. Failure modes / compliance ammunition (for marketing, and validating the mechanism)

- **Samsung, May 2023:** 3 confidential-code meeting-transcript leaks to ChatGPT within 20 days → company-wide ban on generative AI on company devices/networks; Samsung pivoted to in-house tools (CNBC, The Economist Korea). This is the exact event that creates Versieve's buyer.
- **Italy, Dec 2024:** Garante fined OpenAI €15M — insufficient transparency and lacking legal basis for training data processing; ChatGPT had been temporarily banned in Italy (March 2023) (Reuters/press coverage).
- **EDPB Opinion 28/2024:** training on scraped personal data can rest on legitimate interest only after documented balancing; model anonymization requires zero likelihood of PII output (edpb.europa.eu). Enterprise training-artifact vendors must survive this test — Versieve's client-side + certified-redaction design is built for it.
- **Gartner (May 2024 / 2025 releases):** data privacy/security cited by 53%+ as top Gen-AI barrier; hesitancy factors are ROI difficulty, privacy risk, and cost — Gartner's own framing matches Versieve's three-part pitch.

---

## 5. What the market does NOT want (trap list)

1. **Another SaaS "ask your company anything" chatbot.** Glean, Hebbia, Dust, Q Business, Copilot, Gemini own that conversation with distribution and money. Entering as a chat UX invites comparison on polish, not on trust.
2. **"VPC-deployed" as the privacy story.** Glean already says VPC; h2oGPTe, Gretel, Mostly say on-prem. VPC/on-prem is table stakes credibility, not differentiation — the differentiator must be *client-side/browser* + certification, not self-hosting.
3. **Selling to labs/frontier teams.** Datology, Scale, Surge already serve model labs; corporate data estates are the unserved buyer.
4. **Web-scraping framing.** Exa owns "AI web search"; Versieve is about the company's *internal* estate — keep the boundary explicit or the EDPB web-scraping baggage transfers to you.
5. **Un-auditable accuracy claims.** Tonic's "~99% precision" and Private AI's "<15MB model" are vendor claims; EDPB's zero-likelihood anonymity standard means marketing "certified" requires a published, reproducible evaluation harness — otherwise the certification claim is the product's first redacted liability.
6. **Raw-record export as "training-ready."** Onna already exports EDRM/JSON for eDiscovery at scale; "training-ready" must mean model-ready (deduped, redacted, JSONL, provenance-tagged), not just exported files.

### Gaps / unverified items to close in a follow-up pass
- Glean's "knowledge graph" marketing page (404 this session) — re-verify before claiming Glean has no user-facing connection visualization.
- Hebbia SOC 2 report and DPA (vendor marketing only).
- Mostly AI on-prem claims — vendor positioning, re-check mostly.ai.
- h2oGPTe air-gap specifics — docs.h2o.ai.
- Direct HN thread fetch (item 48308457) surfaced limited comments; the quoted comment came from search indexing — use directionally, not verbatim in external copy.
