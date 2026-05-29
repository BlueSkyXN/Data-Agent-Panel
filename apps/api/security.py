from __future__ import annotations

import base64
import hmac
import json
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import Depends, Header, HTTPException, Request

from . import db
from .auth_utils import hash_secret, stable_hash, verify_secret
from .config import get_settings

settings = get_settings()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("ascii"))


def make_token(user_id: str, ttl_minutes: int | None = None) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes or settings.token_ttl_minutes)
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {"user_id": user_id, "exp": int(exp.timestamp()), "iat": int(datetime.now(timezone.utc).timestamp())}
    signing_input = _b64(json.dumps(header, separators=(",", ":")).encode()) + "." + _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(settings.secret_key.encode("utf-8"), signing_input.encode("ascii"), "sha256").digest()
    return signing_input + "." + _b64(sig)


def parse_token(token: str) -> str | None:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        signing_input = parts[0] + "." + parts[1]
        expected = _b64(hmac.new(settings.secret_key.encode("utf-8"), signing_input.encode("ascii"), "sha256").digest())
        if not hmac.compare_digest(expected, parts[2]):
            return None
        payload = json.loads(_unb64(parts[1]).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(datetime.now(timezone.utc).timestamp()):
            return None
        return payload.get("user_id")
    except Exception:
        return None


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    out = {k: user.get(k) for k in ["id", "username", "name", "email", "department", "status", "last_login_at"] if k in user}
    out["roles"] = user.get("roles") or [r["name"] for r in db.many("SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=?", [user["id"]])]
    out["permissions"] = sorted(permissions_for_user(user["id"]))
    return out


def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    x_dap_token: Annotated[str | None, Header(alias="X-DAP-Token")] = None,
) -> dict:
    if x_dap_token:
        token = x_dap_token.strip()
        if token.lower().startswith("bearer "):
            token = token.split(" ", 1)[1]
    elif authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
    else:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    user_id = parse_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.one("SELECT * FROM users WHERE id=? AND status='active'", [user_id])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    roles = db.many("SELECT r.* FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=?", [user_id])
    user["roles"] = [r["name"] for r in roles]
    return user


def permissions_for_user(user_id: str) -> set[str]:
    rows = db.many(
        """
        SELECT p.code
        FROM permissions p
        JOIN role_permissions rp ON rp.permission_id=p.id
        JOIN user_roles ur ON ur.role_id=rp.role_id
        WHERE ur.user_id=?
        """,
        [user_id],
    )
    return {r["code"] for r in rows}


def require_permission(permission: str):
    def _inner(user: dict = Depends(get_current_user)) -> dict:
        if "admin" in user.get("roles", []):
            return user
        if permission not in permissions_for_user(user["id"]):
            raise HTTPException(status_code=403, detail=f"Permission required: {permission}")
        return user
    return _inner


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


def role_ids_for_user(user: dict) -> list[str]:
    return [r["id"] for r in db.many("SELECT r.id FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=?", [user["id"]])]


def can_use_agent(user: dict, agent_id: str) -> bool:
    if "admin" in user.get("roles", []):
        return True
    role_ids = role_ids_for_user(user)
    if not role_ids:
        return False
    placeholders = ",".join(["?"] * len(role_ids))
    rows = db.many(
        f"""
        SELECT * FROM agent_permissions
        WHERE agent_id=? AND permission='use' AND
        ((subject_type='user' AND subject_id=?) OR (subject_type='role' AND subject_id IN ({placeholders})))
        """,
        [agent_id, user["id"], *role_ids],
    )
    return bool(rows)


def dataset_policy_for_user(user: dict, dataset_id: str) -> dict[str, Any] | None:
    if "admin" in user.get("roles", []):
        return {"permission": "read", "row_filter": None, "masked_fields": []}
    role_ids = role_ids_for_user(user)
    params: list[Any] = [dataset_id, user["id"]]
    role_clause = ""
    if role_ids:
        placeholders = ",".join(["?"] * len(role_ids))
        role_clause = f" OR (subject_type='role' AND subject_id IN ({placeholders}))"
        params.extend(role_ids)
    rows = db.many(
        f"""
        SELECT * FROM dataset_permissions
        WHERE dataset_id=? AND permission='read' AND ((subject_type='user' AND subject_id=?) {role_clause})
        """,
        params,
    )
    if not rows:
        return None
    masked: set[str] = set()
    row_filters: list[str] = []
    for row in rows:
        if row.get("row_filter"):
            row_filters.append(row["row_filter"])
        try:
            for f in json.loads(row.get("masked_fields") or "[]"):
                masked.add(f)
        except Exception:
            pass
    return {"permission": "read", "row_filter": " OR ".join(f"({r})" for r in row_filters) if row_filters else None, "masked_fields": sorted(masked)}


def can_read_dataset(user: dict, dataset_id: str) -> bool:
    return dataset_policy_for_user(user, dataset_id) is not None


def verify_password(password: str, user: dict[str, Any]) -> bool:
    if verify_secret(password, user.get("password_hash")):
        return True
    # Legacy demo DB fallback. On successful login, caller should upgrade the stored hash.
    legacy = user.get("password")
    return bool(legacy and hmac.compare_digest(password, legacy))


def upgrade_password_hash_if_needed(user: dict[str, Any], password: str) -> None:
    if not user.get("password_hash") or user.get("password"):
        db.update("users", "id", user["id"], {"password_hash": hash_secret(password), "password": ""})


def audit(action: str, user: dict | None, object_type: str = "", object_id: str = "", detail: dict | None = None, request: Request | None = None) -> None:
    ip = request.client.host if request and request.client else ""
    request_id = getattr(request.state, "request_id", "") if request else ""
    db.insert("audit_logs", {
        "id": db.new_id("audit"),
        "user_id": user.get("id") if user else None,
        "action": action,
        "object_type": object_type,
        "object_id": object_id,
        "detail_json": json.dumps(detail or {}, ensure_ascii=False),
        "ip": ip,
        "request_id": request_id,
        "created_at": db.now(),
    })
