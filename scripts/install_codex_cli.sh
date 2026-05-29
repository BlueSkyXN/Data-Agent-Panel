#!/usr/bin/env bash
set -euo pipefail
if command -v codex >/dev/null 2>&1; then
  codex --version
  exit 0
fi
if command -v npm >/dev/null 2>&1; then
  npm install -g @openai/codex
elif command -v brew >/dev/null 2>&1; then
  brew install --cask codex
else
  echo "Neither npm nor brew is available. Use: curl -fsSL https://chatgpt.com/codex/install.sh | sh" >&2
  exit 1
fi
codex --version
