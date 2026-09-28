# U-turn Route Progress Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix U-turn route progress backwards jump bug by making backend the authoritative source of route progress with continuity-aware matching, and having frontend use this authoritative progress for passed-route rendering.

**Architecture:** Backend `NavigationService` becomes the single truth for `matched_location`, `progress`, `distance_traveled_m`, and `remaining_distance_m`. Frontend `MapController` stops performing independent nearest-vertex searches and instead uses backend-provided `progress` to perform distance-aware polyline slicing for route-passed rendering.

**Tech Stack:** Python, FastAPI, Pydantic, pytest, TypeScript, Vitest.

**Spec:** `docs/superpowers/reports/2026-09-28-uturn-progress-audit.md`

## Global Constraints

- Work only on `fix/simulation-replay-route` (current branch).
- Do NOT merge until this fix is complete and verified.
- Do not modify OSRM client, OSRM routing algorithm, map style, labels, POI, or camera logic.
- Do not modify `TrackGenerator` to bypass U-turn routes; U-turn is a valid route that must be handled correctly.
- Preserve existing regression tracks (`normal-route`, `off-route`) and smoke test logic.
- All changes must follow TDD: failing tests first, then minimal implementation.
- Each task committed independently.
- Final browser acceptance on real U-turn route before unblocking merge.

## Review Focus

- Backend progress must be monotonic for normal navigation sessions.
- U-turn routes must not cause backwards progress jumps.
- Frontend must use backend `progress`, not recompute independently.
- Distance-aware polyline slicing must handle non-uniform vertex spacing.
- Reroute must reset matching state; old monotonic state must not pollute new route.
- Small GPS jitter handled by monotonic safety guard; large jumps handled by correct matching.

---

## Task 1: RouteMatch type and continuity-aware progress primitives

**Files:**
- Create: `backend/app/services/route_matching.py`
- Create: `backend/tests/test_route_matching.py`

**Interfaces:**
```python
@dataclass
class RouteMatch:
    segment_index: int
    projected_location: Coordinate
    distance_to_route_m: float
    distance_along_route_m: float
    progress: float  # 0.0 to 1.0

def match_route_with_continuity(
    location: Coordinate,
    route_geometry: list[Coordinate],
    previous_match: RouteMatch | None,
    heading: float | None = None,
    backward_tolerance_m: float = 10.0,
    forward_search_range_m: float = 100.0,
) -> RouteMatch
```

- [ ] **Step 1: Write failing tests for RouteMatch primitives**

Add tests for:
- `RouteMatch` dataclass fields and types
- `match_route_with_continuity` with no previous match (global search)
- `match_route_with_continuity` with previous match (continuity-aware search)
- Progress increases monotonically on straight route
- U-turn: progress continues forward after turn, does not jump to earlier segment
- **Parallel opposite-direction segments with zero distance:**
  - Two segments with `distance_to_route_m = 0` (point is exactly on both)
  - Different route order (one earlier, one later)
  - Opposite headings
  - Must choose heading-compatible AND continuity-compatible segment
- Duplicate/self-near geometry: continuity prevents matching to earlier temporal position
- Small backward noise: effective progress does not decrease
- Reroute scenario: when route changes, new match starts fresh

Run: `backend/.venv/bin/pytest backend/tests/test_route_matching.py -q`

Expected: FAIL because module does not exist.

- [ ] **Step 2: Implement RouteMatch and continuity-aware matcher**

Implement:
- `RouteMatch` dataclass with required fields
- `match_route_with_continuity`:
  - If `previous_match is None`: perform global nearest-segment search (existing logic)
  - If `previous_match is not None`:
    - Calculate `previous_distance_along_route_m`
    - **Phase 1: Spatial candidate filtering**
      - Search only segments within `[previous_distance - backward_tolerance, previous_distance + forward_search_range]`
      - For each candidate segment, calculate spatial `distance_to_route_m`
      - Filter candidates: keep only those with `distance_to_route_m <= max_candidate_distance_m` (e.g., 20m or 2x best distance)
    - **Phase 2: Continuity/heading disambiguation**
      - For each filtered candidate, calculate:
        - `continuity_score = abs(candidate_distance_along - previous_distance_along)`
        - `heading_score = abs(candidate_bearing - heading)` normalized to [0, 180] if heading provided, else 0
        - `combined_score = continuity_score + heading_weight * heading_score` (heading_weight = 0.1 initially)
      - Select candidate with minimum `combined_score`
    - Calculate new `distance_along_route_m` and `progress`
  - Return `RouteMatch`

Run: `backend/.venv/bin/pytest backend/tests/test_route_matching.py -q`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/route_matching.py backend/tests/test_route_matching.py
git commit -m "feat(navigation): 增加连续性感知路线匹配原语"
```

---

## Task 2: NavigationState API/type contract

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/tests/test_navigation_api.py`
- Modify: `frontend/src/types.ts`

**Interfaces:**
```python
class NavigationState(BaseModel):
    status: Literal["ready", "navigating", "unmatched", "arrived", "replay_finished"]
    raw_location: LocationFix | None = None
    matched_location: Coordinate | None = None
    next_maneuver: Maneuver | None = None
    remaining_distance_m: float | None = None
    off_route: bool = False
    progress: float = 0.0  # NEW: 0.0 to 1.0
    distance_traveled_m: float = 0.0  # NEW: >= 0
```

```typescript
// frontend/src/types.ts
export interface NavigationState {
  status: "ready" | "navigating" | "unmatched" | "arrived" | "replay_finished";
  raw_location: LocationFix | null;
  matched_location: Coordinate | null;
  next_maneuver: Maneuver | null;
  remaining_distance_m: number | null;
  off_route: boolean;
  progress: number;  // NEW
  distance_traveled_m: number;  // NEW
}
```

**Distance Domain Contract:**
- `progress = geometry_distance_along / geometry_total_distance` (based on route geometry)
- `distance_traveled_m = route.distance_m * progress` (using OSRM route distance)
- `remaining_distance_m = route.distance_m * (1 - progress)` (using OSRM route distance)

**Audit Note:** Current `remaining_distance_m` is calculated as `route.distance_m * (1 - progress)`. This is consistent with the new contract. No semantic change required.

- [ ] **Step 1: Write failing API tests**

Add tests for:
- `NavigationState` serialization includes `progress` and `distance_traveled_m`
- API response includes these fields
- `progress` is between 0.0 and 1.0
- `distance_traveled_m` is >= 0
- `distance_traveled_m + remaining_distance_m ≈ route.distance_m` (within 1% tolerance)
- After full route replay: `progress ≈ 1.0`, `distance_traveled_m ≈ route.distance_m`

Run: `backend/.venv/bin/pytest backend/tests/test_navigation_api.py -q`

Expected: FAIL because fields do not exist.

- [ ] **Step 2: Update NavigationState model**

Modify `backend/app/models.py`:
- Add `progress: float = 0.0` with `Field(ge=0.0, le=1.0)`
- Add `distance_traveled_m: float = 0.0` with `Field(ge=0.0)`
- Update `json_schema_extra` example to include these fields

Run: `backend/.venv/bin/pytest backend/tests/test_navigation_api.py -q`

Expected: PASS.

- [ ] **Step 3: Update frontend types**

Modify `frontend/src/types.ts`:
- Add `progress: number` to `NavigationState` interface
- Add `distance_traveled_m: number` to `NavigationState` interface

Run: `cd frontend && npm test -- --run`

Expected: PASS (no breaking changes yet).

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/tests/test_navigation_api.py frontend/src/types.ts
git commit -m "feat(api): NavigationState 暴露 progress 和 distance_traveled_m"
```

---

## Task 3: NavigationService authoritative progress integration

**Files:**
- Modify: `backend/app/services/navigation.py`
- Modify: `backend/tests/test_navigation.py`

**Interfaces:**
- `NavigationService` tracks `_previous_match: RouteMatch | None`
- `NavigationService.apply_fix()` uses `match_route_with_continuity()`
- `NavigationState` populated with `progress`, `distance_traveled_m`, `remaining_distance_m`

- [ ] **Step 1: Write failing tests for authoritative progress**

Add tests for:
- `apply_fix()` with straight route: `progress` increases monotonically
- `apply_fix()` with U-turn route: `progress` continues forward after turn
- `apply_fix()` returns `NavigationState` with `progress` field populated
- `apply_fix()` returns `NavigationState` with `distance_traveled_m` field populated
- `distance_traveled_m + remaining_distance_m ≈ route.distance_m` (within 1% tolerance)
- After reroute (route replaced): `_previous_match` is reset to `None`
- After reroute: new `progress` starts from new route's beginning

Run: `backend/.venv/bin/pytest backend/tests/test_navigation.py -q`

Expected: FAIL because `NavigationService` does not use `match_route_with_continuity()`.

- [ ] **Step 2: Implement authoritative progress in NavigationService**

Modify `NavigationService`:
- Add `_previous_match: RouteMatch | None = None` in `__init__`
- In `apply_fix()`:
  - Replace `polyline_progress_fraction()` call with `match_route_with_continuity()`
  - Pass `previous_match=self._previous_match`, `heading=fix.heading`
  - Store result in `self._previous_match`
  - Calculate:
    - `progress = match.progress`
    - `distance_traveled_m = route.distance_m * progress`
    - `remaining_distance_m = route.distance_m * (1 - progress)`
  - Pass these to `NavigationState` constructor
- In reroute logic (when `self._route = replacement`):
  - Reset `self._previous_match = None`

Run: `backend/.venv/bin/pytest backend/tests/test_navigation.py -q`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/navigation.py backend/tests/test_navigation.py
git commit -m "feat(navigation): NavigationService 使用权威性路线进度"
```

---

## Task 4: Frontend distance-aware passed-route slicing

**Files:**
- Create: `frontend/src/geometry.ts`
- Create: `frontend/src/__tests__/geometry.test.ts`
- Modify: `frontend/src/map-controller.ts`
- Modify: `frontend/src/__tests__/map-controller.test.ts`

**Interfaces:**
```typescript
// frontend/src/geometry.ts
export function slicePolylineByDistance(
  coordinates: [number, number][],  // [lon, lat][]
  targetDistanceM: number
): [number, number][] {
  // Returns polyline from start to targetDistanceM along route
}
```

**Passed-route contract:**
- `targetDistanceM <= 0`: return empty array `[]`
- `0 < targetDistanceM < totalDistance`: return interpolated LineString with at least 2 points
- `targetDistanceM >= totalDistance`: return full route coordinates

- [ ] **Step 1: Write failing tests for distance-aware slicing**

Add tests for:
- `slicePolylineByDistance` with uniform spacing: `progress=0.5` returns half the route by distance
- `slicePolylineByDistance` with non-uniform spacing:
  ```
  A→B = 10m, B→C = 100m, C→D = 10m
  total = 120m, progress = 0.5 → target = 60m
  Result: A→B→interpolated point inside B→C (not A→B→C→point in C→D)
  ```
- `slicePolylineByDistance` with `targetDistanceM <= 0` returns empty array
- `slicePolylineByDistance` with `targetDistanceM >= totalDistance` returns full route
- `slicePolylineByDistance` handles duplicate vertices
- `slicePolylineByDistance` handles zero-length segments
- Result always has >= 2 points when target is in valid range (not single-point LineString)

Add tests for `MapController`:
- `updateNavigation` with `state.progress=0.0` → passed route is empty (not rendered)
- `updateNavigation` with `state.progress=0.40` → passed route length = 40% of total distance
- `updateNavigation` with `state.progress=0.55` → passed route grows
- `updateNavigation` with `state.progress=0.70` → passed route grows more
- `updateNavigation` with `state.progress=0.85` → passed route grows more
- U-turn scenario: progress increases monotonically, passed route only grows
- Same matched coordinates but different progress: passed route uses progress, not spatial position
- Reroute: new route set, passed route uses new route's progress

Run: `cd frontend && npm test -- --run`

Expected: FAIL because `slicePolylineByDistance` does not exist and `MapController` does not use `progress`.

- [ ] **Step 2: Implement distance-aware slicing**

Create `frontend/src/geometry.ts`:
```typescript
export function slicePolylineByDistance(
  coordinates: [number, number][],
  targetDistanceM: number
): [number, number][] {
  if (coordinates.length === 0 || targetDistanceM <= 0) return [];
  
  const result: [number, number][] = [coordinates[0]];
  let accumulatedDistance = 0;
  
  for (let i = 1; i < coordinates.length; i++) {
    const [lon1, lat1] = coordinates[i - 1];
    const [lon2, lat2] = coordinates[i];
    const segmentDistance = calculateDistanceM(lon1, lat1, lon2, lat2);
    
    if (accumulatedDistance + segmentDistance >= targetDistanceM) {
      // Interpolate within this segment
      const remainingDistance = targetDistanceM - accumulatedDistance;
      const fraction = segmentDistance > 0 ? remainingDistance / segmentDistance : 0;
      const interpLon = lon1 + fraction * (lon2 - lon1);
      const interpLat = lat1 + fraction * (lat2 - lat1);
      result.push([interpLon, interpLat]);
      return result;
    }
    
    result.push(coordinates[i]);
    accumulatedDistance += segmentDistance;
  }
  
  // If targetDistanceM >= total distance, return full route
  return coordinates;
}

function calculateDistanceM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const metersPerDegreeLatitude = 111_320;
  const meanLatitudeRadians = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const eastDistanceM = (lon2 - lon1) * metersPerDegreeLatitude * Math.cos(meanLatitudeRadians);
  const northDistanceM = (lat2 - lat1) * metersPerDegreeLatitude;
  return Math.sqrt(eastDistanceM ** 2 + northDistanceM ** 2);
}
```

Modify `frontend/src/map-controller.ts`:
- Import `slicePolylineByDistance`
- In `renderRoute()`: calculate and store `totalRouteDistanceM`
- In `updateNavigation(state)`:
  - Calculate `targetDistanceM = state.progress * totalRouteDistanceM`
  - Call `slicePolylineByDistance(this.routeCoordinates, targetDistanceM)`
  - If result has >= 2 points, render as route-passed LineString
  - If result is empty or has < 2 points, do not render route-passed
  - Remove `updatePassedRoute()` method
- Remove old nearest-vertex search logic

Run: `cd frontend && npm test -- --run`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/geometry.ts frontend/src/__tests__/geometry.test.ts frontend/src/map-controller.ts frontend/src/__tests__/map-controller.test.ts
git commit -m "feat(frontend): 基于权威性 progress 的距离感知路线切片"
```

---

## Task 5: Full regression + real browser U-turn verification + Replay Merge Review

**Files:**
- Modify only for scoped defects discovered by verification.

- [ ] **Step 1: Run all backend tests**

Run: `backend/.venv/bin/pytest backend/tests -v`

Expected: All pass, including:
- Existing tests (no regressions)
- New route matching tests (RouteMatch, continuity-aware)
- New navigation tests (authoritative progress, U-turn, reroute)

- [ ] **Step 2: Run all frontend tests**

Run: `cd frontend && npm test -- --run`

Expected: All pass, including:
- Existing tests (no regressions)
- New geometry tests (distance-aware slicing)
- New map controller tests (progress-based passed route, U-turn)

- [ ] **Step 3: Run frontend build**

Run: `cd frontend && npm run build`

Expected: PASS.

- [ ] **Step 4: Docker Compose validation**

Run: `docker compose config --quiet`

Expected: exit 0.

- [ ] **Step 5: Smoke test**

Run: `bash scripts/smoke_test.sh`

Expected: PASS (uses fixed tracks, unaffected by progress changes).

- [ ] **Step 6: Interactive U-turn verification**

Start demo: `bash scripts/demo.sh`

Browser verification:
1. Plan route with U-turn (e.g., origin and destination on same street, far apart)
2. Select "模拟当前路线"
3. Click "开始模拟回放"
4. Observe:
   - Vehicle starts near origin
   - Vehicle follows outbound segment (route turns blue ahead, gray behind)
   - Vehicle reaches U-turn point
   - Vehicle turns around
   - Vehicle follows return segment
   - **Critical:** Gray passed route does NOT shrink or turn blue again
   - **Critical:** Progress increases monotonically before, during, and after U-turn
   - **Critical:** Passed route endpoint does not jump to parallel outbound segment
   - Vehicle arrives at destination
   - UI shows "已到达目的地"
   - `remaining_distance_m` decreases monotonically

- [ ] **Step 7: Regression verification**

Test with existing tracks:
- Select "回归测试：正常轨迹"
- Replay works as before
- Progress increases monotonically
- Passed route only grows

Test with off-route:
- Select "回归测试：偏航轨迹"
- Replay triggers reroute
- After reroute, progress resets and increases on new route

- [ ] **Step 8: Replay Merge Review**

Update `docs/superpowers/reports/2026-09-28-replay-merge-review.md`:
- Add section on U-turn fix
- Confirm all tests pass
- Confirm browser verification succeeds
- Remove "Replay Merge Blocker" status
- Recommend merge

- [ ] **Step 9: Commit any scoped fix**

If validation exposes a defect:
- Write failing regression test
- Minimal fix
- Rerun all checks
- Commit with `fix(navigation): ...`

- [ ] **Step 10: Report**

Report:
- Branch: `fix/simulation-replay-route`
- Total commits: list all (replay + U-turn fix)
- Tests: counts (backend + frontend)
- Browser: U-turn verification results
- Review: P0/P1/P2 issues
- Known non-blocking issues
- **Replay Merge Blocker: RESOLVED**

---

## Plan Self-Review

- **Spec coverage:** Tasks 1 covers matcher primitives; Task 2 covers API contract; Task 3 covers integration; Task 4 covers frontend slicing; Task 5 covers validation.
- **Type consistency:** `RouteMatch` → `NavigationState.progress` → frontend `slicePolylineByDistance()` → route-passed GeoJSON.
- **Review focus:** every edge case (U-turn, parallel segments, duplicate geometry, reroute, monotonic progress, zero-distance candidates) has explicit tests.
- **Constraints:** backend is authoritative, frontend uses progress not spatial search, distance-aware slicing not vertex approximation, continuity not global nearest, heading disambiguates not dominates.
- **Scope:** no excluded service or feature appears in an implementation task.

---

## Design Decisions

### Why RouteMatch instead of just progress float?

RouteMatch provides:
- `segment_index`: enables continuity-aware search
- `distance_along_route_m`: enables distance-based constraints
- `projected_location`: enables validation
- `progress`: UI-friendly fraction

This structure supports future enhancements (e.g., segment-specific logic) without API changes.

### Why distance-based continuity, not vertex-based?

OSRM route vertices are not uniformly spaced. A vertex-based window (e.g., `previous_segment ± 5`) could:
- Miss valid candidates in sparse regions
- Include too many candidates in dense regions

Distance-based window (e.g., `±100m`) is spatially consistent and predictable.

### Why two-phase matching (spatial filter + continuity/heading disambiguation)?

Single-formula scoring like `score = distance * (1 + heading_penalty)` fails when `distance = 0` for multiple candidates. Two-phase approach:
1. Filter by spatial proximity (keeps all reasonable candidates)
2. Rank by continuity + heading (breaks ties correctly)

This ensures heading works even when spatial distance is identical.

### Why heading as disambiguator, not primary?

Heading can be noisy or unavailable. Spatial distance is more reliable. Heading should only break ties between spatially similar candidates.

### Why monotonic clamp as safety guard, not matcher?

Simple `progress = max(previous, current)` hides bugs. Correct matching should find the right segment. Monotonic clamp only handles residual jitter after correct matching.

### Why not modify TrackGenerator?

U-turn is a valid route. The navigation pipeline must handle it correctly. Modifying the track to avoid U-turns would hide the bug and fail in real-world scenarios.
