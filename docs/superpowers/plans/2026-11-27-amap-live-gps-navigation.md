# AMap Live GPS Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the `feature/iphone-gps-sender` wired GPS receiver into an integration branch `feature/amap-live-gps` and connect live `WGS-84` positioning to the Gaode (`GCJ-02`) page with clean Live vs. Demo mode isolation, route snapping, turn-by-turn progress updates, and throttled off-route recalculation.

**Architecture:** FastAPI's `GpsIngressService` remains a pure `WGS-84` positioning bus, extended with `GET /api/gps/latest` and non-blocking `WS /ws/gps/live` pub/sub fanout. On the frontend, pure TypeScript modules convert `WGS-84` to `GCJ-02` at the AMap boundary, smooth stationary jitter when unrouted, project fixes onto AMap's `GCJ-02` polyline with continuity and heading disambiguation when routed, and drive dual-mode (`live` vs `demo`) UI and throttled `AMap.Driving` recalculation.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, Pytest, TypeScript, Vite, Vitest, Gaode Map JS API v2.0, Swift 5 / Xcode (`GpsSender`).

**Spec:** `docs/superpowers/specs/2026-11-27-amap-live-gps-navigation-design.md`

## Global Constraints

- Internal standard coordinate system is strictly `WGS-84` with explicit `lat`, `lon` fields; `GCJ-02` `[lon, lat]` tuples exist only inside the AMap frontend boundary adapter.
- Do not render raw jittery GPS fixes directly on the map: apply `accuracy_m > 100` rejection, `< 3m` stationary deadzone + EMA when unrouted, and route polyline snapping when `distanceToRouteM <= 50m`.
- Live heartbeat timeout is `10_000 ms` (`10s`); fixes older than `10s` mark the live stream offline (`active = false`) and must not trigger automatic routing.
- Off-route recalculation triggers only when `accuracy_m <= 50m`, not arrived (`remainingDistanceM > 25m`), and `3` consecutive valid fixes satisfy `distanceToRouteM > 50m`, with a `10_000 ms` (`10s`) cooldown and single-flight guard.
- Never use real user location tracks in tests; all automated tests must use synthetic coordinates and verify normal route, unreachable route, off-road/noisy fix, and off-route recalculation.

## Review Focus

- Duplicate, out-of-order (`409`), stale (`422`), or unauthorized (`401`) `POST /api/gps/fixes` requests must never broadcast a frame on `/ws/gps/live`.
- A slow or stalled WebSocket subscriber at 5Hz must drop its own oldest queued frames (`maxsize=10`) without blocking `POST /api/gps/fixes` or other subscribers.
- Heading disambiguation across the `359° ↔ 1°` north boundary and zero-length duplicate consecutive vertices in AMap step paths must never mis-score or produce `NaN`.
- Switching from `live` mode to `demo` mode while an off-route `Driving.search` request is still in flight must discard the late callback instead of overwriting Demo state.
- Clicking the map in `live` mode must set only the destination (never overwriting the live vehicle origin), whereas `demo` mode preserves 1st-click origin / 2nd-click destination and simulated `moveAlong` cruise.

---

### Task 1: Commit iOS Build Fixes & Merge `feature/iphone-gps-sender` into `feature/amap-live-gps`

**Files:**
- Modify (in `feature/iphone-gps-sender`): `ios/GpsSender/GpsSender.xcodeproj/project.pbxproj`, `ios/GpsSender/GpsSender/Models/GpsRecordingSession.swift`, `ios/GpsSender/GpsSender/Services/LocationRecorder.swift`, `ios/GpsSender/GpsSender/Views/ContentView.swift`, `ios/GpsSender/GpsSenderTests/GpsSenderTests.swift`, `ios/GpsSender/GpsSenderTests/LocationRecorderTests.swift`
- Delete from git index: `ios/GpsSender/GpsSender.xcodeproj/project.xcworkspace/xcuserdata/lazyz14.xcuserdatad/UserInterfaceState.xcuserstate`
- Modify (merge resolution on `feature/amap-live-gps`): `backend/app/main.py`, `backend/app/config.py`, `docker-compose.yml`, `.gitignore`, `README.md`
- Create (commit spec & plan): `docs/superpowers/specs/2026-11-27-amap-live-gps-navigation-design.md`, `docs/superpowers/plans/2026-11-27-amap-live-gps-navigation.md`

**Interfaces:**
- Produces: Merged `feature/amap-live-gps` branch containing `backend/app/gps/{models,service}.py`, `backend/app/api/gps.py`, `backend/app/api/voice.py`, and compiling `ios/GpsSender`.

- [ ] **Step 1: Untrack `UserInterfaceState.xcuserstate` and commit iOS Xcode build fixes on `feature/iphone-gps-sender`**

Run inside `.worktrees/iphone-gps-sender`:
```bash
git -C .worktrees/iphone-gps-sender rm --cached ios/GpsSender/GpsSender.xcodeproj/project.xcworkspace/xcuserdata/lazyz14.xcuserdatad/UserInterfaceState.xcuserstate
git -C .worktrees/iphone-gps-sender add ios/GpsSender
git -C .worktrees/iphone-gps-sender commit -m "fix(ios): wire LocationRecorder into Xcode target and fix Swift build errors"
```

- [ ] **Step 2: Create `feature/amap-live-gps` from `main`, commit spec & plan, and merge `feature/iphone-gps-sender`**

```bash
git checkout -b feature/amap-live-gps
git add docs/superpowers/specs/2026-11-27-amap-live-gps-navigation-design.md docs/superpowers/plans/2026-11-27-amap-live-gps-navigation.md
git commit -m "docs(gps): add AMap live GPS navigation spec and implementation plan"
git merge --no-commit feature/iphone-gps-sender
```

Resolve any conflicts in `backend/app/main.py` (mount `router`, `voice_router`, `gps_router`, `navigation_router`, `websocket_router`), `backend/app/config.py` (preserve `osrm_base_url`, `gps_device_tokens`, `gps_max_active_streams`), `docker-compose.yml` (preserve `zhuhai.osrm` + `GPS_DEVICE_TOKENS_JSON`, `GPS_MAX_ACTIVE_STREAMS`, `GPS_LAN_BIND_ADDRESS`), `.gitignore` (preserve `.worktrees/` + GPS patterns), and `README.md` (preserve both sections).

- [ ] **Step 3: Run backend and frontend test suites on merged tree**

Run:
```bash
PYTHONPATH=backend backend/.venv/bin/pytest backend/tests -k "not container_config" -q
npm --prefix frontend test -- --run
```
Expected: All existing backend Python tests (including `test_gps_api.py`, `test_gps_ingest.py`, `test_voice_api.py`) and frontend Vitest tests PASS.

- [ ] **Step 4: Commit the merge on `feature/amap-live-gps`**

```bash
git add -A
git commit -m "merge: integrate feature/iphone-gps-sender into feature/amap-live-gps"
```

---

### Task 2: Backend Live GPS Snapshot (`GET /api/gps/latest`) & WebSocket Stream (`WS /ws/gps/live`)

**Files:**
- Modify: `backend/app/gps/models.py`
- Modify: `backend/app/gps/service.py`
- Modify: `backend/app/api/gps.py`
- Modify: `backend/app/main.py`
- Modify: `frontend/vite.config.ts`
- Modify: `backend/tests/test_gps_ingest.py`
- Modify: `backend/tests/test_gps_api.py`

**Interfaces:**
- Consumes: `GpsFixSubmission`, `GpsIngressService.ingest(fix, received_at)` from Task 1.
- Produces:
  - `LiveGpsFix(BaseModel)` with `device_id: str`, `stream_id: UUID`, `sequence: int`, `lat: float`, `lon: float`, `accuracy_m: float`, `speed_mps: float | None`, `heading_deg: float | None`, `timestamp: datetime`, `received_at: datetime`.
  - `LatestGpsStatusResponse(BaseModel)` with `active: bool`, `age_ms: int | None`, `fix: LiveGpsFix | None`.
  - `GET /api/gps/latest` returning `LatestGpsStatusResponse` (`live_timeout = timedelta(seconds=10)`).
  - `WS /ws/gps/live` sending `LiveGpsFix` JSON on initial connect (if `active == True`) and on every newly `ACCEPTED` fix.

- [ ] **Step 1: Write failing unit & API tests for `latest_status`, `GET /api/gps/latest`, `WS /ws/gps/live`, duplicate/rejected filtering, and slow subscriber backpressure**

Add to `backend/tests/test_gps_ingest.py`:
- `test_latest_status_reports_empty_active_and_expired_after_ten_seconds()`: verifies empty -> `active=False, fix=None`; 2s old -> `active=True, age_ms=2000`; 11s old -> `active=False, age_ms=11000, fix!=None`.
- `test_slow_websocket_subscriber_drops_oldest_without_blocking_ingest()`: subscribes with `maxsize=10`, ingests 15 sequential fixes without reading, then drains queue and asserts length is `10` with sequences `5..14`.

Add to `backend/tests/test_gps_api.py`:
- `test_get_latest_gps_returns_inactive_when_empty_and_active_after_post()`
- `test_websocket_live_gps_streams_initial_active_fix_and_subsequent_accepted_fixes()`
- `test_websocket_ignores_duplicate_and_rejected_fixes()`: connects to `/ws/gps/live`, posts valid seq `0` (received), posts duplicate seq `0` (`200`), out-of-order (`409`), unauthorized (`401`), then valid seq `1` (received immediately as next frame, proving none of the rejected/duplicate frames were broadcast).

- [ ] **Step 2: Run `pytest` on GPS tests to verify new tests fail**

Run: `PYTHONPATH=backend backend/.venv/bin/pytest backend/tests/test_gps_ingest.py backend/tests/test_gps_api.py -v`
Expected: FAIL (`ImportError` / `404` on `/api/gps/latest` and `/ws/gps/live`).

- [ ] **Step 3: Implement models, pub/sub queue fanout in `GpsIngressService`, HTTP/WS routes, and Vite `/ws` proxy**

1. In `backend/app/gps/models.py`, define `LiveGpsFix` and `LatestGpsStatusResponse` with `ConfigDict(json_schema_extra={"examples": [...]})`.
2. In `backend/app/gps/service.py`, add `live_timeout: timedelta = timedelta(seconds=10)` to `GpsIngressService.__init__`, track `_latest: tuple[GpsFixSubmission, datetime] | None` updated whenever a fix is newly `ACCEPTED`, implement `latest_status(now: datetime | None = None) -> LatestGpsStatusResponse`, and manage `_subscribers: set[asyncio.Queue[LiveGpsFix]]` via `subscribe() -> asyncio.Queue[LiveGpsFix]`, `unsubscribe(queue)`, and `_publish(live_fix)` (if `queue.full()`, call `queue.get_nowait()` before `queue.put_nowait(live_fix)`).
3. In `backend/app/api/gps.py`, change `receive_raw_gps_fix` to `async def` so it runs on the main asyncio loop, add `@router.get("/latest", response_model=LatestGpsStatusResponse)`, and add `gps_websocket_router = APIRouter(tags=["gps"])` with `@gps_websocket_router.websocket("/ws/gps/live")`. Register `gps_websocket_router` in `backend/app/main.py`.
4. In `frontend/vite.config.ts`, add `"/ws": { target: process.env.VOICE_API_URL || "http://127.0.0.1:8000", ws: true }` alongside `"/api"`.

- [ ] **Step 4: Run backend GPS & regression tests to verify all pass**

Run: `PYTHONPATH=backend backend/.venv/bin/pytest backend/tests -k "not container_config" -q`
Expected: PASS (0 failures).

- [ ] **Step 5: Commit Task 2**

```bash
git add backend/app/gps/models.py backend/app/gps/service.py backend/app/api/gps.py backend/app/main.py backend/tests/test_gps_ingest.py backend/tests/test_gps_api.py frontend/vite.config.ts
git commit -m "feat(gps): add /api/gps/latest snapshot and /ws/gps/live stream"
```

---

### Task 3: Frontend GCJ-02 Continuity Route Matcher & Stationary Jitter Smoother

**Files:**
- Create: `frontend/src/amap-route-matcher.ts`
- Create: `frontend/src/__tests__/amap-route-matcher.test.ts`

**Interfaces:**
- Produces (exported from `frontend/src/amap-route-matcher.ts`):
  - `export interface GcjPoint { lat: number; lon: number }`
  - `export interface IndexedRouteStep { index: number; instruction: string; startDistanceM: number; endDistanceM: number }`
  - `export interface IndexedAmapRoute { path: GcjPoint[]; steps: IndexedRouteStep[]; totalDistanceM: number; totalDurationS: number }`
  - `export interface AmapRouteMatch { segmentIndex: number; projected: GcjPoint; segmentHeadingDeg: number; distanceToRouteM: number; distanceAlongRouteM: number; remainingDistanceM: number; remainingDurationS: number; currentStepIndex: number; currentInstruction: string; nextInstruction: string | null; arrived: boolean }`
  - `export function buildIndexedAmapRoute(rawRoute: { distance?: number; time?: number; steps?: Array<{ instruction?: string; path?: Array<{ getLng?: () => number; getLat?: () => number } | [number, number]> }> }): IndexedAmapRoute`
  - `export function matchPointToAmapRoute(point: GcjPoint, route: IndexedAmapRoute, previousMatch: AmapRouteMatch | null, headingDeg?: number | null): AmapRouteMatch`
  - `export class UnroutedJitterFilter` with `update(point: GcjPoint, speedMps: number | null, headingDeg: number | null): { position: GcjPoint; headingDeg: number | null }` (implements `< 3m` deadzone when `(speedMps ?? 0) < 1.0`, EMA `alpha = 0.5` when moving, and heading retention when speed `< 1.0`).

- [ ] **Step 1: Write failing Vitest tests in `frontend/src/__tests__/amap-route-matcher.test.ts`**

Cover:
1. `builds indexed route and skips consecutive duplicate zero-length vertices without NaN` (handles both `{ getLng, getLat }` SDK objects and `[lng, lat]` tuples).
2. `snaps vehicle onto route polyline, advances step instructions, and detects arrival within 25m`.
3. `wraps heading across 359 to 1 degree north boundary and disambiguates opposite-direction parallel lane`.
4. `reports large distanceToRouteM (> 50m) when vehicle moves off-road or onto diverging street`.
5. `freezes position and heading inside 3m stationary deadzone and smooths when moving`.

- [ ] **Step 2: Run Vitest on `amap-route-matcher.test.ts` to verify failure**

Run: `npm --prefix frontend test -- --run src/__tests__/amap-route-matcher.test.ts`
Expected: FAIL (`Cannot find module '../amap-route-matcher'`).

- [ ] **Step 3: Implement `frontend/src/amap-route-matcher.ts`**

Mirror the two-phase spatial window (`[prevDist - 15m, prevDist + 1000m]`) + weighted distance/continuity/heading scoring (`distance * 1000 + continuity * 0.1 + headingDiff * 2.0`, circular heading diff `min(|a - b|, 360 - |a - b|)`) in `GCJ-02` meters, compute remaining distance/duration proportionally, resolve `currentStepIndex` / `nextInstruction`, and mark `arrived = remainingDistanceM <= 25`.

- [ ] **Step 4: Run Vitest to verify all `amap-route-matcher` tests pass**

Run: `npm --prefix frontend test -- --run src/__tests__/amap-route-matcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add frontend/src/amap-route-matcher.ts frontend/src/__tests__/amap-route-matcher.test.ts
git commit -m "feat(amap): add GCJ-02 route snapping matcher and stationary jitter filter"
```

---

### Task 4: Frontend Dual-Mode & Live Navigation State Controller

**Files:**
- Create: `frontend/src/amap-live-controller.ts`
- Create: `frontend/src/__tests__/amap-live-controller.test.ts`

**Interfaces:**
- Consumes: `wgs84ToGcj02` from `frontend/src/coord-transform.ts`; `GcjPoint`, `IndexedAmapRoute`, `AmapRouteMatch`, `UnroutedJitterFilter`, `matchPointToAmapRoute` from `frontend/src/amap-route-matcher.ts`.
- Produces (exported from `frontend/src/amap-live-controller.ts`):
  - `export type AmapAppMode = "demo" | "live"`
  - `export interface LiveGpsFixPayload { device_id: string; stream_id: string; sequence: number; lat: number; lon: number; accuracy_m: number; speed_mps: number | null; heading_deg: number | null; timestamp: string; received_at: string }`
  - `export interface LiveNavSnapshot { mode: AmapAppMode; online: boolean; weakSignal: boolean; statusText: string; rawWgs84: { lat: number; lon: number } | null; displayPositionGcj: GcjPoint | null; displayHeadingDeg: number | null; speedKmh: number | null; accuracyM: number | null; delayMs: number | null; match: AmapRouteMatch | null; offRouteCount: number; recalculating: boolean; arrived: boolean }`
  - `export class AmapLiveController` accepting injected callbacks `{ onSnapshot: (s: LiveNavSnapshot) => void; requestRecalculateRoute: (originGcj: GcjPoint) => Promise<IndexedAmapRoute | null> }` with methods `setMode(mode: AmapAppMode)`, `setActiveRoute(route: IndexedAmapRoute | null)`, `clearRoute()`, `ingestFix(fix: LiveGpsFixPayload, nowMs?: number)`, `tickHeartbeat(nowMs?: number)`.

- [ ] **Step 1: Write failing Vitest tests in `frontend/src/__tests__/amap-live-controller.test.ts`**

Cover all required scenarios from Spec & `AGENTS.md`:
1. `converts incoming WGS-84 fix to GCJ-02 and marks stream offline after 10s heartbeat timeout`.
2. `rejects noisy fixes with accuracy_m > 100 without moving vehicle or incrementing off-route count`.
3. `snaps to route during normal driving and stops off-route checks once arrived (<= 25m)`.
4. `triggers exactly one off-route recalculation after 3 consecutive >50m fixes (accuracy <= 50m) and enforces 10s cooldown`.
5. `handles unreachable route (requestRecalculateRoute returning null or rejecting) with clear error status and recovers after cooldown`.
6. `ignores stale in-flight recalculation result after switching back to demo mode`.

- [ ] **Step 2: Run Vitest on `amap-live-controller.test.ts` to verify failure**

Run: `npm --prefix frontend test -- --run src/__tests__/amap-live-controller.test.ts`
Expected: FAIL (`Cannot find module '../amap-live-controller'`).

- [ ] **Step 3: Implement `frontend/src/amap-live-controller.ts`**

Implement mode epoch token (`modeEpoch++` on every `setMode` or `clearRoute`) to discard stale async `requestRecalculateRoute` completions; enforce `accuracy_m > 100` rejection (`weakSignal = true`), `10_000 ms` online freshness check, `distanceToRouteM <= 50` snapped rendering vs `> 50` smoothed off-road rendering, `3`-strike off-route trigger (`accuracy_m <= 50`), and `10_000 ms` recalculation cooldown.

- [ ] **Step 4: Run Vitest to verify all `amap-live-controller` tests pass**

Run: `npm --prefix frontend test -- --run src/__tests__/amap-live-controller.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add frontend/src/amap-live-controller.ts frontend/src/__tests__/amap-live-controller.test.ts
git commit -m "feat(amap): add dual-mode live GPS navigation controller and off-route throttling"
```

---

### Task 5: Wire Dual-Mode UI & Live WebSocket Transport into `amap.html`, `amap-style.css`, and `amap-main.ts`

**Files:**
- Modify: `frontend/amap.html`
- Modify: `frontend/src/amap-style.css`
- Modify: `frontend/src/amap-main.ts`
- Create: `frontend/src/__tests__/amap-ui-modes.test.ts`

**Interfaces:**
- Consumes: `GET /api/gps/latest` and `WS /ws/gps/live` from Task 2; `buildIndexedAmapRoute` from Task 3; `AmapLiveController` from Task 4.
- Produces: Complete browser UI in `amap.html` supporting `?mode=live` or one-click toggle between `📡 实车实时导航` and `🧪 手动演示 Demo`.

- [ ] **Step 1: Write failing DOM mode-switching & map-click behavior test in `frontend/src/__tests__/amap-ui-modes.test.ts`**

Test helper/wiring behavior:
1. In `demo` mode: 1st map click sets origin, 2nd map click sets destination; `#demo-locate-box` and `#btn-start-cruise` are visible, `#live-telemetry-box` is hidden.
2. In `live` mode: map click sets ONLY destination (never overwrites live origin); `#live-telemetry-box` is visible, `#demo-locate-box` and `#btn-start-cruise` are hidden; switching back to `demo` closes the active WebSocket and stops heartbeat timer.

- [ ] **Step 2: Run Vitest on `amap-ui-modes.test.ts` to verify failure**

Run: `npm --prefix frontend test -- --run src/__tests__/amap-ui-modes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `frontend/amap.html`, `frontend/src/amap-style.css`, and `frontend/src/amap-main.ts`**

1. In `frontend/amap.html`:
   - Add segmented mode bar (`#btn-mode-live` `📡 实车实时导航` / `#btn-mode-demo` `🧪 手动演示 Demo`) right below `.panel-header`.
   - Add `#live-telemetry-box` (online badge, speed km/h, heading, accuracy, delay, current/next turn banner) shown in `live` mode, and wrap Demo-only controls (`#btn-locate`, `#btn-use-preset`, `#btn-start-cruise`) so they toggle cleanly by mode.
2. In `frontend/src/amap-style.css`:
   - Style `.mode-switch-bar`, `.mode-btn.active`, `.live-badge` (`online` / `offline` / `recalculating`), and `.live-turn-banner`.
3. In `frontend/src/amap-main.ts`:
   - Connect `AmapLiveController` to `GET /api/gps/latest` + `WebSocket(/ws/gps/live)` with exponential reconnect (`1s → 2s → 5s`) while in `live` mode and clean teardown on `demo` mode.
   - Update `carMarker` position, rotation (`angle`), map pan following, origin locking (before route starts, live fix updates origin; during active live route, snapped `carMarker` advances along the route, updates `#route-distance-time` & active step highlight, and triggers `drivingPlugin.search` on off-route recalculation).
   - Export testable mode/click wiring helpers for `amap-ui-modes.test.ts` and guard auto-boot when imported in unit tests if needed.

- [ ] **Step 4: Run full verification across Frontend, Backend, and Production Build**

Run:
```bash
npm --prefix frontend test -- --run
npm --prefix frontend run build
PYTHONPATH=backend backend/.venv/bin/pytest backend/tests -k "not container_config" -q
```
Expected: All Vitest suites PASS, `vite build` (`index.html` + `amap.html`) succeeds with exit 0, and all Backend Pytest suites PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add frontend/amap.html frontend/src/amap-style.css frontend/src/amap-main.ts frontend/src/__tests__/amap-ui-modes.test.ts
git commit -m "feat(amap): wire dual-mode UI and live iPhone GPS navigation closed loop"
```
