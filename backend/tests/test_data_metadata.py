import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2] / "scripts"))

from verify_data import write_build_metadata  # noqa: E402


def test_build_metadata_records_artifact_tool_output_and_input_provenance(tmp_path: Path):
    source = tmp_path / "map.osm"
    source.write_text(
        '<osm><bounds minlat="39.8" minlon="116.3" maxlat="39.9" maxlon="116.4"/></osm>'
    )

    metadata_path = write_build_metadata(
        input_path=source,
        command="scripts/build_tiles.sh data/raw/map.osm",
        artifact="maplibre-road-geojson",
        tool_version="Python 3.12",
        output="frontend/public/generated/map-roads.geojson",
        output_dir=tmp_path / "metadata",
    )

    metadata = json.loads(metadata_path.read_text())
    assert metadata["artifact"] == "maplibre-road-geojson"
    assert metadata["tool_version"] == "Python 3.12"
    assert metadata["output"] == "frontend/public/generated/map-roads.geojson"
    assert metadata["sha256"]
    assert metadata["bounds"] == {"minlat": 39.8, "minlon": 116.3, "maxlat": 39.9, "maxlon": 116.4}
    assert metadata["built_at_utc"]
