#!/usr/bin/env bash
set -euo pipefail

readonly REQUIRED_PERSIST_ROOT="/data"
readonly DEFAULT_DATA_DIR="/data/data-agent-platform"

canonicalize_path() {
  python - "$1" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
}

require_path_within() {
  local name="$1"
  local raw_path="$2"
  local allowed_root="$3"
  local canonical_path
  canonical_path="$(canonicalize_path "$raw_path")"
  case "$canonical_path" in
    "$allowed_root"|"$allowed_root"/*) printf '%s\n' "$canonical_path" ;;
    *)
      echo "[data-agent-hfs] ERROR: ${name} must resolve under the required persistent directory" >&2
      return 78
      ;;
  esac
}

set_path_within() {
  local name="$1"
  local raw_path="$2"
  local allowed_root="$3"
  local resolved_path
  if ! resolved_path="$(require_path_within "$name" "$raw_path" "$allowed_root")"; then
    exit 78
  fi
  printf -v "$name" '%s' "$resolved_path"
  export "$name"
}

if [ ! -d "$REQUIRED_PERSIST_ROOT" ] || [ ! -w "$REQUIRED_PERSIST_ROOT" ]; then
  echo "[data-agent-hfs] ERROR: a writable /data mount is required" >&2
  exit 78
fi

PERSIST_ROOT="$(canonicalize_path "$REQUIRED_PERSIST_ROOT")"
set_path_within DAP_DATA_DIR "${DAP_DATA_DIR:-$DEFAULT_DATA_DIR}" "$PERSIST_ROOT"

mkdir -p "$DAP_DATA_DIR"
set_path_within DAP_DATA_DIR "$DAP_DATA_DIR" "$PERSIST_ROOT"
if [ ! -w "$DAP_DATA_DIR" ]; then
  echo "[data-agent-hfs] ERROR: DAP_DATA_DIR is not writable: $DAP_DATA_DIR" >&2
  exit 78
fi

set_path_within DAP_DB_PATH "${DAP_DB_PATH:-${DAP_DATA_DIR}/data_agent_platform.db}" "$DAP_DATA_DIR"
set_path_within DAP_BUSINESS_DB_PATH "${DAP_BUSINESS_DB_PATH:-${DAP_DATA_DIR}/business_sample.db}" "$DAP_DATA_DIR"
set_path_within DAP_CODEX_TASK_DIR "${DAP_CODEX_TASK_DIR:-${DAP_DATA_DIR}/codex_tasks}" "$DAP_DATA_DIR"
set_path_within HF_HOME "${HF_HOME:-${DAP_DATA_DIR}/.huggingface}" "$DAP_DATA_DIR"
set_path_within HF_HUB_CACHE "${HF_HUB_CACHE:-${HF_HOME}/hub}" "$DAP_DATA_DIR"

exec /app/hf_entrypoint.sh
