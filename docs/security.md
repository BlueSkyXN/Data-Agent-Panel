# 安全设计

## 身份认证

- Token 使用 HMAC SHA256 签名，包含过期时间。
- 密码使用 PBKDF2-SHA256 哈希存储。
- 登录失败达到阈值后账号临时锁定。

## 授权

- RBAC：用户、角色、权限。
- Agent 权限：控制谁能使用哪个 Agent。
- Dataset 权限：控制谁能读取哪个数据集。
- 字段脱敏：通过 `dataset_fields.is_sensitive` 和 `dataset_permissions.masked_fields` 实现。

## SQL Guard

- 只允许 SELECT。
- 拦截危险关键字、注释、多语句。
- 校验 SQL 访问表必须属于当前 dataset。
- 自动追加 LIMIT。
- 使用 SQLite progress handler 实现超时中断。
- SQL 执行全量记录到 `sql_runs`。

## 外部 Agent

- 支持 endpoint host allowlist。
- 调用记录写入 `tool_calls`。
- Trace 记录输入、输出、状态和耗时。

## 审计

关键事件写入 `audit_logs`：

```text
login / login_failed / chat_query / create_analysis_task
approve_analysis_plan / create_feedback / create_eval_run
create_dataset / create_data_source / approve_report / publish_report
```
