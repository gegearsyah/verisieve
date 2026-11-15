# Contributing to VeriSieve

Thank you for contributing to **VeriSieve**! VeriSieve is an open-source, zero-dependency data sieve, dual PII redactor, and client-side conformal gatekeeper.

## Core Development Principles

1. **Zero External Runtime Dependencies**:
   - The core engine, CLI, and client library must remain zero-dependency.
   - Use native Node.js built-ins (`node:fs`, `node:path`, `node:crypto`, `node:http`, `node:test`, `node:assert`).
   - Do not add packages to `dependencies` in `package.json`.

2. **Zero-Egress & Data Privacy First**:
   - Local document processing must never transmit data over the network.
   - WebAssembly artifacts must have zero network imports and run strictly sandboxed.
   - All provenance hashes must strip raw payload contents (`.raw`, `.data`, `.rows`) prior to hashing.

3. **Client-Side Conformal Guarantees**:
   - Risk control thresholds must be computed using distribution-free Learn-Then-Test (LTT) bounds.
   - Never rely on heuristic confidence scores without statistical error bounds.

4. **Multi-Target Parity**:
   - Any mathematical logic introduced in the TypeScript/JavaScript runtime must maintain bit-for-bit or float32 parity with the single-header C99 implementation in `include/verisieve.h`.

---

## Development Setup

Requirements:
- Node.js >= 22.0.0
- GCC (optional, for C99 single-header parity tests)

Clone and verify local installation:

```bash
git clone https://github.com/gegearsyah/verisieve.git
cd verisieve
```

No `npm install` is required for dependencies!

---

## Running Verification Commands

### 1. Run Complete Test Suite
```bash
npm test
```
Executes all unit tests across the multi-font layout synthesizer, OCR engine, PII masker, conformal gatekeeper, PDF pipeline, and MCP server.

### 2. Run CLI Self-Test
```bash
node bin/verisieve.mjs selftest
```

### 3. Verify Zero-Egress WASM Audit
```bash
npm run audit-wasm
```
Audits WebAssembly binaries to verify 0 network imports and strict offline sandboxing.

### 4. Run Real External Data Benchmark
```bash
npm run demo:real
```
Executes the extraction and gatekeeper pipeline against real clinical research PDFs and scanned archival forms without mock strings.

### 5. Run Micro-Benchmarks & Generate Figures
```bash
npm run bench
```
Benchmarks throughput across PDF extraction, OCR rasterization, PII masking, tokenization, model training, and C99 inference.

### 6. Start Interactive Local UI & MCP Server
```bash
npm run ui
```
Spins up the zero-dependency UI server at `http://localhost:3333` with live file processing and `/api/mcp` endpoints.

---

## Submitting Pull Requests

- Ensure all existing tests pass (`npm test`).
- Ensure `node bin/verisieve.mjs selftest` passes.
- Ensure backward compatibility shims (`bin/rtio-portable.mjs`, `bin/matilda-portable.mjs`, `include/rtio_gatekeeper.h`, `include/matilda_gatekeeper.h`) remain functional.
- Maintain documentation integrity and clean commit messages.
