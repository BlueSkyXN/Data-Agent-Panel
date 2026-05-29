from fastapi import APIRouter, Depends, HTTPException
from ..security import get_current_user
from ..services.trace_service import get_trace

router = APIRouter(prefix="/api/traces", tags=["traces"])

@router.get("/{trace_id}")
def read_trace(trace_id: str, user: dict = Depends(get_current_user)):
    trace = get_trace(trace_id)
    if not trace:
        raise HTTPException(status_code=404, detail="Trace not found")
    if trace["user_id"] != user["id"] and "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="No permission")
    return trace
