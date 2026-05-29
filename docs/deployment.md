# Deployment Guide

## Hugging Face Docker Space 快速部署

本版本已适配 Hugging Face Docker Space。根目录 `README.md` 已包含 `sdk: docker` 与 `app_port: 7860`，根目录 `Dockerfile` 会启动 FastAPI 单容器应用并监听 `7860`。

```bash
# 推送到 Hugging Face Space 仓库后，Space 会自动 build。
# 部署后验收：
OPS_TOKEN=<DAP_OPS_TOKEN> scripts/hf_space_smoke.sh https://<space-name>.hf.space
```

当前标准对齐：

```text
pattern: A
runtime_mode: self-contained
space_root_mode: repo-root
canonical_health_endpoint: /_ops/healthz
```

建议在 Space Settings 中设置：

```text
Hardware: CPU Upgrade 或更高
Storage Bucket: mount 到 /persist，或使用 /data Persistent Storage
Visibility: Private 或 Protected
```

建议 Secrets：

```env
DAP_SECRET_KEY=<强随机密钥>
DAP_OPS_TOKEN=<强随机运维只读 token>
```

详细见 `README.hf-space.md` 和 `docs/huggingface-spaces.md`。

## GitHub / HF 四态验证

部署结论按四个状态分开确认：

1. GitHub `main` 已包含目标 commit。
2. HF Space repo `sha` 已更新到本次同步 commit。
3. HF runtime `stage` 进入 `RUNNING`。
4. live endpoint smoke 通过 `/_ops/healthz`、`/api/health/live` 和一次登录问数链路。

---

# 部署说明

## 开发环境

```bash
python scripts/reset_db.py
python -m uvicorn apps.api.main:app --host 0.0.0.0 --port 8000 --reload
```

## Docker 环境

```bash
docker compose up --build
```

## 生产样例

```bash
export DAP_SECRET_KEY="强随机密钥"
export DAP_CORS_ORIGINS="https://your.domain"
export DAP_ALLOWED_EXTERNAL_AGENT_HOSTS="agent-service.internal,localhost"
docker compose -f docker-compose.prod.yml up --build -d
```

## 健康检查

```bash
curl http://localhost:8000/api/health/live
curl http://localhost:8000/api/health/ready
```

## 生产建议

- 放在企业内网或 VPN 后面。
- 前置 HTTPS 反向代理。
- 集中日志接入 Loki/ELK/OpenSearch。
- 指标监控接入 Prometheus/Grafana。
- SQLite 只适合内测，生产建议迁移到企业标准元数据库。
- 真实业务数据源必须使用只读账号。
