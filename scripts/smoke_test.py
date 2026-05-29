from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from fastapi.testclient import TestClient
from apps.api.main import app

client = TestClient(app)

login = client.post('/api/auth/login', json={'username':'admin','password':'admin123'})
assert login.status_code == 200, login.text
token = login.json()['token']
h = {'Authorization': 'Bearer ' + token, 'X-Request-ID': 'smoke-admin'}
assert client.get('/api/agents', headers=h).status_code == 200
resp = client.post('/api/chat/query', json={'message':'本月收入最高的渠道有哪些？','agent_id':'agent_sales_metric'}, headers=h)
assert resp.status_code == 200, resp.text
trace_id = resp.json()['trace_id']
trace = client.get('/api/traces/' + trace_id, headers=h)
assert trace.status_code == 200, trace.text
assert trace.json()['sql_runs']
analysis = client.post('/api/analysis/tasks', json={'question':'本月收入变化的主要原因是什么？','agent_id':'agent_business_analysis'}, headers=h)
assert analysis.status_code == 200, analysis.text
if analysis.json().get('status') == 'awaiting_approval':
    task_id = analysis.json()['task_id']
    approved = client.post(f'/api/analysis/tasks/{task_id}/approve-plan', headers=h)
    assert approved.status_code == 200, approved.text
print('Smoke test passed:', trace_id)
