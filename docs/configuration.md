# Configuration

## 配置来源优先级

运行配置来自环境变量，统一使用 `DAP_` 前缀。仓库内只提交 `.env.example` 作为字段说明；真实值放在本机 `.env.local`、GitHub Secrets 或 Hugging Face Space Variables/Secrets 中。

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
DAP_APP_VERSION=0.6.0-standalone
DAP_DEMO_MODE=true
DAP_ALLOW_DEMO_SEED=true
DAP_HF_SPACE=true
DAP_CORS_ORIGINS=*
DAP_CODEX_MODE=mock
DAP_CODEX_REQUIRE_APPROVAL=true
DAP_ALLOWED_EXTERNAL_AGENT_HOSTS=localhost,127.0.0.1
PORT=7860
```

## Hugging Face Secrets

建议放在 Space Secrets：

```env
DAP_SECRET_KEY=<strong random secret>
DAP_OPS_TOKEN=<strong random read-only ops token>
```

`DAP_OPS_TOKEN` 未配置时，`/_ops/*` 在 HF / production 模式下会锁定。Docker/HF entrypoint 会在 `DAP_SECRET_KEY` 缺失时生成持久化随机值，但这只是防止默认签名密钥暴露的兜底；正式部署仍应显式设置 Secret。

不要把真实 secret、内部 URL、客户数据或 `.env.local` 提交进 GitHub 或同步到公开产物中。

## 本地账本

本仓库根目录的 `.env.local` 是本机账本，已由 `.gitignore` 和全局 ignore 排除。它可以记录当前 GitHub/HF 部署目标和本机 smoke 所需 token，但不作为公开文档或构建输入。
