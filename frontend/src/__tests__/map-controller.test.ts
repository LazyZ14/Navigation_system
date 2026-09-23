import { describe, expect, it } from "vitest";

import { MapController, type MapLike } from "../map-controller";
import type { RouteResponse } from "../types";

class FakeMap implements MapLike {
  sources = new Map<string, { setData: (data: unknown) => void }>();
  layers = new Map<string, unknown>();

  getSource(id: string) {
    return this.sources.get(id);
  }

  addSource(id: string, source: { data: unknown }) {
    this.sources.set(id, { setData: (data) => { source.data = data; } });
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
});
