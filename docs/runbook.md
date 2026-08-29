# 运行手册

## 启动检查

```bash
python scripts/reset_db.py
python scripts/smoke_test.py
python scripts/security_smoke_test.py
```

## 健康检查

```bash
curl http://localhost:8000/api/health/live
curl http://localhost:8000/api/health/ready
```

`/api/health/live` 只证明进程可响应；`/api/health/ready` 会检查 SQLite 数据目录、Codex handoff 目录、平台库 schema/admin 状态、业务库核心表和 SQLite 数据目录剩余空间信号。ready 返回 `503` 时，不应接入流量，先查看响应里的 `checks` 字段和 `/_ops/persistence`。

## HFS Ops / Admin 控制面

`/_ops/` 是 HFS 只读诊断面。设置 `OPS_TOKEN` 后，用 `X-Ops-Token` 访问：

```bash
curl -H "X-Ops-Token: $OPS_TOKEN" http://localhost:8000/_ops/healthz
curl -H "X-Ops-Token: $OPS_TOKEN" http://localhost:8000/_ops/persistence
curl -H "X-Ops-Token: $OPS_TOKEN" http://localhost:8000/_ops/errors
curl -H "X-Ops-Token: $OPS_TOKEN" http://localhost:8000/_ops/metrics
```

`/_ops/persistence` 会返回平台库 `PRAGMA user_version`、`platform_metadata.schema_version`、`last_migrated_at`、SQLite journal/page 信息、表计数、最近 SQLite 运维任务、备份新鲜度、数据目录剩余空间、`sqlite_references` 和 integrity check，用来确认 HFS 单体运行时是否加载到预期 schema 与持久化目录。`sqlite_references.ok=false` 表示平台元数据和业务 SQLite 表或字段引用不一致，`/api/health/ready` 会返回 `503`。
Codex handoff 文件丢失时，先查 `codex_artifacts` 表；任务交接正文会保存在 `content` 字段，文件只是运行时辅助副本。

启动期 schema / seed 会通过 `DAP_DATA_DIR/.sqlite-init.lock` 串行化，避免多个进程同时初始化 SQLite。锁文件只保存最近一次 holder metadata，进程退出会释放系统锁；如果启动卡在初始化锁，先确认是否还有旧进程正在启动或迁移，再处理残留文件。

`/_admin/` 复用平台登录态和 RBAC，只做管理驾驶舱入口；用户、角色、配置、统计和审计仍由 `/api/admin/*` 的 `require_admin` 保护。

## 常见问题

### 登录失败

1. 检查账号状态：`/api/admin/users`。
2. 检查是否触发登录失败锁定。
3. 使用管理员重置密码哈希，或重新运行 `scripts/reset_db.py` 重建演示库。

### SQL 被拦截

查看 Trace 中的 `sql_guard` step，重点检查：

```text
是否 SELECT 开头
是否包含危险关键字
是否引用了 dataset 之外的表
是否超过超时或行数限制
```

### 外部 Agent 调用失败

1. 检查 Adapter endpoint。
2. 检查 `DAP_ALLOWED_EXTERNAL_AGENT_HOSTS`。
3. 检查 tool_calls 表和 Trace。
4. 检查外部 Agent 的返回是否符合统一输出协议。

## 备份

默认使用 SQLite。运行中不要直接 `cp` WAL 模式数据库，使用标准库 backup API 生成一致性快照：

```bash
python3 scripts/sqlite_backup.py --output-dir data/backups --retention-count 20
```

脚本会备份平台库和业务库，写入包含 `sha256` 摘要的 `manifest.json`，并对备份文件执行 `PRAGMA integrity_check`。备份后或恢复前可做只读验证，验证会同时核对文件大小、内容摘要和 SQLite integrity：

```bash
python3 scripts/sqlite_backup.py --verify-dir data/backups/<backup-folder>
```

备份、验证和恢复演练默认会获取 `DAP_DATA_DIR/.sqlite-ops.lock` 本地锁，避免与 SQLite 维护任务重叠；默认等待 30 秒，可用 `--lock-timeout-seconds` 调整。
命令执行结果会写入平台库 `platform_operation_runs`，可通过 `/_ops/persistence` 的 `recent_sqlite_operations` 回看最近备份、验证或恢复演练是否成功。
`DAP_SQLITE_BACKUP_MAX_AGE_HOURS` 默认 168；`/_ops/persistence.sqlite_backup_freshness` 和 `/_ops/metrics` 会显示最近成功备份是否缺失或过期。该信号不阻断 `/api/health/ready`，但生产值班应把 missing / stale 视为需要处理的恢复能力风险。
`DAP_SQLITE_MIN_FREE_MB` 默认 256；`/_ops/persistence.sqlite_storage` 和 `/_ops/metrics` 会显示 SQLite 数据目录所在文件系统的剩余空间。该信号默认不阻断 `/api/health/ready`，但低于阈值时应尽快清理、扩容或迁移持久化目录。

实际恢复前先做一次隔离恢复演练，确认备份能被当前后端 schema 只读加载，并且平台管理员和业务表仍可用：

```bash
python3 scripts/sqlite_backup.py --rehearse-restore-dir data/backups/<backup-folder> --rehearsal-output-dir /tmp/dap-restore-rehearsal
```

恢复时先停止应用，再从对应备份目录复制 `data_agent_platform.db` 和 `business_sample.db` 到当前 `DAP_DATA_DIR` / `DAP_DB_PATH` / `DAP_BUSINESS_DB_PATH` 指向的位置。

如果企业侧后续接入集中数据库，备份恢复策略应切换到企业标准机制；HFS 一体部署阶段优先保留 SQLite 快照。

## SQLite 维护

HFS 一体部署阶段可定期运行轻量维护，检查 integrity、执行 `PRAGMA optimize` 和 passive WAL checkpoint：

```bash
python3 scripts/sqlite_maintenance.py
```

默认维护会清理 24 小时前的 `rate_limit_events`、标记超过 24 小时仍为 `running` 的 `platform_operation_runs` 为 `stale`，并清理 180 天前已结束的运维记录，避免短生命周期限流表和本地运维历史长期膨胀。Trace 和审计日志默认不会删除；如需按保留期清理，先备份并验证，再用 dry-run 查看会影响的行数：

```bash
python3 scripts/sqlite_maintenance.py --dry-run --prune-traces-days 30 --prune-audit-days 180
python3 scripts/sqlite_maintenance.py --prune-traces-days 30 --prune-audit-days 180
```

如需先验证命令面而不改动当前库：

```bash
python3 scripts/sqlite_maintenance.py --dry-run
python3 scripts/sqlite_maintenance.py --copy-to-temp --json
```

`--copy-to-temp` 使用 SQLite online backup API 生成临时副本，不直接复制 WAL 模式数据库文件。

`--checkpoint truncate` 和 `--vacuum` 只应在低流量维护窗口显式使用，且应先完成 `scripts/sqlite_backup.py` 备份与 `--verify-dir` 验证。

维护命令同样使用 `DAP_DATA_DIR/.sqlite-ops.lock`。锁文件本身会保留最近一次持有者元数据；在 Linux/HFS 和 macOS 上锁会随进程退出自动释放，所以看到文件存在不等于锁仍被持有。只有确认没有备份或维护进程仍在运行时，才应手动清理异常残留文件。
维护结果同样会写入 `platform_operation_runs`，便于没有外部日志系统的 HFS 单体部署做最小可追溯性检查。`/_ops/persistence` 会汇总 `sqlite_operation_summary`，`/_ops/metrics` 也会暴露 stale / failed 运维记录数量。
