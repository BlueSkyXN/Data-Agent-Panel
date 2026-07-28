---
title: Data Agent Panel
emoji: 📊
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Data Agent Panel

This Hugging Face Docker Space is a thin deployment wrapper. The product source
is fetched during the Docker build from `BlueSkyXN/Data-Agent-Panel` at the
immutable commit recorded in `BUILD_SOURCE.json`.

- Source lane: public GitHub source fetched at build time.
- Provenance: `BUILD_SOURCE.json` records the source commit, wrapper commit, and
  base-image digest used for this exported bundle.
- Persistence: a writable `/data` Storage Bucket mount is required. SQLite data, task
  handoffs, generated signing material, and locks remain under
  `/data/data-agent-platform`.
- Health: `/_ops/healthz` is the canonical read-only operational endpoint.

A missing or unwritable `/data` mount, an invalid source commit, or a failed
source checkout stops startup or image build instead of falling back to a local
copy or `/tmp`.
