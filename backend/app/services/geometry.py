from math import cos, hypot, radians

from app.models import Coordinate


def distance_between_m(left: Coordinate, right: Coordinate) -> float:
    scale_y = 111_320.0
    scale_x = scale_y * cos(radians((left.lat + right.lat) / 2))
    return hypot((left.lon - right.lon) * scale_x, (left.lat - right.lat) * scale_y)


def polyline_progress_fraction(point: Coordinate, line: list[Coordinate]) -> float:
    """Return the fraction of the polyline reached by the closest projected point."""
    if len(line) < 2:
        return 0.0
    scale_y = 111_320.0
    scale_x = scale_y * cos(radians(point.lat))
    px, py = point.lon * scale_x, point.lat * scale_y
    segments: list[tuple[float, float, float, float, float]] = []
    total = 0.0
    for start, end in zip(line, line[1:]):
        ax, ay = start.lon * scale_x, start.lat * scale_y
        bx, by = end.lon * scale_x, end.lat * scale_y
        length = hypot(bx - ax, by - ay)
        segments.append((ax, ay, bx, by, length))
        total += length
    if total == 0:
        return 0.0

    best_distance = float("inf")
    best_progress = 0.0
    traversed = 0.0
    for ax, ay, bx, by, length in segments:
        dx, dy = bx - ax, by - ay
        ratio = 0.0 if length == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (length * length)))
        distance = hypot(px - ax - ratio * dx, py - ay - ratio * dy)
        if distance < best_distance:
            best_distance = distance
            best_progress = traversed + ratio * length
        traversed += length
    return best_progress / total


def distance_to_polyline_m(point: Coordinate, line: list[Coordinate]) -> float:
    if len(line) < 2:
        return float("inf")
    scale_y = 111_320.0
    scale_x = scale_y * cos(radians(point.lat))
    px, py = point.lon * scale_x, point.lat * scale_y
    best = float("inf")
    for start, end in zip(line, line[1:]):
        ax, ay = start.lon * scale_x, start.lat * scale_y
        bx, by = end.lon * scale_x, end.lat * scale_y
        dx, dy = bx - ax, by - ay
        ratio = 0.0 if not (dx or dy) else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        best = min(best, hypot(px - ax - ratio * dx, py - ay - ratio * dy))
    return best
