from collections.abc import Mapping

import httpx

from app.models import Coordinate, Maneuver, RouteResponse


class RouteNotFound(Exception):
    """OSRM returned no drivable route for a valid request."""


def create_local_http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=5.0, trust_env=False)


class OsrmClient:
    def __init__(self, base_url: str, *, http_client: httpx.AsyncClient | None = None):
        self._base_url = base_url.rstrip("/")
        self._http_client = http_client

    async def route(self, origin: Coordinate, destination: Coordinate) -> RouteResponse:
        client = self._http_client or create_local_http_client()
        close_client = self._http_client is None
        coordinates = f"{origin.lon:.6f},{origin.lat:.6f};{destination.lon:.6f},{destination.lat:.6f}"
        try:
            response = await client.get(
                f"{self._base_url}/route/v1/driving/{coordinates}",
                params={"steps": "true", "overview": "full", "geometries": "geojson"},
            )
            response.raise_for_status()
            payload = response.json()
        finally:
            if close_client:
                await client.aclose()

        routes = payload.get("routes", [])
        if payload.get("code") != "Ok" or not routes:
            raise RouteNotFound()

        route = routes[0]
        geometry = [
            Coordinate(lat=lat, lon=lon)
            for lon, lat in route["geometry"]["coordinates"]
        ]
        maneuvers = [
            self._parse_step(step)
            for leg in route.get("legs", [])
            for step in leg.get("steps", [])
        ]
        return RouteResponse(
            geometry=geometry,
            distance_m=route["distance"],
            duration_s=route["duration"],
            maneuvers=maneuvers,
        )

    @staticmethod
    def _parse_step(step: Mapping[str, object]) -> Maneuver:
        maneuver = step["maneuver"]
        if not isinstance(maneuver, Mapping):
            raise ValueError("OSRM step has no maneuver")
        location = maneuver["location"]
        if not isinstance(location, list) or len(location) != 2:
            raise ValueError("OSRM maneuver has no valid location")
        lon, lat = location
        modifier = maneuver.get("modifier")
        action = {"right": "右转", "left": "左转", "straight": "直行"}.get(modifier, "继续行驶")
        road_name = step.get("name")
        suffix = f"进入{road_name}" if road_name else ""
        return Maneuver(
            instruction=f"{action}{suffix}",
            distance_m=float(step["distance"]),
            location=Coordinate(lat=float(lat), lon=float(lon)),
        )
