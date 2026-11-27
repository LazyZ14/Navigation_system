import asyncio
import hashlib
import logging
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.gps.models import (
    GpsFixSubmission,
    GpsIngressReceipt,
    IngressDisposition,
    LatestGpsStatusResponse,
    LiveGpsFix,
)


LOGGER = logging.getLogger(__name__)


class GpsIngressRejectedError(ValueError):
    """Base error for a syntactically valid fix that cannot be admitted."""


class OutOfOrderGpsFixError(GpsIngressRejectedError):
    pass


class StaleGpsFixError(GpsIngressRejectedError):
    pass


@dataclass
class _StreamState:
    last_sequence: int
    last_fingerprint: str
    last_fix: GpsFixSubmission
    last_received_at: datetime


class GpsIngressService:
    """Bounded, process-local raw GPS receiver with no navigation dependencies."""

    def __init__(
        self,
        *,
        max_active_streams: int = 100,
        max_fix_age: timedelta = timedelta(seconds=30),
        max_future_skew: timedelta = timedelta(seconds=5),
        live_timeout: timedelta = timedelta(seconds=10),
        subscriber_queue_size: int = 10,
    ) -> None:
        self._max_active_streams = max_active_streams
        self._max_fix_age = max_fix_age
        self._max_future_skew = max_future_skew
        self._live_timeout = live_timeout
        self._subscriber_queue_size = subscriber_queue_size
        self._streams: OrderedDict[tuple[str, str], _StreamState] = OrderedDict()
        self._latest: tuple[GpsFixSubmission, datetime] | None = None
        self._subscribers: set[asyncio.Queue[LiveGpsFix]] = set()

    def ingest(self, fix: GpsFixSubmission, received_at: datetime | None = None) -> GpsIngressReceipt:
        received_at = (received_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
        self._validate_freshness(fix, received_at)

        key = (fix.device_id, str(fix.stream_id))
        fingerprint = self._fingerprint(fix)
        state = self._streams.get(key)
        if state is not None:
            self._streams.move_to_end(key)
            if fix.sequence == state.last_sequence and fingerprint == state.last_fingerprint:
                receipt = self._receipt(fix, received_at, accepted=False, disposition=IngressDisposition.DUPLICATE)
                self._log("gps_fix_duplicate", fix, receipt)
                return receipt
            if fix.sequence <= state.last_sequence:
                self._log_rejected("gps_fix_out_of_order", fix, received_at)
                raise OutOfOrderGpsFixError("sequence must increase within one stream")

        if state is None and len(self._streams) >= self._max_active_streams:
            self._streams.popitem(last=False)

        self._streams[key] = _StreamState(
            last_sequence=fix.sequence,
            last_fingerprint=fingerprint,
            last_fix=fix,
            last_received_at=received_at,
        )
        self._latest = (fix, received_at)
        self._publish(self._to_live_fix(fix, received_at))
        receipt = self._receipt(fix, received_at, accepted=True, disposition=IngressDisposition.ACCEPTED)
        self._log("gps_fix_accepted", fix, receipt)
        return receipt

    def latest_status(self, now: datetime | None = None) -> LatestGpsStatusResponse:
        if self._latest is None:
            return LatestGpsStatusResponse(active=False, age_ms=None, fix=None)
        fix, received_at = self._latest
        current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        age_delta = max(timedelta(0), current - received_at)
        age_ms = round(age_delta.total_seconds() * 1000)
        return LatestGpsStatusResponse(
            active=age_delta <= self._live_timeout,
            age_ms=age_ms,
            fix=self._to_live_fix(fix, received_at),
        )

    def subscribe(self) -> asyncio.Queue[LiveGpsFix]:
        queue: asyncio.Queue[LiveGpsFix] = asyncio.Queue(maxsize=self._subscriber_queue_size)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[LiveGpsFix]) -> None:
        self._subscribers.discard(queue)

    def _publish(self, live_fix: LiveGpsFix) -> None:
        for queue in tuple(self._subscribers):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(live_fix)
            except asyncio.QueueFull:
                pass

    @staticmethod
    def _to_live_fix(fix: GpsFixSubmission, received_at: datetime) -> LiveGpsFix:
        return LiveGpsFix(
            device_id=fix.device_id,
            stream_id=fix.stream_id,
            sequence=fix.sequence,
            lat=fix.lat,
            lon=fix.lon,
            accuracy_m=fix.accuracy_m,
            speed_mps=fix.speed_mps,
            heading_deg=fix.heading_deg,
            timestamp=fix.timestamp,
            received_at=received_at,
        )

    def _validate_freshness(self, fix: GpsFixSubmission, received_at: datetime) -> None:
        if received_at - fix.timestamp > self._max_fix_age or fix.timestamp - received_at > self._max_future_skew:
            self._log_rejected("gps_fix_stale", fix, received_at)
            raise StaleGpsFixError("timestamp is outside the accepted freshness window")

    @staticmethod
    def _fingerprint(fix: GpsFixSubmission) -> str:
        return hashlib.sha256(fix.model_dump_json().encode("utf-8")).hexdigest()

    @staticmethod
    def _device_log_id(device_id: str) -> str:
        return hashlib.sha256(device_id.encode("utf-8")).hexdigest()[:12]

    @staticmethod
    def _receipt(
        fix: GpsFixSubmission,
        received_at: datetime,
        *,
        accepted: bool,
        disposition: IngressDisposition,
    ) -> GpsIngressReceipt:
        return GpsIngressReceipt(
            accepted=accepted,
            disposition=disposition,
            device_id=fix.device_id,
            stream_id=fix.stream_id,
            sequence=fix.sequence,
            timestamp=fix.timestamp,
            received_at=received_at,
            network_delay_ms=round((received_at - fix.timestamp).total_seconds() * 1000),
        )

    def _log(self, event: str, fix: GpsFixSubmission, receipt: GpsIngressReceipt) -> None:
        LOGGER.info(
            event,
            extra={
                "gps_event": event,
                "device": self._device_log_id(fix.device_id),
                "stream_id": str(fix.stream_id),
                "sequence": fix.sequence,
                "network_delay_ms": receipt.network_delay_ms,
            },
        )

    def _log_rejected(self, event: str, fix: GpsFixSubmission, received_at: datetime) -> None:
        LOGGER.warning(
            event,
            extra={
                "gps_event": event,
                "device": self._device_log_id(fix.device_id),
                "stream_id": str(fix.stream_id),
                "sequence": fix.sequence,
                "network_delay_ms": round((received_at - fix.timestamp).total_seconds() * 1000),
            },
        )
