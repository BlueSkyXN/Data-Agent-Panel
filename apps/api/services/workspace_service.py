from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request

from .. import db
from ..security import audit, can_read_dataset, require_workspace_role, workspace_role_for_user

RESOURCE_TYPES = frozenset({"session", "report", "trace", "dataset", "analysis_task", "codex_task"})
_MAX_CANVAS_REVISIONS = 12


def _not_found(detail: str = "Workspace resource not found") -> None:
    raise HTTPException(status_code=404, detail=detail)


def _space(space_id: str) -> dict[str, Any]:
    space = db.one("SELECT * FROM project_spaces WHERE id=?", [space_id])
    if not space:
        _not_found("Workspace not found")
    return space


def _require_access(user: dict, space_id: str, minimum_role: str = "viewer", writable: bool = False) -> tuple[dict[str, Any], str]:
    space = _space(space_id)
    role = require_workspace_role(user, space_id, minimum_role)
    if writable and space.get("status") != "active":
        raise HTTPException(status_code=409, detail="Workspace is archived")
    return space, role


def _audit(action: str, user: dict, object_type: str, object_id: str, detail: dict[str, Any], request: Request | None) -> None:
    # Deliberately keep Markdown, task detail, and arbitrary client context out of audit_logs.
    audit(action, user, object_type, object_id, detail, request)


def _resource_metadata(user: dict, resource_type: str, resource_id: str) -> dict[str, Any] | None:
    """Resolve a resource only when the caller already has its native access right."""
    if resource_type not in RESOURCE_TYPES:
        return None
    if resource_type == "dataset":
        row = db.one("SELECT id,name,business_domain,data_classification,status FROM datasets WHERE id=?", [resource_id])
        if row and can_read_dataset(user, resource_id):
            return {"resource_type": resource_type, "resource_id": resource_id, "title": row["name"], "status": row.get("status")}
        return None
    if resource_type == "session":
        row = db.one("SELECT id,user_id,title,status,updated_at FROM sessions WHERE id=?", [resource_id])
        if row and (row["user_id"] == user["id"] or "admin" in user.get("roles", [])):
            return {"resource_type": resource_type, "resource_id": resource_id, "title": row.get("title") or resource_id, "status": row.get("status")}
        return None
    if resource_type == "trace":
        row = db.one("SELECT id,user_id,agent_id,status,created_at FROM traces WHERE id=?", [resource_id])
        if row and (row["user_id"] == user["id"] or "admin" in user.get("roles", [])):
            return {"resource_type": resource_type, "resource_id": resource_id, "title": row.get("agent_id") or resource_id, "status": row.get("status")}
        return None
    if resource_type == "report":
        row = db.one("SELECT id,owner_id,title,status,created_at FROM reports WHERE id=?", [resource_id])
        if row and (row.get("owner_id") == user["id"] or "admin" in user.get("roles", [])):
            return {"resource_type": resource_type, "resource_id": resource_id, "title": row.get("title") or resource_id, "status": row.get("status")}
        return None
    if resource_type == "analysis_task":
        row = db.one("SELECT id,user_id,task_type,status,created_at FROM tasks WHERE id=? AND task_type='deep_analysis'", [resource_id])
        if row and (row["user_id"] == user["id"] or "admin" in user.get("roles", [])):
            return {"resource_type": resource_type, "resource_id": resource_id, "title": row.get("task_type") or resource_id, "status": row.get("status")}
        return None
    row = db.one("SELECT id,requester_id,title,status,created_at FROM codex_tasks WHERE id=?", [resource_id])
    if row and (row["requester_id"] == user["id"] or "admin" in user.get("roles", [])):
        return {"resource_type": resource_type, "resource_id": resource_id, "title": row.get("title") or resource_id, "status": row.get("status")}
    return None


def _require_resource_access(user: dict, resource_type: str, resource_id: str) -> dict[str, Any]:
    if resource_type not in RESOURCE_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported workspace resource type")
    resource = _resource_metadata(user, resource_type, resource_id)
    if not resource:
        _not_found("Workspace resource not found")
    return resource


def _validate_source(user: dict, source_type: str | None, source_id: str | None) -> None:
    if bool(source_type) != bool(source_id):
        raise HTTPException(status_code=422, detail="source_type and source_id must be supplied together")
    if source_type and source_id:
        _require_resource_access(user, source_type, source_id)


def _filter_source_metadata(user: dict, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Do not reveal a note/task source reference when native ACL denies that resource."""
    for row in rows:
        source_type = row.get("source_type")
        source_id = row.get("source_id")
        if source_type and source_id and not _resource_metadata(user, source_type, source_id):
            row["source_type"] = None
            row["source_id"] = None
    return rows


def list_workspaces(user: dict) -> list[dict[str, Any]]:
    if "admin" in user.get("roles", []):
        rows = db.many("SELECT * FROM project_spaces ORDER BY updated_at DESC, created_at DESC")
        for row in rows:
            row["role"] = "owner"
        return rows
    rows = db.many(
        """
        SELECT ps.*, sm.role AS membership_role
        FROM project_spaces ps
        JOIN space_members sm ON sm.space_id=ps.id
        WHERE sm.user_id=?
        ORDER BY ps.updated_at DESC, ps.created_at DESC
        """,
        [user["id"]],
    )
    out = []
    for row in rows:
        role = workspace_role_for_user(user, row["id"])
        if role:
            row["role"] = role
            row.pop("membership_role", None)
            out.append(row)
    return out


def create_workspace(payload: dict[str, Any], user: dict, request: Request | None = None) -> dict[str, Any]:
    name = payload["name"].strip()
    if not name:
        raise HTTPException(status_code=422, detail="Workspace name cannot be blank")
    space_id = db.new_id("space")
    timestamp = db.now()
    with db.connect() as con:
        con.execute(
            """
            INSERT INTO project_spaces (id,name,owner_id,description,status,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?)
            """,
            [space_id, name, user["id"], payload.get("description", "").strip(), "active", timestamp, timestamp],
        )
        con.execute("INSERT INTO space_members (space_id,user_id,role) VALUES (?,?,?)", [space_id, user["id"], "owner"])
    _audit("create_workspace", user, "workspace", space_id, {"name_length": len(name)}, request)
    return get_workspace(space_id, user)


def get_workspace(space_id: str, user: dict) -> dict[str, Any]:
    space, role = _require_access(user, space_id)
    resources: list[dict[str, Any]] = []
    for row in db.many("SELECT * FROM workspace_resources WHERE space_id=? ORDER BY created_at DESC", [space_id]):
        resource = _resource_metadata(user, row["resource_type"], row["resource_id"])
        if resource:
            resources.append({"id": row["id"], "added_by": row["added_by"], "created_at": row["created_at"], **resource})
    canvas = db.one("SELECT * FROM workspace_canvases WHERE space_id=?", [space_id])
    if not canvas:
        canvas = {"space_id": space_id, "content_markdown": "", "version": 0, "updated_at": space.get("updated_at") or space["created_at"]}
    notes = _filter_source_metadata(user, db.many("SELECT * FROM workspace_notes WHERE space_id=? ORDER BY updated_at DESC", [space_id]))
    tasks = _filter_source_metadata(user, db.many("SELECT * FROM workspace_tasks WHERE space_id=? ORDER BY status ASC, updated_at DESC", [space_id]))
    return {"space": space, "role": role, "resources": resources, "canvas": canvas, "notes": notes, "tasks": tasks}


def context_for_agent(space_id: str, user: dict) -> dict[str, Any]:
    """Build a bounded, ACL-filtered workspace context for one chat invocation.

    This is intentionally separate from ``get_workspace``: only a small,
    explicit subset is passed to an adapter, and callers must not write this
    content into Trace or audit records.
    """
    detail = get_workspace(space_id, user)
    space = detail["space"]
    canvas = detail["canvas"]
    notes = detail["notes"][:6]
    tasks = detail["tasks"][:12]
    resources = detail["resources"][:24]
    return {
        "id": space["id"],
        "name": space["name"],
        "description": (space.get("description") or "")[:2000],
        "role": detail["role"],
        "canvas_markdown": (canvas.get("content_markdown") or "")[:12000],
        "canvas_version": int(canvas.get("version") or 0),
        "notes": [
            {"id": note["id"], "title": note["title"], "content_markdown": (note.get("content_markdown") or "")[:3000]}
            for note in notes
        ],
        "open_tasks": [
            {"id": task["id"], "title": task["title"], "detail_markdown": (task.get("detail_markdown") or "")[:1600], "status": task["status"]}
            for task in tasks
            if task.get("status") != "done"
        ],
        "resources": [
            {"resource_type": resource["resource_type"], "resource_id": resource["resource_id"], "title": resource.get("title")}
            for resource in resources
        ],
    }


def update_workspace(space_id: str, payload: dict[str, Any], user: dict, request: Request | None = None) -> dict[str, Any]:
    space, _ = _require_access(user, space_id, "owner")
    updates = {key: value for key, value in payload.items() if value is not None}
    if "name" in updates:
        updates["name"] = updates["name"].strip()
        if not updates["name"]:
            raise HTTPException(status_code=422, detail="Workspace name cannot be blank")
    if "description" in updates:
        updates["description"] = updates["description"].strip()
    if not updates:
        return space
    updates["updated_at"] = db.now()
    db.update("project_spaces", "id", space_id, updates)
    _audit("update_workspace", user, "workspace", space_id, {"fields": sorted(key for key in updates if key != "updated_at")}, request)
    return db.one("SELECT * FROM project_spaces WHERE id=?", [space_id]) or space


def list_members(space_id: str, user: dict) -> list[dict[str, Any]]:
    _require_access(user, space_id, "owner")
    return db.many(
        """
        SELECT sm.space_id,sm.user_id,sm.role,u.username,u.name,u.status
        FROM space_members sm JOIN users u ON u.id=sm.user_id
        WHERE sm.space_id=? ORDER BY CASE sm.role WHEN 'owner' THEN 0 ELSE 1 END, u.username
        """,
        [space_id],
    )


def upsert_member(space_id: str, user_id: str, role: str, actor: dict, request: Request | None = None) -> dict[str, Any]:
    _require_access(actor, space_id, "owner", writable=True)
    if role not in {"owner", "editor", "viewer"}:
        raise HTTPException(status_code=422, detail="Unsupported workspace role")
    current = db.one("SELECT role FROM space_members WHERE space_id=? AND user_id=?", [space_id, user_id])
    if current and current["role"] == "owner" and role != "owner":
        owners = db.one("SELECT COUNT(*) AS c FROM space_members WHERE space_id=? AND role='owner'", [space_id])
        if int(owners["c"] if owners else 0) <= 1:
            raise HTTPException(status_code=409, detail="Workspace must retain an owner")
    member_user = db.one("SELECT id,status FROM users WHERE id=?", [user_id])
    if not member_user or member_user.get("status") != "active":
        _not_found("User not found")
    with db.connect() as con:
        con.execute(
            """
            INSERT INTO space_members (space_id,user_id,role) VALUES (?,?,?)
            ON CONFLICT(space_id,user_id) DO UPDATE SET role=excluded.role
            """,
            [space_id, user_id, role],
        )
        con.execute("UPDATE project_spaces SET updated_at=? WHERE id=?", [db.now(), space_id])
    _audit("upsert_workspace_member", actor, "workspace", space_id, {"member_id": user_id, "role": role}, request)
    return db.one("SELECT space_id,user_id,role FROM space_members WHERE space_id=? AND user_id=?", [space_id, user_id]) or {}


def remove_member(space_id: str, user_id: str, actor: dict, request: Request | None = None) -> None:
    _require_access(actor, space_id, "owner", writable=True)
    member = db.one("SELECT role FROM space_members WHERE space_id=? AND user_id=?", [space_id, user_id])
    if not member:
        _not_found("Workspace member not found")
    if member["role"] == "owner":
        owners = db.one("SELECT COUNT(*) AS c FROM space_members WHERE space_id=? AND role='owner'", [space_id])
        if int(owners["c"] if owners else 0) <= 1:
            raise HTTPException(status_code=409, detail="Workspace must retain an owner")
    with db.connect() as con:
        con.execute("DELETE FROM space_members WHERE space_id=? AND user_id=?", [space_id, user_id])
        con.execute("UPDATE project_spaces SET updated_at=? WHERE id=?", [db.now(), space_id])
    _audit("remove_workspace_member", actor, "workspace", space_id, {"member_id": user_id}, request)


def list_resources(space_id: str, user: dict) -> list[dict[str, Any]]:
    return get_workspace(space_id, user)["resources"]


def add_resource(space_id: str, payload: dict[str, Any], user: dict, request: Request | None = None) -> dict[str, Any]:
    _require_access(user, space_id, "editor", writable=True)
    resource = _require_resource_access(user, payload["resource_type"], payload["resource_id"])
    row_id = db.new_id("wres")
    timestamp = db.now()
    with db.connect() as con:
        existing = con.execute(
            "SELECT * FROM workspace_resources WHERE space_id=? AND resource_type=? AND resource_id=?",
            [space_id, payload["resource_type"], payload["resource_id"]],
        ).fetchone()
        if existing:
            return {"id": existing["id"], "added_by": existing["added_by"], "created_at": existing["created_at"], **resource}
        con.execute(
            "INSERT INTO workspace_resources (id,space_id,resource_type,resource_id,added_by,created_at) VALUES (?,?,?,?,?,?)",
            [row_id, space_id, payload["resource_type"], payload["resource_id"], user["id"], timestamp],
        )
        con.execute("UPDATE project_spaces SET updated_at=? WHERE id=?", [timestamp, space_id])
    _audit("add_workspace_resource", user, "workspace_resource", row_id, {"space_id": space_id, "resource_type": payload["resource_type"], "resource_id": payload["resource_id"]}, request)
    return {"id": row_id, "added_by": user["id"], "created_at": timestamp, **resource}


def remove_resource(space_id: str, resource_row_id: str, user: dict, request: Request | None = None) -> None:
    _require_access(user, space_id, "editor", writable=True)
    row = db.one("SELECT * FROM workspace_resources WHERE id=? AND space_id=?", [resource_row_id, space_id])
    if not row:
        _not_found("Workspace resource not found")
    with db.connect() as con:
        con.execute("DELETE FROM workspace_resources WHERE id=? AND space_id=?", [resource_row_id, space_id])
        con.execute("UPDATE project_spaces SET updated_at=? WHERE id=?", [db.now(), space_id])
    _audit("remove_workspace_resource", user, "workspace_resource", resource_row_id, {"space_id": space_id, "resource_type": row["resource_type"], "resource_id": row["resource_id"]}, request)


def get_canvas(space_id: str, user: dict) -> dict[str, Any]:
    return get_workspace(space_id, user)["canvas"]


def update_canvas(space_id: str, payload: dict[str, Any], user: dict, request: Request | None = None) -> dict[str, Any]:
    _require_access(user, space_id, "editor", writable=True)
    timestamp = db.now()
    content = payload["content_markdown"]
    with db.connect() as con:
        current = con.execute("SELECT * FROM workspace_canvases WHERE space_id=?", [space_id]).fetchone()
        current_version = int(current["version"]) if current else 0
        if current_version != payload["expected_version"]:
            raise HTTPException(status_code=409, detail="Canvas version conflict")
        version = current_version + 1
        if current:
            con.execute(
                "UPDATE workspace_canvases SET content_markdown=?,version=?,updated_by=?,updated_at=? WHERE space_id=?",
                [content, version, user["id"], timestamp, space_id],
            )
        else:
            con.execute(
                """
                INSERT INTO workspace_canvases (space_id,content_markdown,version,created_by,updated_by,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?)
                """,
                [space_id, content, version, user["id"], user["id"], timestamp, timestamp],
            )
        con.execute(
            "INSERT INTO workspace_canvas_revisions (id,space_id,version,content_markdown,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?)",
            [db.new_id("wcanvas_rev"), space_id, version, content, payload.get("reason", ""), user["id"], timestamp],
        )
        con.execute(
            """
            DELETE FROM workspace_canvas_revisions
            WHERE id IN (
              SELECT id FROM workspace_canvas_revisions
              WHERE space_id=? ORDER BY version DESC LIMIT -1 OFFSET ?
            )
            """,
            [space_id, _MAX_CANVAS_REVISIONS],
        )
        con.execute("UPDATE project_spaces SET updated_at=? WHERE id=?", [timestamp, space_id])
        canvas = con.execute("SELECT * FROM workspace_canvases WHERE space_id=?", [space_id]).fetchone()
    result = dict(canvas) if canvas else {}
    _audit("update_workspace_canvas", user, "workspace_canvas", space_id, {"version": result.get("version"), "content_length": len(content), "reason_length": len(payload.get("reason", ""))}, request)
    return result


def list_notes(space_id: str, user: dict) -> list[dict[str, Any]]:
    _require_access(user, space_id)
    return _filter_source_metadata(user, db.many("SELECT * FROM workspace_notes WHERE space_id=? ORDER BY updated_at DESC", [space_id]))


def create_note(space_id: str, payload: dict[str, Any], user: dict, request: Request | None = None) -> dict[str, Any]:
    _require_access(user, space_id, "editor", writable=True)
    _validate_source(user, payload.get("source_type"), payload.get("source_id"))
    note_id = db.new_id("wnote")
    timestamp = db.now()
    with db.connect() as con:
        con.execute(
            """
            INSERT INTO workspace_notes (id,space_id,title,content_markdown,source_type,source_id,created_by,updated_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            """,
            [note_id, space_id, payload["title"].strip(), payload["content_markdown"], payload.get("source_type"), payload.get("source_id"), user["id"], user["id"], timestamp, timestamp],
        )
        con.execute("UPDATE project_spaces SET updated_at=? WHERE id=?", [timestamp, space_id])
        note = con.execute("SELECT * FROM workspace_notes WHERE id=?", [note_id]).fetchone()
    result = dict(note) if note else {}
    _audit("create_workspace_note", user, "workspace_note", note_id, {"space_id": space_id, "title_length": len(payload["title"].strip()), "content_length": len(payload["content_markdown"]), "source_type": payload.get("source_type"), "source_id": payload.get("source_id")}, request)
    return result


def update_note(space_id: str, note_id: str, payload: dict[str, Any], user: dict, request: Request | None = None) -> dict[str, Any]:
    _require_access(user, space_id, "editor", writable=True)
    current = db.one("SELECT * FROM workspace_notes WHERE id=? AND space_id=?", [note_id, space_id])
    if not current:
        _not_found("Workspace note not found")
    updates = {key: value for key, value in payload.items() if value is not None}
    if "title" in updates:
        updates["title"] = updates["title"].strip()
        if not updates["title"]:
            raise HTTPException(status_code=422, detail="Note title cannot be blank")
    source_type = updates.get("source_type", current.get("source_type"))
    source_id = updates.get("source_id", current.get("source_id"))
    _validate_source(user, source_type, source_id)
    if not updates:
        return current
    updates.update({"updated_by": user["id"], "updated_at": db.now()})
    db.update("workspace_notes", "id", note_id, updates)
    db.update("project_spaces", "id", space_id, {"updated_at": updates["updated_at"]})
    result = db.one("SELECT * FROM workspace_notes WHERE id=?", [note_id]) or current
    _audit("update_workspace_note", user, "workspace_note", note_id, {"space_id": space_id, "fields": sorted(key for key in updates if key not in {"updated_by", "updated_at"}), "content_length": len(result.get("content_markdown") or "")}, request)
    return result


def delete_note(space_id: str, note_id: str, user: dict, request: Request | None = None) -> None:
    _require_access(user, space_id, "editor", writable=True)
    if not db.one("SELECT id FROM workspace_notes WHERE id=? AND space_id=?", [note_id, space_id]):
        _not_found("Workspace note not found")
    timestamp = db.now()
    with db.connect() as con:
        con.execute("DELETE FROM workspace_notes WHERE id=? AND space_id=?", [note_id, space_id])
        con.execute("UPDATE project_spaces SET updated_at=? WHERE id=?", [timestamp, space_id])
    _audit("delete_workspace_note", user, "workspace_note", note_id, {"space_id": space_id}, request)


def list_tasks(space_id: str, user: dict) -> list[dict[str, Any]]:
    _require_access(user, space_id)
    return _filter_source_metadata(user, db.many("SELECT * FROM workspace_tasks WHERE space_id=? ORDER BY status ASC, updated_at DESC", [space_id]))


def create_task(space_id: str, payload: dict[str, Any], user: dict, request: Request | None = None) -> dict[str, Any]:
    _require_access(user, space_id, "editor", writable=True)
    _validate_source(user, payload.get("source_type"), payload.get("source_id"))
    task_id = db.new_id("wtask")
    timestamp = db.now()
    with db.connect() as con:
        con.execute(
            """
            INSERT INTO workspace_tasks (id,space_id,title,detail_markdown,status,source_type,source_id,created_by,updated_by,created_at,updated_at,completed_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            [task_id, space_id, payload["title"].strip(), payload.get("detail_markdown", ""), "open", payload.get("source_type"), payload.get("source_id"), user["id"], user["id"], timestamp, timestamp, None],
        )
        con.execute("UPDATE project_spaces SET updated_at=? WHERE id=?", [timestamp, space_id])
        task = con.execute("SELECT * FROM workspace_tasks WHERE id=?", [task_id]).fetchone()
    result = dict(task) if task else {}
    _audit("create_workspace_task", user, "workspace_task", task_id, {"space_id": space_id, "title_length": len(payload["title"].strip()), "detail_length": len(payload.get("detail_markdown", "")), "source_type": payload.get("source_type"), "source_id": payload.get("source_id")}, request)
    return result


def update_task(space_id: str, task_id: str, payload: dict[str, Any], user: dict, request: Request | None = None) -> dict[str, Any]:
    _require_access(user, space_id, "editor", writable=True)
    current = db.one("SELECT * FROM workspace_tasks WHERE id=? AND space_id=?", [task_id, space_id])
    if not current:
        _not_found("Workspace task not found")
    updates = {key: value for key, value in payload.items() if value is not None}
    if "title" in updates:
        updates["title"] = updates["title"].strip()
        if not updates["title"]:
            raise HTTPException(status_code=422, detail="Workspace task title cannot be blank")
    source_type = updates.get("source_type", current.get("source_type"))
    source_id = updates.get("source_id", current.get("source_id"))
    _validate_source(user, source_type, source_id)
    if not updates:
        return current
    timestamp = db.now()
    if updates.get("status") == "done" and current.get("status") != "done":
        updates["completed_at"] = timestamp
    elif updates.get("status") == "open" and current.get("status") == "done":
        updates["completed_at"] = None
    updates.update({"updated_by": user["id"], "updated_at": timestamp})
    db.update("workspace_tasks", "id", task_id, updates)
    db.update("project_spaces", "id", space_id, {"updated_at": timestamp})
    result = db.one("SELECT * FROM workspace_tasks WHERE id=?", [task_id]) or current
    _audit("update_workspace_task", user, "workspace_task", task_id, {"space_id": space_id, "fields": sorted(key for key in updates if key not in {"updated_by", "updated_at"}), "detail_length": len(result.get("detail_markdown") or "")}, request)
    return result


def delete_task(space_id: str, task_id: str, user: dict, request: Request | None = None) -> None:
    _require_access(user, space_id, "editor", writable=True)
    if not db.one("SELECT id FROM workspace_tasks WHERE id=? AND space_id=?", [task_id, space_id]):
        _not_found("Workspace task not found")
    timestamp = db.now()
    with db.connect() as con:
        con.execute("DELETE FROM workspace_tasks WHERE id=? AND space_id=?", [task_id, space_id])
        con.execute("UPDATE project_spaces SET updated_at=? WHERE id=?", [timestamp, space_id])
    _audit("delete_workspace_task", user, "workspace_task", task_id, {"space_id": space_id}, request)
