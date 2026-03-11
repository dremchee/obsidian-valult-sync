#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
ENV_FILE="$SERVER_DIR/.env"

if [[ ! -d "$SERVER_DIR" ]]; then
  echo "Server directory not found: $SERVER_DIR" >&2
  exit 1
fi

cd "$SERVER_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${AUTH_TOKEN:-}" && -z "${AUTH_TOKENS:-}" ]]; then
  echo "Set AUTH_TOKEN or AUTH_TOKENS before starting the server." >&2
  echo "You can put AUTH_TOKEN=secret-token into $ENV_FILE" >&2
  echo "or run: AUTH_TOKEN=secret-token ./run-server.sh" >&2
  exit 1
fi

cargo run
