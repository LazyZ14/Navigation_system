import importlib.machinery
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path


SCRIPTS = Path(__file__).parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))
LOADER = importlib.machinery.SourceFileLoader("build_tiles", str(SCRIPTS / "build_tiles.sh"))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
assert SPEC is not None
build_tiles = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(build_tiles)


def write_osm(path: Path) -> None:
    path.write_text(
        """<osm>
  <node id="1" lat="0" lon="0"/><node id="2" lat="0" lon="4"/>
  <node id="3" lat="4" lon="4"/><node id="4" lat="4" lon="0"/>
  <node id="5" lat="1" lon="1"/><node id="6" lat="1" lon="2"/>
  <node id="7" lat="2" lon="2"/><node id="8" lat="2" lon="1"/>
  <node id="9" lat="5" lon="5"/><node id="10" lat="5" lon="6"/>
  <node id="11" lat="6" lon="6"/><node id="12" lat="6" lon="5"/>
  <node id="13" lat="7" lon="7"/><node id="14" lat="7" lon="8"/>
  <node id="15" lat="8" lon="8"/><node id="16" lat="8" lon="7"/>
  <node id="17" lat="10" lon="10"/><node id="18" lat="10" lon="11"/>
  <node id="19" lat="11" lon="11"/><node id="20" lat="11" lon="10"/>
  <node id="100" lat="20" lon="20"/><node id="101" lat="20" lon="21"/>
  <node id="102" lat="21" lon="21"/><node id="999" lat="21" lon="21"/>
  <node id="103" lat="21" lon="20"/>
  <node id="200" lat="30" lon="30"/><node id="201" lat="30" lon="31"/>
  <node id="202" lat="31" lon="31"/><node id="203" lat="31" lon="30"/>
  <way id="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="name" v="Demo Road"/></way>
  <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="natural" v="water"/></way>
  <way id="11"><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="natural" v="water"/></way>
  <way id="12"><nd ref="5"/><nd ref="6"/><nd ref="7"/><nd ref="8"/><nd ref="5"/><tag k="natural" v="water"/></way>
  <way id="20"><nd ref="9"/><nd ref="10"/><nd ref="11"/><nd ref="12"/><nd ref="9"/><tag k="leisure" v="park"/></way>
  <way id="21"><nd ref="13"/><nd ref="14"/><nd ref="15"/><nd ref="16"/><nd ref="13"/><tag k="leisure" v="park"/></way>
  <way id="30"><nd ref="17"/><nd ref="18"/><nd ref="19"/><nd ref="20"/><nd ref="17"/><tag k="building" v="yes"/></way>
  <way id="40"><nd ref="100"/><nd ref="101"/><nd ref="102"/><tag k="natural" v="water"/></way>
  <way id="41"><nd ref="999"/><nd ref="103"/><nd ref="100"/><tag k="natural" v="water"/></way>
  <way id="50"><nd ref="200"/><nd ref="201"/><nd ref="202"/><nd ref="203"/><nd ref="200"/><tag k="natural" v="water"/></way>
  <relation id="100"><member type="way" ref="10" role="outer"/><member type="way" ref="11" role="outer"/><member type="way" ref="12" role="inner"/><tag k="type" v="multipolygon"/><tag k="natural" v="water"/></relation>
  <relation id="200"><member type="way" ref="20" role="outer"/><member type="way" ref="21" role="outer"/><tag k="type" v="multipolygon"/><tag k="leisure" v="park"/></relation>
  <relation id="300"><member type="way" ref="40" role="outer"/><member type="way" ref="41" role="outer"/><tag k="type" v="multipolygon"/><tag k="natural" v="water"/></relation>
  <relation id="400"><member type="relation" ref="100" role="outer"/><tag k="type" v="multipolygon"/><tag k="natural" v="water"/></relation>
  <relation id="500"><member type="way" ref="50" role="outer"/><member type="way" ref="9999" role="outer"/><tag k="type" v="multipolygon"/><tag k="natural" v="water"/></relation>
</osm>"""
    )


def build_fixture(tmp_path: Path):
    source = tmp_path / "map.osm"
    write_osm(source)
    builder = getattr(build_tiles, "build_feature_collections", None)
    assert builder is not None, "build_feature_collections must extract semantic GeoJSON layers"
    return builder(source)


def test_extracts_roads_with_lon_lat_coordinates_and_minimal_properties(tmp_path: Path):
    layers, _ = build_fixture(tmp_path)

    assert layers["roads"]["features"] == [
        {
            "type": "Feature",
            "properties": {"class": "primary", "name": "Demo Road"},
            "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [4.0, 0.0]]},
        }
    ]


def test_extracts_closed_building_way_as_polygon(tmp_path: Path):
    layers, _ = build_fixture(tmp_path)

    assert layers["buildings"]["features"] == [
        {
            "type": "Feature",
            "properties": {"class": "building"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[10.0, 10.0], [11.0, 10.0], [11.0, 11.0], [10.0, 11.0], [10.0, 10.0]]],
            },
        }
    ]


def test_reconstructs_relation_hole_and_suppresses_member_way_duplicates(tmp_path: Path):
    layers, _ = build_fixture(tmp_path)

    water = layers["water"]["features"]
    assert water == [
        {
            "type": "Feature",
            "properties": {"class": "water"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0], [0.0, 0.0]],
                    [[1.0, 1.0], [2.0, 1.0], [2.0, 2.0], [1.0, 2.0], [1.0, 1.0]],
                ],
            },
        }
    ]


def test_reconstructs_disjoint_relation_outers_as_multipolygon(tmp_path: Path):
    layers, _ = build_fixture(tmp_path)

    assert layers["green"]["features"] == [
        {
            "type": "Feature",
            "properties": {"class": "park"},
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [
                    [[[5.0, 5.0], [6.0, 5.0], [6.0, 6.0], [5.0, 6.0], [5.0, 5.0]]],
                    [[[7.0, 7.0], [8.0, 7.0], [8.0, 8.0], [7.0, 8.0], [7.0, 7.0]]],
                ],
            },
        }
    ]


def test_skips_unclosed_relation_that_only_float_coordinates_could_join(tmp_path: Path):
    layers, reports = build_fixture(tmp_path)

    assert layers["water"]["features"] == [
        {
            "type": "Feature",
            "properties": {"class": "water"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0], [0.0, 0.0]],
                    [[1.0, 1.0], [2.0, 1.0], [2.0, 2.0], [1.0, 2.0], [1.0, 1.0]],
                ],
            },
        }
    ]
    assert reports == [
        "relation 300 skipped: outer members do not form closed rings",
        "relation 400 skipped: nested relation member is unsupported",
        "relation 500 skipped: missing way member 9999",
    ]


def test_suppresses_tagged_member_way_when_its_relation_fails(tmp_path: Path):
    layers, reports = build_fixture(tmp_path)

    assert all(feature["geometry"]["coordinates"][0][0] != [30.0, 30.0] for feature in layers["water"]["features"])
    assert reports[-1] == "relation 500 skipped: missing way member 9999"


def test_suppresses_every_way_member_when_a_missing_member_comes_first(tmp_path: Path):
    source = tmp_path / "map.osm"
    source.write_text(
        """<osm>
  <node id="1" lat="0" lon="0"/><node id="2" lat="0" lon="1"/>
  <node id="3" lat="1" lon="1"/><node id="4" lat="1" lon="0"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="natural" v="water"/></way>
  <relation id="600"><member type="way" ref="9999" role="outer"/><member type="way" ref="10" role="outer"/><tag k="type" v="multipolygon"/><tag k="natural" v="water"/></relation>
</osm>"""
    )

    layers, reports = build_tiles.build_feature_collections(source)

    assert layers["water"]["features"] == []
    assert reports == ["relation 600 skipped: missing way member 9999"]


def test_skips_relation_without_outer_members_and_suppresses_its_inner_way(tmp_path: Path):
    source = tmp_path / "map.osm"
    source.write_text(
        """<osm>
  <node id="1" lat="0" lon="0"/><node id="2" lat="0" lon="1"/>
  <node id="3" lat="1" lon="1"/><node id="4" lat="1" lon="0"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="natural" v="water"/></way>
  <relation id="700"><member type="way" ref="10" role="inner"/><tag k="type" v="multipolygon"/><tag k="natural" v="water"/></relation>
</osm>"""
    )

    layers, reports = build_tiles.build_feature_collections(source)

    assert layers["water"]["features"] == []
    assert reports == ["relation 700 skipped: relation has no outer members"]


def test_cli_writes_all_thematic_files_and_records_deterministic_manifest(tmp_path: Path):
    project = tmp_path / "project"
    scripts = project / "scripts"
    scripts.mkdir(parents=True)
    shutil.copy2(SCRIPTS / "build_tiles.sh", scripts / "build_tiles.sh")
    shutil.copy2(SCRIPTS / "verify_data.py", scripts / "verify_data.py")
    source = project / "data" / "raw" / "map.osm"
    source.parent.mkdir(parents=True)
    write_osm(source)
    generated = project / "frontend" / "public" / "generated"
    generated.mkdir(parents=True)
    (generated / "map-roads.geojson").write_text("legacy artifact")

    result = subprocess.run(
        [sys.executable, str(scripts / "build_tiles.sh"), str(source)],
        check=True,
        capture_output=True,
        text=True,
    )

    assert result.stdout == "wrote 5 thematic GeoJSON files\n"
    assert {path.name for path in generated.iterdir()} == {
        "roads.geojson", "buildings.geojson", "water.geojson", "green.geojson", "landuse.geojson"
    }
    for name in ("roads", "buildings", "water", "green", "landuse"):
        collection = json.loads((generated / f"{name}.geojson").read_text())
        assert collection["type"] == "FeatureCollection"
        assert isinstance(collection["features"], list)
    assert json.loads((generated / "landuse.geojson").read_text())["features"] == []

    metadata = json.loads((project / "data" / "metadata" / "map.osm-maplibre-thematic-geojson-build.json").read_text())
    assert metadata["artifact"] == "maplibre-thematic-geojson"
    assert metadata["output"] == ",".join(
        f"frontend/public/generated/{name}.geojson" for name in ("roads", "buildings", "water", "green", "landuse")
    )


def test_cli_runs_with_the_project_python3_entrypoint(tmp_path: Path):
    project = tmp_path / "project"
    scripts = project / "scripts"
    scripts.mkdir(parents=True)
    shutil.copy2(SCRIPTS / "build_tiles.sh", scripts / "build_tiles.sh")
    shutil.copy2(SCRIPTS / "verify_data.py", scripts / "verify_data.py")
    source = project / "data" / "raw" / "map.osm"
    source.parent.mkdir(parents=True)
    write_osm(source)

    result = subprocess.run(
        [shutil.which("python3") or "python3", str(scripts / "build_tiles.sh"), str(source)],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_select_label_name_prefers_name_zh():
    assert build_tiles.select_label_name({"name:zh": "前门东大街", "name": "Qianmen", "name:en": "Qianmen St"}) == "前门东大街"


def test_select_label_name_falls_back_to_name():
    assert build_tiles.select_label_name({"name": "Demo Road"}) == "Demo Road"


def test_select_label_name_falls_back_to_name_en():
    assert build_tiles.select_label_name({"name:en": "Main Street"}) == "Main Street"


def test_select_label_name_rejects_blank_values():
    assert build_tiles.select_label_name({"name:zh": "  ", "name": "", "name:en": "  "}) is None


def test_select_label_name_returns_none_without_any_name():
    assert build_tiles.select_label_name({"highway": "primary"}) is None


def test_representative_point_of_convex_polygon_uses_widest_interior_span():
    geometry = {
        "type": "Polygon",
        "coordinates": [[[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]]],
    }
    anchor, reason = build_tiles.representative_point(geometry)
    assert anchor is not None
    assert reason is None
    assert build_tiles.point_in_ring(anchor, geometry["coordinates"][0])


def test_representative_point_of_concave_polygon_avoids_exterior_centroid():
    geometry = {
        "type": "Polygon",
        "coordinates": [[[0.0, 0.0], [10.0, 0.0], [10.0, 2.0], [2.0, 2.0], [2.0, 10.0], [0.0, 10.0], [0.0, 0.0]]],
    }
    anchor, reason = build_tiles.representative_point(geometry)
    assert anchor is not None
    assert reason is None
    assert build_tiles.point_in_ring(anchor, geometry["coordinates"][0])


def test_representative_point_of_polygon_with_hole_stays_outside_hole():
    geometry = {
        "type": "Polygon",
        "coordinates": [
            [[0.0, 0.0], [20.0, 0.0], [20.0, 20.0], [0.0, 20.0], [0.0, 0.0]],
            [[8.0, 8.0], [12.0, 8.0], [12.0, 12.0], [8.0, 12.0], [8.0, 8.0]],
        ],
    }
    anchor, reason = build_tiles.representative_point(geometry)
    assert anchor is not None
    assert reason is None
    assert build_tiles.point_in_ring(anchor, geometry["coordinates"][0])
    assert not build_tiles.point_in_ring(anchor, geometry["coordinates"][1])


def test_representative_point_of_multipolygon_uses_widest_component():
    geometry = {
        "type": "MultiPolygon",
        "coordinates": [
            [[[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0], [0.0, 0.0]]],
            [[[5.0, 0.0], [20.0, 0.0], [20.0, 20.0], [5.0, 20.0], [5.0, 0.0]]],
        ],
    }
    anchor, reason = build_tiles.representative_point(geometry)
    assert anchor is not None
    assert reason is None
    inside_count = sum(
        1 for polygon in geometry["coordinates"] if build_tiles.point_in_ring(anchor, polygon[0])
    )
    assert inside_count == 1
    assert not build_tiles._point_in_any_hole(anchor, geometry["coordinates"])


def test_representative_point_of_degenerate_polygon_returns_no_anchor():
    geometry = {"type": "Polygon", "coordinates": [[[0.0, 0.0], [1.0, 0.0], [0.0, 0.0]]]}
    anchor, reason = build_tiles.representative_point(geometry)
    assert anchor is None
    assert reason == "no reliable interior anchor"


def test_representative_point_of_very_narrow_polygon_returns_no_anchor():
    geometry = {
        "type": "Polygon",
        "coordinates": [[[0.0, 0.0], [100.0, 0.0], [100.0, 0.0], [0.0, 0.0]]],
    }
    anchor, reason = build_tiles.representative_point(geometry)
    assert anchor is None
    assert reason == "no reliable interior anchor"
