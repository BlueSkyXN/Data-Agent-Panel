from __future__ import annotations

import json
from typing import Any
from .. import db


def create_trace(user_id: str, input_text: str, agent_id: str | None = None, session_id: str | None = None, task_id: str | None = None, agent_version: str | None = None, request_id: str | None = None) -> str:
    trace_id = db.new_id("trace")
    db.insert("traces", {
        "id": trace_id,
        "session_id": session_id,
        "task_id": task_id,
        "agent_id": agent_id,
        "agent_version": agent_version,
        "user_id": user_id,
        "input": input_text,
        "output": "",
        "status": "running",
        "duration_ms": 0,
        "cost_json": "{}",
        "request_id": request_id,
        "created_at": db.now(),
    })
    return trace_id


def add_step(trace_id: str, step_type: str, name: str, input_json: dict[str, Any] | None = None, output_json: dict[str, Any] | None = None, status: str = "success", duration_ms: int = 0) -> None:
    existing = db.many("SELECT COUNT(*) c FROM trace_steps WHERE trace_id=?", [trace_id])[0]["c"]
    db.insert("trace_steps", {
        "id": db.new_id("step"),
        "trace_id": trace_id,
        "step_no": existing + 1,
        "step_type": step_type,
        "name": name,
        "input_json": json.dumps(input_json or {}, ensure_ascii=False),
        "output_json": json.dumps(output_json or {}, ensure_ascii=False),
        "status": status,
        "duration_ms": duration_ms,
    })


def finish_trace(trace_id: str, output: dict[str, Any], status: str = "success", duration_ms: int = 0, cost_json: dict[str, Any] | None = None) -> None:
    payload = {
        "output": json.dumps(output, ensure_ascii=False),
        "status": status,
        "duration_ms": duration_ms,
    }
    if cost_json is not None:
        payload["cost_json"] = json.dumps(cost_json, ensure_ascii=False)
    db.update("traces", "id", trace_id, payload)


def get_trace(trace_id: str) -> dict[str, Any] | None:
    trace = db.one("SELECT * FROM traces WHERE id=?", [trace_id])
    if not trace:
        return None
    steps = db.many("SELECT * FROM trace_steps WHERE trace_id=? ORDER BY step_no", [trace_id])
    sql_runs = db.many("SELECT * FROM sql_runs WHERE trace_id=?", [trace_id])
    tool_calls = db.many("SELECT * FROM tool_calls WHERE trace_id=?", [trace_id])
    charts = db.many("SELECT * FROM chart_specs WHERE trace_id=?", [trace_id])
    for collection in [steps, sql_runs, tool_calls, charts]:
        for row in collection:
            for k, v in list(row.items()):
                if isinstance(v, str) and v and v[0] in "[{":
                    try:
                        row[k] = json.loads(v)
                    except Exception:
                        pass
    for k in ["output", "cost_json"]:
        if isinstance(trace.get(k), str) and trace.get(k):
            try:
                trace[k] = json.loads(trace[k])
            except Exception:
                pass
    trace["steps"] = steps
    trace["sql_runs"] = sql_runs
    trace["tool_calls"] = tool_calls
    trace["charts"] = charts
    return trace
