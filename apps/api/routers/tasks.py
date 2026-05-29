import json
from fastapi import APIRouter, Depends, HTTPException
from .. import db
from ..security import get_current_user

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

@router.get("")
def list_tasks(user: dict = Depends(get_current_user)):
    if "admin" in user.get("roles", []):
        rows = db.many("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 200")
    else:
        rows = db.many("SELECT * FROM tasks WHERE user_id=? ORDER BY created_at DESC LIMIT 200", [user["id"]])
    for row in rows:
        if row.get("result_json"):
            try: row["result_json"] = json.loads(row["result_json"])
            except Exception: pass
    return rows

@router.get("/{task_id}")
def get_task(task_id: str, user: dict = Depends(get_current_user)):
    task = db.one("SELECT * FROM tasks WHERE id=?", [task_id])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["user_id"] != user["id"] and "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="No permission")
    return task
