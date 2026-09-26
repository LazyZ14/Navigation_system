from pathlib import Path


def test_compose_starts_osrm_api_and_frontend_on_localhost_only():
    root = Path(__file__).parents[2]
    compose = (root / "docker-compose.yml").read_text()

    for service in ("osrm:", "api:", "frontend:"):
        assert service in compose
    for port in ("127.0.0.1:5000:5000", "127.0.0.1:8000:8000", "127.0.0.1:5173:80"):
        assert port in compose
