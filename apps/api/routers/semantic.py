from __future__ import annotations

import json
from fastapi import APIRouter, Depends, Request

from .. import db
from ..schemas import SemanticTermCreate
from ..security import audit, can_read_dataset, get_current_user, require_permission

router = APIRouter(prefix="/api/semantic", tags=["semantic"])


@router.get("/terms")
def list_terms(q: str | None = None, business_domain: str | None = None, user: dict = Depends(get_current_user)):
    where = "WHERE 1=1"
    params = []
    if q:
        where += " AND (term LIKE ? OR definition LIKE ? OR synonyms LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
    if business_domain:
        where += " AND business_domain=?"
        params.append(business_domain)
    rows = db.many(f"SELECT * FROM semantic_terms {where} ORDER BY business_domain, term", params)
    for row in rows:
        try:
            row["synonyms"] = json.loads(row.get("synonyms") or "[]")
        except Exception:
            pass
    return rows


@router.post("/terms")
def create_term(payload: SemanticTermCreate, request: Request, user: dict = Depends(require_permission("dataset:manage"))):
    tid = db.new_id("term")
    db.insert("semantic_terms", {"id": tid, "term": payload.term, "term_type": payload.term_type, "business_domain": payload.business_domain, "definition": payload.definition, "canonical_object_type": payload.canonical_object_type, "canonical_object_id": payload.canonical_object_id, "synonyms": payload.synonyms, "owner_id": user["id"], "status": "published", "created_at": db.now()})
    audit("create_semantic_term", user, "semantic_term", tid, payload.model_dump(), request)
    return db.one("SELECT * FROM semantic_terms WHERE id=?", [tid])


@router.get("/query-templates")
def list_query_templates(business_domain: str | None = None, user: dict = Depends(get_current_user)):
    if business_domain:
        rows = db.many("SELECT * FROM query_templates WHERE business_domain=? ORDER BY intent, name", [business_domain])
    else:
        rows = db.many("SELECT * FROM query_templates ORDER BY business_domain, intent, name")
    visible = []
    for row in rows:
        if row.get("dataset_id") and not can_read_dataset(user, row["dataset_id"]):
            continue
        try:
            row["example_questions"] = json.loads(row.get("example_questions") or "[]")
        except Exception:
            pass
        visible.append(row)
    return visible


@router.get("/coverage")
def semantic_coverage(user: dict = Depends(get_current_user)):
    datasets = [d for d in db.many("SELECT * FROM datasets") if can_read_dataset(user, d["id"])]
    visible_dataset_ids = {d["id"] for d in datasets}
    metrics = [m for m in db.many("SELECT * FROM metrics") if m.get("dataset_id") in visible_dataset_ids]
    fields = [f for f in db.many("SELECT * FROM dataset_fields") if f.get("dataset_id") in visible_dataset_ids]
    terms = db.many("SELECT * FROM semantic_terms")
    metric_terms = {t["canonical_object_id"] for t in terms if t.get("canonical_object_type") == "metric"}
    missing_metric_terms = [m for m in metrics if m["id"] not in metric_terms]
    field_desc_missing = [f for f in fields if not f.get("description")]
    return {
        "dataset_count": len(datasets),
        "metric_count": len(metrics),
        "field_count": len(fields),
        "term_count": len(terms),
        "metric_term_coverage": round((len(metrics) - len(missing_metric_terms)) / max(1, len(metrics)), 4),
        "missing_metric_terms": missing_metric_terms[:20],
        "field_desc_missing_count": len(field_desc_missing),
    }
