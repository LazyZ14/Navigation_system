# Offline Map Labels and Basic POI Design

## Intent and constraints

Extend the merged offline visual-map baseline with readable road names, selected building/place names, and a deliberately small text-first POI set. The pipeline remains `OSM XML -> ignored GeoJSON -> MapLibre GL JS`. This work does not change OSRM, FastAPI, navigation state, coordinate contracts, raw OSM, replay, or the existing five geometry themes. It adds no runtime dependency, online map, glyph/font service, sprite, icon font, MBTiles/vector tiles, GPS, camera, LLM, OCR, voice, search, recommendation, or route-algorithm change.

Success: Chinese labels render offline in the current macOS browser demo, information density increases only with zoom, and route, vehicle, endpoint markers, and guidance remain visually above labels.

## Stable baseline and audit

The branch starts from merged `main` commit `aa6cd11` as `feature/map-labels-poi`. The real `data/raw/map.osm` is 9.9 MB with 31,635 nodes, 5,952 ways, and 598 relations. Counts below are raw OSM elements, not proposed output features.

| Measure | Count |
| --- | ---: |
| `name` | 2,924 |
| `name:zh` | 1,574 |
| `name:en` | 1,023 |
| highway ways | 2,603 |
| named highway ways | 750 (28.8%) |

Major-road coverage supports progressive labels: trunk 33/33 (100%), primary 136/148 (91.9%), secondary 73/84 (86.9%), tertiary 179/230 (77.8%). Residential is 62/213 (29.1%), unclassified 35/67 (52.2%), service 173/432 (40.0%), pedestrian 15/101 (14.9%), and footway 13/867 (1.5%). Link ways are too poorly named for the first pass: primary_link 3/84, secondary_link 1/13, tertiary_link 14/52, trunk_link 0/100.

Named building elements are 240 ways, 9 relations, and 2 nodes. Across all semantics, 440 named closed ways and 19 named multipolygon relations are candidates for safe anchors. `place=*` has 48 entries: 24 quarters, 10 neighbourhoods, 7 suburbs, 5 squares, plus one hamlet and one plot.

| OSM key | raw | named | first-pass selection |
| --- | ---: | ---: | --- |
| `amenity` | 491 | 318 | restaurant, cafe, fast_food, school, bank, theatre, hospital, fuel, pharmacy, police |
| `shop` | 135 | 95 | supermarket, convenience, mall, bakery, department_store, clothes, books |
| `tourism` | 145 | 115 | hotel, attraction, museum |
| `leisure` | 131 | 39 | park, sports_centre, stadium |
| `office` | 38 | 35 | government only |
| `public_transport` | 906 | 878 | station only; exclude stop_position/platform/stop_area duplicate density |

Unnamed features, toilets, parking, waste baskets, shelters, generic `shop=yes`, artwork, pitches, and other low-value dense tags are excluded from this first pass.

## Architecture decision

Option A, adding names and POI to the five geometry files, has less file count but mixes geometry and label semantics, leaves polygon anchoring uncertain, and complicates a future vector-tile migration. Option C, vector tiles plus sprite/glyph serving, exceeds the current scope.

Choose option B: generate three separate FeatureCollections. It adds small, explicit data duplication but keeps semantic density, label anchors, file size, and rendering layers independently maintainable.

`map-style.ts` remains the centralized source/layer factory; `main.ts` fetches all files concurrently. Existing base geometry contracts stay unchanged.

## Data contracts

Every collection is a valid FeatureCollection and may be empty. Coordinates remain WGS-84 `[lon, lat]`. Build-time naming is `name:zh`, then `name`, then `name:en`; blank names are excluded. Raw OSM tag maps never reach the browser.

### `road-labels.geojson`

Named supported highway ways become LineString features:

```json
{"type":"Feature","properties":{"name":"前门东大街","class":"primary","priority":1},"geometry":{"type":"LineString","coordinates":[[116.4,39.9],[116.401,39.9]]}}
```

Initial classes: trunk, primary, secondary, tertiary, residential, unclassified. Links, service, pedestrian, footway, and cycleway are omitted. Exact duplicate `(name, class, coordinate sequence)` emits once; equal names with different geometry remain separate.

### `place-labels.geojson`

Named point features use only `name`, `class`, and `priority`:

```json
{"type":"Feature","properties":{"name":"示例医院","class":"amenity","priority":2},"geometry":{"type":"Point","coordinates":[116.4,39.9]}}
```

`class` is `building`, `place`, or `amenity`. Sources: named building ways and successfully reconstructed building multipolygons, named `place=*`, and named institutional amenities (school, hospital, theatre). Nodes retain their OSM coordinate.

For polygons, build a deterministic interior representative point rather than using a centroid: choose scanlines through the outer ring, find interior spans, remove spans inside holes, and use the midpoint of the widest remaining span. If no interior span is reliable, skip and report the OSM id. Never create geometry or use a known-outside centroid. Relations reuse existing node-reference-only multipolygon reconstruction and suppress same-semantic member duplicates.

### `poi.geojson`

Named POI features are points with minimal properties:

```json
{"type":"Feature","properties":{"name":"示例餐厅","category":"food","subclass":"restaurant","priority":3},"geometry":{"type":"Point","coordinates":[116.4,39.9]}}
```

Mapping: restaurant/cafe/fast_food → `food`; selected shops → `shop`; fuel/station → `transport`; bank/pharmacy/police → `service`; hotel/attraction/museum → `tourism`; selected leisure and government office → `other`. Polygon POIs use the same safe representative point. Deduplicate normalized output properties plus coordinate, not all raw tags.

Metadata changes to one deterministic offline-map manifest listing the five existing geometry files followed by these three label files. All generated files remain ignored.

## Rendering, collision, and navigation precedence

Layer order after roads is:

1. major road labels (P1: trunk/primary; minzoom 11);
2. secondary/tertiary road labels (P2; minzoom 13);
3. place and important-building labels (P2; minzoom 13 or 15);
4. residential/unclassified labels (P4; minzoom 16);
5. important POI labels (P3; minzoom 15);
6. dense commercial POI labels (P5; minzoom 17);
7. route, vehicle, markers, and guidance.

Road labels use a MapLibre symbol layer with `symbol-placement: line`, map-aligned text, and conservative `symbol-spacing`. All label layers use `text-allow-overlap: false` and `text-ignore-placement: false`, muted slate tokens, text halo, and priority-derived sort keys. Point labels are text-first; a simple category-color circle is optional only if browser inspection demonstrates a readability gain. No sprite or image pipeline is introduced.

`MapController` is created after label registration, retaining its current behavior and ensuring navigation overlays append above labels.

## Offline Chinese fonts

The resolved frontend runtime is `maplibre-gl@5.24.0`. The style must continue to omit a `glyphs` URL; MapLibre then resolves `text-font` locally. Set `localIdeographFontFamily` to a macOS-first CSS fallback such as `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`, plus local `text-font` fallbacks. This locally generates CJK ideographs without a glyph-server request.

This satisfies the required current macOS browser demo. It is an explicit environment contract: a future target browser without a CJK system font needs a separately approved bundled local font/glyph strategy. Browser verification must treat missing Chinese glyphs or any external map/glyph/font/icon request as a release blocker.

References: [MapLibre local ideographs](https://maplibre.org/maplibre-gl-js/docs/examples/use-locally-generated-ideographs/) and [glyph behavior](https://maplibre.org/maplibre-style-spec/glyphs/).

## TDD and verification

Build tests precede implementation: name precedence/fallback, named-road extraction, no-name exclusion, POI category mapping, minimal properties, lon/lat order, safe polygon anchors, relation deduplication, exact duplicate suppression, empty label collections, deterministic skips, and ordered artifact manifests.

Frontend tests precede layers: all three sources, road `symbol-placement: line`, zoom bands, collision flags, label ordering, POI registration, and current route/vehicle precedence. Final verification rebuilds ignored artifacts, runs full backend/frontend tests and builds, Compose/smoke, and browser checks for no-route, active route, replay, dense POI, zoom levels, Chinese text, collisions, navigation visibility, and absent external dependencies.

## Out of scope

GPS, camera, LLM, OCR, voice, search, POI recommendation, online geocoding, online maps/Mapbox, MBTiles/vector tiles, vector-tile server, full icon/sprite system, railway rendering, and route algorithm changes remain out of scope.
