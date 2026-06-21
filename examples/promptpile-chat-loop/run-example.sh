#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -f .env ]]; then
  while IFS="=" read -r key value; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    if [[ "$key" == "DEEPSEEK_API_KEY" && -n "$value" ]]; then
      export DEEPSEEK_API_KEY="$value"
    fi
  done < .env
fi

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "[ERROR] DEEPSEEK_API_KEY is not set." >&2
  echo "Export it in the current shell, or create .env here with:" >&2
  echo "  DEEPSEEK_API_KEY=sk-..." >&2
  exit 1
fi

mkdir -p messages
if [[ ! -f 'messages/[0]system.md' ]]; then
  printf '%s\n' 'You are a helpful assistant. Reply in Chinese.' > 'messages/[0]system.md'
fi

echo "Starting promptpile chat loop (DeepSeek, config: promptpile.toml)..."
echo "Input ends with Ctrl+D."

while true; do
  echo
  echo "---- New Round ----"
  npx --no-install promptpile --config promptpile.toml --input --continue
  read -r -p "Continue? (Y/N): " again || true
  [[ "${again:-}" =~ ^[Yy]$ ]] || break
done

echo "Bye."
