from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request

from .. import db
from ..schemas import DataSourceCreate, DatasetCreate, MetricCreate
from ..security import audit, can_read_dataset, get_current_user, require_admin

router = APIRouter(prefix="/api", tags=["catalog"])


@router.get("/data-sources")
def list_data_sources(user: dict = Depends(get_current_user)):
    if "admin" not in user.get("roles", []):
        return []
    return db.many("SELECT * FROM data_sources ORDER BY created_at DESC")


@router.post("/data-sources")
def create_data_source(payload: DataSourceCreate, request: Request, user: dict = Depends(require_admin)):
    dsid = db.new_id("ds")
    db.insert("data_sources", {"id": dsid, "name": payload.name, "type": payload.type, "connection_config": json.dumps(payload.connection_config, ensure_ascii=False), "owner_id": user["id"], "status": "active", "created_at": db.now()})
    audit("create_data_source", user, "data_source", dsid, payload.model_dump(), request)
    return db.one("SELECT * FROM data_sources WHERE id=?", [dsid])


@router.get("/datasets")
def list_datasets(user: dict = Depends(get_current_user)):
    rows = db.many("SELECT * FROM datasets ORDER BY business_domain, name")
    if "admin" in user.get("roles", []):
        return rows
    return [r for r in rows if can_read_dataset(user, r["id"])]


@router.post("/datasets")
def create_dataset(payload: DatasetCreate, request: Request, user: dict = Depends(require_admin)):
    did = db.new_id("dataset")
    db.insert("datasets", {"id": did, "name": payload.name, "business_domain": payload.business_domain, "source_id": payload.source_id, "physical_table": payload.physical_table, "description": payload.description, "refresh_mode": "manual", "data_classification": "internal", "status": "active"})
    audit("create_dataset", user, "dataset", did, payload.model_dump(), request)
    return db.one("SELECT * FROM datasets WHERE id=?", [did])


@router.get("/datasets/{dataset_id}/fields")
def list_fields(dataset_id: str, user: dict = Depends(get_current_user)):
    if not can_read_dataset(user, dataset_id):
        raise HTTPException(status_code=403, detail="No permission to read dataset")
    rows = db.many("SELECT * FROM dataset_fields WHERE dataset_id=? ORDER BY field_name", [dataset_id])
    if "admin" in user.get("roles", []):
        return rows
    # Hide field-level sensitivity metadata from ordinary users.
    for r in rows:
        if r.get("is_sensitive"):
            r["display_name"] = r["display_name"] + "（脱敏）"
    return rows


@router.get("/metrics")
def list_metrics(user: dict = Depends(get_current_user)):
    rows = db.many("SELECT m.*, d.name AS dataset_name FROM metrics m LEFT JOIN datasets d ON d.id=m.dataset_id ORDER BY m.name")
    if "admin" in user.get("roles", []):
        return rows
    return [r for r in rows if can_read_dataset(user, r["dataset_id"])]


@router.post("/metrics")
def create_metric(payload: MetricCreate, request: Request, user: dict = Depends(require_admin)):
    mid = db.new_id("metric")
    db.insert("metrics", {"id": mid, "dataset_id": payload.dataset_id, "name": payload.name, "code": payload.code, "formula": payload.formula, "description": payload.description, "time_grain": payload.time_grain, "owner_id": user["id"], "status": "published"})
    audit("create_metric", user, "metric", mid, payload.model_dump(), request)
    return db.one("SELECT * FROM metrics WHERE id=?", [mid])
