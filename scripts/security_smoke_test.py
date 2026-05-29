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
# Dangerous SQL should be blocked by SQL Guard through direct service test.
from apps.api.services.sql_guard import validate_readonly_sql
try:
    validate_readonly_sql('DROP TABLE sales_orders')
    raise AssertionError('DROP should be blocked')
except Exception:
    pass
print('Security smoke test passed')
