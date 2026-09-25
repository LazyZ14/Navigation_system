from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class Coordinate(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate


class Maneuver(BaseModel):
    instruction: str
    distance_m: float
    location: Coordinate


class RouteResponse(BaseModel):
    geometry: list[Coordinate]
    distance_m: float
    duration_s: float
    maneuvers: list[Maneuver]


class LocationFix(Coordinate):
    heading: float = Field(ge=0, lt=360)
    speed_mps: float = Field(ge=0)
    accuracy_m: float = Field(gt=0)
    timestamp: datetime


class NavigationState(BaseModel):
    status: Literal["ready", "navigating", "unmatched", "arrived"]
    raw_location: LocationFix | None = None
    matched_location: Coordinate | None = None
    next_maneuver: Maneuver | None = None
    remaining_distance_m: float | None = None
    off_route: bool = False


class NavigationSession(BaseModel):
    session_id: str
    route: RouteResponse
    state: NavigationState
