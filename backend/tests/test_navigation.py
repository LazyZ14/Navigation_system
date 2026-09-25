from datetime import UTC, datetime

import pytest

from app.models import Coordinate, LocationFix
from app.services.navigation import NavigationService
from app.services.osrm import MatchedRoad


def fix() -> LocationFix:
    return LocationFix(
        lat=39.9,
        lon=116.4,
        heading=90,
        speed_mps=8,
        accuracy_m=5,
        timestamp=datetime(2026, 9, 23, tzinfo=UTC),
    )


class FakeOsrmClient:
    def __init__(self, result: MatchedRoad | None):
        self.result = result

    async def nearest(self, _: Coordinate) -> MatchedRoad | None:
        return self.result


@pytest.mark.asyncio
async def test_nearby_road_match_returns_navigating_state():
    service = NavigationService(FakeOsrmClient(MatchedRoad(location=Coordinate(lat=39.9, lon=116.4), distance_m=20)))

    state = await service.apply_fix(fix())

    assert state.status == "navigating"
    assert state.matched_location == Coordinate(lat=39.9, lon=116.4)


@pytest.mark.asyncio
async def test_distant_road_match_returns_unmatched_state():
    service = NavigationService(FakeOsrmClient(MatchedRoad(location=Coordinate(lat=39.9, lon=116.4), distance_m=250)))

    state = await service.apply_fix(fix())

    assert state.status == "unmatched"
    assert state.matched_location is None
