from __future__ import annotations

import hmac
import json
import os
import platform
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, Cookie, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse

from .. import db
from ..config import get_settings

router = APIRouter(tags=["hf-space"])
_started_at = time.time()


OPS_COOKIE_NAME = "dap_ops_token"
OPS_METRIC_TABLES = [
    "agents",
    "sessions",
    "tasks",
    "traces",
    "reports",
    "eval_sets",
    "feedback",
    "audit_logs",
    "sql_runs",
    "rate_limit_events",
    "platform_metadata",
    "platform_operation_runs",
]


def _request_is_https(request: Request) -> bool:
    forwarded_proto = request.headers.get("X-Forwarded-Proto", "").split(",", 1)[0].strip().lower()
    return request.url.scheme == "https" or forwarded_proto == "https"


def _bearer_token(authorization: str | None) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    return ""


def _check_ops_token(x_ops_token: str | None, token_query: str | None, token_cookie: str | None = None, authorization: str | None = None) -> None:
    settings = get_settings()
    expected = settings.ops_token
    if not expected:
        if settings.hf_space or settings.is_production:
            raise HTTPException(status_code=503, detail="ops token is not configured")
        return
    provided = x_ops_token or token_query or token_cookie or _bearer_token(authorization)
    if not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="invalid ops token")


def _disk(path: Path) -> dict:
    try:
        usage = shutil.disk_usage(path)
        return {
            "path": str(path),
            "total_mb": round(usage.total / 1024 / 1024, 2),
            "used_mb": round(usage.used / 1024 / 1024, 2),
            "free_mb": round(usage.free / 1024 / 1024, 2),
        }
    except Exception as exc:
        return {"path": str(path), "error": str(exc)}


def _path_summary(path: Path) -> dict:
    try:
        resolved = path.resolve(strict=False)
        summary = {"path": str(path), "resolved": str(resolved), "exists": path.exists()}
        if path.exists():
            stat = path.stat()
            summary.update({"is_dir": path.is_dir(), "is_file": path.is_file(), "size_bytes": stat.st_size})
        return summary
    except Exception as exc:
        return {"path": str(path), "error": str(exc)}


def _count_table(con, table: str) -> int:
    if table not in OPS_METRIC_TABLES:
        raise ValueError(f"unsupported table: {table}")
    return int(con.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()["c"])


def _json_object(text: str | None) -> dict:
    try:
        loaded = json.loads(text or "{}")
        return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


def _ops_persistence_payload() -> dict:
    settings = get_settings()
    with db.connect_readonly() as con:
        platform_db = con.execute("PRAGMA database_list").fetchall()
        platform_integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        platform_user_version = con.execute("PRAGMA user_version").fetchone()[0]
        platform_journal_mode = con.execute("PRAGMA journal_mode").fetchone()[0]
        platform_page_count = con.execute("PRAGMA page_count").fetchone()[0]
        platform_page_size = con.execute("PRAGMA page_size").fetchone()[0]
        platform_metadata = {
            row["key"]: {"value": row["value"], "updated_at": row["updated_at"]}
            for row in con.execute("SELECT key,value,updated_at FROM platform_metadata ORDER BY key").fetchall()
        }
        counts = {table: _count_table(con, table) for table in OPS_METRIC_TABLES}
        operation_status_counts = {
            row["status"]: row["c"]
            for row in con.execute("SELECT status, COUNT(*) AS c FROM platform_operation_runs GROUP BY status").fetchall()
        }
        recent_sqlite_operations = []
        for row in con.execute(
            """
            SELECT id,operation,status,started_at,finished_at,duration_ms,detail_json
            FROM platform_operation_runs
            ORDER BY started_at DESC
            LIMIT 10
            """
        ).fetchall():
            item = dict(row)
            item["detail"] = _json_object(item.pop("detail_json", "{}"))
            recent_sqlite_operations.append(item)
        last_successful_sqlite_operation = con.execute(
            """
            SELECT id,operation,status,started_at,finished_at,duration_ms,detail_json
            FROM platform_operation_runs
            WHERE status='ok'
            ORDER BY started_at DESC
            LIMIT 1
            """
        ).fetchone()
    business_integrity = "not_checked"
    business_user_version = None
    business_journal_mode = None
    business_page_count = None
    business_page_size = None
    if settings.business_db_path.exists():
        try:
            with db.connect_readonly(settings.business_db_path) as con:
                business_integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
                business_user_version = con.execute("PRAGMA user_version").fetchone()[0]
                business_journal_mode = con.execute("PRAGMA journal_mode").fetchone()[0]
                business_page_count = con.execute("PRAGMA page_count").fetchone()[0]
                business_page_size = con.execute("PRAGMA page_size").fetchone()[0]
        except Exception as exc:
            business_integrity = f"error: {exc}"
    backup_freshness = db.get_sqlite_backup_freshness(settings.sqlite_backup_max_age_hours)
    storage_status = db.get_sqlite_storage_status(settings.sqlite_min_free_mb)
    reference_status = db.get_sqlite_reference_status()
    return {
        "ok": platform_integrity == "ok" and business_integrity in {"ok", "not_checked"} and reference_status["ok"],
        "schema": {
            "expected_platform_schema_version": db.SCHEMA_VERSION,
            "platform_user_version": platform_user_version,
            "platform_metadata": platform_metadata,
        },
        "data_dir": _path_summary(settings.data_dir),
        "codex_task_dir": _path_summary(settings.codex_task_dir),
        "platform_db": {
            "path": str(settings.db_path),
            "summary": _path_summary(settings.db_path),
            "integrity_check": platform_integrity,
            "journal_mode": platform_journal_mode,
            "page_count": platform_page_count,
            "page_size": platform_page_size,
            "estimated_size_bytes": platform_page_count * platform_page_size,
            "attached": [dict(row) for row in platform_db],
        },
        "business_db": {
            "path": str(settings.business_db_path),
            "summary": _path_summary(settings.business_db_path),
            "integrity_check": business_integrity,
            "user_version": business_user_version,
            "journal_mode": business_journal_mode,
            "page_count": business_page_count,
            "page_size": business_page_size,
            "estimated_size_bytes": business_page_count * business_page_size if business_page_count and business_page_size else None,
        },
        "table_counts": counts,
        "sqlite_operation_summary": {
            "status_counts": operation_status_counts,
            "stale_or_failed_count": operation_status_counts.get("stale", 0) + operation_status_counts.get("failed", 0),
            "last_successful_operation": (
                {
                    **{key: last_successful_sqlite_operation[key] for key in last_successful_sqlite_operation.keys() if key != "detail_json"},
                    "detail": _json_object(last_successful_sqlite_operation["detail_json"]),
                }
                if last_successful_sqlite_operation
                else None
            ),
        },
        "sqlite_backup_freshness": backup_freshness,
        "sqlite_storage": storage_status,
        "sqlite_references": reference_status,
        "sqlite_locks": db.get_sqlite_lock_status(),
        "recent_sqlite_operations": recent_sqlite_operations,
    }


def _ops_errors_payload() -> dict:
    warnings = get_settings().validate_for_runtime()
    with db.connect_readonly() as con:
        recent_failed_traces = db.dict_rows(
            con.execute("SELECT id, agent_id, status, duration_ms, request_id, created_at FROM traces WHERE status!='success' ORDER BY created_at DESC LIMIT 20")
        )
        recent_audit_events = db.dict_rows(
            con.execute("SELECT id, user_id, action, object_type, object_id, request_id, ip, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 20")
        )
    return {
        "ok": not warnings and not recent_failed_traces,
        "runtime_warnings": warnings,
        "recent_failed_traces": recent_failed_traces,
        "recent_audit_events": recent_audit_events,
    }


def _metric_name(name: str) -> str:
    return "dap_" + "".join(ch if ch.isalnum() else "_" for ch in name.lower()).strip("_")


def _ops_metrics_text() -> str:
    health = _ops_health_payload()
    persistence = _ops_persistence_payload()
    errors = _ops_errors_payload()
    counts = persistence["table_counts"]
    operation_summary = persistence["sqlite_operation_summary"]
    lines = [
        "# HELP dap_ops_up Whether the Data Agent ops surface is running.",
        "# TYPE dap_ops_up gauge",
        "dap_ops_up 1",
        "# HELP dap_ops_uptime_seconds Ops surface uptime in seconds.",
        "# TYPE dap_ops_uptime_seconds gauge",
        f"dap_ops_uptime_seconds {health['uptime_seconds']}",
        "# HELP dap_ops_db_ok Whether platform persistence integrity checks pass.",
        "# TYPE dap_ops_db_ok gauge",
        f"dap_ops_db_ok {1 if persistence['ok'] else 0}",
        "# HELP dap_ops_runtime_warnings Runtime warning count.",
        "# TYPE dap_ops_runtime_warnings gauge",
        f"dap_ops_runtime_warnings {len(errors['runtime_warnings'])}",
        "# HELP dap_ops_recent_failed_traces Recent failed trace count returned by ops errors.",
        "# TYPE dap_ops_recent_failed_traces gauge",
        f"dap_ops_recent_failed_traces {len(errors['recent_failed_traces'])}",
        "# HELP dap_sqlite_operation_stale_or_failed SQLite operation runs with stale or failed status.",
        "# TYPE dap_sqlite_operation_stale_or_failed gauge",
        f"dap_sqlite_operation_stale_or_failed {operation_summary['stale_or_failed_count']}",
        "# HELP dap_sqlite_operation_runs SQLite operation run counts by status.",
        "# TYPE dap_sqlite_operation_runs gauge",
    ]
    for status, count in sorted(operation_summary["status_counts"].items()):
        lines.append(f'dap_sqlite_operation_runs{{status="{status}"}} {count}')
    backup_freshness = persistence["sqlite_backup_freshness"]
    backup_age = backup_freshness["age_hours"] if backup_freshness["age_hours"] is not None else -1
    lines.extend([
        "# HELP dap_sqlite_backup_fresh Whether a successful SQLite backup is within the configured max age.",
        "# TYPE dap_sqlite_backup_fresh gauge",
        f"dap_sqlite_backup_fresh {1 if backup_freshness['ok'] else 0}",
        "# HELP dap_sqlite_backup_age_hours Age of the latest successful SQLite backup in hours, or -1 when missing.",
        "# TYPE dap_sqlite_backup_age_hours gauge",
        f"dap_sqlite_backup_age_hours {backup_age}",
    ])
    sqlite_storage = persistence["sqlite_storage"]
    storage_free_percent = sqlite_storage["free_percent"] if sqlite_storage.get("free_percent") is not None else -1
    sqlite_references = persistence["sqlite_references"]
    lines.extend([
        "# HELP dap_sqlite_storage_ok Whether SQLite data dir free space meets the configured threshold.",
        "# TYPE dap_sqlite_storage_ok gauge",
        f"dap_sqlite_storage_ok {1 if sqlite_storage['ok'] else 0}",
        "# HELP dap_sqlite_storage_free_mb Free space available to the SQLite data directory.",
        "# TYPE dap_sqlite_storage_free_mb gauge",
        f"dap_sqlite_storage_free_mb {sqlite_storage.get('free_mb', -1)}",
        "# HELP dap_sqlite_storage_free_percent Free space percentage available to the SQLite data directory.",
        "# TYPE dap_sqlite_storage_free_percent gauge",
        f"dap_sqlite_storage_free_percent {storage_free_percent}",
        "# HELP dap_sqlite_storage_min_free_mb Configured minimum free space threshold for the SQLite data directory.",
        "# TYPE dap_sqlite_storage_min_free_mb gauge",
        f"dap_sqlite_storage_min_free_mb {sqlite_storage.get('min_free_mb', 0)}",
        "# HELP dap_sqlite_reference_ok Whether application-level SQLite references are consistent.",
        "# TYPE dap_sqlite_reference_ok gauge",
        f"dap_sqlite_reference_ok {1 if sqlite_references['ok'] else 0}",
        "# HELP dap_sqlite_reference_issues Application-level SQLite reference issue count.",
        "# TYPE dap_sqlite_reference_issues gauge",
        f"dap_sqlite_reference_issues {sqlite_references.get('issue_count', 0)}",
    ])
    lines.extend([
        "# HELP dap_platform_table_rows Row counts for key platform tables.",
        "# TYPE dap_platform_table_rows gauge",
    ])
    for table, count in counts.items():
        lines.append(f'{_metric_name("platform_table_rows")}{{table="{table}"}} {count}')
    return "\n".join(lines) + "\n"


def _ops_dashboard_html() -> str:
    return """
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Data Agent Ops</title>
  <style>
    :root{--bg:#f7f7f4;--panel:#fff;--text:#171717;--muted:#6b6b62;--line:#e6e3dc;--dark:#111827;--green:#0d7a5f;--amber:#92660e;--red:#9f1d1d}
    *{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",Arial,sans-serif;background:var(--bg);color:var(--text);letter-spacing:0}
    main{width:min(1180px,calc(100vw - 32px));margin:0 auto;padding:26px 0 40px}.top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px}
    .eyebrow{font-size:12px;font-weight:900;color:var(--green);text-transform:uppercase}.top h1{font-size:34px;margin:4px 0 6px}.top p{margin:0;color:var(--muted);line-height:1.6;max-width:720px}
    button,a.button{display:inline-flex;align-items:center;justify-content:center;min-height:38px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text);font-weight:800;text-decoration:none;padding:8px 12px;cursor:pointer}
    .primary{background:var(--dark);color:#fff;border-color:var(--dark)}.toolbar{display:flex;gap:8px;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.split{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr);gap:12px;margin-top:12px}
    .card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px;box-shadow:0 8px 22px rgba(23,23,23,.05);min-width:0}.card h2,.card h3{margin:0 0 8px}.muted{color:var(--muted);font-size:13px;line-height:1.5}
    .metric{font-size:28px;font-weight:900}.tag{display:inline-flex;align-items:center;min-height:24px;border-radius:999px;background:#f1f0eb;color:#3d3a34;font-size:12px;font-weight:800;padding:4px 9px;margin:0 6px 6px 0}.tag.green{background:#e8f6ef;color:var(--green)}.tag.amber{background:#fff4d8;color:var(--amber)}.tag.red{background:#ffe9e9;color:var(--red)}
    pre{margin:0;max-height:420px;overflow:auto;background:#111827;color:#dbeafe;border-radius:8px;padding:12px;font-size:12px;line-height:1.55}.endpoint-list{display:grid;gap:8px}.endpoint-list a{color:#1746a2;text-decoration:none;font-weight:800}.row{display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding:9px 0}.row:first-child{border-top:0}.status{font-weight:900}.status.ok{color:var(--green)}.status.warn{color:var(--amber)}.status.err{color:var(--red)}
    @media(max-width:860px){.top,.split{display:block}.toolbar{margin-top:12px}.grid{grid-template-columns:1fr 1fr}}@media(max-width:560px){.grid{grid-template-columns:1fr}.top h1{font-size:27px}}
  </style>
</head>
<body>
<main>
  <div class="top">
    <div>
      <div class="eyebrow" data-i18n="eyebrow">READ-ONLY OPS</div>
      <h1 data-i18n="title">Data Agent Ops 控制面</h1>
      <p data-i18n="subtitle">只读诊断入口，聚合健康、运行配置摘要、持久化、错误和指标；管理类动作保留在 Admin 控制面。</p>
    </div>
    <div class="toolbar">
      <button type="button" onclick="setLocale('zh')">中文</button>
      <button type="button" onclick="setLocale('en')">English</button>
      <a class="button primary" href="/" data-i18n="appLink">进入平台</a>
    </div>
  </div>
  <section class="grid" id="metrics"></section>
  <section class="split">
    <div class="card">
      <h2 data-i18n="snapshot">诊断快照</h2>
      <pre id="snapshot">loading...</pre>
    </div>
    <div class="card">
      <h2 data-i18n="endpoints">只读 Endpoint</h2>
      <div class="endpoint-list">
        <a href="/_ops/healthz">/_ops/healthz</a>
        <a href="/_ops/health">/_ops/health</a>
        <a href="/_ops/system">/_ops/system</a>
        <a href="/_ops/config">/_ops/config</a>
        <a href="/_ops/persistence">/_ops/persistence</a>
        <a href="/_ops/errors">/_ops/errors</a>
        <a href="/_ops/metrics">/_ops/metrics</a>
        <a href="/_ops/version">/_ops/version</a>
      </div>
    </div>
  </section>
</main>
<script>
const copy={
  zh:{eyebrow:"READ-ONLY OPS",title:"Data Agent Ops 控制面",subtitle:"只读诊断入口，聚合健康、运行配置摘要、持久化、错误和指标；管理类动作保留在 Admin 控制面。",appLink:"进入平台",snapshot:"诊断快照",endpoints:"只读 Endpoint",status:"状态",uptime:"运行秒数",db:"持久化",warnings:"运行告警"},
  en:{eyebrow:"READ-ONLY OPS",title:"Data Agent Ops Console",subtitle:"Read-only diagnostics for health, runtime config, persistence, errors, and metrics. Admin actions stay in the Admin console.",appLink:"Open App",snapshot:"Diagnostic Snapshot",endpoints:"Read-only Endpoints",status:"Status",uptime:"Uptime Seconds",db:"Persistence",warnings:"Runtime Warnings"}
};
let locale=localStorage.getItem("dap_ops_locale") || (((navigator.language||"").toLowerCase().startsWith("zh"))?"zh":"en");
function t(key){return (copy[locale]&&copy[locale][key])||copy.zh[key]||key}
function setLocale(next){locale=next;localStorage.setItem("dap_ops_locale",locale);renderCopy();render();}
function renderCopy(){document.querySelectorAll("[data-i18n]").forEach(el=>{el.textContent=t(el.dataset.i18n);});document.documentElement.lang=locale==="zh"?"zh-CN":"en";}
async function getJson(path){const r=await fetch(path,{credentials:"same-origin"});if(!r.ok)throw new Error(path+" "+r.status);return r.json();}
function card(label,value,note,cls){return `<div class="card"><div class="muted">${label}</div><div class="metric">${value}</div><div class="tag ${cls||""}">${note}</div></div>`}
async function render(){
  renderCopy();
  const metrics=document.getElementById("metrics");
  const snapshot=document.getElementById("snapshot");
  try{
    const [health,persistence,errors,version]=await Promise.all([getJson("/_ops/healthz"),getJson("/_ops/persistence"),getJson("/_ops/errors"),getJson("/_ops/version")]);
    metrics.innerHTML=[
      card(t("status"),health.status||"unknown",version.version||"-",health.status==="ok"?"green":"red"),
      card(t("uptime"),health.uptime_seconds||0,health.hf_space?"HF Space":"local","green"),
      card(t("db"),persistence.ok?"OK":"CHECK",persistence.platform_db?.summary?.exists?"db exists":"db missing",persistence.ok?"green":"amber"),
      card(t("warnings"),(errors.runtime_warnings||[]).length,(errors.recent_failed_traces||[]).length+" failed traces",(errors.runtime_warnings||[]).length?"amber":"green")
    ].join("");
    snapshot.textContent=JSON.stringify({health,persistence,errors,version},null,2);
  }catch(err){
    metrics.innerHTML=card(t("status"),"LOCKED",String(err.message||err),"red");
    snapshot.textContent=String(err.stack||err);
  }
}
render();
</script>
</body>
</html>
"""


@router.get("/nginx-health", response_class=PlainTextResponse, include_in_schema=False)
def nginx_health():
    # Compatibility endpoint for HF deployment smoke scripts inspired by Dify-all-in-one-HFS.
    return "ok"


@router.get("/healthz", include_in_schema=False)
def healthz():
    settings = get_settings()
    with db.connect_readonly() as con:
        con.execute("SELECT 1 AS ok").fetchone()
    return {"status": "ok", "version": settings.app_version, "hf_space": settings.hf_space}


@router.get("/_ops/", response_class=HTMLResponse, include_in_schema=False)
def ops_home(
    request: Request,
    token: str | None = Query(default=None),
    x_ops_token: str | None = Header(default=None, alias="X-Ops-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    ops_cookie: str | None = Cookie(default=None, alias=OPS_COOKIE_NAME),
):
    _check_ops_token(x_ops_token, token, ops_cookie, authorization)
    if token:
        response = RedirectResponse(url="/_ops/", status_code=303)
        response.set_cookie(
            OPS_COOKIE_NAME,
            token,
            httponly=True,
            secure=_request_is_https(request),
            samesite="lax",
            max_age=3600,
        )
        return response
    return _ops_dashboard_html()


def _ops_health_payload() -> dict:
    settings = get_settings()
    with db.connect_readonly() as con:
        db_ok = dict(con.execute("SELECT 1 AS ok").fetchone())
    return {
        "status": "ok",
        "db": db_ok,
        "version": settings.app_version,
        "uptime_seconds": int(time.time() - _started_at),
        "hf_space": settings.hf_space,
        "space_host": settings.space_host,
        "space_id": settings.space_id,
        "data_dir": str(settings.data_dir),
    }


@router.get("/_ops/healthz", include_in_schema=False)
def ops_healthz(
    token: str | None = Query(default=None),
    x_ops_token: str | None = Header(default=None, alias="X-Ops-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    ops_cookie: str | None = Cookie(default=None, alias=OPS_COOKIE_NAME),
):
    _check_ops_token(x_ops_token, token, ops_cookie, authorization)
    return _ops_health_payload()


@router.get("/_ops/health", include_in_schema=False)
def ops_health(
    token: str | None = Query(default=None),
    x_ops_token: str | None = Header(default=None, alias="X-Ops-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    ops_cookie: str | None = Cookie(default=None, alias=OPS_COOKIE_NAME),
):
    _check_ops_token(x_ops_token, token, ops_cookie, authorization)
    return _ops_health_payload()


@router.get("/_ops/status", include_in_schema=False)
def ops_status(
    token: str | None = Query(default=None),
    x_ops_token: str | None = Header(default=None, alias="X-Ops-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    ops_cookie: str | None = Cookie(default=None, alias=OPS_COOKIE_NAME),
):
    _check_ops_token(x_ops_token, token, ops_cookie, authorization)
    return _ops_health_payload()


@router.get("/_ops/system", include_in_schema=False)
def ops_system(
    token: str | None = Query(default=None),
    x_ops_token: str | None = Header(default=None, alias="X-Ops-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    ops_cookie: str | None = Cookie(default=None, alias=OPS_COOKIE_NAME),
):
    _check_ops_token(x_ops_token, token, ops_cookie, authorization)
    settings = get_settings()
    return {
        "platform": platform.platform(),
        "python": platform.python_version(),
        "pid": os.getpid(),
        "cwd": os.getcwd(),
        "uptime_seconds": int(time.time() - _started_at),
        "disks": [_disk(settings.data_dir), _disk(Path("/tmp")), _disk(Path("/data")), _disk(Path("/persist"))],
    }


@router.get("/_ops/config", include_in_schema=False)
def ops_config(
    token: str | None = Query(default=None),
    x_ops_token: str | None = Header(default=None, alias="X-Ops-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    ops_cookie: str | None = Cookie(default=None, alias=OPS_COOKIE_NAME),
):
    _check_ops_token(x_ops_token, token, ops_cookie, authorization)
    settings = get_settings()
    payload = settings.redacted()
    payload["ops_token_configured"] = bool(settings.ops_token)
    payload["env_presence"] = {k: bool(os.getenv(k)) for k in ["SPACE_ID", "SPACE_HOST", "DAP_SECRET_KEY", "OPS_TOKEN", "DAP_DATA_DIR", "DAP_PERSIST_DIR"]}
    return payload


@router.get("/_ops/persistence", include_in_schema=False)
def ops_persistence(
    token: str | None = Query(default=None),
    x_ops_token: str | None = Header(default=None, alias="X-Ops-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    ops_cookie: str | None = Cookie(default=None, alias=OPS_COOKIE_NAME),
):
    _check_ops_token(x_ops_token, token, ops_cookie, authorization)
    return _ops_persistence_payload()


@router.get("/_ops/errors", include_in_schema=False)
def ops_errors(
    token: str | None = Query(default=None),
    x_ops_token: str | None = Header(default=None, alias="X-Ops-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    ops_cookie: str | None = Cookie(default=None, alias=OPS_COOKIE_NAME),
):
    _check_ops_token(x_ops_token, token, ops_cookie, authorization)
    return _ops_errors_payload()


@router.get("/_ops/metrics", response_class=PlainTextResponse, include_in_schema=False)
def ops_metrics(
    token: str | None = Query(default=None),
    x_ops_token: str | None = Header(default=None, alias="X-Ops-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    ops_cookie: str | None = Cookie(default=None, alias=OPS_COOKIE_NAME),
):
    _check_ops_token(x_ops_token, token, ops_cookie, authorization)
    return _ops_metrics_text()


@router.get("/_ops/version", include_in_schema=False)
def ops_version(
    token: str | None = Query(default=None),
    x_ops_token: str | None = Header(default=None, alias="X-Ops-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    ops_cookie: str | None = Cookie(default=None, alias=OPS_COOKIE_NAME),
):
    _check_ops_token(x_ops_token, token, ops_cookie, authorization)
    settings = get_settings()
    return {"name": settings.app_name, "version": settings.app_version, "env": settings.app_env, "hf_space": settings.hf_space}
