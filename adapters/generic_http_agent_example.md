# Generic HTTP Agent Adapter 示例

平台向外部 Agent 发送：

```json
{
  "message": "用户问题",
  "context": {
    "user": {},
    "datasets": [],
    "knowledge_bases": []
  }
}
```

外部 Agent 应返回统一输出协议：

```json
{
  "answer": "回答正文",
  "answer_type": "metric_analysis",
  "confidence": 0.8,
  "tables": [],
  "charts": [],
  "sql": [],
  "evidence": [],
  "warnings": [],
  "next_actions": []
}
```
