from fastapi import APIRouter, Depends, HTTPException
from .. import db
from ..security import get_current_user, can_use_agent

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

@router.get("")
def list_sessions(user: dict = Depends(get_current_user)):
    return db.many("SELECT * FROM sessions WHERE user_id=? ORDER BY updated_at DESC", [user["id"]])

@router.post("")
def create_session(agent_id: str | None = None, title: str | None = None, user: dict = Depends(get_current_user)):
    if agent_id and not can_use_agent(user, agent_id):
        raise HTTPException(status_code=403, detail="No permission to use this agent")
    sid = db.new_id("session")
    t = db.now()
    db.insert("sessions", {"id": sid, "user_id": user["id"], "agent_id": agent_id, "title": title or "新会话", "status": "active", "created_at": t, "updated_at": t})
    return db.one("SELECT * FROM sessions WHERE id=?", [sid])

@router.get("/{session_id}")
def get_session(session_id: str, user: dict = Depends(get_current_user)):
    session = db.one("SELECT * FROM sessions WHERE id=? AND user_id=?", [session_id, user["id"]])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session["messages"] = db.many("SELECT * FROM messages WHERE session_id=? ORDER BY created_at ASC", [session_id])
    return session
