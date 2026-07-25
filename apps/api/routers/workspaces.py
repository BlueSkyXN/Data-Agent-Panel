from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..schemas import (
    WorkspaceCanvasUpdate,
    WorkspaceCreate,
    WorkspaceMemberUpsert,
    WorkspaceNoteCreate,
    WorkspaceNoteUpdate,
    WorkspaceResourceCreate,
    WorkspaceTaskCreate,
    WorkspaceTaskUpdate,
    WorkspaceUpdate,
)
from ..security import get_current_user
from ..services import workspace_service

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


@router.get("")
def list_workspaces(user: dict = Depends(get_current_user)):
    return workspace_service.list_workspaces(user)


@router.post("")
def create_workspace(payload: WorkspaceCreate, request: Request, user: dict = Depends(get_current_user)):
    return workspace_service.create_workspace(payload.model_dump(), user, request)


@router.get("/{space_id}")
def get_workspace(space_id: str, user: dict = Depends(get_current_user)):
    return workspace_service.get_workspace(space_id, user)


@router.patch("/{space_id}")
def update_workspace(space_id: str, payload: WorkspaceUpdate, request: Request, user: dict = Depends(get_current_user)):
    return workspace_service.update_workspace(space_id, payload.model_dump(exclude_unset=True), user, request)


@router.get("/{space_id}/members")
def list_members(space_id: str, user: dict = Depends(get_current_user)):
    return workspace_service.list_members(space_id, user)


@router.put("/{space_id}/members/{user_id}")
def upsert_member(space_id: str, user_id: str, payload: WorkspaceMemberUpsert, request: Request, user: dict = Depends(get_current_user)):
    return workspace_service.upsert_member(space_id, user_id, payload.role, user, request)


@router.delete("/{space_id}/members/{user_id}")
def remove_member(space_id: str, user_id: str, request: Request, user: dict = Depends(get_current_user)):
    workspace_service.remove_member(space_id, user_id, user, request)
    return {"ok": True}


@router.get("/{space_id}/resources")
def list_resources(space_id: str, user: dict = Depends(get_current_user)):
    return workspace_service.list_resources(space_id, user)


@router.post("/{space_id}/resources")
def add_resource(space_id: str, payload: WorkspaceResourceCreate, request: Request, user: dict = Depends(get_current_user)):
    return workspace_service.add_resource(space_id, payload.model_dump(), user, request)


@router.delete("/{space_id}/resources/{resource_row_id}")
def remove_resource(space_id: str, resource_row_id: str, request: Request, user: dict = Depends(get_current_user)):
    workspace_service.remove_resource(space_id, resource_row_id, user, request)
    return {"ok": True}


@router.get("/{space_id}/canvas")
def get_canvas(space_id: str, user: dict = Depends(get_current_user)):
    return workspace_service.get_canvas(space_id, user)


@router.put("/{space_id}/canvas")
def update_canvas(space_id: str, payload: WorkspaceCanvasUpdate, request: Request, user: dict = Depends(get_current_user)):
    return workspace_service.update_canvas(space_id, payload.model_dump(), user, request)


@router.get("/{space_id}/notes")
def list_notes(space_id: str, user: dict = Depends(get_current_user)):
    return workspace_service.list_notes(space_id, user)


@router.post("/{space_id}/notes")
def create_note(space_id: str, payload: WorkspaceNoteCreate, request: Request, user: dict = Depends(get_current_user)):
    return workspace_service.create_note(space_id, payload.model_dump(), user, request)


@router.patch("/{space_id}/notes/{note_id}")
def update_note(space_id: str, note_id: str, payload: WorkspaceNoteUpdate, request: Request, user: dict = Depends(get_current_user)):
    return workspace_service.update_note(space_id, note_id, payload.model_dump(exclude_unset=True), user, request)


@router.delete("/{space_id}/notes/{note_id}")
def delete_note(space_id: str, note_id: str, request: Request, user: dict = Depends(get_current_user)):
    workspace_service.delete_note(space_id, note_id, user, request)
    return {"ok": True}


@router.get("/{space_id}/tasks")
def list_tasks(space_id: str, user: dict = Depends(get_current_user)):
    return workspace_service.list_tasks(space_id, user)


@router.post("/{space_id}/tasks")
def create_task(space_id: str, payload: WorkspaceTaskCreate, request: Request, user: dict = Depends(get_current_user)):
    return workspace_service.create_task(space_id, payload.model_dump(), user, request)


@router.patch("/{space_id}/tasks/{task_id}")
def update_task(space_id: str, task_id: str, payload: WorkspaceTaskUpdate, request: Request, user: dict = Depends(get_current_user)):
    return workspace_service.update_task(space_id, task_id, payload.model_dump(exclude_unset=True), user, request)


@router.delete("/{space_id}/tasks/{task_id}")
def delete_task(space_id: str, task_id: str, request: Request, user: dict = Depends(get_current_user)):
    workspace_service.delete_task(space_id, task_id, user, request)
    return {"ok": True}
