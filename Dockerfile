# syntax=docker/dockerfile:1.7
# Standalone Data Agent Platform for Hugging Face Docker Spaces.
# HF Spaces expects a single externally exposed port. This image exposes 7860.
# Resolved from the Docker Hub OCI index for python:3.11-slim on 2026-07-25.
# Keep an explicit digest here because Hugging Face Space builds do not receive
# a release-only build argument from the upload workflow.
ARG PYTHON_BASE_IMAGE=python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93
FROM ${PYTHON_BASE_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=7860 \
    DAP_APP_ENV=hf-space \
    DAP_HF_SPACE=true \
    DAP_DEMO_MODE=true \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl tini ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 user \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash user \
    && mkdir -p /app /data /persist /tmp/data-agent-platform \
    && chown -R user:user /app /data /persist /tmp/data-agent-platform

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY --chown=user:user . /app
RUN chmod +x /app/hf_entrypoint.sh

USER user
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health/live' % os.getenv('PORT','7860'), timeout=3).read()"
ENTRYPOINT ["/usr/bin/tini", "--", "/app/hf_entrypoint.sh"]
