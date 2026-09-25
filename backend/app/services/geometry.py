from math import cos, hypot, radians

from app.models import Coordinate


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
