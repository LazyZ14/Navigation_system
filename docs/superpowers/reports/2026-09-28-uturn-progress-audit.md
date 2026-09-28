# U-turn Route Progress Audit Report

## 1. Current Progress Architecture

```
Backend (NavigationService):
  - Receives LocationFix from ReplayController
  - Calls OSRM nearest() for road matching
  - Calls polyline_progress_fraction() for progress calculation
  - Stores progress in NavigationState.remaining_distance_m
  - Does NOT expose progress fraction or segment index to frontend

Frontend (MapController):
  - Receives NavigationState from backend
  - Uses matched_location for vehicle position
  - Performs INDEPENDENT nearest-vertex search for route-passed slicing
  - Does NOT use backend progress information
```

**Data Flow:**
```
Synthetic LocationFix
    ↓
NavigationService.apply_fix()
    ↓
OSRM nearest() → matched location
    ↓
polyline_progress_fraction() → progress (internal only)
    ↓
NavigationState {matched_location, remaining_distance_m}
    ↓
Frontend receives state
    ↓
MapController.updatePassedRoute(matched_location)
    ↓
INDEPENDENT nearest-vertex search (GLOBAL, not continuity-aware)
    ↓
route-passed geometry
```

## 2. Authoritative Progress Source

**Backend is authoritative for:**
- Matched location (road-snapped position)
- Remaining distance
- Navigation status

**Backend does NOT expose:**
- Progress fraction (0.0 to 1.0)
- Matched segment index
- Cumulative distance traveled

**Frontend duplicates progress computation:**
- Performs its own global nearest-vertex search
- Ignores backend progress information
- No continuity awareness

## 3. Backend Matching Logic

**File:** `backend/app/services/navigation.py:60`

```python
progress = polyline_progress_fraction(matched.location, self._route.geometry) if self._route else 0.0
```

**Implementation:** `backend/app/services/geometry.py:12-41`

**Algorithm:**
1. Iterate through ALL route segments
2. For each segment, project point onto segment
3. Calculate distance to projected point
4. Track the segment with minimum distance
5. Return progress fraction at that nearest point

**Problem:**
- **Global nearest-point search** across entire route
- No tracking of previous progress or segment index
- No heading/direction awareness
- For U-turn routes, can snap to spatially nearby but temporally distant segment

**Example U-turn scenario:**
```
Route: A → B (eastbound) → C (U-turn) → D (westbound, parallel to A→B)

Vehicle at position X on return segment D:
  - Distance to A→B segment: 5m
  - Distance to D segment: 3m
  
Global search finds D segment (correct)

But with noise or slight geometry differences:
  - Distance to A→B segment: 4m
  - Distance to D segment: 4.5m
  
Global search snaps to A→B segment (WRONG - backwards jump)
```

## 4. Frontend Passed-route Logic

**File:** `frontend/src/map-controller.ts:115-151`

```typescript
private updatePassedRoute(lon: number, lat: number): void {
  // GLOBAL NEAREST-VERTEX SEARCH
  this.routeCoordinates.forEach(([routeLon, routeLat], index) => {
    const distanceSquaredM = ...;
    if (distanceSquaredM < nearestDistanceSquaredM) {
      nearestDistanceSquaredM = distanceSquaredM;
      nearestIndex = index;
    }
  });
  
  // Slice route from start to nearest vertex
  const coordinates = this.routeCoordinates.slice(0, nearestIndex + 1);
}
```

**Problem:**
- **Global nearest-vertex search** (not segment-level, just vertices)
- No continuity awareness
- No use of backend progress information
- For U-turn routes, nearest vertex can jump backwards

**Example:**
```
Route vertices: [A, B, C, D, E, F]
  A→B→C: eastbound outbound
  D: U-turn point
  E→F: westbound return (parallel to A→B)

Vehicle at position X near E (return segment):
  - Distance to B: 6m
  - Distance to E: 4m
  
Nearest vertex = E (correct)

But with slight geometry differences:
  - Distance to B: 4.5m
  - Distance to E: 5m
  
Nearest vertex = B (WRONG - backwards jump from index 4 to index 1)

Passed route shrinks from A→B→C→D→E to A→B
Gray line disappears, blue line reappears
```

## 5. U-turn Reproduction

**Route geometry:**
```json
{
  "geometry": [
    {"lat": 39.9000, "lon": 116.4000},  // A: start
    {"lat": 39.9000, "lon": 116.4050},  // B: eastbound
    {"lat": 39.9000, "lon": 116.4100},  // C: U-turn point
    {"lat": 39.9000, "lon": 116.4050},  // D: westbound (same as B)
    {"lat": 39.9000, "lon": 116.4000}   // E: destination (same as A)
  ]
}
```

**Synthetic track (after U-turn):**
```python
Fix 0: (39.9000, 116.4080)  # eastbound, before U-turn
  - Backend progress: 0.8 (80% along A→B→C)
  - Frontend nearest vertex: index 3 (lon=116.4050)
  - Passed route: A→B→C→D (vertices 0-3)

Fix 1: (39.9000, 116.4020)  # westbound, after U-turn
  - Backend progress: 0.6 (60% along A→B→C→D→E, on D→E segment)
  - Frontend nearest vertex: index 1 (lon=116.4050, same as B!)
  - Passed route: A→B (vertices 0-1)
  - **BACKWARDS JUMP: passed route shrinks from 4 vertices to 2**
```

**Frame-by-frame analysis:**
```
Fix index | matched_location | backend_progress | frontend_nearest_index | passed_route_length
----------------------------------------------------------------------------------
0         | (39.9, 116.408)  | 0.80             | 3                      | 4 vertices
1         | (39.9, 116.402)  | 0.60             | 1                      | 2 vertices ← JUMP!
2         | (39.9, 116.401)  | 0.40             | 0                      | 1 vertex  ← MORE JUMP!
```

## 6. Root Cause

**Classification: BOTH backend and frontend bugs**

### Backend bug:
- `polyline_progress_fraction()` performs global nearest-point search
- No continuity awareness (previous progress, segment index)
- No heading disambiguation
- Can produce non-monotonic progress for U-turn routes

### Frontend bug:
- `updatePassedRoute()` performs independent global nearest-vertex search
- Duplicates backend progress computation
- Does not use authoritative backend progress information
- No continuity awareness
- Causes visual backwards jumps in passed route

**Primary issue:** Frontend should use backend-provided progress, not recompute it independently.

## 7. Minimal Correct Fix

### Strategy A (Recommended): Use authoritative backend progress

**Backend changes:**
1. Add `progress` field to `NavigationState` model (fraction 0.0 to 1.0)
2. Add `distance_traveled_m` field to `NavigationState` model
3. Expose these fields in API response

**Frontend changes:**
1. Use `state.progress` to slice route geometry
2. Calculate passed route as: `routeCoordinates.slice(0, progress * routeCoordinates.length)`
3. Remove independent nearest-vertex search

**Benefits:**
- Single source of truth (backend)
- No duplicate computation
- Easier to fix backend once, frontend automatically correct

**But still need to fix backend progress computation:**

### Backend progress fix:

**Option 1: Continuity-aware matching**
```python
def __init__(self, ...):
    self._previous_progress = 0.0
    self._previous_segment_index = 0

async def apply_fix(self, fix):
    # Search only segments near previous match
    progress = continuity_aware_progress(
        matched.location, 
        self._route.geometry,
        self._previous_progress,
        self._previous_segment_index
    )
    self._previous_progress = progress
```

**Option 2: Heading disambiguation**
```python
def polyline_progress_fraction_with_heading(point, line, heading):
    # For each candidate segment, calculate:
    # - distance to segment
    # - heading difference (segment bearing vs fix heading)
    # Score = distance * (1 + heading_penalty)
    # Lower score wins
```

**Option 3: Monotonic progress guard**
```python
progress = polyline_progress_fraction(...)
progress = max(self._previous_progress, progress)  # Safety clamp
```

**Recommended: Option 1 + Option 2 combined**
- Search locally around previous match (continuity)
- Use heading to disambiguate parallel segments
- Monotonic guard as final safety net

## 8. Regression Tests

### Test 1: Monotonic progress on normal route
```python
def test_progress_monotonically_increases_on_straight_route():
    route = make_route([(39.9, 116.4), (39.9, 116.41)])
    fixes = generate_route_track(route)
    previous_progress = 0.0
    for fix in fixes:
        state = await service.apply_fix(fix)
        progress = calculate_progress(state)
        assert progress >= previous_progress
        previous_progress = progress
```

### Test 2: U-turn progress continuity
```python
def test_uturn_progress_continues_increasing_after_turn():
    route = make_route([
        (39.9, 116.400),  # start
        (39.9, 116.405),  # eastbound
        (39.9, 116.410),  # U-turn
        (39.9, 116.405),  # westbound
        (39.9, 116.400),  # destination
    ])
    fixes = generate_route_track(route)
    previous_progress = 0.0
    for fix in fixes:
        state = await service.apply_fix(fix)
        progress = calculate_progress(state)
        assert progress >= previous_progress, f"Progress jumped backwards at {fix}"
        previous_progress = progress
```

### Test 3: Passed route monotonic growth
```python
def test_passed_route_only_grows_never_shrinks():
    # Frontend test
    const controller = new MapController(map);
    controller.renderRoute(uturnRoute);
    
    let previousPassedLength = 0;
    for (const state of navigationStates) {
        controller.updateNavigation(state);
        const passedLength = getPassedRouteLength();
        assert(passedLength >= previousPassedLength);
        previousPassedLength = passedLength;
    }
```

### Test 4: Heading disambiguation
```python
def test_heading_disambiguates_parallel_segments():
    # Two segments: same location, opposite directions
    # Fix heading matches one segment
    # Should match that segment, not the closer one
```

### Test 5: Reroute resets progress
```python
def test_reroute_allows_progress_reset():
    # After reroute, progress can start from 0
    # Monotonic constraint should not apply across route changes
```

## 9. Files to Modify

### Backend:
- `backend/app/models.py`: Add `progress` and `distance_traveled_m` to `NavigationState`
- `backend/app/services/navigation.py`: Track previous progress, expose in state
- `backend/app/services/geometry.py`: Add continuity-aware progress calculation
- `backend/tests/test_navigation.py`: Add U-turn regression tests
- `backend/tests/test_geometry.py`: Add U-turn progress tests

### Frontend:
- `frontend/src/map-controller.ts`: Use backend progress instead of independent search
- `frontend/src/types.ts`: Add `progress` and `distance_traveled_m` to `NavigationState` type
- `frontend/src/__tests__/map-controller.test.ts`: Add U-turn passed route tests

## 10. Replay Merge Blocker Decision

**YES, this is a Replay Merge Blocker.**

**Rationale:**
1. **Correctness issue:** Route progress must be monotonic for navigation to make sense
2. **User-facing bug:** Gray line turning blue is visually confusing and indicates wrong progress
3. **Affects current-route replay:** Any real-world route with U-turns will trigger this bug
4. **Not a visual glitch:** Root cause is in progress computation, not rendering

**Recommendation:**
- Fix backend progress computation first (continuity-aware + heading disambiguation)
- Expose progress to frontend
- Frontend uses backend progress for passed route slicing
- Add comprehensive U-turn regression tests
- Verify with interactive testing on real U-turn routes

**Do NOT merge until:**
- All U-turn regression tests pass
- Interactive testing confirms monotonic progress
- Passed route only grows, never shrinks
