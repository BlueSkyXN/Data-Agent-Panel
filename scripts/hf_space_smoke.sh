#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${1:-${HF_SPACE_URL:-http://localhost:7860}}"
BASE_URL="${BASE_URL%/}"
OPS_TOKEN="${OPS_TOKEN:-}"
RETRIES="${SMOKE_RETRIES:-30}"
DELAY="${SMOKE_DELAY:-3}"

curl_retry() {
  local url="$1"
  local extra_header=()
  if [ -n "$OPS_TOKEN" ]; then
    extra_header=(-H "X-Ops-Token: ${OPS_TOKEN}")
  fi
  if [ -n "${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}" ]; then
    extra_header+=(-H "Authorization: Bearer ${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}")
  fi
  local n=1
  until curl -fsS "${extra_header[@]}" "$url" >/tmp/dap_hf_smoke.out; do
    if [ "$n" -ge "$RETRIES" ]; then
      echo "FAILED: $url" >&2
      cat /tmp/dap_hf_smoke.out 2>/dev/null || true
      return 1
    fi
    n=$((n+1))
    sleep "$DELAY"
  done
  echo "OK: $url"
}

curl_retry "$BASE_URL/api/health/live"
curl_retry "$BASE_URL/api/health/ready"
curl_retry "$BASE_URL/healthz"
curl_retry "$BASE_URL/nginx-health"
curl_retry "$BASE_URL/_ops/healthz"
curl_retry "$BASE_URL/_ops/health"
curl_retry "$BASE_URL/_ops/system"

# Verify login and a basic chat query.
TOKEN=$(curl -fsS -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | python -c 'import sys,json; print(json.load(sys.stdin)["token"])')

curl -fsS -X POST "$BASE_URL/api/chat/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"agent_id":"agent_router","message":"本月收入最高的渠道有哪些？"}' | python -c 'import sys,json; data=json.load(sys.stdin); assert data.get("trace_id"); print("OK: chat trace", data["trace_id"])'

echo "Hugging Face Space smoke passed: $BASE_URL"
