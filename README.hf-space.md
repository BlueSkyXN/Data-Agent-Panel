# Hugging Face Space 部署说明

Data Agent Panel 使用 HFS v2 **Pattern B / source lane**。`cloud/hfs/` 是唯一
可导出的 Space wrapper；产品仓根目录、应用源码、数据库 schema、文档、`local/`、
运行数据与 `.env*` 都不会上传到 Space。

Space Docker build 会从公开 GitHub 在明确的 40 位 commit checkout 产品源码，并校验
checkout `HEAD`。导出 bundle 中的 `BUILD_SOURCE.json` 同时记录 source commit、wrapper
commit 与 Python base-image digest。缺少其中任一不可变输入时，导出工具会拒绝生成 bundle。

## 导出前提

- 选择已审批、包含待部署产品代码且可从 `origin/main` 到达的完整 Git commit；不要使用分支名、tag 名或 `HEAD`。
- wrapper、最小 manifest 与 exporter 必须已提交并与 `--wrapper-ref` 完全一致；exporter 会拒绝未提交或未跟踪的 wrapper 输入，避免伪造 provenance。
- 选择已审批的 Python base image digest，例如
  `python:3.11-slim@sha256:<64-hex-digest>`；不能使用浮动 tag。
- candidate 或目标 Space 必须已有可写的 `/persist` Storage Bucket mount。
- 先完成数据 owner 批准的 SQLite backup、verify 与隔离恢复；本仓的 wrapper 不执行这些
  状态操作。

本地仅生成一个新/空的临时目录，绝不覆盖既有 bundle：

```bash
python3 scripts/export_hfs_space_bundle.py \
  --output /tmp/data-agent-panel-hfs-bundle \
  --source-ref <approved-40-character-product-commit> \
  --wrapper-ref <approved-40-character-wrapper-commit> \
  --base-image python:3.11-slim@sha256:<approved-64-hex-digest> \
  --manifest hfs-dev.candidate.toml
```

导出的 bundle 仅包含：`README.md`、`Dockerfile`、`entrypoint.sh`、`.dockerignore`、
`hfs-dev.toml` 和 `BUILD_SOURCE.json`。检查 `BUILD_SOURCE.json` 后，才可由人工触发的
GitHub workflow 上传。workflow 会在上传前和读回时拒绝包含 allowlist 外文件的 Space tree，
因此只能用于空 candidate 或已是 thin wrapper 的 Space；默认流程不使用 `--delete "*"`、不
factory reboot，也不删除旧 Space 文件。清理旧 full-repo 内容、切换生产 Space 或重启均须独立
owner 批准与读回。

## Space Settings 分类

**Secrets（只登记键名，不提交值）**：

```text
DAP_SECRET_KEY
DAP_OPS_TOKEN
DAP_BOOTSTRAP_ADMIN_USERNAME
DAP_BOOTSTRAP_ADMIN_PASSWORD
```

`DAP_BOOTSTRAP_ADMIN_*` 仅在关闭 demo seed 的首次初始化期间使用；管理员创建成功后应
移除 bootstrap password。

**Variables**：

```text
DAP_APP_ENV
DAP_APP_VERSION
DAP_DEMO_MODE
DAP_ALLOW_DEMO_SEED
DAP_HF_SPACE
DAP_CORS_ORIGINS
DAP_ALLOWED_EXTERNAL_AGENT_HOSTS
DAP_CODEX_MODE
DAP_CODEX_REQUIRE_APPROVAL
DAP_SQLITE_BACKUP_MAX_AGE_HOURS
DAP_SQLITE_MIN_FREE_MB
DAP_SQLITE_INIT_LOCK_TIMEOUT_SECONDS
PORT
```

`HF_TOKEN`、`GH_TOKEN` 只属于本机/CI 控制面，绝不作为 Space Settings。`DAP_DATA_DIR`、
`DAP_DB_PATH`、`DAP_BUSINESS_DB_PATH`、`DAP_CODEX_TASK_DIR` 是本地部署控制项，wrapper
会将它们约束在 `/persist/data-agent-platform`，不应将其作为普通 Space Variable 分发。

Settings 必须从本地 `.env` 事实源执行 `diff → push → readback`。candidate 与 production
分别选择独立 manifest，不允许临时覆盖 Space ID：

```bash
python3 scripts/hf_space_sync.py diff --manifest hfs-dev.candidate.toml --env-file .env
python3 scripts/hf_space_sync.py push --manifest hfs-dev.candidate.toml --env-file .env
python3 scripts/hf_space_sync.py diff --manifest hfs-dev.candidate.toml --env-file .env
```

Secret 仅核对名称，Variable 核对值；清理窗口获批前不得使用 `--prune --yes`。

## 持久化与运行边界

wrapper 只接受 `/persist` 下的路径，默认使用：

```text
/persist/data-agent-platform/data_agent_platform.db
/persist/data-agent-platform/business_sample.db
/persist/data-agent-platform/codex_tasks/
```

没有可写 `/persist`、路径越出该目录，或 source checkout 失败时均以非零状态失败；不会
降级使用 `/data`、`/tmp` 或镜像内数据库。原有 `hf_entrypoint.sh` 继续负责幂等数据库初始化、
持久化随机签名密钥与 FastAPI 启动，但在 wrapper 强制的持久化目录内运行。

## 线上 smoke

完成 Space provenance readback、构建成功和显式 restart 授权后，可使用：

```bash
OPS_TOKEN=<DAP_OPS_TOKEN> scripts/hf_space_smoke.sh https://<space-name>.hf.space
```

smoke 会检查 health/ready、只读 ops、iframe headers、登录和基础问数链路。它不替代
SQLite backup/verify、隔离恢复、RBAC/Trace/Admin 验收或生产切换观察。
