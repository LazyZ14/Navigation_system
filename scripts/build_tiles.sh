#!/usr/bin/env python3
"""Build the small experiment area's offline road base map from OSM XML."""

import argparse
import json
import platform
import shlex
import sys
from pathlib import Path
from xml.etree import ElementTree

from verify_data import write_build_metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    args = parser.parse_args()
    if args.input.suffix != ".osm" or not args.input.is_file():
        parser.error("input must be an existing .osm file")

    root = ElementTree.parse(args.input).getroot()
    nodes = {
        node.attrib["id"]: [float(node.attrib["lon"]), float(node.attrib["lat"])]
        for node in root.findall("node")
    }
    features = []
    for way in root.findall("way"):
        tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
        road_class = tags.get("highway")
        if road_class is None:
            continue
        coordinates = [nodes[nd.attrib["ref"]] for nd in way.findall("nd") if nd.attrib["ref"] in nodes]
        if len(coordinates) < 2:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"class": road_class, "name": tags.get("name", "")},
                "geometry": {"type": "LineString", "coordinates": coordinates},
            }
        )

    project_root = Path(__file__).parents[1]
    output = project_root / "frontend" / "public" / "generated" / "map-roads.geojson"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False))
    write_build_metadata(
        input_path=args.input,
        command=shlex.join(sys.argv),
        artifact="maplibre-road-geojson",
        tool_version=f"Python {platform.python_version()} xml.etree.ElementTree",
        output=str(output.relative_to(project_root)),
    )
    print("wrote {} road features to {}".format(len(features), output))


if __name__ == "__main__":
    main()
