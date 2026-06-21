#!/usr/bin/env bash
set -euo pipefail

if command -v python3 >/dev/null 2>&1; then
  python3 --version
  echo "Python 3 is already available on PATH. Nothing to do."
  exit 0
fi

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "Administrator privileges are required. Install sudo or run as root." >&2
    exit 1
  fi
}

if command -v apt-get >/dev/null 2>&1; then
  echo "Python 3 not found. Installing with apt-get..."
  run_root apt-get update
  run_root apt-get install -y python3
elif command -v dnf >/dev/null 2>&1; then
  echo "Python 3 not found. Installing with dnf..."
  run_root dnf install -y python3
elif command -v pacman >/dev/null 2>&1; then
  echo "Python 3 not found. Installing with pacman..."
  run_root pacman -Sy --needed --noconfirm python
elif command -v brew >/dev/null 2>&1; then
  echo "Python 3 not found. Installing with Homebrew..."
  brew install python
else
  cat >&2 <<'EOF'
No supported package manager was found. Install Python 3 manually from https://www.python.org/downloads/
The fetch MCP normally runs through uvx, so install-uv.sh may be sufficient.
EOF
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python was installed but is not visible in this shell. Restart the terminal and run: python3 --version" >&2
  exit 0
fi

python3 --version
echo "Done."
