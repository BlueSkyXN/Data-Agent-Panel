from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from fastapi.testclient import TestClient
from apps.api.main import app

client = TestClient(app)


def login(username="admin", password="admin123"):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def main():
    h = login()
    # Router should route to customer ticket analysis.
    r = client.post("/api/chat/query", headers=h, json={"agent_id": "agent_router", "message": "客户工单根因分布是什么？"})
    assert r.status_code == 200, r.text
    assert r.json()["result"]["answer_type"] == "ticket_analysis"

    # Data profile endpoint.
    r = client.get("/api/data/profile/dataset_orders", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["row_count"] > 0

    # Quality rules.
    r = client.post("/api/data/quality/run", headers=h, json={"dataset_id": "dataset_orders"})
    assert r.status_code == 200, r.text
    assert "results" in r.json()

    # Panel materialization.
    r = client.get("/api/data/panels/panel_business_overview", headers=h)
    assert r.status_code == 200, r.text
    assert len(r.json()["widgets"]) >= 3

    # Semantic coverage.
    r = client.get("/api/semantic/coverage", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["metric_count"] >= 3

    # Codex task create/approve/dispatch mock.
    r = client.post("/api/codex/tasks", headers=h, json={"title": "完善评测中心页面", "task_prompt": "请为独立数据智能体平台评测中心增加失败类型过滤和导出功能。", "mode": "mock", "requires_approval": True})
    assert r.status_code == 200, r.text
    task_id = r.json()["id"]
    assert r.json()["status"] == "awaiting_approval"
    r = client.post(f"/api/codex/tasks/{task_id}/approve", headers=h, json={"comment": "同意进入 mock 派发"})
    assert r.status_code == 200, r.text
    r = client.post(f"/api/codex/tasks/{task_id}/dispatch", headers=h, json={"mode": "mock"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] in {"completed", "dispatched"}

    # Codex via agent router.
    r = client.post("/api/chat/query", headers=h, json={"agent_id": "agent_router", "message": "帮我创建一个 Codex 任务，开发数据质量失败样本导出按钮"})
    assert r.status_code == 200, r.text
    assert r.json()["result"]["answer_type"] == "codex_task"
    print("Full-agent smoke test passed")


if __name__ == "__main__":
    main()
