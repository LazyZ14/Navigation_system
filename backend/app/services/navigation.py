import asyncio
from collections.abc import AsyncIterator
from typing import Protocol
from uuid import uuid4

from app.models import Coordinate, LocationFix, NavigationSession, NavigationState, RouteResponse
from app.services.osrm import MatchedRoad
from app.services.replay import ReplayController
from app.services.geometry import distance_to_polyline_m, polyline_progress_fraction


class NearestRoadClient(Protocol):
    async def nearest(self, location: Coordinate) -> MatchedRoad | None: ...


class NavigationService:
    def __init__(self, client: NearestRoadClient, route: RouteResponse | None = None, destination: Coordinate | None = None):
        self._client = client
        self._route = route
        self._destination = destination
        self._deviation_count = 0
        self._last_replan_at = None
        self._state = NavigationState(
            status="ready",
            next_maneuver=route.maneuvers[0] if route and route.maneuvers else None,
            remaining_distance_m=route.distance_m if route else None,
        )

    @property
    def state(self) -> NavigationState:
        return self._state

    @property
    def route(self) -> RouteResponse | None:
        return self._route

    async def apply_fix(self, fix: LocationFix) -> NavigationState:
        matched = await self._client.nearest(fix)
        if matched is None or matched.distance_m > 50:
            self._state = NavigationState(status="unmatched", raw_location=fix)
            return self._state
        off_route = False
        if self._route and self._destination and distance_to_polyline_m(matched.location, self._route.geometry) > 30:
            self._deviation_count += 1
            cooldown_elapsed = self._last_replan_at is None or (fix.timestamp - self._last_replan_at).total_seconds() >= 10
            if self._deviation_count >= 3 and cooldown_elapsed and hasattr(self._client, "route"):
                self._route = await self._client.route(matched.location, self._destination)  # type: ignore[attr-defined]
                self._deviation_count = 0
                self._last_replan_at = fix.timestamp
                off_route = True
        else:
            self._deviation_count = 0
        progress = polyline_progress_fraction(matched.location, self._route.geometry) if self._route else 0.0
        next_maneuver = None
        if self._route:
            next_maneuver = next(
                (
                    maneuver
                    for maneuver in self._route.maneuvers
                    if polyline_progress_fraction(maneuver.location, self._route.geometry) >= progress
                ),
                None,
            )
        self._state = NavigationState(
            status="navigating",
            raw_location=fix,
            matched_location=matched.location,
            next_maneuver=next_maneuver,
            remaining_distance_m=self._route.distance_m * (1 - progress) if self._route else None,
            off_route=off_route,
        )
        return self._state

    def arrive(self) -> NavigationState:
        self._state = self._state.model_copy(update={"status": "arrived", "off_route": False})
        return self._state


class NavigationRouteClient(NearestRoadClient, Protocol):
    async def route(self, origin: Coordinate, destination: Coordinate) -> RouteResponse: ...


class NavigationSessionStore:
    def __init__(self, client: NavigationRouteClient, tracks: dict[str, list[LocationFix]] | None = None):
        self._client = client
        self._services: dict[str, NavigationService] = {}
        self._routes: dict[str, RouteResponse] = {}
        self._subscribers: dict[str, set[asyncio.Queue[NavigationState]]] = {}
        self._tracks = tracks or {}
        self._replays: dict[str, ReplayController] = {}

    async def create(
        self, origin: Coordinate, destination: Coordinate, track_id: str | None = None
    ) -> NavigationSession:
        route = await self._client.route(origin, destination)
        session_id = str(uuid4())
        service = NavigationService(self._client, route, destination=destination)
        self._services[session_id] = service
        self._routes[session_id] = route
        if track_id is not None:
            points = self._tracks.get(track_id)
            if points is None:
                raise ValueError("unknown synthetic track")
            replay = ReplayController(points)
            replay.start()
            self._replays[session_id] = replay
        return NavigationSession(session_id=session_id, route=route, state=service.state)

    def get(self, session_id: str) -> NavigationSession | None:
        service = self._services.get(session_id)
        route = self._routes.get(session_id)
        if service is None or route is None:
            return None
        return NavigationSession(session_id=session_id, route=route, state=service.state)

    async def apply_fix(self, session_id: str, fix: LocationFix) -> NavigationSession | None:
        service = self._services.get(session_id)
        if service is None or session_id not in self._routes:
            return None
        state = await service.apply_fix(fix)
        if service.route is not None:
            self._routes[session_id] = service.route
        for subscriber in self._subscribers.get(session_id, set()):
            subscriber.put_nowait(state)
        return NavigationSession(session_id=session_id, route=self._routes[session_id], state=state)

    async def replay_next(self, session_id: str) -> NavigationSession | None:
        replay = self._replays.get(session_id)
        if replay is None:
            return None
        fix = replay.next_fix()
        if fix is None:
            if not replay.finished:
                return self.get(session_id)
            service = self._services.get(session_id)
            if service is None:
                return None
            state = service.arrive()
            for subscriber in self._subscribers.get(session_id, set()):
                subscriber.put_nowait(state)
            return self.get(session_id)
        return await self.apply_fix(session_id, fix)

    def pause_replay(self, session_id: str) -> bool:
        replay = self._replays.get(session_id)
        if replay is None:
            return False
        replay.pause()
        return True

    def resume_replay(self, session_id: str) -> bool:
        replay = self._replays.get(session_id)
        if replay is None:
            return False
        replay.resume()
        return True

    async def subscribe(self, session_id: str) -> AsyncIterator[NavigationState]:
        session = self.get(session_id)
        if session is None:
            return
        queue: asyncio.Queue[NavigationState] = asyncio.Queue()
        self._subscribers.setdefault(session_id, set()).add(queue)
        queue.put_nowait(session.state)
        try:
            while True:
                yield await queue.get()
        finally:
            self._subscribers[session_id].discard(queue)
