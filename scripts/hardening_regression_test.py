from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import os
import sqlite3
import sys
import tempfile
import threading
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ['DAP_ALLOWED_EXTERNAL_AGENT_HOSTS'] = 'localhost,127.0.0.1'
os.environ['DAP_ALLOW_DEMO_SEED'] = 'true'
os.environ['DAP_CORS_ORIGINS'] = '*'
os.environ['DAP_DEMO_MODE'] = 'true'

from fastapi import HTTPException
from fastapi.testclient import TestClient
from apps.api import db
from apps.api.auth_utils import hash_secret, verify_secret
from apps.api.main import app
from apps.api.services.adapters import call_generic_http


def login(client, username, password):
    r = client.post('/api/auth/login', json={'username': username, 'password': password})
    assert r.status_code == 200, r.text
    return {'Authorization': 'Bearer ' + r.json()['token']}


def assert_demo_seed_can_be_disabled():
    original_db_path = db.DB_PATH
    original_business_db_path = db.BUSINESS_DB_PATH
    original_demo_mode = db.settings.demo_mode
    original_allow_demo_seed = db.settings.allow_demo_seed
    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db.DB_PATH = tmp_path / 'platform.db'
            db.BUSINESS_DB_PATH = tmp_path / 'business.db'
            db.settings.demo_mode = False
            db.settings.allow_demo_seed = False
            db.init_all(reset=True)
            assert db.one('SELECT id FROM users WHERE username=?', ['admin']) is None
            assert db.one('SELECT id FROM users WHERE username=?', ['user']) is None
            assert db.one('SELECT id FROM roles WHERE name=?', ['admin']) is not None
            owner_tables = [
                'project_spaces',
                'agents',
                'data_sources',
                'metrics',
                'knowledge_bases',
                'semantic_terms',
                'data_quality_rules',
                'dashboard_panels',
                'codex_workspaces',
                'eval_sets',
            ]
            for table in owner_tables:
                assert db.one(f"SELECT COUNT(*) c FROM {table} WHERE owner_id='u_admin'")['c'] == 0, table
            assert db.one("SELECT COUNT(*) c FROM space_members WHERE user_id IN ('u_admin','u_user')")['c'] == 0
    finally:
        db.DB_PATH = original_db_path
        db.BUSINESS_DB_PATH = original_business_db_path
        db.settings.demo_mode = original_demo_mode
        db.settings.allow_demo_seed = original_allow_demo_seed


class RedirectHandler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        self.send_response(302)
        self.send_header('Location', 'http://127.0.0.1:1/internal')
        self.end_headers()

    def log_message(self, format, *args):  # noqa: A002
        return


def assert_external_adapter_rejects_redirect():
    server = HTTPServer(('127.0.0.1', 0), RedirectHandler)
    thread = threading.Thread(target=server.handle_request)
    thread.start()
    adapter = {'id': 'adapter_redirect_test', 'endpoint': f'http://127.0.0.1:{server.server_port}/redirect', 'config_json': '{}', 'timeout_ms': 1000}
    try:
        try:
            call_generic_http(adapter, {'ping': True}, 'trace_redirect_regression')
        except HTTPException as exc:
            assert exc.status_code == 502
            assert 'redirects are not allowed' in str(exc.detail)
        else:
            raise AssertionError('external adapter followed or accepted a redirect')
    finally:
        thread.join(timeout=2)
        server.server_close()


def assert_readonly_business_connection_rejects_writes():
    with db.connect_readonly(db.BUSINESS_DB_PATH) as con:
        try:
            con.execute('CREATE TABLE readonly_probe(id INTEGER)')
        except sqlite3.DatabaseError as exc:
            assert 'readonly' in str(exc).lower() or 'write' in str(exc).lower(), exc
        else:
            raise AssertionError('readonly business connection accepted a write')


def main():
    db.init_all(reset=True)
    client = TestClient(app)
    admin = login(client, 'admin', 'admin123')
    user = login(client, 'user', 'user123')

    # Wildcard CORS must not advertise credentialed cross-origin access.
    r = client.options('/api/auth/login', headers={'Origin': 'https://example.invalid', 'Access-Control-Request-Method': 'POST'})
    assert r.status_code == 200, r.text
    assert r.headers.get('access-control-allow-origin') == '*', r.headers
    assert 'access-control-allow-credentials' not in {k.lower() for k in r.headers}, r.headers

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
    assert_readonly_business_connection_rejects_writes()

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

    # Startup seeding must not reset an existing user's password or login state.
    custom_hash = hash_secret('changed-admin-password')
    login_state = {'password_hash': custom_hash, 'failed_login_count': 2, 'locked_until': '2020-01-01T00:00:00Z', 'last_login_at': '2024-01-01T00:00:00Z'}
    db.update('users', 'id', 'u_admin', login_state)
    db.init_all(reset=False)
    seeded_admin = db.one('SELECT password_hash, failed_login_count, locked_until, last_login_at FROM users WHERE id=?', ['u_admin'])
    assert seeded_admin is not None
    assert verify_secret('changed-admin-password', seeded_admin['password_hash'])
    assert not verify_secret('admin123', seeded_admin['password_hash'])
    assert seeded_admin['failed_login_count'] == 2, seeded_admin
    assert seeded_admin['locked_until'] == login_state['locked_until'], seeded_admin
    assert seeded_admin['last_login_at'] == login_state['last_login_at'], seeded_admin
    r = client.post('/api/auth/login', json={'username': 'admin', 'password': 'admin123'})
    assert r.status_code == 401, r.text
    login(client, 'admin', 'changed-admin-password')

    assert_demo_seed_can_be_disabled()
    assert_external_adapter_rejects_redirect()
    db.init_all(reset=True)

    print('Hardening regression test passed')


if __name__ == '__main__':
    main()
