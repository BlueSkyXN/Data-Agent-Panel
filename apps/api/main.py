from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db
from .config import get_settings
from .errors import http_exception_handler, unhandled_exception_handler, validation_exception_handler
from .middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from .routers import admin, agents, analysis, auth, catalog, chat, codex, data, evals, hf_space, knowledge, reports, semantic, sessions, tasks, traces

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


@app.get("/api/health/live", tags=["health"])
def health_live():
    return {"status": "ok", "version": settings.app_version}


@app.get("/api/health/ready", tags=["health"])
def health_ready():
    db.one("SELECT 1 AS ok")
    warnings = settings.validate_for_runtime()
    return {"status": "ok", "version": settings.app_version, "warnings": warnings}


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
