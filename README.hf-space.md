# Hugging Face Space 部署说明

本平台已适配 Hugging Face **Docker Space**，对外暴露单端口 `7860`。

本仓库根目录就是 Space root；`hfs-dev.toml` 声明为 Pattern A / self-contained / repo-root。Canonical health endpoint 是 `/_ops/healthz`，同时保留 `/_ops/health`、`/healthz`、`/nginx-health` 作为兼容 smoke 入口。

## Space 配置

```yaml
sdk: docker
app_port: 7860
```

## 推荐 Variables

```env
DAP_APP_ENV=hf-space
DAP_HF_SPACE=true
DAP_DEMO_MODE=true
DAP_CORS_ORIGINS=*
DAP_ALLOWED_EXTERNAL_AGENT_HOSTS=localhost,127.0.0.1
DAP_CODEX_MODE=mock
```

## 推荐 Secrets

```env
DAP_SECRET_KEY=<强随机密钥>
DAP_OPS_TOKEN=<强随机运维只读 token>
```

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

把本程序包内容复制到 Space 仓库根目录，然后：

```bash
git add .
git commit -m "deploy standalone data agent platform"
git push
```

## 线上 smoke test

```bash
OPS_TOKEN=<你的 DAP_OPS_TOKEN> scripts/hf_space_smoke.sh https://<space-name>.hf.space
```
