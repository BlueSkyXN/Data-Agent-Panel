from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from apps.api import db
from apps.api.main import app


def login(client):
    r = client.post('/api/auth/login', json={'username':'admin','password':'admin123'})
    assert r.status_code == 200, r.text
    return {'Authorization':'Bearer ' + r.json()['token']}


def main():
    db.init_all(reset=True)
    client = TestClient(app)
    h = login(client)

    # Standalone package should expose only generic demo datasets.
    datasets = client.get('/api/datasets', headers=h).json()
    dataset_ids = {d['id'] for d in datasets}
    assert {'dataset_orders','dataset_tickets','dataset_campaigns','dataset_products','dataset_business_daily'} <= dataset_ids

    agents = client.get('/api/agents', headers=h).json()
    agent_names = ' '.join(a['name'] for a in agents)
    assert '销售经营问数 Agent' in agent_names
    assert '客户工单归因 Agent' in agent_names

    # Router should handle all main standalone domains.
    cases = [
        ('本月收入最高的渠道有哪些？', 'metric_analysis'),
        ('客户工单根因分布是什么？', 'ticket_analysis'),
        ('当前经营风险最高的区域有哪些？', 'risk_analysis'),
        ('给我生成一个经营总览面板', 'panel'),
        ('解释收入指标口径', 'semantic_governance'),
    ]
    for q, answer_type in cases:
        r = client.post('/api/chat/query', headers=h, json={'agent_id':'agent_router','message':q})
        assert r.status_code == 200, (q, r.text)
        assert r.json()['result']['answer_type'] == answer_type, (q, r.json()['result']['answer_type'])

    print('Standalone regression test passed')


if __name__ == '__main__':
    main()
