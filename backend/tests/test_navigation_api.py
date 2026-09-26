from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.api.navigation import get_navigation_store
from app.main import app
from app.models import Coordinate, LocationFix, Maneuver, RouteResponse
from app.services.navigation import NavigationSessionStore
from app.services.osrm import MatchedRoad


class FakeOsrmClient:
    async def route(self, _: Coordinate, __: Coordinate) -> RouteResponse:
        return RouteResponse(
            geometry=[Coordinate(lat=39.9, lon=116.4), Coordinate(lat=39.89, lon=116.41)],
            distance_m=1200,
            duration_s=180,
            maneuvers=[
                Maneuver(
                    instruction="右转进入测试路",
                    distance_m=400,
                    location=Coordinate(lat=39.89, lon=116.41),
                )
            ],
        )

    async def nearest(self, _: Coordinate) -> MatchedRoad:
        return MatchedRoad(location=Coordinate(lat=39.9, lon=116.4), distance_m=10)


def test_navigation_session_exposes_ready_and_matched_state_over_public_api():
    store = NavigationSessionStore(FakeOsrmClient())
    app.dependency_overrides[get_navigation_store] = lambda: store
    client = TestClient(app)
    try:
        created = client.post(
            "/api/navigation/sessions",
            json={"origin": {"lat": 39.9, "lon": 116.4}, "destination": {"lat": 39.89, "lon": 116.41}},
        )

        assert created.status_code == 201
        payload = created.json()
        assert payload["state"]["status"] == "ready"
        assert payload["route"]["geometry"]

        updated = client.post(
            f"/api/navigation/{payload['session_id']}/fixes",
            json={
                "lat": 39.9,
                "lon": 116.4,
                "heading": 90,
                "speed_mps": 8,
                "accuracy_m": 5,
                "timestamp": datetime(2026, 9, 23, tzinfo=UTC).isoformat(),
            },
        )

        assert updated.status_code == 200
        assert updated.json()["state"]["status"] == "navigating"
        assert updated.json()["state"]["matched_location"] == {"lat": 39.9, "lon": 116.4}
        assert updated.json()["state"]["next_maneuver"]["instruction"] == "右转进入测试路"
    finally:
        app.dependency_overrides.clear()


def test_navigation_websocket_sends_current_session_state():
    store = NavigationSessionStore(FakeOsrmClient())
    app.dependency_overrides[get_navigation_store] = lambda: store
    client = TestClient(app)
    try:
        created = client.post(
            "/api/navigation/sessions",
            json={"origin": {"lat": 39.9, "lon": 116.4}, "destination": {"lat": 39.89, "lon": 116.41}},
        )

        with client.websocket_connect(f"/ws/navigation/{created.json()['session_id']}") as websocket:
            assert websocket.receive_json()["status"] == "ready"
    finally:
        app.dependency_overrides.clear()


def test_navigation_replay_endpoint_advances_only_the_server_owned_synthetic_track():
    track = [
        LocationFix(
            lat=39.9,
            lon=116.4,
            heading=90,
            speed_mps=8,
            accuracy_m=5,
            timestamp=datetime(2026, 9, 23, tzinfo=UTC),
        )
    ]
    store = NavigationSessionStore(FakeOsrmClient(), tracks={"normal-route": track})
    app.dependency_overrides[get_navigation_store] = lambda: store
    client = TestClient(app)
    try:
        created = client.post(
            "/api/navigation/sessions",
            json={
                "origin": {"lat": 39.9, "lon": 116.4},
                "destination": {"lat": 39.89, "lon": 116.41},
                "track_id": "normal-route",
            },
        )

        replayed = client.post(f"/api/navigation/{created.json()['session_id']}/replay/next")

        assert replayed.status_code == 200
        assert replayed.json()["state"]["status"] == "navigating"
    finally:
        app.dependency_overrides.clear()


def test_replay_reports_arrival_after_last_synthetic_fix():
    track = [
        LocationFix(lat=39.9, lon=116.4, heading=90, speed_mps=8, accuracy_m=5, timestamp=datetime(2026, 9, 23, tzinfo=UTC))
    ]
    store = NavigationSessionStore(FakeOsrmClient(), tracks={"normal-route": track})
    app.dependency_overrides[get_navigation_store] = lambda: store
    client = TestClient(app)
    try:
        created = client.post("/api/navigation/sessions", json={"origin": {"lat": 39.9, "lon": 116.4}, "destination": {"lat": 39.89, "lon": 116.41}, "track_id": "normal-route"})
        session_id = created.json()["session_id"]
        client.post(f"/api/navigation/{session_id}/replay/next")

        finished = client.post(f"/api/navigation/{session_id}/replay/next")

        assert finished.json()["state"]["status"] == "arrived"
    finally:
        app.dependency_overrides.clear()


def test_replay_pause_preserves_the_next_fix_until_resumed():
    track = [
        LocationFix(lat=39.9, lon=116.4, heading=90, speed_mps=8, accuracy_m=5, timestamp=datetime(2026, 9, 23, tzinfo=UTC)),
        LocationFix(lat=39.9, lon=116.401, heading=90, speed_mps=8, accuracy_m=5, timestamp=datetime(2026, 9, 23, 0, 0, 1, tzinfo=UTC)),
    ]
    store = NavigationSessionStore(FakeOsrmClient(), tracks={"normal-route": track})
    app.dependency_overrides[get_navigation_store] = lambda: store
    client = TestClient(app)
    try:
        session_id = client.post("/api/navigation/sessions", json={"origin": {"lat": 39.9, "lon": 116.4}, "destination": {"lat": 39.89, "lon": 116.41}, "track_id": "normal-route"}).json()["session_id"]
        client.post(f"/api/navigation/{session_id}/replay/next")
        assert client.post(f"/api/navigation/{session_id}/replay/pause").status_code == 204
        assert client.post(f"/api/navigation/{session_id}/replay/next").json()["state"]["raw_location"]["lon"] == 116.4

        assert client.post(f"/api/navigation/{session_id}/replay/resume").status_code == 204
        assert client.post(f"/api/navigation/{session_id}/replay/next").json()["state"]["raw_location"]["lon"] == 116.401
    finally:
        app.dependency_overrides.clear()
