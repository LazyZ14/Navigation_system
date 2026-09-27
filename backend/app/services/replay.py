import json
from pathlib import Path

from app.models import LocationFix


def load_track(path: Path) -> list[LocationFix]:
    payload = json.loads(path.read_text())
    if payload.get("version") != 1 or not isinstance(payload.get("points"), list):
        raise ValueError("track must contain version 1 and a points list")
    return [LocationFix.model_validate(point) for point in payload["points"]]


class ReplayController:
    def __init__(self, points: list[LocationFix]):
        if any(left.timestamp > right.timestamp for left, right in zip(points, points[1:])):
            raise ValueError("track timestamps must be monotonic")
        self._points = points
        self._index = 0
        self._running = False

    def start(self) -> None:
        self._index = 0
        self._running = True

    def pause(self) -> None:
        self._running = False

    def resume(self) -> None:
        if self._index < len(self._points):
            self._running = True

    @property
    def finished(self) -> bool:
        return self._index >= len(self._points)

    def next_fix(self) -> LocationFix | None:
        if not self._running or self._index >= len(self._points):
            return None
        fix = self._points[self._index]
        self._index += 1
        return fix
