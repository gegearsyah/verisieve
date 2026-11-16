#!/usr/bin/env bash
set -euo pipefail
export PATH="${HOME}/.cargo/bin:${PATH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

echo "=== Building verisieve-dl for wasm32-unknown-unknown ==="
RUSTFLAGS="-C target-feature=-relaxed-simd" cargo build --release --target wasm32-unknown-unknown

mkdir -p ../../vendor/wasm
cp target/wasm32-unknown-unknown/release/mle_dl.wasm ../../vendor/wasm/verisieve_dl.wasm
WASM_SIZE=$(wc -c < ../../vendor/wasm/verisieve_dl.wasm | tr -d '[:space:]')
echo "Generated vendor/wasm/verisieve_dl.wasm (${WASM_SIZE} bytes)"

if [ "${WASM_SIZE}" -gt 65536 ]; then
  echo "ERROR: vendor/wasm/verisieve_dl.wasm (${WASM_SIZE} bytes) exceeds 65536-byte ceiling" >&2
  exit 1
fi
