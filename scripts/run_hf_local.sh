#!/usr/bin/env bash
set -euo pipefail
IMAGE="${1:-data-agent-platform:standalone-hf}"
docker run --rm -it \
  -p 7860:7860 \
  -e DAP_SECRET_KEY=local-hf-secret-change-me \
  -e OPS_TOKEN=local-hf-ops-token \
  -e SPACE_HOST=localhost:7860 \
  -v dap-hf-persist:/persist \
  "$IMAGE"
