#!/usr/bin/env bash
set -euo pipefail
IMAGE="${1:-data-agent-platform:standalone-hf}"
docker build -t "$IMAGE" .
echo "Built $IMAGE"
