from datetime import datetime, timezone
from uuid import UUID

from fastapi.testclient import TestClient

from app.api.gps import get_gps_ingress_service
from app.api.navigation import get_navigation_store
from app.config import Settings, get_settings
from app.gps.service import GpsIngressService
from app.main import app


STREAM_ID = UUID("f5824845-1c55-40c8-b98f-fdf7d5aa81d9")
TOKEN = "test-device-token"


def payload(*, sequence: int = 0, lat: float = 39.9042, speed_mps: float | None = 6.2, heading_deg: float | None = 85.0) -> dict[str, object]:
    return {
        "schema_version": 1,
        "device_id": "ios-test-device",
        "stream_id": str(STREAM_ID),
        "sequence": sequence,
        "lat": lat,
        "lon": 116.4074,
        "accuracy_m": 8.5,
        "speed_mps": speed_mps,
        "heading_deg": heading_deg,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def client_with_gps_dependencies() -> TestClient:
    service = GpsIngressService()
    app.dependency_overrides[get_settings] = lambda: Settings(
        osrm_base_url="http://osrm.invalid",
        gps_device_tokens={"ios-test-device": TOKEN},
        gps_max_active_streams=10,
    )
    app.dependency_overrides[get_gps_ingress_service] = lambda: service
    return TestClient(app)


def test_gps_endpoint_accepts_authenticated_raw_fix_without_navigation_dependency():
    client = client_with_gps_dependencies()
    app.dependency_overrides[get_navigation_store] = lambda: (_ for _ in ()).throw(AssertionError("GPS ingress must not use navigation"))
    try:
        response = client.post("/api/gps/fixes", json=payload(), headers={"Authorization": f"Bearer {TOKEN}"})

        assert response.status_code == 202
        assert response.json()["disposition"] == "accepted"
        assert response.json()["timestamp"] != response.json()["received_at"]
    finally:
        app.dependency_overrides.clear()


def test_gps_endpoint_rejects_missing_or_invalid_device_token():
    client = client_with_gps_dependencies()
    try:
        missing = client.post("/api/gps/fixes", json=payload())
        invalid = client.post("/api/gps/fixes", json=payload(), headers={"Authorization": "Bearer wrong"})

        assert missing.status_code == 401
        assert invalid.status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_gps_endpoint_rejects_invalid_coordinate_speed_and_heading():
    client = client_with_gps_dependencies()
    try:
        headers = {"Authorization": f"Bearer {TOKEN}"}

        assert client.post("/api/gps/fixes", json=payload(lat=91), headers=headers).status_code == 422
        assert client.post("/api/gps/fixes", json=payload(speed_mps=-1), headers=headers).status_code == 422
        assert client.post("/api/gps/fixes", json=payload(heading_deg=360), headers=headers).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_gps_endpoint_returns_duplicate_and_rejects_out_of_order_sequence():
    client = client_with_gps_dependencies()
    try:
        headers = {"Authorization": f"Bearer {TOKEN}"}
        first_payload = payload(sequence=1)

        assert client.post("/api/gps/fixes", json=first_payload, headers=headers).status_code == 202
        assert client.post("/api/gps/fixes", json=first_payload, headers=headers).status_code == 200
        assert client.post("/api/gps/fixes", json=payload(sequence=0), headers=headers).status_code == 409
    finally:
        app.dependency_overrides.clear()


def test_gps_endpoint_accepts_latest_fresh_fix_after_disconnected_sender_drops_old_points():
    client = client_with_gps_dependencies()
    try:
        headers = {"Authorization": f"Bearer {TOKEN}"}

        assert client.post("/api/gps/fixes", json=payload(sequence=0), headers=headers).status_code == 202
        recovered = client.post("/api/gps/fixes", json=payload(sequence=2), headers=headers)

        assert recovered.status_code == 202
        assert recovered.json()["sequence"] == 2
    finally:
        app.dependency_overrides.clear()
