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
