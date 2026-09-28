import { describe, expect, it } from "vitest";

import { MAP_VISUAL_TOKENS, ROAD_CLASS_GROUPS, registerBaseMap, roadWidthExpression } from "../map-style";

class FakeMap {
  sources = new Map<string, unknown>();
  layers: Array<{ id: string; [key: string]: unknown }> = [];

  addSource(id: string, source: unknown) {
    this.sources.set(id, source);
  }

  addLayer(layer: { id: string; [key: string]: unknown }) {
    this.layers.push(layer);
  }
}

const emptyCollection = { type: "FeatureCollection" as const, features: [] };

describe("offline base-map style", () => {
  it("uses navigation-first muted visual tokens", () => {
    expect(MAP_VISUAL_TOKENS.background).toBe("#F4F6F8");
    expect(MAP_VISUAL_TOKENS.buildings.fill).toBe("#D9E0E7");
    expect(MAP_VISUAL_TOKENS.water.fill).toBe("#B9DDF2");
  });

  it("registers the five thematic sources and base layers in visual order", () => {
    const map = new FakeMap();
    registerBaseMap(map, {
      roads: emptyCollection,
      buildings: emptyCollection,
      water: emptyCollection,
      green: emptyCollection,
      landuse: emptyCollection,
    });

    expect([...map.sources.keys()]).toEqual(["roads", "buildings", "water", "green", "landuse"]);
    expect(map.layers.map(({ id }) => id)).toEqual([
      "landuse-fill",
      "green-fill",
      "water-fill",
      "waterway-line",
      "buildings-fill",
      "local-road-casing",
      "local-road-surface",
      "arterial-road-casing",
      "arterial-road-surface",
    ]);
    const casingWidth = map.layers.find(({ id }) => id === "local-road-casing")?.paint as Record<string, unknown>;
    expect((casingWidth["line-width"] as unknown[]).slice(0, 3)).toEqual(["interpolate", ["linear"], ["zoom"]]);
  });

  it("covers every supported highway class in one grouped road layer family", () => {
    expect([...ROAD_CLASS_GROUPS.local, ...ROAD_CLASS_GROUPS.arterial].sort()).toEqual([
      "cycleway", "footway", "motorway", "motorway_link", "pedestrian", "primary", "primary_link",
      "residential", "secondary", "secondary_link", "service", "tertiary", "tertiary_link", "trunk",
      "trunk_link", "unclassified",
    ]);
  });

  it("keeps class-specific interpolated road widths within grouped layers", () => {
    expect(roadWidthExpression.slice(0, 3)).toEqual(["interpolate", ["linear"], ["zoom"]]);
    const zoom15WidthMatch = roadWidthExpression[6] as unknown[];
    expect(zoom15WidthMatch.slice(0, 2)).toEqual(["match", ["get", "class"]]);
    const branches = zoom15WidthMatch.slice(2, -1);
    const primary = branches[branches.indexOf("primary") + 1];
    const secondary = branches[branches.indexOf("secondary") + 1];
    const tertiary = branches[branches.indexOf("tertiary") + 1];

    expect(primary).toBe(10);
    expect(secondary).toBe(8);
    expect(tertiary).toBe(6);
  });
});
