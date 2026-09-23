import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.models import RouteRequest, RouteResponse
from app.services.osrm import OsrmClient, RouteNotFound

router = APIRouter(prefix="/api", tags=["routing"])


def get_osrm_client() -> OsrmClient:
    return OsrmClient(get_settings().osrm_base_url)


@router.post("/routes", response_model=RouteResponse)
async def create_route(
    request: RouteRequest,
    client: OsrmClient = Depends(get_osrm_client),
) -> RouteResponse | JSONResponse:
    try:
        return await client.route(request.origin, request.destination)
    except RouteNotFound:
        return JSONResponse(status_code=404, content={"code": "route_not_found"})
    except (httpx.HTTPError, OSError):
        return JSONResponse(status_code=503, content={"code": "routing_unavailable"})
