import json
from fastapi import APIRouter, Depends, Request
from .. import db
from ..schemas import KnowledgeBaseCreate
from ..security import get_current_user, require_admin, audit

router = APIRouter(prefix="/api/knowledge-bases", tags=["knowledge"])

@router.get("")
def list_kbs(user: dict = Depends(get_current_user)):
    return db.many("SELECT * FROM knowledge_bases ORDER BY name")

@router.post("")
def create_kb(payload: KnowledgeBaseCreate, request: Request, user: dict = Depends(require_admin)):
    kid = db.new_id("kb")
    db.insert("knowledge_bases", {"id": kid, "name": payload.name, "type": payload.type, "backend_type": payload.backend_type, "adapter_id": payload.adapter_id, "description": payload.description, "owner_id": user["id"], "status": "active"})
    db.insert("knowledge_versions", {"id": db.new_id("kbv"), "knowledge_base_id": kid, "version": "1.0.0", "status": "active", "created_at": db.now()})
    audit("create_knowledge_base", user, "knowledge_base", kid, payload.model_dump(), request)
    return db.one("SELECT * FROM knowledge_bases WHERE id=?", [kid])

@router.get("/{kb_id}/versions")
def kb_versions(kb_id: str, user: dict = Depends(get_current_user)):
    return db.many("SELECT * FROM knowledge_versions WHERE knowledge_base_id=? ORDER BY created_at DESC", [kb_id])
