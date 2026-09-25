import { describe, expect, it } from "vitest";

import { MapController, type MapLike } from "../map-controller";
import type { RouteResponse } from "../types";

class FakeMap implements MapLike {
  sources = new Map<string, { data: unknown; setData: (data: unknown) => void }>();
  layers = new Map<string, unknown>();

  getSource(id: string) {
    return this.sources.get(id);
  }

  addSource(id: string, source: { data: unknown }) {
    this.sources.set(id, { data: source.data, setData: (data) => { this.sources.get(id)!.data = data; } });
  }

  addLayer(layer: { id: string; [key: string]: unknown }) {
    this.layers.set(layer.id, layer);
  }

  getLayer(id: string) {
    return this.layers.get(id);
  }

  removeLayer(id: string) {
    this.layers.delete(id);
  }

  removeSource(id: string) {
    this.sources.delete(id);
  }
}

const route: RouteResponse = {
  geometry: [{ lat: 39.9, lon: 116.4 }, { lat: 39.89, lon: 116.41 }],
  distance_m: 1200,
  duration_s: 180,
  maneuvers: [],
};

describe("MapController", () => {
  it("adds two route layers once and updates their source on a later route", () => {
    const map = new FakeMap();
    const controller = new MapController(map);

    controller.renderRoute(route);
    controller.renderRoute({ ...route, distance_m: 1300 });

    expect([...map.layers.keys()]).toEqual(["route-casing", "route-active"]);
    expect(map.sources.size).toBe(1);
  });

  it("removes route layers and source when the route is cleared", () => {
    const map = new FakeMap();
    const controller = new MapController(map);
    controller.renderRoute(route);

    controller.clearRoute();

    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it("moves the vehicle only to a matched road location and retains it when unmatched", () => {
    const map = new FakeMap();
    const controller = new MapController(map);

    controller.updateNavigation({
      status: "navigating",
      raw_location: null,
      matched_location: { lat: 39.9, lon: 116.4 },
      next_maneuver: null,
      remaining_distance_m: 900,
      off_route: false,
    } as never);

    expect(map.sources.get("vehicle")?.data).toMatchObject({
      geometry: { coordinates: [116.4, 39.9] },
      properties: { heading: 0 },
    });

    controller.updateNavigation({
      status: "unmatched",
      raw_location: null,
      matched_location: null,
      next_maneuver: null,
      remaining_distance_m: null,
      off_route: false,
    } as never);

    expect(map.sources.get("vehicle")?.data).toMatchObject({ geometry: { coordinates: [116.4, 39.9] } });
  });
});
