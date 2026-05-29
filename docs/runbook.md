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

演示版默认使用 SQLite：

```bash
cp data/data_agent_platform.db backup/data_agent_platform_$(date +%F_%H%M%S).db
cp data/business_sample.db backup/business_sample_$(date +%F_%H%M%S).db
```

生产建议迁移到企业标准数据库与备份体系。
