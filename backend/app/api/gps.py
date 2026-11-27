import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Response, WebSocket, WebSocketDisconnect, status

from app.config import Settings, get_settings
from app.gps.models import GpsFixSubmission, GpsIngressReceipt, LatestGpsStatusResponse
from app.gps.service import GpsIngressService, OutOfOrderGpsFixError, StaleGpsFixError


router = APIRouter(prefix="/api/gps", tags=["gps"])
gps_websocket_router = APIRouter(tags=["gps"])
_ingress_service: GpsIngressService | None = None


def get_gps_ingress_service() -> GpsIngressService:
    global _ingress_service
    if _ingress_service is None:
        _ingress_service = GpsIngressService(max_active_streams=get_settings().gps_max_active_streams)
    return _ingress_service


def _require_device_token(fix: GpsFixSubmission, authorization: str | None, settings: Settings) -> None:
    expected_token = settings.gps_device_tokens.get(fix.device_id)
    presented_token = authorization.removeprefix("Bearer ") if authorization and authorization.startswith("Bearer ") else None
    if expected_token is None or presented_token is None or not hmac.compare_digest(expected_token, presented_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "unauthorized"})


@router.post("/fixes", response_model=GpsIngressReceipt, status_code=status.HTTP_202_ACCEPTED)
async def receive_raw_gps_fix(
    fix: GpsFixSubmission,
    response: Response,
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
    service: GpsIngressService = Depends(get_gps_ingress_service),
) -> GpsIngressReceipt:
    _require_device_token(fix, authorization, settings)
    try:
        receipt = service.ingest(fix)
    except StaleGpsFixError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "stale"}) from error
    except OutOfOrderGpsFixError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "out_of_order"}) from error
    if not receipt.accepted:
        # A duplicate is intentionally successful and idempotent.
        response.status_code = status.HTTP_200_OK
    return receipt


@router.get("/latest", response_model=LatestGpsStatusResponse)
async def get_latest_gps_status(
    service: GpsIngressService = Depends(get_gps_ingress_service),
) -> LatestGpsStatusResponse:
    return service.latest_status()


@gps_websocket_router.websocket("/ws/gps/live")
async def live_gps_updates(
    websocket: WebSocket,
    service: GpsIngressService = Depends(get_gps_ingress_service),
) -> None:
    await websocket.accept()
    queue = service.subscribe()
    try:
        snapshot = service.latest_status()
        if snapshot.active and snapshot.fix is not None:
            await websocket.send_json(snapshot.fix.model_dump(mode="json"))
        while True:
            live_fix = await queue.get()
            await websocket.send_json(live_fix.model_dump(mode="json"))
    except WebSocketDisconnect:
        return
    finally:
        service.unsubscribe(queue)
