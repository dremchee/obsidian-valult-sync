#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"

if [[ ! -d "$SERVER_DIR" ]]; then
  echo "Server directory not found: $SERVER_DIR" >&2
  exit 1
fi

cd "$SERVER_DIR"
cargo run
