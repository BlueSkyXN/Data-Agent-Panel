# Hugging Face Space 部署说明

本平台已适配 Hugging Face **Docker Space**，对外暴露单端口 `7860`。

本仓库根目录就是 Space root；`hfs-dev.toml` 声明为 Pattern A / self-contained / repo-root。Canonical health endpoint 是 `/_ops/healthz`，同时保留 `/_ops/health`、`/healthz`、`/nginx-health` 作为兼容 smoke 入口。`/_ops/` 是只读 HFS Ops 控制面，`/_admin/` 是复用平台登录和 RBAC 的 Admin 控制面入口。

## Space 配置

```yaml
sdk: docker
app_port: 7860
```

## 推荐 Variables

```env
DAP_APP_ENV=hf-space
DAP_APP_VERSION=0.7.0-calm-workspace
DAP_HF_SPACE=true
DAP_DEMO_MODE=true
DAP_ALLOW_DEMO_SEED=true
DAP_CORS_ORIGINS=*
DAP_ALLOWED_EXTERNAL_AGENT_HOSTS=localhost,127.0.0.1
DAP_CODEX_MODE=mock
```

## 推荐 Secrets

```env
DAP_SECRET_KEY=<强随机密钥>
DAP_OPS_TOKEN=<强随机运维只读 token>
```

`DAP_OPS_TOKEN` 控制 `/_ops/*` 只读诊断入口。未配置时，HF / production 模式会锁定这些接口并返回不可用状态。`DAP_SECRET_KEY` 缺失时，Docker entrypoint 会在持久化数据目录中生成随机签名密钥；长期部署仍建议显式设置 Space Secret。

当前目标 Space 的非敏感配置、Secret 名称和镜像基线登记在 [`docs/hfs-environment-register.md`](docs/hfs-environment-register.md)。该登记只记录键和值的公开部分，绝不记录任何 Secret 值。

`/_ops/*` 仅暴露 health、system、config、persistence、errors、metrics 和 version 等只读信息，不提供重启、写配置、执行 SQL 或任意命令能力。管理统计、用户、角色、运行配置和审计查看在 `/_admin/` / `/api/admin/*`，并继续要求 `admin` 角色。

如果将 `DAP_DEMO_MODE` 或 `DAP_ALLOW_DEMO_SEED` 设为 `false`，启动时不会创建默认演示账号和内置演示平台 fixture；正式环境需要先通过受控流程预置管理员账号。

## 持久化目录优先级

```text
DAP_DATA_DIR
→ DAP_PERSIST_DIR/data-agent-platform
→ /persist/data-agent-platform
→ /data/data-agent-platform
→ /tmp/data-agent-platform
```

建议在 Hugging Face Space 中启用持久化存储，否则重启后 SQLite 数据会回到初始化状态。

## 部署

推荐通过 GitHub Actions 将已审阅的候选提交同步到目标 Space；它会执行静态契约检查、上传 repo root 并 factory rebuild：

```bash
gh workflow run sync-hf-space.yml \
  --repo BlueSkyXN/Data-Agent-Panel \
  --ref <candidate-ref> \
  -f space_id=BlueSkyXN/Data-Agent-Panel-HFS
```

同步是覆盖式发布；不要把未提交的本地工作树或 `.env*`、`data/`、`local/` 内容当作上传候选。Actions 完成后仍必须用受保护的 `/_ops/*` smoke 和 Space runtime/log readback 验证运行态。

## 线上 smoke test

```bash
OPS_TOKEN=<你的 DAP_OPS_TOKEN> scripts/hf_space_smoke.sh https://<space-name>.hf.space
```

如已禁用默认演示账号，可显式传入 smoke 账号：

```bash
SMOKE_USERNAME=<用户名> SMOKE_PASSWORD=<密码> \
  OPS_TOKEN=<你的 DAP_OPS_TOKEN> scripts/hf_space_smoke.sh https://<space-name>.hf.space
```
