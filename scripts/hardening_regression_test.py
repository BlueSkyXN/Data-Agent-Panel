from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import json
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
from apps.api.rate_limiter import check_rate_limit
from apps.api.routers import data as data_router
from apps.api.services.adapters import call_generic_http
from scripts.sqlite_maintenance import copy_sqlite_snapshot, maintain_databases
from scripts.sqlite_backup import backup_databases, main as sqlite_backup_main, rehearse_restore, verify_backup_dir
from scripts.sqlite_ops_lock import SQLiteOpsLockTimeout, sqlite_ops_lock


def login(client, username, password):
    r = client.post('/api/auth/login', json={'username': username, 'password': password})
    assert r.status_code == 200, r.text
    return {'Authorization': 'Bearer ' + r.json()['token']}


def ops_headers():
    """Use the configured read-only ops token when CI enables the HF boundary."""
    return {'X-Ops-Token': db.settings.ops_token} if db.settings.ops_token else {}


def assert_demo_seed_can_be_disabled():
    original_db_path = db.DB_PATH
    original_business_db_path = db.BUSINESS_DB_PATH
    original_demo_mode = db.settings.demo_mode
    original_allow_demo_seed = db.settings.allow_demo_seed
    original_bootstrap_username = db.settings.bootstrap_admin_username
    original_bootstrap_password = db.settings.bootstrap_admin_password
    original_bootstrap_name = db.settings.bootstrap_admin_name
    original_bootstrap_email = db.settings.bootstrap_admin_email
    original_bootstrap_department = db.settings.bootstrap_admin_department
    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db.DB_PATH = tmp_path / 'platform.db'
            db.BUSINESS_DB_PATH = tmp_path / 'business.db'
            db.settings.demo_mode = False
            db.settings.allow_demo_seed = False
            db.settings.bootstrap_admin_username = ''
            db.settings.bootstrap_admin_password = ''
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
        db.settings.bootstrap_admin_username = original_bootstrap_username
        db.settings.bootstrap_admin_password = original_bootstrap_password
        db.settings.bootstrap_admin_name = original_bootstrap_name
        db.settings.bootstrap_admin_email = original_bootstrap_email
        db.settings.bootstrap_admin_department = original_bootstrap_department


def assert_bootstrap_admin_can_seed_empty_sqlite():
    original_db_path = db.DB_PATH
    original_business_db_path = db.BUSINESS_DB_PATH
    original_demo_mode = db.settings.demo_mode
    original_allow_demo_seed = db.settings.allow_demo_seed
    original_bootstrap_username = db.settings.bootstrap_admin_username
    original_bootstrap_password = db.settings.bootstrap_admin_password
    original_bootstrap_name = db.settings.bootstrap_admin_name
    original_bootstrap_email = db.settings.bootstrap_admin_email
    original_bootstrap_department = db.settings.bootstrap_admin_department
    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db.DB_PATH = tmp_path / 'platform.db'
            db.BUSINESS_DB_PATH = tmp_path / 'business.db'
            db.settings.demo_mode = False
            db.settings.allow_demo_seed = False
            db.settings.bootstrap_admin_username = 'first-admin'
            db.settings.bootstrap_admin_password = 'initial-admin-pass'
            db.settings.bootstrap_admin_name = 'First Admin'
            db.settings.bootstrap_admin_email = 'first-admin@example.invalid'
            db.settings.bootstrap_admin_department = 'Platform'
            db.init_all(reset=True)
            user = db.one('SELECT * FROM users WHERE username=?', ['first-admin'])
            assert user is not None
            assert verify_secret('initial-admin-pass', user['password_hash'])
            roles = db.many(
                'SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=?',
                [user['id']],
            )
            assert [r['name'] for r in roles] == ['admin'], roles
            audit = db.one("SELECT * FROM audit_logs WHERE action='bootstrap_admin_created' AND object_id=?", [user['id']])
            assert audit is not None
            db.settings.bootstrap_admin_password = 'rotated-env-value-should-not-reset-existing-admin'
            db.init_all(reset=False)
            unchanged = db.one('SELECT password_hash FROM users WHERE id=?', [user['id']])
            assert verify_secret('initial-admin-pass', unchanged['password_hash'])
            assert not verify_secret('rotated-env-value-should-not-reset-existing-admin', unchanged['password_hash'])
    finally:
        db.DB_PATH = original_db_path
        db.BUSINESS_DB_PATH = original_business_db_path
        db.settings.demo_mode = original_demo_mode
        db.settings.allow_demo_seed = original_allow_demo_seed
        db.settings.bootstrap_admin_username = original_bootstrap_username
        db.settings.bootstrap_admin_password = original_bootstrap_password
        db.settings.bootstrap_admin_name = original_bootstrap_name
        db.settings.bootstrap_admin_email = original_bootstrap_email
        db.settings.bootstrap_admin_department = original_bootstrap_department


def assert_bootstrap_admin_takes_precedence_over_demo_admin():
    original_db_path = db.DB_PATH
    original_business_db_path = db.BUSINESS_DB_PATH
    original_demo_mode = db.settings.demo_mode
    original_allow_demo_seed = db.settings.allow_demo_seed
    original_bootstrap_username = db.settings.bootstrap_admin_username
    original_bootstrap_password = db.settings.bootstrap_admin_password
    original_bootstrap_name = db.settings.bootstrap_admin_name
    original_bootstrap_email = db.settings.bootstrap_admin_email
    original_bootstrap_department = db.settings.bootstrap_admin_department

    def admin_role_count(user_id):
        return db.one(
            """
            SELECT COUNT(*) c
            FROM user_roles ur
            JOIN roles r ON r.id=ur.role_id
            WHERE ur.user_id=? AND r.name='admin'
            """,
            [user_id],
        )['c']

    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db.DB_PATH = tmp_path / 'platform.db'
            db.BUSINESS_DB_PATH = tmp_path / 'business.db'
            db.settings.demo_mode = True
            db.settings.allow_demo_seed = True
            db.settings.bootstrap_admin_name = 'Configured Admin'
            db.settings.bootstrap_admin_email = 'configured-admin@example.invalid'
            db.settings.bootstrap_admin_department = 'Platform'

            # A configured custom username owns the demo fixtures without also
            # leaving the default admin/admin123 account available.
            db.settings.bootstrap_admin_username = 'configured-admin'
            db.settings.bootstrap_admin_password = 'configured-admin-pass'
            db.init_all(reset=True)
            user = db.one('SELECT * FROM users WHERE username=?', ['configured-admin'])
            assert user is not None
            assert user['status'] == 'active'
            assert verify_secret('configured-admin-pass', user['password_hash'])
            assert admin_role_count(user['id']) == 1
            assert db.one('SELECT id FROM users WHERE username=?', ['admin']) is None
            assert db.one('SELECT id FROM users WHERE username=?', ['user']) is not None
            assert db.one('SELECT id FROM tool_adapters WHERE id=?', ['ad_mock_router']) is not None
            assert db.one('SELECT id FROM datasets WHERE id=?', ['dataset_orders']) is not None
            assert db.one('SELECT owner_id FROM project_spaces WHERE id=?', ['space_demo'])['owner_id'] == user['id']
            assert db.one('SELECT owner_id FROM data_sources WHERE id=?', ['ds_business_sqlite'])['owner_id'] == user['id']

            before = {
                'users': db.one('SELECT COUNT(*) c FROM users')['c'],
                'admin_roles': admin_role_count(user['id']),
                'audits': db.one(
                    "SELECT COUNT(*) c FROM audit_logs WHERE action='bootstrap_admin_created' AND object_id=?",
                    [user['id']],
                )['c'],
            }
            db.settings.bootstrap_admin_password = 'changed-env-value-must-not-reset-admin'
            db.init_all(reset=False)
            unchanged = db.one('SELECT password_hash FROM users WHERE id=?', [user['id']])
            assert verify_secret('configured-admin-pass', unchanged['password_hash'])
            assert not verify_secret('changed-env-value-must-not-reset-admin', unchanged['password_hash'])
            assert db.one('SELECT COUNT(*) c FROM users')['c'] == before['users']
            assert admin_role_count(user['id']) == before['admin_roles']
            assert db.one(
                "SELECT COUNT(*) c FROM audit_logs WHERE action='bootstrap_admin_created' AND object_id=?",
                [user['id']],
            )['c'] == before['audits']

            # The default username must use the configured password, never the
            # demo password, when it is the bootstrap target.
            db.settings.bootstrap_admin_username = 'admin'
            db.settings.bootstrap_admin_password = 'configured-default-name-pass'
            db.init_all(reset=True)
            named_admin = db.one('SELECT * FROM users WHERE username=?', ['admin'])
            assert named_admin is not None
            assert verify_secret('configured-default-name-pass', named_admin['password_hash'])
            assert not verify_secret('admin123', named_admin['password_hash'])
            assert admin_role_count(named_admin['id']) == 1

            # An existing demo user matching the configured username is
            # promoted in place and becomes the demo fixture owner.
            db.settings.bootstrap_admin_username = 'user'
            db.settings.bootstrap_admin_password = 'promoted-user-pass'
            db.init_all(reset=True)
            promoted = db.one('SELECT * FROM users WHERE username=?', ['user'])
            assert promoted is not None
            assert promoted['id'] == 'u_user'
            assert verify_secret('promoted-user-pass', promoted['password_hash'])
            assert admin_role_count(promoted['id']) == 1
            assert db.one('SELECT id FROM users WHERE username=?', ['admin']) is None
            assert db.one('SELECT owner_id FROM project_spaces WHERE id=?', ['space_demo'])['owner_id'] == promoted['id']
            assert db.one(
                "SELECT COUNT(*) c FROM audit_logs WHERE action='bootstrap_admin_elevated' AND object_id=?",
                [promoted['id']],
            )['c'] == 1

            # Existing installations that still have the known demo password
            # are hardened when a custom bootstrap administrator is added.
            db.settings.bootstrap_admin_username = ''
            db.settings.bootstrap_admin_password = ''
            db.init_all(reset=True)
            seeded_default = db.one('SELECT * FROM users WHERE username=?', ['admin'])
            assert seeded_default is not None
            assert verify_secret('admin123', seeded_default['password_hash'])
            db.update('users', 'id', seeded_default['id'], {'password': 'admin123', 'password_hash': ''})
            db.settings.bootstrap_admin_username = 'migrated-admin'
            db.settings.bootstrap_admin_password = 'migrated-admin-pass'
            db.init_all(reset=False)
            migrated = db.one('SELECT * FROM users WHERE username=?', ['migrated-admin'])
            hardened_default = db.one('SELECT * FROM users WHERE username=?', ['admin'])
            assert migrated is not None
            assert verify_secret('migrated-admin-pass', migrated['password_hash'])
            assert admin_role_count(migrated['id']) == 1
            assert hardened_default is not None
            assert hardened_default['status'] != 'active'
            assert hardened_default['password'] == ''
            assert not verify_secret('admin123', hardened_default['password_hash'])
            assert db.one('SELECT owner_id FROM project_spaces WHERE id=?', ['space_demo'])['owner_id'] == migrated['id']
    finally:
        db.DB_PATH = original_db_path
        db.BUSINESS_DB_PATH = original_business_db_path
        db.settings.demo_mode = original_demo_mode
        db.settings.allow_demo_seed = original_allow_demo_seed
        db.settings.bootstrap_admin_username = original_bootstrap_username
        db.settings.bootstrap_admin_password = original_bootstrap_password
        db.settings.bootstrap_admin_name = original_bootstrap_name
        db.settings.bootstrap_admin_email = original_bootstrap_email
        db.settings.bootstrap_admin_department = original_bootstrap_department


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


def assert_sqlite_rate_limiter_persists_events():
    key = f"regression:{db.new_id('rate')}"
    check_rate_limit(key, 2, window_seconds=60)
    check_rate_limit(key, 2, window_seconds=60)
    stored = db.one('SELECT COUNT(*) c FROM rate_limit_events WHERE bucket_key=?', [key])
    assert stored['c'] == 2, stored
    try:
        check_rate_limit(key, 2, window_seconds=60)
    except HTTPException as exc:
        assert exc.status_code == 429
    else:
        raise AssertionError('SQLite-backed rate limiter accepted a request over the limit')


def assert_platform_metadata_tracks_sqlite_schema(client):
    metadata = db.get_platform_metadata()
    assert metadata['schema_version']['value'] == str(db.SCHEMA_VERSION), metadata
    assert metadata['app_version']['value'] == db.settings.app_version, metadata
    assert metadata['initialized_at']['value'], metadata
    assert metadata['last_migrated_at']['value'], metadata
    with db.connect_readonly() as con:
        assert con.execute('PRAGMA user_version').fetchone()[0] == db.SCHEMA_VERSION
    r = client.get('/_ops/persistence', headers=ops_headers())
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload['schema']['expected_platform_schema_version'] == db.SCHEMA_VERSION, payload
    assert payload['schema']['platform_user_version'] == db.SCHEMA_VERSION, payload
    assert payload['schema']['platform_metadata']['schema_version']['value'] == str(db.SCHEMA_VERSION), payload
    assert payload['platform_db']['estimated_size_bytes'] > 0, payload


def assert_readiness_checks_sqlite_runtime(client):
    r = client.get('/api/health/ready')
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload['status'] == 'ok', payload
    assert payload['checks']['platform_db']['user_version'] == db.SCHEMA_VERSION, payload
    assert payload['checks']['platform_db']['active_admin_count'] > 0, payload
    assert payload['checks']['business_db']['sales_order_count'] > 0, payload
    assert payload['checks']['sqlite_backup']['status'] == 'missing', payload
    assert payload['checks']['sqlite_storage']['status'] in {'ok', 'disabled'}, payload
    assert payload['checks']['sqlite_storage']['free_mb'] >= 0, payload
    original_db_path = db.DB_PATH
    original_settings_db_path = db.settings.db_path
    try:
        with tempfile.TemporaryDirectory() as tmp:
            missing_path = Path(tmp) / 'missing-platform.db'
            db.DB_PATH = missing_path
            db.settings.db_path = missing_path
            failed = client.get('/api/health/ready')
            assert failed.status_code == 503, failed.text
            failed_payload = failed.json()
            assert failed_payload['status'] == 'not_ready', failed_payload
            assert failed_payload['checks']['platform_db']['ok'] is False, failed_payload
            assert 'error' in failed_payload['checks']['platform_db'], failed_payload
    finally:
        db.DB_PATH = original_db_path
        db.settings.db_path = original_settings_db_path


def assert_sqlite_storage_status_is_exposed(client):
    storage = db.get_sqlite_storage_status(min_free_mb=0)
    assert storage['enabled'] is False, storage
    assert storage['ok'] is True, storage
    assert storage['status'] == 'disabled', storage
    assert storage['free_mb'] >= 0, storage
    forced_threshold = int(storage['free_mb']) + 1
    low = db.get_sqlite_storage_status(min_free_mb=forced_threshold)
    assert low['enabled'] is True, low
    assert low['ok'] is False, low
    assert low['status'] == 'low_free_space', low

    original_min_free_mb = db.settings.sqlite_min_free_mb
    try:
        db.settings.sqlite_min_free_mb = forced_threshold
        r = client.get('/_ops/persistence', headers=ops_headers())
        assert r.status_code == 200, r.text
        persistence = r.json()
        assert persistence['sqlite_storage']['status'] == 'low_free_space', persistence
        r = client.get('/_ops/metrics', headers=ops_headers())
        assert r.status_code == 200, r.text
        assert 'dap_sqlite_storage_ok 0' in r.text, r.text
        assert 'dap_sqlite_storage_free_mb' in r.text, r.text
        assert 'dap_sqlite_storage_min_free_mb' in r.text, r.text
    finally:
        db.settings.sqlite_min_free_mb = original_min_free_mb


def assert_sqlite_runtime_path_warnings_are_specific():
    original_app_env = db.settings.app_env
    original_hf_space = db.settings.hf_space
    original_data_dir = db.settings.data_dir
    original_db_path = db.settings.db_path
    original_business_db_path = db.settings.business_db_path
    try:
        db.settings.app_env = 'production'
        db.settings.hf_space = True
        db.settings.data_dir = Path('/persist/data-agent-platform')
        db.settings.db_path = Path('/tmp/dap-platform.db')
        db.settings.business_db_path = ROOT / 'data' / 'business_sample.db'
        warnings = db.settings.validate_for_runtime()
        assert any('DAP_DB_PATH is outside DAP_DATA_DIR' in item for item in warnings), warnings
        assert any('DAP_DB_PATH points under /tmp' in item for item in warnings), warnings
        assert any('DAP_BUSINESS_DB_PATH is outside DAP_DATA_DIR' in item for item in warnings), warnings
        assert any('DAP_BUSINESS_DB_PATH points inside the repository' in item for item in warnings), warnings
    finally:
        db.settings.app_env = original_app_env
        db.settings.hf_space = original_hf_space
        db.settings.data_dir = original_data_dir
        db.settings.db_path = original_db_path
        db.settings.business_db_path = original_business_db_path


def assert_sqlite_reference_status_detects_orphans(client):
    baseline = db.get_sqlite_reference_status()
    assert baseline['ok'], baseline
    bad_dataset_id = 'dataset_missing_table_regression'
    db.insert(
        'datasets',
        {
            'id': bad_dataset_id,
            'name': 'Missing table regression',
            'business_domain': 'Regression',
            'source_id': 'ds_business_sqlite',
            'physical_table': 'missing_table_regression',
            'description': 'regression only',
            'refresh_mode': 'manual',
            'data_classification': 'internal',
            'status': 'active',
        },
    )
    try:
        status = db.get_sqlite_reference_status()
        assert not status['ok'], status
        missing = status['checks']['active_sqlite_datasets_missing_table']
        assert missing['count'] >= 1, status
        assert any(item['id'] == bad_dataset_id for item in missing['samples']), status
        r = client.get('/api/health/ready')
        assert r.status_code == 503, r.text
        assert r.json()['checks']['sqlite_references']['ok'] is False, r.text
        r = client.get('/_ops/persistence', headers=ops_headers())
        assert r.status_code == 200, r.text
        assert r.json()['sqlite_references']['checks']['active_sqlite_datasets_missing_table']['count'] >= 1, r.text
        r = client.get('/_ops/metrics', headers=ops_headers())
        assert r.status_code == 200, r.text
        assert 'dap_sqlite_reference_ok 0' in r.text, r.text
        assert 'dap_sqlite_reference_issues' in r.text, r.text
    finally:
        db.execute('DELETE FROM datasets WHERE id=?', [bad_dataset_id])
    assert db.get_sqlite_reference_status()['ok']


def assert_sqlite_init_lock_prevents_concurrent_startup(client):
    original_timeout = db.settings.sqlite_init_lock_timeout_seconds
    try:
        db.settings.sqlite_init_lock_timeout_seconds = 0
        with db.sqlite_init_lock(timeout_seconds=0) as holder:
            assert holder['enabled'] is True, holder
            assert Path(holder['path']).exists(), holder
            active_lock = db.get_sqlite_lock_status()['init_lock']
            assert active_lock['locked'] is True, active_lock
            try:
                db.init_all(reset=False)
            except db.SQLiteInitLockTimeout as exc:
                assert exc.lock_path == db.sqlite_init_lock_path().resolve(), exc.lock_path
                assert exc.holder.get('operation') == 'init_all', exc.holder
            else:
                raise AssertionError('concurrent SQLite startup init unexpectedly acquired the lock')
        db.init_all(reset=False)
        locks = db.get_sqlite_lock_status()
        assert locks['init_lock']['exists'], locks
        assert locks['init_lock']['locked'] is False, locks
        assert locks['init_lock']['holder'].get('operation') == 'init_all', locks
        r = client.get('/_ops/persistence', headers=ops_headers())
        assert r.status_code == 200, r.text
        assert r.json()['sqlite_locks']['init_lock']['exists'], r.text
    finally:
        db.settings.sqlite_init_lock_timeout_seconds = original_timeout


def assert_sqlite_backup_creates_verified_snapshot():
    with tempfile.TemporaryDirectory() as tmp:
        output_dir = Path(tmp) / 'backups'
        manifest = backup_databases(db.DB_PATH, db.BUSINESS_DB_PATH, output_dir, name='regression-backup')
        platform = manifest['databases']['platform']
        business = manifest['databases']['business']
        assert platform['status'] == 'ok', manifest
        assert business['status'] == 'ok', manifest
        assert platform['integrity_check'] == 'ok', manifest
        assert business['integrity_check'] == 'ok', manifest
        assert platform['user_version'] == db.SCHEMA_VERSION, manifest
        assert len(platform['sha256']) == 64, manifest
        assert len(business['sha256']) == 64, manifest
        platform_backup = Path(platform['backup_path'])
        business_backup = Path(business['backup_path'])
        assert platform_backup.exists() and platform_backup.stat().st_size > 0
        assert business_backup.exists() and business_backup.stat().st_size > 0
        manifest_path = Path(manifest['manifest_path'])
        assert manifest_path.exists()
        verification = verify_backup_dir(Path(manifest['backup_dir']))
        assert verification['ok'], verification
        assert verification['checks']['platform']['user_version'] == db.SCHEMA_VERSION, verification
        assert verification['checks']['platform']['sha256_matches_manifest'], verification
        assert verification['checks']['business']['sha256_matches_manifest'], verification
        rehearsal = rehearse_restore(Path(manifest['backup_dir']), Path(tmp) / 'restore-rehearsal')
        assert rehearsal['ok'], rehearsal
        assert rehearsal['checks']['platform']['schema_version_matches'], rehearsal
        assert rehearsal['checks']['platform']['active_admin_count'] > 0, rehearsal
        assert rehearsal['checks']['business']['status'] == 'ok', rehearsal
        with sqlite3.connect(platform_backup) as con:
            assert con.execute('SELECT COUNT(*) FROM users').fetchone()[0] > 0
            assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        with sqlite3.connect(business_backup) as con:
            assert con.execute('SELECT COUNT(*) FROM sales_orders').fetchone()[0] > 0
            assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'


def assert_startup_backup_cli_records_full_chain():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        backup_root = root / 'backups'
        backup_name = 'startup-regression'
        backup_dir = backup_root / backup_name
        rehearsal_dir = root / 'restore-rehearsal'
        lock_path = root / '.sqlite-ops.lock'
        common = ['--lock-path', str(lock_path), '--lock-timeout-seconds', '0']
        assert sqlite_backup_main([
            '--platform-db', str(db.DB_PATH),
            '--business-db', str(db.BUSINESS_DB_PATH),
            '--output-dir', str(backup_root),
            '--name', backup_name,
            '--retention-count', '7',
            *common,
        ]) == 0
        assert sqlite_backup_main(['--verify-dir', str(backup_dir), *common]) == 0
        assert sqlite_backup_main([
            '--rehearse-restore-dir', str(backup_dir),
            '--rehearsal-output-dir', str(rehearsal_dir),
            *common,
        ]) == 0
        rows = db.many(
            "SELECT status,detail_json FROM platform_operation_runs "
            "WHERE operation='sqlite_backup' ORDER BY rowid DESC LIMIT 3"
        )
        assert len(rows) == 3, rows
        assert all(row['status'] == 'ok' for row in rows), rows
        modes = [json.loads(row['detail_json'])['mode'] for row in reversed(rows)]
        assert modes == ['backup', 'verify', 'restore_rehearsal'], modes
        assert backup_dir.exists()
        assert rehearsal_dir.exists()


def assert_sqlite_maintenance_runs_on_copies():
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        platform_copy = tmp_path / 'platform.db'
        business_copy = tmp_path / 'business.db'
        assert copy_sqlite_snapshot(db.DB_PATH, platform_copy)
        assert copy_sqlite_snapshot(db.BUSINESS_DB_PATH, business_copy)
        report = maintain_databases(platform_copy, business_copy, checkpoint_mode='passive', optimize=True)
        assert report['ok'], report
        assert report['databases']['platform']['status'] == 'ok', report
        assert report['databases']['business']['status'] == 'ok', report
        assert report['databases']['platform']['after']['integrity_check'] == 'ok', report
        assert report['databases']['business']['after']['integrity_check'] == 'ok', report
        dry_run = maintain_databases(platform_copy, business_copy, checkpoint_mode='none', optimize=False, dry_run=True)
        assert dry_run['ok'], dry_run
        assert dry_run['databases']['platform']['actions'][0]['name'] == 'dry_run', dry_run


def assert_sqlite_maintenance_prunes_runtime_tables():
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        platform_copy = tmp_path / 'platform.db'
        business_copy = tmp_path / 'business.db'
        assert copy_sqlite_snapshot(db.DB_PATH, platform_copy)
        assert copy_sqlite_snapshot(db.BUSINESS_DB_PATH, business_copy)
        old_iso = '2000-01-01T00:00:00Z'
        trace_id = 'trace_retention_regression'
        with sqlite3.connect(platform_copy) as con:
            con.execute(
                "INSERT INTO traces (id,user_id,input,status,cost_json,created_at) VALUES (?,?,?,?,?,?)",
                [trace_id, 'u_admin', 'retention', 'success', '{}', old_iso],
            )
            con.execute(
                "INSERT INTO trace_steps (id,trace_id,step_no,step_type,name,input_json,output_json,status,duration_ms) VALUES (?,?,?,?,?,?,?,?,?)",
                ['step_retention_regression', trace_id, 1, 'test', 'retention', '{}', '{}', 'success', 0],
            )
            con.execute(
                "INSERT INTO sql_runs (id,trace_id,sql_text,status,row_count,duration_ms,error_message) VALUES (?,?,?,?,?,?,?)",
                ['sql_retention_regression', trace_id, 'SELECT 1', 'success', 1, 0, ''],
            )
            con.execute(
                "INSERT INTO chart_specs (id,trace_id,chart_type,spec_json,data_ref,created_at) VALUES (?,?,?,?,?,?)",
                ['chart_retention_regression', trace_id, 'table', '{}', '', old_iso],
            )
            con.execute(
                "INSERT INTO tool_calls (id,trace_id,adapter_id,request_json,response_json,status,duration_ms,created_at) VALUES (?,?,?,?,?,?,?,?)",
                ['call_retention_regression', trace_id, 'ad_mock_router', '{}', '{}', 'success', 0, old_iso],
            )
            con.execute(
                "INSERT INTO audit_logs (id,user_id,action,object_type,object_id,detail_json,ip,request_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                ['audit_retention_regression', 'u_admin', 'retention_probe', 'test', trace_id, '{}', '', '', old_iso],
            )
            con.execute(
                "INSERT INTO rate_limit_events (id,bucket_key,created_at_epoch,created_at) VALUES (?,?,?,?)",
                ['rl_retention_regression', 'retention:old', 1.0, old_iso],
            )
        dry_run = maintain_databases(
            platform_copy,
            business_copy,
            checkpoint_mode='none',
            optimize=False,
            dry_run=True,
            trace_retention_days=1,
            audit_retention_days=1,
            rate_limit_retention_hours=1,
        )
        assert dry_run['ok'], dry_run
        dry_actions = {action['name']: action for action in dry_run['runtime_retention']['actions']}
        assert dry_actions['prune_traces']['matched_rows'] == 1, dry_run
        assert dry_actions['prune_traces']['deleted_rows'] == 0, dry_run
        assert dry_actions['prune_audit_logs']['matched_rows'] >= 1, dry_run
        assert dry_actions['prune_rate_limit_events']['matched_rows'] >= 1, dry_run
        with sqlite3.connect(platform_copy) as con:
            assert con.execute("SELECT COUNT(*) FROM traces WHERE id=?", [trace_id]).fetchone()[0] == 1
        report = maintain_databases(
            platform_copy,
            business_copy,
            checkpoint_mode='none',
            optimize=False,
            trace_retention_days=1,
            audit_retention_days=1,
            rate_limit_retention_hours=1,
        )
        assert report['ok'], report
        actions = {action['name']: action for action in report['runtime_retention']['actions']}
        assert actions['prune_traces']['deleted_rows'] == 1, report
        assert actions['prune_audit_logs']['deleted_rows'] >= 1, report
        assert actions['prune_rate_limit_events']['deleted_rows'] >= 1, report
        with sqlite3.connect(platform_copy) as con:
            assert con.execute("SELECT COUNT(*) FROM traces WHERE id=?", [trace_id]).fetchone()[0] == 0
            assert con.execute("SELECT COUNT(*) FROM trace_steps WHERE trace_id=?", [trace_id]).fetchone()[0] == 0
            assert con.execute("SELECT COUNT(*) FROM sql_runs WHERE trace_id=?", [trace_id]).fetchone()[0] == 0
            assert con.execute("SELECT COUNT(*) FROM chart_specs WHERE trace_id=?", [trace_id]).fetchone()[0] == 0
            assert con.execute("SELECT COUNT(*) FROM tool_calls WHERE trace_id=?", [trace_id]).fetchone()[0] == 0
            assert con.execute("SELECT COUNT(*) FROM audit_logs WHERE id='audit_retention_regression'").fetchone()[0] == 0
            assert con.execute("SELECT COUNT(*) FROM rate_limit_events WHERE id='rl_retention_regression'").fetchone()[0] == 0


def assert_sqlite_ops_lock_prevents_overlap():
    with tempfile.TemporaryDirectory() as tmp:
        lock_path = Path(tmp) / '.sqlite-ops.lock'
        with sqlite_ops_lock(lock_path, operation='outer-regression', timeout_seconds=0) as holder:
            assert holder['operation'] == 'outer-regression', holder
            assert lock_path.exists()
            try:
                with sqlite_ops_lock(lock_path, operation='inner-regression', timeout_seconds=0):
                    raise AssertionError('nested SQLite operation lock unexpectedly succeeded')
            except SQLiteOpsLockTimeout as exc:
                assert exc.lock_path == lock_path.resolve(), exc.lock_path
                assert exc.holder.get('operation') == 'outer-regression', exc.holder
        with sqlite_ops_lock(lock_path, operation='after-release-regression', timeout_seconds=0) as holder:
            assert holder['operation'] == 'after-release-regression', holder


def assert_platform_operation_runs_are_persisted_and_exposed(client):
    missing_backup = db.get_sqlite_backup_freshness(max_age_hours=1)
    assert missing_backup['status'] == 'missing', missing_backup
    run_id = db.start_sqlite_operation_run('regression_sqlite_operation', {'probe': True})
    db.finish_sqlite_operation_run(run_id, 'ok', {'ok': True, 'rows': 1})
    row = db.one('SELECT * FROM platform_operation_runs WHERE id=?', [run_id])
    assert row is not None, run_id
    assert row['operation'] == 'regression_sqlite_operation', row
    assert row['status'] == 'ok', row
    assert row['finished_at'], row
    assert row['duration_ms'] is not None, row
    assert json.loads(row['detail_json'])['ok'] is True, row
    r = client.get('/_ops/persistence', headers=ops_headers())
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload['table_counts']['platform_operation_runs'] >= 1, payload
    assert payload['sqlite_operation_summary']['status_counts']['ok'] >= 1, payload
    assert payload['sqlite_operation_summary']['last_successful_operation']['status'] == 'ok', payload
    recent_ids = [item['id'] for item in payload['recent_sqlite_operations']]
    assert run_id in recent_ids, payload['recent_sqlite_operations']
    old_running_id = 'sqliteop_stale_regression'
    old_finished_id = 'sqliteop_prune_regression'
    old_iso = '2000-01-01T00:00:00Z'
    db.insert(
        'platform_operation_runs',
        {
            'id': old_running_id,
            'operation': 'regression_old_running',
            'status': 'running',
            'started_at': old_iso,
            'finished_at': None,
            'duration_ms': None,
            'detail_json': {},
        },
    )
    db.insert(
        'platform_operation_runs',
        {
            'id': old_finished_id,
            'operation': 'regression_old_finished',
            'status': 'ok',
            'started_at': old_iso,
            'finished_at': old_iso,
            'duration_ms': 0,
            'detail_json': {},
        },
    )
    dry_run = maintain_databases(
        db.DB_PATH,
        db.BUSINESS_DB_PATH,
        checkpoint_mode='none',
        optimize=False,
        dry_run=True,
        operation_run_retention_days=1,
        stale_operation_hours=1,
    )
    dry_actions = {action['name']: action for action in dry_run['runtime_retention']['actions']}
    assert dry_actions['mark_stale_platform_operation_runs']['matched_rows'] >= 1, dry_run
    assert dry_actions['mark_stale_platform_operation_runs']['updated_rows'] == 0, dry_run
    assert dry_actions['prune_platform_operation_runs']['matched_rows'] >= 1, dry_run
    assert dry_actions['prune_platform_operation_runs']['deleted_rows'] == 0, dry_run
    assert db.one('SELECT status FROM platform_operation_runs WHERE id=?', [old_running_id])['status'] == 'running'
    report = maintain_databases(
        db.DB_PATH,
        db.BUSINESS_DB_PATH,
        checkpoint_mode='none',
        optimize=False,
        operation_run_retention_days=1,
        stale_operation_hours=1,
    )
    actions = {action['name']: action for action in report['runtime_retention']['actions']}
    assert actions['mark_stale_platform_operation_runs']['updated_rows'] >= 1, report
    assert actions['prune_platform_operation_runs']['deleted_rows'] >= 1, report
    assert db.one('SELECT status FROM platform_operation_runs WHERE id=?', [old_running_id])['status'] == 'stale'
    assert db.one('SELECT id FROM platform_operation_runs WHERE id=?', [old_finished_id]) is None
    old_backup_id = 'sqliteop_old_backup_regression'
    db.insert(
        'platform_operation_runs',
        {
            'id': old_backup_id,
            'operation': 'sqlite_backup',
            'status': 'ok',
            'started_at': old_iso,
            'finished_at': old_iso,
            'duration_ms': 0,
            'detail_json': {'mode': 'backup', 'ok': True},
        },
    )
    stale_backup = db.get_sqlite_backup_freshness(max_age_hours=1)
    assert stale_backup['status'] == 'stale', stale_backup
    fresh_backup_id = db.start_sqlite_operation_run('sqlite_backup', {'mode': 'backup'})
    db.finish_sqlite_operation_run(fresh_backup_id, 'ok', {'mode': 'backup', 'ok': True})
    fresh_backup = db.get_sqlite_backup_freshness(max_age_hours=1)
    assert fresh_backup['status'] == 'fresh', fresh_backup
    assert fresh_backup['last_successful_operation']['id'] == fresh_backup_id, fresh_backup
    r = client.get('/_ops/persistence', headers=ops_headers())
    assert r.status_code == 200, r.text
    persistence = r.json()
    assert persistence['sqlite_backup_freshness']['status'] == 'fresh', persistence
    r = client.get('/_ops/metrics', headers=ops_headers())
    assert r.status_code == 200, r.text
    assert 'dap_sqlite_backup_fresh 1' in r.text, r.text
    assert 'dap_sqlite_backup_age_hours' in r.text, r.text


def _business_import_tables() -> set[str]:
    with db.connect_readonly(db.BUSINESS_DB_PATH) as con:
        return {
            row['name']
            for row in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'import_tbl_%'").fetchall()
        }


def assert_csv_import_failure_cleans_business_table(client, headers):
    before_tables = _business_import_tables()
    original_persist = data_router._persist_csv_import_metadata

    def fail_metadata(*args, **kwargs):
        raise RuntimeError('forced metadata failure')

    data_router._persist_csv_import_metadata = fail_metadata
    try:
        files = {'file': ('fail.csv', 'alpha,beta\n1,2\n', 'text/csv')}
        r = client.post('/api/data/import/csv?dataset_name=forced_fail&business_domain=Tmp', headers=headers, files=files)
    finally:
        data_router._persist_csv_import_metadata = original_persist

    assert r.status_code == 500, r.text
    body = r.json()
    message = body.get('detail') or body.get('error', {}).get('message')
    assert message == 'CSV import failed', r.text
    assert _business_import_tables() == before_tables
    assert db.one("SELECT id FROM datasets WHERE name=?", ['forced_fail']) is None
    job = db.one("SELECT * FROM data_import_jobs WHERE filename=? ORDER BY created_at DESC LIMIT 1", ['fail.csv'])
    assert job is not None, 'failed import job was not recorded'
    assert job['status'] == 'failed', job
    assert 'forced metadata failure' in (job['error_message'] or ''), job
    failure_audit = db.one("SELECT * FROM audit_logs WHERE action='import_csv_failed' AND object_id=? ORDER BY created_at DESC LIMIT 1", [job['dataset_id']])
    assert failure_audit is not None, 'failed import audit was not recorded'
    assert 'forced metadata failure' in json.loads(failure_audit['detail_json'])['error'], failure_audit


def assert_codex_handoff_artifact_is_sqlite_backed(client, headers):
    prompt = 'Persist this Codex handoff body in SQLite for backup and restore coverage.'
    r = client.post(
        '/api/codex/tasks',
        headers=headers,
        json={
            'title': 'SQLite handoff persistence regression',
            'task_prompt': prompt,
            'acceptance_criteria': ['handoff content is persisted in SQLite'],
            'requires_approval': True,
            'mode': 'mock',
        },
    )
    assert r.status_code == 200, r.text
    task_id = r.json()['id']
    artifact = db.one("SELECT * FROM codex_artifacts WHERE task_id=? AND artifact_type='handoff_md'", [task_id])
    assert artifact is not None, 'handoff artifact was not recorded'
    assert prompt in artifact['content'], artifact

    db.update('codex_artifacts', 'id', artifact['id'], {'content': ''})
    r = client.post(f'/api/codex/tasks/{task_id}/approve', headers=headers, json={'comment': 'ok'})
    assert r.status_code == 200, r.text
    r = client.post(f'/api/codex/tasks/{task_id}/dispatch', headers=headers, json={'mode': 'mock'})
    assert r.status_code == 200, r.text
    refreshed = db.one('SELECT * FROM codex_artifacts WHERE id=?', [artifact['id']])
    assert prompt in refreshed['content'], refreshed


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
    assert_sqlite_rate_limiter_persists_events()
    assert_platform_metadata_tracks_sqlite_schema(client)
    assert_readiness_checks_sqlite_runtime(client)
    assert_sqlite_storage_status_is_exposed(client)
    assert_sqlite_runtime_path_warnings_are_specific()
    assert_sqlite_reference_status_detects_orphans(client)
    assert_sqlite_init_lock_prevents_concurrent_startup(client)
    assert_sqlite_backup_creates_verified_snapshot()
    assert_sqlite_maintenance_runs_on_copies()
    assert_sqlite_maintenance_prunes_runtime_tables()
    assert_sqlite_ops_lock_prevents_overlap()
    assert_platform_operation_runs_are_persisted_and_exposed(client)
    assert_startup_backup_cli_records_full_chain()

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
    assert_csv_import_failure_cleans_business_table(client, admin)
    assert_codex_handoff_artifact_is_sqlite_backed(client, admin)

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
    assert_bootstrap_admin_can_seed_empty_sqlite()
    assert_bootstrap_admin_takes_precedence_over_demo_admin()
    assert_external_adapter_rejects_redirect()
    db.init_all(reset=True)

    print('Hardening regression test passed')


if __name__ == '__main__':
    main()
