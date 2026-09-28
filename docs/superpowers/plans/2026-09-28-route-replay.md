# Route Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable interactive replay of the current planned route, generating synthetic LocationFix sequences from OSRM route geometry while preserving existing regression track functionality.

**Architecture:** Add `track_generator.py` to convert `RouteResponse` into `LocationFix[]`. Extend `NavigationSessionStore` to handle `track_id="current-route"` by generating track from the session's own route. Update UI to make `current-route` the default with clear semantics distinguishing interactive simulation from regression testing.

**Tech Stack:** Python, FastAPI, pytest, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-route-replay-design.md`

## Global Constraints

- Work only on `fix/simulation-replay-route`, created from `main` after map-labels-poi merge.
- Do not modify OSRM client, road matching, progress calculation, or arrival detection logic.
- Preserve existing `normal-route.json` and `off-route.json` as regression fixtures.
- Smoke test must continue using fixed tracks for deterministic validation.
- All replay output must be standard `LocationFix` objects consumed by existing `NavigationService`.
- Frontend must not bypass `NavigationService` by animating vehicle directly.
- Arrival must be determined by existing navigation logic, not replay layer.
- Pause/resume/replay behavior must be preserved.
- No GPS, real vehicle, speed physics, traffic, or scope expansion.
- TDD: failing tests first, then minimal implementation.
- Each task committed independently.
- Do not self-merge; complete with Replay Merge Review.

## Review Focus

- Track generator must handle duplicate vertices, zero-length segments, very short routes, and end heading without exceptions or non-monotonic timestamps.
- `current-route` must reuse the exact `RouteResponse` from session creation (no second OSRM call).
- Timestamp strategy must be deterministic and injectable for testing.
- UI must clearly distinguish "模拟当前路线" (interactive default) from regression test options.
- Existing smoke tests must continue to pass unchanged.

---

### Task 1: Track generator primitives with TDD

**Files:**
- Create: `backend/app/services/track_generator.py`
- Create: `backend/tests/test_track_generator.py`

**Interfaces:**
- `generate_route_track(route: RouteResponse, sample_interval_m: float = 10.0, speed_mps: float = 8.0, start_timestamp: datetime | None = None) -> list[LocationFix]`
- `calculate_bearing(from: Coordinate, to: Coordinate) -> float`

- [ ] **Step 1: Write failing primitive tests**

Add tests for:
- `calculate_bearing`: north=0°, east=90°, south=180°, west=270°
- Basic route track: 2-point route produces ≥3 fixes
- Timestamp monotonic: all timestamps strictly increasing
- Heading valid: all headings in [0, 360)
- First fix near route start, last fix near route end
- Coordinate contract: [lat, lon] correct
- Duplicate consecutive vertices: skipped, no duplicate fixes
- Zero-length segment: skipped, no divide-by-zero
- Very short route (< sample_interval): still produces start/middle/end
- Route end heading: last fix uses previous segment heading
- Deterministic: same inputs produce same outputs
- Injectable timestamp: explicit start_timestamp honored

- [ ] **Step 2: Verify tests are red**

Run: `backend/.venv/bin/pytest backend/tests/test_track_generator.py -q`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement track generator**

Implement:
- `calculate_bearing` using standard bearing formula
- `generate_route_track`:
  - Validate route has ≥2 geometry points
  - Flatten geometry into segments
  - Skip zero-length segments
  - Skip duplicate consecutive vertices
  - Sample points at `sample_interval_m` along each segment
  - Calculate heading from segment direction
  - For last point, copy heading from previous segment
  - Generate monotonic timestamps: `t[n+1] = t[n] + distance/speed`
  - Use `start_timestamp` if provided, else `datetime.now(timezone.utc)`
  - Ensure at least 3 points (start, middle, end) for very short routes

- [ ] **Step 4: Verify tests are green**

Run: `backend/.venv/bin/pytest backend/tests/test_track_generator.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/track_generator.py backend/tests/test_track_generator.py
git commit -m "feat(replay): 增加路线合成轨迹生成器"
```

---

### Task 2: NavigationSessionStore integration with current-route track

**Files:**
- Modify: `backend/app/services/navigation.py`
- Modify: `backend/tests/test_navigation.py`

**Interfaces:**
- `NavigationSessionStore.create()` accepts `track_id="current-route"` and generates track from the session's own route.

- [ ] **Step 1: Write failing integration tests**

Add tests for:
- `create()` with `track_id="current-route"` generates track from route
- Generated track first point near route start
- Generated track last point near route end
- Replay through generated track reaches arrival
- Different routes produce different tracks
- Existing `normal-route` and `off-route` still work
- Invalid `track_id` raises ValueError

- [ ] **Step 2: Verify tests are red**

Run: `backend/.venv/bin/pytest backend/tests/test_navigation.py -q`

Expected: FAIL because `current-route` not handled.

- [ ] **Step 3: Implement current-route handling**

In `NavigationSessionStore.create()`:
- After `route = await self._client.route(origin, destination)`
- If `track_id == "current-route"`:
  - `points = generate_route_track(route)`
  - Do NOT call OSRM again
  - Use the same `route` object
- Else if `track_id` in `self._tracks`:
  - `points = self._tracks[track_id]` (existing behavior)
- Else:
  - `points = None` (no replay)

- [ ] **Step 4: Verify tests are green**

Run: `backend/.venv/bin/pytest backend/tests/test_navigation.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/navigation.py backend/tests/test_navigation.py
git commit -m "feat(replay): 支持从当前路线生成回放轨迹"
```

---

### Task 3: API layer updates

**Files:**
- Modify: `backend/app/api/navigation.py`
- Modify: `backend/tests/test_navigation_api.py`

**Interfaces:**
- `POST /api/navigation/sessions` accepts `track_id="current-route"`.

- [ ] **Step 1: Write failing API tests**

Add tests for:
- `POST /sessions` with `track_id="current-route"` returns 201
- Replay progresses through generated track
- Final state is "arrived" when track reaches destination
- Existing track_ids still work

- [ ] **Step 2: Verify tests are red**

Run: `backend/.venv/bin/pytest backend/tests/test_navigation_api.py -q`

Expected: FAIL because `current-route` not recognized.

- [ ] **Step 3: Update API validation**

In `NavigationSessionStore.create()`, the validation already allows any `track_id`. The issue is that `current-route` is not in `self._tracks`. Update the logic:
- If `track_id == "current-route"`: generate from route
- Else if `track_id` in `self._tracks`: use fixed track
- Else if `track_id is not None`: raise ValueError

No API changes needed; the store handles it.

- [ ] **Step 4: Verify tests are green**

Run: `backend/.venv/bin/pytest backend/tests/test_navigation_api.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/navigation.py backend/tests/test_navigation_api.py
git commit -m "feat(replay): API 支持 current-route 轨迹标识"
```

---

### Task 4: Frontend UI updates

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/main.ts`
- Modify: `frontend/src/__tests__/replay.test.ts` (new)

**Interfaces:**
- Track selector options:
  - `current-route`: "模拟当前路线" (default)
  - `normal-route`: "回归测试：正常轨迹"
  - `off-route`: "回归测试：偏航轨迹"

- [ ] **Step 1: Write failing frontend tests**

Add tests for:
- Default track selection is "current-route"
- Replay session uses selected track_id
- Changing route and replaying uses new route

- [ ] **Step 2: Verify tests are red**

Run: `cd frontend && npm test -- --run`

Expected: FAIL because default is "normal-route".

- [ ] **Step 3: Update HTML and JS**

In `index.html`:
```html
<select id="track-select">
  <option value="current-route" selected>模拟当前路线</option>
  <option value="normal-route">回归测试：正常轨迹</option>
  <option value="off-route">回归测试：偏航轨迹</option>
</select>
```

In `main.ts`:
- No changes needed; already uses `trackSelect.value`

- [ ] **Step 4: Verify tests are green**

Run: `cd frontend && npm test -- --run`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/src/main.ts frontend/src/__tests__/replay.test.ts
git commit -m "feat(replay): 当前路线成为默认回放选项"
```

---

### Task 5: Full validation and Replay Merge Review

**Files:**
- Modify only for scoped defects discovered by verification.

- [ ] **Step 1: Run all backend tests**

Run: `backend/.venv/bin/pytest backend/tests -q`

Expected: All pass, including existing smoke test logic.

- [ ] **Step 2: Run all frontend tests**

Run: `cd frontend && npm test -- --run`

Expected: All pass.

- [ ] **Step 3: Run frontend build**

Run: `cd frontend && npm run build`

Expected: PASS.

- [ ] **Step 4: Docker Compose validation**

Run: `docker compose config --quiet`

Expected: exit 0.

- [ ] **Step 5: Smoke test**

Run: `bash scripts/smoke_test.sh`

Expected: PASS (uses fixed `normal-route` and `off-route`).

- [ ] **Step 6: Interactive verification**

Start demo: `bash scripts/demo.sh`

Browser verification:
- Plan route A → B
- Select "模拟当前路线"
- Click "开始模拟回放"
- Vehicle starts near A
- Vehicle follows route
- Vehicle arrives at B
- UI shows "已到达目的地"

- [ ] **Step 7: Regression verification**

- Select "回归测试：正常轨迹"
- Replay works as before
- Smoke test logic unchanged

- [ ] **Step 8: Replay Merge Review**

Review:
- Track generator handles edge cases
- `current-route` reuses same RouteResponse
- Timestamp strategy is deterministic
- UI semantics clear
- Existing regression tracks preserved
- Smoke test deterministic
- No OSRM double-call
- No frontend bypass of NavigationService
- Arrival determined by navigation logic
- Pause/resume/replay preserved

- [ ] **Step 9: Commit any scoped fix**

If validation exposes a defect:
- Write failing regression test
- Minimal fix
- Rerun all checks
- Commit with `fix(replay): ...`

- [ ] **Step 10: Report**

Report:
- Branch: `fix/simulation-replay-route`
- Commits: list
- Tests: counts
- Browser: verification results
- Review: P0/P1/P2 issues
- Known non-blocking issues

---

## Plan Self-Review

- Spec coverage: Tasks 1-2 cover track generation and integration; Task 3 covers API; Task 4 covers UI; Task 5 covers validation.
- Type consistency: `generate_route_track` returns `list[LocationFix]`, consumed by `ReplayController`, which feeds `NavigationService`.
- Review focus: every edge case (duplicate vertices, zero-length segments, short routes, end heading) has explicit tests in Task 1.
- Constraints: `current-route` uses same RouteResponse, no second OSRM call, deterministic timestamps, UI semantics clear.
- Scope: no excluded service or feature appears in an implementation task.
