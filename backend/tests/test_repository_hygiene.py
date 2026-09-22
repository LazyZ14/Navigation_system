from pathlib import Path


def test_large_and_regenerated_map_artifacts_are_ignored():
    ignored = Path(__file__).parents[2] / ".gitignore"
    text = ignored.read_text()
    for pattern in ("data/raw/*", "data/osrm/*", "data/tiles/*", "*.osrm*", "*.mbtiles"):
        assert pattern in text
