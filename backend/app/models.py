from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Coordinate(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"lat": 39.9, "lon": 116.4}]})

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
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "geometry": [{"lat": 39.9, "lon": 116.4}, {"lat": 39.8994, "lon": 116.404}],
                    "distance_m": 420.0,
                    "duration_s": 60.0,
                    "maneuvers": [],
                }
            ]
        }
    )

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
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "status": "ready",
                    "raw_location": None,
                    "matched_location": None,
                    "next_maneuver": None,
                    "remaining_distance_m": 420.0,
                    "off_route": False,
                }
            ]
        }
    )

    status: Literal["ready", "navigating", "unmatched", "arrived", "replay_finished"]
    raw_location: LocationFix | None = None
    matched_location: Coordinate | None = None
    next_maneuver: Maneuver | None = None
    remaining_distance_m: float | None = None
    off_route: bool = False


class NavigationSession(BaseModel):
    session_id: str
    route: RouteResponse
    state: NavigationState


class NavigationSessionRequest(RouteRequest):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "origin": {"lat": 39.9, "lon": 116.4},
                    "destination": {"lat": 39.8994, "lon": 116.404},
                    "track_id": "normal-route",
                }
            ]
        }
    )

    track_id: Literal["normal-route", "off-route", "current-route"] | None = None
