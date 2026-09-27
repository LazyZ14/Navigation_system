from datetime import UTC, datetime, timedelta
import json
from pathlib import Path

import pytest

from app.models import LocationFix
from app.services.replay import ReplayController, load_track


def point(seconds: int) -> LocationFix:
    return LocationFix(
        lat=39.9,
        lon=116.4,
        heading=90,
        speed_mps=8,
        accuracy_m=5,
        timestamp=datetime(2026, 9, 23, tzinfo=UTC) + timedelta(seconds=seconds),
    )


def test_replay_emits_points_in_timestamp_order():
    replay = ReplayController([point(0), point(2)])

    replay.start()

    assert replay.next_fix() == point(0)
    assert replay.next_fix() == point(2)
    assert replay.next_fix() is None


def test_replay_pause_and_resume_preserves_next_point():
    replay = ReplayController([point(0), point(2)])
    replay.start()
    assert replay.next_fix() == point(0)

    replay.pause()
    assert replay.next_fix() is None
    replay.resume()

    assert replay.next_fix() == point(2)


def test_replay_rejects_non_monotonic_timestamps():
    with pytest.raises(ValueError, match="monotonic"):
        ReplayController([point(2), point(0)])


def test_load_track_parses_versioned_synthetic_location_fixes(tmp_path: Path):
    track_path = tmp_path / "normal-route.json"
    track_path.write_text(
        json.dumps(
            {
                "version": 1,
                "points": [point(0).model_dump(mode="json"), point(2).model_dump(mode="json")],
            }
        )
    )

    loaded = load_track(track_path)

    assert loaded == [point(0), point(2)]
