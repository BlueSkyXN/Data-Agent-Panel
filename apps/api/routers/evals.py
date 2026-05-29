import json
from fastapi import APIRouter, Depends, HTTPException, Request
from .. import db
from ..schemas import EvalSetCreate, EvalCaseCreate, EvalRunCreate
from ..security import get_current_user, audit, can_use_agent
from ..services import adapters, trace_service

router = APIRouter(prefix="/api", tags=["evals"])

@router.get("/eval-sets")
def list_eval_sets(user: dict = Depends(get_current_user)):
    return db.many("SELECT * FROM eval_sets ORDER BY name")

@router.post("/eval-sets")
def create_eval_set(payload: EvalSetCreate, request: Request, user: dict = Depends(get_current_user)):
    eid = db.new_id("eval")
    db.insert("eval_sets", {"id": eid, "name": payload.name, "business_domain": payload.business_domain, "description": payload.description, "owner_id": user["id"]})
    audit("create_eval_set", user, "eval_set", eid, payload.model_dump(), request)
    return db.one("SELECT * FROM eval_sets WHERE id=?", [eid])

@router.get("/eval-sets/{eval_set_id}/cases")
def list_eval_cases(eval_set_id: str, user: dict = Depends(get_current_user)):
    rows = db.many("SELECT * FROM eval_cases WHERE eval_set_id=?", [eval_set_id])
    for r in rows:
        try: r["tags"] = json.loads(r.get("tags") or "[]")
        except Exception: pass
    return rows

@router.post("/eval-sets/{eval_set_id}/cases")
def create_eval_case(eval_set_id: str, payload: EvalCaseCreate, request: Request, user: dict = Depends(get_current_user)):
    cid = db.new_id("case")
    db.insert("eval_cases", {"id": cid, "eval_set_id": eval_set_id, "question": payload.question, "expected_answer": payload.expected_answer, "expected_sql": payload.expected_sql, "expected_chart_json": json.dumps(payload.expected_chart_json, ensure_ascii=False), "expected_report_outline": payload.expected_report_outline, "tags": json.dumps(payload.tags, ensure_ascii=False)})
    audit("create_eval_case", user, "eval_case", cid, payload.model_dump(), request)
    return db.one("SELECT * FROM eval_cases WHERE id=?", [cid])

@router.post("/eval-runs")
def create_eval_run(payload: EvalRunCreate, request: Request, user: dict = Depends(get_current_user)):
    if not can_use_agent(user, payload.agent_id):
        raise HTTPException(status_code=403, detail="No permission to use this agent")
    agent = db.one("SELECT * FROM agents WHERE id=?", [payload.agent_id])
    version = db.one("SELECT * FROM agent_versions WHERE id=?", [agent["default_version_id"]]) if agent else None
    if not agent or not version:
        raise HTTPException(status_code=404, detail="Agent not found")
    rid = db.new_id("erun")
    db.insert("eval_runs", {"id": rid, "eval_set_id": payload.eval_set_id, "agent_id": payload.agent_id, "agent_version": version["version"], "status": "running", "started_at": db.now(), "finished_at": None})
    cases = db.many("SELECT * FROM eval_cases WHERE eval_set_id=?", [payload.eval_set_id])
    for case in cases:
        trace_id = trace_service.create_trace(user["id"], case["question"], agent_id=agent["id"], agent_version=version["version"], request_id=getattr(request.state, "request_id", ""))
        out = adapters.call_adapter(agent, version, case["question"], trace_id, {}, user=user)
        trace_service.finish_trace(trace_id, out, "success", 0)
        score = 0.6
        if out.get("sql"):
            score += 0.2
        if out.get("charts"):
            score += 0.1
        if out.get("evidence"):
            score += 0.1
        db.insert("eval_results", {"id": db.new_id("eres"), "eval_run_id": rid, "eval_case_id": case["id"], "score": min(score, 1.0), "result_json": json.dumps({"trace_id": trace_id, "answer": out.get("answer")}, ensure_ascii=False), "error_type": None, "reviewer_id": None})
    db.update("eval_runs", "id", rid, {"status": "success", "finished_at": db.now()})
    audit("create_eval_run", user, "eval_run", rid, payload.model_dump(), request)
    return get_eval_run(rid, user)

@router.get("/eval-runs/{run_id}")
def get_eval_run(run_id: str, user: dict = Depends(get_current_user)):
    run = db.one("SELECT * FROM eval_runs WHERE id=?", [run_id])
    if not run:
        raise HTTPException(status_code=404, detail="Eval run not found")
    results = db.many("SELECT er.*, ec.question FROM eval_results er JOIN eval_cases ec ON ec.id=er.eval_case_id WHERE er.eval_run_id=?", [run_id])
    for r in results:
        try: r["result_json"] = json.loads(r.get("result_json") or "{}")
        except Exception: pass
    run["results"] = results
    return run
