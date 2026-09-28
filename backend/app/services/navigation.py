import asyncio
from collections.abc import AsyncIterator
from typing import Protocol
from uuid import uuid4

import httpx

from app.models import Coordinate, LocationFix, NavigationSession, NavigationState, RouteResponse
from app.services.geometry import distance_between_m, distance_to_polyline_m, polyline_progress_fraction
from app.services.osrm import MatchedRoad, RouteNotFound
from app.services.replay import ReplayController


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
                try:
                    replacement = await self._client.route(matched.location, self._destination)  # type: ignore[attr-defined]
                except (RouteNotFound, httpx.HTTPError, OSError):
                    replacement = None
                self._deviation_count = 0
                self._last_replan_at = fix.timestamp
                if replacement is not None:
                    self._route = replacement
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
            progress=progress,
        )
        return self._state

    def arrive(self) -> NavigationState:
        self._state = self._state.model_copy(update={"status": "arrived", "off_route": False})
        return self._state

    def finish_replay(self) -> NavigationState:
        arrived = (
            self._state.matched_location is not None
            and self._destination is not None
            and distance_between_m(self._state.matched_location, self._destination) <= 50
        )
        self._state = self._state.model_copy(
            update={"status": "arrived" if arrived else "replay_finished", "off_route": False}
        )
        return self._state


class NavigationRouteClient(NearestRoadClient, Protocol):
    async def route(self, origin: Coordinate, destination: Coordinate) -> RouteResponse: ...


class NavigationSessionStore:
    def __init__(self, client: NavigationRouteClient, tracks: dict[str, list[LocationFix]] | None = None):
        self._client = client
        self._services: dict[str, NavigationService] = {}
        self._routes: dict[str, RouteResponse] = {}
        self._subscribers: dict[str, set[asyncio.Queue[NavigationSession]]] = {}
        self._tracks = tracks or {}
        self._replays: dict[str, ReplayController] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def create(
        self, origin: Coordinate, destination: Coordinate, track_id: str | None = None
    ) -> NavigationSession:
        route = await self._client.route(origin, destination)
        points = None
        if track_id == "current-route":
            from app.services.track_generator import generate_route_track
            points = generate_route_track(route)
        elif track_id is not None:
            points = self._tracks.get(track_id)
            if points is None:
                raise ValueError("unknown synthetic track")
        session_id = str(uuid4())
        service = NavigationService(self._client, route, destination=destination)
        self._services[session_id] = service
        self._routes[session_id] = route
        self._locks[session_id] = asyncio.Lock()
        if points is not None:
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
        lock = self._locks.get(session_id)
        if lock is None:
            return None
        async with lock:
            return await self._apply_fix(session_id, fix)

    async def _apply_fix(self, session_id: str, fix: LocationFix) -> NavigationSession | None:
        service = self._services.get(session_id)
        if service is None or session_id not in self._routes:
            return None
        state = await service.apply_fix(fix)
        if service.route is not None:
            self._routes[session_id] = service.route
        session = NavigationSession(session_id=session_id, route=self._routes[session_id], state=state)
        self._publish(session)
        return session

    async def replay_next(self, session_id: str) -> NavigationSession | None:
        replay = self._replays.get(session_id)
        lock = self._locks.get(session_id)
        if replay is None or lock is None:
            return None
        async with lock:
            fix = replay.next_fix()
            if fix is None:
                if not replay.finished:
                    return self.get(session_id)
                service = self._services.get(session_id)
                if service is None:
                    return None
                service.finish_replay()
                session = self.get(session_id)
                if session is not None:
                    self._publish(session)
                return session
            return await self._apply_fix(session_id, fix)

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

    def _publish(self, session: NavigationSession) -> None:
        for subscriber in self._subscribers.get(session.session_id, set()):
            if subscriber.full():
                subscriber.get_nowait()
            subscriber.put_nowait(session)

    async def subscribe(self, session_id: str) -> AsyncIterator[NavigationSession]:
        session = self.get(session_id)
        if session is None:
            return
        queue: asyncio.Queue[NavigationSession] = asyncio.Queue(maxsize=1)
        self._subscribers.setdefault(session_id, set()).add(queue)
        queue.put_nowait(session)
        try:
            while True:
                yield await queue.get()
        finally:
            self._subscribers[session_id].discard(queue)
