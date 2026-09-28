from pathlib import Path


def test_local_operational_scripts_check_all_thematic_map_artifacts():
    project_root = Path(__file__).parents[2]
    expected = {
        "roads", "buildings", "water", "green", "landuse",
        "road-labels", "place-labels", "poi",
    }

    for script_name in ("smoke_test.sh", "demo.sh"):
        script = (project_root / "scripts" / script_name).read_text()
        assert expected <= {name for name in expected if name in script}
        assert "map-roads.geojson" not in script
