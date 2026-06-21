#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p allowed

echo "Starting promptpile-mcp launch (Ctrl+C to stop)..."
exec npx --no-install promptpile-mcp launch --config "$SCRIPT_DIR/mcp.toml"
