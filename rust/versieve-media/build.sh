#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

cargo build --target wasm32-unknown-unknown --release

WASM_OUT="$SCRIPT_DIR/target/wasm32-unknown-unknown/release/versieve_media.wasm"
PORTABLE_WASM="$SCRIPT_DIR/../../vendor/wasm/versieve_media.wasm"
RTIO_WASM="$SCRIPT_DIR/../../../Rtio/frontend/public/wasm/versieve_media.wasm"

mkdir -p "$(dirname "$PORTABLE_WASM")"
cp "$WASM_OUT" "$PORTABLE_WASM"
if [ -d "$(dirname "$RTIO_WASM")" ]; then
  cp "$WASM_OUT" "$RTIO_WASM"
fi
ls -lh "$PORTABLE_WASM"
