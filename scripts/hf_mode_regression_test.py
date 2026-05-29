from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from apps.api.main import app

client = TestClient(app)

root = client.get("/")
assert root.status_code == 200, root.text
headers = {k.lower(): v for k, v in root.headers.items()}
assert "x-frame-options" not in headers, headers
csp = headers.get("content-security-policy", "")
assert "huggingface.co" in csp, csp

for path in ["/api/health/live", "/healthz", "/nginx-health", "/_ops/healthz", "/_ops/health", "/_ops/system", "/_ops/config"]:
    r = client.get(path)
    assert r.status_code == 200, (path, r.status_code, r.text)
print("HF mode regression test passed")
