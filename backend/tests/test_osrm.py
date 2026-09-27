import httpx
import pytest

from app.models import Coordinate
from app.services.osrm import OsrmClient, RouteNotFound, create_local_http_client


def test_default_local_http_client_does_not_inherit_proxy_environment(monkeypatch):
    captured: dict[str, object] = {}

    class CapturingClient:
        def __init__(self, **kwargs: object):
            captured.update(kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", CapturingClient)

    create_local_http_client()

    assert captured["trust_env"] is False


@pytest.mark.asyncio
async def test_route_uses_lon_lat_and_parses_geojson_response():
    requested_url: str | None = None

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal requested_url
        requested_url = str(request.url)
        return httpx.Response(
            200,
            json={
                "code": "Ok",
                "routes": [
                    {
                        "distance": 1250.5,
                        "duration": 183.2,
                        "geometry": {
                            "coordinates": [[116.4, 39.9], [116.41, 39.89]],
                            "type": "LineString",
                        },
                        "legs": [
                            {
                                "steps": [
                                    {
                                        "distance": 1250.5,
                                        "name": "测试路",
                                        "maneuver": {
                                            "type": "turn",
                                            "modifier": "right",
                                            "location": [116.41, 39.89],
                                        },
                                    }
                                ]
                            }
                        ],
                    }
                ],
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = OsrmClient("http://router.local", http_client=http_client)
        route = await client.route(
            Coordinate(lat=39.9, lon=116.4),
            Coordinate(lat=39.89, lon=116.41),
        )

    assert requested_url is not None
    assert "/route/v1/driving/116.400000,39.900000;116.410000,39.890000" in requested_url
    assert route.geometry == [
        Coordinate(lat=39.9, lon=116.4),
        Coordinate(lat=39.89, lon=116.41),
    ]
    assert route.maneuvers[0].instruction == "右转进入测试路"


@pytest.mark.asyncio
async def test_route_raises_route_not_found_when_osrm_returns_no_routes():
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": "NoRoute", "routes": []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = OsrmClient("http://router.local", http_client=http_client)
        with pytest.raises(RouteNotFound):
            await client.route(
                Coordinate(lat=39.9, lon=116.4),
                Coordinate(lat=39.89, lon=116.41),
            )
