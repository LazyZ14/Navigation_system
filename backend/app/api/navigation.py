import httpx
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from app.config import get_settings
from app.models import LocationFix, NavigationSession, NavigationSessionRequest
from app.services.replay import load_track
from app.services.navigation import NavigationSessionStore
from app.services.osrm import OsrmClient, RouteNotFound

router = APIRouter(prefix="/api/navigation", tags=["navigation"])
websocket_router = APIRouter(tags=["navigation"])


@lru_cache
def get_navigation_store() -> NavigationSessionStore:
    track_dir = __import__("pathlib").Path(__file__).parents[3] / "data" / "tracks"
    return NavigationSessionStore(
        OsrmClient(get_settings().osrm_base_url),
        tracks={"normal-route": load_track(track_dir / "normal-route.json")},
    )


@router.post("/sessions", response_model=NavigationSession, status_code=201)
async def create_navigation_session(
    request: NavigationSessionRequest,
    store: NavigationSessionStore = Depends(get_navigation_store),
) -> NavigationSession:
    try:
        return await store.create(request.origin, request.destination, request.track_id)
    except RouteNotFound as error:
        raise HTTPException(status_code=404, detail={"code": "route_not_found"}) from error
    except (httpx.HTTPError, OSError) as error:
        raise HTTPException(status_code=503, detail={"code": "routing_unavailable"}) from error


def require_session(store: NavigationSessionStore, session_id: str) -> NavigationSession:
    session = store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail={"code": "navigation_session_not_found"})
    return session


@router.get("/{session_id}", response_model=NavigationSession)
async def get_navigation_session(
    session_id: str,
    store: NavigationSessionStore = Depends(get_navigation_store),
) -> NavigationSession:
    return require_session(store, session_id)


@router.post("/{session_id}/fixes", response_model=NavigationSession)
async def apply_navigation_fix(
    session_id: str,
    fix: LocationFix,
    store: NavigationSessionStore = Depends(get_navigation_store),
) -> NavigationSession:
    session = await store.apply_fix(session_id, fix)
    if session is None:
        raise HTTPException(status_code=404, detail={"code": "navigation_session_not_found"})
    return session


@router.post("/{session_id}/replay/next", response_model=NavigationSession)
async def replay_next(
    session_id: str,
    store: NavigationSessionStore = Depends(get_navigation_store),
) -> NavigationSession:
    session = await store.replay_next(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail={"code": "navigation_session_or_replay_not_found"})
    return session


@websocket_router.websocket("/ws/navigation/{session_id}")
async def navigation_updates(
    websocket: WebSocket,
    session_id: str,
    store: NavigationSessionStore = Depends(get_navigation_store),
) -> None:
    if store.get(session_id) is None:
        await websocket.close(code=4404)
        return
    await websocket.accept()
    try:
        async for state in store.subscribe(session_id):
            await websocket.send_json(state.model_dump(mode="json"))
    except WebSocketDisconnect:
        return
