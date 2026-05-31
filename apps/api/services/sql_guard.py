from __future__ import annotations

import json
import re
import sqlite3
import time
from typing import Any

from fastapi import HTTPException

from .. import db
from ..config import get_settings
from ..security import dataset_policy_for_user
from . import trace_service

settings = get_settings()
FORBIDDEN = re.compile(r"\b(insert|update|delete|drop|alter|create|truncate|replace|attach|detach|pragma|vacuum|reindex|load_extension)\b", re.I)
DANGEROUS_COMMENTS = re.compile(r"(--|/\*|\*/)")
TABLE_PATTERN = re.compile(r"\b(?:from|join)\s+([a-zA-Z_][\w.]*)", re.I)
CLAUSE_PATTERN = re.compile(r"\b(group\s+by|order\s+by|limit)\b", re.I)


def validate_readonly_sql(sql: str) -> str:
    sql_clean = sql.strip().rstrip(";")
    if not sql_clean.lower().startswith("select"):
        raise HTTPException(status_code=400, detail="SQL Guard: only SELECT statements are allowed")
    if DANGEROUS_COMMENTS.search(sql_clean):
        raise HTTPException(status_code=400, detail="SQL Guard: SQL comments are not allowed")
    if FORBIDDEN.search(sql_clean):
        raise HTTPException(status_code=400, detail="SQL Guard: forbidden keyword detected")
    if ";" in sql_clean:
        raise HTTPException(status_code=400, detail="SQL Guard: multiple statements are not allowed")
    return sql_clean


def extract_tables(sql: str) -> set[str]:
    return {m.group(1).split(".")[-1] for m in TABLE_PATTERN.finditer(sql)}


def enforce_limit(sql: str, max_rows: int | None = None) -> str:
    """Always cap rows, even when the user supplied a larger LIMIT.

    The previous implementation trusted an existing LIMIT clause, which allowed
    a caller to bypass the platform-level max row policy by writing
    `LIMIT 100000`. Wrapping keeps the original query semantics and applies the
    final cap consistently.
    """
    max_rows = min(int(max_rows or settings.sql_max_rows), int(settings.sql_max_rows))
    return f"SELECT * FROM ({sql}) AS dap_limited LIMIT {max_rows}"


def _inject_row_filter(sql: str, row_filter: str | None) -> str:
    if not row_filter:
        return sql
    match = CLAUSE_PATTERN.search(sql)
    head = sql[:match.start()] if match else sql
    tail = sql[match.start():] if match else ""
    if re.search(r"\bwhere\b", head, re.I):
        return f"{head} AND ({row_filter}) {tail}".strip()
    return f"{head} WHERE ({row_filter}) {tail}".strip()


def _mask_rows(rows: list[dict[str, Any]], masked_fields: list[str]) -> list[dict[str, Any]]:
    if not masked_fields:
        return rows
    masked = set(masked_fields)
    out: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        for f in masked:
            if f in item:
                item[f] = "***MASKED***"
        out.append(item)
    return out


def _sensitive_fields(dataset_id: str | None) -> list[str]:
    if not dataset_id:
        return []
    rows = db.many("SELECT field_name FROM dataset_fields WHERE dataset_id=? AND is_sensitive=1", [dataset_id])
    return [r["field_name"] for r in rows]


def run_sql(sql: str, trace_id: str, dataset_id: str | None = None, max_rows: int | None = None, user: dict | None = None) -> dict[str, Any]:
    start = time.time()
    policy = None
    if dataset_id and user:
        policy = dataset_policy_for_user(user, dataset_id)
        if not policy:
            trace_service.add_step(trace_id, "permission", "dataset_permission_denied", {"dataset_id": dataset_id}, {"allowed": False}, status="failed")
            raise HTTPException(status_code=403, detail="No permission to read dataset")
        trace_service.add_step(trace_id, "permission", "dataset_permission_check", {"dataset_id": dataset_id}, {"allowed": True, "masked_fields": policy.get("masked_fields", []), "row_filter": policy.get("row_filter")})

    guarded = validate_readonly_sql(sql)
    if dataset_id:
        dataset = db.one("SELECT * FROM datasets WHERE id=?", [dataset_id])
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        tables = extract_tables(guarded)
        expected = dataset["physical_table"]
        # The query must only reference the physical table declared by the
        # selected dataset. Previously the check only required the expected
        # table to appear somewhere in the SQL, which allowed joins/unions to
        # unauthorized tables.
        unauthorized_tables = sorted(t for t in tables if t != expected)
        if not tables or unauthorized_tables:
            trace_service.add_step(trace_id, "sql_guard", "table_scope_check", {"sql_tables": sorted(tables), "expected_table": expected, "unauthorized_tables": unauthorized_tables}, {"allowed": False}, status="failed")
            raise HTTPException(status_code=400, detail="SQL Guard: SQL references table outside selected dataset")
        trace_service.add_step(trace_id, "sql_guard", "table_scope_check", {"sql_tables": sorted(tables), "expected_table": expected}, {"allowed": True})

    guarded = _inject_row_filter(guarded, policy.get("row_filter") if policy else None)
    guarded = enforce_limit(guarded, max_rows=max_rows)
    timeout_seconds = max(0.1, settings.sql_timeout_ms / 1000)

    try:
        with db.connect_readonly(db.BUSINESS_DB_PATH) as con:
            deadline = time.time() + timeout_seconds
            def _progress_handler():
                return 1 if time.time() > deadline else 0
            con.set_progress_handler(_progress_handler, 1000)
            cur = con.execute(guarded)
            raw_rows = [dict(r) for r in cur.fetchall()]
            columns = list(raw_rows[0].keys()) if raw_rows else [d[0] for d in cur.description or []]
            mask_set = set(_sensitive_fields(dataset_id))
            if policy:
                mask_set.update(policy.get("masked_fields") or [])
            rows = _mask_rows(raw_rows, sorted(mask_set))
        duration = int((time.time() - start) * 1000)
        db.insert("sql_runs", {
            "id": db.new_id("sql"),
            "trace_id": trace_id,
            "dataset_id": dataset_id,
            "sql_text": guarded,
            "status": "success",
            "row_count": len(rows),
            "duration_ms": duration,
            "error_message": "",
        })
        trace_service.add_step(trace_id, "sql_execution", "readonly_sql_executor", {"sql": guarded}, {"row_count": len(rows), "duration_ms": duration})
        return {"sql": guarded, "columns": columns, "rows": rows, "row_count": len(rows), "duration_ms": duration}
    except sqlite3.Error as exc:
        duration = int((time.time() - start) * 1000)
        error_message = "SQL execution timed out" if "interrupted" in str(exc).lower() else str(exc)
        db.insert("sql_runs", {
            "id": db.new_id("sql"),
            "trace_id": trace_id,
            "dataset_id": dataset_id,
            "sql_text": guarded,
            "status": "failed",
            "row_count": 0,
            "duration_ms": duration,
            "error_message": error_message,
        })
        trace_service.add_step(trace_id, "sql_execution", "readonly_sql_executor", {"sql": guarded}, {"error": error_message}, status="failed", duration_ms=duration)
        raise HTTPException(status_code=400, detail=f"SQL execution failed: {error_message}")
