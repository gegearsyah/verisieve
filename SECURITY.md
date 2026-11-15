# Security Policy & Zero-Egress Guarantees

VeriSieve is engineered specifically for privacy-critical and sovereign AI environments where untrusted or sensitive unstructured documents (clinical PDFs, financial statements, emails, and scanned archival forms) must be processed **locally at the source with mathematical guarantees of zero data leakage**.

## Zero-Egress Architecture Guarantees

1. **Zero External Runtime Dependencies**:
   - The entire VeriSieve core library, CLI, and HTTP server are written using standard Node.js runtime primitives with **0 npm dependencies**.
   - No supply-chain vector can inject phone-home telemetry or egress sockets into the execution environment.

2. **WebAssembly Zero-Network-Import Static Census**:
   - The embedded OCR WebAssembly runtime (`cactus.wasm`) is mathematically audited via `npm run audit-wasm`.
   - Native WebAssembly reflection (`WebAssembly.Module.imports`) confirms that of all imported functions, **zero** represent network sockets, HTTP clients, disk I/O, or browser DOM interfaces. All imported functions are strictly localized memory/arithmetic primitives.

3. **Untrusted Data Isolation**:
   - External raw files and downloaded benchmark datasets are quarantined under `results/untrusted-benchmarks/`.
   - Parsing buffers are strictly validated with bounds checking to prevent buffer overflow attacks.

4. **Cryptographic Provenance with PII Payload Stripping**:
   - The `AuditChain` implements an append-only SHA-256 tamper-evident provenance log.
   - To guarantee that sensitive unmasked PII cannot be exfiltrated through log inspection or telemetry payloads, the audit logger automatically strips raw text, tables, and rows (`.raw`, `.data`, `.rows`) before computing cryptographic node hashes and training receipts.

5. **Client-Side Conformal Risk Boundary**:
   - The LTT gatekeeper classifies chunks into `KEEP_SAFE`, `DROP_OR_QUARANTINE`, or `ABSTAIN_HUMAN_REVIEW` before any token is passed to external foundation models, ensuring personal data and noisy OCR junk are stopped at the perimeter.

---

## Verifying Zero Egress

You can audit the repository's zero-egress state at any time with:

```bash
# Verify WebAssembly artifact has zero network imports
npm run audit-wasm

# Verify test suite and tamper detection
npm test
```

---

## Reporting a Vulnerability

If you discover a security issue or privacy concern within VeriSieve, please report it responsibly by contacting the maintainer directly via GitHub Security Advisories or email at `gegearsyah@gmail.com`. We respond to security inquiries within 48 hours.
