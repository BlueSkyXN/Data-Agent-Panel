# 完成情况检查与修复记录

版本：`0.4.1-audit-fix`

## 1. 检查范围

本轮检查覆盖：

- 后端 FastAPI 路由与服务模块
- Agent Gateway 与内置 Agent 调用链
- SQL Guard
- 数据画像、数据质量、面板物化、CSV 导入
- 语义中心
- 会话、反馈、Trace、审计
- Codex 工作台与 mock/http/cli/sdk 派发框架
- 前端静态 JS 语法
- 初始化与 smoke/security/full-agent/codex-runtime 测试

## 2. 发现并修复的问题

| 编号 | 问题 | 影响 | 修复 |
|---|---|---|---|
| F-01 | CSV 导入未严格处理表头标识符 | 恶意表头可能导致 500；存在 SQL 语句拼接风险 | 新增安全标识符生成、SQL 关键字/注释/分号检测、重复列去重、文件大小/行数/列数限制 |
| F-02 | SQL Guard 只校验目标表是否出现 | `dataset_orders` 查询可夹带 join/union 到其他表 | 改为只允许访问所选数据集的物理表；出现其他表即拒绝 |
| F-03 | 调用方自带大 LIMIT 可绕过平台最大行数策略 | 可能返回过多数据 | 统一使用外层查询包裹，最终强制 LIMIT 平台上限或请求上限 |
| F-04 | 数据画像和面板 API 使用临时 trace_id | 产生不可回放的孤立 SQL/Trace 记录 | API 层创建真实 Trace，结果返回 trace_id，并在完成/失败时关闭 Trace |
| F-05 | `/api/admin/stats` 未强制管理员权限 | 普通用户可查看管理统计和运行配置摘要 | 改为 `require_admin` |
| F-06 | 会话 ID 未做归属校验 | 用户可向他人会话写入消息 | 复用 session_id 时校验 owner 与 agent 绑定 |
| F-07 | 反馈接口未做会话/Trace 归属校验 | 用户可对他人结果写反馈 | 校验 session 和 trace 的 user_id，管理员除外 |
| F-08 | 语义覆盖 / 查询模板未按数据集权限过滤 | 普通用户可能看到未授权数据集的语义资产 | 按 `can_read_dataset` 过滤 |
| F-09 | Agent 权限 seed 非幂等 | 重启多次可能重复插入权限记录 | 改为插入前按 agent/role/permission 查询 |

## 3. 新增回归测试

新增：

```bash
python scripts/hardening_regression_test.py
```

覆盖内容：

- 普通用户无法访问 `/api/admin/stats`
- SQL Guard 拦截跨数据集 join
- SQL Guard 强制最终行数上限
- 数据画像 / 面板 API 返回可查询 Trace
- 会话 IDOR 拦截
- 反馈归属校验
- 恶意 CSV 表头导入不 500、不执行注入、不破坏原表
- seed 幂等性

## 4. 验证命令

已通过以下命令：

```bash
python scripts/reset_db.py
python -m compileall -q apps scripts
python scripts/smoke_test.py
python scripts/security_smoke_test.py
python scripts/full_agent_smoke_test.py
python scripts/codex_runtime_smoke_test.py
python scripts/hardening_regression_test.py
node --check apps/web/static/app.js
```

## 5. 尚未覆盖的生产事项

这些仍需企业环境补齐：

- 企业 SSO / IAM
- 真实生产数仓与行列权限继承
- PostgreSQL/MySQL 元数据库迁移
- 真实 Dify / SuperSonic / DB-GPT / RAGFlow / Codex 接入
- 真实 Prompt、知识库、评测集
- HTTPS、集中日志、监控告警、备份恢复、安全扫描
