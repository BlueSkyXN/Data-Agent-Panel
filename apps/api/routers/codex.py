from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException, Request

from .. import db
from ..schemas import CodexDispatchRequest, CodexTaskCreate, CodexTaskDecision
from ..security import audit, get_current_user, require_permission
from ..services import codex_service

router = APIRouter(prefix="/api/codex", tags=["codex"])


@router.get("/diagnostics")
def diagnostics(user: dict = Depends(get_current_user)):
    return codex_service.runtime_diagnostics()


@router.get("/workspaces")
def list_workspaces(user: dict = Depends(get_current_user)):
    rows = db.many("SELECT * FROM codex_workspaces ORDER BY created_at DESC")
    for row in rows:
        try:
            row["allowed_paths"] = json.loads(row.get("allowed_paths") or "[]")
        except Exception:
            pass
    return rows


@router.get("/tasks")
def list_tasks(limit: int = 200, user: dict = Depends(get_current_user)):
    if "admin" in user.get("roles", []):
        rows = db.many("SELECT * FROM codex_tasks ORDER BY created_at DESC LIMIT ?", [limit])
    else:
        rows = db.many("SELECT * FROM codex_tasks WHERE requester_id=? ORDER BY created_at DESC LIMIT ?", [user["id"], limit])
    for row in rows:
        try:
            row["acceptance_criteria"] = json.loads(row.get("acceptance_criteria") or "[]")
            row["result_json"] = json.loads(row.get("result_json") or "{}")
        except Exception:
            pass
    return rows


@router.post("/tasks")
def create_task(payload: CodexTaskCreate, request: Request, user: dict = Depends(require_permission("codex:use"))):
    task = codex_service.create_task(payload.model_dump(), user, trace_id=payload.trace_id)
    audit("create_codex_task", user, "codex_task", task["id"], {"title": payload.title, "mode": payload.mode}, request)
    return task


@router.get("/tasks/{task_id}")
def get_task(task_id: str, user: dict = Depends(get_current_user)):
    task = codex_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Codex task not found")
    if task["requester_id"] != user["id"] and "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="No permission")
    return task


@router.post("/tasks/{task_id}/approve")
def approve_task(task_id: str, payload: CodexTaskDecision, request: Request, user: dict = Depends(require_permission("codex:approve"))):
    task = codex_service.approve_task(task_id, user, payload.comment)
    audit("approve_codex_task", user, "codex_task", task_id, payload.model_dump(), request)
    return task


@router.post("/tasks/{task_id}/dispatch")
def dispatch_task(task_id: str, payload: CodexDispatchRequest, request: Request, user: dict = Depends(require_permission("codex:approve"))):
    task = codex_service.dispatch_task(task_id, user, payload.mode)
    audit("dispatch_codex_task", user, "codex_task", task_id, payload.model_dump(), request)
    return task


@router.get("/tasks/{task_id}/events")
def task_events(task_id: str, user: dict = Depends(get_current_user)):
    task = codex_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Codex task not found")
    if task["requester_id"] != user["id"] and "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="No permission")
    return codex_service.list_events(task_id)

@router.get("/tasks/{task_id}/handoff")
def task_handoff(task_id: str, user: dict = Depends(get_current_user)):
    task = codex_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Codex task not found")
    if task["requester_id"] != user["id"] and "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="No permission")
    return {"task_id": task_id, "handoff": task.get("task_prompt", "")}
