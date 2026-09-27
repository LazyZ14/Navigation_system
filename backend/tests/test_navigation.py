import asyncio
from datetime import UTC, datetime

import pytest

from app.models import Coordinate, LocationFix, Maneuver, RouteResponse
from app.services.navigation import NavigationService
from app.services.osrm import MatchedRoad, RouteNotFound


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


class ReplanningClient:
    def __init__(self, matches: list[MatchedRoad]):
        self.matches = iter(matches)
        self.route_calls = 0

    async def nearest(self, _: Coordinate) -> MatchedRoad:
        return next(self.matches)

    async def route(self, origin: Coordinate, destination: Coordinate) -> RouteResponse:
        self.route_calls += 1
        if hasattr(self, "route_error"):
            raise self.route_error
        return self.replacement if hasattr(self, "replacement") else RouteResponse(geometry=[origin, destination], distance_m=600, duration_s=90, maneuvers=[])


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


@pytest.mark.asyncio
async def test_matched_progress_reduces_remaining_distance_and_advances_maneuver():
    route = RouteResponse(
        geometry=[
            Coordinate(lat=39.9, lon=116.4),
            Coordinate(lat=39.9, lon=116.405),
            Coordinate(lat=39.9, lon=116.41),
        ],
        distance_m=1000,
        duration_s=120,
        maneuvers=[
            Maneuver(instruction="继续直行", distance_m=400, location=Coordinate(lat=39.9, lon=116.402)),
            Maneuver(instruction="右转", distance_m=300, location=Coordinate(lat=39.9, lon=116.408)),
        ],
    )
    service = NavigationService(
        FakeOsrmClient(MatchedRoad(location=Coordinate(lat=39.9, lon=116.406), distance_m=5)),
        route,
        destination=route.geometry[-1],
    )

    state = await service.apply_fix(fix())

    assert state.remaining_distance_m is not None
    assert 0 < state.remaining_distance_m < route.distance_m
    assert state.next_maneuver is not None
    assert state.next_maneuver.instruction == "右转"


@pytest.mark.asyncio
async def test_three_consecutive_matched_deviations_replan_once_and_reset_counter():
    route = RouteResponse(
        geometry=[Coordinate(lat=39.9, lon=116.4), Coordinate(lat=39.9, lon=116.41)],
        distance_m=1000,
        duration_s=120,
        maneuvers=[],
    )
    deviations = [MatchedRoad(Coordinate(lat=39.9005, lon=116.4), 5) for _ in range(3)]
    client = ReplanningClient(deviations)
    service = NavigationService(client, route, destination=Coordinate(lat=39.9, lon=116.41))

    for second in range(3):
        state = await service.apply_fix(fix().model_copy(update={"timestamp": datetime(2026, 9, 23, 0, 0, second, tzinfo=UTC)}))

    assert state.off_route is True
    assert client.route_calls == 1
    assert service.route.distance_m == 600


@pytest.mark.asyncio
async def test_replan_cooldown_prevents_a_second_replan_for_ten_seconds():
    route = RouteResponse(geometry=[Coordinate(lat=39.9, lon=116.4), Coordinate(lat=39.9, lon=116.41)], distance_m=1000, duration_s=120, maneuvers=[])
    client = ReplanningClient([MatchedRoad(Coordinate(lat=39.9005, lon=116.4), 5) for _ in range(6)])
    client.replacement = route
    service = NavigationService(client, route, destination=Coordinate(lat=39.9, lon=116.41))
    for second in range(6):
        await service.apply_fix(fix().model_copy(update={"timestamp": datetime(2026, 9, 23, 0, 0, second, tzinfo=UTC)}))

    assert client.route_calls == 1


@pytest.mark.asyncio
async def test_one_transient_deviation_followed_by_on_route_points_does_not_replan():
    route = RouteResponse(geometry=[Coordinate(lat=39.9, lon=116.4), Coordinate(lat=39.9, lon=116.41)], distance_m=1000, duration_s=120, maneuvers=[])
    client = ReplanningClient([
        MatchedRoad(Coordinate(lat=39.90035, lon=116.4), 5),
        MatchedRoad(Coordinate(lat=39.9, lon=116.401), 5),
        MatchedRoad(Coordinate(lat=39.9, lon=116.402), 5),
    ])
    service = NavigationService(client, route, destination=route.geometry[-1])

    for second in range(3):
        state = await service.apply_fix(fix().model_copy(update={"timestamp": datetime(2026, 9, 23, 0, 0, second, tzinfo=UTC)}))

    assert client.route_calls == 0
    assert state.off_route is False


@pytest.mark.asyncio
async def test_failed_replan_keeps_the_active_route_and_enters_cooldown():
    route = RouteResponse(geometry=[Coordinate(lat=39.9, lon=116.4), Coordinate(lat=39.9, lon=116.41)], distance_m=1000, duration_s=120, maneuvers=[])
    client = ReplanningClient([MatchedRoad(Coordinate(lat=39.9005, lon=116.4), 5) for _ in range(6)])
    client.route_error = RouteNotFound()
    service = NavigationService(client, route, destination=route.geometry[-1])

    for second in range(6):
        state = await service.apply_fix(fix().model_copy(update={"timestamp": datetime(2026, 9, 23, 0, 0, second, tzinfo=UTC)}))

    assert state.status == "navigating"
    assert service.route is route
    assert client.route_calls == 1
