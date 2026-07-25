from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db
from .config import get_settings
from .errors import http_exception_handler, unhandled_exception_handler, validation_exception_handler
from .middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from .routers import admin, agents, analysis, auth, catalog, chat, codex, data, evals, hf_space, knowledge, reports, semantic, sessions, tasks, traces, workspaces

settings = get_settings()
ROOT = Path(__file__).resolve().parents[2]
STATIC_DIR = ROOT / "apps" / "web" / "static"

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("data_agent.bootstrap")

app = FastAPI(
    title=settings.app_name,
    description="Agent Gateway + 数据目录 + Trace 证据链 + 权限审计 + 评测运营的一体化平台。",
    version=settings.app_version,
)

app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)

app.add_middleware(RequestContextMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-DAP-Token", "X-Request-ID"],
)


@app.on_event("startup")
def startup():
    db.init_all(reset=False)
    warnings = settings.validate_for_runtime()
    for warning in warnings:
        logger.warning("runtime_warning=%s", warning)


app.include_router(auth.router)
app.include_router(agents.router)
app.include_router(sessions.router)
app.include_router(chat.router)
app.include_router(analysis.router)
app.include_router(tasks.router)
app.include_router(traces.router)
app.include_router(catalog.router)
app.include_router(data.router)
app.include_router(semantic.router)
app.include_router(codex.router)
app.include_router(knowledge.router)
app.include_router(reports.router)
app.include_router(evals.router)
app.include_router(admin.router)
app.include_router(hf_space.router)
app.include_router(workspaces.router)


def _path_ready(path: Path, *, must_exist: bool = True) -> dict:
    exists = path.exists()
    return {
        "path": str(path),
        "exists": exists,
        "is_dir": path.is_dir() if exists else False,
        "writable": os.access(path, os.W_OK) if exists else False,
        "ok": (exists or not must_exist) and (not exists or os.access(path, os.W_OK)),
    }


def _readiness_payload() -> tuple[dict, bool]:
    checks: dict[str, dict] = {}
    warnings = settings.validate_for_runtime()
    data_dir = _path_ready(settings.data_dir)
    codex_task_dir = _path_ready(settings.codex_task_dir)
    checks["data_dir"] = data_dir
    checks["codex_task_dir"] = codex_task_dir

    platform_ok = False
    try:
        with db.connect_readonly() as con:
            platform_user_version = con.execute("PRAGMA user_version").fetchone()[0]
            metadata = {
                row["key"]: row["value"]
                for row in con.execute("SELECT key,value FROM platform_metadata WHERE key IN ('schema_version','app_version')").fetchall()
            }
            admin_count = con.execute(
                """
                SELECT COUNT(*) AS c
                FROM users u
                JOIN user_roles ur ON ur.user_id=u.id
                JOIN roles r ON r.id=ur.role_id
                WHERE r.name='admin' AND u.status='active'
                """
            ).fetchone()["c"]
            platform_ok = platform_user_version == db.SCHEMA_VERSION and metadata.get("schema_version") == str(db.SCHEMA_VERSION) and admin_count > 0
            checks["platform_db"] = {
                "ok": platform_ok,
                "path": str(settings.db_path),
                "user_version": platform_user_version,
                "expected_user_version": db.SCHEMA_VERSION,
                "metadata_schema_version": metadata.get("schema_version"),
                "active_admin_count": admin_count,
            }
    except Exception as exc:
        checks["platform_db"] = {"ok": False, "path": str(settings.db_path), "error": str(exc)}

    business_ok = False
    try:
        with db.connect_readonly(settings.business_db_path) as con:
            table_names = {row["name"] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
            required_tables = {"sales_orders", "support_tickets"}
            missing_tables = sorted(required_tables - table_names)
            sample_rows = con.execute("SELECT COUNT(*) AS c FROM sales_orders").fetchone()["c"] if "sales_orders" in table_names else 0
            business_ok = not missing_tables and sample_rows > 0
            checks["business_db"] = {
                "ok": business_ok,
                "path": str(settings.business_db_path),
                "missing_required_tables": missing_tables,
                "sales_order_count": sample_rows,
            }
    except Exception as exc:
        checks["business_db"] = {"ok": False, "path": str(settings.business_db_path), "error": str(exc)}

    try:
        backup_freshness = db.get_sqlite_backup_freshness()
        checks["sqlite_backup"] = backup_freshness
        if (settings.is_production or settings.hf_space) and backup_freshness["enabled"] and not backup_freshness["ok"]:
            warnings.append(f"SQLite backup freshness is {backup_freshness['status']}; run scripts/sqlite_backup.py and verify the backup.")
    except Exception as exc:
        checks["sqlite_backup"] = {"ok": False, "status": "error", "error": str(exc)}

    storage_status = db.get_sqlite_storage_status()
    checks["sqlite_storage"] = storage_status
    if (settings.is_production or settings.hf_space) and storage_status["enabled"] and not storage_status["ok"]:
        warnings.append(
            f"SQLite data dir free space is {storage_status['status']}; "
            f"free={storage_status.get('free_mb')}MB min={storage_status.get('min_free_mb')}MB."
        )

    try:
        reference_status = db.get_sqlite_reference_status()
    except Exception as exc:
        reference_status = {"ok": False, "status": "error", "issue_count": 1, "error": str(exc), "checks": {}}
    checks["sqlite_references"] = reference_status

    ok = data_dir["ok"] and codex_task_dir["ok"] and platform_ok and business_ok and reference_status["ok"]
    payload = {
        "status": "ok" if ok else "not_ready",
        "version": settings.app_version,
        "warnings": warnings,
        "checks": checks,
    }
    return payload, ok


@app.get("/api/health/live", tags=["health"])
def health_live():
    return {"status": "ok", "version": settings.app_version}


@app.get("/api/health/ready", tags=["health"])
def health_ready():
    payload, ok = _readiness_payload()
    if not ok:
        return JSONResponse(payload, status_code=503)
    return payload


@app.get("/api/health", tags=["health"])
def health():
    return health_ready()


@app.get("/api/version", tags=["health"])
def version():
    return {"name": settings.app_name, "version": settings.app_version, "env": settings.app_env}


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/_admin", include_in_schema=False)
def admin_index_redirect():
    return RedirectResponse(url="/_admin/", status_code=308)


@app.get("/_admin/", include_in_schema=False)
def admin_index():
    return FileResponse(STATIC_DIR / "index.html")
