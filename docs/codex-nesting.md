# Codex 嵌套方案

## 1. 设计目标

独立数据智能体平台把 Codex 定位为“工程执行型子 Agent”，不是业务分析 Agent 本体。业务 Agent 可以在以下场景嵌套 Codex：

- 生成新的分析面板页面；
- 增加新的 Agent Adapter；
- 补充数据业务规则；
- 修改评测中心；
- 生成数据接入脚手架；
- 修复平台代码问题。

## 2. 调用链

```text
用户问题
  ↓
Agent Router
  ↓
识别为工程/代码/页面/API/程序需求
  ↓
Codex Agent
  ↓
生成 Codex Task + handoff prompt
  ↓
审批
  ↓
mock / HTTP / CLI 派发
  ↓
Trace + 审计 + 产物记录
```

## 3. 模式

| 模式 | 说明 | 默认是否启用 |
|---|---|---|
| mock | 只生成任务和 handoff 文件 | 是 |
| http | 调用企业配置的 Codex-compatible endpoint | 否 |
| cli | 调用本地 Codex CLI | 否 |

## 4. API

```text
GET  /api/codex/workspaces
GET  /api/codex/tasks
POST /api/codex/tasks
GET  /api/codex/tasks/{id}
POST /api/codex/tasks/{id}/approve
POST /api/codex/tasks/{id}/dispatch
```

## 5. 安全护栏

- Codex 任务默认 `requires_approval=true`。
- CLI 模式必须显式设置 `DAP_CODEX_CLI_ENABLED=true`。
- 任务 prompt 强制包含 Guardrails。
- 任务产物进入 `codex_artifacts`。
- 全部操作写入 `audit_logs`。
- 相关 Trace 会记录 `create_codex_task`、`approve_codex_task`、`dispatch_codex_task` 步骤。
