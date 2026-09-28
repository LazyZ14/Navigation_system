"""Route matching with continuity awareness for U-turn handling."""
import math
from dataclasses import dataclass
from typing import Optional

from app.models import Coordinate
from app.services.geometry import distance_between_m


def _calculate_segment_heading(start: Coordinate, end: Coordinate) -> float:
    """Calculate the heading from start to end in degrees (0-360, 0=north, clockwise)."""
    lat_scale = 111_320.0
    lon_scale = 111_320.0 * 0.9

    dx = (end.lon - start.lon) * lon_scale
    dy = (end.lat - start.lat) * lat_scale

    # atan2(dx, dy) returns angle from north, clockwise, in [-180, 180]
    angle_rad = math.atan2(dx, dy)
    angle_deg = math.degrees(angle_rad)

    # Normalize to [0, 360)
    if angle_deg < 0:
        angle_deg += 360

    return angle_deg


def project_point_to_segment(
    point: Coordinate,
    segment_start: Coordinate,
    segment_end: Coordinate,
) -> tuple[Coordinate, float, float]:
    """Project a point onto a line segment.

    Returns:
        tuple of (projected_point, distance_to_segment, offset_along_segment)
    """
    # Convert to approximate local coordinates (meters)
    lat_scale = 111_320.0
    lon_scale = 111_320.0 * 0.9  # Rough adjustment

    # Segment vector
    dx = (segment_end.lon - segment_start.lon) * lon_scale
    dy = (segment_end.lat - segment_start.lat) * lat_scale

    # Point vector from segment start
    px = (point.lon - segment_start.lon) * lon_scale
    py = (point.lat - segment_start.lat) * lat_scale

    # Segment length squared
    segment_length_sq = dx * dx + dy * dy

    if segment_length_sq == 0:
        # Zero-length segment
        return segment_start, distance_between_m(point, segment_start), 0.0

    # Project point onto segment line
    t = (px * dx + py * dy) / segment_length_sq
    t = max(0.0, min(1.0, t))  # Clamp to segment

    # Projected point
    projected_lon = segment_start.lon + t * (segment_end.lon - segment_start.lon)
    projected_lat = segment_start.lat + t * (segment_end.lat - segment_start.lat)
    projected = Coordinate(lat=projected_lat, lon=projected_lon)

    # Distance from point to projected point
    distance = distance_between_m(point, projected)

    # Offset along segment
    segment_length = distance_between_m(segment_start, segment_end)
    offset = t * segment_length

    return projected, distance, offset


@dataclass
class RouteMatch:
    """Represents a match of a location to a route segment."""

    segment_index: int
    projected_location: Coordinate
    distance_to_route_m: float
    distance_along_route_m: float
    progress: float


def match_route_with_continuity(
    location: Coordinate,
    route: list[Coordinate],
    previous_match: Optional[RouteMatch],
    heading: Optional[float] = None,
    backward_tolerance_m: float = 10.0,
    forward_search_range_m: float = 1000.0,
) -> RouteMatch:
    """Match a location to a route segment with continuity awareness.

    Uses two-phase approach:
    1. Spatial candidate filtering: find segments within distance range
    2. Continuity/heading disambiguation: rank candidates by continuity and heading

    Args:
        location: The location to match
        route: The route geometry as a list of coordinates
        previous_match: Previous match result for continuity, or None for global search
        heading: Optional heading in degrees (0-360, 0=north, clockwise)
        backward_tolerance_m: How far back from previous position to search
        forward_search_range_m: How far forward from previous position to search

    Returns:
        RouteMatch with the best matching segment
    """
    if not route or len(route) < 2:
        raise ValueError("Route must have at least 2 points")

    # Phase 1: Find all candidate segments with spatial filtering
    candidates = []
    cumulative_distance = 0.0

    for i in range(len(route) - 1):
        start = route[i]
        end = route[i + 1]
        segment_length = distance_between_m(start, end)

        # If heading is provided, filter out segments with opposite direction
        if heading is not None:
            segment_heading = _calculate_segment_heading(start, end)
            heading_diff = abs(segment_heading - heading)
            if heading_diff > 180:
                heading_diff = 360 - heading_diff
            # If heading difference > 90°, this segment is going in the wrong direction
            if heading_diff > 90:
                cumulative_distance += segment_length
                continue

        # Project point to segment
        projected, distance, offset = project_point_to_segment(location, start, end)

        # Calculate distance along route to this projection
        distance_along = cumulative_distance + offset

        # If we have a previous match, apply spatial filtering
        if previous_match is not None:
            prev_distance = previous_match.distance_along_route_m
            min_distance = max(0.0, prev_distance - backward_tolerance_m)
            max_distance = prev_distance + forward_search_range_m

            # Skip segments outside the search range
            if distance_along + segment_length < min_distance or distance_along > max_distance:
                cumulative_distance += segment_length
                continue

        candidates.append({
            'segment_index': i,
            'projected': projected,
            'distance': distance,
            'distance_along': distance_along,
            'segment_length': segment_length,
            'segment_start': start,
            'segment_end': end,
        })

        cumulative_distance += segment_length

    # If no candidates found (shouldn't happen with proper tolerances), fall back to global search
    if not candidates:
        return _global_nearest_match(location, route)

    # Phase 2: Rank candidates by continuity and heading
    total_route_distance = cumulative_distance

    def score_candidate(candidate):
        # Continuity score: prefer candidates close to previous position
        if previous_match is not None:
            continuity_score = abs(candidate['distance_along'] - previous_match.distance_along_route_m)
        else:
            continuity_score = 0.0

        # Heading score: prefer candidates with similar heading
        heading_score = 0.0
        if heading is not None:
            # Calculate segment heading
            segment_heading = _calculate_segment_heading(
                candidate['segment_start'],
                candidate['segment_end']
            )
            # Calculate heading difference (0-180 degrees)
            heading_diff = abs(segment_heading - heading)
            if heading_diff > 180:
                heading_diff = 360 - heading_diff
            heading_score = heading_diff

        # Combined score: distance is primary, continuity and heading are secondary
        # Lower is better
        return (
            candidate['distance'] * 1000 +  # Primary: minimize distance to route
            continuity_score * 0.1 +  # Secondary: prefer continuity
            heading_score * 0.5  # Tertiary: prefer matching heading
        )

    # Find best candidate
    best = min(candidates, key=score_candidate)

    # Calculate progress
    progress = best['distance_along'] / total_route_distance if total_route_distance > 0 else 0.0

    return RouteMatch(
        segment_index=best['segment_index'],
        projected_location=best['projected'],
        distance_to_route_m=best['distance'],
        distance_along_route_m=best['distance_along'],
        progress=progress,
    )


def _global_nearest_match(location: Coordinate, route: list[Coordinate]) -> RouteMatch:
    """Find the globally nearest segment without continuity constraints."""
    best_distance = float('inf')
    best_segment = 0
    best_projected = route[0]
    best_distance_along = 0.0

    cumulative_distance = 0.0

    for i in range(len(route) - 1):
        start = route[i]
        end = route[i + 1]
        segment_length = distance_between_m(start, end)

        projected, distance, offset = project_point_to_segment(location, start, end)

        if distance < best_distance:
            best_distance = distance
            best_segment = i
            best_projected = projected
            best_distance_along = cumulative_distance + offset

        cumulative_distance += segment_length

    total_distance = cumulative_distance
    progress = best_distance_along / total_distance if total_distance > 0 else 0.0

    return RouteMatch(
        segment_index=best_segment,
        projected_location=best_projected,
        distance_to_route_m=best_distance,
        distance_along_route_m=best_distance_along,
        progress=progress,
    )


def _calculate_segment_heading(start: Coordinate, end: Coordinate) -> float:
    """Calculate the heading from start to end in degrees (0-360, 0=north, clockwise)."""
    from math import atan2, degrees

    # Calculate delta in meters (approximate)
    delta_lat = end.lat - start.lat
    delta_lon = end.lon - start.lon

    # Adjust for latitude
    lat_rad = (start.lat + end.lat) / 2 * 3.14159 / 180
    delta_lon_adjusted = delta_lon * 0.9  # Rough adjustment for latitude

    # Calculate bearing
    bearing_rad = atan2(delta_lon_adjusted, delta_lat)
    bearing_deg = degrees(bearing_rad)

    # Normalize to 0-360
    if bearing_deg < 0:
        bearing_deg += 360

    return bearing_deg
