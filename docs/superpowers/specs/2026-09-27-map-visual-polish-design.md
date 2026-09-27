# Offline Map Visual Polish Design

## Goal

Upgrade the Phase 1 MapLibre base map from a roads-only GeoJSON view to a
navigation-first offline map with roads, buildings, water, green space, and
selected land-use. Preserve OSRM routing, FastAPI navigation coordination,
WGS-84 coordinate contracts, replay behavior, and offline operation.

## Scope and constraints

- Work on `feature/map-visual-polish`; leave `main` and `v0.1.0` unchanged.
- Keep the build-time pipeline `OSM XML -> GeoJSON -> MapLibre GL JS`.
- Do not add POI, railway, online maps, sprites, remote fonts, MBTiles, vector
  tiles, GPS, camera, OCR, LLM, or voice features.
- Do not add prettymaps or prettymapp as a dependency and do not copy their
  implementation or presets.
- Generated GeoJSON remains ignored by Git. Raw OSM remains unchanged.
- Do not change backend, OSRM, routing, navigation state, or coordinate models.

## Build-time data model

`scripts/build_tiles.sh` remains the command entry point and uses only the
Python standard library. It writes five valid GeoJSON FeatureCollections:

| File | Geometry | Minimal properties | Inclusion |
| --- | --- | --- | --- |
| `roads.geojson` | LineString | `class`, `name` | Required highway classes |
| `buildings.geojson` | Polygon, MultiPolygon | `class: "building"` | `building=*` |
| `water.geojson` | Polygon, MultiPolygon, LineString | `class: "water" | "waterway"` | `natural=water|bay`, `waterway=*` |
| `green.geojson` | Polygon, MultiPolygon | `class: "park" | "forest" | "grass"` | selected forest, grass, meadow, wood, park, garden, pitch tags |
| `landuse.geojson` | Polygon, MultiPolygon | `class` | commercial, industrial, residential, construction, parking |

All coordinates are emitted as GeoJSON `[lon, lat]`. Every category is written
even when empty. OSM tags are reduced to the listed stable properties.

## Multipolygon correctness

The parser indexes nodes and ways, then reconstructs only direct `way` members
of `type=multipolygon` relations. It joins members only when their OSM node
reference ids match exactly, never by comparing longitude/latitude floating
point values. It preserves member role:

- closed `outer` rings become polygon exteriors;
- closed `inner` rings become holes assigned to their containing exterior;
- multiple exteriors produce MultiPolygon;
- a relation with a missing node/way, unclosed chain, ambiguous ring, or inner
  ring that cannot be assigned to one exterior is skipped in full and reported
  to stderr with its relation id and reason.

The implementation must not bridge gaps, infer missing segments, reorder an
ambiguous branch, or emit a partially reconstructed relation. A nested relation
member is unsupported in this small standard-library preprocessing pipeline and
causes the affected relation to be skipped and reported. Closed tagged ways are
emitted independently only when they are not members of a relevant target
relation for that same semantic category.

On a successful target relation, all of its direct member ways are recorded as
consumed for the relation's semantic category and are not emitted again as
standalone polygons for that category. This avoids relation/member overlap. If
a relevant target relation fails reconstruction, all of its relevant direct way
members are suppressed from standalone output for that category too: there is
no tagged-way fallback. The deliberate loss of an uncertain feature is safer
than emitting a partial outer ring, filling a hole, or overlapping a malformed
relation. Both successful de-duplication and failed-relation suppression are
covered by tests.

## Frontend visual architecture

`frontend/src/map-style.ts` owns visual tokens, class group definitions,
zoom-interpolated road-width expressions, and base-map layer definitions. It
does not own navigation state or route geometry.

`main.ts` loads the five local GeoJSON files, registers static sources, and
adds the returned base-map layers. `MapController` continues to own runtime
route, passed-route, and vehicle sources/layers. Its behavior and coordinate
conversion remain unchanged except for consuming shared navigation visual
tokens.

Layer order is fixed:

```text
background
landuse -> green -> water -> buildings
local-road-casing -> local-road-surface
arterial-road-casing -> arterial-road-surface
route-casing -> route-passed -> route-active
vehicle
DOM start / destination markers
```

## Visual tokens

- Background: `#F4F6F8`, no texture.
- Buildings: fill `#D9E0E7`, outline `#C4CDD6`.
- Water: muted blue `#B9DDF2`; green classes are muted and differentiated as
  park, forest, and grass; land-use uses weaker contrast than any road.
- Roads use pale surfaces and fine gray casings. The local/arterial grouping
  reduces layer count, while a MapLibre `interpolate` expression maps every
  supported highway class to its own width.
- Around zoom 15, width targets are approximately: trunk 12, primary 10,
  secondary 8, tertiary 6, residential 4, service 3, and footway 2 pixels.
  Link classes inherit their parent class; motorway and trunk are distinct
  values where both are present.
- Route casing remains dark indigo and is 3--4 pixels wider than active route.
  Active route is the highest-salience line. Passed route is desaturated
  blue-gray. Vehicle is dark blue/cyan with a white halo; its heading logic is
  unchanged. Start and destination retain green/red DOM markers.

## Verification

Tests are written first and must prove:

- all five GeoJSON files, valid coordinates, minimal properties, empty
  categories, and required road classes;
- Polygon and MultiPolygon relation handling, holes, and malformed-relation
  skip/report behavior;
- static source registration and exact base-map layer order;
- class-specific zoom width expressions inside grouped road layers;
- navigation layers are above base map and existing route/vehicle behavior is
  unchanged.

Final validation includes backend tests, frontend tests/build, Docker config,
smoke test, browser visual checks while offline, and a Map Visual Merge Review.

## Future enhancement (out of scope)

Only after this work is stable: vector tiles/MBTiles, labels, POI, railway,
sprite patterns, and further zoom-generalization.
