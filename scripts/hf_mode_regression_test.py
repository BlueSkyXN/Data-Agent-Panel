from pathlib import Path
import os
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from apps.api import db
from apps.api.main import app

db.init_all(reset=False)
client = TestClient(app)
ops_headers = {"X-Ops-Token": os.environ["DAP_OPS_TOKEN"]} if os.getenv("DAP_OPS_TOKEN") else {}

root = client.get("/")
assert root.status_code == 200, root.text
headers = {k.lower(): v for k, v in root.headers.items()}
assert "x-frame-options" not in headers, headers
csp = headers.get("content-security-policy", "")
assert "huggingface.co" in csp, csp

for path in ["/api/health/live", "/healthz", "/nginx-health"]:
    r = client.get(path, headers=ops_headers)
    assert r.status_code == 200, (path, r.status_code, r.text)

ops_paths = ["/_ops/healthz", "/_ops/health", "/_ops/system", "/_ops/config", "/_ops/persistence", "/_ops/errors", "/_ops/metrics"]
for path in ops_paths:
    r = client.get(path, headers=ops_headers)
    expected = 200 if os.getenv("DAP_OPS_TOKEN") else 503
    assert r.status_code == expected, (path, r.status_code, r.text)

if os.getenv("DAP_OPS_TOKEN"):
    login = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert login.status_code == 200, login.text
    token = login.json()["token"]
    for headers_to_try in (
        {"Authorization": "Bearer " + token},
        {"X-DAP-Token": token},
        {"Authorization": "Bearer hf-proxy-token", "X-DAP-Token": token},
    ):
        r = client.get("/api/auth/me", headers=headers_to_try)
        assert r.status_code == 200, (headers_to_try, r.status_code, r.text)

    cookie_response = client.get("/_ops/", params={"token": os.environ["DAP_OPS_TOKEN"]}, follow_redirects=False)
    assert cookie_response.status_code == 303, cookie_response.text
    local_set_cookie = cookie_response.headers.get("set-cookie", "")
    assert "HttpOnly" in local_set_cookie, local_set_cookie
    assert "Secure" not in local_set_cookie, local_set_cookie
    dashboard = client.get("/_ops/")
    assert dashboard.status_code == 200, dashboard.text
    assert os.environ["DAP_OPS_TOKEN"] not in dashboard.text

    admin_console = client.get("/_admin/")
    assert admin_console.status_code == 200, admin_console.text

    secure_client = TestClient(app)
    secure_cookie_response = secure_client.get(
        "/_ops/",
        params={"token": os.environ["DAP_OPS_TOKEN"]},
        headers={"X-Forwarded-Proto": "https"},
        follow_redirects=False,
    )
    assert "Secure" in secure_cookie_response.headers.get("set-cookie", ""), secure_cookie_response.headers

print("HF mode regression test passed")
