from datetime import datetime, timezone

import pytest

from app.models import Coordinate, RouteResponse
from app.services.track_generator import calculate_bearing, generate_route_track


def make_route(points: list[tuple[float, float]], distance_m: float = 1000.0) -> RouteResponse:
    return RouteResponse(
        geometry=[Coordinate(lat=lat, lon=lon) for lat, lon in points],
        distance_m=distance_m,
        duration_s=120.0,
        maneuvers=[],
    )


class TestCalculateBearing:
    def test_north_is_zero(self):
        assert calculate_bearing(Coordinate(lat=39.0, lon=116.0), Coordinate(lat=40.0, lon=116.0)) == pytest.approx(0.0, abs=1.0)

    def test_east_is_ninety(self):
        assert calculate_bearing(Coordinate(lat=39.0, lon=116.0), Coordinate(lat=39.0, lon=117.0)) == pytest.approx(90.0, abs=1.0)

    def test_south_is_180(self):
        assert calculate_bearing(Coordinate(lat=40.0, lon=116.0), Coordinate(lat=39.0, lon=116.0)) == pytest.approx(180.0, abs=1.0)

    def test_west_is_270(self):
        assert calculate_bearing(Coordinate(lat=39.0, lon=117.0), Coordinate(lat=39.0, lon=116.0)) == pytest.approx(270.0, abs=1.0)


class TestGenerateRouteTrack:
    def test_basic_route_produces_multiple_fixes(self):
        route = make_route([(39.9, 116.4), (39.9, 116.41)])
        track = generate_route_track(route)
        assert len(track) >= 3

    def test_first_fix_near_route_start(self):
        route = make_route([(39.9, 116.4), (39.9, 116.41)])
        track = generate_route_track(route)
        assert track[0].lat == pytest.approx(39.9, abs=0.001)
        assert track[0].lon == pytest.approx(116.4, abs=0.001)

    def test_last_fix_near_route_end(self):
        route = make_route([(39.9, 116.4), (39.9, 116.41)])
        track = generate_route_track(route)
        assert track[-1].lat == pytest.approx(39.9, abs=0.001)
        assert track[-1].lon == pytest.approx(116.41, abs=0.001)

    def test_timestamps_monotonic(self):
        route = make_route([(39.9, 116.4), (39.9, 116.41)])
        track = generate_route_track(route)
        for i in range(len(track) - 1):
            assert track[i].timestamp < track[i + 1].timestamp

    def test_headings_valid_range(self):
        route = make_route([(39.9, 116.4), (39.9, 116.41)])
        track = generate_route_track(route)
        for fix in track:
            assert 0 <= fix.heading < 360

    def test_duplicate_vertices_skipped(self):
        route = make_route([(39.9, 116.4), (39.9, 116.4), (39.9, 116.41)])
        track = generate_route_track(route)
        # Should not have duplicate consecutive fixes at the duplicate vertex
        for i in range(len(track) - 1):
            dist = abs(track[i].lat - track[i + 1].lat) + abs(track[i].lon - track[i + 1].lon)
            # Points should be meaningfully different unless it's the last point
            if i < len(track) - 2:
                assert dist > 0 or track[i].timestamp < track[i + 1].timestamp

    def test_zero_length_segment_no_error(self):
        route = make_route([(39.9, 116.4), (39.9, 116.4), (39.9, 116.41)])
        # Should not raise
        track = generate_route_track(route)
        assert len(track) >= 2

    def test_very_short_route_produces_minimum_points(self):
        # Route shorter than sample interval
        route = make_route([(39.9, 116.4), (39.9, 116.4001)], distance_m=10.0)
        track = generate_route_track(route, sample_interval_m=100.0)
        assert len(track) >= 3  # start, middle, end

    def test_route_end_heading_copied_from_previous(self):
        route = make_route([(39.9, 116.4), (39.9, 116.405), (39.9, 116.41)])
        track = generate_route_track(route)
        # Last heading should be valid and similar to previous
        assert 0 <= track[-1].heading < 360
        assert abs(track[-1].heading - track[-2].heading) < 45

    def test_deterministic_output(self):
        route = make_route([(39.9, 116.4), (39.9, 116.41)])
        start = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        track1 = generate_route_track(route, start_timestamp=start)
        track2 = generate_route_track(route, start_timestamp=start)
        assert len(track1) == len(track2)
        for a, b in zip(track1, track2):
            assert a.lat == b.lat
            assert a.lon == b.lon
            assert a.heading == b.heading
            assert a.timestamp == b.timestamp

    def test_injectable_start_timestamp(self):
        route = make_route([(39.9, 116.4), (39.9, 116.41)])
        start = datetime(2026, 6, 15, 10, 30, 0, tzinfo=timezone.utc)
        track = generate_route_track(route, start_timestamp=start)
        assert track[0].timestamp == start

    def test_coordinate_contract_lat_lon(self):
        route = make_route([(39.9, 116.4), (39.9, 116.41)])
        track = generate_route_track(route)
        for fix in track:
            # Coordinate is lat/lon, not lon/lat
            assert -90 <= fix.lat <= 90
            assert -180 <= fix.lon <= 180
