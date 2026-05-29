# 威胁模型简版

| 风险 | 当前控制 | 仍需补齐 |
|---|---|---|
| 未授权访问 | Bearer Token、RBAC、Agent 权限 | SSO、MFA、企业 IAM |
| 数据越权 | 数据集权限、字段脱敏、SQL 表范围校验 | 数仓原生行列权限继承 |
| SQL 注入/危险 SQL | SELECT-only、危险关键字、多语句、注释拦截 | 更严格 SQL AST 解析 |
| 敏感字段泄漏 | dataset_fields.is_sensitive、dataset_permissions.masked_fields | 数据分级分类、动态脱敏 |
| 外部 Agent 越权 | Endpoint allowlist、tool_call 记录 | mTLS、专线/VPC、服务账号 |
| 幻觉报告 | Trace、证据链、人工审批 | 标准评测集、业务复核制度 |
| 操作不可追溯 | audit_logs、request_id、trace_id | 集中审计平台、日志防篡改 |
| 凭证泄漏 | 配置脱敏查看、env 管理 | Vault/KMS/密钥轮换 |
