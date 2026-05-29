# 独立数据智能体平台架构

```text
业务入口层
  Web 工作台 / OpenAPI / iframe / 企业 IM 预留
        ↓
Agent Gateway
  Agent Registry / Adapter Gateway / Intent Router / Session / Task / Trace
        ↓
Agent 能力层
  Dify / SuperSonic / DB-GPT / RAGFlow / Generic HTTP / Mock Agent
        ↓
数据与语义层
  数据源 / 数据集 / 字段字典 / 指标字典 / 同义词 / 权限策略
        ↓
治理与运营层
  RBAC / SQL Guard / 审计 / 评测 / 报告 / 人工审批
```

## 核心设计原则

1. 平台自研，Agent 能力嵌套。
2. 所有 Agent 调用必须经过 Gateway。
3. 所有 SQL 必须经过 SQL Guard。
4. 所有输出必须绑定 Trace 和证据。
5. 高风险分析和报告必须可人工复核。
6. 评测集和反馈闭环从第一版开始建设。

## 与火山 Data Agent 的对应关系

| 火山类能力 | 本平台对应 |
|---|---|
| 智能问数 | Chat Query + ChatBI Adapter |
| 深度研究 | Analysis Task + 报告中心 + 审批流 |
| 语义模型 | Dataset / Field / Metric / Synonym |
| 企业知识 | Knowledge Binding + RAG Adapter |
| Trace/审计 | Trace Service + Audit Logs |
| 权限 | RBAC + Agent Permission + Dataset Permission + SQL Guard |
| 开放集成 | Generic HTTP Adapter + OpenAPI |

## V0.3 完整内置 Agent 架构

```text
入口层
  ├─ Web 工作台
  ├─ 智能问数页
  ├─ 数据能力页
  ├─ 分析面板页
  ├─ 语义中心
  └─ Codex 工作台

Agent 层
  ├─ Meta Router Agent
  ├─ Sales ChatBI Agent
  ├─ Ticket Analysis Agent
  ├─ Deep Research Agent
  ├─ Risk Agent
  ├─ Data Profile Agent
  ├─ Data Quality Agent
  ├─ Semantic Governance Agent
  ├─ Panel Builder Agent
  └─ Codex Engineering Agent

数据能力层
  ├─ Dataset Catalog
  ├─ Metric Dictionary
  ├─ Semantic Terms
  ├─ Query Templates
  ├─ SQL Guard
  ├─ Data Profiling
  ├─ Data Quality Rules
  ├─ Dashboard Panels
  └─ CSV Import

治理层
  ├─ RBAC
  ├─ Dataset Permission
  ├─ Field Masking
  ├─ Trace
  ├─ Audit
  ├─ Evaluation
  └─ Human Approval
```
