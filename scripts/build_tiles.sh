#!/usr/bin/env python3
"""Build semantic offline MapLibre GeoJSON layers from OSM XML."""

import argparse
import json
import platform
import shlex
import sys
from pathlib import Path
from xml.etree import ElementTree

from verify_data import write_build_metadata

GeoJsonPosition = tuple[float, float]
ROAD_CLASSES = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "residential", "service",
    "unclassified", "pedestrian", "footway", "cycleway",
}
LAYER_NAMES = ("roads", "buildings", "water", "green", "landuse")


def tags(element: ElementTree.Element) -> dict[str, str]:
    return {tag.attrib["k"]: tag.attrib["v"] for tag in element.findall("tag")}


def semantic_classes(osm_tags: dict[str, str]) -> list[tuple[str, str]]:
    classes: list[tuple[str, str]] = []
    if osm_tags.get("building") is not None:
        classes.append(("buildings", "building"))
    if osm_tags.get("natural") in {"water", "bay"}:
        classes.append(("water", "water"))
    if osm_tags.get("waterway") is not None:
        classes.append(("water", "waterway"))
    if osm_tags.get("landuse") == "forest" or osm_tags.get("natural") == "wood":
        classes.append(("green", "forest"))
    elif osm_tags.get("landuse") in {"grass", "meadow"}:
        classes.append(("green", "grass"))
    elif osm_tags.get("leisure") in {"park", "garden", "pitch"}:
        classes.append(("green", "park"))
    landuse_class = osm_tags.get("landuse")
    if landuse_class in {"commercial", "industrial", "residential", "construction"}:
        classes.append(("landuse", landuse_class))
    elif osm_tags.get("amenity") == "parking":
        classes.append(("landuse", "parking"))
    return classes


def feature(geometry_type: str, coordinates: list[object], properties: dict[str, str]) -> dict[str, object]:
    return {"type": "Feature", "properties": properties, "geometry": {"type": geometry_type, "coordinates": coordinates}}


def coordinates_for(refs: list[str], nodes: dict[str, GeoJsonPosition]) -> list[list[float]] | None:
    if any(ref not in nodes for ref in refs):
        return None
    return [[nodes[ref][0], nodes[ref][1]] for ref in refs]


def stitch_rings(paths: list[list[str]]) -> tuple[list[list[str]] | None, str | None]:
    rings: list[list[str]] = []
    remaining = [path[:] for path in paths]
    while remaining:
        chain = remaining.pop(0)
        if len(chain) < 2:
            return None, "member has fewer than two node references"
        while chain[0] != chain[-1]:
            candidates: list[tuple[int, bool]] = []
            for index, path in enumerate(remaining):
                if path[0] == chain[-1]:
                    candidates.append((index, False))
                elif path[-1] == chain[-1]:
                    candidates.append((index, True))
            if not candidates:
                return None, "members do not form closed rings"
            if len(candidates) > 1:
                return None, "members form an ambiguous branch"
            index, reverse = candidates[0]
            next_path = remaining.pop(index)
            if reverse:
                next_path.reverse()
            chain.extend(next_path[1:])
        if len(chain) < 4:
            return None, "closed ring has fewer than four node references"
        rings.append(chain)
    return rings, None


def point_in_ring(point: list[float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    for index in range(len(ring) - 1):
        x1, y1 = ring[index]
        x2, y2 = ring[index + 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def multipolygon_geometry(
    relation: ElementTree.Element,
    ways: dict[str, tuple[list[str], dict[str, str]]],
    nodes: dict[str, GeoJsonPosition],
) -> tuple[dict[str, object] | None, list[str], str | None]:
    outer_paths: list[list[str]] = []
    inner_paths: list[list[str]] = []
    member_way_ids: list[str] = []
    for member in relation.findall("member"):
        if member.attrib.get("type") != "way":
            return None, member_way_ids, "nested relation member is unsupported"
        member_id = member.attrib["ref"]
        member_way_ids.append(member_id)
        way = ways.get(member_id)
        if way is None:
            return None, member_way_ids, f"missing way member {member_id}"
        role = member.attrib.get("role", "")
        if role == "outer":
            outer_paths.append(way[0])
        elif role == "inner":
            inner_paths.append(way[0])
        else:
            return None, member_way_ids, f"unsupported member role {role or 'empty'}"

    outer_refs, error = stitch_rings(outer_paths)
    if error is not None:
        return None, member_way_ids, f"outer {error}"
    inner_refs, error = stitch_rings(inner_paths)
    if error is not None:
        return None, member_way_ids, f"inner {error}"
    assert outer_refs is not None and inner_refs is not None
    outer_rings = [coordinates_for(ring, nodes) for ring in outer_refs]
    inner_rings = [coordinates_for(ring, nodes) for ring in inner_refs]
    if any(ring is None for ring in outer_rings + inner_rings):
        return None, member_way_ids, "member references a missing node"
    completed_outers = [ring for ring in outer_rings if ring is not None]
    completed_inners = [ring for ring in inner_rings if ring is not None]
    polygons: list[list[list[list[float]]]] = [[outer] for outer in completed_outers]
    for inner in completed_inners:
        matching_outers = [index for index, outer in enumerate(completed_outers) if point_in_ring(inner[0], outer)]
        if len(matching_outers) != 1:
            return None, member_way_ids, "inner ring cannot be assigned to exactly one outer ring"
        polygons[matching_outers[0]].append(inner)
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}, member_way_ids, None
    return {"type": "MultiPolygon", "coordinates": polygons}, member_way_ids, None


def build_feature_collections(input_path: Path) -> tuple[dict[str, dict[str, object]], list[str]]:
    root = ElementTree.parse(input_path).getroot()
    nodes: dict[str, GeoJsonPosition] = {
        node.attrib["id"]: (float(node.attrib["lon"]), float(node.attrib["lat"]))
        for node in root.findall("node")
    }
    ways = {
        way.attrib["id"]: ([node.attrib["ref"] for node in way.findall("nd")], tags(way))
        for way in root.findall("way")
    }
    layers: dict[str, dict[str, object]] = {name: {"type": "FeatureCollection", "features": []} for name in LAYER_NAMES}
    reports: list[str] = []
    suppressed_way_ids: dict[str, set[str]] = {name: set() for name in LAYER_NAMES}

    for relation in root.findall("relation"):
        relation_tags = tags(relation)
        if relation_tags.get("type") != "multipolygon":
            continue
        classes = [item for item in semantic_classes(relation_tags) if item != ("water", "waterway")]
        if not classes:
            continue
        geometry, member_ids, error = multipolygon_geometry(relation, ways, nodes)
        for category, _ in classes:
            suppressed_way_ids[category].update(member_ids)
        relation_id = relation.attrib["id"]
        if error is not None:
            reports.append(f"relation {relation_id} skipped: {error}")
            continue
        assert geometry is not None
        for category, class_name in classes:
            layers[category]["features"].append(feature(geometry["type"], geometry["coordinates"], {"class": class_name}))

    for way_id, (refs, way_tags) in ways.items():
        road_class = way_tags.get("highway")
        coordinates = coordinates_for(refs, nodes)
        if road_class in ROAD_CLASSES and coordinates is not None and len(coordinates) >= 2:
            layers["roads"]["features"].append(feature("LineString", coordinates, {"class": road_class, "name": way_tags.get("name", "")}))
        for category, class_name in semantic_classes(way_tags):
            if way_id in suppressed_way_ids[category] or coordinates is None:
                continue
            if category == "water" and class_name == "waterway" and len(coordinates) >= 2:
                layers[category]["features"].append(feature("LineString", coordinates, {"class": class_name}))
            elif len(refs) >= 4 and refs[0] == refs[-1]:
                layers[category]["features"].append(feature("Polygon", [coordinates], {"class": class_name}))
    return layers, reports


def write_feature_collections(feature_collections: dict[str, dict[str, object]], output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []
    for name in LAYER_NAMES:
        output = output_dir / f"{name}.geojson"
        output.write_text(json.dumps(feature_collections[name], ensure_ascii=False))
        outputs.append(output)
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    args = parser.parse_args()
    if args.input.suffix != ".osm" or not args.input.is_file():
        parser.error("input must be an existing .osm file")
    project_root = Path(__file__).parents[1]
    layers, reports = build_feature_collections(args.input)
    outputs = write_feature_collections(layers, project_root / "frontend" / "public" / "generated")
    for report in reports:
        print(report, file=sys.stderr)
    write_build_metadata(
        input_path=args.input,
        command=shlex.join(sys.argv),
        artifact="maplibre-thematic-geojson",
        tool_version=f"Python {platform.python_version()} xml.etree.ElementTree",
        output=",".join(str(output.relative_to(project_root)) for output in outputs),
    )
    print(f"wrote {len(outputs)} thematic GeoJSON files")


if __name__ == "__main__":
    main()
