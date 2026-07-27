# syntax=docker/dockerfile:1.7
# This is an export template. export_hfs_space_bundle.py replaces the two
# provenance placeholders with immutable values before upload to a Space.
ARG PYTHON_BASE_IMAGE=@PYTHON_BASE_IMAGE@
ARG DAP_SOURCE_REF=@DAP_SOURCE_REF@

FROM ${PYTHON_BASE_IMAGE} AS source
ARG DAP_SOURCE_REF
WORKDIR /source
RUN set -eux; \
    test "${#DAP_SOURCE_REF}" -eq 40; \
    printf '%s' "${DAP_SOURCE_REF}" | grep -Eq '^[0-9a-f]{40}$'; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates git; \
    rm -rf /var/lib/apt/lists/*; \
    git clone --no-checkout "@DAP_SOURCE_REPOSITORY@" /source; \
    git checkout --detach "${DAP_SOURCE_REF}"; \
    test "$(git rev-parse HEAD)" = "${DAP_SOURCE_REF}"; \
    rm -rf .git

FROM ${PYTHON_BASE_IMAGE}
ARG DAP_SOURCE_REF
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=7860 \
    DAP_APP_ENV=hf-space \
    DAP_HF_SPACE=true \
    DAP_DEMO_MODE=true \
    PYTHONPATH=/app \
    DAP_BUILD_SOURCE_REF=${DAP_SOURCE_REF}
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 user \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash user \
    && install -d -m 0770 -o user -g user /data
COPY --from=source /source/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY --from=source --chown=user:user /source /app
COPY --chown=user:user entrypoint.sh /hfs/entrypoint.sh
COPY --chown=user:user BUILD_SOURCE.json /app/BUILD_SOURCE.json
RUN chmod +x /hfs/entrypoint.sh /app/hf_entrypoint.sh
USER user
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health/ready' % os.getenv('PORT','7860'), timeout=3).read()"
ENTRYPOINT ["/usr/bin/tini", "--", "/hfs/entrypoint.sh"]
