import asyncio
from datetime import datetime, timezone

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
        timestamp=datetime(2026, 9, 23, tzinfo=timezone.utc),
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
        state = await service.apply_fix(fix().model_copy(update={"timestamp": datetime(2026, 9, 23, 0, 0, second, tzinfo=timezone.utc)}))

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
        await service.apply_fix(fix().model_copy(update={"timestamp": datetime(2026, 9, 23, 0, 0, second, tzinfo=timezone.utc)}))

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
        state = await service.apply_fix(fix().model_copy(update={"timestamp": datetime(2026, 9, 23, 0, 0, second, tzinfo=timezone.utc)}))

    assert client.route_calls == 0
    assert state.off_route is False


@pytest.mark.asyncio
async def test_failed_replan_keeps_the_active_route_and_enters_cooldown():
    route = RouteResponse(geometry=[Coordinate(lat=39.9, lon=116.4), Coordinate(lat=39.9, lon=116.41)], distance_m=1000, duration_s=120, maneuvers=[])
    client = ReplanningClient([MatchedRoad(Coordinate(lat=39.9005, lon=116.4), 5) for _ in range(6)])
    client.route_error = RouteNotFound()
    service = NavigationService(client, route, destination=route.geometry[-1])

    for second in range(6):
        state = await service.apply_fix(fix().model_copy(update={"timestamp": datetime(2026, 9, 23, 0, 0, second, tzinfo=timezone.utc)}))

    assert state.status == "navigating"
    assert service.route is route
    assert client.route_calls == 1


class RouteOnlyClient:
    def __init__(self, route: RouteResponse):
        self._route = route
        self.route_calls = 0

    async def nearest(self, _: Coordinate) -> MatchedRoad | None:
        return None

    async def route(self, origin: Coordinate, destination: Coordinate) -> RouteResponse:
        self.route_calls += 1
        return self._route


@pytest.mark.asyncio
async def test_session_store_creates_session_with_current_route_track():
    from app.services.navigation import NavigationSessionStore

    route = RouteResponse(
        geometry=[Coordinate(lat=39.9, lon=116.4), Coordinate(lat=39.9, lon=116.41)],
        distance_m=1000,
        duration_s=120,
        maneuvers=[],
    )
    client = RouteOnlyClient(route)
    store = NavigationSessionStore(client)

    session = await store.create(
        origin=Coordinate(lat=39.9, lon=116.4),
        destination=Coordinate(lat=39.9, lon=116.41),
        track_id="current-route",
    )

    assert session.session_id is not None
    assert session.route == route
    assert client.route_calls == 1


@pytest.mark.asyncio
async def test_current_route_track_first_point_near_route_start():
    from app.services.navigation import NavigationSessionStore

    route = RouteResponse(
        geometry=[Coordinate(lat=39.9, lon=116.4), Coordinate(lat=39.9, lon=116.41)],
        distance_m=1000,
        duration_s=120,
        maneuvers=[],
    )
    client = RouteOnlyClient(route)
    store = NavigationSessionStore(client)

    session = await store.create(
        origin=Coordinate(lat=39.9, lon=116.4),
        destination=Coordinate(lat=39.9, lon=116.41),
        track_id="current-route",
    )

    replay = store._replays.get(session.session_id)
    assert replay is not None
    first_fix = replay._points[0]
    assert first_fix.lat == 39.9
    assert first_fix.lon == 116.4


@pytest.mark.asyncio
async def test_current_route_track_last_point_near_route_end():
    from app.services.navigation import NavigationSessionStore

    route = RouteResponse(
        geometry=[Coordinate(lat=39.9, lon=116.4), Coordinate(lat=39.9, lon=116.41)],
        distance_m=1000,
        duration_s=120,
        maneuvers=[],
    )
    client = RouteOnlyClient(route)
    store = NavigationSessionStore(client)

    session = await store.create(
        origin=Coordinate(lat=39.9, lon=116.4),
        destination=Coordinate(lat=39.9, lon=116.41),
        track_id="current-route",
    )

    replay = store._replays.get(session.session_id)
    assert replay is not None
    last_fix = replay._points[-1]
    assert last_fix.lat == 39.9
    assert last_fix.lon == 116.41


@pytest.mark.asyncio
async def test_current_route_replay_reaches_arrival():
    from app.services.navigation import NavigationSessionStore

    route = RouteResponse(
        geometry=[Coordinate(lat=39.9, lon=116.4), Coordinate(lat=39.9, lon=116.41)],
        distance_m=1000,
        duration_s=120,
        maneuvers=[],
    )

    class MatchingClient:
        def __init__(self, route: RouteResponse):
            self._route = route

        async def nearest(self, location: Coordinate) -> MatchedRoad | None:
            return MatchedRoad(location=location, distance_m=5)

        async def route(self, origin: Coordinate, destination: Coordinate) -> RouteResponse:
            return self._route

    client = MatchingClient(route)
    store = NavigationSessionStore(client)

    session = await store.create(
        origin=Coordinate(lat=39.9, lon=116.4),
        destination=Coordinate(lat=39.9, lon=116.41),
        track_id="current-route",
    )

    final_state = None
    for _ in range(200):
        session = await store.replay_next(session.session_id)
        if session is None:
            break
        final_state = session.state
        if final_state.status == "arrived":
            break

    assert final_state is not None
    assert final_state.status == "arrived"


@pytest.mark.asyncio
async def test_different_routes_produce_different_tracks():
    from app.services.navigation import NavigationSessionStore

    route_a = RouteResponse(
        geometry=[Coordinate(lat=39.9, lon=116.4), Coordinate(lat=39.9, lon=116.41)],
        distance_m=1000,
        duration_s=120,
        maneuvers=[],
    )
    route_b = RouteResponse(
        geometry=[Coordinate(lat=40.0, lon=116.5), Coordinate(lat=40.0, lon=116.51)],
        distance_m=1000,
        duration_s=120,
        maneuvers=[],
    )
    client_a = RouteOnlyClient(route_a)
    client_b = RouteOnlyClient(route_b)
    store = NavigationSessionStore(client_a)

    session_a = await store.create(
        origin=Coordinate(lat=39.9, lon=116.4),
        destination=Coordinate(lat=39.9, lon=116.41),
        track_id="current-route",
    )
    store2 = NavigationSessionStore(client_b)
    session_b = await store2.create(
        origin=Coordinate(lat=40.0, lon=116.5),
        destination=Coordinate(lat=40.0, lon=116.51),
        track_id="current-route",
    )

    replay_a = store._replays.get(session_a.session_id)
    replay_b = store2._replays.get(session_b.session_id)
    assert replay_a is not None
    assert replay_b is not None
    assert replay_a._points[0].lat != replay_b._points[0].lat


@pytest.mark.asyncio
async def test_existing_fixed_tracks_still_work():
    from app.services.navigation import NavigationSessionStore

    route = RouteResponse(
        geometry=[Coordinate(lat=39.9, lon=116.4), Coordinate(lat=39.9, lon=116.41)],
        distance_m=1000,
        duration_s=120,
        maneuvers=[],
    )
    client = RouteOnlyClient(route)
    fixed_track = [
        LocationFix(
            lat=39.9,
            lon=116.4,
            heading=90,
            speed_mps=8,
            accuracy_m=5,
            timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
    ]
    store = NavigationSessionStore(client, tracks={"normal-route": fixed_track})

    session = await store.create(
        origin=Coordinate(lat=39.9, lon=116.4),
        destination=Coordinate(lat=39.9, lon=116.41),
        track_id="normal-route",
    )

    replay = store._replays.get(session.session_id)
    assert replay is not None
    assert replay._points == fixed_track


@pytest.mark.asyncio
async def test_unknown_track_id_raises_value_error():
    from app.services.navigation import NavigationSessionStore

    route = RouteResponse(
        geometry=[Coordinate(lat=39.9, lon=116.4), Coordinate(lat=39.9, lon=116.41)],
        distance_m=1000,
        duration_s=120,
        maneuvers=[],
    )
    client = RouteOnlyClient(route)
    store = NavigationSessionStore(client)

    with pytest.raises(ValueError, match="unknown synthetic track"):
        await store.create(
            origin=Coordinate(lat=39.9, lon=116.4),
            destination=Coordinate(lat=39.9, lon=116.41),
            track_id="unknown-track",
        )
