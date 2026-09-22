# Offline Navigation MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully local Mac-browser demonstration that plans a car route across the supplied Beijing OSM region and visualizes a replayed vehicle route, including a deterministic off-route replan.

**Architecture:** OSRM owns road-graph preprocessing and routing; a small FastAPI service owns the public route and navigation-session API; a Vite TypeScript page uses MapLibre GL JS to draw the offline base map and dynamic navigation layers. The application operates on WGS-84 coordinates and consumes deterministic JSON replay tracks before any real GNSS source is introduced.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic v2, httpx, pytest; OSRM Docker image; Vite, TypeScript, Vitest, MapLibre GL JS; `tilemaker`-generated MBTiles served locally.

**Spec:** `ARCHITECTURE.md`

## Global Constraints

- First-stage scope is only offline navigation routing, map rendering, and simulated tracks; do not introduce POI recommendation, LLM, voice, OCR, real GNSS, cloud maps, or traffic.
- Use WGS-84 internally and typed `{lat, lon}` objects. Convert to OSRM's `lon,lat` URL form only inside the OSRM adapter.
- Never modify the OSM source based on vehicle location. The OSM file is static road data.
- Show a road-matched location rather than a raw location fix.
- Run all dependencies locally on macOS or in local Docker; the demo must not require an online map.
- Do not commit raw OSM/PBF, `.osrm*`, MBTiles, container volumes, browser caches, logs, or real tracks.
- Every source-data build records input checksum, bounding box, build time, and the exact command used.
- Frontend code must call the FastAPI public API, never OSRM directly.
- Test normal routing, no route, a point outside the road graph, and off-route replanning.

## Review Focus

- A valid WGS-84 coordinate at `0` latitude or longitude must validate instead of being mistaken for a missing field; Task 2 adds the model test.
- An OSRM route response with no `routes` array must become a stable `404` API response, not an index error; Task 2 adds the adapter test.
- A location more than the allowed snap distance from every road must be reported as unmatched and must not move the car marker; Task 4 adds the navigation-state test.
- A GPS-like noisy point that is briefly 30 m from the route must not trigger a replan; Task 5 requires three consecutive deviations before replanning.
- Reloading the browser during an active replay must reconstruct map layers from the last API state without duplicated layers; Task 3 adds the map-controller test.

---

## File Structure

```text
Navigation_system/
├── .gitignore
├── docker-compose.yml
├── data/
│   ├── raw/.gitkeep
│   ├── metadata/.gitkeep
│   ├── tracks/normal-route.json
│   └── tracks/off-route.json
├── scripts/
│   ├── build_osrm.sh
│   ├── build_tiles.sh
│   └── verify_data.py
├── backend/
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── config.py
│   │   ├── api/routes.py
│   │   └── services/{osrm.py,navigation.py,replay.py,geometry.py}
│   └── tests/{conftest.py,test_models.py,test_osrm.py,test_routes.py,test_navigation.py}
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/{main.ts,api.ts,types.ts,map-controller.ts,navigation-ui.ts,style.css}
│       └── __tests__/map-controller.test.ts
└── docs/
    ├── data-build.md
    └── superpowers/plans/2026-09-23-offline-navigation-mvp.md
```

`data/raw/`, OSRM output directories, and `data/tiles/` stay ignored. Only small, synthetic JSON replay tracks are versioned.

### Task 1: Establish reproducible local project boundaries

**Files:**
- Create: `.gitignore`
- Create: `docker-compose.yml`
- Create: `backend/pyproject.toml`
- Create: `frontend/package.json`
- Create: `data/raw/.gitkeep`, `data/metadata/.gitkeep`
- Create: `docs/data-build.md`

**Interfaces:**
- Consumes: `ARCHITECTURE.md`, `DATA_POLICY.md`
- Produces: a local-only directory contract; `docker compose up osrm` starts the future OSRM service on `http://127.0.0.1:5000`.

- [ ] **Step 1: Write a repository hygiene test**

Create `backend/tests/test_repository_hygiene.py` that asserts generated artifacts are ignored:

```python
from pathlib import Path


def test_large_and_regenerated_map_artifacts_are_ignored():
    ignored = Path(__file__).parents[2] / ".gitignore"
    text = ignored.read_text()
    for pattern in ("data/raw/*", "data/osrm/*", "data/tiles/*", "*.osrm*", "*.mbtiles"):
        assert pattern in text
```

- [ ] **Step 2: Run the test to confirm the project is not yet configured**

Run: `cd backend && pytest tests/test_repository_hygiene.py -v`

Expected: FAIL because `.gitignore` and the Python test environment do not exist.

- [ ] **Step 3: Create the minimal local tool configuration**

Create a Python package with `fastapi`, `uvicorn`, `httpx`, `pydantic`, and test dependencies `pytest`, `pytest-asyncio`. Create a Vite TypeScript project with only `maplibre-gl`, `vitest`, and `typescript`; do not add React. Add Docker Compose with a named `osrm` service, bind mounts for `data/osrm`, and port binding `127.0.0.1:5000:5000`.

Write `.gitignore` including:

```gitignore
data/raw/*
!data/raw/.gitkeep
data/osrm/*
data/tiles/*
*.osrm*
*.mbtiles
__pycache__/
.pytest_cache/
node_modules/
dist/
*.log
```

Document the source file location, checksum command `shasum -a 256`, expected data outputs, and no-commit policy in `docs/data-build.md`.

- [ ] **Step 4: Run the hygiene test**

Run: `cd backend && pytest tests/test_repository_hygiene.py -v`

Expected: PASS.

- [ ] **Step 5: Commit the reproducible scaffold**

```bash
git add .gitignore docker-compose.yml backend frontend data docs/data-build.md
git commit -m "chore: establish offline navigation scaffold"
```

### Task 2: Build OSRM data and expose a typed route API

**Files:**
- Create: `scripts/build_osrm.sh`, `scripts/verify_data.py`
- Create: `backend/app/{config.py,models.py,main.py}`
- Create: `backend/app/services/osrm.py`, `backend/app/api/routes.py`
- Create: `backend/tests/{conftest.py,test_models.py,test_osrm.py,test_routes.py}`
- Modify: `docker-compose.yml`, `docs/data-build.md`

**Interfaces:**
- Consumes: raw `map.osm` placed by the operator under `data/raw/`; OSRM at `http://127.0.0.1:5000`.
- Produces: `POST /api/routes` accepting `RouteRequest`; returns `RouteResponse`; later tasks use `RouteResponse.geometry` and `RouteResponse.maneuvers`.

```python
class Coordinate(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)

class RouteRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate

class Maneuver(BaseModel):
    instruction: str
    distance_m: float
    location: Coordinate

class RouteResponse(BaseModel):
    geometry: list[Coordinate]
    distance_m: float
    duration_s: float
    maneuvers: list[Maneuver]
```

- [ ] **Step 1: Write failing model and OSRM adapter tests**

In `test_models.py`, test `{ "lat": 0, "lon": 0 }` is valid and latitude `91` fails. In `test_osrm.py`, use `respx` or an `httpx.MockTransport` to assert the adapter requests `/route/v1/driving/116.400000,39.900000;116.410000,39.890000` and parses an OSRM GeoJSON geometry. Also test an OSRM `{"code":"NoRoute","routes":[]}` response raises `RouteNotFound`.

- [ ] **Step 2: Run the focused tests to confirm they fail**

Run: `cd backend && pytest tests/test_models.py tests/test_osrm.py -v`

Expected: FAIL because models and adapter do not exist.

- [ ] **Step 3: Implement data build scripts and the OSRM adapter**

`build_osrm.sh` must fail early unless it receives an existing `.osm` or `.osm.pbf` input, then run `osrm-extract -p /opt/car.lua`, `osrm-partition`, and `osrm-customize` into `data/osrm/`. `verify_data.py` records SHA-256, bounding box, input filename, UTC build time, and exact command in `data/metadata/<input>-build.json`.

Implement `OsrmClient.route(origin, destination) -> RouteResponse`. It requests `steps=true&overview=full&geometries=geojson`, maps OSRM `[lon, lat]` arrays to `Coordinate(lat=lat, lon=lon)`, and maps the returned steps to `Maneuver` objects. `POST /api/routes` maps `RouteNotFound` to JSON `{ "code": "route_not_found" }` with status 404 and all transport failures to `{ "code": "routing_unavailable" }` with status 503.

- [ ] **Step 4: Run the unit tests**

Run: `cd backend && pytest tests/test_models.py tests/test_osrm.py -v`

Expected: PASS.

- [ ] **Step 5: Add FastAPI route tests and verify API behavior**

In `test_routes.py`, override `OsrmClient` with a fake client. Assert a valid request returns 200 with `geometry`, an invalid latitude returns 422, a missing route returns 404 with `route_not_found`, and an unavailable client returns 503 with `routing_unavailable`.

Run: `cd backend && pytest tests/test_routes.py -v`

Expected: PASS.

- [ ] **Step 6: Build the supplied OSM data and run the live smoke test**

Copy the user-approved source manually into ignored `data/raw/`, run the documented build script, start `docker compose up -d osrm`, then:

```bash
curl -sS -X POST http://127.0.0.1:8000/api/routes \
  -H 'content-type: application/json' \
  -d '{"origin":{"lat":39.8900,"lon":116.3800},"destination":{"lat":39.8950,"lon":116.4050}}'
```

Expected: a 200 JSON response with non-empty `geometry` and `maneuvers`.

- [ ] **Step 7: Commit the routing boundary**

```bash
git add docker-compose.yml scripts backend docs/data-build.md
git commit -m "feat: add typed OSRM route API"
```

### Task 3: Render the offline map and a route without navigation state

**Files:**
- Create: `scripts/build_tiles.sh`
- Create: `frontend/src/{main.ts,api.ts,types.ts,map-controller.ts,navigation-ui.ts,style.css}`
- Create: `frontend/src/__tests__/map-controller.test.ts`
- Modify: `docs/data-build.md`, `docker-compose.yml`

**Interfaces:**
- Consumes: `RouteResponse` from `POST /api/routes`; a local vector-tile style URL served from the local tile service.
- Produces: `MapController.renderRoute(route: RouteResponse): void`, `MapController.clearRoute(): void`; Task 4 adds vehicle state to this controller.

- [ ] **Step 1: Write a failing map-controller test**

Mock a minimal MapLibre map and assert `renderRoute()` adds exactly two GeoJSON line layers named `route-casing` and `route-active`, calling it twice updates sources rather than adding duplicate layers. Assert `clearRoute()` removes both layers and their sources.

- [ ] **Step 2: Run the frontend test to confirm it fails**

Run: `cd frontend && npm test -- map-controller.test.ts`

Expected: FAIL because the frontend project and controller do not exist.

- [ ] **Step 3: Build and serve an offline base map**

Write `build_tiles.sh` using `tilemaker` against the same raw OSM input to create ignored `data/tiles/beijing-experiment.mbtiles`. Serve the MBTiles and its MapLibre style from a local tile-server container in Docker Compose. Record tilemaker version, input checksum, zoom bounds, and output name in the metadata record.

- [ ] **Step 4: Implement the smallest MapLibre page**

Create a map only after its local style is loaded. Use an API client that posts typed coordinate objects to `/api/routes`. Render a dark route casing beneath a blue active route. Add simple map-click origin/destination selection and a “规划路线” button. Add no search, POI, voice, or cloud tile provider.

- [ ] **Step 5: Run frontend tests and manual offline check**

Run: `cd frontend && npm test -- map-controller.test.ts`

Expected: PASS.

Then disconnect network access, start only local services, open the local page, select two valid road positions, and verify the base map and route still render.

- [ ] **Step 6: Commit offline map rendering**

```bash
git add docker-compose.yml scripts frontend docs/data-build.md
git commit -m "feat: render offline map and route"
```

### Task 4: Add deterministic replay and road-matched vehicle state

**Files:**
- Create: `backend/app/services/{replay.py,geometry.py,navigation.py}`
- Create: `backend/tests/{test_replay.py,test_navigation.py}`
- Create: `data/tracks/normal-route.json`
- Modify: `backend/app/{models.py,main.py}`, `backend/app/api/routes.py`, `frontend/src/{types.ts,api.ts,map-controller.ts,navigation-ui.ts}`

**Interfaces:**
- Consumes: `LocationFix(lat, lon, heading, speed_mps, accuracy_m, timestamp)` and `RouteResponse`.
- Produces: `NavigationState(status, raw_location, matched_location, next_maneuver, remaining_distance_m, off_route)` over `GET /api/navigation/{session_id}` and `WS /ws/navigation/{session_id}`.

```python
class LocationFix(Coordinate):
    heading: float = Field(ge=0, lt=360)
    speed_mps: float = Field(ge=0)
    accuracy_m: float = Field(gt=0)
    timestamp: datetime

class NavigationState(BaseModel):
    status: Literal["ready", "navigating", "unmatched", "arrived"]
    raw_location: LocationFix | None
    matched_location: Coordinate | None
    next_maneuver: Maneuver | None
    remaining_distance_m: float | None
    off_route: bool
```

- [ ] **Step 1: Write failing replay and unmatched-location tests**

`test_replay.py` must assert a replay emits points in timestamp order and pause/resume preserves the next point. `test_navigation.py` must assert a fake nearest-road response within 20 m yields `status="navigating"`; a fake response 250 m away yields `status="unmatched"` and `matched_location is None`.

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd backend && pytest tests/test_replay.py tests/test_navigation.py -v`

Expected: FAIL because replay and navigation services do not exist.

- [ ] **Step 3: Implement replay and road matching**

Define versioned track files as `{ "version": 1, "points": [LocationFix, ...] }`; validate monotonic timestamps. Implement a `ReplayController` with `start`, `pause`, `resume`, and `next_fix`. Extend `OsrmClient` with `nearest(location) -> MatchedRoad | None`, using `/nearest/v1/driving/{lon},{lat}`. Treat OSRM's reported distance above `50 m` as unmatched.

Implement `NavigationService.apply_fix(fix) -> NavigationState`, preserving both raw and matched locations. Publish each state over the session WebSocket. Do not make the frontend perform road matching.

- [ ] **Step 4: Run backend tests**

Run: `cd backend && pytest tests/test_replay.py tests/test_navigation.py -v`

Expected: PASS.

- [ ] **Step 5: Display vehicle and navigation state**

Add a vehicle GeoJSON point source. Rotate the car icon by `heading`, update it only from `matched_location`, turn the passed portion of the route gray, and display next instruction and remaining distance. Render `unmatched` state as a visible debug warning without moving the car off the road.

- [ ] **Step 6: Verify the normal replay**

Run the normal track from beginning to end. Expected: movement is repeatable, car stays on the road, remaining distance decreases, and the UI reaches `arrived`.

- [ ] **Step 7: Commit replay navigation**

```bash
git add backend frontend data/tracks/normal-route.json
git commit -m "feat: add matched simulated navigation replay"
```

### Task 5: Detect sustained deviation and replan once

**Files:**
- Create: `data/tracks/off-route.json`
- Modify: `backend/app/services/{geometry.py,navigation.py,osrm.py}`, `backend/tests/test_navigation.py`
- Modify: `frontend/src/{map-controller.ts,navigation-ui.ts,style.css}`

**Interfaces:**
- Consumes: `NavigationState` and the active `RouteResponse`.
- Produces: `NavigationState.off_route: bool` and a replacement route sent in the same session state after one replan.

- [ ] **Step 1: Write failing deviation tests**

Add tests using a route polyline and projected metric distance: one 35 m outlier followed by two on-route points must not replan; three consecutive points each more than `30 m` from the active route must call `OsrmClient.route()` exactly once; after replacement, the consecutive-deviation counter resets.

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd backend && pytest tests/test_navigation.py -v`

Expected: FAIL because sustained-deviation state is not implemented.

- [ ] **Step 3: Implement a deterministic deviation policy**

In `geometry.py`, implement point-to-polyline distance in meters using local equirectangular projection around the active route. In `NavigationService`, increment a counter only for matched points farther than `30 m`; reset it otherwise. At a counter of `3`, request one route from the matched position to the original destination, replace the active route only if a route exists, then reset the counter. Add a minimum `10 s` replan cooldown to prevent loops.

- [ ] **Step 4: Run deviation tests**

Run: `cd backend && pytest tests/test_navigation.py -v`

Expected: PASS.

- [ ] **Step 5: Update the UI for replanning**

When session state carries a replacement route, replace route sources in place, briefly display “已重新规划路线”, and keep the vehicle source intact. Do not create duplicate route layers.

- [ ] **Step 6: Validate the off-route replay**

Run the off-route track. Expected: one replan after the third sustained deviation, new active route visible, and no repeated replan during the 10-second cooldown.

- [ ] **Step 7: Commit replan behavior**

```bash
git add backend frontend data/tracks/off-route.json
git commit -m "feat: replan after sustained route deviation"
```

### Task 6: Add end-to-end verification and handoff artifacts

**Files:**
- Create: `scripts/demo.sh`
- Create: `docs/demo-runbook.md`
- Modify: `README.md`, `DEVELOPMENT.md`, backend and frontend test configuration as needed

**Interfaces:**
- Consumes: completed local data, OSRM service, tile service, API service, frontend, and both tracks.
- Produces: one-command local demonstration plus a documented verification record.

- [ ] **Step 1: Write a failing smoke-test script**

Create `scripts/smoke_test.sh` that exits nonzero unless: tile service responds locally, `/api/routes` returns non-empty geometry for known coordinates, normal replay reaches `arrived`, and off-route replay reports exactly one route replacement.

- [ ] **Step 2: Run it to confirm it fails before services are assembled**

Run: `bash scripts/smoke_test.sh`

Expected: FAIL with a named unavailable dependency or missing endpoint.

- [ ] **Step 3: Implement the local demo orchestration**

`demo.sh` starts containers and development servers, waits with bounded retries for local health checks, initializes a known origin/destination, and starts the normal replay. `smoke_test.sh` uses `curl` and documented session endpoints only; it must not inspect internal process memory. `docs/demo-runbook.md` documents prerequisites, all startup commands, expected screen states, the normal replay, the off-route replay, and shutdown.

- [ ] **Step 4: Run unit, frontend, and smoke tests**

Run:

```bash
cd backend && pytest -v
cd ../frontend && npm test
cd .. && bash scripts/smoke_test.sh
```

Expected: all commands PASS.

- [ ] **Step 5: Perform the offline acceptance run**

Disable network access after all local images and dependencies are prepared. Run `scripts/demo.sh`; verify the map loads, a route is visible, the normal track arrives, and the off-route track replans exactly once.

- [ ] **Step 6: Commit the demo handoff**

```bash
git add scripts README.md DEVELOPMENT.md docs backend frontend
git commit -m "docs: add offline navigation demo runbook"
```

## Plan Self-Review

**Spec coverage:** Task 1 enforces local/reproducible data boundaries; Task 2 owns OSRM car routing and typed error handling; Task 3 owns offline MapLibre rendering and route styling; Task 4 owns simulation, matching, marker orientation, traveled-route state, and maneuver card; Task 5 owns controlled replan; Task 6 owns the required normal/off-route integrated demonstration. POI, LLM, voice, OCR, real GPS, cloud maps, and traffic are explicitly excluded throughout.

**Placeholder scan:** no deferred implementation placeholders are used; all work items name files, interfaces, commands, expected outcomes, and required behavior.

**Type consistency:** all module boundaries use `Coordinate(lat, lon)`, `RouteResponse`, `LocationFix`, and `NavigationState`; OSRM coordinate reversal is confined to `OsrmClient`.

**Review focus coverage:** Task 2 tests zero coordinates and empty OSRM routes; Task 3 tests idempotent map layers; Task 4 tests an unmatched location; Task 5 tests transient noise and sustained deviation.
