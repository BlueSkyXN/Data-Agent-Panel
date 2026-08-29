# Configuration

## 配置来源优先级

运行配置来自环境变量，统一使用 `DAP_` 前缀。仓库内只提交 `.env.example` 作为字段说明；HFS 的真实值先保存在本机明文 `.env`，再按分类写入 Hugging Face Space Variables/Secrets。`.env.local` 仅保留产品本地运行兼容。

```text
runtime env / Space Settings
> 本机手动 source 的 .env.local
> .env.example 中记录的默认示例
> 代码内安全默认值
```

应用不会自动读取 `.env.local`。本机调试时需要显式执行：

```bash
set -a
source .env.local
set +a
```

## Hugging Face Variables

建议放在 Space Variables：

```env
DAP_APP_ENV=hf-space
DAP_APP_VERSION=0.7.0-calm-workspace
DAP_DEMO_MODE=true
DAP_ALLOW_DEMO_SEED=true
DAP_HF_SPACE=true
DAP_CORS_ORIGINS=*
DAP_CODEX_MODE=mock
DAP_CODEX_REQUIRE_APPROVAL=true
DAP_ALLOWED_EXTERNAL_AGENT_HOSTS=localhost,127.0.0.1
DAP_SQLITE_BACKUP_MAX_AGE_HOURS=168
DAP_SQLITE_MIN_FREE_MB=256
DAP_SQLITE_INIT_LOCK_TIMEOUT_SECONDS=30
PORT=7860
```

## Hugging Face Secrets

建议放在 Space Secrets：

```env
DAP_SECRET_KEY=<strong random secret>
OPS_TOKEN=<strong random read-only ops token>
# Demo seed disabled only: remove after the first admin has been created.
# ADMIN_USERNAME=<admin username>
# ADMIN_PASSWORD=<one-time strong password>
```

`OPS_TOKEN` 未配置时，`/_ops/*` 在 HF / production 模式下会锁定。Docker/HF entrypoint 会在 `DAP_SECRET_KEY` 缺失时生成持久化随机值，但这只是防止默认签名密钥暴露的兜底；正式部署仍应显式设置 Secret。

`DAP_DEMO_MODE=false` 或 `DAP_ALLOW_DEMO_SEED=false` 会跳过默认 `admin` / `user` 账号和内置演示 Agent、数据集、面板、知识库、评测集等平台 fixture。首次启动空 SQLite 库时，可临时设置 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 创建管理员账号；密码只用于初始化哈希写库，不会出现在 redacted config 中。账号创建后应移除 `ADMIN_PASSWORD`。

本地/非 HFS 部署下，`DAP_DATA_DIR` 或 `DAP_PERSIST_DIR` 应与 `DAP_DB_PATH` / `DAP_BUSINESS_DB_PATH` 保持同一持久化目录。HFS v3 thin wrapper 使用标准 `/data` Storage Bucket mount，并将 `DAP_DATA_DIR` 默认固定为 `/data/data-agent-platform`；显式数据库、任务目录或 HF cache 路径必须仍在该目录内，越界或 `/data` 不可写会直接失败，不会回退到 repo 内或 `/tmp`。这些路径属于 wrapper 的本地部署控制，不作为普通 Space Variable 分发。

不要把真实 secret、内部 URL、客户数据或 `.env.local` 提交进 GitHub 或同步到公开产物中。

## 本地账本

本仓库根目录的 `.env` 是 HFS 唯一的本机明文事实源，已由 `.gitignore` 排除。任何 Secret 都必须先在这里保存，再写入无法反向读回值的 Space Secret。`.env.local` 可以继续承载产品本地运行兼容，但不能成为第二份 HFS 事实源。candidate profile 使用独立的 `local/hfs-targets/candidate.env`。
