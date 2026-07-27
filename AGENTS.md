# Repository agent instructions

## Purpose

本仓库实现一套独立数据智能体平台：FastAPI 后端、静态 Web 工作台、SQLite demo/runtime data、Trace/audit/RBAC/SQL Guard、Codex 工程任务嵌套，以及 Hugging Face Docker Space Pattern B thin source wrapper 部署入口。

## Codex startup behavior

- Codex 通常从仓库根目录启动；本文件是 repo-local 启动期主规则。
- 子目录 `AGENTS.md` 是按需 navigation card。修改有本地卡片的目录前，先读取对应文件。
- 如果从子目录启动，Codex 可能自动加载路径链上的本地 `AGENTS.md`；仍以本文件的 Directory map 作为根启动 workflow 的 router。
- 根规则与子目录规则冲突时，子目录规则优先；同一事项没有子目录规则时，使用本文件。
- `local/` 是 `.gitignore` 忽略的本机导出/临时副本，不是 tracked source of truth。

## Directory map

| Path | Responsibility | Local AGENTS.md | Read when |
|---|---|---:|---|
| `.github/workflows/` | GitHub Actions static/app/docker smoke 和 Hugging Face Space sync | Yes | 修改 CI、Docker smoke、HF upload/exclude/restart 流程前 |
| `adapters/` | Generic HTTP agent adapter 示例文档 | No | 文档规则足够；修改 adapter contract 时同时检查 `docs/adapter-development.md` |
| `apps/api/` | FastAPI API、auth/RBAC、settings、routers、services、SQL Guard、Trace、Codex dispatch | Yes | 修改任何 API endpoint、security/config/db/service、Codex runtime、SQL 执行或审计逻辑前 |
| `apps/mock_agents/` | Mock agent runtime helper | No | 简单 mock module，遵循 `apps/api/` 平台不变量 |
| `apps/web/static/` | FastAPI 直接服务的静态 HTML/CSS/JS 工作台 | Yes | 修改 UI、前端 API 调用、Trace/Codex/dataops/audit 页面或响应式样式前 |
| `database/` | SQLite schema source | Yes | 修改 `schema.sql`、schema contract、seed/migration 相关行为前 |
| `data/` | Ignored runtime SQLite DBs and Codex handoff files | No | 不作为源码编辑；需要重建数据时用脚本，不手改 `.db` |
| `docs/` | Architecture、security、deployment、runbook、user docs | No | 文档变更使用根规则；涉及安全/部署事实时先核对源码和 CI |
| `scripts/` | Local/CI validation scripts、smoke scripts、HFS helpers、Codex install helpers | Yes | 修改任何 validation、smoke、HF helper、installer 或 shell/Python script 前 |
| `services/codex_sdk_bridge/` | Optional Node ESM bridge for `@openai/codex-sdk` | Yes | 修改 Node bridge package、SDK invocation、task dispatch surface 前 |
| `local/data-agent-platform-standalone/` | Ignored local standalone export/copy | Yes | 用户明确要求改本机导出副本时；默认不要把它当主仓源码 |
| Root deployment files | `Dockerfile*`、`docker-compose*.yml`、`hf_entrypoint.sh`、`hfs-dev.toml`、`README*.md`、`.env.example` | No | 修改 HF/Docker/runtime config 时同时检查 `cloud/hfs/`、`.github/workflows/` 和 `scripts/AGENTS.md` |

## On-demand cat protocol

Before editing files under a directory that has a local `AGENTS.md`, read that file first:

```bash
cat <path>/AGENTS.md
```

If multiple nested `AGENTS.md` files exist on the path to the target file, read them from shallow to deep before making changes. Do not rely on memory when a local card is cheap to read; these files are intended to keep root context small.

## Commands

Commands below are confirmed from `README.md`, `.github/workflows/ci.yml`, `.github/workflows/sync-hf-space.yml`, `scripts/static_check.py`, `hfs-dev.toml`, or `services/codex_sdk_bridge/package.json`.

| Command | Purpose | Scope | Sandbox notes |
|---|---|---|---|
| `python scripts/static_check.py` | Default local static gate: tracked boundary checks, `git diff --check`, changed-file whitespace, HFS contract, Python compile, shell syntax, optional `node --check`, HFS alignment | repo | Preferred local validation. If `python` is unavailable on this machine, use `python3 scripts/static_check.py` and report the substitution. |
| `python scripts/reset_db.py` | Recreate demo platform/business SQLite data | repo/runtime data | Writes under `data/`; not default for documentation-only changes. Use only when DB/runtime behavior must be exercised. |
| `python scripts/smoke_test.py` | App smoke after runtime deps are installed | repo | CI app-smoke installs `requirements.txt` first; local run needs installed Python deps and may mutate temp/runtime DBs. |
| `python scripts/security_smoke_test.py` | Security smoke for auth/RBAC/SQL Guard/masking | repo | Same runtime dependency limits as app smoke. |
| `python scripts/full_agent_smoke_test.py` | Full agent workflow smoke | repo | Requires installed deps and initialized app data. |
| `python scripts/codex_runtime_smoke_test.py` | Codex task create/approve/mock dispatch smoke | repo | Should keep default safe/mock behavior unless user authorizes real dispatch. |
| `python scripts/hf_mode_regression_test.py` | Hugging Face mode regression, ops token behavior | repo | Usually run in CI or with explicit `DAP_*` env; may need temp `DAP_DATA_DIR`. |
| `python scripts/standalone_regression_test.py` | Standalone package regression | repo | Requires installed deps and initialized data. |
| `python scripts/hardening_regression_test.py` | Regression gate for demo seed, CORS, redirects, readonly DB, SQL Guard hardening | repo | Use for security/config/db hardening changes after deps are available; CI runs it. |
| `node --check apps/web/static/app.js` | JS syntax check | frontend | Also covered by `scripts/static_check.py` when `node` exists. |
| `node --check services/codex_sdk_bridge/run_task.mjs` | Optional bridge syntax check | Node bridge | Also covered by `scripts/static_check.py` when `node` exists. |
| `npm run run-task` | Execute optional Codex SDK bridge script | `services/codex_sdk_bridge/` | Requires `npm install` in that directory and real SDK/runtime configuration; do not run by default. |
| `docker build --build-arg PYTHON_BASE_IMAGE=python:3.11-slim -t data-agent-panel:test .` | Docker image build used by CI docker-smoke | repo | Requires Docker and network/cache; do not run locally unless user asks. |
| `bash scripts/hf_space_smoke.sh <base-url>` | Remote-style Hugging Face Space smoke | deployed app | Requires live URL; protected/private spaces need `OPS_TOKEN` and possibly auth env. |
| `python scripts/export_hfs_space_bundle.py --output <empty-dir> --source-ref <commit> --wrapper-ref <commit> --base-image <image@sha256:digest>` | Export a provenance-bound thin Space wrapper | repo | Requires immutable inputs and a clean committed wrapper tree; the manual workflow uploads only this bundle after thin-tree preflight. |

## Global rules

- Do not remove or bypass RBAC, SQL Guard, Trace, audit logging, rate limits, approval flows, or dataset masking.
- All generated or user-provided SQL must remain read-only and pass `apps/api/services/sql_guard.py`.
- Any Codex task that can change code must require human approval before CLI/SDK dispatch.
- Preserve backward-compatible API responses unless a migration note and corresponding docs are added.
- Keep demo mode isolated from production/HF configuration. Treat `DAP_DEMO_MODE`, `DAP_ALLOW_DEMO_SEED`, `DAP_SECRET_KEY`, `DAP_OPS_TOKEN`, `DAP_CORS_ORIGINS`, and `DAP_ALLOWED_EXTERNAL_AGENT_HOSTS` as security-sensitive.
- Environment variables use the `DAP_` prefix. Commit only `.env.example`; do not commit `.env`, `.env.local`, real tokens, real account data, private hosts, or secrets.
- Prefer additive schema/runtime changes. Existing installs may run newer code over older demo DBs, so keep `apps/api/db.py` additive migration behavior in mind.
- Keep Hugging Face Space as Pattern B / `cloud/hfs` thin source wrapper. `hfs-dev.toml`, `cloud/hfs/`, `scripts/export_hfs_space_bundle.py`, `hf_entrypoint.sh`, `scripts/hf_space_smoke.sh`, and `.github/workflows/sync-hf-space.yml` must stay aligned. Root `Dockerfile` remains the local/CI product image, not the Space build context.
- This repo has no root JavaScript build system. The frontend is static HTML/CSS/JS served by FastAPI.
- The only Node package in tracked source is the optional private package under `services/codex_sdk_bridge/`.
- For local validation, prefer lightweight checks. Do not install external dependencies, run Docker builds, run full smoke suites, or deploy/sync externally unless the user asks.
- When changing user-facing behavior, update the relevant docs only if the task permits editing docs. If a workflow forbids non-`AGENTS.md` edits, report the doc follow-up instead.

## Do not

- Do not weaken auth, permission checks, SQL table-scope checks, readonly DB connection behavior, Trace creation, audit writes, or approval state transitions to make a test pass.
- Do not manually edit ignored runtime files under `data/`, including `.db` files and generated Codex handoff artifacts.
- Do not treat `local/` as source of truth; it is ignored and excluded from HF upload.
- Do not add a frontend package manager or bundler for a small static UI change unless the user explicitly asks for that migration.
- Do not run `hf upload`, `hf spaces restart`, live Codex CLI/SDK dispatch, or Docker compose/build as an unstated validation step.
- Do not commit credentials, real internal URLs, private templates, production account data, or screenshots/logs containing tokens.
- Do not change `.github/workflows/sync-hf-space.yml` excludes in a way that uploads `.github/**`, `.env*`, `local/**`, `data/**`, `logs/**`, `node_modules/**`, or secret/key file patterns.

## Validation

Default completion checks:

1. For any tracked code/config/script change, run `python scripts/static_check.py` when possible. Use `python3 scripts/static_check.py` if local `python` is missing, and state that substitution in the final report.
2. For API/security/db/Codex hardening changes, also run targeted smoke/regression scripts only when dependencies are already available or the user authorizes installing/running them. Otherwise report that CI covers them.
3. For frontend JS changes, ensure `node --check apps/web/static/app.js` runs directly or through `scripts/static_check.py` when `node` is installed.
4. For workflow, Docker, HFS, or deployment changes, confirm `scripts/static_check.py` passes and identify which CI/HF checks remain remote-only.
5. For documentation-only or `AGENTS.md`-only changes, `scripts/static_check.py` is usually sufficient; if not run, explain why.

Always summarize changed files, validation output, residual risks, and any manual or remote checks that were intentionally skipped.

## Preferred change pattern

1. Inspect the current implementation and nearest `AGENTS.md` before editing.
2. Make the smallest additive change that satisfies the task.
3. Update tests/docs only when the task scope allows those files.
4. Run the lightest meaningful validation for the risk level.
5. Report what was verified versus what remains CI/manual/remote-only.
