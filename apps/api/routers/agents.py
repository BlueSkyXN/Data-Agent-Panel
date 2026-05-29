import json
from fastapi import APIRouter, Depends, HTTPException, Request
from .. import db
from ..schemas import AgentCreate
from ..security import get_current_user, require_admin, audit, can_use_agent

router = APIRouter(prefix="/api/agents", tags=["agents"])

@router.get("")
def list_agents(user: dict = Depends(get_current_user)):
    rows = db.many("""
      SELECT a.*, av.version, av.backend_type, av.adapter_id
      FROM agents a LEFT JOIN agent_versions av ON av.id=a.default_version_id
      ORDER BY a.created_at DESC
    """)
    if "admin" not in user.get("roles", []):
        rows = [r for r in rows if can_use_agent(user, r["id"])]
    return rows

@router.post("")
def create_agent(payload: AgentCreate, request: Request, user: dict = Depends(require_admin)):
    agid = db.new_id("agent")
    verid = db.new_id("ver")
    t = db.now()
    db.insert("agents", {"id": agid, "name": payload.name, "code": payload.code, "type": payload.type, "description": payload.description, "owner_id": user["id"], "status": "draft", "default_version_id": verid, "risk_level": payload.risk_level, "require_human_approval": int(payload.require_human_approval), "created_at": t, "updated_at": t})
    db.insert("agent_versions", {"id": verid, "agent_id": agid, "version": "0.1.0", "backend_type": payload.backend_type, "adapter_id": payload.adapter_id, "config_json": json.dumps(payload.config_json, ensure_ascii=False), "input_schema": "{}", "output_schema": "{}", "status": "draft", "created_at": t})
    audit("create_agent", user, "agent", agid, payload.model_dump(), request)
    return db.one("SELECT * FROM agents WHERE id=?", [agid])

@router.get("/{agent_id}")
def get_agent(agent_id: str, user: dict = Depends(get_current_user)):
    if not can_use_agent(user, agent_id):
        raise HTTPException(status_code=403, detail="No permission to use this agent")
    agent = db.one("SELECT * FROM agents WHERE id=?", [agent_id])
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent["versions"] = db.many("SELECT * FROM agent_versions WHERE agent_id=? ORDER BY created_at DESC", [agent_id])
    agent["knowledge_bindings"] = db.many("SELECT kb.* FROM knowledge_bases kb JOIN knowledge_bindings b ON b.knowledge_base_id=kb.id WHERE b.agent_id=?", [agent_id])
    return agent

@router.post("/{agent_id}/publish")
def publish_agent(agent_id: str, request: Request, user: dict = Depends(require_admin)):
    db.update("agents", "id", agent_id, {"status": "published", "updated_at": db.now()})
    audit("publish_agent", user, "agent", agent_id, {}, request)
    return {"ok": True}

@router.post("/{agent_id}/disable")
def disable_agent(agent_id: str, request: Request, user: dict = Depends(require_admin)):
    db.update("agents", "id", agent_id, {"status": "disabled", "updated_at": db.now()})
    audit("disable_agent", user, "agent", agent_id, {}, request)
    return {"ok": True}
