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
2. 关闭或限制 `DAP_DEMO_MODE` / `DAP_ALLOW_DEMO_SEED`，首次启动空 SQLite 库时用临时 `ADMIN_PASSWORD` 初始化管理员账号，创建后移除该 secret。
3. 限制 DAP_CORS_ORIGINS。
4. 配置 HTTPS / WAF / 内网访问控制。
5. 对接企业 SSO / LDAP / IAM。
6. 替换默认演示账号与密码。
7. 接入真实数据源只读账号。
8. 配置真实行列权限、数据分级、脱敏策略。
9. 配置真实外部 Agent endpoint allowlist。
10. 配置 OPS_TOKEN，并限制诊断入口访问范围。
11. 在 HFS / SQLite 阶段配置 `scripts/sqlite_backup.py` 定期快照与保留策略；接入企业数据库后切换到集中备份恢复。
12. 完成 50–100 个真实业务问题评测。
13. 完成安全扫描和权限绕过测试。
```

## 3. 环境变量

| 变量 | 用途 |
|---|---|
| `DAP_APP_ENV` | `dev` / `production` |
| `DAP_SECRET_KEY` | Token 签名密钥，生产必须替换 |
| `OPS_TOKEN` | `/_ops/*` 只读诊断入口 token，HF / production 未设置时会锁定 |
| `DAP_CORS_ORIGINS` | 允许跨域来源 |
| `DAP_DEMO_MODE` / `DAP_ALLOW_DEMO_SEED` | 控制默认演示账号和演示平台 fixture；关闭后需自行预置管理员账号 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | demo seed 关闭时的一次性 SQLite 管理员初始化入口；创建成功后移除 password |
| `DAP_SQL_MAX_ROWS` | SQL 最大返回行数 |
| `DAP_SQL_TIMEOUT_MS` | SQL 查询超时 |
| `DAP_SQLITE_BUSY_TIMEOUT_MS` / `DAP_SQLITE_JOURNAL_MODE` / `DAP_SQLITE_SYNCHRONOUS` | SQLite 单体部署的写锁等待、journal 和同步策略 |
| `DAP_SQLITE_BACKUP_MAX_AGE_HOURS` | 最近成功 SQLite 备份的最大年龄，默认 168 小时；0 表示关闭新鲜度检查 |
| `DAP_SQLITE_MIN_FREE_MB` | SQLite 数据目录最小剩余空间信号，默认 256MB；0 表示关闭阈值检查 |
| `DAP_SQLITE_INIT_LOCK_TIMEOUT_SECONDS` | 启动期 SQLite schema/seed 初始化锁等待时间，默认 30 秒 |
| `DAP_ALLOWED_EXTERNAL_AGENT_HOSTS` | 外部 Agent host allowlist |
| `DAP_CHAT_RATE_LIMIT_PER_MINUTE` | 单用户问数限流 |
| `DAP_AUTH_RATE_LIMIT_PER_MINUTE` | 登录接口限流 |

SQLite 平台库会维护 `platform_metadata`、`platform_operation_runs` 与 `PRAGMA user_version`，`/_ops/persistence` 可用于核对 schema version、迁移时间、journal mode、page size/count、最近 SQLite 运维任务、`sqlite_operation_summary`、`sqlite_references` 和 integrity check。上线或重启后应确认 `schema.expected_platform_schema_version` 与 `schema.platform_user_version` 一致，`sqlite_references.ok=true`，并检查最近备份/维护记录没有 failed 或 stale。
HFS / production 下 `DAP_DB_PATH` 和 `DAP_BUSINESS_DB_PATH` 应保留在 `DAP_DATA_DIR` 或 `DAP_PERSIST_DIR` 内；如果单独指到 repo 内、`/tmp` 或其他未持久化目录，运行配置会给出 warning，因为备份、锁和磁盘余量检查可能覆盖不到真正的 SQLite 文件。
Codex 工程任务的 handoff 正文会同步写入 `codex_artifacts.content`，文件路径只是本地辅助副本；HFS 一体部署阶段做 SQLite 备份即可保留任务交接内容和审计事件。

应用启动会用 `DAP_DATA_DIR/.sqlite-init.lock` 包住 SQLite schema 创建、additive migration 和 seed，避免 HFS / 多 worker 启动时多个进程同时迁移或写入初始化 fixture。该锁使用系统 advisory lock，进程退出会释放；锁文件里仅保留最近一次 holder metadata，不能只凭文件存在判断仍在运行。`/_ops/persistence.sqlite_locks` 会暴露该锁文件路径与最近 holder。

`/api/health/ready` 不是简单存活探针；它会检查 SQLite 数据目录、Codex handoff 目录、平台库 schema/active admin、业务库核心表，并暴露 SQLite 数据目录剩余空间信号。ready 返回 `503` 时，HFS / 反向代理不应接入业务流量。磁盘余量低默认作为 warnings / ops 指标暴露，不直接阻断 ready；生产巡检应在低于 `DAP_SQLITE_MIN_FREE_MB` 时扩容或清理。

HFS 一体部署阶段的 SQLite 备份使用：

```bash
python3 scripts/sqlite_backup.py --output-dir data/backups --retention-count 20
```

该脚本使用 SQLite online backup API，不依赖外部数据库或第三方库，并会写带 `sha256` 摘要的 `manifest.json` 与执行备份文件 integrity check。
备份产物可用 `python3 scripts/sqlite_backup.py --verify-dir data/backups/<backup-folder>` 进行只读复核；验证会核对文件大小、内容摘要和 SQLite integrity，恢复前必须先验证备份。
实际覆盖运行库前，再用 `python3 scripts/sqlite_backup.py --rehearse-restore-dir data/backups/<backup-folder> --rehearsal-output-dir /tmp/dap-restore-rehearsal` 做隔离恢复演练，确认当前后端能按预期 schema 打开备份、存在 active admin，且业务表可读。
备份、验证、恢复演练和维护命令默认共用 `DAP_DATA_DIR/.sqlite-ops.lock` 本地锁，避免 HFS 单体部署中多个 SQLite 运维任务同时执行；默认等待 30 秒，可用 `--lock-timeout-seconds` 调整。
这些命令会把运行摘要写入平台库 `platform_operation_runs`；在没有外部日志和数据库的 HFS 阶段，`/_ops/persistence` 的 `recent_sqlite_operations` 是确认最近备份、验证、恢复演练和维护结果的本地证据。
`/_ops/persistence.sqlite_backup_freshness` 会按 `DAP_SQLITE_BACKUP_MAX_AGE_HOURS` 标记最近成功备份为 fresh / stale / missing，`/_ops/metrics` 暴露 `dap_sqlite_backup_fresh` 和 `dap_sqlite_backup_age_hours`。该检查不直接阻断 ready，但上线巡检和告警应关注 stale / missing。
`/_ops/persistence.sqlite_storage` 会返回 SQLite 数据目录所在文件系统的 total/used/free MB、free percent、检查路径和阈值；`/_ops/metrics` 暴露 `dap_sqlite_storage_ok`、`dap_sqlite_storage_free_mb`、`dap_sqlite_storage_free_percent` 和 `dap_sqlite_storage_min_free_mb`。HFS 单体部署没有外部数据库兜底时，应把该信号接入告警。

SQLite 日常维护使用：

```bash
python3 scripts/sqlite_maintenance.py
```

默认执行 24 小时前 `rate_limit_events` 清理、超过 24 小时仍为 `running` 的 `platform_operation_runs` stale 标记、180 天前已结束运维记录清理、`PRAGMA optimize` 和 passive WAL checkpoint。Trace 与审计保留期需要显式指定，例如先用 `--dry-run --prune-traces-days 30 --prune-audit-days 180` 确认影响范围，再执行同样参数的正式维护。`--copy-to-temp` 会用 SQLite online backup API 生成验证副本；`--checkpoint truncate` / `--vacuum` 需要维护窗口和已验证备份。
`.sqlite-ops.lock` 文件保留最近一次持有者元数据；在 Linux/HFS 和 macOS 上 advisory lock 会随进程退出自动释放，不能仅凭文件存在判断任务仍在运行。异常处理时先确认没有备份或维护进程，再清理残留锁文件。

## 4. 仍需企业侧补齐的能力

- 真实组织架构、角色、数据域授权。
- 和数仓/BI/数据中台权限体系的同步。
- PostgreSQL / MySQL 等生产级元数据库替换。
- 对接 Dify、SuperSonic、DB-GPT、RAGFlow 或自研 Agent 的真实协议。
- 评测集、标准 SQL、标准答案、标准报告。
- 业务规则库、Prompt、知识库和分析模板。
