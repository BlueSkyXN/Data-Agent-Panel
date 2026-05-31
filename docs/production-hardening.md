# 生产化加固说明

## 1. 已内置能力

| 类别 | 已实现 |
|---|---|
| 身份认证 | HMAC 签名 Token、过期时间、PBKDF2 密码哈希、登录失败锁定 |
| 授权 | RBAC、Agent 使用权限、数据集读取权限、字段脱敏策略 |
| SQL 安全 | SELECT-only、危险关键字拦截、注释拦截、多语句拦截、表范围校验、超时、最大行数、敏感字段脱敏 |
| Trace | Trace、Trace Step、SQL Runs、Tool Calls、Chart Specs |
| 审计 | 登录、Agent 调用、反馈、评测、报告审批、后台操作 |
| 运行安全 | 请求 ID、统一错误、访问日志、安全响应头、Docker healthcheck、非 root 用户 |
| 外部 Agent 调用 | Endpoint allowlist、tool_call 记录、超时、统一输出协议 |
| 风险控制 | 高风险分析任务人工审批流 |

## 2. 生产前必须完成

```text
1. 设置强 DAP_SECRET_KEY。
2. 关闭或限制 `DAP_DEMO_MODE` / `DAP_ALLOW_DEMO_SEED`，并在关闭前准备管理员账号初始化路径。
3. 限制 DAP_CORS_ORIGINS。
4. 配置 HTTPS / WAF / 内网访问控制。
5. 对接企业 SSO / LDAP / IAM。
6. 替换默认演示账号与密码。
7. 接入真实数据源只读账号。
8. 配置真实行列权限、数据分级、脱敏策略。
9. 配置真实外部 Agent endpoint allowlist。
10. 配置 DAP_OPS_TOKEN，并限制诊断入口访问范围。
11. 接入集中日志、监控、告警、备份恢复。
12. 完成 50–100 个真实业务问题评测。
13. 完成安全扫描和权限绕过测试。
```

## 3. 环境变量

| 变量 | 用途 |
|---|---|
| `DAP_APP_ENV` | `dev` / `production` |
| `DAP_SECRET_KEY` | Token 签名密钥，生产必须替换 |
| `DAP_OPS_TOKEN` | `/_ops/*` 只读诊断入口 token，HF / production 未设置时会锁定 |
| `DAP_CORS_ORIGINS` | 允许跨域来源 |
| `DAP_DEMO_MODE` / `DAP_ALLOW_DEMO_SEED` | 控制默认演示账号和演示平台 fixture；关闭后需自行预置管理员账号 |
| `DAP_SQL_MAX_ROWS` | SQL 最大返回行数 |
| `DAP_SQL_TIMEOUT_MS` | SQL 查询超时 |
| `DAP_ALLOWED_EXTERNAL_AGENT_HOSTS` | 外部 Agent host allowlist |
| `DAP_CHAT_RATE_LIMIT_PER_MINUTE` | 单用户问数限流 |
| `DAP_AUTH_RATE_LIMIT_PER_MINUTE` | 登录接口限流 |

## 4. 仍需企业侧补齐的能力

- 真实组织架构、角色、数据域授权。
- 和数仓/BI/数据中台权限体系的同步。
- PostgreSQL / MySQL 等生产级元数据库替换。
- 对接 Dify、SuperSonic、DB-GPT、RAGFlow 或自研 Agent 的真实协议。
- 评测集、标准 SQL、标准答案、标准报告。
- 业务规则库、Prompt、知识库和分析模板。
