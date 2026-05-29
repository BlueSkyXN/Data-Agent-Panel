---
title: Standalone Data Agent Platform
emoji: 📊
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
suggested_hardware: cpu-upgrade
pinned: false
---

# 独立数据智能体平台

版本：`0.6.0-standalone`

这是一套**独立数据智能体平台**程序包，不依赖任何既有项目，不预设任何企业内部业务系统。它内置了通用经营分析样例数据、Agent Gateway、智能问数、深度研究、知识问答、报告中心、数据目录、语义中心、数据质量、Trace 审计、Codex 工程嵌套和 Hugging Face Docker Space 部署能力。

## 核心能力

```text
Web 工作台
+ Agent Studio
+ 智能问数
+ 深度研究
+ 分析面板
+ 数据目录 / 指标 / 语义
+ 只读 SQL Workbench
+ 数据画像 / 数据质量
+ 知识库绑定
+ 评测中心
+ Trace 证据链
+ RBAC / 审计日志
+ Codex CLI / SDK / HTTP / mock 运行桥
+ Hugging Face Space 单容器部署
```

## 内置通用演示数据

平台默认初始化 5 个通用业务数据集：

| 数据集 | 表 | 用途 |
|---|---|---|
| 销售订单 | `sales_orders` | 收入、订单数、渠道、区域、品类、商品、客户分层分析 |
| 客户工单 | `support_tickets` | 工单类型、根因、严重度、状态、客户服务风险分析 |
| 营销活动 | `marketing_campaigns` | 活动花费、曝光、点击、转化、活动收入和 ROI 分析 |
| 商品目录 | `product_catalog` | 商品、品类、价格、成本、供应商样例 |
| 经营日度指标 | `business_metrics_daily` | 收入、订单、未关闭工单、转化率、风险分日度宽表 |

## 内置 Agent

| Agent | 作用 |
|---|---|
| 数据智能体总控 Agent | 自动路由到问数、工单归因、异常识别、面板、语义、数据质量或 Codex |
| 销售经营问数 Agent | 自然语言查收入、订单、渠道、区域、品类、商品 TopN 和趋势 |
| 客户工单归因 Agent | 分析客户工单根因、问题类型、闭环状态和区域分布 |
| 经营深度研究 Agent | 多步骤分析收入趋势、渠道贡献、工单根因、营销 ROI，并生成报告草稿 |
| 企业知识问答 Agent | 返回指标口径、业务术语、报告模板和知识库引用 |
| 经营报告 Agent | 生成经营周报/月报草稿并保存为报告资产 |
| 经营风险与异常识别 Agent | 识别区域经营风险、收入/工单/转化率异常信号 |
| 数据画像 Agent | 输出字段画像、样本、缺失率、基数和敏感字段提示 |
| 数据质量 Agent | 运行数据质量规则，输出失败样本和 Trace |
| 指标语义治理 Agent | 分析指标、术语、同义词和查询模板覆盖度 |
| 分析面板生成 Agent | 物化经营总览面板和图表组件 |
| Codex 工程嵌套 Agent | 创建、审批、派发 Codex 工程任务，默认 mock 模式 |

## 本地启动

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/reset_db.py
python -m uvicorn apps.api.main:app --host 0.0.0.0 --port 8000 --reload
```

浏览器访问：

```text
http://localhost:8000
```

默认账号：

```text
admin / admin123
user  / user123
```

## Docker 启动

```bash
docker compose up --build
```

## Hugging Face Space 部署

本仓库根目录已适配 Hugging Face Docker Space：

- `README.md` 顶部包含 `sdk: docker` 和 `app_port: 7860`。
- 根目录 `Dockerfile` 是 Space 构建入口。
- `hf_entrypoint.sh` 自动初始化 SQLite 平台库和业务样例库。
- 默认端口为 `7860`。
- `hfs-dev.toml` 声明本仓库为 HFS Pattern A / self-contained / repo-root。
- Canonical 只读诊断入口为 `/_ops/healthz`，兼容 `/_ops/health`、`/healthz` 和 `/nginx-health`。

推荐 Space Variables：

```env
DAP_APP_ENV=hf-space
DAP_HF_SPACE=true
DAP_DEMO_MODE=true
DAP_CORS_ORIGINS=*
DAP_CODEX_MODE=mock
```

推荐 Space Secrets：

```env
DAP_SECRET_KEY=<强随机密钥>
DAP_OPS_TOKEN=<强随机运维只读 token>
```

部署后执行：

```bash
OPS_TOKEN=<你的 DAP_OPS_TOKEN> scripts/hf_space_smoke.sh https://<space-name>.hf.space
```

## Codex 嵌套说明

平台内置 Codex 工程运行桥，但默认安全模式为 `mock`，不会自动修改代码。

支持模式：

| 模式 | 说明 |
|---|---|
| `mock` | 生成 handoff 文件和事件，不执行代码 |
| `http` | 调用企业配置的 Codex-compatible HTTP endpoint |
| `cli` | 调用本地 `codex exec`，需设置 `DAP_CODEX_CLI_ENABLED=true` |
| `sdk` | 调用本地 Python Codex SDK，需企业环境安装并授权 |

## 测试

本机只建议做无外部依赖安装的静态检查：

```bash
python scripts/static_check.py
```

依赖安装、应用 smoke、Docker build/run smoke 均放在 GitHub Actions：

```bash
.github/workflows/ci.yml
```

## 边界

当前版本是独立可运行平台基线，内置的是通用样例数据和规则。正式生产仍需接入：

```text
企业 SSO / IAM
真实数据库或数仓
真实行列权限继承
真实 Dify / SuperSonic / DB-GPT / RAGFlow / 模型服务
真实业务知识库
真实评测集
生产级监控、备份、安全扫描和渗透测试
```
