from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from .. import db
from ..security import audit, get_current_user, require_admin

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("")
def list_reports(user: dict = Depends(get_current_user)):
    if "admin" in user.get("roles", []):
        return db.many("SELECT * FROM reports ORDER BY created_at DESC")
    return db.many("SELECT * FROM reports WHERE owner_id=? ORDER BY created_at DESC", [user["id"]])


@router.get("/{report_id}")
def get_report(report_id: str, user: dict = Depends(get_current_user)):
    report = db.one("SELECT * FROM reports WHERE id=?", [report_id])
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report["owner_id"] != user["id"] and "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="No permission")
    report["versions"] = db.many("SELECT * FROM report_versions WHERE report_id=? ORDER BY created_at DESC", [report_id])
    return report


@router.post("/{report_id}/submit-review")
def submit_review(report_id: str, request: Request, user: dict = Depends(get_current_user)):
    report = db.one("SELECT * FROM reports WHERE id=?", [report_id])
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report["owner_id"] != user["id"] and "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="No permission")
    db.update("reports", "id", report_id, {"status": "pending_review"})
    audit("submit_report_review", user, "report", report_id, {}, request)
    return {"ok": True}


@router.post("/{report_id}/approve")
def approve_report(report_id: str, request: Request, user: dict = Depends(require_admin)):
    if not db.one("SELECT * FROM reports WHERE id=?", [report_id]):
        raise HTTPException(status_code=404, detail="Report not found")
    db.update("reports", "id", report_id, {"status": "approved"})
    audit("approve_report", user, "report", report_id, {}, request)
    return {"ok": True}


@router.post("/{report_id}/publish")
def publish_report(report_id: str, request: Request, user: dict = Depends(require_admin)):
    if not db.one("SELECT * FROM reports WHERE id=?", [report_id]):
        raise HTTPException(status_code=404, detail="Report not found")
    db.update("reports", "id", report_id, {"status": "published"})
    audit("publish_report", user, "report", report_id, {}, request)
    return {"ok": True}
