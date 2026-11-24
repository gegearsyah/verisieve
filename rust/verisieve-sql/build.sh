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

# Regenerate the provenance receipt so it always names the built artifact, never hand-edited
PROV="$SCRIPT_DIR/../../vendor/wasm/verisieve_sql.provenance.json"
WASM_SHA=$(sha256sum "$PORTABLE_WASM" | awk '{print toupper($1)}')
TOML_SHA=$(tr -d '\r' < "$SCRIPT_DIR/Cargo.toml" | sha256sum | awk '{print toupper($1)}')
LIB_SHA=$(tr -d '\r' < "$SCRIPT_DIR/src/lib.rs" | sha256sum | awk '{print toupper($1)}')
cat > "$PROV" <<EOF
{
  "artifact": "vendor/wasm/verisieve_sql.wasm",
  "crateName": "verisieve_sql",
  "sourceCrate": "rust/verisieve-sql",
  "cargoTarget": "wasm32-unknown-unknown",
  "profile": {
    "optLevel": "z",
    "lto": true,
    "codegenUnits": 1,
    "panic": "abort",
    "strip": "symbols"
  },
  "abiVersion": 1,
  "maxBytes": 500000,
  "wasmBytes": $SIZE_BYTES,
  "wasmSha256": "$WASM_SHA",
  "sourceFilesSha256": {
    "Cargo.toml": "$TOML_SHA",
    "src/lib.rs": "$LIB_SHA"
  }
}
EOF
echo "Built $PORTABLE_WASM ($SIZE_BYTES bytes); provenance regenerated at $PROV"
