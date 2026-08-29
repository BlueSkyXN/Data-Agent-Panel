# API 摘要

完整 OpenAPI 文档启动后访问：

```text
http://localhost:8000/docs
```

## 认证

```http
POST /api/auth/login
GET  /api/auth/me
```

登录成功后使用：

```http
Authorization: Bearer <token>
```

在 Hugging Face Protected/Private Space 的脚本化 smoke 中，如果 `Authorization`
已被 HF 代理 token 占用，也可以使用等价的应用认证头：

```http
X-DAP-Token: <token>
```

## Agent

```http
GET  /api/agents
POST /api/agents
GET  /api/agents/{agent_id}
POST /api/agents/{agent_id}/publish
POST /api/agents/{agent_id}/disable
```

## 智能问数

```http
POST /api/chat/query
POST /api/chat/feedback
```

统一输出包含：

```json
{
  "answer": "",
  "answer_type": "metric_analysis",
  "confidence": 0.82,
  "tables": [],
  "charts": [],
  "sql": [],
  "evidence": [],
  "warnings": [],
  "next_actions": [],
  "trace_id": "trace_xxx"
}
```

## 深度分析

```http
POST /api/analysis/tasks
GET  /api/analysis/tasks/{task_id}
POST /api/analysis/tasks/{task_id}/approve-plan
POST /api/analysis/tasks/{task_id}/cancel
```

高风险 Agent 或请求 `require_plan_approval=true` 时，任务先进入 `awaiting_approval` 状态。

## Trace

```http
GET /api/traces/{trace_id}
```

返回 Trace、Trace Steps、SQL Runs、Tool Calls、Chart Specs。

## 数据目录

```http
GET  /api/data-sources
POST /api/data-sources
GET  /api/datasets
POST /api/datasets
GET  /api/datasets/{dataset_id}/fields
GET  /api/metrics
POST /api/metrics
```

普通用户只返回有权限的数据集；管理员可查看数据源。

## 知识库

```http
GET  /api/knowledge-bases
POST /api/knowledge-bases
GET  /api/knowledge-bases/{kb_id}/versions
```

## 报告

```http
GET  /api/reports
GET  /api/reports/{report_id}
POST /api/reports/{report_id}/submit-review
POST /api/reports/{report_id}/approve
POST /api/reports/{report_id}/publish
```

## 评测

```http
GET  /api/eval-sets
POST /api/eval-sets
GET  /api/eval-sets/{eval_set_id}/cases
POST /api/eval-sets/{eval_set_id}/cases
POST /api/eval-runs
GET  /api/eval-runs/{run_id}
```

## 管理

```http
GET /api/admin/users
GET /api/admin/roles
GET /api/admin/audit-logs
GET /api/admin/stats
GET /api/admin/config
```

管理控制面入口：

```http
GET /_admin/
```

## 运维诊断

`/_ops/*` 使用 `OPS_TOKEN` 保护，支持 `X-Ops-Token`、`Authorization: Bearer <token>`、临时 query token 和 cookie-backed dashboard。该面只读，不提供重启、写配置、执行 SQL 或文件写入能力。

```http
GET /_ops/
GET /_ops/healthz
GET /_ops/health
GET /_ops/system
GET /_ops/config
GET /_ops/persistence
GET /_ops/errors
GET /_ops/metrics
GET /_ops/version
```

## V0.3 新增接口

### 数据能力

```text
POST /api/data/query
GET  /api/data/profile/{dataset_id}
GET  /api/data/quality-rules
POST /api/data/quality/run
GET  /api/data/quality-results
GET  /api/data/panels
POST /api/data/panels
GET  /api/data/panels/{panel_id}
POST /api/data/panels/{panel_id}/widgets
POST /api/data/import/csv
```

### 语义中心

```text
GET  /api/semantic/terms
POST /api/semantic/terms
GET  /api/semantic/query-templates
GET  /api/semantic/coverage
```

### Codex 嵌套

```text
GET  /api/codex/workspaces
GET  /api/codex/tasks
POST /api/codex/tasks
GET  /api/codex/tasks/{task_id}
POST /api/codex/tasks/{task_id}/approve
POST /api/codex/tasks/{task_id}/dispatch
```

### 内置 Agent

推荐通过 `/api/chat/query` 调用 `agent_router`，由总控 Agent 自动路由：

```json
{
  "agent_id": "agent_router",
  "message": "当前经营风险最高的项目有哪些？"
}
```
