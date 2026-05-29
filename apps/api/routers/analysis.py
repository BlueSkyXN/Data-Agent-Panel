from __future__ import annotations

import json
import time

from fastapi import APIRouter, Depends, HTTPException, Request

from .. import db
from ..schemas import AnalysisTaskCreate
from ..security import audit, can_use_agent, get_current_user, require_admin
from ..services import adapters, trace_service

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


def _store_report_if_any(output: dict, user: dict, agent_id: str, title: str) -> str | None:
    if not output.get("report_markdown"):
        return None
    report_id = db.new_id("report")
    ver_id = db.new_id("rver")
    db.insert("reports", {"id": report_id, "title": title[:80] or "深度分析报告", "report_type": output.get("answer_type") or "deep_analysis", "owner_id": user["id"], "agent_id": agent_id, "status": "draft", "current_version_id": ver_id, "created_at": db.now()})
    db.insert("report_versions", {"id": ver_id, "report_id": report_id, "version": "1.0", "content_markdown": output["report_markdown"], "evidence_json": json.dumps(output.get("evidence", []), ensure_ascii=False), "created_by": user["id"], "created_at": db.now()})
    return report_id


@router.post("/tasks")
def create_task(payload: AnalysisTaskCreate, request: Request, user: dict = Depends(get_current_user)):
    if not can_use_agent(user, payload.agent_id):
        raise HTTPException(status_code=403, detail="No permission to use this agent")
    agent = db.one("SELECT * FROM agents WHERE id=?", [payload.agent_id])
    version = db.one("SELECT * FROM agent_versions WHERE id=?", [agent["default_version_id"]]) if agent else None
    if not agent or not version:
        raise HTTPException(status_code=404, detail="Agent not found")
    task_id = db.new_id("task")
    need_approval = bool(payload.require_plan_approval or agent.get("require_human_approval"))
    status = "awaiting_approval" if need_approval else "running"
    db.insert("tasks", {"id": task_id, "task_type": "deep_analysis", "user_id": user["id"], "agent_id": payload.agent_id, "session_id": None, "status": status, "progress": 10, "result_ref": None, "result_json": None, "error_message": None, "created_at": db.now(), "finished_at": None})
    trace_id = trace_service.create_trace(user["id"], payload.question, agent_id=agent["id"], task_id=task_id, agent_version=version["version"], request_id=getattr(request.state, "request_id", ""))
    if need_approval:
        plan = {"answer": "该分析任务需要人工确认计划后执行。", "answer_type": "analysis_plan", "plan": ["确认分析目标", "执行只读 SQL 查询", "生成报告草稿", "人工复核发布"], "trace_id": trace_id}
        trace_service.add_step(trace_id, "planning", "approval_required", {"question": payload.question}, plan)
        trace_service.finish_trace(trace_id, plan, "awaiting_approval", 0)
        approval_id = db.new_id("approval")
        db.insert("approval_requests", {"id": approval_id, "task_id": task_id, "trace_id": trace_id, "requester_id": user["id"], "approver_id": None, "status": "pending", "reason": "high_risk_analysis_or_user_requested", "decision_comment": None, "created_at": db.now(), "decided_at": None})
        db.update("tasks", "id", task_id, {"result_ref": trace_id, "result_json": json.dumps(plan, ensure_ascii=False)})
        audit("create_analysis_task_pending_approval", user, "task", task_id, {"trace_id": trace_id, "approval_id": approval_id}, request)
        return {"task_id": task_id, "trace_id": trace_id, "approval_id": approval_id, "status": "awaiting_approval", "result": plan}
    return _execute_analysis_task(task_id, payload.question, agent, version, user, request)


def _execute_analysis_task(task_id: str, question: str, agent: dict, version: dict, user: dict, request: Request | None = None, trace_id: str | None = None):
    trace_id = trace_id or trace_service.create_trace(user["id"], question, agent_id=agent["id"], task_id=task_id, agent_version=version["version"], request_id=getattr(request.state, "request_id", "") if request else "")
    start = time.time()
    try:
        db.update("tasks", "id", task_id, {"status": "running", "progress": 30})
        output = adapters.call_adapter(agent, version, question, trace_id, {}, user=user)
        report_id = _store_report_if_any(output, user, agent["id"], question)
        if report_id:
            output["report_id"] = report_id
        duration = int((time.time() - start) * 1000)
        trace_service.finish_trace(trace_id, output, "success", duration)
        db.update("tasks", "id", task_id, {"status": "success", "progress": 100, "result_ref": trace_id, "result_json": json.dumps(output, ensure_ascii=False), "finished_at": db.now()})
        if request:
            audit("execute_analysis_task", user, "task", task_id, {"trace_id": trace_id}, request)
        return {"task_id": task_id, "trace_id": trace_id, "status": "success", "result": output}
    except Exception as exc:
        duration = int((time.time() - start) * 1000)
        trace_service.finish_trace(trace_id, {"error": str(exc)}, "failed", duration)
        db.update("tasks", "id", task_id, {"status": "failed", "progress": 100, "error_message": str(exc), "finished_at": db.now()})
        raise


@router.post("/tasks/{task_id}/approve-plan")
def approve_plan(task_id: str, request: Request, user: dict = Depends(require_admin)):
    task = db.one("SELECT * FROM tasks WHERE id=?", [task_id])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] != "awaiting_approval":
        raise HTTPException(status_code=400, detail="Task is not awaiting approval")
    agent = db.one("SELECT * FROM agents WHERE id=?", [task["agent_id"]])
    version = db.one("SELECT * FROM agent_versions WHERE id=?", [agent["default_version_id"]]) if agent else None
    trace = db.one("SELECT * FROM traces WHERE task_id=? ORDER BY created_at DESC LIMIT 1", [task_id])
    if not agent or not version or not trace:
        raise HTTPException(status_code=404, detail="Analysis context not found")
    db.update("approval_requests", "task_id", task_id, {"status": "approved", "approver_id": user["id"], "decision_comment": "approved", "decided_at": db.now()})
    audit("approve_analysis_plan", user, "task", task_id, {"trace_id": trace["id"]}, request)
    return _execute_analysis_task(task_id, trace["input"], agent, version, user, request, trace_id=trace["id"])


@router.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: str, request: Request, user: dict = Depends(get_current_user)):
    task = db.one("SELECT * FROM tasks WHERE id=?", [task_id])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["user_id"] != user["id"] and "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="No permission")
    db.update("tasks", "id", task_id, {"status": "cancelled", "finished_at": db.now(), "progress": 100})
    audit("cancel_task", user, "task", task_id, {}, request)
    return {"ok": True}


@router.get("/tasks/{task_id}")
def get_task(task_id: str, user: dict = Depends(get_current_user)):
    task = db.one("SELECT * FROM tasks WHERE id=?", [task_id])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["user_id"] != user["id"] and "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="No permission")
    try:
        task["result_json"] = json.loads(task["result_json"]) if task.get("result_json") else None
    except Exception:
        pass
    task["approvals"] = db.many("SELECT * FROM approval_requests WHERE task_id=? ORDER BY created_at DESC", [task_id])
    return task
