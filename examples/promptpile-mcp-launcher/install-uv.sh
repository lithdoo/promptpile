#!/usr/bin/env bash
set -euo pipefail

if command -v uv >/dev/null 2>&1; then
  echo "uv is already on PATH:"
  uv --version
  command -v uvx >/dev/null 2>&1 && uvx --version
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to install uv. Install curl and retry." >&2
  exit 1
fi

echo "Installing uv (provides uvx, needed for fetch MCP in mcp.toml)..."
echo "Downloading the official installer from https://astral.sh/uv/install.sh"
curl -LsSf https://astral.sh/uv/install.sh | sh

export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  echo "uv was installed but is not on PATH yet. Restart the shell, then run: uv --version" >&2
  exit 0
fi

uv --version
command -v uvx >/dev/null 2>&1 && uvx --version
echo "Done."
