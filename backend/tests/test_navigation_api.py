import asyncio
from datetime import UTC, datetime

import pytest
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
            event = websocket.receive_json()
            assert event["state"]["status"] == "ready"
            assert event["route"]["geometry"]
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
        created = client.post("/api/navigation/sessions", json={"origin": {"lat": 39.9, "lon": 116.4}, "destination": {"lat": 39.9, "lon": 116.4}, "track_id": "normal-route"})
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
        paused = client.post(f"/api/navigation/{session_id}/replay/next").json()["state"]
        assert paused["status"] == "navigating"
        assert paused["raw_location"]["lon"] == 116.4

        assert client.post(f"/api/navigation/{session_id}/replay/resume").status_code == 204
        assert client.post(f"/api/navigation/{session_id}/replay/next").json()["state"]["raw_location"]["lon"] == 116.401
    finally:
        app.dependency_overrides.clear()


def test_unknown_track_is_rejected_without_creating_a_route():
    store = NavigationSessionStore(FakeOsrmClient(), tracks={})
    app.dependency_overrides[get_navigation_store] = lambda: store
    client = TestClient(app, raise_server_exceptions=False)
    try:
        response = client.post(
            "/api/navigation/sessions",
            json={
                "origin": {"lat": 39.9, "lon": 116.4},
                "destination": {"lat": 39.8994, "lon": 116.404},
                "track_id": "unknown-track",
            },
        )

        assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_replay_finishing_far_from_destination_does_not_report_arrival():
    track = [
        LocationFix(lat=39.91, lon=116.4, heading=90, speed_mps=8, accuracy_m=5, timestamp=datetime(2026, 9, 23, tzinfo=UTC))
    ]

    class FarMatchClient(FakeOsrmClient):
        async def nearest(self, _: Coordinate) -> MatchedRoad:
            return MatchedRoad(location=Coordinate(lat=39.91, lon=116.4), distance_m=5)

    store = NavigationSessionStore(FarMatchClient(), tracks={"normal-route": track})
    app.dependency_overrides[get_navigation_store] = lambda: store
    client = TestClient(app)
    try:
        session_id = client.post("/api/navigation/sessions", json={"origin": {"lat": 39.9, "lon": 116.4}, "destination": {"lat": 39.89, "lon": 116.41}, "track_id": "normal-route"}).json()["session_id"]
        client.post(f"/api/navigation/{session_id}/replay/next")

        finished = client.post(f"/api/navigation/{session_id}/replay/next")

        assert finished.json()["state"]["status"] == "replay_finished"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_concurrent_replay_requests_are_serialized_per_session():
    first_started = asyncio.Event()
    release_first = asyncio.Event()

    class SlowFirstMatchClient(FakeOsrmClient):
        def __init__(self):
            self.nearest_calls = 0

        async def nearest(self, location: Coordinate) -> MatchedRoad:
            self.nearest_calls += 1
            if self.nearest_calls == 1:
                first_started.set()
                await release_first.wait()
            return MatchedRoad(location=location, distance_m=5)

    points = [
        LocationFix(lat=39.9, lon=116.4 + index * 0.001, heading=90, speed_mps=8, accuracy_m=5, timestamp=datetime(2026, 9, 23, 0, 0, index, tzinfo=UTC))
        for index in range(2)
    ]
    client = SlowFirstMatchClient()
    store = NavigationSessionStore(client, tracks={"normal-route": points})
    session = await store.create(points[0], Coordinate(lat=39.9, lon=116.41), "normal-route")

    first = asyncio.create_task(store.replay_next(session.session_id))
    await first_started.wait()
    second = asyncio.create_task(store.replay_next(session.session_id))
    await asyncio.sleep(0)

    assert client.nearest_calls == 1
    release_first.set()
    first_result, second_result = await asyncio.gather(first, second)
    assert first_result is not None and second_result is not None
    assert first_result.state.raw_location is not None
    assert second_result.state.raw_location is not None
    assert first_result.state.raw_location.lon < second_result.state.raw_location.lon
