import os
import subprocess
from pathlib import Path


def test_compose_keeps_all_services_on_loopback_by_default():
    root = Path(__file__).parents[2]
    environment = {**os.environ, "GPS_LAN_BIND_ADDRESS": "127.0.0.1", "GPS_DEVICE_TOKENS_JSON": "{}"}
    result = subprocess.run(
        ["docker", "compose", "config"],
        cwd=root,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )

    for service in ("osrm:", "api:", "frontend:"):
        assert service in result.stdout
    assert result.stdout.count("host_ip: 127.0.0.1") == 3
    for target in ('target: 5000', 'target: 8000', 'target: 80'):
        assert target in result.stdout


def test_nginx_does_not_mask_missing_map_data_and_proxies_websockets():
    root = Path(__file__).parents[2]
    nginx = (root / "frontend" / "nginx.conf").read_text()

    assert "location /generated/" in nginx
    assert "try_files $uri =404" in nginx
    assert "location /ws/" in nginx
    assert "proxy_set_header Upgrade $http_upgrade" in nginx
