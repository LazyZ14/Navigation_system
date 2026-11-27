from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest

from app.gps.models import GpsFixSubmission, IngressDisposition
from app.gps.service import GpsIngressService, OutOfOrderGpsFixError, StaleGpsFixError


NOW = datetime(2026, 10, 21, 13, 20, 31, tzinfo=timezone.utc)
STREAM_A = UUID("f5824845-1c55-40c8-b98f-fdf7d5aa81d9")
STREAM_B = UUID("f5824845-1c55-40c8-b98f-fdf7d5aa81da")


def make_fix(*, stream_id: UUID = STREAM_A, sequence: int = 0, timestamp: datetime | None = None, lon: float = 116.4074) -> GpsFixSubmission:
    return GpsFixSubmission(
        schema_version=1,
        device_id="ios-test-device",
        stream_id=stream_id,
        sequence=sequence,
        lat=39.9042,
        lon=lon,
        accuracy_m=8.5,
        speed_mps=6.2,
        heading_deg=85.0,
        timestamp=timestamp or NOW - timedelta(milliseconds=250),
    )


def test_ingest_accepts_new_fix_and_keeps_client_and_server_times_distinct():
    receipt = GpsIngressService().ingest(make_fix(), received_at=NOW)

    assert receipt.accepted is True
    assert receipt.disposition is IngressDisposition.ACCEPTED
    assert receipt.received_at == NOW
    assert receipt.network_delay_ms == 250
    assert receipt.timestamp == NOW - timedelta(milliseconds=250)


def test_ingest_returns_idempotent_duplicate_for_same_stream_sequence_and_payload():
    service = GpsIngressService()
    service.ingest(make_fix(), received_at=NOW)

    receipt = service.ingest(make_fix(), received_at=NOW + timedelta(seconds=1))

    assert receipt.accepted is False
    assert receipt.disposition is IngressDisposition.DUPLICATE
    assert receipt.received_at == NOW + timedelta(seconds=1)


def test_ingest_rejects_changed_or_lower_sequence_inside_same_stream():
    service = GpsIngressService()
    service.ingest(make_fix(sequence=1), received_at=NOW)

    with pytest.raises(OutOfOrderGpsFixError):
        service.ingest(make_fix(sequence=1, lon=116.4075), received_at=NOW)
    with pytest.raises(OutOfOrderGpsFixError):
        service.ingest(make_fix(sequence=0), received_at=NOW)


def test_ingest_allows_a_new_stream_to_restart_sequence_from_zero():
    service = GpsIngressService()
    service.ingest(make_fix(stream_id=STREAM_A, sequence=4), received_at=NOW)

    receipt = service.ingest(make_fix(stream_id=STREAM_B, sequence=0), received_at=NOW)

    assert receipt.accepted is True
    assert receipt.stream_id == STREAM_B
    assert receipt.sequence == 0


@pytest.mark.parametrize(
    "timestamp",
    [NOW - timedelta(seconds=30, milliseconds=1), NOW + timedelta(seconds=5, milliseconds=1)],
)
def test_ingest_rejects_stale_or_future_fix_using_client_timestamp(timestamp: datetime):
    with pytest.raises(StaleGpsFixError):
        GpsIngressService().ingest(make_fix(timestamp=timestamp), received_at=NOW)


def test_latest_status_reports_empty_active_and_expired_after_ten_seconds():
    service = GpsIngressService()

    empty = service.latest_status(now=NOW)
    assert empty.active is False
    assert empty.fix is None
    assert empty.age_ms is None

    service.ingest(make_fix(sequence=3), received_at=NOW)

    fresh = service.latest_status(now=NOW + timedelta(seconds=2))
    assert fresh.active is True
    assert fresh.age_ms == 2000
    assert fresh.fix is not None
    assert fresh.fix.sequence == 3
    assert fresh.fix.lat == 39.9042
    assert fresh.fix.lon == 116.4074

    expired = service.latest_status(now=NOW + timedelta(seconds=11))
    assert expired.active is False
    assert expired.age_ms == 11000
    assert expired.fix is not None
    assert expired.fix.sequence == 3


def test_slow_websocket_subscriber_drops_oldest_without_blocking_ingest():
    service = GpsIngressService()
    queue = service.subscribe()
    try:
        for seq in range(15):
            ts = NOW + timedelta(milliseconds=seq * 200)
            service.ingest(make_fix(sequence=seq, timestamp=ts), received_at=ts + timedelta(milliseconds=20))

        drained = []
        while not queue.empty():
            drained.append(queue.get_nowait().sequence)

        assert len(drained) == 10
        assert drained == list(range(5, 15))
    finally:
        service.unsubscribe(queue)
