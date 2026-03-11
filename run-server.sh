#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"

if [[ ! -d "$SERVER_DIR" ]]; then
  echo "Server directory not found: $SERVER_DIR" >&2
  exit 1
fi

cd "$SERVER_DIR"

if [[ -z "${AUTH_TOKEN:-}" && -z "${AUTH_TOKENS:-}" ]]; then
  echo "Set AUTH_TOKEN or AUTH_TOKENS before starting the server." >&2
  echo "Example: AUTH_TOKEN=secret-token ./run-server.sh" >&2
  exit 1
fi

cargo run
