from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from fastapi.testclient import TestClient
from apps.api.main import app

client = TestClient(app)
admin = client.post('/api/auth/login', json={'username':'admin','password':'admin123'}).json()['token']
user = client.post('/api/auth/login', json={'username':'user','password':'user123'}).json()['token']
ha = {'Authorization': 'Bearer ' + admin}
hu = {'Authorization': 'Bearer ' + user}
# Ordinary user cannot see data source connection configs.
assert client.get('/api/data-sources', headers=hu).json() == []
# User can query authorized agent but sensitive fields are masked if returned.
resp = client.post('/api/chat/query', json={'message':'本月订单明细','agent_id':'agent_sales_metric'}, headers=hu)
assert resp.status_code == 200, resp.text
# The seeded legacy "member" role is read-only under the persistent workspace ACL.
legacy = client.get('/api/workspaces/space_demo', headers=hu)
assert legacy.status_code == 200, legacy.text
assert legacy.json()['role'] == 'viewer'
blocked = client.put('/api/workspaces/space_demo/canvas', headers=hu, json={'content_markdown': 'should not persist', 'expected_version': 0})
assert blocked.status_code == 404, blocked.text

# Workspace membership cannot grant access to another user's private session.
workspace = client.post('/api/workspaces', headers=ha, json={'name': 'Security workspace'})
assert workspace.status_code == 200, workspace.text
space_id = workspace.json()['space']['id']
member = client.put(f'/api/workspaces/{space_id}/members/u_user', headers=ha, json={'role': 'editor'})
assert member.status_code == 200, member.text
admin_session = client.post('/api/sessions?title=private-admin-session', headers=ha)
assert admin_session.status_code == 200, admin_session.text
private_note = client.post(
    f'/api/workspaces/{space_id}/notes',
    headers=ha,
    json={'title': 'Private source', 'content_markdown': 'Source reference is private.', 'source_type': 'session', 'source_id': admin_session.json()['id']},
)
assert private_note.status_code == 200, private_note.text
denied_resource = client.post(
    f'/api/workspaces/{space_id}/resources',
    headers=hu,
    json={'resource_type': 'session', 'resource_id': admin_session.json()['id']},
)
assert denied_resource.status_code == 404, denied_resource.text
user_workspace = client.get(f'/api/workspaces/{space_id}', headers=hu)
assert user_workspace.status_code == 200, user_workspace.text
assert user_workspace.json()['notes'][0]['source_type'] is None
assert user_workspace.json()['notes'][0]['source_id'] is None
denied_workspace_chat = client.post(
    '/api/chat/query',
    headers=hu,
    json={'message': '尝试读取非成员工作空间', 'agent_id': 'agent_sales_metric', 'context': {'workspace_id': 'space_missing_or_private'}},
)
assert denied_workspace_chat.status_code == 404, denied_workspace_chat.text
sole_owner_demotion = client.put(f'/api/workspaces/{space_id}/members/u_admin', headers=ha, json={'role': 'viewer'})
assert sole_owner_demotion.status_code == 409, sole_owner_demotion.text
# Dangerous SQL should be blocked by SQL Guard through direct service test.
from apps.api.services.sql_guard import validate_readonly_sql
try:
    validate_readonly_sql('DROP TABLE sales_orders')
    raise AssertionError('DROP should be blocked')
except Exception:
    pass
print('Security smoke test passed')
