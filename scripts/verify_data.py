#!/usr/bin/env python3
"""Record reproducibility metadata for an OSM build input."""

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree


def osm_bounds(path: Path) -> dict[str, float] | None:
    if path.suffix != ".osm":
        return None
    root = ElementTree.parse(path).getroot()
    bounds = root.find("bounds")
    if bounds is None:
        return None
    return {key: float(bounds.attrib[key]) for key in ("minlat", "minlon", "maxlat", "maxlon")}


def write_build_metadata(
    *,
    input_path: Path,
    command: str,
    artifact: str,
    tool_version: str,
    output: str,
    output_dir: Path | None = None,
) -> Path:
    content = input_path.read_bytes()
    metadata = {
        "artifact": artifact,
        "input_filename": input_path.name,
        "sha256": hashlib.sha256(content).hexdigest(),
        "bounds": osm_bounds(input_path),
        "built_at_utc": datetime.now(timezone.utc).isoformat(),
        "command": command,
        "tool_version": tool_version,
        "output": output,
    }
    destination = output_dir or Path(__file__).parents[1] / "data" / "metadata"
    destination.mkdir(parents=True, exist_ok=True)
    metadata_path = destination / f"{input_path.name}-{artifact}-build.json"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    return metadata_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--command", required=True)
    parser.add_argument("--artifact", required=True)
    parser.add_argument("--tool-version", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    write_build_metadata(
        input_path=args.input,
        command=args.command,
        artifact=args.artifact,
        tool_version=args.tool_version,
        output=args.output,
    )


if __name__ == "__main__":
    main()
