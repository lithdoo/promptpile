#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER_DIR="$SCRIPT_DIR/../promptpile-mcp-launcher"
cd "$SCRIPT_DIR"

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "[ERROR] Export DEEPSEEK_API_KEY before running this example." >&2
  exit 1
fi

MCP_PORT="${MCP_PORT:-8765}"
MCP_BASE_URL="http://127.0.0.1:$MCP_PORT"
export PROMPTPILE_MCP_BASE_URL="$MCP_BASE_URL"
export PROMPTPILE_REACT_DEBUG="${PROMPTPILE_REACT_DEBUG:-0}"

gateway_pid=""
cleanup() {
  if [[ -n "$gateway_pid" ]] && kill -0 "$gateway_pid" 2>/dev/null; then
    kill "$gateway_pid" 2>/dev/null || true
    wait "$gateway_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if ! curl -fsS "$MCP_BASE_URL/health" >/dev/null 2>&1; then
  echo "MCP gateway not reachable at $MCP_BASE_URL."
  echo "Starting promptpile-mcp-launcher in the background..."
  "$LAUNCHER_DIR/run-example.sh" >"$SCRIPT_DIR/.mcp-gateway.log" 2>&1 &
  gateway_pid=$!

  for _ in $(seq 1 31); do
    if curl -fsS "$MCP_BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$gateway_pid" 2>/dev/null; then
      echo "ERROR: Gateway exited during startup. See $SCRIPT_DIR/.mcp-gateway.log" >&2
      exit 1
    fi
    sleep 2
  done

  if ! curl -fsS "$MCP_BASE_URL/health" >/dev/null 2>&1; then
    echo "ERROR: Gateway did not become healthy within about 62 seconds." >&2
    echo "See $SCRIPT_DIR/.mcp-gateway.log" >&2
    exit 1
  fi
fi

echo "MCP gateway OK: $MCP_BASE_URL"
mkdir -p messages
if [[ ! -f 'messages/[0]system.md' ]]; then
  printf '%s\n' 'You are a helpful assistant. Reply in Chinese.' > 'messages/[0]system.md'
fi

token_args=()
if [[ -n "${PROMPTPILE_MCP_TOKEN:-}" ]]; then
  token_args+=(--token "$PROMPTPILE_MCP_TOKEN")
fi

echo "Exporting messages/.tools.toml ..."
npx --no-install promptpile-mcp export-tools \
  --base-url "$MCP_BASE_URL" \
  -o messages/.tools.toml \
  "${token_args[@]}"

echo
echo "LLM debug setting: PROMPTPILE_REACT_DEBUG=$PROMPTPILE_REACT_DEBUG"
echo "Starting promptpile-react. Finish each multiline input with Ctrl+D; Ctrl+C exits."
echo

set +e
npx --no-install promptpile-react \
  --config promptpile-react.toml \
  --after-hook-path after-hook-mcp-exec-calls.sh
status=$?
set -e

echo
echo "After-hook attempts exec-calls when Thought emits tool_calls. Manual retry:"
printf '  npx --no-install promptpile-mcp exec-calls --base-url %q --dir %q' "$MCP_BASE_URL" "$SCRIPT_DIR/messages"
if [[ -n "${PROMPTPILE_MCP_TOKEN:-}" ]]; then
  printf ' --token %q' "$PROMPTPILE_MCP_TOKEN"
fi
printf '\n'

exit "$status"
