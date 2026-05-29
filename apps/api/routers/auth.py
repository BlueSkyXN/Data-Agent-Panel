from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from .. import db
from ..config import get_settings
from ..rate_limiter import check_rate_limit
from ..schemas import LoginRequest
from ..security import audit, get_current_user, make_token, public_user, upgrade_password_hash_if_needed, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()


def _parse_utc(ts: str | None):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


@router.post("/login")
def login(payload: LoginRequest, request: Request):
    ip = request.client.host if request.client else "unknown"
    check_rate_limit(f"auth:{ip}:{payload.username}", settings.auth_rate_limit_per_minute)
    user = db.one("SELECT * FROM users WHERE username=? AND status='active'", [payload.username])
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    locked_until = _parse_utc(user.get("locked_until"))
    if locked_until and locked_until > datetime.now(timezone.utc):
        raise HTTPException(status_code=423, detail="Account temporarily locked after repeated failed logins")
    if not verify_password(payload.password, user):
        failed = int(user.get("failed_login_count") or 0) + 1
        updates = {"failed_login_count": failed}
        if failed >= settings.max_login_failures:
            updates["locked_until"] = (datetime.now(timezone.utc) + timedelta(minutes=settings.lockout_minutes)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        db.update("users", "id", user["id"], updates)
        audit("login_failed", {"id": user["id"]}, "user", user["id"], {"username": payload.username}, request)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    upgrade_password_hash_if_needed(user, payload.password)
    db.update("users", "id", user["id"], {"failed_login_count": 0, "locked_until": None, "last_login_at": db.now()})
    token = make_token(user["id"])
    user = db.one("SELECT * FROM users WHERE id=?", [user["id"]]) or user
    roles = db.many("SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=?", [user["id"]])
    user["roles"] = [r["name"] for r in roles]
    user_public = public_user(user)
    audit("login", user_public, "user", user["id"], {}, request)
    return {"token": token, "user": user_public, "expires_in_minutes": settings.token_ttl_minutes}


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return public_user(user)
