from __future__ import annotations

import json
import time

from fastapi import APIRouter, Depends, HTTPException, Request

from .. import db
from ..config import get_settings
from ..rate_limiter import check_rate_limit
from ..schemas import ChatQuery, FeedbackCreate
from ..security import audit, can_use_agent, get_current_user
from ..services import adapters, trace_service

router = APIRouter(prefix="/api/chat", tags=["chat"])
settings = get_settings()


@router.post("/query")
def query(payload: ChatQuery, request: Request, user: dict = Depends(get_current_user)):
    check_rate_limit(f"chat:{user['id']}", settings.chat_rate_limit_per_minute)
    if not can_use_agent(user, payload.agent_id):
        raise HTTPException(status_code=403, detail="No permission to use this agent")
    agent = db.one("SELECT * FROM agents WHERE id=? AND status!='disabled'", [payload.agent_id])
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    version = db.one("SELECT * FROM agent_versions WHERE id=?", [agent["default_version_id"]])
    if not version:
        raise HTTPException(status_code=404, detail="Agent version not found")
    temporary_chat = bool((payload.context or {}).get("temporary_chat"))
    session_id = None if temporary_chat else payload.session_id
    if session_id:
        existing_session = db.one("SELECT * FROM sessions WHERE id=?", [session_id])
        if not existing_session or existing_session["user_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="No permission to use this session")
        if existing_session.get("agent_id") and existing_session["agent_id"] != agent["id"]:
            raise HTTPException(status_code=400, detail="Session is bound to a different agent")
    elif not temporary_chat:
        session_id = db.new_id("session")
        t = db.now()
        db.insert("sessions", {"id": session_id, "user_id": user["id"], "agent_id": agent["id"], "title": payload.message[:30], "status": "active", "created_at": t, "updated_at": t})
    if not temporary_chat:
        db.insert("messages", {"id": db.new_id("msg"), "session_id": session_id, "role": "user", "content": payload.message, "content_type": "text", "created_at": db.now()})
    trace_id = trace_service.create_trace(user["id"], payload.message, agent_id=agent["id"], session_id=session_id, agent_version=version["version"], request_id=getattr(request.state, "request_id", ""))
    start = time.time()
    try:
        output = adapters.call_adapter(agent, version, payload.message, trace_id, payload.context, user=user)
        duration = int((time.time() - start) * 1000)
        trace_service.finish_trace(trace_id, output, "success", duration)
        if not temporary_chat:
            db.insert("messages", {"id": db.new_id("msg"), "session_id": session_id, "role": "assistant", "content": json.dumps(output, ensure_ascii=False), "content_type": "agent_result", "created_at": db.now()})
            db.update("sessions", "id", session_id, {"updated_at": db.now()})
        audit("chat_query", user, "agent", agent["id"], {"trace_id": trace_id, "message": payload.message, "temporary_chat": temporary_chat}, request)
        return {"session_id": session_id, "trace_id": trace_id, "result": output}
    except Exception as exc:
        duration = int((time.time() - start) * 1000)
        trace_service.finish_trace(trace_id, {"error": str(exc)}, "failed", duration)
        audit("chat_query_failed", user, "agent", agent["id"], {"trace_id": trace_id, "error": str(exc)}, request)
        raise


@router.post("/feedback")
def feedback(payload: FeedbackCreate, request: Request, user: dict = Depends(get_current_user)):
    if payload.trace_id:
        trace = db.one("SELECT user_id FROM traces WHERE id=?", [payload.trace_id])
        if trace and trace["user_id"] != user["id"] and "admin" not in user.get("roles", []):
            raise HTTPException(status_code=403, detail="No permission to comment on this trace")
    if payload.session_id:
        session = db.one("SELECT user_id FROM sessions WHERE id=?", [payload.session_id])
        if session and session["user_id"] != user["id"] and "admin" not in user.get("roles", []):
            raise HTTPException(status_code=403, detail="No permission to comment on this session")
    fid = db.new_id("fb")
    db.insert("feedback", {"id": fid, "session_id": payload.session_id, "message_id": payload.message_id, "trace_id": payload.trace_id, "user_id": user["id"], "rating": payload.rating, "feedback_type": payload.feedback_type, "comment": payload.comment, "created_at": db.now()})
    audit("create_feedback", user, "feedback", fid, payload.model_dump(), request)
    return {"ok": True, "id": fid}
