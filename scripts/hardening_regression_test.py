from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from apps.api import db
from apps.api.main import app


def login(client, username, password):
    r = client.post('/api/auth/login', json={'username': username, 'password': password})
    assert r.status_code == 200, r.text
    return {'Authorization': 'Bearer ' + r.json()['token']}


def main():
    db.init_all(reset=True)
    client = TestClient(app)
    admin = login(client, 'admin', 'admin123')
    user = login(client, 'user', 'user123')

    # /api/admin/stats must not be available to ordinary users.
    r = client.get('/api/admin/stats', headers=user)
    assert r.status_code == 403, r.text

    # SQL Guard must reject queries that include the selected table plus an unauthorized table.
    join_sql = "SELECT o.channel, t.root_cause FROM sales_orders o JOIN support_tickets t ON o.region=t.region"
    r = client.post('/api/data/query', headers=admin, json={'dataset_id': 'dataset_orders', 'sql': join_sql})
    assert r.status_code == 400, r.text

    # SQL Guard must cap caller-supplied LIMIT values.
    r = client.post('/api/data/query', headers=admin, json={'dataset_id': 'dataset_orders', 'sql': 'SELECT * FROM sales_orders LIMIT 99999', 'max_rows': 7})
    assert r.status_code == 200, r.text
    assert r.json()['row_count'] <= 7, r.text

    # Profile and panel direct API calls should return a usable trace id.
    r = client.get('/api/data/profile/dataset_orders', headers=admin)
    assert r.status_code == 200, r.text
    trace_id = r.json().get('trace_id')
    assert trace_id
    assert client.get(f'/api/traces/{trace_id}', headers=admin).status_code == 200

    r = client.get('/api/data/panels/panel_business_overview', headers=admin)
    assert r.status_code == 200, r.text
    trace_id = r.json().get('trace_id')
    assert trace_id
    assert client.get(f'/api/traces/{trace_id}', headers=admin).status_code == 200

    # Session ownership must be enforced.
    r = client.post('/api/chat/query', headers=admin, json={'message': '本月收入最高的渠道有哪些？', 'agent_id': 'agent_sales_metric'})
    assert r.status_code == 200, r.text
    foreign_session = r.json()['session_id']
    r = client.post('/api/chat/query', headers=user, json={'session_id': foreign_session, 'message': '偷用别人的会话', 'agent_id': 'agent_sales_metric'})
    assert r.status_code == 403, r.text

    # Feedback must not be attachable to another user's trace/session.
    r = client.post('/api/chat/feedback', headers=user, json={'session_id': foreign_session, 'rating': 'wrong', 'comment': 'bad'})
    assert r.status_code == 403, r.text

    # CSV importer must sanitize hostile headers instead of throwing a 500 or executing injected SQL.
    files = {'file': ('bad.csv', 'a);DROP TABLE sales_orders;--,b,b\n1,2,3\n', 'text/csv')}
    r = client.post('/api/data/import/csv?dataset_name=bad&business_domain=Tmp', headers=admin, files=files)
    assert r.status_code == 200, r.text
    cols = r.json()['columns']
    assert len(cols) == len(set(cols)) == 3, r.text
    assert all('drop' not in c.lower() for c in cols), r.text
    # Existing business table still exists.
    r = client.post('/api/data/query', headers=admin, json={'dataset_id': 'dataset_orders', 'sql': 'SELECT COUNT(*) AS c FROM sales_orders'})
    assert r.status_code == 200, r.text
    assert r.json()['rows'][0]['c'] > 0

    # Startup seeding should be idempotent for agent permissions.
    before = db.one('SELECT COUNT(*) c FROM agent_permissions')['c']
    db.init_all(reset=False)
    after = db.one('SELECT COUNT(*) c FROM agent_permissions')['c']
    assert before == after, (before, after)

    print('Hardening regression test passed')


if __name__ == '__main__':
    main()
