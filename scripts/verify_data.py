#!/usr/bin/env python3
"""Record reproducibility metadata for an OSM build input."""

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional
from xml.etree import ElementTree


def osm_bounds(path: Path) -> Optional[Dict[str, float]]:
    if path.suffix != ".osm":
        return None
    root = ElementTree.parse(path).getroot()
    bounds = root.find("bounds")
    if bounds is None:
        return None
    return {key: float(bounds.attrib[key]) for key in ("minlat", "minlon", "maxlat", "maxlon")}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--command", required=True)
    args = parser.parse_args()
    content = args.input.read_bytes()
    metadata = {
        "input_filename": args.input.name,
        "sha256": hashlib.sha256(content).hexdigest(),
        "bounds": osm_bounds(args.input),
        "built_at_utc": datetime.now(timezone.utc).isoformat(),
        "command": args.command,
    }
    output_dir = Path(__file__).parents[1] / "data" / "metadata"
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / f"{args.input.name}-build.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n"
    )


if __name__ == "__main__":
    main()
