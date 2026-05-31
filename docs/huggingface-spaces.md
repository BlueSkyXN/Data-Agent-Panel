# Hugging Face Spaces 适配设计

## 1. 目标

将 独立数据智能体平台调整为 Hugging Face Docker Space 可直接部署的单容器应用：

```text
FastAPI Web/API/Agent Gateway
+ SQLite 样例数据能力
+ Trace / SQL Guard / 评测 / Codex handoff
+ HF 单端口 7860
+ /persist 或 /data 持久化
+ 只读 _ops 运维诊断
```

## 2. 关键适配项

| 项 | 调整 |
|---|---|
| Space 元数据 | `README.md` 顶部增加 `sdk: docker`、`app_port: 7860` |
| 端口 | `Dockerfile` 对外 `EXPOSE 7860`，启动命令绑定 `0.0.0.0:${PORT:-7860}` |
| 运行用户 | UID/GID `1000` 的 `user`，避免 HF Space rootless 权限问题 |
| 数据目录 | `hf_entrypoint.sh` 自动选择 `/persist`、`/data` 或 `/tmp` |
| 初始化 | 容器启动时执行 `db.init_all(reset=False)`，幂等创建 SQLite DB 和样例数据 |
| iframe | HF 模式不设置 `X-Frame-Options=SAMEORIGIN`，改用 CSP `frame-ancestors` 允许 Hugging Face 父页面 |
| 运维 | 提供 `/healthz`、`/nginx-health`、`/_ops/healthz`、`/_ops/health`、`/_ops/system`、`/_ops/config`、`/_ops/persistence`、`/_ops/errors`、`/_ops/metrics` |
| 控制面 | `/_ops/` 是只读 HFS Ops 控制面；`/_admin/` 复用平台登录和 RBAC，作为 Admin 控制面入口 |
| Compose | HF 不用 compose；保留 `docker-compose.hf-local.yml` 仅做本地模拟 |

## 3. 文件变化

```text
README.md                    # HF Space YAML + 部署说明
README.hf-space.md            # 专门部署说明
Dockerfile                    # HF Space 单容器入口
hf_entrypoint.sh              # HF runtime 初始化和启动
.dockerignore                 # 避免把本地 DB/日志打入镜像
scripts/hf_space_smoke.sh     # 远程验收脚本
docs/huggingface-spaces.md    # 适配设计说明
apps/api/routers/hf_space.py  # HF ops 诊断 API
apps/api/middleware.py        # HF iframe 安全头适配
apps/web/static/*             # 平台内 Ops / Admin 控制面
```

## 4. 持久化策略

默认推荐把 Storage Bucket 挂载为 `/persist`：

```text
/persist/data-agent-platform/data_agent_platform.db
/persist/data-agent-platform/business_sample.db
/persist/data-agent-platform/codex_tasks/
```

如果没有 `/persist`，自动回退到 `/data/data-agent-platform`。如果 `/data` 也不可写，则回退到 `/tmp/data-agent-platform`，但该模式不保证重启后数据保留。

## 5. 安全边界

HF Space 适配包仍然是演示 / POC / 内测部署形态：

- 公共 Space 必须设置 `DAP_SECRET_KEY` 和 `DAP_OPS_TOKEN`。
- `DAP_OPS_TOKEN` 未设置时，`/_ops/*` 会在 HF / production 模式下锁定。
- `/_ops/*` 保持只读，不执行重启、写配置、SQL 写入、任意命令或任意文件读取。
- `/_admin/` 由平台登录和 `admin` 角色保护，不复用 `DAP_OPS_TOKEN` 做管理授权。
- `DAP_SECRET_KEY` 未设置时，Docker entrypoint 会在持久化数据目录生成随机值；正式部署仍建议放入 Space Secrets。
- 建议 Visibility 使用 Private 或 Protected。
- 不建议把真实生产数据放进 Space。
- 不建议在公共 Space 开启 Codex CLI/SDK 执行。
- 如需接真实外部 Agent，必须配置 `DAP_ALLOWED_EXTERNAL_AGENT_HOSTS` 白名单。

## 6. 本地模拟

```bash
docker compose -f docker-compose.hf-local.yml up --build
OPS_TOKEN=local-hf-ops-token scripts/hf_space_smoke.sh http://localhost:7860
```
