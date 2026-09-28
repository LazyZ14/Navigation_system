# Replay Merge Review

## Branch
`fix/simulation-replay-route`

## Commits
1. `5d1e191` - feat(replay): 增加路线合成轨迹生成器
2. `80d7f4c` - feat(replay): 支持从当前路线生成回放轨迹
3. `da4b3bb` - feat(replay): API 支持 current-route 轨迹标识
4. `12cc761` - feat(replay): 当前路线成为默认回放选项
5. `5729580` - chore(frontend): 从 TypeScript 构建中排除测试文件
6. `3e24383` - feat(route-matching): 添加 RouteMatch 和连续性感知匹配原语
7. `e3980a6` - feat(navigation-state): 暴露 progress 字段到 API
8. `20c0d98` - feat(navigation-service): 集成连续性感知路线匹配
9. `05f2f2e` - feat(frontend): 使用后端 progress 进行路线切片

## Test Results

### Backend Tests
- **Total**: 104 tests
- **Status**: ✅ All passed
- **Coverage**:
  - Track generator: 16 tests (bearing, sampling, edge cases)
  - Route matching: 8 tests (U-turn, heading disambiguation, continuity)
  - Navigation service: 14 tests (including 7 new current-route tests)
  - Navigation API: 10 tests (including 2 new current-route tests)
  - Existing tests: 56 tests (all passing, no regressions)

### Frontend Tests
- **Total**: 22 tests
- **Status**: ✅ All passed
- **Coverage**:
  - Replay UI: 2 tests (default track, options)
  - Map controller: 7 tests (including progress-based route slicing)
  - Existing tests: 13 tests (all passing)

### Build
- **TypeScript**: ✅ Compiled successfully
- **Vite build**: ✅ Completed (1.15s)
- **Output**: dist/index.html + assets

## Implementation Review

### ✅ Track Generator (Task 1)
- **calculate_bearing**: Correct bearing formula, returns [0, 360)
- **generate_route_track**:
  - Validates route has ≥2 points
  - Skips zero-length segments
  - Skips duplicate consecutive vertices
  - Samples at 10m intervals (configurable)
  - Generates monotonic timestamps
  - Handles edge cases: very short routes, end heading
  - Deterministic output with injectable start_timestamp

### ✅ SessionStore Integration (Task 2)
- **current-route handling**: Generates track from session's own route
- **No second OSRM call**: Reuses same RouteResponse object
- **Fixed tracks preserved**: normal-route and off-route still work
- **Error handling**: Unknown track_id raises ValueError

### ✅ API Layer (Task 3)
- **Model update**: NavigationSessionRequest allows "current-route"
- **No API code changes**: Store handles all logic
- **Backward compatible**: Existing track_ids work unchanged

### ✅ Frontend UI (Task 4)
- **Default**: "模拟当前路线" (current-route) selected by default
- **Clear labels**:
  - "模拟当前路线" (interactive default)
  - "回归测试：正常轨迹" (regression)
  - "回归测试：偏航轨迹" (regression)
- **Semantics clear**: UI distinguishes simulation from testing

## Design Compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| current-route generates from RouteResponse | ✅ | No second OSRM call |
| Preserve existing regression tracks | ✅ | normal-route, off-route unchanged |
| Deterministic timestamps | ✅ | Injectable start_timestamp |
| Handle edge cases | ✅ | Duplicate vertices, zero-length, short routes |
| UI semantics clear | ✅ | Labels distinguish simulation from testing |
| No frontend bypass | ✅ | Uses existing NavigationService pipeline |
| Arrival by navigation logic | ✅ | finish_replay() checks distance ≤50m |
| Pause/resume preserved | ✅ | ReplayController unchanged |

### ✅ U-turn Progress Fix (Tasks 6-9)

**Problem:**
- Backend used global nearest-point search (no continuity awareness)
- Frontend duplicated progress computation independently
- U-turn routes caused progress backwards jumps

**Solution:**
- **RouteMatch primitives** (commit 6): Two-phase matching with heading + spatial filtering
  - Heading-based disambiguation for parallel segments
  - Continuity-aware search around previous match
  - U-turn support via heading filtering (>90° rejection)

- **Progress exposure** (commit 7): Backend as single source of truth
  - Added `progress` field to NavigationState (0.0 to 1.0)
  - Frontend type contract updated

- **Service integration** (commit 8): Continuity-aware matching in NavigationService
  - Replaced `polyline_progress_fraction()` with `match_route_with_continuity()`
  - Maintains `_previous_match` state across fixes
  - Resets on route change (replan)

- **Frontend slicing** (commit 9): Use authoritative backend progress
  - Replaced independent nearest-vertex search
  - Uses `progress * routeCoordinates.length` for slicing
  - Eliminates backwards jumps

**Test Coverage:**
- 8 new route matching tests (U-turn, heading disambiguation, continuity)
- All existing tests continue to pass (no regressions)

## Edge Cases Verified

| Case | Test | Status |
|------|------|--------|
| Duplicate vertices | test_duplicate_vertices_skipped | ✅ |
| Zero-length segment | test_zero_length_segment_no_error | ✅ |
| Very short route (<10m) | test_very_short_route_produces_minimum_points | ✅ |
| End heading | test_route_end_heading_copied_from_previous | ✅ |
| Different routes → different tracks | test_different_routes_produce_different_tracks | ✅ |
| U-turn progress continues forward | test_uturn_progress_continues_forward | ✅ |
| Parallel segments heading disambiguation | test_parallel_segments_zero_distance_heading_disambiguation | ✅ |
| Route crossing continuity | test_duplicate_geometry_continuity_prevents_earlier_match | ✅ |
| Small GPS noise stability | test_small_backward_noise_progress_stable | ✅ |
| Reroute resets progress | test_reroute_new_match_starts_fresh | ✅ |

## Smoke Test Impact

**No changes to smoke test logic.**

The smoke test (`scripts/smoke_test.sh`) continues to use:
- `track_id="normal-route"` for arrival test
- `track_id="off-route"` for replan test

These are fixed regression tracks, unaffected by the new current-route feature.

## Known Non-Blocking Issues

**None.**

## Validation Checklist

- [x] Backend tests pass (104/104)
- [x] Frontend tests pass (22/22)
- [x] Frontend build succeeds
- [x] Docker compose config valid
- [x] U-turn regression tests pass
- [x] Progress monotonicity verified
- [ ] Smoke test (requires host Docker)
- [ ] Interactive verification (requires host Docker)

## Recommendation

**Approve for merge.**

All automated tests pass. Implementation follows design spec. Edge cases handled. No regressions. Smoke test and interactive verification should be performed on host before merge.

---

## Host Verification Required

Run on host machine with Docker:

```bash
# Smoke test
bash scripts/smoke_test.sh

# Interactive verification
bash scripts/demo.sh

# Browser test
# 1. Open http://127.0.0.1:5173/
# 2. Plan route A → B
# 3. Select "模拟当前路线" (should be default)
# 4. Click "开始模拟回放"
# 5. Verify:
#    - Vehicle starts near A
#    - Vehicle follows route geometry
#    - Vehicle arrives at B
#    - UI shows "已到达目的地"
```
