from fastapi.testclient import TestClient

from app.api.routes import get_osrm_client
from app.main import app
from app.models import Coordinate, Maneuver, RouteResponse
from app.services.osrm import RouteNotFound


class FakeOsrmClient:
    def __init__(self, outcome: object):
        self.outcome = outcome

    async def route(self, _: Coordinate, __: Coordinate) -> RouteResponse:
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome  # type: ignore[return-value]


def route_response() -> RouteResponse:
    return RouteResponse(
        geometry=[Coordinate(lat=39.9, lon=116.4), Coordinate(lat=39.89, lon=116.41)],
        distance_m=1200,
        duration_s=180,
        maneuvers=[
            Maneuver(
                instruction="右转进入测试路",
                distance_m=1200,
                location=Coordinate(lat=39.89, lon=116.41),
            )
        ],
    )


def client_with(outcome: object) -> TestClient:
    app.dependency_overrides[get_osrm_client] = lambda: FakeOsrmClient(outcome)
    return TestClient(app)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def test_route_returns_geometry_for_valid_request():
    response = client_with(route_response()).post(
        "/api/routes",
        json={"origin": {"lat": 39.9, "lon": 116.4}, "destination": {"lat": 39.89, "lon": 116.41}},
    )

    assert response.status_code == 200
    assert response.json()["geometry"]
    assert response.json()["maneuvers"]


def test_route_rejects_invalid_latitude():
    response = client_with(route_response()).post(
        "/api/routes",
        json={"origin": {"lat": 91, "lon": 116.4}, "destination": {"lat": 39.89, "lon": 116.41}},
    )

    assert response.status_code == 422


def test_route_returns_not_found_for_unreachable_destination():
    response = client_with(RouteNotFound()).post(
        "/api/routes",
        json={"origin": {"lat": 39.9, "lon": 116.4}, "destination": {"lat": 39.89, "lon": 116.41}},
    )

    assert response.status_code == 404
    assert response.json() == {"code": "route_not_found"}


def test_route_returns_service_unavailable_for_osrm_transport_failure():
    response = client_with(ConnectionError("OSRM offline")).post(
        "/api/routes",
        json={"origin": {"lat": 39.9, "lon": 116.4}, "destination": {"lat": 39.89, "lon": 116.41}},
    )

    assert response.status_code == 503
    assert response.json() == {"code": "routing_unavailable"}
