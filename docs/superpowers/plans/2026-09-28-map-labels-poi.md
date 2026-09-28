# Offline Map Labels and Basic POI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add offline Chinese-capable road, place, and basic POI labels while preserving navigation-first rendering.

**Architecture:** The five geometry FeatureCollections remain unchanged. The Python build produces three ignored label collections with minimal properties and safe anchors; `map-style.ts` registers native MapLibre symbol layers before `MapController` appends navigation overlays.

**Tech Stack:** Python standard library XML/JSON, GeoJSON, TypeScript, MapLibre GL JS 5.24, Vitest, pytest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-28-map-labels-poi-design.md`

## Global Constraints

- Work only on `feature/map-labels-poi`, created from `main` merge `aa6cd11`; do not change raw OSM, OSRM, FastAPI, NavigationState, routing, replay, or `{lat, lon}` contracts.
- Preserve `roads`, `buildings`, `water`, `green`, and `landuse`; add ignored `road-labels.geojson`, `place-labels.geojson`, and `poi.geojson` only. Every collection may validly be empty and every coordinate is WGS-84 `[lon, lat]`.
- Select text as `name:zh`, then `name`, then `name:en`; do not emit arbitrary raw OSM tags.
- `priority` always means smaller number is more important. Builders write it and every MapLibre sort key must render lower values before higher values.
- Multipolygon joining remains node-reference-ID-only. No inferred geometry, float endpoint equality, or unreliable anchor: skip and deterministic-report instead.
- A representative point must be inside an outer polygon component and outside every hole. Failed relations/anchors do not receive standalone fallback output.
- Institutional amenities emitted in `place-labels` must be excluded from `poi` by source identity `(OSM element type, OSM id)`, not collision behavior.
- Keep `glyphs` absent. Use local `text-font` fallbacks and `localIdeographFontFamily`; any external glyph/font/icon request or CJK missing glyph is a browser blocker.
- Use MapLibre collision with `text-allow-overlap: false` and `text-ignore-placement: false`. Route, vehicle, endpoints, and guidance must be registered after labels.
- Do not add sprites/icons, online maps/geocoding, search, recommendation, MBTiles/vector tiles, railway, GPS, camera, LLM, OCR, voice, or route changes.

## Review Focus

- Concave, hole-containing, multipolygon, and degenerate polygons must yield only safe interior anchors or a deterministic skip; Task 1 owns tests.
- A school/hospital/theatre emitted as a place must never also be a POI; Task 2 owns the source-identity test.
- A label-free extract must produce three valid empty files and an ordered eight-file manifest; Task 3 owns tests.
- Lower numeric priority must win in every label layer and labels must not occlude navigation; Task 4 owns tests.
- Browser must show CJK locally and no external glyph/font/icon request; Task 5 owns verification.

---

### Task 1: Label naming and safe representative-point primitives

**Files:**
- Modify: `scripts/build_tiles.sh`
- Modify: `backend/tests/test_map_build.py`

**Interfaces:**
- Produces: `select_label_name(osm_tags: dict[str, str]) -> str | None`.
- Produces: `representative_point(geometry: dict[str, object]) -> tuple[list[float] | None, str | None]`.

- [ ] **Step 1: Write failing primitive tests**

Add tests for `name:zh → name → name:en`, blank/no-name exclusion, and five anchor fixtures: convex Polygon, concave Polygon whose centroid is outside, Polygon with hole, MultiPolygon, and degenerate/narrow geometry. Assert success is inside exactly one outer and no hole; assert failure exactly returns `no reliable interior anchor`.

- [ ] **Step 2: Verify tests are red**

Run: `backend/.venv/bin/pytest backend/tests/test_map_build.py -q`

Expected: FAIL because both interfaces are absent.

- [ ] **Step 3: Implement primitives**

Use deterministic scanlines through outer rings, subtract hole spans, and return the midpoint of the widest strict interior span. For a MultiPolygon, select the component with the widest valid span. Final-check each candidate with existing point-in-ring logic; never use a centroid fallback.

- [ ] **Step 4: Verify tests are green**

Run: `backend/.venv/bin/pytest backend/tests/test_map_build.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build_tiles.sh backend/tests/test_map_build.py
git commit -m "feat(map): 增加离线标签锚点基础能力"
```

### Task 2: Minimal label builders and cross-collection deduplication

**Files:**
- Modify: `scripts/build_tiles.sh`
- Modify: `backend/tests/test_map_build.py`

**Interfaces:**
- Consumes: Task 1 primitives.
- Produces: `build_label_feature_collections(input_path: Path) -> tuple[dict[str, dict[str, object]], list[str]]` keyed by `road-labels`, `place-labels`, and `poi`.
- Produces: road properties `{name, class, priority}`; place properties `{name, class, priority}`; POI properties `{name, category, subclass, priority}`.

- [ ] **Step 1: Write failing extraction tests**

Add a compact fixture with named and unnamed roads, named building polygon, named place, named school, restaurant node, supermarket polygon, and exact duplicate POI. Assert minimal properties, `[lon, lat]`, no-name exclusion, priority values, category mapping, duplicate suppression, and school appears once in place labels but never in POI.

- [ ] **Step 2: Verify tests are red**

Run: `backend/.venv/bin/pytest backend/tests/test_map_build.py -q`

Expected: FAIL because `build_label_feature_collections` is absent.

- [ ] **Step 3: Implement label builders**

Emit trunk/primary with priority 1, secondary/tertiary with priority 2, and residential/unclassified with priority 4; omit links/service/pedestrian/footway/cycleway. Emit building/place/institutional amenity labels at priority 2. Map approved POI tags to `food`, `shop`, `transport`, `service`, `tourism`, or `other` at priority 3 or dense-commercial priority 5. Track selected institutional entities by `(element_type, osm_id)` and exclude them from POI. Deduplicate normalized properties plus coordinate within each collection; reuse relation geometry/member suppression and append anchor reports in document order.

- [ ] **Step 4: Verify tests are green**

Run: `backend/.venv/bin/pytest backend/tests/test_map_build.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build_tiles.sh backend/tests/test_map_build.py
git commit -m "feat(map): 生成离线道路地点与 POI 标签"
```

### Task 3: Eight-artifact CLI and local operator contract

**Files:**
- Modify: `scripts/build_tiles.sh`
- Modify: `backend/tests/test_map_build.py`
- Modify: `backend/tests/test_operational_scripts.py`
- Modify: `scripts/smoke_test.sh`
- Modify: `scripts/demo.sh`
- Modify: `docs/data-build.md`
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- Consumes: existing geometry builder and Task 2 label builder.
- Produces: deterministic manifest ordered as five geometry files, then `road-labels.geojson`, `place-labels.geojson`, `poi.geojson`.

- [ ] **Step 1: Write failing artifact tests**

Extend CLI integration coverage to assert exactly eight files, valid empty label collections, deterministic metadata/report order, and updated stdout. Extend operator-script assertions to require all eight names. Retain Beijing Demo smoke as the only non-empty expectation.

- [ ] **Step 2: Verify tests are red**

Run: `backend/.venv/bin/pytest backend/tests/test_map_build.py backend/tests/test_operational_scripts.py -q`

Expected: FAIL because CLI and scripts know five artifacts.

- [ ] **Step 3: Implement artifact wiring and docs**

Call both builders, write all eight ignored files, and record the deterministic combined manifest without changing OSRM provenance behavior. Update smoke/demo loops and docs for label artifacts, font requirement, collision/navigation hierarchy, and scope boundaries.

- [ ] **Step 4: Verify tests are green**

Run: `backend/.venv/bin/pytest backend/tests/test_map_build.py backend/tests/test_operational_scripts.py backend/tests/test_repository_hygiene.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build_tiles.sh backend/tests/test_map_build.py backend/tests/test_operational_scripts.py scripts/smoke_test.sh scripts/demo.sh docs/data-build.md ARCHITECTURE.md
git commit -m "feat(map): 扩展离线标签构建产物"
```

### Task 4: Local-font MapLibre label layers and navigation precedence

**Files:**
- Modify: `frontend/src/map-style.ts`
- Modify: `frontend/src/main.ts`
- Modify: `frontend/src/__tests__/map-style.test.ts`
- Modify: `frontend/src/__tests__/map-controller.test.ts`

**Interfaces:**
- Consumes: Task 2 source ids `road-labels`, `place-labels`, and `poi`.
- Produces: label tokens, local text-font stack, and base registration ending with P5 POI layers.

- [ ] **Step 1: Write failing frontend tests**

Assert eight source registrations and ordered P1–P5 label layers. Assert major roads use `symbol-placement: line`; every label layer has collision flags false, local font fallback, minzoom band 11/13/15/16/17, and lower-number-first priority sort-key. Assert map options set `localIdeographFontFamily` while style omits `glyphs`. Seed final POI layer in controller test and assert route/passed/vehicle append after it unchanged.

- [ ] **Step 2: Verify tests are red**

Run: `cd frontend && npm test -- --run src/__tests__/map-style.test.ts src/__tests__/map-controller.test.ts`

Expected: FAIL because label sources/layers and local ideograph options do not exist.

- [ ] **Step 3: Implement frontend label registration**

Extend concurrent source loading and source-name type, allowing empty FeatureCollections. Add muted text/halo tokens and native symbol/circle layers in P1–P5 order. Set local CJK fallback in map construction, omit glyphs/sprites/icons, and retain `registerBaseMap()` before `MapController` construction without altering navigation logic.

- [ ] **Step 4: Verify tests and build are green**

Run: `cd frontend && npm test -- --run src/__tests__/map-style.test.ts src/__tests__/map-controller.test.ts`

Run: `cd frontend && npm run build`

Expected: PASS; report existing bundle advisory separately.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/map-style.ts frontend/src/main.ts frontend/src/__tests__/map-style.test.ts frontend/src/__tests__/map-controller.test.ts
git commit -m "feat(map): 增加离线道路地点与 POI 标签图层"
```

### Task 5: Full validation, browser inspection, and Label Merge Review

**Files:**
- Modify only for a scoped defect discovered by verification.

- [ ] **Step 1: Build ignored artifacts**

Run: `./scripts/build_tiles.sh data/raw/map.osm`

Expected: eight files and only genuine deterministic relation/anchor reports.

- [ ] **Step 2: Run all automated validation**

Run each command and require exit 0:

```bash
backend/.venv/bin/pytest backend/tests -q
cd frontend && npm test -- --run
cd frontend && npm run build
docker compose config --quiet
bash scripts/smoke_test.sh
```

- [ ] **Step 3: Verify browser behavior offline**

Inspect no-route, active route, replay, low/high zoom density, dense POI area, Chinese `name:zh`, collision restraint, and navigation-over-label visibility. Verify browser network/console has no external map, glyph, font, icon, or API request.

- [ ] **Step 4: Run Label Merge Review**

Review final diff, generated sizes, metadata ordering, priority direction, entity suppression, anchor safety, source/layer leaks, collision settings, coordinate order, external-dependency absence, and Phase 1 regression. Record deferred improvements separately; do not merge.

- [ ] **Step 5: Commit only an evidence-driven fix**

If validation exposes a scoped defect, first add a failing regression test, make the minimal fix, rerun all Task 5 checks, and commit with an accurate Chinese `fix(map): ...` message. Do not create an empty commit.

## Plan self-review

- Spec coverage: Tasks 1–2 cover naming, anchors, schemas, deduplication, and priority; Tasks 3–4 cover artifacts, local fonts, collision, zoom, and hierarchy; Task 5 covers browser and merge review.
- Type consistency: Task 1 feeds Task 2; Task 2 keys feed Tasks 3–4; the lower-number-is-higher-priority rule is preserved from build through rendering.
- Review focus: every listed failure mode has a task and named test step.
- Scope: no excluded service, dependency, or navigation/backend interface appears in an implementation task.
