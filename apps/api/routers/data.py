from __future__ import annotations

import csv
import io
import json
import re
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from .. import db
from ..schemas import DataQueryRequest, PanelCreate, PanelWidgetCreate, QualityRunRequest
from ..security import audit, can_read_dataset, get_current_user, require_permission
from ..services import data_capabilities, sql_guard, trace_service

router = APIRouter(prefix="/api/data", tags=["data"])

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_MAX_CSV_BYTES = 5 * 1024 * 1024
_MAX_CSV_ROWS = 10000
_MAX_CSV_COLUMNS = 200


def _safe_identifier(raw: str, fallback: str) -> str:
    """Return a safe SQLite identifier generated from untrusted user input."""
    raw_text = (raw or "").strip()
    if re.search(r"(;|--|/\*|\*/|\b(drop|delete|insert|update|alter|create|attach|pragma)\b)", raw_text, re.I):
        return fallback
    cleaned = re.sub(r"\W+", "_", raw_text, flags=re.UNICODE)
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    if not cleaned or cleaned[0].isdigit():
        cleaned = fallback
    # SQLite identifiers are ASCII in this demo importer to simplify SQL safety.
    cleaned = "".join(ch if (ch.isalnum() or ch == "_") and ord(ch) < 128 else "_" for ch in cleaned)
    cleaned = re.sub(r"_+", "_", cleaned).strip("_") or fallback
    if not _IDENTIFIER.match(cleaned):
        cleaned = fallback
    return cleaned[:64]


def _quote_identifier(identifier: str) -> str:
    if not _IDENTIFIER.match(identifier):
        raise HTTPException(status_code=400, detail=f"Unsafe SQL identifier: {identifier}")
    return f'"{identifier}"'


def _deduplicate_columns(headers: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out: list[str] = []
    for idx, header in enumerate(headers, start=1):
        base = _safe_identifier(header, f"col_{idx}")
        count = seen.get(base, 0)
        seen[base] = count + 1
        out.append(base if count == 0 else f"{base}_{count + 1}")
    return out


def _sqlite_value(value: Any) -> Any:
    return json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value


def _insert_with_connection(con, table: str, payload: dict[str, Any]) -> None:
    keys = list(payload.keys())
    placeholders = ",".join(["?"] * len(keys))
    values = [_sqlite_value(value) for value in payload.values()]
    con.execute(f"INSERT INTO {table} ({','.join(keys)}) VALUES ({placeholders})", values)


def _update_with_connection(con, table: str, key: str, value: str, payload: dict[str, Any]) -> None:
    pairs = ",".join([f"{column}=?" for column in payload.keys()])
    values = [_sqlite_value(item) for item in payload.values()]
    values.append(value)
    con.execute(f"UPDATE {table} SET {pairs} WHERE {key}=?", values)


def _drop_business_table(table: str) -> None:
    quoted_table = _quote_identifier(table)
    with db.connect(db.BUSINESS_DB_PATH) as con:
        con.execute(f"DROP TABLE IF EXISTS {quoted_table}")


def _mark_import_job_failed(job_id: str, error_message: str) -> None:
    try:
        db.update(
            "data_import_jobs",
            "id",
            job_id,
            {
                "status": "failed",
                "error_message": error_message[:1000],
                "finished_at": db.now(),
            },
        )
    except Exception:
        return


def _persist_csv_import_metadata(
    *,
    job_id: str,
    dataset_id: str,
    dataset_name: str,
    business_domain: str,
    table: str,
    original_columns: list[str],
    safe_columns: list[str],
    filename: str,
    row_count: int,
    user: dict,
    request: Request | None,
) -> None:
    timestamp = db.now()
    request_id = getattr(request.state, "request_id", "") if request else ""
    ip = request.client.host if request and request.client else ""
    with db.connect() as con:
        _insert_with_connection(
            con,
            "datasets",
            {
                "id": dataset_id,
                "name": dataset_name,
                "business_domain": business_domain,
                "source_id": "ds_business_sqlite",
                "physical_table": table,
                "description": f"Imported from {filename}",
                "refresh_mode": "manual",
                "data_classification": "internal",
                "status": "active",
            },
        )
        for original, safe in zip(original_columns, safe_columns):
            _insert_with_connection(
                con,
                "dataset_fields",
                {
                    "id": db.new_id("field"),
                    "dataset_id": dataset_id,
                    "field_name": safe,
                    "display_name": original or safe,
                    "field_type": "dimension",
                    "semantic_type": "dimension",
                    "description": "CSV imported field",
                    "default_aggregation": "",
                    "is_sensitive": 0,
                    "is_filterable": 1,
                    "is_groupable": 1,
                },
            )
        # Grant the importer read access immediately; admins also pass through RBAC.
        _insert_with_connection(
            con,
            "dataset_permissions",
            {
                "id": db.new_id("dperm"),
                "dataset_id": dataset_id,
                "subject_type": "user",
                "subject_id": user["id"],
                "permission": "read",
                "row_filter": None,
                "masked_fields": [],
            },
        )
        _update_with_connection(
            con,
            "data_import_jobs",
            "id",
            job_id,
            {
                "dataset_id": dataset_id,
                "status": "success",
                "row_count": row_count,
                "error_message": "",
                "finished_at": timestamp,
            },
        )
        _insert_with_connection(
            con,
            "audit_logs",
            {
                "id": db.new_id("audit"),
                "user_id": user.get("id"),
                "action": "import_csv",
                "object_type": "dataset",
                "object_id": dataset_id,
                "detail_json": {"filename": filename, "rows": row_count, "columns": safe_columns},
                "ip": ip,
                "request_id": request_id,
                "created_at": timestamp,
            },
        )


@router.post("/query")
def query_data(payload: DataQueryRequest, request: Request, user: dict = Depends(get_current_user)):
    trace_id = trace_service.create_trace(user["id"], payload.sql, agent_id="data_query_api", request_id=getattr(request.state, "request_id", ""))
    start = db.now()
    try:
        result = sql_guard.run_sql(payload.sql, trace_id, dataset_id=payload.dataset_id, max_rows=payload.max_rows, user=user)
        output = {"trace_id": trace_id, **result}
        trace_service.finish_trace(trace_id, output, "success", result.get("duration_ms", 0))
        audit("data_query", user, "dataset", payload.dataset_id, {"trace_id": trace_id}, request)
        return output
    except HTTPException as exc:
        trace_service.finish_trace(trace_id, {"error": exc.detail}, "failed", 0)
        audit("data_query_failed", user, "dataset", payload.dataset_id, {"trace_id": trace_id, "error": exc.detail}, request)
        raise
    except Exception as exc:
        trace_service.finish_trace(trace_id, {"error": str(exc)}, "failed", 0)
        audit("data_query_failed", user, "dataset", payload.dataset_id, {"trace_id": trace_id, "error": str(exc)}, request)
        raise HTTPException(status_code=500, detail="Data query failed") from exc


@router.get("/profile/{dataset_id}")
def profile(dataset_id: str, request: Request, user: dict = Depends(get_current_user)):
    trace_id = trace_service.create_trace(user["id"], f"profile:{dataset_id}", agent_id="data_profile_api", request_id=getattr(request.state, "request_id", ""))
    try:
        result = data_capabilities.profile_dataset(dataset_id, trace_id=trace_id, user=user)
        result["trace_id"] = trace_id
        trace_service.finish_trace(trace_id, {"dataset_id": dataset_id, "row_count": result.get("row_count"), "field_count": len(result.get("fields") or [])}, "success", 0)
        return result
    except HTTPException as exc:
        trace_service.finish_trace(trace_id, {"error": exc.detail}, "failed", 0)
        raise


@router.get("/quality-rules")
def list_quality_rules(dataset_id: str | None = None, user: dict = Depends(get_current_user)):
    params: list[Any] = []
    where = "WHERE 1=1"
    if dataset_id:
        where += " AND dataset_id=?"
        params.append(dataset_id)
    rows = db.many(f"SELECT * FROM data_quality_rules {where} ORDER BY dataset_id, severity DESC, name", params)
    return [r for r in rows if can_read_dataset(user, r["dataset_id"])]


@router.post("/quality/run")
def run_quality(payload: QualityRunRequest, request: Request, user: dict = Depends(get_current_user)):
    trace_id = trace_service.create_trace(user["id"], "run_data_quality", agent_id="data_quality_api", request_id=getattr(request.state, "request_id", ""))
    try:
        results = data_capabilities.run_quality_rules(payload.dataset_id, trace_id=trace_id, user=user, rule_ids=payload.rule_ids)
        output = {"trace_id": trace_id, "results": results}
        trace_service.finish_trace(trace_id, output, "success", 0)
        audit("run_data_quality", user, "dataset", payload.dataset_id or "all", {"trace_id": trace_id}, request)
        return output
    except HTTPException as exc:
        trace_service.finish_trace(trace_id, {"error": exc.detail}, "failed", 0)
        audit("run_data_quality_failed", user, "dataset", payload.dataset_id or "all", {"trace_id": trace_id, "error": exc.detail}, request)
        raise


@router.get("/quality-results")
def list_quality_results(limit: int = 200, user: dict = Depends(get_current_user)):
    rows = db.many("SELECT r.*, q.name AS rule_name, d.name AS dataset_name FROM data_quality_results r JOIN data_quality_rules q ON q.id=r.rule_id JOIN datasets d ON d.id=r.dataset_id ORDER BY r.created_at DESC LIMIT ?", [limit])
    out = []
    for row in rows:
        if not can_read_dataset(user, row["dataset_id"]):
            continue
        try:
            row["sample_rows"] = json.loads(row.get("sample_rows") or "[]")
        except Exception:
            pass
        out.append(row)
    return out


@router.get("/panels")
def list_panels(user: dict = Depends(get_current_user)):
    return db.many("SELECT * FROM dashboard_panels ORDER BY updated_at DESC")


@router.post("/panels")
def create_panel(payload: PanelCreate, request: Request, user: dict = Depends(require_permission("panel:manage"))):
    pid = db.new_id("panel")
    t = db.now()
    db.insert("dashboard_panels", {"id": pid, "name": payload.name, "business_domain": payload.business_domain, "description": payload.description, "owner_id": user["id"], "layout_json": {"columns": 12}, "status": "draft", "created_at": t, "updated_at": t})
    audit("create_panel", user, "panel", pid, payload.model_dump(), request)
    return db.one("SELECT * FROM dashboard_panels WHERE id=?", [pid])


@router.get("/panels/{panel_id}")
def get_panel(panel_id: str, request: Request, user: dict = Depends(get_current_user)):
    trace_id = trace_service.create_trace(user["id"], f"panel:{panel_id}", agent_id="panel_api", request_id=getattr(request.state, "request_id", ""))
    try:
        panel = data_capabilities.materialize_panel(panel_id, trace_id=trace_id, user=user)
        panel["trace_id"] = trace_id
        trace_service.finish_trace(trace_id, {"panel_id": panel_id, "widget_count": len(panel.get("widgets") or [])}, "success", 0)
        return panel
    except HTTPException as exc:
        trace_service.finish_trace(trace_id, {"error": exc.detail}, "failed", 0)
        raise


@router.post("/panels/{panel_id}/widgets")
def create_widget(panel_id: str, payload: PanelWidgetCreate, request: Request, user: dict = Depends(require_permission("panel:manage"))):
    if panel_id != payload.panel_id:
        raise HTTPException(status_code=400, detail="Panel id mismatch")
    if payload.query_sql and payload.dataset_id:
        # Validate early so a broken widget cannot be persisted silently.
        preview_trace = trace_service.create_trace(user["id"], payload.query_sql, agent_id="panel_widget_validator", request_id=getattr(request.state, "request_id", ""))
        try:
            sql_guard.run_sql(payload.query_sql, preview_trace, dataset_id=payload.dataset_id, max_rows=1, user=user)
            trace_service.finish_trace(preview_trace, {"validation": "ok"}, "success", 0)
        except HTTPException as exc:
            trace_service.finish_trace(preview_trace, {"error": exc.detail}, "failed", 0)
            raise
    wid = db.new_id("widget")
    db.insert("panel_widgets", {"id": wid, "panel_id": payload.panel_id, "widget_type": payload.widget_type, "title": payload.title, "dataset_id": payload.dataset_id, "metric_id": payload.metric_id, "query_sql": payload.query_sql, "chart_spec": payload.chart_spec, "position_json": payload.position_json, "created_at": db.now()})
    db.update("dashboard_panels", "id", panel_id, {"updated_at": db.now()})
    audit("create_panel_widget", user, "panel", panel_id, payload.model_dump(), request)
    return db.one("SELECT * FROM panel_widgets WHERE id=?", [wid])


@router.post("/import/csv")
async def import_csv(dataset_name: str, business_domain: str = "Imported", file: UploadFile = File(...), request: Request = None, user: dict = Depends(require_permission("dataset:manage"))):
    raw = await file.read()
    if len(raw) > _MAX_CSV_BYTES:
        raise HTTPException(status_code=400, detail=f"CSV file too large; max {_MAX_CSV_BYTES} bytes")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded") from exc
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV header is required")
    if len(reader.fieldnames) > _MAX_CSV_COLUMNS:
        raise HTTPException(status_code=400, detail=f"CSV has too many columns; max {_MAX_CSV_COLUMNS}")
    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=400, detail="CSV contains no rows")
    if len(rows) > _MAX_CSV_ROWS:
        raise HTTPException(status_code=400, detail=f"CSV has too many rows; max {_MAX_CSV_ROWS}")

    table = _safe_identifier("import_" + db.new_id("tbl"), "import_table")
    original_cols = list(reader.fieldnames)
    safe_cols = _deduplicate_columns(original_cols)
    quoted_table = _quote_identifier(table)
    quoted_cols = [_quote_identifier(c) for c in safe_cols]
    dsid = db.new_id("dataset")
    job_id = db.new_id("import")
    filename = file.filename or ""
    db.insert(
        "data_import_jobs",
        {
            "id": job_id,
            "source_type": "csv",
            "dataset_id": dsid,
            "filename": filename,
            "status": "pending",
            "row_count": 0,
            "error_message": "",
            "created_by": user["id"],
            "created_at": db.now(),
            "finished_at": None,
        },
    )
    business_table_created = False
    try:
        with db.connect(db.BUSINESS_DB_PATH) as con:
            con.execute(f"CREATE TABLE {quoted_table} ({','.join([c + ' TEXT' for c in quoted_cols])})")
            placeholders = ",".join(["?"] * len(safe_cols))
            con.executemany(
                f"INSERT INTO {quoted_table} ({','.join(quoted_cols)}) VALUES ({placeholders})",
                [[r.get(c, "") for c in original_cols] for r in rows],
            )
        business_table_created = True
        _persist_csv_import_metadata(
            job_id=job_id,
            dataset_id=dsid,
            dataset_name=dataset_name,
            business_domain=business_domain,
            table=table,
            original_columns=original_cols,
            safe_columns=safe_cols,
            filename=filename,
            row_count=len(rows),
            user=user,
            request=request,
        )
    except Exception as exc:
        cleanup_error = ""
        if business_table_created:
            try:
                _drop_business_table(table)
            except Exception as cleanup_exc:
                cleanup_error = f"; cleanup failed: {cleanup_exc}"
        error_message = f"{exc}{cleanup_error}"
        _mark_import_job_failed(job_id, error_message)
        try:
            audit(
                "import_csv_failed",
                user,
                "dataset",
                dsid,
                {"filename": filename, "table": table, "error": error_message[:500]},
                request,
            )
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="CSV import failed") from exc
    return {"job_id": job_id, "dataset_id": dsid, "table": table, "columns": safe_cols, "row_count": len(rows)}
