from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

from .auth_utils import hash_secret
from .config import ROOT, get_settings

settings = get_settings()
DATA_DIR = settings.data_dir
DB_PATH = settings.db_path
BUSINESS_DB_PATH = settings.business_db_path
SCHEMA_PATH = ROOT / "database" / "schema.sql"


def now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def ensure_data_dir() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    BUSINESS_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    settings.codex_task_dir.mkdir(parents=True, exist_ok=True)


@contextmanager
def connect(path: Path | str = DB_PATH):
    ensure_data_dir()
    con = sqlite3.connect(str(path), check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def dict_rows(cur: sqlite3.Cursor) -> list[dict[str, Any]]:
    return [dict(row) for row in cur.fetchall()]


def one(sql: str, params: Iterable[Any] = ()) -> dict[str, Any] | None:
    with connect() as con:
        row = con.execute(sql, tuple(params)).fetchone()
        return dict(row) if row else None


def many(sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
    with connect() as con:
        return dict_rows(con.execute(sql, tuple(params)))


def execute(sql: str, params: Iterable[Any] = ()) -> None:
    with connect() as con:
        con.execute(sql, tuple(params))


def _json_value(v: Any) -> Any:
    return json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v


def insert(table: str, payload: dict[str, Any]) -> dict[str, Any]:
    keys = list(payload.keys())
    placeholders = ",".join(["?"] * len(keys))
    sql = f"INSERT INTO {table} ({','.join(keys)}) VALUES ({placeholders})"
    values = [_json_value(v) for v in payload.values()]
    execute(sql, values)
    return payload


def insert_ignore(table: str, payload: dict[str, Any]) -> dict[str, Any]:
    keys = list(payload.keys())
    placeholders = ",".join(["?"] * len(keys))
    sql = f"INSERT OR IGNORE INTO {table} ({','.join(keys)}) VALUES ({placeholders})"
    values = [_json_value(v) for v in payload.values()]
    with connect() as con:
        con.execute(sql, values)
    return payload


def update(table: str, key: str, value: str, payload: dict[str, Any]) -> None:
    if not payload:
        return
    pairs = ",".join([f"{k}=?" for k in payload.keys()])
    values = [_json_value(v) for v in payload.values()]
    values.append(value)
    execute(f"UPDATE {table} SET {pairs} WHERE {key}=?", values)


def _columns(con: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in con.execute(f"PRAGMA table_info({table})").fetchall()}


def migrate_platform_schema() -> None:
    """Small additive migrations for users who run a newer package over an older demo DB."""
    with connect(DB_PATH) as con:
        existing = {r["name"] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        additions: dict[str, dict[str, str]] = {
            "users": {
                "password_hash": "TEXT DEFAULT ''",
                "failed_login_count": "INTEGER NOT NULL DEFAULT 0",
                "locked_until": "TEXT",
                "last_login_at": "TEXT",
            },
            "agents": {
                "risk_level": "TEXT NOT NULL DEFAULT 'medium'",
                "require_human_approval": "INTEGER NOT NULL DEFAULT 0",
            },
            "datasets": {"data_classification": "TEXT NOT NULL DEFAULT 'internal'"},
            "traces": {"request_id": "TEXT"},
            "audit_logs": {"request_id": "TEXT"},
            "codex_tasks": {
                "dispatch_attempts": "INTEGER NOT NULL DEFAULT 0",
                "last_dispatch_at": "TEXT",
                "execution_log_path": "TEXT",
                "sdk_thread_id": "TEXT",
            },
        }
        for table, cols in additions.items():
            if table in existing:
                current = _columns(con, table)
                for col, ddl in cols.items():
                    if col not in current:
                        con.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")


def init_platform_db(reset: bool = False) -> None:
    ensure_data_dir()
    if reset and DB_PATH.exists():
        DB_PATH.unlink()
    with connect(DB_PATH) as con:
        con.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    migrate_platform_schema()
    seed_platform()


def init_business_db(reset: bool = False) -> None:
    ensure_data_dir()
    if reset and BUSINESS_DB_PATH.exists():
        BUSINESS_DB_PATH.unlink()
    with connect(BUSINESS_DB_PATH) as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS sales_orders (
              id TEXT PRIMARY KEY,
              order_date TEXT,
              region TEXT,
              channel TEXT,
              customer_segment TEXT,
              category TEXT,
              product TEXT,
              order_status TEXT,
              revenue REAL,
              quantity INTEGER,
              gross_margin REAL,
              account_owner TEXT,
              notes TEXT
            );
            CREATE TABLE IF NOT EXISTS support_tickets (
              id TEXT PRIMARY KEY,
              ticket_date TEXT,
              region TEXT,
              customer_segment TEXT,
              category TEXT,
              issue_type TEXT,
              root_cause TEXT,
              severity TEXT,
              status TEXT,
              account_owner TEXT,
              summary TEXT
            );
            CREATE TABLE IF NOT EXISTS marketing_campaigns (
              id TEXT PRIMARY KEY,
              campaign_date TEXT,
              channel TEXT,
              campaign_name TEXT,
              campaign_type TEXT,
              spend REAL,
              impressions INTEGER,
              clicks INTEGER,
              conversions INTEGER,
              revenue REAL
            );
            CREATE TABLE IF NOT EXISTS product_catalog (
              id TEXT PRIMARY KEY,
              category TEXT,
              product TEXT,
              price REAL,
              cost REAL,
              supplier TEXT,
              active INTEGER
            );
            CREATE TABLE IF NOT EXISTS business_metrics_daily (
              id TEXT PRIMARY KEY,
              metric_date TEXT,
              region TEXT,
              channel TEXT,
              revenue REAL,
              order_count INTEGER,
              gross_margin REAL,
              open_ticket_count INTEGER,
              conversion_rate REAL,
              risk_score REAL
            );
            """
        )
        if con.execute("SELECT COUNT(*) c FROM sales_orders").fetchone()["c"] == 0:
            seed_business_data(con)


def seed_business_data(con: sqlite3.Connection) -> None:
    base_date = datetime(2026, 5, 28)
    regions = ["华东", "华北", "华南", "西南", "海外"]
    channels = ["官网", "电商", "代理商", "门店", "企业直销"]
    segments = ["企业客户", "中小客户", "个人客户", "高价值客户"]
    categories = ["硬件", "软件订阅", "服务", "解决方案"]
    products = {
        "硬件": ["EdgeBox", "SmartHub", "NetPro"],
        "软件订阅": ["Insight Pro", "Automation Suite", "Secure Cloud"],
        "服务": ["实施服务", "运维服务", "培训服务"],
        "解决方案": ["零售数智方案", "制造数智方案", "客户运营方案"],
    }
    owners = [f"客户经理{idx}" for idx in range(1, 11)]

    product_rows = []
    idx = 1
    for cat, plist in products.items():
        for p in plist:
            price = 800 + idx * 220
            cost = round(price * (0.45 + (idx % 4) * 0.04), 2)
            product_rows.append((f"prod_{idx:03d}", cat, p, price, cost, f"供应商{(idx % 4) + 1}", 1))
            idx += 1
    con.executemany("INSERT INTO product_catalog (id,category,product,price,cost,supplier,active) VALUES (?,?,?,?,?,?,?)", product_rows)

    order_rows = []
    for i in range(1, 241):
        dt = base_date - timedelta(days=i % 90)
        region = regions[i % len(regions)]
        channel = channels[i % len(channels)]
        segment = segments[i % len(segments)]
        cat = categories[i % len(categories)]
        product = products[cat][i % len(products[cat])]
        status = "refunded" if i % 37 == 0 else ("pending" if i % 19 == 0 else "paid")
        quantity = (i % 5) + 1
        unit_price = 900 + (i % 17) * 120
        revenue = unit_price * quantity * (0.9 if channel == "代理商" else 1.0)
        if status == "refunded":
            revenue = -round(revenue * 0.65, 2)
        margin_rate = 0.28 + (i % 7) * 0.025
        gross_margin = round(revenue * margin_rate, 2)
        order_rows.append((
            f"ord_{i:03d}", dt.strftime("%Y-%m-%d"), region, channel, segment, cat, product, status,
            round(revenue, 2), quantity, gross_margin, owners[i % len(owners)],
            f"样例订单 {i}：{segment} 通过{channel}购买{product}。",
        ))
    con.executemany(
        """
        INSERT INTO sales_orders
        (id,order_date,region,channel,customer_segment,category,product,order_status,revenue,quantity,gross_margin,account_owner,notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        order_rows,
    )

    issue_types = ["交付延期", "产品问题", "价格争议", "售后响应", "合同流程", "功能咨询"]
    causes = ["需求变更", "供应不足", "配置不一致", "沟通滞后", "系统数据不一致", "资料缺失"]
    ticket_rows = []
    for i in range(1, 121):
        dt = base_date - timedelta(days=i % 75)
        status = "open" if i % 4 in {1, 2} else "closed"
        severity = "高" if i % 9 == 0 else ("中" if i % 4 == 0 else "低")
        ticket_rows.append((
            f"tic_{i:03d}", dt.strftime("%Y-%m-%d"), regions[i % len(regions)], segments[i % len(segments)], categories[i % len(categories)],
            issue_types[i % len(issue_types)], causes[i % len(causes)], severity, status, owners[i % len(owners)],
            f"客户工单样例 {i}：{causes[i % len(causes)]} 导致 {issue_types[i % len(issue_types)]}。",
        ))
    con.executemany(
        """
        INSERT INTO support_tickets
        (id,ticket_date,region,customer_segment,category,issue_type,root_cause,severity,status,account_owner,summary)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """,
        ticket_rows,
    )

    campaign_rows = []
    for i in range(1, 61):
        dt = base_date - timedelta(days=i % 90)
        channel = channels[i % len(channels)]
        spend = 2000 + (i % 12) * 620
        impressions = 12000 + i * 180
        clicks = int(impressions * (0.025 + (i % 5) * 0.004))
        conversions = int(clicks * (0.08 + (i % 4) * 0.01))
        revenue = conversions * (320 + (i % 6) * 50)
        campaign_rows.append((
            f"cmp_{i:03d}", dt.strftime("%Y-%m-%d"), channel, f"增长活动-{(i % 10) + 1}",
            "拉新" if i % 3 else "促活", round(spend, 2), impressions, clicks, conversions, round(revenue, 2),
        ))
    con.executemany(
        """
        INSERT INTO marketing_campaigns
        (id,campaign_date,channel,campaign_name,campaign_type,spend,impressions,clicks,conversions,revenue)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        """,
        campaign_rows,
    )

    metric_rows = []
    for i in range(90):
        dt = base_date - timedelta(days=i)
        for r_idx, region in enumerate(regions[:4]):
            channel = channels[(i + r_idx) % len(channels)]
            revenue = 42000 + (90 - i) * 580 + r_idx * 3800 + (i % 7) * 950
            order_count = 55 + (i % 14) + r_idx * 7
            gross_margin = round(revenue * (0.31 + r_idx * 0.015), 2)
            open_ticket_count = 8 + (i + r_idx) % 13
            conversion_rate = round(0.045 + ((i + r_idx) % 9) * 0.003, 4)
            risk_score = min(100, max(0, 35 + open_ticket_count * 2.5 - conversion_rate * 150 + (8 if revenue < 50000 else 0)))
            metric_rows.append((
                f"bd_{i:03d}_{r_idx}", dt.strftime("%Y-%m-%d"), region, channel, round(revenue, 2), order_count,
                gross_margin, open_ticket_count, conversion_rate, round(risk_score, 2),
            ))
    con.executemany(
        """
        INSERT INTO business_metrics_daily
        (id,metric_date,region,channel,revenue,order_count,gross_margin,open_ticket_count,conversion_rate,risk_score)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        """,
        metric_rows,
    )


def _upsert_by_id(table: str, id_value: str, payload: dict[str, Any]) -> None:
    existing = one(f"SELECT id FROM {table} WHERE id=?", [id_value])
    if existing:
        data = dict(payload)
        data.pop("id", None)
        update(table, "id", id_value, data)
    else:
        insert(table, payload)


def seed_platform() -> None:
    t = now()
    _upsert_by_id("users", "u_admin", {"id": "u_admin", "username": "admin", "password": "", "password_hash": hash_secret("admin123"), "name": "平台管理员", "email": "admin@example.com", "department": "Data Agent", "status": "active", "failed_login_count": 0, "locked_until": None, "last_login_at": None, "created_at": t})
    _upsert_by_id("users", "u_user", {"id": "u_user", "username": "user", "password": "", "password_hash": hash_secret("user123"), "name": "业务用户", "email": "user@example.com", "department": "业务分析", "status": "active", "failed_login_count": 0, "locked_until": None, "last_login_at": None, "created_at": t})
    for rid, name, desc in [("r_admin", "admin", "平台管理员"), ("r_business", "business_user", "业务分析用户")]:
        _upsert_by_id("roles", rid, {"id": rid, "name": name, "description": desc})
    for uid, rid in [("u_admin", "r_admin"), ("u_user", "r_business")]:
        insert_ignore("user_roles", {"user_id": uid, "role_id": rid})

    permissions = [
        ("perm_agent_use", "agent:use", "使用已授权 Agent"),
        ("perm_agent_admin", "agent:admin", "管理 Agent"),
        ("perm_data_read", "data:read", "读取已授权数据"),
        ("perm_data_admin", "data:admin", "管理数据源、数据集和指标"),
        ("perm_dataset_manage", "dataset:manage", "创建和导入数据集"),
        ("perm_panel_manage", "panel:manage", "管理分析面板"),
        ("perm_report_admin", "report:admin", "管理报告"),
        ("perm_eval_admin", "eval:admin", "管理评测"),
        ("perm_codex_admin", "codex:admin", "管理 Codex 工程任务"),
        ("perm_audit_read", "audit:read", "查看审计日志"),
    ]
    for pid, code, desc in permissions:
        _upsert_by_id("permissions", pid, {"id": pid, "code": code, "description": desc})
    for pid, _, _ in permissions:
        insert_ignore("role_permissions", {"role_id": "r_admin", "permission_id": pid})
    for pid in ["perm_agent_use", "perm_data_read"]:
        insert_ignore("role_permissions", {"role_id": "r_business", "permission_id": pid})

    _upsert_by_id("project_spaces", "space_demo", {"id": "space_demo", "name": "独立数据智能体演示空间", "owner_id": "u_admin", "description": "面向销售、客户服务、营销和经营分析的独立演示空间", "status": "active", "created_at": t})
    for uid, role in [("u_admin", "owner"), ("u_user", "member")]:
        insert_ignore("space_members", {"space_id": "space_demo", "user_id": uid, "role": role})

    adapters = [
        ("ad_mock_router", "内置总控路由 Adapter", "mock_router"),
        ("ad_mock_chatbi", "内置销售问数 Adapter", "mock_chatbi"),
        ("ad_mock_ticket", "内置客户工单归因 Adapter", "mock_ticket"),
        ("ad_mock_analysis", "内置深度研究 Adapter", "mock_analysis"),
        ("ad_mock_knowledge", "内置知识问答 Adapter", "mock_knowledge"),
        ("ad_mock_report", "内置经营报告 Adapter", "mock_report"),
        ("ad_mock_anomaly", "内置风险异常 Adapter", "mock_anomaly"),
        ("ad_mock_profile", "内置数据画像 Adapter", "mock_data_profile"),
        ("ad_mock_quality", "内置数据质量 Adapter", "mock_data_quality"),
        ("ad_mock_semantic", "内置语义治理 Adapter", "mock_semantic"),
        ("ad_mock_panel", "内置分析面板 Adapter", "mock_panel"),
        ("ad_codex", "Codex 工程任务 Adapter", "codex"),
        ("ad_generic_http", "通用 HTTP Agent Adapter", "generic_http"),
        ("ad_dify", "Dify Adapter 占位", "dify"),
        ("ad_supersonic", "SuperSonic Adapter 占位", "supersonic"),
        ("ad_dbgpt", "DB-GPT Adapter 占位", "dbgpt"),
        ("ad_ragflow", "RAGFlow Adapter 占位", "ragflow"),
    ]
    for aid, name, typ in adapters:
        _upsert_by_id("tool_adapters", aid, {"id": aid, "name": name, "type": typ, "endpoint": "", "auth_type": "none", "config_json": {}, "timeout_ms": 60000, "enabled": 1, "created_at": t})

    agents = [
        ("agent_router", "数据智能体总控 Agent", "data_agent_router", "router", "识别意图并路由到问数、工单归因、异常、知识、面板、数据能力或 Codex 嵌套任务。", "ad_mock_router", "medium", 0, {"allow_codex": True}),
        ("agent_sales_metric", "销售经营问数 Agent", "sales_metric_agent", "chatbi", "面向订单、收入、渠道、区域和商品的自然语言查数、TopN、趋势和归因。", "ad_mock_chatbi", "medium", 0, {"dataset_id": "dataset_orders"}),
        ("agent_ticket_analysis", "客户工单归因 Agent", "ticket_analysis_agent", "analysis", "面向客户工单、根因、严重度和闭环状态的归因分析。", "ad_mock_ticket", "high", 1, {"dataset_id": "dataset_tickets"}),
        ("agent_business_analysis", "经营深度研究 Agent", "business_analysis_agent", "analysis", "面向经营复盘、收入波动、渠道 ROI 和服务风险的多步骤研究报告。", "ad_mock_analysis", "high", 1, {"tools": ["sql", "profile", "quality", "knowledge"]}),
        ("agent_business_knowledge", "企业知识问答 Agent", "business_knowledge_agent", "knowledge", "面向指标口径、业务术语、分析模板和制度文档问答。", "ad_mock_knowledge", "low", 0, {"knowledge_base_id": "kb_business_rules"}),
        ("agent_executive_report", "经营报告 Agent", "executive_report_agent", "report", "生成经营周报/月报草稿、证据清单和复核清单。", "ad_mock_report", "high", 1, {"report_type": "executive_business_report"}),
        ("agent_anomaly", "经营风险与异常识别 Agent", "business_anomaly_agent", "risk", "融合收入、工单、转化率和营销数据识别异常与风险排序。", "ad_mock_anomaly", "high", 1, {"datasets": ["dataset_orders", "dataset_tickets", "dataset_business_daily"]}),
        ("agent_data_profile", "数据画像 Agent", "data_profile_agent", "data", "输出数据集字段画像、样本、缺失率、基数和敏感字段提示。", "ad_mock_profile", "low", 0, {}),
        ("agent_data_quality", "数据质量 Agent", "data_quality_agent", "data", "运行内置数据质量规则，输出失败样本、风险等级和修复建议。", "ad_mock_quality", "medium", 0, {}),
        ("agent_semantic", "指标语义治理 Agent", "semantic_governance_agent", "semantic", "分析指标、术语、同义词和查询模板覆盖度。", "ad_mock_semantic", "medium", 0, {}),
        ("agent_panel", "分析面板生成 Agent", "dashboard_panel_agent", "panel", "读取并物化经营总览面板，返回组件数据和图表。", "ad_mock_panel", "medium", 0, {}),
        ("agent_codex", "Codex 工程嵌套 Agent", "codex_engineering_agent", "codex", "把平台开发需求转为 Codex 工程任务，支持审批、handoff、CLI/SDK/HTTP 派发。", "ad_codex", "high", 1, {}),
    ]
    for agid, name, code, typ, desc, adapter_id, risk, approval, cfg in agents:
        version_id = f"ver_{agid}_100"
        _upsert_by_id("agents", agid, {"id": agid, "name": name, "code": code, "type": typ, "description": desc, "owner_id": "u_admin", "status": "published", "default_version_id": version_id, "risk_level": risk, "require_human_approval": approval, "created_at": t, "updated_at": t})
        _upsert_by_id("agent_versions", version_id, {"id": version_id, "agent_id": agid, "version": "1.0.0", "backend_type": "builtin", "adapter_id": adapter_id, "config_json": cfg, "input_schema": {}, "output_schema": {"answer": "string", "tables": "array", "charts": "array", "trace_id": "string"}, "status": "published", "created_at": t})
        for role_id in ["r_admin", "r_business"]:
            if not many("SELECT id FROM agent_permissions WHERE agent_id=? AND subject_type='role' AND subject_id=? AND permission='use'", [agid, role_id]):
                insert("agent_permissions", {"id": new_id("aperm"), "agent_id": agid, "subject_type": "role", "subject_id": role_id, "permission": "use"})

    _upsert_by_id("data_sources", "ds_business_sqlite", {"id": "ds_business_sqlite", "name": "独立演示 SQLite 数据源", "type": "sqlite", "connection_config": {"path": str(BUSINESS_DB_PATH)}, "owner_id": "u_admin", "status": "active", "created_at": t})
    datasets = [
        ("dataset_orders", "销售订单", "Sales", "sales_orders", "订单、收入、区域、渠道、商品和客户分层样例表", "confidential"),
        ("dataset_tickets", "客户工单", "Service", "support_tickets", "客户服务工单、问题类型、根因和闭环状态样例表", "confidential"),
        ("dataset_campaigns", "营销活动", "Marketing", "marketing_campaigns", "营销活动投入、曝光、点击、转化和收入样例表", "internal"),
        ("dataset_products", "商品目录", "Product", "product_catalog", "商品、价格、成本和供应商样例表", "internal"),
        ("dataset_business_daily", "经营日度指标", "Business", "business_metrics_daily", "按日沉淀的收入、订单、工单、转化率和风险分宽表", "internal"),
    ]
    for dsid, name, domain, table, desc, classification in datasets:
        _upsert_by_id("datasets", dsid, {"id": dsid, "name": name, "business_domain": domain, "source_id": "ds_business_sqlite", "physical_table": table, "description": desc, "refresh_mode": "daily", "data_classification": classification, "status": "active"})

    field_defs: dict[str, list[tuple[str, str, str, str, int]]] = {
        "dataset_orders": [
            ("order_date", "订单日期", "time", "订单支付或创建日期", 0), ("region", "区域", "dimension", "业务区域", 0), ("channel", "渠道", "dimension", "销售渠道", 0),
            ("customer_segment", "客户分层", "dimension", "客户价值/类型分层", 0), ("category", "品类", "dimension", "商品品类", 0), ("product", "商品", "dimension", "商品名称", 0),
            ("order_status", "订单状态", "dimension", "paid/pending/refunded", 0), ("revenue", "收入", "metric", "订单收入金额", 0), ("quantity", "数量", "metric", "购买数量", 0),
            ("gross_margin", "毛利", "metric", "订单毛利金额", 0), ("account_owner", "客户经理", "dimension", "客户经理/负责人", 1), ("notes", "备注", "text", "订单备注", 1),
        ],
        "dataset_tickets": [
            ("ticket_date", "工单日期", "time", "工单登记日期", 0), ("region", "区域", "dimension", "业务区域", 0), ("customer_segment", "客户分层", "dimension", "客户类型", 0),
            ("category", "品类", "dimension", "关联产品品类", 0), ("issue_type", "问题类型", "dimension", "客户工单类型", 0), ("root_cause", "根因", "dimension", "根因分类", 0),
            ("severity", "严重度", "dimension", "高/中/低", 0), ("status", "状态", "dimension", "open/closed", 0), ("account_owner", "客户经理", "dimension", "责任人", 1), ("summary", "摘要", "text", "工单摘要", 1),
        ],
        "dataset_campaigns": [
            ("campaign_date", "活动日期", "time", "营销活动日期", 0), ("channel", "渠道", "dimension", "投放渠道", 0), ("campaign_name", "活动名称", "dimension", "活动名称", 0),
            ("campaign_type", "活动类型", "dimension", "拉新/促活", 0), ("spend", "花费", "metric", "营销花费", 0), ("impressions", "曝光", "metric", "曝光次数", 0),
            ("clicks", "点击", "metric", "点击次数", 0), ("conversions", "转化", "metric", "转化次数", 0), ("revenue", "收入", "metric", "活动归因收入", 0),
        ],
        "dataset_products": [
            ("category", "品类", "dimension", "商品品类", 0), ("product", "商品", "dimension", "商品名称", 0), ("price", "价格", "metric", "标准价格", 0),
            ("cost", "成本", "metric", "标准成本", 1), ("supplier", "供应商", "dimension", "供应商名称", 1), ("active", "是否有效", "dimension", "1=有效", 0),
        ],
        "dataset_business_daily": [
            ("metric_date", "指标日期", "time", "指标统计日期", 0), ("region", "区域", "dimension", "业务区域", 0), ("channel", "渠道", "dimension", "渠道", 0),
            ("revenue", "收入", "metric", "日收入", 0), ("order_count", "订单数", "metric", "日订单数", 0), ("gross_margin", "毛利", "metric", "日毛利", 0),
            ("open_ticket_count", "未关闭工单数", "metric", "未关闭服务工单数", 0), ("conversion_rate", "转化率", "metric", "营销/销售转化率", 0), ("risk_score", "风险分", "metric", "经营风险评分", 0),
        ],
    }
    for dsid, fields in field_defs.items():
        for fname, display, typ, desc, sensitive in fields:
            fid = f"field_{dsid}_{fname}".replace("-", "_")
            _upsert_by_id("dataset_fields", fid, {"id": fid, "dataset_id": dsid, "field_name": fname, "display_name": display, "field_type": typ, "semantic_type": typ, "description": desc, "default_aggregation": "sum" if typ == "metric" else ("count" if fname in {"status", "order_status"} else ""), "is_sensitive": sensitive, "is_filterable": 1, "is_groupable": 0 if typ == "text" else 1})

    metrics = [
        ("metric_revenue", "dataset_orders", "收入", "revenue", "sum(revenue)", "订单收入合计"),
        ("metric_order_count", "dataset_orders", "订单数", "order_count", "count(*)", "订单记录数"),
        ("metric_avg_order_value", "dataset_orders", "客单价", "avg_order_value", "sum(revenue) / count(*)", "平均每单收入"),
        ("metric_gross_margin", "dataset_orders", "毛利", "gross_margin", "sum(gross_margin)", "订单毛利合计"),
        ("metric_open_tickets", "dataset_tickets", "未关闭工单数", "open_ticket_count", "count(case when status='open' then 1 end)", "状态为 open 的客户工单数"),
        ("metric_ticket_close_rate", "dataset_tickets", "工单闭环率", "ticket_close_rate", "closed数 / 总工单数", "客户工单关闭比例"),
        ("metric_campaign_roi", "dataset_campaigns", "营销 ROI", "campaign_roi", "sum(revenue) / sum(spend)", "活动收入与花费比"),
        ("metric_conversion_rate", "dataset_business_daily", "转化率", "conversion_rate", "avg(conversion_rate)", "日度平均转化率"),
        ("metric_business_risk", "dataset_business_daily", "经营风险分", "risk_score", "avg(risk_score)", "综合收入、工单和转化率的风险评分"),
    ]
    for mid, dsid, name, code, formula, desc in metrics:
        _upsert_by_id("metrics", mid, {"id": mid, "dataset_id": dsid, "name": name, "code": code, "formula": formula, "description": desc, "time_grain": "month", "owner_id": "u_admin", "status": "published"})
    for object_id, syns in {
        "metric_revenue": ["销售额", "营收", "GMV", "营业收入"],
        "metric_order_count": ["订单量", "成交单数", "单量"],
        "metric_open_tickets": ["未闭环工单", "开放工单", "待处理问题"],
        "metric_campaign_roi": ["投放ROI", "营销回报", "活动回报率"],
        "metric_business_risk": ["风险评分", "风险指数", "经营风险"],
    }.items():
        for synonym in syns:
            if not many("SELECT id FROM synonyms WHERE object_type='metric' AND object_id=? AND synonym=?", [object_id, synonym]):
                insert("synonyms", {"id": new_id("syn"), "object_type": "metric", "object_id": object_id, "synonym": synonym})

    for role_id, masked_fields in [("r_admin", []), ("r_business", ["account_owner", "notes", "summary", "supplier", "cost"] )]:
        for dsid in ["dataset_orders", "dataset_tickets", "dataset_campaigns", "dataset_products", "dataset_business_daily"]:
            if not many("SELECT id FROM dataset_permissions WHERE dataset_id=? AND subject_type='role' AND subject_id=?", [dsid, role_id]):
                insert("dataset_permissions", {"id": new_id("dperm"), "dataset_id": dsid, "subject_type": "role", "subject_id": role_id, "permission": "read", "row_filter": None, "masked_fields": masked_fields})

    for kb_id, name, typ, desc in [
        ("kb_business_rules", "业务规则知识库", "rules", "示例知识库：用于展示知识引用，不含真实企业业务规则。"),
        ("kb_metric_glossary", "指标口径知识库", "glossary", "指标定义、业务术语、同义词和口径说明。"),
        ("kb_report_templates", "分析报告模板库", "template", "经营月报、复盘、归因分析模板。"),
    ]:
        _upsert_by_id("knowledge_bases", kb_id, {"id": kb_id, "name": name, "type": typ, "backend_type": "mock", "adapter_id": "ad_mock_knowledge", "description": desc, "owner_id": "u_admin", "status": "active"})
        _upsert_by_id("knowledge_versions", f"kbv_{kb_id}_100", {"id": f"kbv_{kb_id}_100", "knowledge_base_id": kb_id, "version": "1.0.0", "checksum": "demo", "status": "active", "created_at": t})
    for agid in ["agent_business_knowledge", "agent_business_analysis", "agent_executive_report", "agent_semantic"]:
        for kb_id in ["kb_business_rules", "kb_metric_glossary", "kb_report_templates"]:
            if not many("SELECT id FROM knowledge_bindings WHERE agent_id=? AND knowledge_base_id=?", [agid, kb_id]):
                insert("knowledge_bindings", {"id": new_id("kbind"), "agent_id": agid, "knowledge_base_id": kb_id, "binding_type": "default", "priority": 100})

    terms = [
        ("term_revenue", "收入", "metric", "Sales", "订单收入金额合计，可按区域、渠道、品类、商品和客户分层拆解。", "metric", "metric_revenue", ["销售额", "营收", "GMV"]),
        ("term_aov", "客单价", "metric", "Sales", "收入除以订单数，用于衡量单笔订单价值。", "metric", "metric_avg_order_value", ["平均订单金额", "AOV"]),
        ("term_ticket_root_cause", "工单根因", "business_term", "Service", "客户服务工单的根因分类，用于定位服务或交付短板。", None, None, ["问题原因", "根因分类"]),
        ("term_campaign_roi", "营销 ROI", "metric", "Marketing", "营销归因收入除以营销花费，用于衡量活动回报。", "metric", "metric_campaign_roi", ["投放回报", "活动 ROI"]),
        ("term_business_risk", "经营风险", "metric", "Business", "综合收入、转化率、未关闭工单等信号形成的风险判断。", "metric", "metric_business_risk", ["风险分", "风险指数"]),
        ("term_report", "经营分析报告", "report", "Business", "由数据、图表、证据链和人工复核共同构成的经营分析报告草稿。", None, None, ["经营月报", "复盘报告"]),
    ]
    for tid, term, typ, domain, definition, obj_type, obj_id, syns in terms:
        _upsert_by_id("semantic_terms", tid, {"id": tid, "term": term, "term_type": typ, "business_domain": domain, "definition": definition, "canonical_object_type": obj_type, "canonical_object_id": obj_id, "synonyms": syns, "owner_id": "u_admin", "status": "published", "created_at": t})

    templates = [
        ("qt_revenue_top_channel", "收入 Top 渠道", "Sales", "topn", "本月收入最高的渠道有哪些？", "dataset_orders", "SELECT channel, SUM(revenue) AS revenue, COUNT(*) AS order_count FROM sales_orders WHERE order_date >= :start AND order_date < :end GROUP BY channel ORDER BY revenue DESC LIMIT 10", "bar", ["本月收入最高的渠道有哪些？", "渠道收入Top10"]),
        ("qt_revenue_trend", "收入趋势", "Sales", "trend", "近三个月收入趋势如何？", "dataset_orders", "SELECT substr(order_date,1,7) AS month, SUM(revenue) AS revenue, COUNT(*) AS order_count FROM sales_orders GROUP BY substr(order_date,1,7) ORDER BY month", "line", ["近三个月收入趋势如何？", "收入趋势"]),
        ("qt_ticket_root", "工单根因分布", "Service", "distribution", "客户工单的根因分布是什么？", "dataset_tickets", "SELECT root_cause, COUNT(*) AS ticket_count FROM support_tickets GROUP BY root_cause ORDER BY ticket_count DESC", "bar", ["工单根因最多是什么？", "按根因统计客户问题"]),
        ("qt_campaign_roi", "营销 ROI 排序", "Marketing", "roi", "哪些营销活动 ROI 最高？", "dataset_campaigns", "SELECT campaign_name, SUM(revenue) / NULLIF(SUM(spend),0) AS roi, SUM(spend) AS spend, SUM(revenue) AS revenue FROM marketing_campaigns GROUP BY campaign_name ORDER BY roi DESC LIMIT 10", "bar", ["营销 ROI Top 活动", "活动回报率最高的是哪些？"]),
        ("qt_risk_region", "经营风险排序", "Business", "risk", "当前经营风险最高的区域有哪些？", "dataset_business_daily", "SELECT region, AVG(risk_score) AS avg_risk_score FROM business_metrics_daily GROUP BY region ORDER BY avg_risk_score DESC LIMIT 10", "bar", ["风险最高的区域", "经营风险Top区域"]),
    ]
    for qid, name, domain, intent, text, dsid, sql, chart, examples in templates:
        _upsert_by_id("query_templates", qid, {"id": qid, "name": name, "business_domain": domain, "intent": intent, "template_text": text, "dataset_id": dsid, "sql_template": sql, "chart_type": chart, "example_questions": examples, "status": "published", "created_at": t})

    quality_rules = [
        ("dq_order_date_not_null", "dataset_orders", "订单日期不能为空", "not_null", "order_date", "order_date IS NULL OR order_date=''", "high"),
        ("dq_order_revenue_valid", "dataset_orders", "订单收入不能异常为空", "not_null", "revenue", "revenue IS NULL", "high"),
        ("dq_ticket_status_valid", "dataset_tickets", "工单状态必须合法", "enum", "status", "status NOT IN ('open','closed')", "high"),
        ("dq_campaign_spend_non_negative", "dataset_campaigns", "营销花费不能为负", "range", "spend", "spend < 0", "high"),
        ("dq_business_risk_range", "dataset_business_daily", "经营风险分必须在 0-100", "range", "risk_score", "risk_score < 0 OR risk_score > 100", "high"),
    ]
    for rid, dsid, name, typ, field, expr, sev in quality_rules:
        _upsert_by_id("data_quality_rules", rid, {"id": rid, "dataset_id": dsid, "name": name, "rule_type": typ, "field_name": field, "expression": expr, "severity": sev, "owner_id": "u_admin", "status": "active", "created_at": t})

    panel_id = "panel_business_overview"
    _upsert_by_id("dashboard_panels", panel_id, {"id": panel_id, "name": "经营数据智能总览", "business_domain": "Business", "description": "内置演示面板：收入、订单、工单、营销 ROI 和经营风险。", "owner_id": "u_admin", "layout_json": {"columns": 12}, "status": "published", "created_at": t, "updated_at": t})
    widgets = [
        ("w_revenue", "metric_card", "本月收入", "dataset_orders", "metric_revenue", "SELECT SUM(revenue) AS value FROM sales_orders WHERE order_date >= '2026-05-01'", {"w":3,"h":2,"x":0,"y":0}),
        ("w_order_count", "metric_card", "本月订单数", "dataset_orders", "metric_order_count", "SELECT COUNT(*) AS value FROM sales_orders WHERE order_date >= '2026-05-01'", {"w":3,"h":2,"x":3,"y":0}),
        ("w_open_tickets", "metric_card", "未关闭工单", "dataset_tickets", "metric_open_tickets", "SELECT SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS value FROM support_tickets", {"w":3,"h":2,"x":6,"y":0}),
        ("w_channel_revenue", "bar", "渠道收入 Top", "dataset_orders", "metric_revenue", "SELECT channel, SUM(revenue) AS revenue FROM sales_orders GROUP BY channel ORDER BY revenue DESC LIMIT 8", {"w":6,"h":4,"x":0,"y":2}),
        ("w_risk_region", "bar", "区域经营风险", "dataset_business_daily", "metric_business_risk", "SELECT region, AVG(risk_score) AS risk_score FROM business_metrics_daily GROUP BY region ORDER BY risk_score DESC LIMIT 8", {"w":6,"h":4,"x":6,"y":2}),
    ]
    for wid, wtype, title, dsid, mid, sql, pos in widgets:
        _upsert_by_id("panel_widgets", wid, {"id": wid, "panel_id": panel_id, "widget_type": wtype, "title": title, "dataset_id": dsid, "metric_id": mid, "query_sql": sql, "chart_spec": {"chart_type": wtype}, "position_json": pos, "created_at": t})

    workspace_id = "codex_ws_data_agent_platform"
    _upsert_by_id("codex_workspaces", workspace_id, {"id": workspace_id, "name": "Data Agent Platform 代码仓", "repo_path": str(ROOT), "default_branch": "main", "allowed_paths": ["apps/", "database/", "docs/", "scripts/"], "test_command": "python scripts/smoke_test.py && python scripts/security_smoke_test.py && python scripts/standalone_regression_test.py", "owner_id": "u_admin", "status": "active", "created_at": t})

    _upsert_by_id("eval_sets", "eval_sales_v1", {"id": "eval_sales_v1", "name": "销售经营问数 V1 评测集", "business_domain": "Sales", "description": "用于验证收入、订单、渠道、区域查询准确率和 SQL 可追溯性。", "owner_id": "u_admin"})
    _upsert_by_id("eval_sets", "eval_full_agent_v1", {"id": "eval_full_agent_v1", "name": "独立数据智能体能力评测集", "business_domain": "Business", "description": "覆盖问数、工单归因、异常、语义、数据质量、面板和 Codex 嵌套。", "owner_id": "u_admin"})
    eval_questions = [
        ("eval_sales_v1", "本月收入最高的渠道有哪些？"),
        ("eval_sales_v1", "按区域统计本月收入"),
        ("eval_sales_v1", "近三个月收入趋势如何？"),
        ("eval_full_agent_v1", "客户工单根因分布是什么？"),
        ("eval_full_agent_v1", "当前经营风险最高的区域有哪些？"),
        ("eval_full_agent_v1", "给我生成一个经营总览面板"),
        ("eval_full_agent_v1", "帮我创建一个 Codex 任务，完善评测中心页面"),
    ]
    for set_id, q in eval_questions:
        if not many("SELECT id FROM eval_cases WHERE eval_set_id=? AND question=?", [set_id, q]):
            insert("eval_cases", {"id": new_id("case"), "eval_set_id": set_id, "question": q, "expected_answer": "样例标准答案需由业务维护", "expected_sql": "", "expected_chart_json": "{}", "expected_report_outline": "", "tags": ["内置Agent"]})


def init_all(reset: bool = False) -> None:
    init_business_db(reset=reset)
    init_platform_db(reset=reset)
