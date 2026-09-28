#!/usr/bin/env python3
"""Build semantic offline MapLibre GeoJSON layers from OSM XML."""

from __future__ import annotations

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


def select_label_name(osm_tags: dict[str, str]) -> str | None:
    for key in ("name:zh", "name", "name:en"):
        value = osm_tags.get(key, "").strip()
        if value:
            return value
    return None


def _point_in_any_outer(point: list[float], multipoly_coords: list[list[list[list[float]]]]) -> bool:
    return any(point_in_ring(point, polygon[0]) for polygon in multipoly_coords)


def _point_in_any_hole(point: list[float], multipoly_coords: list[list[list[list[float]]]]) -> bool:
    return any(
        point_in_ring(point, ring)
        for polygon in multipoly_coords
        for ring in polygon[1:]
    )


def _span_contains(span_start: float, span_end: float, holes_on_line: list[tuple[float, float]]) -> bool:
    span_width = span_end - span_start
    if span_width <= 0:
        return False
    for hole_start, hole_end in holes_on_line:
        if hole_start <= span_start and span_end <= hole_end:
            return False
    return True


def _subtract_holes(span_start: float, span_end: float, holes_on_line: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if span_end - span_start <= 0:
        return []
    sorted_holes = sorted(holes_on_line, key=lambda h: (h[0], h[1]))
    result: list[tuple[float, float]] = []
    cursor = span_start
    for hole_start, hole_end in sorted_holes:
        if hole_end <= cursor:
            continue
        if hole_start > cursor:
            result.append((cursor, min(hole_start, span_end)))
        cursor = max(cursor, hole_end)
        if cursor >= span_end:
            break
    if cursor < span_end:
        result.append((cursor, span_end))
    return result


def _polygon_anchor(ring: list[list[float]], holes: list[list[float]]) -> tuple[list[float] | None, float, str | None]:
    if len(ring) < 4:
        return None, 0.0, "no reliable interior anchor"
    ys = sorted({coord[1] for coord in ring})
    if len(ys) < 2:
        return None, 0.0, "no reliable interior anchor"
    scan_ys: list[float] = []
    for index in range(len(ys) - 1):
        scan_ys.append((ys[index] + ys[index + 1]) / 2.0)
    best_anchor: list[float] | None = None
    best_width = 0.0
    for scan_y in scan_ys:
        xs: list[float] = []
        for index in range(len(ring) - 1):
            x1, y1 = ring[index]
            x2, y2 = ring[index + 1]
            if (y1 > scan_y) != (y2 > scan_y):
                x = x1 + (scan_y - y1) * (x2 - x1) / (y2 - y1)
                xs.append(x)
        if len(xs) < 2 or len(xs) % 2 != 0:
            continue
        xs_sorted = sorted(xs)
        for span_index in range(0, len(xs_sorted), 2):
            span_start = xs_sorted[span_index]
            span_end = xs_sorted[span_index + 1]
            hole_spans: list[tuple[float, float]] = []
            for hole in holes:
                hole_xs: list[float] = []
                for hole_index in range(len(hole) - 1):
                    hx1, hy1 = hole[hole_index]
                    hx2, hy2 = hole[hole_index + 1]
                    if (hy1 > scan_y) != (hy2 > scan_y):
                        hole_x = hx1 + (scan_y - hy1) * (hx2 - hx1) / (hy2 - hy1)
                        hole_xs.append(hole_x)
                if len(hole_xs) >= 2 and len(hole_xs) % 2 == 0:
                    hole_xs_sorted = sorted(hole_xs)
                    for hole_span_index in range(0, len(hole_xs_sorted), 2):
                        hole_spans.append((hole_xs_sorted[hole_span_index], hole_xs_sorted[hole_span_index + 1]))
            valid_spans = _subtract_holes(span_start, span_end, hole_spans)
            for valid_start, valid_end in valid_spans:
                width = valid_end - valid_start
                if width <= 0:
                    continue
                candidate = [(valid_start + valid_end) / 2.0, scan_y]
                if (best_anchor is None or width > best_width
                        or (width == best_width
                            and best_anchor is not None
                            and (candidate[1] < best_anchor[1]
                                 or (candidate[1] == best_anchor[1] and candidate[0] < best_anchor[0])))):
                    best_anchor = candidate
                    best_width = width
    if best_anchor is None:
        return None, 0.0, "no reliable interior anchor"
    return best_anchor, best_width, None


def representative_point(geometry: dict[str, object]) -> tuple[list[float] | None, str | None]:
    geom_type = geometry.get("type")
    if geom_type == "Polygon":
        coordinates = geometry["coordinates"]
        outer = coordinates[0]
        holes = list(coordinates[1:])
        anchor, _, reason = _polygon_anchor(outer, holes)
        return anchor, reason
    if geom_type == "MultiPolygon":
        coordinates = geometry["coordinates"]
        best_anchor: list[float] | None = None
        best_width = 0.0
        for polygon in coordinates:
            outer = polygon[0]
            holes = list(polygon[1:])
            anchor, width, reason = _polygon_anchor(outer, holes)
            if anchor is None:
                continue
            if (best_anchor is None or width > best_width
                    or (width == best_width
                        and best_anchor is not None
                        and (anchor[1] < best_anchor[1]
                             or (anchor[1] == best_anchor[1] and anchor[0] < best_anchor[0])))):
                best_anchor = anchor
                best_width = width
        if best_anchor is None:
            return None, "no reliable interior anchor"
        return best_anchor, None
    return None, "no reliable interior anchor"


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

    if not outer_paths:
        return None, member_way_ids, "relation has no outer members"
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
        candidate_member_ids = [member.attrib["ref"] for member in relation.findall("member") if member.attrib.get("type") == "way"]
        geometry, _, error = multipolygon_geometry(relation, ways, nodes)
        for category, _ in classes:
            suppressed_way_ids[category].update(candidate_member_ids)
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


LABEL_ROAD_CLASSES = {"trunk", "primary", "secondary", "tertiary", "residential", "unclassified"}
ROAD_PRIORITY = {"trunk": 1, "primary": 1, "secondary": 2, "tertiary": 2, "residential": 4, "unclassified": 4}
INSTITUTIONAL_AMENITIES = {"school", "hospital", "theatre"}
POI_MAPPING: dict[str, dict[str, tuple[str, int]]] = {
    "amenity": {
        "restaurant": ("food", 3),
        "cafe": ("food", 3),
        "fast_food": ("food", 3),
        "fuel": ("transport", 3),
        "bank": ("service", 3),
        "pharmacy": ("service", 3),
        "police": ("service", 3),
    },
    "shop": {
        "supermarket": ("shop", 3),
        "convenience": ("shop", 5),
        "mall": ("shop", 3),
        "bakery": ("shop", 5),
        "department_store": ("shop", 3),
        "clothes": ("shop", 5),
        "books": ("shop", 5),
    },
    "tourism": {
        "hotel": ("tourism", 3),
        "attraction": ("tourism", 3),
        "museum": ("tourism", 3),
    },
    "leisure": {
        "park": ("other", 3),
        "sports_centre": ("other", 3),
        "stadium": ("other", 3),
    },
    "office": {
        "government": ("other", 3),
    },
    "public_transport": {
        "station": ("transport", 3),
    },
}
LABEL_LAYER_NAMES = ("road-labels", "place-labels", "poi")


def _road_label_feature(coordinates: list[list[float]], road_class: str, name: str) -> dict[str, object]:
    return feature("LineString", coordinates, {"name": name, "class": road_class, "priority": ROAD_PRIORITY[road_class]})


def _place_label_point(coordinates: list[float], class_name: str, name: str) -> dict[str, object]:
    return feature("Point", coordinates, {"name": name, "class": class_name, "priority": 2})


def _poi_feature(coordinates: list[float], category: str, subclass: str, priority: int) -> dict[str, object]:
    return feature("Point", coordinates, {"name": "", "category": category, "subclass": subclass, "priority": priority})


def _poi_identity(name: str, category: str, subclass: str, coordinates: tuple[float, float]) -> tuple[str, str, str, float, float]:
    return (name, category, subclass, coordinates[0], coordinates[1])


def build_label_feature_collections(input_path: Path) -> tuple[dict[str, dict[str, object]], list[str]]:
    root = ElementTree.parse(input_path).getroot()
    nodes: dict[str, GeoJsonPosition] = {
        node.attrib["id"]: (float(node.attrib["lon"]), float(node.attrib["lat"]))
        for node in root.findall("node")
    }
    ways = {
        way.attrib["id"]: ([node.attrib["ref"] for node in way.findall("nd")], tags(way))
        for way in root.findall("way")
    }
    labels: dict[str, dict[str, object]] = {name: {"type": "FeatureCollection", "features": []} for name in LABEL_LAYER_NAMES}
    reports: list[str] = []
    suppressed_way_ids: set[str] = set()
    institutional_entities: set[tuple[str, str]] = set()
    seen_road_labels: set[tuple[str, str, tuple[tuple[float, float], ...]]] = set()
    seen_places: set[tuple[str, str, float, float]] = set()
    seen_pois: set[tuple[str, str, str, float, float]] = set()

    for relation in root.findall("relation"):
        relation_tags = tags(relation_tags_dict := tags(relation))
        if relation_tags.get("type") != "multipolygon":
            continue
        relation_id = relation.attrib["id"]
        candidate_member_ids = [member.attrib["ref"] for member in relation.findall("member") if member.attrib.get("type") == "way"]
        geometry, _, error = multipolygon_geometry(relation, ways, nodes)
        suppressed_way_ids.update(candidate_member_ids)
        if error is not None:
            continue
        assert geometry is not None
        label_name = select_label_name(relation_tags)
        if label_name is None:
            continue
        building_tag = relation_tags.get("building")
        place_tag = relation_tags.get("place")
        amenity_tag = relation_tags.get("amenity")
        if building_tag is not None:
            identity = ("relation", relation_id)
            if ("place", identity) not in {(p[0], p[1]) for p in []}:
                anchor, reason = representative_point(geometry)
                if anchor is not None:
                    place_key = (label_name, "building", anchor[0], anchor[1])
                    if place_key not in seen_places:
                        seen_places.add(place_key)
                        labels["place-labels"]["features"].append(_place_label_point(anchor, "building", label_name))
                        institutional_entities.add(identity)
            continue
        if place_tag is not None:
            anchor, reason = representative_point(geometry)
            if anchor is not None:
                place_key = (label_name, "place", anchor[0], anchor[1])
                if place_key not in seen_places:
                    seen_places.add(place_key)
                    labels["place-labels"]["features"].append(_place_label_point(anchor, "place", label_name))
            continue
        if amenity_tag in INSTITUTIONAL_AMENITIES:
            anchor, reason = representative_point(geometry)
            if anchor is not None:
                identity = ("relation", relation_id)
                place_key = (label_name, "amenity", anchor[0], anchor[1])
                if place_key not in seen_places:
                    seen_places.add(place_key)
                    labels["place-labels"]["features"].append(_place_label_point(anchor, "amenity", label_name))
                    institutional_entities.add(identity)
            continue
        poi_lookup = POI_MAPPING.get("amenity", {}) if amenity_tag else {}
        if amenity_tag and amenity_tag in poi_lookup:
            subclass = amenity_tag
        else:
            subclass = None
            for key in POI_MAPPING:
                if relation_tags.get(key) in POI_MAPPING[key]:
                    subclass = relation_tags[key]
                    poi_lookup = POI_MAPPING[key]
                    break
        if subclass and subclass in poi_lookup:
            category, priority = poi_lookup[subclass]
            anchor, reason = representative_point(geometry)
            if anchor is not None:
                poi_key = _poi_identity(label_name, category, subclass, (anchor[0], anchor[1]))
                if poi_key not in seen_pois:
                    seen_pois.add(poi_key)
                    poi_feature = _poi_feature(anchor, category, subclass, priority)
                    poi_feature["properties"]["name"] = label_name
                    labels["poi"]["features"].append(poi_feature)

    for way_id, (refs, way_tags) in ways.items():
        label_name = select_label_name(way_tags)
        road_class = way_tags.get("highway")
        coordinates = coordinates_for(refs, nodes)
        if road_class in LABEL_ROAD_CLASSES and label_name is not None and coordinates is not None and len(coordinates) >= 2:
            coord_tuple = tuple((c[0], c[1]) for c in coordinates)
            road_key = (label_name, road_class, coord_tuple)
            if road_key not in seen_road_labels:
                seen_road_labels.add(road_key)
                labels["road-labels"]["features"].append(_road_label_feature(coordinates, road_class, label_name))

        if way_id in suppressed_way_ids:
            continue

        building_tag = way_tags.get("building")
        place_tag = way_tags.get("place")
        amenity_tag = way_tags.get("amenity")

        if building_tag is not None and label_name is not None and coordinates is not None and len(refs) >= 4 and refs[0] == refs[-1]:
            geometry = {"type": "Polygon", "coordinates": [coordinates]}
            anchor, reason = representative_point(geometry)
            if anchor is not None:
                place_key = (label_name, "building", anchor[0], anchor[1])
                if place_key not in seen_places:
                    seen_places.add(place_key)
                    labels["place-labels"]["features"].append(_place_label_point(anchor, "building", label_name))
            continue

        if place_tag is not None and label_name is not None and coordinates is not None and len(refs) >= 4 and refs[0] == refs[-1]:
            geometry = {"type": "Polygon", "coordinates": [coordinates]}
            anchor, reason = representative_point(geometry)
            if anchor is not None:
                place_key = (label_name, "place", anchor[0], anchor[1])
                if place_key not in seen_places:
                    seen_places.add(place_key)
                    labels["place-labels"]["features"].append(_place_label_point(anchor, "place", label_name))
            continue

        if amenity_tag in INSTITUTIONAL_AMENITIES and label_name is not None and coordinates is not None and len(refs) >= 4 and refs[0] == refs[-1]:
            geometry = {"type": "Polygon", "coordinates": [coordinates]}
            anchor, reason = representative_point(geometry)
            if anchor is not None:
                identity = ("way", way_id)
                place_key = (label_name, "amenity", anchor[0], anchor[1])
                if place_key not in seen_places:
                    seen_places.add(place_key)
                    labels["place-labels"]["features"].append(_place_label_point(anchor, "amenity", label_name))
                    institutional_entities.add(identity)
            continue

        poi_category = None
        poi_subclass = None
        poi_priority = 3
        for osm_key, subclass_map in POI_MAPPING.items():
            value = way_tags.get(osm_key)
            if value in subclass_map:
                poi_category, poi_priority = subclass_map[value]
                poi_subclass = value
                break
        if poi_category and label_name is not None and coordinates is not None and len(refs) >= 4 and refs[0] == refs[-1]:
            identity = ("way", way_id)
            if identity in institutional_entities:
                continue
            geometry = {"type": "Polygon", "coordinates": [coordinates]}
            anchor, reason = representative_point(geometry)
            if anchor is not None:
                poi_key = _poi_identity(label_name, poi_category, poi_subclass, (anchor[0], anchor[1]))
                if poi_key not in seen_pois:
                    seen_pois.add(poi_key)
                    poi_feature = _poi_feature(anchor, poi_category, poi_subclass, poi_priority)
                    poi_feature["properties"]["name"] = label_name
                    labels["poi"]["features"].append(poi_feature)

    for node in root.findall("node"):
        node_id = node.attrib["id"]
        node_tags = tags(node)
        label_name = select_label_name(node_tags)
        if label_name is None:
            continue
        coordinate = nodes[node_id]
        amenity_tag = node_tags.get("amenity")
        place_tag = node_tags.get("place")
        if amenity_tag in INSTITUTIONAL_AMENITIES:
            identity = ("node", node_id)
            place_key = (label_name, "amenity", coordinate[0], coordinate[1])
            if place_key not in seen_places:
                seen_places.add(place_key)
                labels["place-labels"]["features"].append(_place_label_point(list(coordinate), "amenity", label_name))
                institutional_entities.add(identity)
            continue
        if place_tag is not None:
            place_key = (label_name, "place", coordinate[0], coordinate[1])
            if place_key not in seen_places:
                seen_places.add(place_key)
                labels["place-labels"]["features"].append(_place_label_point(list(coordinate), "place", label_name))
            continue
        poi_category = None
        poi_subclass = None
        poi_priority = 3
        for osm_key, subclass_map in POI_MAPPING.items():
            value = node_tags.get(osm_key)
            if value in subclass_map:
                poi_category, poi_priority = subclass_map[value]
                poi_subclass = value
                break
        if poi_category:
            identity = ("node", node_id)
            if identity in institutional_entities:
                continue
            poi_key = _poi_identity(label_name, poi_category, poi_subclass, coordinate)
            if poi_key not in seen_pois:
                seen_pois.add(poi_key)
                poi_feature = _poi_feature(list(coordinate), poi_category, poi_subclass, poi_priority)
                poi_feature["properties"]["name"] = label_name
                labels["poi"]["features"].append(poi_feature)

    return labels, reports


def write_feature_collections(feature_collections: dict[str, dict[str, object]], output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "map-roads.geojson").unlink(missing_ok=True)
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
