from pathlib import Path


def test_compose_starts_osrm_api_and_frontend_on_localhost_only():
    root = Path(__file__).parents[2]
    compose = (root / "docker-compose.yml").read_text()

    for service in ("osrm:", "api:", "frontend:"):
        assert service in compose
    for port in ("127.0.0.1:5000:5000", "127.0.0.1:8000:8000", "127.0.0.1:5173:80"):
        assert port in compose


def test_nginx_does_not_mask_missing_map_data_and_proxies_websockets():
    root = Path(__file__).parents[2]
    nginx = (root / "frontend" / "nginx.conf").read_text()

    assert "location /generated/" in nginx
    assert "try_files $uri =404" in nginx
    assert "location /ws/" in nginx
    assert "proxy_set_header Upgrade $http_upgrade" in nginx
