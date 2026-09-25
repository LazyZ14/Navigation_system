import asyncio
from collections.abc import AsyncIterator
from typing import Protocol
from uuid import uuid4

from app.models import Coordinate, LocationFix, NavigationSession, NavigationState, RouteResponse
from app.services.osrm import MatchedRoad


class NearestRoadClient(Protocol):
    async def nearest(self, location: Coordinate) -> MatchedRoad | None: ...


class NavigationService:
    def __init__(self, client: NearestRoadClient, route: RouteResponse | None = None):
        self._client = client
        self._route = route
        self._state = NavigationState(
            status="ready",
            next_maneuver=route.maneuvers[0] if route and route.maneuvers else None,
            remaining_distance_m=route.distance_m if route else None,
        )

    @property
    def state(self) -> NavigationState:
        return self._state

    async def apply_fix(self, fix: LocationFix) -> NavigationState:
        matched = await self._client.nearest(fix)
        if matched is None or matched.distance_m > 50:
            self._state = NavigationState(status="unmatched", raw_location=fix)
            return self._state
        self._state = NavigationState(
            status="navigating",
            raw_location=fix,
            matched_location=matched.location,
            next_maneuver=self._route.maneuvers[0] if self._route and self._route.maneuvers else None,
            remaining_distance_m=self._route.distance_m if self._route else None,
        )
        return self._state


class NavigationRouteClient(NearestRoadClient, Protocol):
    async def route(self, origin: Coordinate, destination: Coordinate) -> RouteResponse: ...


class NavigationSessionStore:
    def __init__(self, client: NavigationRouteClient):
        self._client = client
        self._services: dict[str, NavigationService] = {}
        self._routes: dict[str, RouteResponse] = {}
        self._subscribers: dict[str, set[asyncio.Queue[NavigationState]]] = {}

    async def create(self, origin: Coordinate, destination: Coordinate) -> NavigationSession:
        route = await self._client.route(origin, destination)
        session_id = str(uuid4())
        service = NavigationService(self._client, route)
        self._services[session_id] = service
        self._routes[session_id] = route
        return NavigationSession(session_id=session_id, route=route, state=service.state)

    def get(self, session_id: str) -> NavigationSession | None:
        service = self._services.get(session_id)
        route = self._routes.get(session_id)
        if service is None or route is None:
            return None
        return NavigationSession(session_id=session_id, route=route, state=service.state)

    async def apply_fix(self, session_id: str, fix: LocationFix) -> NavigationSession | None:
        service = self._services.get(session_id)
        route = self._routes.get(session_id)
        if service is None or route is None:
            return None
        state = await service.apply_fix(fix)
        for subscriber in self._subscribers.get(session_id, set()):
            subscriber.put_nowait(state)
        return NavigationSession(session_id=session_id, route=route, state=state)

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
