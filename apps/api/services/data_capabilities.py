from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException

from .. import db
from ..security import can_read_dataset
from . import sql_guard, trace_service


def dataset_summary(dataset_id: str) -> dict[str, Any]:
    ds = db.one("SELECT * FROM datasets WHERE id=?", [dataset_id])
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    fields = db.many("SELECT * FROM dataset_fields WHERE dataset_id=? ORDER BY field_name", [dataset_id])
    metrics = db.many("SELECT * FROM metrics WHERE dataset_id=? ORDER BY name", [dataset_id])
    terms = db.many("SELECT * FROM semantic_terms WHERE canonical_object_id IN (SELECT id FROM metrics WHERE dataset_id=?) OR business_domain=? ORDER BY term", [dataset_id, ds["business_domain"]])
    for term in terms:
        try:
            term["synonyms"] = json.loads(term.get("synonyms") or "[]")
        except Exception:
            pass
    return {"dataset": ds, "fields": fields, "metrics": metrics, "terms": terms}


def profile_dataset(dataset_id: str, trace_id: str | None = None, user: dict | None = None) -> dict[str, Any]:
    if user and not can_read_dataset(user, dataset_id):
        raise HTTPException(status_code=403, detail="No permission to profile dataset")
    ds = db.one("SELECT * FROM datasets WHERE id=?", [dataset_id])
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    fields = db.many("SELECT * FROM dataset_fields WHERE dataset_id=? ORDER BY field_name", [dataset_id])
    profile: dict[str, Any] = {"dataset": ds, "fields": [], "sample_rows": [], "row_count": 0}
    # Row count.
    fake_trace = trace_id or db.new_id("trace_preview")
    count_result = sql_guard.run_sql(f"SELECT COUNT(*) AS row_count FROM {ds['physical_table']}", fake_trace, dataset_id=dataset_id, user=user)
    profile["row_count"] = count_result["rows"][0]["row_count"] if count_result["rows"] else 0
    sample_result = sql_guard.run_sql(f"SELECT * FROM {ds['physical_table']}", fake_trace, dataset_id=dataset_id, max_rows=5, user=user)
    profile["sample_rows"] = sample_result["rows"]
    for f in fields:
        name = f["field_name"]
        expr = f"SELECT COUNT(*) AS total_count, SUM(CASE WHEN {name} IS NULL OR {name}='' THEN 1 ELSE 0 END) AS null_count, COUNT(DISTINCT {name}) AS distinct_count FROM {ds['physical_table']}"
        stats = sql_guard.run_sql(expr, fake_trace, dataset_id=dataset_id, user=user)["rows"][0]
        profile["fields"].append({
            "field_name": name,
            "display_name": f["display_name"],
            "field_type": f["field_type"],
            "is_sensitive": bool(f["is_sensitive"]),
            "null_count": stats.get("null_count", 0),
            "distinct_count": stats.get("distinct_count", 0),
            "null_rate": round((stats.get("null_count") or 0) / max(1, stats.get("total_count") or 1), 4),
        })
    if trace_id:
        trace_service.add_step(trace_id, "data_profile", "dataset_profile", {"dataset_id": dataset_id}, {"row_count": profile["row_count"], "field_count": len(profile["fields"])})
    return profile


def run_quality_rules(dataset_id: str | None, trace_id: str | None = None, user: dict | None = None, rule_ids: list[str] | None = None) -> list[dict[str, Any]]:
    params: list[Any] = []
    where = "WHERE status='active'"
    if dataset_id:
        where += " AND dataset_id=?"
        params.append(dataset_id)
    if rule_ids:
        placeholders = ",".join(["?"] * len(rule_ids))
        where += f" AND id IN ({placeholders})"
        params.extend(rule_ids)
    rules = db.many(f"SELECT * FROM data_quality_rules {where} ORDER BY severity DESC, name", params)
    results: list[dict[str, Any]] = []
    for rule in rules:
        ds = db.one("SELECT * FROM datasets WHERE id=?", [rule["dataset_id"]])
        if not ds:
            continue
        if user and not can_read_dataset(user, ds["id"]):
            continue
        base_sql = f"SELECT COUNT(*) AS checked_rows FROM {ds['physical_table']}"
        fail_sql = f"SELECT COUNT(*) AS failed_rows FROM {ds['physical_table']} WHERE {rule['expression']}"
        sample_sql = f"SELECT * FROM {ds['physical_table']} WHERE {rule['expression']} LIMIT 5"
        fake_trace = trace_id or db.new_id("trace_quality")
        checked = sql_guard.run_sql(base_sql, fake_trace, dataset_id=ds["id"], user=user)["rows"][0]["checked_rows"]
        failed = sql_guard.run_sql(fail_sql, fake_trace, dataset_id=ds["id"], user=user)["rows"][0]["failed_rows"]
        samples = sql_guard.run_sql(sample_sql, fake_trace, dataset_id=ds["id"], user=user)["rows"] if failed else []
        status = "failed" if failed else "passed"
        rid = db.new_id("dqres")
        db.insert("data_quality_results", {"id": rid, "rule_id": rule["id"], "dataset_id": ds["id"], "status": status, "checked_rows": checked, "failed_rows": failed, "sample_rows": samples, "trace_id": trace_id, "created_at": db.now()})
        item = {"id": rid, "rule": rule, "dataset": ds, "status": status, "checked_rows": checked, "failed_rows": failed, "sample_rows": samples}
        results.append(item)
    if trace_id:
        trace_service.add_step(trace_id, "data_quality", "quality_rule_runner", {"dataset_id": dataset_id, "rule_ids": rule_ids or []}, {"result_count": len(results), "failed_count": sum(1 for r in results if r["status"] == "failed")})
    return results


def materialize_panel(panel_id: str, trace_id: str | None = None, user: dict | None = None) -> dict[str, Any]:
    panel = db.one("SELECT * FROM dashboard_panels WHERE id=?", [panel_id])
    if not panel:
        raise HTTPException(status_code=404, detail="Panel not found")
    widgets = db.many("SELECT * FROM panel_widgets WHERE panel_id=? ORDER BY created_at", [panel_id])
    out_widgets = []
    for w in widgets:
        rows = []
        if w.get("query_sql") and w.get("dataset_id"):
            if not user or can_read_dataset(user, w["dataset_id"]):
                try:
                    result = sql_guard.run_sql(w["query_sql"], trace_id or db.new_id("trace_panel"), dataset_id=w["dataset_id"], user=user)
                    rows = result["rows"]
                except Exception as exc:
                    rows = [{"error": str(exc)}]
        try:
            chart_spec = json.loads(w.get("chart_spec") or "{}")
        except Exception:
            chart_spec = {}
        try:
            position = json.loads(w.get("position_json") or "{}")
        except Exception:
            position = {}
        item = dict(w)
        item["chart_spec"] = chart_spec
        item["position_json"] = position
        item["rows"] = rows
        out_widgets.append(item)
    try:
        panel["layout_json"] = json.loads(panel.get("layout_json") or "{}")
    except Exception:
        pass
    if trace_id:
        trace_service.add_step(trace_id, "panel", "materialize_panel", {"panel_id": panel_id}, {"widget_count": len(out_widgets)})
    panel["widgets"] = out_widgets
    return panel
