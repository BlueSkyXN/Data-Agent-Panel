# Hugging Face Space 适配设计

## 1. 目标

HFS v2 将 Data Agent Panel 的 Space 边界改为 Pattern B thin source wrapper：

```text
exported wrapper
  + immutable Python base-image digest
  + public GitHub source checkout at an immutable commit
  + FastAPI Web/API/Agent Gateway
  + /persist/data-agent-platform SQLite state
  + 只读 _ops 运维诊断
```

Space 不是完整产品仓库：wrapper bundle 不包含产品 `apps/`、`database/`、`docs/`、
`scripts/`、`local/`、`data/`、日志、缓存、`.env*` 或密钥文件。

## 2. Wrapper 契约

| 项 | 契约 |
|---|---|
| Space metadata | `cloud/hfs/README.md` 定义 `sdk: docker` 与 `app_port: 7860` |
| 导出 | `scripts/export_hfs_space_bundle.py` 只输出 allowlisted wrapper 文件和 `BUILD_SOURCE.json` |
| 产品来源 | Docker build 仅 checkout 完整、不可变的 `DAP_SOURCE_REF`，并校验 `HEAD` |
| build 来源 | exporter 只接受 `image@sha256:<digest>`，不输出浮动 base image |
| provenance | `BUILD_SOURCE.json` 记录 source repository/ref、wrapper ref、base digest 和生成时间 |
| 端口 | 单一公开端口 `7860` |
| 运行用户 | UID/GID `1000` 的 `user` |
| 数据目录 | 必须是可写 `/persist` mount 下的 `DAP_DATA_DIR`；默认 `/persist/data-agent-platform` |
| 初始化 | 原有 `hf_entrypoint.sh` 在已验证的持久化目录中幂等初始化 SQLite |
| 运维 | 保留 `/_ops/healthz`、`/_ops/health`、`/_ops/system`、`/_ops/config`、`/_ops/persistence`、`/_ops/errors`、`/_ops/metrics` |
| 控制面 | `/_ops/` 只读；`/_admin/` 继续复用平台登录和 RBAC |

## 3. 持久化策略

```text
/persist/data-agent-platform/data_agent_platform.db
/persist/data-agent-platform/business_sample.db
/persist/data-agent-platform/codex_tasks/
```

wrapper 会在 `/persist` 缺失、不可写，或 `DAP_DATA_DIR`、数据库、任务目录、HF cache 路径越出
`DAP_DATA_DIR` 时 fail closed。HFS source lane 不允许 `/data`、`/tmp` 或镜像内数据库作为
成功启动的后备路径。Space mount、backup、verify、isolated restore 与生产切换是独立 owner
门禁，不能由 exporter 或静态检查替代。

## 4. 安全边界

- `DAP_SECRET_KEY`、`DAP_OPS_TOKEN` 与一次性 bootstrap password 只能保留在 Space Secrets。
- wrapper/manifest 仅登记设置键名和关系；不保存真实值。
- `HF_TOKEN`、`GH_TOKEN` 是本机或 CI 控制面凭据，永不传给 Space。
- `/_ops/*` 保持只读，不执行重启、写配置、SQL 写入、任意命令或任意文件读取。
- `/_admin/` 由应用登录和 `admin` 角色保护，不复用 `DAP_OPS_TOKEN` 做管理授权。
- 公共或 Protected Space 仍应设置 `DAP_SECRET_KEY` 和 `DAP_OPS_TOKEN`，并限制 CORS 与外部 Agent host allowlist。

## 5. 导出与发布

导出使用完整 commit 和 base digest；destination 必须为空，工具不会覆盖既有目录。wrapper 输入必须
已提交且与 `--wrapper-ref` 一致，否则 exporter 拒绝生成会误报 provenance 的 bundle。手动触发的
GitHub workflow 会先执行静态检查和 bundle verifier，并在上传前和写后读回时拒绝 allowlist 外的
Space 文件，因此仅能写入空 candidate 或已是 thin wrapper 的 Space。workflow 不使用全仓上传、
`--delete "*"` 或无条件 factory reboot。旧 full-repo Space tree 的清理、Space 选择、Settings
push、restart、数据恢复和生产 cutover 必须经独立 owner 批准并在写后读回。

## 6. 线上验收

```bash
OPS_TOKEN=<DAP_OPS_TOKEN> scripts/hf_space_smoke.sh https://<space-name>.hf.space
```

live smoke 覆盖公开 health/ready、ops、iframe header、登录和基础问数。还需单独验证
`/_ops/persistence`、SQLite backup/verify、隔离 restore、RBAC、Trace、Admin 与 restart 后
持久化，才可完成有状态 Space 的发布验收。
