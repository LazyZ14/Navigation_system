# Route Replay Design

## 1. Current Replay Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  User clicks "规划路线"                                                  │
│       ↓                                                                  │
│  POST /api/routes {origin, destination}                                  │
│       ↓                                                                  │
│  RouteResponse {geometry, distance_m, duration_s, maneuvers}             │
│       ↓                                                                  │
│  Map renders route                                                       │
│                                                                          │
│  User clicks "开始模拟回放"                                              │
│       ↓                                                                  │
│  POST /api/navigation/sessions {origin, destination, track_id}           │
│       ↓                                                                  │
│  NavigationSession {session_id, route, state}                            │
│       ↓                                                                  │
│  Loop: POST /api/navigation/{id}/replay/next                            │
│       ↓                                                                  │
│  MapController updates vehicle position                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                     │
├─────────────────────────────────────────────────────────────────────────┤
│  NavigationSessionStore.create()                                         │
│       ↓                                                                  │
│  1. route = OSRM.route(origin, destination)     ← USES USER INPUT       │
│  2. track = self._tracks[track_id]              ← FIXED TRACK!          │
│  3. service = NavigationService(route)                                   │
│  4. replay = ReplayController(track)                                     │
│       ↓                                                                  │
│  replay.next_fix() → service.apply_fix(fix)                              │
│       ↓                                                                  │
│  Road matching, progress, remaining distance, arrival check              │
└─────────────────────────────────────────────────────────────────────────┘
```

## 2. Root Cause

**Track source is decoupled from planned route.**

```python
# backend/app/api/navigation.py:23-26
tracks={
    "normal-route": load_track(track_dir / "normal-route.json"),  # FIXED
    "off-route": load_track(track_dir / "off-route.json"),         # FIXED
}
```

**Fixed track content:**

```json
// data/tracks/normal-route.json
{
  "points": [
    {"lat": 39.9000, "lon": 116.4000, ...},  // Fixed start
    {"lat": 39.8997, "lon": 116.4020, ...},
    {"lat": 39.8994, "lon": 116.4040, ...}   // Fixed end
  ]
}
```

**User selects different origin/destination:**
- Route is calculated correctly: A → B
- But replay plays fixed track: (39.9000, 116.4000) → (39.8994, 116.4040)
- Final position doesn't match user's destination

**Arrival check fails:**

```python
# backend/app/services/navigation.py:86-94
def finish_replay(self) -> NavigationState:
    arrived = (
        self._state.matched_location is not None
        and self._destination is not None
        and distance_between_m(self._state.matched_location, self._destination) <= 50
    )
    # If track end != user destination → "replay_finished" instead of "arrived"
```

## 3. Why Fixed-Origin Behavior Occurs

| Component | Source | Dynamic? |
|-----------|--------|----------|
| Route geometry | OSRM API | ✅ User input |
| Replay track | `data/tracks/*.json` | ❌ Fixed files |
| Track selector | HTML `<select>` | ❌ Hardcoded options |

The track selector offers:
- `normal-route`: Fixed 3-point track for regression testing
- `off-route`: Fixed 4-point track for reroute testing

These are **regression fixtures**, not user-route simulations.

## 4. Classification: Case A - UI/Architecture Gap

**This is NOT a bug in navigation logic.**

The navigation system works correctly:
- Route planning ✅
- Road matching ✅
- Progress calculation ✅
- Arrival detection ✅

**The gap is semantic:**

| User Expectation | Actual Behavior |
|------------------|-----------------|
| "开始模拟回放" = simulate current route | "开始模拟回放" = play fixed test track |

The UI presents replay as route simulation, but the architecture implements it as regression track playback.

## 5. Proposed Architecture

### 5.1 Design Principle

```
Current Route Geometry
        ↓
Synthetic Track Generator
        ↓
LocationFix[]
        ↓
Existing Navigation Pipeline (unchanged)
```

The replay should generate `LocationFix` sequences from the **current route**, not load fixed files.

### 5.2 New Components

```python
# backend/app/services/track_generator.py

def generate_route_track(
    route: RouteResponse,
    sample_interval_m: float = 10.0,
    speed_mps: float = 8.0,
) -> list[LocationFix]:
    """
    Generate synthetic LocationFix sequence from route geometry.
    
    Input: Route geometry from OSRM
    Output: LocationFix[] with:
        - Points sampled along route at ~sample_interval_m
        - Heading calculated from segment direction
        - Monotonic timestamps
        - First point near route start
        - Last point near route end
    """
```

### 5.3 Track Generation Algorithm

```
1. Flatten route geometry into segment list
2. For each segment:
   a. Calculate segment length
   b. Generate points at sample_interval_m along segment
   c. Calculate heading from segment bearing
   d. Assign monotonic timestamps (Δt = distance / speed)
3. Ensure first point ≈ route.geometry[0]
4. Ensure last point ≈ route.geometry[-1]
5. Return LocationFix[]
```

### 5.4 API Changes

**Option A: Generate track on session creation**

```python
# POST /api/navigation/sessions
{
  "origin": {...},
  "destination": {...},
  "track_id": "current-route"  # NEW: special track_id
}
```

When `track_id == "current-route"`:
- Generate track from the planned route
- Use generated track for replay

**Option B: Default to route-based replay**

```python
# POST /api/navigation/sessions
{
  "origin": {...},
  "destination": {...}
  # No track_id → generate from route
}
```

**Recommendation: Option A** - preserves explicit track selection for testing.

### 5.5 UI Changes

**Track selector options:**

```html
<select id="track-select">
  <option value="current-route">当前路线</option>
  <option value="normal-route">正常路线 (测试)</option>
  <option value="off-route">偏航重规划 (测试)</option>
</select>
```

Or rename for clarity:

```html
<select id="track-select">
  <option value="current-route">模拟当前路线</option>
  <option value="normal-route">回归测试: 正常</option>
  <option value="off-route">回归测试: 偏航</option>
</select>
```

## 6. Existing Regression Track Preservation

**Do NOT delete fixed tracks.** They serve critical testing purposes:

| Track | Purpose |
|-------|---------|
| `normal-route.json` | Smoke test: normal arrival |
| `off-route.json` | Smoke test: reroute detection |

**Smoke test dependency:**

```bash
# scripts/smoke_test.sh
normal_arrived=0
for _ in $(seq 1 10); do
  state=$(curl ... "$api_base/api/navigation/$session_id/replay/next")
  # Uses track_id="normal-route" for predictable testing
done
```

**Proposed structure:**

```
track_id values:
├── "current-route"  → Generate from OSRM route (interactive use)
├── "normal-route"   → Fixed regression track (automated testing)
└── "off-route"      → Fixed regression track (automated testing)
```

## 7. Synthetic Route Generation

### 7.1 Sampling

```python
sample_interval_m = 10.0  # Point every 10 meters
```

Rationale:
- Fine enough for smooth visual movement
- Coarse enough for reasonable track size
- At 8 m/s, generates points every ~1.25 seconds

### 7.2 Heading Calculation

```python
def calculate_bearing(from: Coordinate, to: Coordinate) -> float:
    """
    Calculate bearing in degrees (0° = North, 90° = East).
    Returns value in [0, 360).
    """
    # Standard bearing formula
```

### 7.3 Speed

```python
speed_mps = 8.0  # ~29 km/h, matches existing default
```

First version: constant speed. No acceleration physics.

### 7.4 Timestamps

```python
# Monotonic timestamps
Δt = distance / speed
timestamp[n+1] = timestamp[n] + Δt
```

### 7.5 Accuracy

```python
accuracy_m = 5.0  # Matches existing track format
```

## 8. Session Lifecycle

### 8.1 Current Lifecycle Issues

```
plan A → replay → stop → plan B → replay
                                    ↓
                    May still use previous state?
```

**Current implementation is safe:**

```python
# NavigationSessionStore.create() creates NEW:
- session_id (uuid4)
- NavigationService
- ReplayController
```

Each `create()` call is independent. No stale state leakage.

### 8.2 Verified Behaviors

| Action | Behavior | Status |
|--------|----------|--------|
| Plan new route | Creates new session | ✅ |
| Replay after completion | Creates new session if `replayCompleted` | ✅ |
| Pause/Resume | Controls ReplayController._running | ✅ |
| Reset | `resetNavigation()` clears map state | ✅ |

## 9. Tests

### 9.1 Backend Tests

**Track generation:**

```python
def test_generate_route_track_produces_valid_fixes():
    route = RouteResponse(
        geometry=[Coordinate(39.9, 116.4), Coordinate(39.9, 116.41)],
        distance_m=1000,
        duration_s=120,
        maneuvers=[],
    )
    track = generate_route_track(route)
    
    assert len(track) > 2
    assert track[0].lat == pytest.approx(39.9, abs=0.001)
    assert track[-1].lat == pytest.approx(39.9, abs=0.001)
    assert all(track[i].timestamp < track[i+1].timestamp for i in range(len(track)-1))
    assert all(0 <= fix.heading < 360 for fix in track)
```

**Different routes produce different tracks:**

```python
def test_different_routes_produce_different_tracks():
    route_a = RouteResponse(geometry=[...A...], ...)
    route_b = RouteResponse(geometry=[...B...], ...)
    
    track_a = generate_route_track(route_a)
    track_b = generate_route_track(route_b)
    
    assert track_a[0].lat != track_b[0].lat or track_a[0].lon != track_b[0].lon
```

**Arrival via navigation logic:**

```python
def test_route_replay_triggers_arrival():
    # Full integration test
    # 1. Create session with track_id="current-route"
    # 2. Replay all fixes
    # 3. Verify final state.status == "arrived"
```

### 9.2 Frontend Tests

```typescript
it("replays current route when track_id is current-route", async () => {
  // Plan route A
  // Start replay with track_id="current-route"
  // Verify replay uses route A geometry
});
```

### 9.3 Regression Tests

```python
# Existing tests must continue to pass
def test_smoke_normal_arrival():
    # Uses track_id="normal-route"
    # Fixed track, predictable outcome

def test_smoke_off_route_replan():
    # Uses track_id="off-route"
    # Fixed track, triggers reroute
```

## 10. Files to Modify

### Backend

| File | Change |
|------|--------|
| `backend/app/services/track_generator.py` | **NEW**: Route → LocationFix[] |
| `backend/app/services/navigation.py` | Accept generated tracks |
| `backend/app/api/navigation.py` | Handle `track_id="current-route"` |
| `backend/tests/test_track_generator.py` | **NEW**: Track generation tests |
| `backend/tests/test_navigation.py` | Integration tests |

### Frontend

| File | Change |
|------|--------|
| `frontend/index.html` | Add "当前路线" option |
| `frontend/src/main.ts` | Default to "current-route" |
| `frontend/src/__tests__/replay.test.ts` | **NEW**: Replay tests |

### Documentation

| File | Change |
|------|--------|
| `docs/data-build.md` | No change (tracks are runtime, not build) |
| `ARCHITECTURE.md` | Update replay description |

## 11. Risks

### 11.1 Performance

**Risk**: Long routes generate many track points.

**Mitigation**: 
- 10m sampling on 10km route = ~1000 points
- Replay at 1 fix/sec = ~17 minutes
- Acceptable for demo purposes

### 11.2 Edge Cases

**Risk**: Very short routes (< 10m).

**Mitigation**: Generate at least 3 points (start, middle, end).

### 11.3 Heading at Route End

**Risk**: Last point has no "next" for heading calculation.

**Mitigation**: Copy heading from previous segment.

### 11.4 Backward Compatibility

**Risk**: Existing sessions with fixed track_id break.

**Mitigation**: None needed - only affects new sessions.

## 12. Implementation Order

1. **track_generator.py** + tests
2. **NavigationSessionStore** changes + tests
3. **API** changes + tests
4. **Frontend** UI changes + tests
5. **Integration** verification

## 13. Success Criteria

- [ ] User plans route A → B
- [ ] User clicks "开始模拟回放"
- [ ] Vehicle starts near A
- [ ] Vehicle follows route geometry
- [ ] Vehicle arrives at B
- [ ] UI shows "已到达目的地"
- [ ] Existing smoke tests still pass
- [ ] No external dependencies added

## 14. Out of Scope

- GPS hardware integration
- Real vehicle data
- Speed physics / acceleration
- Traffic simulation
- Multiple vehicle types
- Route replay recording/export
