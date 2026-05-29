from __future__ import annotations

import os
import platform
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, PlainTextResponse

from .. import db
from ..config import get_settings

router = APIRouter(tags=["hf-space"])
_started_at = time.time()


def _check_ops_token(x_ops_token: str | None, token_query: str | None) -> None:
    settings = get_settings()
    expected = settings.ops_token
    if not expected:
        return
    provided = x_ops_token or token_query or ""
    if provided != expected:
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


@router.get("/nginx-health", response_class=PlainTextResponse, include_in_schema=False)
def nginx_health():
    # Compatibility endpoint for HF deployment smoke scripts inspired by Dify-all-in-one-HFS.
    return "ok"


@router.get("/healthz", include_in_schema=False)
def healthz():
    settings = get_settings()
    db.one("SELECT 1 AS ok")
    return {"status": "ok", "version": settings.app_version, "hf_space": settings.hf_space}


@router.get("/_ops/", response_class=HTMLResponse, include_in_schema=False)
def ops_home(token: str | None = Query(default=None), x_ops_token: str | None = Header(default=None, alias="X-Ops-Token")):
    _check_ops_token(x_ops_token, token)
    settings = get_settings()
    return f"""
<!doctype html>
<html lang=\"zh-CN\">
<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Data Agent Ops</title>
<style>body{{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:32px;background:#f8fafc;color:#0f172a}}code,pre{{background:#e2e8f0;padding:2px 6px;border-radius:6px}}.card{{background:white;border:1px solid #e2e8f0;border-radius:14px;padding:18px;margin:12px 0;box-shadow:0 8px 20px rgba(15,23,42,.06)}}a{{color:#2563eb}}</style></head>
<body><h1>独立数据智能体平台 · HF Space Ops</h1>
<div class=\"card\"><b>Status</b><p>Version: <code>{settings.app_version}</code></p><p>Data dir: <code>{settings.data_dir}</code></p><p>Space host: <code>{settings.space_host or '-'}</code></p></div>
<div class=\"card\"><b>Read-only endpoints</b><ul><li><a href=\"/_ops/healthz\">/_ops/healthz</a></li><li><a href=\"/_ops/health\">/_ops/health</a></li><li><a href=\"/_ops/system\">/_ops/system</a></li><li><a href=\"/_ops/config\">/_ops/config</a></li><li><a href=\"/_ops/version\">/_ops/version</a></li></ul></div>
</body></html>
"""


def _ops_health_payload() -> dict:
    settings = get_settings()
    db_ok = db.one("SELECT 1 AS ok")
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
def ops_healthz(token: str | None = Query(default=None), x_ops_token: str | None = Header(default=None, alias="X-Ops-Token")):
    _check_ops_token(x_ops_token, token)
    return _ops_health_payload()


@router.get("/_ops/health", include_in_schema=False)
def ops_health(token: str | None = Query(default=None), x_ops_token: str | None = Header(default=None, alias="X-Ops-Token")):
    _check_ops_token(x_ops_token, token)
    return _ops_health_payload()


@router.get("/_ops/status", include_in_schema=False)
def ops_status(token: str | None = Query(default=None), x_ops_token: str | None = Header(default=None, alias="X-Ops-Token")):
    _check_ops_token(x_ops_token, token)
    return _ops_health_payload()


@router.get("/_ops/system", include_in_schema=False)
def ops_system(token: str | None = Query(default=None), x_ops_token: str | None = Header(default=None, alias="X-Ops-Token")):
    _check_ops_token(x_ops_token, token)
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
def ops_config(token: str | None = Query(default=None), x_ops_token: str | None = Header(default=None, alias="X-Ops-Token")):
    _check_ops_token(x_ops_token, token)
    settings = get_settings()
    payload = settings.redacted()
    payload["ops_token_configured"] = bool(settings.ops_token)
    payload["env_presence"] = {k: bool(os.getenv(k)) for k in ["SPACE_ID", "SPACE_HOST", "DAP_SECRET_KEY", "DAP_OPS_TOKEN", "DAP_DATA_DIR", "DAP_PERSIST_DIR"]}
    return payload


@router.get("/_ops/version", include_in_schema=False)
def ops_version(token: str | None = Query(default=None), x_ops_token: str | None = Header(default=None, alias="X-Ops-Token")):
    _check_ops_token(x_ops_token, token)
    settings = get_settings()
    return {"name": settings.app_name, "version": settings.app_version, "env": settings.app_env, "hf_space": settings.hf_space}
