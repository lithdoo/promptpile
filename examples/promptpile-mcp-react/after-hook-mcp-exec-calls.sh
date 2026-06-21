#!/bin/sh
set -eu

[ -n "${PROMPTPILE_MCP_BASE_URL:-}" ] || exit 0
[ "${PROMPTPILE_HAS_TOOL_CALLS:-}" = "1" ] || exit 0
[ -n "${PROMPTPILE_SCAN_DIRECTORY:-}" ] || exit 0

if [ -n "${PROMPTPILE_MCP_TOKEN:-}" ]; then
  exec npx --no-install promptpile-mcp exec-calls \
    --base-url "$PROMPTPILE_MCP_BASE_URL" \
    --dir "$PROMPTPILE_SCAN_DIRECTORY" \
    --token "$PROMPTPILE_MCP_TOKEN"
fi

exec npx --no-install promptpile-mcp exec-calls \
  --base-url "$PROMPTPILE_MCP_BASE_URL" \
  --dir "$PROMPTPILE_SCAN_DIRECTORY"
