from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from fastapi.testclient import TestClient
from apps.api.main import app

client = TestClient(app)

login = client.post('/api/auth/login', json={'username': 'admin', 'password': 'admin123'})
assert login.status_code == 200, login.text
token = login.json()['token']
h = {'Authorization': 'Bearer ' + token, 'X-Request-ID': 'codex-runtime-smoke'}

diag = client.get('/api/codex/diagnostics', headers=h)
assert diag.status_code == 200, diag.text
assert 'cli' in diag.json() and 'sdk' in diag.json(), diag.text

task = client.post('/api/codex/tasks', headers=h, json={
    'title': 'Codex runtime smoke test',
    'task_prompt': '检查独立数据智能体平台 Codex 运行台是否能创建、审批、mock 派发任务。不要修改代码。',
    'workspace_id': 'codex_ws_data_agent_platform',
    'mode': 'mock',
    'requires_approval': True,
    'risk_level': 'medium',
})
assert task.status_code == 200, task.text
task_id = task.json()['id']
assert task.json()['status'] == 'awaiting_approval', task.text

approved = client.post(f'/api/codex/tasks/{task_id}/approve', headers=h, json={'comment': 'smoke'})
assert approved.status_code == 200, approved.text
assert approved.json()['status'] == 'ready', approved.text

dispatched = client.post(f'/api/codex/tasks/{task_id}/dispatch', headers=h, json={'mode': 'mock'})
assert dispatched.status_code == 200, dispatched.text
assert dispatched.json()['status'] in {'completed', 'dispatched'}, dispatched.text

events = client.get(f'/api/codex/tasks/{task_id}/events', headers=h)
assert events.status_code == 200, events.text
assert len(events.json()) >= 3, events.text
print('Codex runtime smoke test passed')
