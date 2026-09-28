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
      "road-labels": emptyCollection,
      "place-labels": emptyCollection,
      poi: emptyCollection,
    });

    expect([...map.sources.keys()]).toEqual(["roads", "buildings", "water", "green", "landuse", "road-labels", "place-labels", "poi"]);
    const layerIds = map.layers.map(({ id }) => id);
    expect(layerIds.slice(0, 9)).toEqual([
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
    expect(layerIds.slice(-1).pop()).toMatch(/poi-/);
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

  it("registers label layers with P1-P5 priority ordering and collision disabled", () => {
    const map = new FakeMap();
    registerBaseMap(map, {
      roads: emptyCollection,
      buildings: emptyCollection,
      water: emptyCollection,
      green: emptyCollection,
      landuse: emptyCollection,
      "road-labels": emptyCollection,
      "place-labels": emptyCollection,
      poi: emptyCollection,
    });

    const layerIds = map.layers.map(({ id }) => id);
    const labelLayerIds = layerIds.filter((id) => id.includes("label") || id.includes("poi"));
    expect(labelLayerIds.length).toBeGreaterThan(0);

    const majorRoadLabel = map.layers.find(({ id }) => id === "road-label-major") as { layout: Record<string, unknown> } | undefined;
    expect(majorRoadLabel).toBeDefined();
    expect(majorRoadLabel!.layout["symbol-placement"]).toBe("line");
    expect(majorRoadLabel!.layout["text-allow-overlap"]).toBe(false);
    expect(majorRoadLabel!.layout["text-ignore-placement"]).toBe(false);
    expect(majorRoadLabel!.layout["symbol-sort-key"]).toBeDefined();

    const poiDense = map.layers.find(({ id }) => id === "poi-label-dense") as { layout: Record<string, unknown> } | undefined;
    expect(poiDense).toBeDefined();
    expect(poiDense!.layout["text-allow-overlap"]).toBe(false);
  });

  it("sets minzoom bands for progressive label visibility", () => {
    const map = new FakeMap();
    registerBaseMap(map, {
      roads: emptyCollection,
      buildings: emptyCollection,
      water: emptyCollection,
      green: emptyCollection,
      landuse: emptyCollection,
      "road-labels": emptyCollection,
      "place-labels": emptyCollection,
      poi: emptyCollection,
    });

    const majorRoad = map.layers.find(({ id }) => id === "road-label-major") as { minzoom: number } | undefined;
    const secondaryRoad = map.layers.find(({ id }) => id === "road-label-secondary") as { minzoom: number } | undefined;
    const residentialRoad = map.layers.find(({ id }) => id === "road-label-local") as { minzoom: number } | undefined;
    const poiImportant = map.layers.find(({ id }) => id === "poi-label-important") as { minzoom: number } | undefined;
    const poiDense = map.layers.find(({ id }) => id === "poi-label-dense") as { minzoom: number } | undefined;

    expect(majorRoad!.minzoom).toBeLessThanOrEqual(12);
    expect(secondaryRoad!.minzoom).toBeGreaterThanOrEqual(12);
    expect(residentialRoad!.minzoom).toBeGreaterThanOrEqual(15);
    expect(poiImportant!.minzoom).toBeGreaterThanOrEqual(14);
    expect(poiDense!.minzoom).toBeGreaterThanOrEqual(16);
  });
});
