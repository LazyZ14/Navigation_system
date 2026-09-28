"""Tests for route matching with continuity awareness."""
from datetime import datetime, timezone

import pytest

from app.models import Coordinate, LocationFix
from app.services.route_matching import RouteMatch, match_route_with_continuity


def test_route_match_dataclass_fields():
    """RouteMatch should have required fields."""
    match = RouteMatch(
        segment_index=0,
        projected_location=Coordinate(lat=39.9, lon=116.4),
        distance_to_route_m=5.0,
        distance_along_route_m=100.0,
        progress=0.5,
    )
    assert match.segment_index == 0
    assert match.projected_location.lat == 39.9
    assert match.distance_to_route_m == 5.0
    assert match.distance_along_route_m == 100.0
    assert match.progress == 0.5


def test_match_route_without_previous_match_global_search():
    """Without previous match, should perform global nearest search."""
    location = Coordinate(lat=39.9, lon=116.4)
    route = [
        Coordinate(lat=39.9, lon=116.4),
        Coordinate(lat=39.9, lon=116.41),
    ]

    match = match_route_with_continuity(location, route, None)

    assert match.segment_index == 0
    assert match.progress >= 0.0
    assert match.progress <= 1.0


def test_straight_route_progress_monotonic():
    """Progress should increase monotonically on straight route."""
    route = [
        Coordinate(lat=39.9, lon=116.4),
        Coordinate(lat=39.9, lon=116.41),
    ]

    # Simulate moving along the route
    positions = [
        Coordinate(lat=39.9, lon=116.4),
        Coordinate(lat=39.9, lon=116.405),
        Coordinate(lat=39.9, lon=116.41),
    ]

    previous_match = None
    progresses = []

    for pos in positions:
        match = match_route_with_continuity(pos, route, previous_match)
        progresses.append(match.progress)
        previous_match = match

    # Progress should be monotonically increasing
    for i in range(len(progresses) - 1):
        assert progresses[i + 1] >= progresses[i]


def test_uturn_progress_continues_forward():
    """U-turn: progress should continue forward, not jump to earlier segment."""
    # Route: A -> B -> C (eastbound) -> D -> E (westbound, parallel to A->B)
    route = [
        Coordinate(lat=39.9, lon=116.400),  # A: start
        Coordinate(lat=39.9, lon=116.405),  # B: eastbound
        Coordinate(lat=39.9, lon=116.410),  # C: U-turn point
        Coordinate(lat=39.9, lon=116.405),  # D: westbound (same as B)
        Coordinate(lat=39.9, lon=116.400),  # E: destination (same as A)
    ]

    # Simulate U-turn scenario
    # Before U-turn: at C (eastbound)
    pos_before = Coordinate(lat=39.9, lon=116.410)
    match_before = match_route_with_continuity(pos_before, route, None)

    print(f"\nBefore U-turn:")
    print(f"  Position: {pos_before}")
    print(f"  Match: segment={match_before.segment_index}, distance_along={match_before.distance_along_route_m:.2f}m, progress={match_before.progress:.3f}")

    # After U-turn: at D (westbound, spatially close to B)
    pos_after = Coordinate(lat=39.9, lon=116.405)
    match_after = match_route_with_continuity(pos_after, route, match_before, heading=270.0)  # heading west

    print(f"\nAfter U-turn:")
    print(f"  Position: {pos_after}")
    print(f"  Match: segment={match_after.segment_index}, distance_along={match_after.distance_along_route_m:.2f}m, progress={match_after.progress:.3f}")
    print(f"  Expected: segment >= {match_before.segment_index}, distance_along >= {match_before.distance_along_route_m:.2f}m")

    # Progress should continue forward (segment D is index 2-3, not back to B at index 0-1)
    assert match_after.segment_index >= match_before.segment_index or match_after.distance_along_route_m >= match_before.distance_along_route_m


def test_parallel_segments_zero_distance_heading_disambiguation():
    """Two segments with distance=0, opposite headings: must choose heading-compatible segment."""
    # Two parallel segments at same location, opposite directions
    route = [
        Coordinate(lat=39.9, lon=116.4),  # A
        Coordinate(lat=39.9, lon=116.41),  # B (eastbound A->B)
        Coordinate(lat=39.9, lon=116.41),  # C (same as B)
        Coordinate(lat=39.9, lon=116.4),  # D (westbound C->D, parallel to A->B)
    ]

    # Point exactly on both segments (distance=0)
    location = Coordinate(lat=39.9, lon=116.405)

    # Previous match on first segment (A->B)
    previous = RouteMatch(
        segment_index=0,
        projected_location=Coordinate(lat=39.9, lon=116.405),
        distance_to_route_m=0.0,
        distance_along_route_m=500.0,
        progress=0.25,
    )

    # Heading west (270°), should match second segment (C->D) not first (A->B)
    match = match_route_with_continuity(location, route, previous, heading=270.0)

    # Should choose segment index 2 (C->D, westbound) not index 0 (A->B, eastbound)
    assert match.segment_index == 2


def test_duplicate_geometry_continuity_prevents_earlier_match():
    """Route that crosses itself: continuity should prevent jumping to earlier temporal position."""
    # Route forms a figure-8 or crosses itself
    route = [
        Coordinate(lat=39.9, lon=116.4),
        Coordinate(lat=39.91, lon=116.41),
        Coordinate(lat=39.9, lon=116.42),
        Coordinate(lat=39.91, lon=116.41),  # Crosses earlier point
        Coordinate(lat=39.92, lon=116.4),
    ]

    # Previous match on segment 3 (after the crossing, heading towards final destination)
    previous = RouteMatch(
        segment_index=3,
        projected_location=Coordinate(lat=39.915, lon=116.405),
        distance_to_route_m=0.0,
        distance_along_route_m=3500.0,  # On segment 3, near the end
        progress=0.875,
    )

    # Current location near the crossing point (spatially close to segment 0-1 and 2-3)
    location = Coordinate(lat=39.905, lon=116.415)

    match = match_route_with_continuity(location, route, previous)

    # Should stay on segment 3 (or later), not jump back to segment 0-1
    assert match.segment_index >= 2


def test_small_backward_noise_progress_stable():
    """Small GPS noise should not cause progress to decrease."""
    route = [
        Coordinate(lat=39.9, lon=116.4),
        Coordinate(lat=39.9, lon=116.41),
    ]

    # At progress 0.5
    previous = RouteMatch(
        segment_index=0,
        projected_location=Coordinate(lat=39.9, lon=116.405),
        distance_to_route_m=0.0,
        distance_along_route_m=500.0,
        progress=0.5,
    )

    # Small backward noise (5 meters back)
    location = Coordinate(lat=39.9, lon=116.40495)

    match = match_route_with_continuity(location, route, previous)

    # Progress should not decrease significantly (allow small tolerance)
    assert match.progress >= previous.progress - 0.01


def test_reroute_new_match_starts_fresh():
    """After reroute, new match should start fresh without previous constraint."""
    # New route after reroute
    new_route = [
        Coordinate(lat=40.0, lon=116.5),  # Different area
        Coordinate(lat=40.0, lon=116.51),
    ]

    location = Coordinate(lat=40.0, lon=116.5)

    # No previous match (reroute resets state)
    match = match_route_with_continuity(location, new_route, None)

    assert match.segment_index == 0
    assert match.progress >= 0.0
