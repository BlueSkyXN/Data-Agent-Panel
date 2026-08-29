# Deployment Guide

## Hugging Face Docker Space

Data Agent Panel 的 HFS v3.0 Preview 部署使用 thin source wrapper，而不是将产品仓根目录同步到
Space。当前约定：

```text
pattern: B
lane: source
runtime_mode: source-fetch
space_root_mode: flat-remap
canonical_health_endpoint: /_ops/healthz
```

`cloud/hfs/` 的 Dockerfile 在 Space build 阶段从公开 GitHub checkout 明确的 40 位 source
commit，并验证 checkout `HEAD`。`scripts/export_hfs_space_bundle.py` 只导出 wrapper 与
`BUILD_SOURCE.json`，后者记录 source/wrapper commit 和 base-image digest。导出输入必须是
完整 commit 和 digest，不能使用分支、tag、`HEAD` 或浮动 image tag。

部署前必须由 owner 确认：

1. canonical source/wrapper commit；
2. 已审批 Python base-image digest；
3. canonical preview Space 的 `/data` Storage Bucket mount；candidate 仅在高风险可选验证时使用；
4. SQLite backup、verify 和隔离恢复基线；
5. Settings 最小键集与 restart 授权；Secret 必须本地明文先行。

详细的无密导出、Settings 分类和执行边界见 `README.hf-space.md`。本仓的手动 workflow
仅上传已验证的最小 wrapper bundle，并在写前/写后拒绝 allowlist 外的 Space tree；不默认删除旧
Space 文件、不 factory reboot，也不会替 owner 执行生产切换。

## GitHub / HF 四态验证

部署结论按四个状态分开确认：

1. GitHub canonical commit 已包含目标产品和 wrapper。
2. Space repo revision 已读回，并且其 `BUILD_SOURCE.json` 与上传 commit/digest 一致。
3. Space runtime `stage` 进入 `RUNNING`，且 runtime provenance 可核对。
4. live smoke 通过 `/_ops/healthz`、`/api/health/live` 和一次登录问数链路。

以上均不替代 SQLite backup/verify、隔离 restore、RBAC/Trace/Ops/Admin 与 restart 后持久化
验收；这些有状态检查须在 candidate 或已授权维护窗口独立留证。

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

根目录 `Dockerfile` 保留为本地/CI 产品镜像，不是 HFS wrapper build context。

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
