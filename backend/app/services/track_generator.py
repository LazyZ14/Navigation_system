from datetime import datetime, timezone
from math import atan2, cos, degrees, radians, sin

from app.models import Coordinate, LocationFix, RouteResponse
from app.services.geometry import distance_between_m


def calculate_bearing(from_coord: Coordinate, to_coord: Coordinate) -> float:
    """Calculate bearing in degrees (0°=North, 90°=East). Returns [0, 360)."""
    lat1 = radians(from_coord.lat)
    lat2 = radians(to_coord.lat)
    dlon = radians(to_coord.lon - from_coord.lon)

    x = sin(dlon) * cos(lat2)
    y = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dlon)

    bearing = degrees(atan2(x, y))
    return (bearing + 360) % 360


def generate_route_track(
    route: RouteResponse,
    sample_interval_m: float = 10.0,
    speed_mps: float = 8.0,
    start_timestamp: datetime | None = None,
) -> list[LocationFix]:
    """Generate synthetic LocationFix sequence from route geometry."""
    if len(route.geometry) < 2:
        raise ValueError("Route must have at least 2 geometry points")

    geometry = route.geometry
    fixes: list[LocationFix] = []
    current_timestamp = start_timestamp or datetime.now(timezone.utc)

    # Add first point
    first = geometry[0]
    second = geometry[1]
    first_heading = calculate_bearing(first, second) if distance_between_m(first, second) > 0.001 else 0.0
    fixes.append(
        LocationFix(
            lat=first.lat,
            lon=first.lon,
            heading=first_heading,
            speed_mps=speed_mps,
            accuracy_m=5.0,
            timestamp=current_timestamp,
        )
    )

    # Generate points along route
    for i in range(len(geometry) - 1):
        start = geometry[i]
        end = geometry[i + 1]
        segment_length = distance_between_m(start, end)

        # Skip zero-length segments
        if segment_length < 0.001:
            continue

        heading = calculate_bearing(start, end)
        num_samples = int(segment_length / sample_interval_m)

        # Sample points along segment (skip first, already added or will be skipped)
        for j in range(1, num_samples + 1):
            fraction = (j * sample_interval_m) / segment_length
            if fraction >= 1.0:
                break

            lat = start.lat + fraction * (end.lat - start.lat)
            lon = start.lon + fraction * (end.lon - start.lon)
            distance = distance_between_m(fixes[-1], Coordinate(lat=lat, lon=lon))
            current_timestamp = current_timestamp + __import__("datetime").timedelta(
                seconds=distance / speed_mps
            )

            fixes.append(
                LocationFix(
                    lat=lat,
                    lon=lon,
                    heading=heading,
                    speed_mps=speed_mps,
                    accuracy_m=5.0,
                    timestamp=current_timestamp,
                )
            )

    # Ensure last point is near route end
    last_point = geometry[-1]
    last_heading = fixes[-1].heading if fixes else 0.0

    # Add end point if not already close
    if not fixes or distance_between_m(fixes[-1], last_point) > 1.0:
        distance = distance_between_m(fixes[-1], last_point) if fixes else 0.0
        current_timestamp = current_timestamp + __import__("datetime").timedelta(
            seconds=distance / speed_mps
        )
        fixes.append(
            LocationFix(
                lat=last_point.lat,
                lon=last_point.lon,
                heading=last_heading,
                speed_mps=speed_mps,
                accuracy_m=5.0,
                timestamp=current_timestamp,
            )
        )

    # Ensure at least 3 points for very short routes
    if len(fixes) < 3 and len(geometry) >= 2:
        mid_point = geometry[len(geometry) // 2]
        if distance_between_m(fixes[0], mid_point) > 0.1:
            distance = distance_between_m(fixes[0], mid_point)
            ts = fixes[0].timestamp + __import__("datetime").timedelta(seconds=distance / speed_mps)
            fixes.insert(
                1,
                LocationFix(
                    lat=mid_point.lat,
                    lon=mid_point.lon,
                    heading=fixes[0].heading,
                    speed_mps=speed_mps,
                    accuracy_m=5.0,
                    timestamp=ts,
                ),
            )

    return fixes
