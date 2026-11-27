import subprocess
from pathlib import Path


def test_large_and_regenerated_map_artifacts_are_ignored():
    ignored = Path(__file__).parents[2] / ".gitignore"
    text = ignored.read_text()
    for pattern in ("data/raw/*", "data/osrm/*", "data/tiles/*", "*.osrm*", "*.mbtiles"):
        assert pattern in text


def test_xcode_xcuserdata_in_nested_project_is_gitignored():
    repo_root = Path(__file__).parents[2]
    nested_state = "ios/GpsSender/GpsSender.xcodeproj/xcuserdata/test.xcuserdatad/xcschemes/xcschememanagement.plist"
    result = subprocess.run(
        ["git", "check-ignore", "-q", nested_state],
        cwd=repo_root,
        check=False,
    )
    assert result.returncode == 0
