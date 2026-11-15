#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

cargo build --target wasm32-unknown-unknown --release

WASM_OUT="$SCRIPT_DIR/target/wasm32-unknown-unknown/release/verisieve_clean.wasm"
PORTABLE_WASM="$SCRIPT_DIR/../../vendor/wasm/verisieve_clean.wasm"

mkdir -p "$(dirname "$PORTABLE_WASM")"
cp "$WASM_OUT" "$PORTABLE_WASM"
ls -lh "$PORTABLE_WASM"
