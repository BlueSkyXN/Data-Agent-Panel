# Agent Adapter 开发规范

## 1. 统一调用输入

平台调用外部 Agent 时，建议外部服务接收：

```json
{
  "message": "用户问题",
  "context": {},
  "user": {
    "id": "u_xxx",
    "roles": ["quality_user"]
  }
}
```

平台会附加 HTTP Header：

```http
X-DAP-Trace-ID: trace_xxx
```

## 2. 统一输出协议

```json
{
  "answer": "自然语言答案",
  "answer_type": "metric_analysis|deep_analysis|knowledge_answer|report|text",
  "confidence": 0.82,
  "tables": [
    {"name": "query_result", "columns": ["name", "value"], "rows": []}
  ],
  "charts": [
    {"chart_type": "bar", "title": "标题", "spec": {"x": "name", "y": "value", "data": []}}
  ],
  "sql": [
    {"dataset": "dataset_orders", "sql_text": "select ...", "status": "success"}
  ],
  "evidence": [
    {"type": "dataset", "name": "销售订单", "dataset_id": "dataset_orders"},
    {"type": "knowledge", "name": "业务规则知识库", "ref_id": "kb_business_rules"}
  ],
  "warnings": [],
  "next_actions": []
}
```

## 3. Generic HTTP Adapter 配置

后台 `tool_adapters` 中：

```json
{
  "endpoint": "http://localhost:9000/invoke",
  "auth_type": "none",
  "config_json": {
    "headers": {
      "X-Service-Name": "external-agent"
    }
  },
  "timeout_ms": 60000
}
```

同时必须把 host 加入：

```bash
DAP_ALLOWED_EXTERNAL_AGENT_HOSTS=localhost,127.0.0.1,agent-service.internal
```

## 4. 真实工具建议

| 工具 | 建议 Adapter 类型 |
|---|---|
| Dify Workflow | `dify` 或 `generic_http` |
| SuperSonic | `supersonic` 或 `generic_http` |
| DB-GPT | `dbgpt` 或 `generic_http` |
| RAGFlow | `ragflow` 或 `generic_http` |

生产落地时，不建议让外部 Agent 自行绕过平台访问敏感数据。应由 独立数据智能体平台完成用户身份、权限、数据域和 Trace 注入。
