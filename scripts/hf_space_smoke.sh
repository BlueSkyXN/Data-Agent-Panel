#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${1:-${HF_SPACE_URL:-http://localhost:7860}}"
BASE_URL="${BASE_URL%/}"
OPS_TOKEN="${OPS_TOKEN:-}"
RETRIES="${SMOKE_RETRIES:-30}"
DELAY="${SMOKE_DELAY:-3}"
PYTHON_BIN="${PYTHON:-python3}"
SMOKE_USERNAME="${SMOKE_USERNAME:-admin}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-admin123}"
SMOKE_MESSAGE="${SMOKE_MESSAGE:-本月收入最高的渠道有哪些？}"
TMP_BODY=$(mktemp)
TMP_HEADERS=$(mktemp)
TMP_COOKIE=$(mktemp)
trap 'rm -f "$TMP_BODY" "$TMP_HEADERS" "$TMP_COOKIE"' EXIT

curl_retry() {
  local url="$1"
  local extra_header=()
  if [ -n "$OPS_TOKEN" ]; then
    extra_header+=("-H" "X-Ops-Token: ${OPS_TOKEN}")
  fi
  if [ -n "${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}" ]; then
    extra_header+=("-H" "Authorization: Bearer ${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}")
  fi
  local n=1
  until curl -fsS "${extra_header[@]}" "$url" >"$TMP_BODY"; do
    if [ "$n" -ge "$RETRIES" ]; then
      echo "FAILED: $url" >&2
      sed -n '1,80p' "$TMP_BODY" >&2 || true
      return 1
    fi
    n=$((n+1))
    sleep "$DELAY"
  done
  echo "OK: $url"
}

check_frame_headers() {
  local extra_header=()
  if [ -n "$OPS_TOKEN" ]; then
    extra_header+=("-H" "X-Ops-Token: ${OPS_TOKEN}")
  fi
  if [ -n "${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}" ]; then
    extra_header+=("-H" "Authorization: Bearer ${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}")
  fi
  curl -fsS -D "$TMP_HEADERS" "${extra_header[@]}" "$BASE_URL/" >"$TMP_BODY"
  if grep -qi '^x-frame-options:' "$TMP_HEADERS"; then
    echo "FAILED: X-Frame-Options blocks Hugging Face iframe embedding" >&2
    grep -i '^x-frame-options:' "$TMP_HEADERS" >&2 || true
    return 1
  fi
  if ! grep -qi '^content-security-policy:.*frame-ancestors' "$TMP_HEADERS"; then
    echo "FAILED: missing Content-Security-Policy frame-ancestors" >&2
    sed -n '1,80p' "$TMP_HEADERS" >&2 || true
    return 1
  fi
  if ! grep -qi '^content-security-policy:.*https://huggingface\.co' "$TMP_HEADERS"; then
    echo "FAILED: frame-ancestors must allow https://huggingface.co" >&2
    grep -i '^content-security-policy:' "$TMP_HEADERS" >&2 || true
    return 1
  fi
  echo "OK: frame headers"
}

check_ops_cookie_migration() {
  local hf_header=()
  local status
  if [ -z "$OPS_TOKEN" ]; then
    echo "SKIP: ops cookie migration; OPS_TOKEN is not set"
    return
  fi
  if [ -n "${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}" ]; then
    hf_header+=("-H" "Authorization: Bearer ${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}")
  fi

  status=$(curl -sS -o "$TMP_BODY" -w '%{http_code}' -c "$TMP_COOKIE" \
    "${hf_header[@]}" \
    --get --data-urlencode "token=$OPS_TOKEN" \
    "$BASE_URL/_ops/" || true)
  if [ "$status" != "303" ]; then
    echo "FAILED: ops cookie migration expected HTTP 303, got $status" >&2
    sed -n '1,80p' "$TMP_BODY" >&2 || true
    return 1
  fi

  status=$(curl -sS -o "$TMP_BODY" -w '%{http_code}' -b "$TMP_COOKIE" "${hf_header[@]}" "$BASE_URL/_ops/" || true)
  if [ "$status" != "200" ]; then
    echo "FAILED: ops cookie dashboard expected HTTP 200, got $status" >&2
    sed -n '1,80p' "$TMP_BODY" >&2 || true
    return 1
  fi
  if grep -Fq "$OPS_TOKEN" "$TMP_BODY"; then
    echo "FAILED: OPS_TOKEN is present in ops dashboard HTML" >&2
    return 1
  fi
  echo "OK: ops cookie migration"
}

curl_retry "$BASE_URL/api/health/live"
curl_retry "$BASE_URL/api/health/ready"
curl_retry "$BASE_URL/healthz"
curl_retry "$BASE_URL/nginx-health"
curl_retry "$BASE_URL/_ops/healthz"
curl_retry "$BASE_URL/_ops/health"
curl_retry "$BASE_URL/_ops/system"
check_frame_headers
check_ops_cookie_migration

# Verify login and a basic chat query.
login_headers=()
if [ -n "${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}" ]; then
  login_headers+=("-H" "Authorization: Bearer ${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}")
fi
LOGIN_PAYLOAD=$("$PYTHON_BIN" -c 'import json,sys; print(json.dumps({"username": sys.argv[1], "password": sys.argv[2]}, ensure_ascii=False))' "$SMOKE_USERNAME" "$SMOKE_PASSWORD")
TOKEN=$(curl -fsS -X POST "$BASE_URL/api/auth/login" \
  "${login_headers[@]}" \
  -H 'Content-Type: application/json' \
  -d "$LOGIN_PAYLOAD" | "$PYTHON_BIN" -c 'import sys,json; print(json.load(sys.stdin)["token"])')

chat_headers=()
if [ -n "$OPS_TOKEN" ]; then
  chat_headers+=("-H" "X-Ops-Token: ${OPS_TOKEN}")
fi
if [ -n "${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}" ]; then
  chat_headers+=("-H" "Authorization: Bearer ${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}")
  chat_headers+=("-H" "X-DAP-Token: ${TOKEN}")
else
  chat_headers+=("-H" "Authorization: Bearer ${TOKEN}")
fi
CHAT_PAYLOAD=$("$PYTHON_BIN" -c 'import json,sys; print(json.dumps({"agent_id": "agent_router", "message": sys.argv[1]}, ensure_ascii=False))' "$SMOKE_MESSAGE")
curl -fsS -X POST "$BASE_URL/api/chat/query" \
  "${chat_headers[@]}" \
  -H 'Content-Type: application/json' \
  -d "$CHAT_PAYLOAD" | "$PYTHON_BIN" -c 'import sys,json; data=json.load(sys.stdin); assert data.get("trace_id"); print("OK: chat trace", data["trace_id"])'

echo "Hugging Face Space smoke passed: $BASE_URL"
