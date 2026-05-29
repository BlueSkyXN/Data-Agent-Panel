from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from typing import Any

from fastapi import HTTPException

from .. import db
from ..config import get_settings
from . import codex_service, data_capabilities, sql_guard, trace_service

settings = get_settings()


def _safe_json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return json.dumps({"unserializable": True}, ensure_ascii=False)


def _table_payload(name: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    columns = list(rows[0].keys()) if rows else []
    return {"name": name, "columns": columns, "rows": rows}


def _chart(chart_type: str, title: str, x: str, y: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {"chart_type": chart_type, "title": title, "spec": {"x": x, "y": y, "data": rows}}


def normalize_agent_result(result: dict[str, Any], trace_id: str) -> dict[str, Any]:
    result = dict(result or {})
    result.setdefault("answer", "")
    result.setdefault("answer_type", "text")
    result.setdefault("confidence", 0.0)
    result.setdefault("tables", [])
    result.setdefault("charts", [])
    result.setdefault("sql", [])
    result.setdefault("evidence", [])
    result.setdefault("warnings", [])
    result.setdefault("next_actions", [])
    result["trace_id"] = trace_id
    for chart in result.get("charts") or []:
        try:
            db.insert("chart_specs", {"id": db.new_id("chart"), "trace_id": trace_id, "chart_type": chart.get("chart_type", "unknown"), "spec_json": chart.get("spec", {}), "data_ref": chart.get("title", ""), "created_at": db.now()})
        except Exception:
            pass
    return result


def _month_where(field: str = "order_date") -> str:
    return f"WHERE {field} >= '2026-05-01' AND {field} < '2026-06-01'"


def build_sales_sql(message: str) -> tuple[str, str, str, str, str]:
    m = message.lower()
    where = _month_where("order_date")
    if "趋势" in message or "近三个月" in message or "trend" in m:
        return ("dataset_orders", "SELECT substr(order_date,1,7) AS month, SUM(revenue) AS revenue, COUNT(*) AS order_count FROM sales_orders GROUP BY substr(order_date,1,7) ORDER BY month", "收入趋势", "line", "month")
    if "区域" in message or "region" in m:
        return ("dataset_orders", f"SELECT region, SUM(revenue) AS revenue, COUNT(*) AS order_count, SUM(gross_margin) AS gross_margin FROM sales_orders {where} GROUP BY region ORDER BY revenue DESC", "按区域统计收入", "bar", "region")
    if "品类" in message or "category" in m:
        return ("dataset_orders", f"SELECT category, SUM(revenue) AS revenue, COUNT(*) AS order_count, SUM(gross_margin) AS gross_margin FROM sales_orders {where} GROUP BY category ORDER BY revenue DESC", "按品类统计收入", "bar", "category")
    if "商品" in message or "产品" in message or "product" in m:
        return ("dataset_orders", f"SELECT product, SUM(revenue) AS revenue, COUNT(*) AS order_count, SUM(gross_margin) AS gross_margin FROM sales_orders {where} GROUP BY product ORDER BY revenue DESC LIMIT 10", "商品收入 Top10", "bar", "product")
    if "明细" in message or "备注" in message or "detail" in m:
        return ("dataset_orders", f"SELECT order_date,region,channel,customer_segment,category,product,order_status,revenue,quantity,gross_margin,account_owner,notes FROM sales_orders {where} ORDER BY order_date DESC LIMIT 20", "订单明细", "table", "product")
    return ("dataset_orders", f"SELECT channel, SUM(revenue) AS revenue, COUNT(*) AS order_count, SUM(gross_margin) AS gross_margin FROM sales_orders {where} GROUP BY channel ORDER BY revenue DESC LIMIT 10", "渠道收入 Top", "bar", "channel")


def call_mock_chatbi(message: str, trace_id: str, user: dict | None = None) -> dict[str, Any]:
    trace_service.add_step(trace_id, "intent", "builtin_intent_router", {"message": message}, {"intent": "metric_query", "domain": "Sales"})
    dataset_id, sql, title, chart_type, x_field = build_sales_sql(message)
    trace_service.add_step(trace_id, "sql_generation", "builtin_nl2sql_template", {"message": message}, {"sql": sql, "template": title})
    result = sql_guard.run_sql(sql, trace_id, dataset_id=dataset_id, user=user)
    rows = result["rows"]
    y_field = "revenue" if rows and "revenue" in rows[0] else ("order_count" if rows and "order_count" in rows[0] else (result["columns"][-1] if result["columns"] else "value"))
    top_desc = "暂无数据"
    if rows:
        first = rows[0]
        top_desc = "，".join([f"{k}={v}" for k, v in first.items()])
    chart = _chart(chart_type, title, x_field, y_field, rows) if chart_type != "table" else None
    return normalize_agent_result({
        "answer": f"已完成查询：{title}。首项结果：{top_desc}。",
        "answer_type": "metric_analysis",
        "confidence": 0.86,
        "tables": [_table_payload("query_result", rows)],
        "charts": [chart] if chart else [],
        "sql": [{"dataset": dataset_id, "sql_text": result["sql"], "status": "success"}],
        "evidence": [{"type": "dataset", "name": "销售订单", "dataset_id": dataset_id}],
        "warnings": ["该结果基于当前用户权限范围，敏感字段已按策略脱敏。"],
        "next_actions": ["查看明细", "生成深度分析", "生成经营面板", "创建 Codex 改造任务"],
    }, trace_id)


def call_mock_ticket(message: str, trace_id: str, user: dict | None = None) -> dict[str, Any]:
    trace_service.add_step(trace_id, "intent", "ticket_intent", {"message": message}, {"intent": "ticket_root_cause"})
    if "状态" in message or "闭环" in message or "关闭" in message:
        sql = "SELECT status, COUNT(*) AS ticket_count FROM support_tickets GROUP BY status ORDER BY ticket_count DESC"
        title, x = "客户工单闭环状态", "status"
    elif "区域" in message:
        sql = "SELECT region, COUNT(*) AS ticket_count, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open_count FROM support_tickets GROUP BY region ORDER BY open_count DESC, ticket_count DESC LIMIT 10"
        title, x = "客户工单区域分布", "region"
    elif "问题类型" in message or "类型" in message:
        sql = "SELECT issue_type, COUNT(*) AS ticket_count, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open_count FROM support_tickets GROUP BY issue_type ORDER BY ticket_count DESC"
        title, x = "客户工单问题类型分布", "issue_type"
    else:
        sql = "SELECT root_cause, COUNT(*) AS ticket_count, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open_count FROM support_tickets GROUP BY root_cause ORDER BY ticket_count DESC"
        title, x = "客户工单根因分布", "root_cause"
    trace_service.add_step(trace_id, "sql_generation", "ticket_sql_template", {"message": message}, {"sql": sql})
    result = sql_guard.run_sql(sql, trace_id, dataset_id="dataset_tickets", user=user)
    rows = result["rows"]
    report = "\n".join([f"- {r.get(x)}：工单数 {r.get('ticket_count', '-')}, 未关闭 {r.get('open_count', '-') }" for r in rows[:8]])
    return normalize_agent_result({
        "answer": f"已完成 {title}。主要集中项如下：\n{report}",
        "answer_type": "ticket_analysis",
        "confidence": 0.84,
        "tables": [_table_payload("ticket_result", rows)],
        "charts": [_chart("bar", title, x, "ticket_count", rows)],
        "sql": [{"dataset": "dataset_tickets", "sql_text": result["sql"], "status": "success"}],
        "evidence": [{"type": "dataset", "name": "客户工单", "dataset_id": "dataset_tickets"}],
        "warnings": ["工单归因基于结构化样例字段，真实业务规则仍需业务复核。"],
        "next_actions": ["按区域下钻", "生成服务改进建议", "进入人工复核"],
    }, trace_id)


def call_mock_anomaly(message: str, trace_id: str, user: dict | None = None) -> dict[str, Any]:
    trace_service.add_step(trace_id, "planning", "anomaly_signal_plan", {"message": message}, {"signals": ["risk_score", "revenue", "open_ticket_count", "conversion_rate"]})
    sql = "SELECT region, AVG(risk_score) AS avg_risk_score, SUM(revenue) AS revenue, SUM(open_ticket_count) AS open_ticket_count, AVG(conversion_rate) AS conversion_rate FROM business_metrics_daily GROUP BY region ORDER BY avg_risk_score DESC LIMIT 10"
    result = sql_guard.run_sql(sql, trace_id, dataset_id="dataset_business_daily", user=user)
    rows = result["rows"]
    actions = [f"{r['region']}：风险分 {round(r['avg_risk_score'], 2)}，建议复核收入趋势、未关闭工单和转化率。" for r in rows[:5]]
    return normalize_agent_result({
        "answer": "当前经营风险 Top 区域已识别：\n" + "\n".join(["- " + a for a in actions]),
        "answer_type": "risk_analysis",
        "confidence": 0.8,
        "tables": [_table_payload("risk_regions", rows)],
        "charts": [_chart("bar", "经营风险 Top 区域", "region", "avg_risk_score", rows)],
        "sql": [{"dataset": "dataset_business_daily", "sql_text": result["sql"], "status": "success"}],
        "evidence": [{"type": "dataset", "name": "经营日度指标", "dataset_id": "dataset_business_daily"}],
        "warnings": ["风险分为演示算法，正式使用前需和业务专家确认权重。"],
        "next_actions": ["生成风险复盘报告", "按渠道拆解", "进入人工复核"],
    }, trace_id)


def call_mock_knowledge(message: str, trace_id: str, user: dict | None = None) -> dict[str, Any]:
    terms = db.many("SELECT * FROM semantic_terms ORDER BY business_domain, term LIMIT 8")
    trace_service.add_step(trace_id, "knowledge_retrieval", "builtin_business_kb", {"query": message}, {"hits": len(terms)})
    answer = "当前内置知识能力已覆盖业务规则、指标口径、报告模板和语义术语。正式接入 RAGFlow/Dify Knowledge 后，应返回文档片段、引用来源、版本号和权限命中。\n\n相关术语：\n" + "\n".join([f"- {t['term']}：{t['definition']}" for t in terms[:5]])
    return normalize_agent_result({
        "answer": answer,
        "answer_type": "knowledge_answer",
        "confidence": 0.65,
        "tables": [_table_payload("semantic_terms", terms)],
        "evidence": [{"type": "knowledge", "name": "业务规则知识库", "ref_id": "kb_business_rules", "version": "1.0.0"}],
        "warnings": ["当前为内置示例知识库，不代表真实企业业务规则。"],
        "next_actions": ["绑定真实知识库", "补充引用来源", "加入人工复核"],
    }, trace_id)


def call_mock_semantic(message: str, trace_id: str, user: dict | None = None) -> dict[str, Any]:
    coverage = {
        "metrics": db.many("SELECT m.*, d.name AS dataset_name FROM metrics m JOIN datasets d ON d.id=m.dataset_id ORDER BY d.name, m.name"),
        "terms": db.many("SELECT * FROM semantic_terms ORDER BY business_domain, term"),
        "templates": db.many("SELECT * FROM query_templates ORDER BY business_domain, intent"),
    }
    trace_service.add_step(trace_id, "semantic", "semantic_coverage", {"message": message}, {"metric_count": len(coverage["metrics"]), "term_count": len(coverage["terms"])})
    return normalize_agent_result({
        "answer": f"语义治理状态：已登记 {len(coverage['metrics'])} 个指标、{len(coverage['terms'])} 个术语、{len(coverage['templates'])} 个查询模板。建议持续补齐每个指标的口径、同义词、时间口径和权限范围。",
        "answer_type": "semantic_governance",
        "confidence": 0.82,
        "tables": [_table_payload("metrics", coverage["metrics"]), _table_payload("terms", coverage["terms"])],
        "evidence": [{"type": "semantic", "name": "指标字典与语义术语"}],
        "next_actions": ["补齐缺失术语", "生成问题模板", "运行评测集"],
    }, trace_id)


def call_mock_data_profile(message: str, trace_id: str, user: dict | None = None) -> dict[str, Any]:
    m = message.lower()
    dataset_id = "dataset_tickets" if "工单" in message or "ticket" in m else ("dataset_campaigns" if "营销" in message or "campaign" in m else ("dataset_business_daily" if "风险" in message or "日度" in message else "dataset_orders"))
    profile = data_capabilities.profile_dataset(dataset_id, trace_id=trace_id, user=user)
    field_rows = profile["fields"]
    return normalize_agent_result({
        "answer": f"数据画像完成：{profile['dataset']['name']} 共 {profile['row_count']} 行、{len(field_rows)} 个字段。",
        "answer_type": "data_profile",
        "confidence": 0.9,
        "tables": [_table_payload("field_profile", field_rows), _table_payload("sample_rows", profile["sample_rows"])],
        "evidence": [{"type": "dataset", "name": profile["dataset"]["name"], "dataset_id": dataset_id}],
        "warnings": ["样本行已按当前用户权限脱敏。"],
        "next_actions": ["运行数据质量规则", "补充字段语义", "创建面板"],
    }, trace_id)


def call_mock_data_quality(message: str, trace_id: str, user: dict | None = None) -> dict[str, Any]:
    dataset_id = None
    m = message.lower()
    if "工单" in message or "ticket" in m:
        dataset_id = "dataset_tickets"
    elif "订单" in message or "收入" in message or "sales" in m:
        dataset_id = "dataset_orders"
    elif "营销" in message or "campaign" in m:
        dataset_id = "dataset_campaigns"
    results = data_capabilities.run_quality_rules(dataset_id, trace_id=trace_id, user=user)
    rows = [{"rule": r["rule"]["name"], "dataset": r["dataset"]["name"], "status": r["status"], "checked_rows": r["checked_rows"], "failed_rows": r["failed_rows"], "severity": r["rule"]["severity"]} for r in results]
    failed = [r for r in rows if r["status"] == "failed"]
    return normalize_agent_result({
        "answer": f"数据质量规则运行完成：共 {len(rows)} 条规则，失败 {len(failed)} 条。" + ("请优先处理高严重度失败规则。" if failed else "未发现失败规则。"),
        "answer_type": "data_quality",
        "confidence": 0.88,
        "tables": [_table_payload("quality_results", rows)],
        "evidence": [{"type": "data_quality", "name": "内置数据质量规则"}],
        "warnings": ["数据质量规则为平台示例规则，正式生产需和数据 Owner 共建。"],
        "next_actions": ["查看失败样本", "创建修复任务", "生成经营报告"],
    }, trace_id)


def call_mock_panel(message: str, trace_id: str, user: dict | None = None) -> dict[str, Any]:
    panel = data_capabilities.materialize_panel("panel_business_overview", trace_id=trace_id, user=user)
    widgets = panel.get("widgets", [])
    rows = [{"widget": w["title"], "type": w["widget_type"], "row_count": len(w.get("rows") or [])} for w in widgets]
    return normalize_agent_result({
        "answer": f"已生成/读取分析面板：{panel['name']}。包含 {len(widgets)} 个组件：指标卡、Top 图表和风险图表。",
        "answer_type": "panel",
        "confidence": 0.86,
        "panel": panel,
        "tables": [_table_payload("panel_widgets", rows)],
        "charts": [_chart("bar", "面板组件数据量", "widget", "row_count", rows)],
        "evidence": [{"type": "panel", "name": panel["name"], "panel_id": panel["id"]}],
        "next_actions": ["打开面板中心", "新增组件", "交给 Codex 优化前端面板"],
    }, trace_id)


def call_mock_analysis(message: str, trace_id: str, user: dict | None = None) -> dict[str, Any]:
    trace_service.add_step(trace_id, "planning", "deep_research_planner", {"question": message}, {"plan": ["收入趋势", "渠道拆解", "工单根因", "营销 ROI", "经营建议"]})
    trend_sql = "SELECT substr(order_date,1,7) AS month, SUM(revenue) AS revenue, COUNT(*) AS order_count FROM sales_orders GROUP BY substr(order_date,1,7) ORDER BY month"
    top_sql = "SELECT channel, SUM(revenue) AS revenue, COUNT(*) AS order_count FROM sales_orders WHERE order_date >= '2026-05-01' AND order_date < '2026-06-01' GROUP BY channel ORDER BY revenue DESC LIMIT 5"
    ticket_sql = "SELECT root_cause, COUNT(*) AS ticket_count FROM support_tickets GROUP BY root_cause ORDER BY ticket_count DESC LIMIT 5"
    campaign_sql = "SELECT campaign_name, SUM(revenue) / NULLIF(SUM(spend),0) AS roi, SUM(spend) AS spend, SUM(revenue) AS revenue FROM marketing_campaigns GROUP BY campaign_name ORDER BY roi DESC LIMIT 5"
    trend = sql_guard.run_sql(trend_sql, trace_id, dataset_id="dataset_orders", user=user)
    top = sql_guard.run_sql(top_sql, trace_id, dataset_id="dataset_orders", user=user)
    tickets = sql_guard.run_sql(ticket_sql, trace_id, dataset_id="dataset_tickets", user=user)
    campaigns = sql_guard.run_sql(campaign_sql, trace_id, dataset_id="dataset_campaigns", user=user)
    dq = data_capabilities.run_quality_rules(None, trace_id=trace_id, user=user)
    trace_service.add_step(trace_id, "analysis", "builtin_python_like_analysis", {"inputs": ["trend", "top", "tickets", "campaigns", "dq"]}, {"method": "rule_based_multi_signal_summary"})
    report = f"""# 经营深度研究报告（内置 Agent）

## 1. 分析问题
{message}

## 2. 分析框架
1. 收入趋势：确认整体波动方向。
2. 渠道贡献：确认本月主要收入来源。
3. 客户工单：补充服务与交付风险。
4. 营销 ROI：评估活动投入产出。
5. 数据质量：评估结论可信度。
6. 建议：输出人工复核和经营动作路径。

## 3. 关键发现
- 收入趋势查询返回 {trend['row_count']} 行。
- 本月渠道收入 Top 查询返回 {top['row_count']} 行。
- 客户工单根因查询返回 {tickets['row_count']} 行。
- 营销 ROI 查询返回 {campaigns['row_count']} 行。
- 数据质量规则运行 {len(dq)} 条，其中失败 {sum(1 for x in dq if x['status']=='failed')} 条。

## 4. 初步建议
- 优先复核收入贡献最高和风险最高的渠道，确认是否存在退款、交付或服务问题。
- 对未关闭工单高发根因建立专项改进计划。
- 对营销 ROI 偏低活动做预算复核，不建议让 Agent 自动调整预算。
"""
    return normalize_agent_result({
        "answer": "已生成经营深度研究报告草稿。",
        "answer_type": "deep_analysis",
        "confidence": 0.81,
        "report_markdown": report,
        "tables": [_table_payload("revenue_trend", trend["rows"]), _table_payload("channel_top", top["rows"]), _table_payload("ticket_root_cause", tickets["rows"]), _table_payload("campaign_roi", campaigns["rows"])],
        "charts": [_chart("line", "收入趋势", "month", "revenue", trend["rows"]), _chart("bar", "渠道收入 Top", "channel", "revenue", top["rows"]), _chart("bar", "客户工单根因分布", "root_cause", "ticket_count", tickets["rows"]), _chart("bar", "营销 ROI Top", "campaign_name", "roi", campaigns["rows"])],
        "sql": [
            {"dataset": "dataset_orders", "sql_text": trend["sql"], "status": "success"},
            {"dataset": "dataset_orders", "sql_text": top["sql"], "status": "success"},
            {"dataset": "dataset_tickets", "sql_text": tickets["sql"], "status": "success"},
            {"dataset": "dataset_campaigns", "sql_text": campaigns["sql"], "status": "success"},
        ],
        "evidence": [{"type": "dataset", "name": "销售订单"}, {"type": "dataset", "name": "客户工单"}, {"type": "knowledge", "name": "业务规则知识库", "ref_id": "kb_business_rules"}],
        "warnings": ["报告为内置 Agent 生成结果，正式使用前必须经过人工复核。"],
        "next_actions": ["保存到报告中心", "人工复核", "交给 Codex 优化报告模板"],
    }, trace_id)


def call_mock_report(message: str, trace_id: str, user: dict | None = None) -> dict[str, Any]:
    analysis = call_mock_analysis(message or "生成本月经营分析报告", trace_id, user=user)
    analysis["answer_type"] = "report"
    analysis["answer"] = "已生成经营报告草稿，并已可保存到报告中心。"
    report_id = db.new_id("report")
    ver_id = db.new_id("rver")
    db.insert("reports", {"id": report_id, "title": "经营分析报告草稿", "report_type": "executive_business_report", "owner_id": user["id"] if user else "u_admin", "agent_id": "agent_executive_report", "status": "draft", "current_version_id": ver_id, "created_at": db.now()})
    db.insert("report_versions", {"id": ver_id, "report_id": report_id, "version": "1.0.0", "content_markdown": analysis.get("report_markdown") or "", "evidence_json": analysis.get("evidence") or [], "created_by": user["id"] if user else "u_admin", "created_at": db.now()})
    analysis["report_id"] = report_id
    return normalize_agent_result(analysis, trace_id)


def call_codex(message: str, trace_id: str, user: dict | None = None, agent_id: str | None = None) -> dict[str, Any]:
    task = codex_service.create_task({
        "title": message[:80] if message else "Data Agent Platform Codex 工程任务",
        "task_prompt": message,
        "workspace_id": "codex_ws_data_agent_platform",
        "source_agent_id": agent_id or "agent_codex",
        "trace_id": trace_id,
        "mode": settings.codex_mode,
        "requires_approval": True,
        "risk_level": "high",
        "acceptance_criteria": ["实现需求并保留现有平台安全能力", "更新相关 API/前端/文档", "运行 smoke 与 security 测试", "输出可审阅变更摘要"],
        "context": {"trace_id": trace_id, "source": "agent_nested_codex"},
    }, user or {"id": "u_admin"}, trace_id=trace_id)
    return normalize_agent_result({
        "answer": f"已创建 Codex 嵌套工程任务：{task['id']}。当前状态：{task['status']}。需管理员审批后派发到 Codex HTTP/CLI/SDK，或保留为 handoff 文件。",
        "answer_type": "codex_task",
        "confidence": 0.9,
        "codex_task": task,
        "tables": [_table_payload("codex_task", [{"id": task["id"], "title": task["title"], "status": task["status"], "mode": task["mode"], "risk_level": task["risk_level"]}])],
        "evidence": [{"type": "codex", "name": "Codex handoff", "codex_task_id": task["id"]}],
        "warnings": ["Codex 工程任务不会默认自动执行代码变更；生产环境应保留人工审批、Review 和测试。"],
        "next_actions": ["进入 Codex 工作台", "审批任务", "派发任务", "查看 handoff 文件"],
    }, trace_id)


def call_meta_router(message: str, trace_id: str, user: dict | None = None) -> dict[str, Any]:
    m = message.lower()
    if any(k in message for k in ["codex", "代码", "开发", "程序", "前端", "接口", "页面优化", "实现", "改造"]):
        trace_service.add_step(trace_id, "route", "meta_router", {"message": message}, {"target": "codex"})
        return call_codex(message, trace_id, user=user, agent_id="agent_router")
    if any(k in message for k in ["面板", "看板", "dashboard", "图表页"]):
        trace_service.add_step(trace_id, "route", "meta_router", {"message": message}, {"target": "panel"})
        return call_mock_panel(message, trace_id, user=user)
    if any(k in message for k in ["数据质量", "质量规则", "空值", "校验"]):
        trace_service.add_step(trace_id, "route", "meta_router", {"message": message}, {"target": "data_quality"})
        return call_mock_data_quality(message, trace_id, user=user)
    if any(k in message for k in ["画像", "profile", "字段", "样本", "数据集"]):
        trace_service.add_step(trace_id, "route", "meta_router", {"message": message}, {"target": "data_profile"})
        return call_mock_data_profile(message, trace_id, user=user)
    if any(k in message for k in ["语义", "指标口径", "同义词", "术语"]):
        trace_service.add_step(trace_id, "route", "meta_router", {"message": message}, {"target": "semantic"})
        return call_mock_semantic(message, trace_id, user=user)
    if any(k in message for k in ["工单", "客诉", "客户问题", "根因", "服务"]):
        trace_service.add_step(trace_id, "route", "meta_router", {"message": message}, {"target": "ticket"})
        return call_mock_ticket(message, trace_id, user=user)
    if any(k in message for k in ["风险", "高风险", "排序", "异常"]):
        trace_service.add_step(trace_id, "route", "meta_router", {"message": message}, {"target": "anomaly"})
        return call_mock_anomaly(message, trace_id, user=user)
    if any(k in message for k in ["报告", "月报", "周报", "复盘", "深度", "分析原因"]):
        trace_service.add_step(trace_id, "route", "meta_router", {"message": message}, {"target": "analysis"})
        return call_mock_analysis(message, trace_id, user=user)
    trace_service.add_step(trace_id, "route", "meta_router", {"message": message}, {"target": "sales_chatbi"})
    return call_mock_chatbi(message, trace_id, user=user)


def _validate_external_endpoint(endpoint: str) -> None:
    parsed = urllib.parse.urlparse(endpoint)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Adapter endpoint must use http or https")
    host = parsed.hostname or ""
    allowed = settings.allowed_external_agent_hosts
    if allowed and "*" not in allowed and host not in allowed:
        raise HTTPException(status_code=400, detail=f"External agent host is not allowlisted: {host}")


def call_generic_http(adapter: dict[str, Any], payload: dict[str, Any], trace_id: str) -> dict[str, Any]:
    endpoint = adapter.get("endpoint")
    if not endpoint:
        raise HTTPException(status_code=400, detail="Generic HTTP adapter endpoint is empty")
    _validate_external_endpoint(endpoint)
    config = {}
    try:
        config = json.loads(adapter.get("config_json") or "{}")
    except Exception:
        pass
    headers = {"Content-Type": "application/json", "X-Data-Agent-Trace-ID": trace_id}
    headers.update(config.get("headers") or {})
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
    start = time.time()
    status = "success"
    response_json: dict[str, Any] = {}
    try:
        with urllib.request.urlopen(req, timeout=max(1, int(adapter.get("timeout_ms", 60000)) / 1000)) as resp:
            body = resp.read().decode("utf-8")
            response_json = json.loads(body)
    except Exception as exc:
        status = "failed"
        response_json = {"error": str(exc)}
        raise HTTPException(status_code=502, detail=f"External agent call failed: {exc}")
    finally:
        duration = int((time.time() - start) * 1000)
        db.insert("tool_calls", {"id": db.new_id("call"), "trace_id": trace_id, "adapter_id": adapter["id"], "request_json": _safe_json(payload), "response_json": _safe_json(response_json), "status": status, "duration_ms": duration, "created_at": db.now()})
        trace_service.add_step(trace_id, "tool_call", "generic_http", payload, {"endpoint": endpoint, "duration_ms": duration, "status": status})
    return normalize_agent_result(response_json, trace_id)


def call_adapter(agent: dict[str, Any], version: dict[str, Any], message: str, trace_id: str, context: dict[str, Any] | None = None, user: dict | None = None) -> dict[str, Any]:
    adapter = db.one("SELECT * FROM tool_adapters WHERE id=?", [version["adapter_id"]])
    if not adapter:
        raise HTTPException(status_code=404, detail="Adapter not found")
    if not adapter.get("enabled"):
        raise HTTPException(status_code=400, detail="Adapter disabled")
    adapter_type = adapter["type"]
    trace_service.add_step(trace_id, "adapter_select", "adapter_gateway", {"agent_id": agent["id"], "adapter_id": adapter["id"]}, {"adapter_type": adapter_type})
    if adapter_type == "mock_router":
        return call_meta_router(message, trace_id, user=user)
    if adapter_type == "mock_chatbi":
        return call_mock_chatbi(message, trace_id, user=user)
    if adapter_type == "mock_knowledge":
        return call_mock_knowledge(message, trace_id, user=user)
    if adapter_type == "mock_analysis":
        return call_mock_analysis(message, trace_id, user=user)
    if adapter_type == "mock_report":
        return call_mock_report(message, trace_id, user=user)
    if adapter_type == "mock_ticket":
        return call_mock_ticket(message, trace_id, user=user)
    if adapter_type == "mock_anomaly":
        return call_mock_anomaly(message, trace_id, user=user)
    if adapter_type == "mock_data_profile":
        return call_mock_data_profile(message, trace_id, user=user)
    if adapter_type == "mock_data_quality":
        return call_mock_data_quality(message, trace_id, user=user)
    if adapter_type == "mock_semantic":
        return call_mock_semantic(message, trace_id, user=user)
    if adapter_type == "mock_panel":
        return call_mock_panel(message, trace_id, user=user)
    if adapter_type == "codex":
        return call_codex(message, trace_id, user=user, agent_id=agent["id"])
    if adapter_type == "generic_http":
        return call_generic_http(adapter, {"message": message, "context": context or {}, "user": {"id": user.get("id"), "roles": user.get("roles", [])} if user else None}, trace_id)
    trace_service.add_step(trace_id, "external_placeholder", adapter_type, {"message": message}, {"status": "placeholder"})
    return normalize_agent_result({
        "answer": f"{adapter_type} Adapter 已注册，但尚未配置真实 endpoint。本次返回占位结果。",
        "answer_type": "adapter_placeholder",
        "confidence": 0.1,
        "warnings": ["请在后台配置真实外部工具 endpoint 和鉴权参数。"],
        "next_actions": ["配置 Adapter endpoint", "查看适配开发文档", "创建 Codex 接入任务"],
    }, trace_id)
