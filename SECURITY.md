# Security Policy & Zero-Egress Guarantees

VeriSieve is engineered specifically for privacy-critical and sovereign AI environments where untrusted or sensitive unstructured documents (clinical PDFs, financial statements, emails, and scanned archival forms) must be processed **locally at the source with verifiable zero-egress controls**.

## Zero-Egress Architecture Guarantees

1. **Zero External Runtime Dependencies**:
   - The entire VeriSieve core library, CLI, MCP server, and local UI server are written using standard Node.js runtime primitives with **0 npm dependencies**.
   - The separate RTIO app still depends on `tesseract.js` `^7.0.0` and `@tesseract.js-data/eng`. This repository does not contain that app, and its CI does not inspect it.

2. **WebAssembly Zero-Network-Import Static Census**:
   - All four shipped WebAssembly binaries (`vendor/wasm/verisieve_clean.wasm`, `vendor/wasm/verisieve_dl.wasm`, `vendor/wasm/verisieve_sql.wasm`, and `vendor/cactus/cactus.wasm`) are audited via `npm run audit-wasm`.
   - Native WebAssembly reflection (`WebAssembly.Module.imports`) confirms:
     - `verisieve_clean.wasm` (`13,757 B`): **0 imports**
     - `verisieve_dl.wasm` (`60,096 B`, 23 exports): **0 imports**
     - `verisieve_sql.wasm` (`49,642 B`, ABI v1): **0 imports**
     - `cactus.wasm` (`1,240,671 B`, 21 exports): **16 internal `module "a"` WASI/memory stubs**, **0 network imports**, and **0 host filesystem imports** inside our pure-memory VFS runtime (`hostDiskAccesses === 0`, `networkCalls === 0`).

3. **SSRF, Loopback & Path Traversal Guards**:
   - `scripts/ui-server.mjs` binds strictly to `127.0.0.1` without wildcard `*` CORS headers and enforces `path.relative` traversal containment with explicit `404` responses.
   - `src/ingestor.js` and `ingestFromUrlOrPath` validate schemes and pin resolved DNS addresses against loopback, link-local, RFC1918 private ranges, and cloud metadata IPs prior to HTTP fetch, with redirect re-validation and response byte caps.
   - `verisieve_sql.wasm` and `scripts/duckdb-query.py` enforce strict query/parameter validation (`read_csv_auto(?)`).

4. **Cryptographic Provenance with PII Payload Stripping**:
   - `AuditChain` implements an append-only SHA-256 tamper-evident provenance log.
   - To prevent unmasked PII exfiltration in logs or receipts, raw text/table payloads are stripped and exported excerpts use `redactExcerptWithSha256` prior to persistence.

5. **Fail-Closed OCR & Client-Side Conformal Risk Boundary**:
   - Raster images and image-only scanned PDFs fail closed with `MIRAGE_WEIGHTS_REQUIRED` when local `.cact` vision weights are absent (zero placeholder or hardcoded sample prose).
   - The LTT gatekeeper classifies chunks into `KEEP_SAFE`, `DROP_OR_QUARANTINE`, or `ABSTAIN_HUMAN_REVIEW`, failing closed (`tauKeep = 1.0`) whenever finite-sample calibration bounds cannot be satisfied.

---

## Verifying Zero Egress

Audit the repository's zero-egress state at any time with:

```bash
# Verify WebAssembly artifacts have zero network imports
npm run audit-wasm

# Verify portable CI test suite (or npm test for full 1,207-doc scale + race checks)
npm run test:ci
```

---

## Reporting a Vulnerability

If you discover a security issue or privacy concern within VeriSieve, please report it responsibly by contacting the maintainer directly via GitHub Security Advisories or email at `gegearsyah@gmail.com`. We respond to security inquiries within 48 hours.
