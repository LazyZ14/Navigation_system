import pytest
from fastapi.testclient import TestClient

from app.main import app


def test_health_endpoint_is_available_without_map_data():
    response = TestClient(app).get('/api/health')
    assert response.status_code == 200
    assert response.json() == {'status': 'ok'}


@pytest.mark.parametrize('path', ['/api/routes', '/api/navigation/sessions', '/api/voice/intent'])
def test_retired_offline_endpoints_are_not_exposed(path):
    assert TestClient(app).post(path, json={}).status_code == 404
