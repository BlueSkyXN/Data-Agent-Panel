#!/usr/bin/env bash
set -euo pipefail

export PORT="${PORT:-7860}"
export DAP_APP_ENV="${DAP_APP_ENV:-hf-space}"
export DAP_HF_SPACE="${DAP_HF_SPACE:-true}"
export DAP_DEMO_MODE="${DAP_DEMO_MODE:-true}"
export DAP_ALLOW_DEMO_SEED="${DAP_ALLOW_DEMO_SEED:-true}"

if [ -z "${DAP_DATA_DIR:-}" ]; then
  if [ -n "${DAP_PERSIST_DIR:-}" ] && mkdir -p "${DAP_PERSIST_DIR}/data-agent-platform" 2>/dev/null && [ -w "${DAP_PERSIST_DIR}/data-agent-platform" ]; then
    export DAP_DATA_DIR="${DAP_PERSIST_DIR}/data-agent-platform"
  elif mkdir -p /persist/data-agent-platform 2>/dev/null && [ -w /persist/data-agent-platform ]; then
    export DAP_DATA_DIR="/persist/data-agent-platform"
  elif mkdir -p /data/data-agent-platform 2>/dev/null && [ -w /data/data-agent-platform ]; then
    export DAP_DATA_DIR="/data/data-agent-platform"
  else
    mkdir -p /tmp/data-agent-platform
    export DAP_DATA_DIR="/tmp/data-agent-platform"
  fi
fi

export DAP_DB_PATH="${DAP_DB_PATH:-${DAP_DATA_DIR}/data_agent_platform.db}"
export DAP_BUSINESS_DB_PATH="${DAP_BUSINESS_DB_PATH:-${DAP_DATA_DIR}/business_sample.db}"
export DAP_CODEX_TASK_DIR="${DAP_CODEX_TASK_DIR:-${DAP_DATA_DIR}/codex_tasks}"
export HF_HOME="${HF_HOME:-${DAP_DATA_DIR}/.huggingface}"
export HF_HUB_CACHE="${HF_HUB_CACHE:-${HF_HOME}/hub}"
export PYTHONPATH="${PYTHONPATH:-/app}"

mkdir -p "${DAP_DATA_DIR}" "${DAP_CODEX_TASK_DIR}" "${HF_HOME}" "${HF_HUB_CACHE}"

echo "[data-agent-hf] PORT=${PORT}"
echo "[data-agent-hf] DAP_DATA_DIR=${DAP_DATA_DIR}"
echo "[data-agent-hf] DAP_DB_PATH=${DAP_DB_PATH}"
echo "[data-agent-hf] SPACE_HOST=${SPACE_HOST:-}"

python - <<'PY'
from apps.api import db
from apps.api.config import get_settings
settings = get_settings()
db.init_all(reset=False)
print(f"[data-agent-hf] initialized database at {settings.db_path}")
PY

exec python -m uvicorn apps.api.main:app --host 0.0.0.0 --port "${PORT}" --workers "${DAP_UVICORN_WORKERS:-1}"
