import subprocess
import re
from pathlib import Path

import pytest


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


@pytest.mark.parametrize('path', [
    'frontend/.env.local', 'backend/.env.production', '.env.gps.local',
    'nested/.env.staging', 'data/tracks/drive.jsonl', 'exports/GPS_Recordings/drive.jsonl',
    'exports/drive.gpx', 'exports/drive.kml', 'secrets/private.pem', 'nested/private.key',
    'ios/signing.p12', 'ios/app.mobileprovision', 'credentials/service-account.json',
])
def test_private_files_cannot_be_accidentally_added(path):
    result = subprocess.run(['git', 'check-ignore', '--no-index', '-q', path],
                            cwd=Path(__file__).parents[2], check=False)
    assert result.returncode == 0, path


@pytest.mark.parametrize('path', ['frontend/.env.example', 'backend/.env.production.example'])
def test_blank_environment_examples_remain_trackable(path):
    result = subprocess.run(['git', 'check-ignore', '--no-index', '-q', path],
                            cwd=Path(__file__).parents[2], check=False)
    assert result.returncode == 1, path


def test_tracked_files_do_not_embed_recognizable_credentials():
    root = Path(__file__).parents[2]
    patterns = [
        re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
        re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})'),
        re.compile(rb'(?:AKIA|ASIA)[A-Z0-9]{16}|AKID[A-Za-z0-9]{20,}'),
        re.compile(rb'(?:VITE_AMAP_(?:KEY|SECURITY_KEY|SECURITY_CODE)|securityJsCode|DEFAULT_AMAP_(?:KEY|SECURITY_KEY))\s*[:=]\s*[\x27\x22]?[a-fA-F0-9]{32}'),
    ]
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    for name in filter(None, paths):
        path = root / name
        if path.is_file():
            content = path.read_bytes()
            assert not any(pattern.search(content) for pattern in patterns), f'Possible credential in {name}; value redacted'
