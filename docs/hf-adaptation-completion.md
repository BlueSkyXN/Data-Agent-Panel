# Hugging Face Space 适配完成记录

版本：`0.5.0-hf-space`

## 已完成

- 根目录 README 加入 Hugging Face Space YAML 元数据：`sdk: docker`、`app_port: 7860`。
- 根目录 Dockerfile 改为 HF Docker Space 单容器入口。
- 运行用户改为 UID/GID 1000 的 `user`。
- 新增 `hf_entrypoint.sh`，支持 `/persist`、`/data`、`/tmp` 自动数据目录选择。
- 新增 `DAP_HF_SPACE`、`DAP_PERSIST_DIR`、`DAP_OPS_TOKEN`、`SPACE_HOST`、`SPACE_ID` 运行时识别。
- 新增 `/healthz`、`/nginx-health`、`/_ops/health`、`/_ops/system`、`/_ops/config`、`/_ops/version`。
- HF 模式移除 `X-Frame-Options=SAMEORIGIN`，改用 CSP `frame-ancestors` 允许 Hugging Face 父页面。
- 新增 `.dockerignore`，防止本地 SQLite DB、日志、Codex 任务进入镜像。
- 新增 `docker-compose.hf-local.yml`，可本地模拟 HF Space runtime。
- 新增 `scripts/hf_space_smoke.sh` 远程 Space smoke 测试。
- 新增 `scripts/hf_mode_regression_test.py`，验证 HF 模式 headers 和 ops endpoint。
- 新增 `README.hf-space.md` 和 `docs/huggingface-spaces.md`。

## 验证结果

已执行：

```bash
python scripts/reset_db.py
python -m compileall -q apps scripts
python scripts/smoke_test.py
python scripts/security_smoke_test.py
python scripts/full_agent_smoke_test.py
python scripts/codex_runtime_smoke_test.py
python scripts/hardening_regression_test.py
DAP_HF_SPACE=true DAP_OPS_TOKEN='' DAP_DATA_DIR=/tmp/dap-hf-test python scripts/hf_mode_regression_test.py
node --check apps/web/static/app.js
```

通过项：

- 平台初始化
- 智能问数
- 深度分析审批
- SQL Guard
- 数据画像
- 数据质量
- 分析面板物化
- 语义覆盖率
- Codex mock 派发
- 硬化回归测试
- HF iframe header 适配
- HF ops endpoint
- 前端 JS 语法检查

## 未在当前环境实际验证

- Hugging Face 远程 build 日志。
- 实际 Space runtime 的 `/persist` bucket 挂载。
- 真实 Codex CLI / SDK 执行。
- 真实外部 Agent 接入。

这些需要在目标 HF Space 中推送仓库后，通过 `scripts/hf_space_smoke.sh` 完成 live 验收。
