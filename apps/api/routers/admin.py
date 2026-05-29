from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Query

from .. import db
from ..config import get_settings
from ..security import get_current_user, require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])
settings = get_settings()


@router.get("/users")
def users(admin: dict = Depends(require_admin)):
    return db.many("SELECT id, username, name, email, department, status, failed_login_count, locked_until, last_login_at, created_at FROM users ORDER BY created_at")


@router.get("/roles")
def roles(admin: dict = Depends(require_admin)):
    rows = db.many("SELECT * FROM roles ORDER BY name")
    for row in rows:
        row["permissions"] = db.many(
            "SELECT p.code, p.description FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=? ORDER BY p.code",
            [row["id"]],
        )
    return rows


@router.get("/audit-logs")
def audit_logs(limit: int = Query(300, ge=1, le=2000), admin: dict = Depends(require_admin)):
    rows = db.many("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?", [limit])
    for row in rows:
        try:
            row["detail_json"] = json.loads(row.get("detail_json") or "{}")
        except Exception:
            pass
    return rows


@router.get("/config")
def config(admin: dict = Depends(require_admin)):
    return settings.redacted()


@router.get("/stats")
def stats(user: dict = Depends(require_admin)):
    tables = ["agents", "sessions", "tasks", "traces", "reports", "eval_sets", "feedback", "audit_logs", "sql_runs"]
    counts = {t: db.one(f"SELECT COUNT(*) c FROM {t}")["c"] for t in tables}
    recent_failures = db.many("SELECT id, agent_id, status, duration_ms, created_at FROM traces WHERE status!='success' ORDER BY created_at DESC LIMIT 20")
    usage_by_agent = db.many("SELECT agent_id, COUNT(*) AS calls, AVG(duration_ms) AS avg_duration_ms FROM traces GROUP BY agent_id ORDER BY calls DESC")
    return {"counts": counts, "usage_by_agent": usage_by_agent, "recent_failures": recent_failures, "runtime": settings.redacted()}
