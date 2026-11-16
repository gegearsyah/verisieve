#!/usr/bin/env bash
set -euo pipefail

export PATH="${HOME}/.cargo/bin:${PATH}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

cargo build --target wasm32-unknown-unknown --release

WASM_OUT="$SCRIPT_DIR/target/wasm32-unknown-unknown/release/verisieve_sql.wasm"
PORTABLE_WASM="$SCRIPT_DIR/../../vendor/wasm/verisieve_sql.wasm"

mkdir -p "$(dirname "$PORTABLE_WASM")"
cp "$WASM_OUT" "$PORTABLE_WASM"
SIZE_BYTES=$(wc -c < "$PORTABLE_WASM")
if [ "$SIZE_BYTES" -ge 512000 ]; then
  echo "ERROR: verisieve_sql.wasm exceeds 500 KB ceiling ($SIZE_BYTES bytes)" >&2
  exit 1
fi
echo "Built $PORTABLE_WASM ($SIZE_BYTES bytes)"
