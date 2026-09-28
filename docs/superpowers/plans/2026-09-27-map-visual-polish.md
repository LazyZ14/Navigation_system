# Offline Map Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a semantic, navigation-first, fully offline MapLibre base map from the existing OSM XML without changing Phase 1 navigation behavior.

**Architecture:** The Python-standard-library build entry point will extract five minimal thematic GeoJSON FeatureCollections and reconstruct relevant OSM multipolygons safely using node reference ids. A new frontend style module will centralize visual tokens, source registration, grouped road layers, and class-specific zoom-width expressions; runtime navigation remains in `MapController` above these layers.

**Tech Stack:** Python 3.11 standard library XML/JSON, GeoJSON, TypeScript, MapLibre GL JS, Vitest, pytest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-27-map-visual-polish-design.md`

## Global Constraints

- Work only on `feature/map-visual-polish`; do not change `main` or `v0.1.0`.
- Preserve `OSM XML -> GeoJSON -> MapLibre GL JS`; all output and GeoJSON coordinate order is `[lon, lat]` in WGS-84.
- Do not modify OSRM, FastAPI, routing, NavigationState, coordinate models, raw OSM, or replay behavior.
- Add no dependencies, online resources, POI, labels, railway, sprites, MBTiles, vector tiles, GPS, camera, OCR, LLM, or voice features.
- Keep generated artifacts ignored by Git; preserve build metadata and offline behavior.
- Do not copy prettymaps/prettymapp source, presets, or runtime dependencies.
- Multipolygon topology is joined only by matching OSM node reference ids. Never bridge a gap, infer a segment, or use float coordinate equality.
- On successful target relation reconstruction, suppress all direct member ways from standalone output for its semantic category. On a relevant relation failure, suppress its candidate member ways for that category too; report the relation id/reason and emit no fallback polygon.
- Use local/arterial grouped road layers, but retain distinct `highway class -> zoom interpolated width` values.

## Review Focus

- A malformed or nested relevant multipolygon must emit neither a partial relation nor a standalone fallback member; Task 1 tests this.
- Relation member paths that meet at numerically equal coordinates but different node ids must not join; Task 1 tests this.
- A valid relation containing an inner ring must preserve that hole and avoid emitting its members twice; Task 1 tests this.
- An OSM extract without water, green, or landuse must still build all five valid empty files; Task 2 tests this.
- Route, passed route, and vehicle must remain visually above the expanded base map and retain match/unmatched behavior; Task 4 tests this.

---

### Task 1: Safe OSM geometry and multipolygon extraction

**Files:**
- Modify: `scripts/build_tiles.sh`
- Create: `backend/tests/test_map_build.py`

**Interfaces:**
- Produces: `build_feature_collections(input_path: Path) -> tuple[dict[str, dict[str, object]], list[str]]`.
- Produces: `write_feature_collections(feature_collections: dict[str, dict[str, object]], output_dir: Path) -> list[Path]`.
- Consumes later: five in-memory FeatureCollections keyed by `roads`, `buildings`, `water`, `green`, and `landuse`.

- [ ] **Step 1: Write failing geometry tests**

Add fixture XML and focused tests for a road line with `[lon, lat]`, a closed building way, a water multipolygon with an inner hole, two disjoint outers producing MultiPolygon, node-id-based joining, and malformed/missing/nested relation members. Assert that valid relation member ways are not duplicated and failure suppresses tagged closed members of that category.

- [ ] **Step 2: Run geometry tests to verify they fail**

Run: `backend/.venv/bin/pytest backend/tests/test_map_build.py -q`

Expected: FAIL because the extraction interfaces and relation implementation do not yet exist.

- [ ] **Step 3: Implement build-time geometry interfaces**

Implement the two declared functions and standard-library helpers in `scripts/build_tiles.sh`. Index node ids and way node-reference sequences; stitch role-separated rings only by first/last node id. Validate closed chains, preserve `outer`/`inner` topology, use point-in-polygon containment to assign holes, return `Polygon` or `MultiPolygon`, and append deterministic stderr-ready report entries for every skipped relation. Classify only the specified semantic categories and retain only their minimal properties.

- [ ] **Step 4: Run geometry tests to verify they pass**

Run: `backend/.venv/bin/pytest backend/tests/test_map_build.py -q`

Expected: PASS.

- [ ] **Step 5: Commit the geometry extractor**

```bash
git add scripts/build_tiles.sh backend/tests/test_map_build.py
git commit -m "feat(map): 扩展离线 OSM 主题数据提取"
```

### Task 2: Thematic artifact contract and reproducible CLI

**Files:**
- Modify: `scripts/build_tiles.sh`
- Modify: `backend/tests/test_data_metadata.py`
- Modify: `backend/tests/test_map_build.py`

**Interfaces:**
- Consumes: `build_feature_collections()` and `write_feature_collections()` from Task 1.
- Produces: CLI output files `roads.geojson`, `buildings.geojson`, `water.geojson`, `green.geojson`, `landuse.geojson` in `frontend/public/generated/`.

- [ ] **Step 1: Write failing artifact and metadata tests**

Add tests that execute the build entry point against minimal fixture XML and assert all five files exist, parse as FeatureCollections, preserve required properties and allowed geometry types, and remain valid for empty categories. Update metadata expectations to one named thematic-map artifact with the generated directory/output manifest instead of `map-roads.geojson`.

- [ ] **Step 2: Run artifact tests to verify they fail**

Run: `backend/.venv/bin/pytest backend/tests/test_map_build.py backend/tests/test_data_metadata.py -q`

Expected: FAIL because the CLI still emits only `map-roads.geojson` and records the old artifact name.

- [ ] **Step 3: Implement thematic artifact writing**

Make `main()` invoke the Task 1 interfaces, write exactly the five named ignored artifacts to the generated directory, emit skip reports to stderr, and record the existing input provenance plus a deterministic list of generated output names. Do not write map data into Git-tracked files.

- [ ] **Step 4: Run artifact tests to verify they pass**

Run: `backend/.venv/bin/pytest backend/tests/test_map_build.py backend/tests/test_data_metadata.py -q`

Expected: PASS.

- [ ] **Step 5: Commit the build artifact contract**

```bash
git add scripts/build_tiles.sh backend/tests/test_map_build.py backend/tests/test_data_metadata.py
git commit -m "test(map): 补充离线地图构建回归测试"
```

### Task 3: Centralized MapLibre base-map style

**Files:**
- Create: `frontend/src/map-style.ts`
- Create: `frontend/src/__tests__/map-style.test.ts`
- Modify: `frontend/src/main.ts`

**Interfaces:**
- Produces: `MAP_VISUAL_TOKENS`, `ROAD_CLASS_GROUPS`, `roadWidthExpression`, and `registerBaseMap(map, dataBySource)` from `map-style.ts`.
- Consumes: FeatureCollections loaded under source ids `roads`, `buildings`, `water`, `green`, and `landuse`.
- Produces: ordered base layers ending in `arterial-road-surface`.

- [ ] **Step 1: Write failing base-style tests**

Assert token values for the muted base map, five source registrations, and exact base-layer order. Assert local/arterial filters cover every required highway class, while each class—including primary, secondary, tertiary and link variants—maps to a distinct zoom-interpolated width branch rather than a grouped fixed width.

- [ ] **Step 2: Run base-style tests to verify they fail**

Run: `cd frontend && npm test -- --run src/__tests__/map-style.test.ts`

Expected: FAIL because `map-style.ts` and its source/layer factory do not exist.

- [ ] **Step 3: Implement the style module and use it at map load**

Implement centralized tokens and a typed base-map registration function. Update `main.ts` to fetch the five local files concurrently, reject malformed/missing collections with the existing offline-data message, then delegate source/layer creation to the factory. Use fills for thematic polygons, lines for waterways, and paired casing/surface layers for local and arterial roads. Use MapLibre `interpolate`/`zoom` expressions with a `match(get("class"))` width base so every supported class stays distinguishable.

- [ ] **Step 4: Run base-style tests to verify they pass**

Run: `cd frontend && npm test -- --run src/__tests__/map-style.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the base-map layers**

```bash
git add frontend/src/map-style.ts frontend/src/main.ts frontend/src/__tests__/map-style.test.ts
git commit -m "feat(map): 增加建筑水体与绿地底图图层"
```

### Task 4: Navigation visual tokens and layer precedence

**Files:**
- Modify: `frontend/src/map-controller.ts`
- Modify: `frontend/src/__tests__/map-controller.test.ts`
- Modify: `frontend/src/__tests__/map-style.test.ts`

**Interfaces:**
- Consumes: navigation visual tokens from `MAP_VISUAL_TOKENS`.
- Preserves: `MapController.renderRoute(route)`, `updateNavigation(state)`, `clearRoute()`, and `resetNavigation()` signatures and behavior.

- [ ] **Step 1: Write failing navigation-style tests**

Extend controller tests to assert route casing is 3--4 pixels wider than active route, passed route is lower-salience blue-gray, vehicle uses the new blue/cyan token with white halo and the same heading expression, and route/vehicle layers are appended after all base layers. Retain the matched-only vehicle update test unchanged.

- [ ] **Step 2: Run navigation-style tests to verify they fail**

Run: `cd frontend && npm test -- --run src/__tests__/map-controller.test.ts src/__tests__/map-style.test.ts`

Expected: FAIL because controller paint values are not yet tokenized and precedence integration is absent.

- [ ] **Step 3: Apply shared navigation tokens without changing behavior**

Replace only controller paint constants with `MAP_VISUAL_TOKENS.navigation` values. Preserve source ids, layer ids, route geometry conversion, nearest-point math, unmatched early return, and heading rotation. Ensure the main flow registers base layers before constructing route overlays.

- [ ] **Step 4: Run navigation-style tests to verify they pass**

Run: `cd frontend && npm test -- --run src/__tests__/map-controller.test.ts src/__tests__/map-style.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the hierarchy polish**

```bash
git add frontend/src/map-controller.ts frontend/src/__tests__/map-controller.test.ts frontend/src/__tests__/map-style.test.ts
git commit -m "style(navigation): 优化导航路线与车辆视觉层级"
```

### Task 5: Offline operational documentation and regression validation

**Files:**
- Modify: `scripts/smoke_test.sh`
- Modify: `scripts/demo.sh`
- Modify: `docs/data-build.md`
- Modify: `ARCHITECTURE.md`
- Create: `backend/tests/test_operational_scripts.py`

**Interfaces:**
- Consumes: the five artifact names from Task 2 and the source/layer contract from Task 3.
- Produces: accurate offline operator checks and documented build/run behavior.

- [ ] **Step 1: Write failing smoke-contract assertions**

Create `backend/tests/test_operational_scripts.py` asserting that both local operational scripts name all five generated artifacts and no longer name `map-roads.geojson`. Extend the smoke check so each generated URL must respond with a non-empty GeoJSON FeatureCollection.

- [ ] **Step 2: Run the focused operational checks to verify they fail**

Run: `backend/.venv/bin/pytest backend/tests/test_operational_scripts.py -q`

Expected: FAIL because both scripts still request only `map-roads.geojson`.

- [ ] **Step 3: Update offline checks and documentation**

Update smoke/demo scripts to request the five new artifacts. Update architecture and data-build documentation with thematic GeoJSON, relation skip/report semantics, visual hierarchy, build provenance, and explicit future-only scope for labels, POI, railway, sprites, MBTiles, and vector tiles.

- [ ] **Step 4: Run focused operational checks to verify they pass**

Run: `backend/.venv/bin/pytest backend/tests/test_operational_scripts.py backend/tests/test_repository_hygiene.py backend/tests/test_container_config.py -q`

Expected: PASS.

- [ ] **Step 5: Commit operational documentation**

```bash
git add scripts/smoke_test.sh scripts/demo.sh docs/data-build.md ARCHITECTURE.md backend/tests/test_operational_scripts.py
git commit -m "docs(map): 更新离线地图视觉与构建说明"
```

### Task 6: Full validation, browser inspection, and Map Visual Merge Review

**Files:**
- Modify only if verification reveals a scoped defect in a preceding task.

**Interfaces:**
- Consumes: complete build, base-map, navigation, documentation, and smoke-test changes.
- Produces: evidence-backed review report; no merge.

- [ ] **Step 1: Build the ignored local map artifacts**

Run: `./scripts/build_tiles.sh data/raw/map.osm`

Expected: all five ignored GeoJSON files are generated; stderr reports only genuinely skipped relations.

- [ ] **Step 2: Run complete Phase 1 regression commands**

Run:

```bash
backend/.venv/bin/pytest backend/tests -q
cd frontend && npm test -- --run
cd frontend && npm run build
docker compose config --quiet
bash scripts/smoke_test.sh
```

Expected: every command exits 0.

- [ ] **Step 3: Perform browser offline visual verification**

Run the existing local demo without external map requests. Inspect no-route, active-route, replayed route, and zoom-in/out states for thematic visibility, relation boundaries/holes, road hierarchy, active-route salience, passed-route restraint, vehicle clarity, and absent network dependency.

- [ ] **Step 4: Run Map Visual Merge Review**

Review the final diff and generated-artifact sizes for Phase 1 regression, AGPL/code-copy contamination, coordinate-order regressions, relation errors, duplicate source/layer registration, source/layer leaks, route occlusion, and unnecessary data volume. Record future enhancements separately; do not merge.

- [ ] **Step 5: Commit only a necessary test fix**

If and only if Step 2 exposes a scoped defect, add a failing test, make the minimal fix, rerun the complete validation, then commit with the matching `fix(map): ...` message. Do not create an empty commit.

## Plan self-review

- Spec coverage: Tasks 1--2 cover semantic extraction, relation correctness, deduplication, empty categories, artifacts, and provenance. Tasks 3--4 cover tokens, grouped/class-specific roads, source/layer order, and navigation priority. Tasks 5--6 cover operations, documentation, browser validation, and merge review.
- Type consistency: Task 1 defines the extractor interfaces consumed by Task 2; Task 3 defines the style exports consumed by Task 4.
- Review focus: each listed risk is assigned to a concrete task/test.
- Scope: all excluded capabilities remain excluded; no backend or routing interfaces appear in any task.
