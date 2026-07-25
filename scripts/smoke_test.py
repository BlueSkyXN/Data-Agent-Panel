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

workspace = client.post('/api/workspaces', json={'name': 'Smoke workspace', 'description': 'persistent workspace smoke'}, headers=h)
assert workspace.status_code == 200, workspace.text
space_id = workspace.json()['space']['id']
assert workspace.json()['role'] == 'owner'
listed = client.get('/api/workspaces', headers=h)
assert listed.status_code == 200, listed.text
assert any(row['id'] == space_id and row['role'] == 'owner' for row in listed.json())
resource = client.post(f'/api/workspaces/{space_id}/resources', json={'resource_type': 'dataset', 'resource_id': 'dataset_orders'}, headers=h)
assert resource.status_code == 200, resource.text
canvas = client.put(f'/api/workspaces/{space_id}/canvas', json={'content_markdown': '# Smoke canvas', 'expected_version': 0, 'reason': 'smoke'}, headers=h)
assert canvas.status_code == 200, canvas.text
assert canvas.json()['version'] == 1
conflict = client.put(f'/api/workspaces/{space_id}/canvas', json={'content_markdown': 'stale write', 'expected_version': 0}, headers=h)
assert conflict.status_code == 409, conflict.text
for version in range(1, 13):
    revision = client.put(f'/api/workspaces/{space_id}/canvas', json={'content_markdown': f'# Smoke canvas {version}', 'expected_version': version}, headers=h)
    assert revision.status_code == 200, revision.text
    assert revision.json()['version'] == version + 1
note = client.post(f'/api/workspaces/{space_id}/notes', json={'title': 'Smoke note', 'content_markdown': 'Workspace note'}, headers=h)
assert note.status_code == 200, note.text
task = client.post(f'/api/workspaces/{space_id}/tasks', json={'title': 'Smoke task'}, headers=h)
assert task.status_code == 200, task.text
workspace_chat = client.post(
    '/api/chat/query',
    json={'message': '基于当前工作空间继续分析', 'agent_id': 'agent_sales_metric', 'context': {'workspace_id': space_id}},
    headers=h,
)
assert workspace_chat.status_code == 200, workspace_chat.text
workspace_trace = client.get('/api/traces/' + workspace_chat.json()['trace_id'], headers=h)
assert workspace_trace.status_code == 200, workspace_trace.text
assert any(step.get('step_type') == 'workspace_context' for step in workspace_trace.json().get('steps', []))
assert '# Smoke canvas 12' not in str(workspace_trace.json())
detail = client.get(f'/api/workspaces/{space_id}', headers=h)
assert detail.status_code == 200, detail.text
assert detail.json()['canvas']['content_markdown'] == '# Smoke canvas 12'
assert len(detail.json()['resources']) == 1
assert len(detail.json()['notes']) == 1
assert len(detail.json()['tasks']) == 1
from apps.api import db
assert db.one('SELECT COUNT(*) AS c FROM workspace_canvas_revisions WHERE space_id=?', [space_id])['c'] == 12
canvas_audit = db.one("SELECT detail_json FROM audit_logs WHERE action='update_workspace_canvas' AND object_id=? ORDER BY created_at DESC LIMIT 1", [space_id])
assert '# Smoke canvas' not in canvas_audit['detail_json']
from apps.api.services.adapters import _redact_context_pack_content
safe_workspace_context = _redact_context_pack_content({'workspace': {'id': space_id, 'canvas_markdown': 'secret canvas body', 'notes': [{'content_markdown': 'secret note'}], 'open_tasks': [{'detail_markdown': 'secret task'}], 'resources': [{'resource_type': 'dataset'}]}})
assert 'secret canvas body' not in str(safe_workspace_context)
assert 'secret note' not in str(safe_workspace_context)
assert 'secret task' not in str(safe_workspace_context)
print('Smoke test passed:', trace_id)
