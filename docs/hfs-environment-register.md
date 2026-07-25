# Hugging Face Space 环境登记

这个文件记录 Space 的**非敏感配置键和值**、目标版本与最近一次 CLI 回读；Hugging Face Space 是运行时真相源。不得把任何 Secret 值、Bearer token、管理员密码或内部 URL 写入本文件。

## Target

| Field | Value |
|---|---|
| Space | `BlueSkyXN/Data-Agent-Panel-HFS` |
| Runtime URL | `https://blueskyxn-data-agent-panel-hfs.hf.space` |
| Runtime mode | Private Docker Space / Pattern A / repo root |
| Application release | `0.7.0-calm-workspace` |
| Last inventory readback | `2026-07-25` via `hf spaces variables list` / `hf spaces secrets list` |

## Variables

| Key | Required value | Purpose |
|---|---|---|
| `DAP_APP_ENV` | `hf-space` | Enable hardened Space runtime behavior. |
| `DAP_APP_VERSION` | `0.7.0-calm-workspace` | Expose the deployed application release through health and diagnostics. |
| `DAP_HF_SPACE` | `true` | Select Hugging Face runtime behavior. |
| `DAP_DEMO_MODE` | `true` | Keep the private demo fixture enabled. |
| `DAP_ALLOW_DEMO_SEED` | `true` | Allow demo data and accounts to initialize. |
| `DAP_CORS_ORIGINS` | `*` | Current private-demo setting; production promotion requires an explicit allowlist. |
| `DAP_ALLOWED_EXTERNAL_AGENT_HOSTS` | `localhost,127.0.0.1` | Default least-privilege external Agent allowlist. |
| `DAP_CODEX_MODE` | `mock` | Prevent Code-changing Codex dispatch in the Space. |
| `DAP_CODEX_REQUIRE_APPROVAL` | `true` | Require approval before any configured Codex dispatch. |
| `PORT` | `7860` | Match Docker Space metadata and container listener. |

## Secrets

| Key | Required state | Notes |
|---|---|---|
| `DAP_SECRET_KEY` | present | Write-only on the Hub. Rotate through the Space CLI; never record the value here. |
| `DAP_OPS_TOKEN` | present | Write-only on the Hub. Required for authenticated `/_ops/*` smoke; never record the value here. |

## Release base image

`Dockerfile` defaults to the immutable OCI index reference below because Space uploads do not pass a release-only Docker build argument:

```text
python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93
```

Resolved from the Docker Hub `python:3.11-slim` OCI index on `2026-07-25`. Update this record and `Dockerfile` together after a deliberate base-image review.

## Readback procedure

```bash
hf spaces variables list BlueSkyXN/Data-Agent-Panel-HFS --format json
hf spaces secrets list BlueSkyXN/Data-Agent-Panel-HFS --format json
hf spaces info BlueSkyXN/Data-Agent-Panel-HFS --expand=runtime,sha,lastModified,sdk,private,subdomain --format json
```

The CLI intentionally does not return secret values. Do not treat Space `RUNNING` alone as successful deployment evidence; pair it with the exact candidate SHA, successful upload/build, authenticated ops smoke, and runtime logs.
