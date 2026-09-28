import { describe, expect, it } from "vitest";

import { MapController, type MapLike } from "../map-controller";
import { MAP_VISUAL_TOKENS } from "../map-style";
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

  it("renders the passed route prefix in gray from the matched vehicle position", () => {
    const map = new FakeMap();
    const controller = new MapController(map);
    controller.renderRoute({
      ...route,
      geometry: [
        { lat: 39.9, lon: 116.4 },
        { lat: 39.9, lon: 116.405 },
        { lat: 39.9, lon: 116.41 },
      ],
    });

    controller.updateNavigation({
      status: "navigating",
      raw_location: null,
      matched_location: { lat: 39.9, lon: 116.405 },
      next_maneuver: null,
      remaining_distance_m: 500,
      off_route: false,
      progress: 0.5,
    } as never);

    expect(map.layers.has("route-passed")).toBe(true);
    expect(map.sources.get("route-passed")?.data).toMatchObject({
      geometry: { coordinates: [[116.4, 39.9], [116.405, 39.9]] },
    });
  });

  it("clears the previous vehicle and passed route before a new session", () => {
    const map = new FakeMap();
    const controller = new MapController(map);
    controller.renderRoute(route);
    controller.updateNavigation({
      status: "navigating",
      raw_location: null,
      matched_location: { lat: 39.9, lon: 116.4 },
      next_maneuver: null,
      remaining_distance_m: 500,
      off_route: false,
    } as never);

    controller.resetNavigation();

    expect(map.sources.has("route-passed")).toBe(false);
    expect(map.sources.has("vehicle")).toBe(false);
    expect(map.layers.has("route-passed")).toBe(false);
    expect(map.layers.has("vehicle-marker")).toBe(false);
  });

  it("uses projected meter distance when selecting the passed-route vertex", () => {
    const map = new FakeMap();
    const controller = new MapController(map);
    controller.renderRoute({
      ...route,
      geometry: [
        { lat: 60, lon: 0 },
        { lat: 60, lon: 0.001 },
        { lat: 60.0007, lon: 0 },
      ],
    });

    controller.updateNavigation({
      status: "navigating",
      raw_location: null,
      matched_location: { lat: 60.0007, lon: 0.0009 },
      next_maneuver: null,
      remaining_distance_m: 100,
      off_route: false,
      progress: 1.0,
    } as never);

    expect(map.sources.get("route-passed")?.data).toMatchObject({
      geometry: { coordinates: expect.arrayContaining([[0, 60.0007]]) },
    });
  });

  it("uses distance-based slicing for non-uniform segment lengths", () => {
    // Regression: must NOT use vertex-count approximation (progress * vertexCount)
    // Route: A→B = 10m, B→C = 100m, C→D = 10m, total = 120m
    // At progress=0.5 (60m), should be 50m into B→C segment, NOT at C
    const map = new FakeMap();
    const controller = new MapController(map);
    controller.renderRoute({
      ...route,
      geometry: [
        { lat: 39.9, lon: 116.400 },  // A: start
        { lat: 39.9, lon: 116.4001 }, // B: 10m east
        { lat: 39.9, lon: 116.4011 }, // C: 100m east
        { lat: 39.9, lon: 116.4012 }, // D: 10m east
      ],
    });

    // matched_location is slightly off the route (GPS noise)
    // Distance-based slicing should interpolate to the correct route position
    // NOT use the matched_location directly
    controller.updateNavigation({
      status: "navigating",
      raw_location: null,
      matched_location: { lat: 39.9001, lon: 116.4007 }, // 10m north of route, at 60m distance
      next_maneuver: null,
      remaining_distance_m: 60,
      off_route: false,
      progress: 0.5, // 60m / 120m
    } as never);

    const passedData = map.sources.get("route-passed")?.data as {
      geometry: { coordinates: number[][] };
    };
    const coords = passedData.geometry.coordinates;

    // Should include: A, B, and interpolated point 50m into B→C (on the route)
    // Must NOT include the matched_location (which is off-route)
    // Must NOT include C or D
    expect(coords.length).toBe(3); // A, B, interpolated point
    expect(coords[0]).toEqual([116.400, 39.9]); // A
    expect(coords[1]).toEqual([116.4001, 39.9]); // B
    // Interpolated point should be exactly 50m into B→C (on the route, lat=39.9)
    // NOT the matched_location (lat=39.9001)
    expect(coords[2][0]).toBeCloseTo(116.4006, 4); // 50m into B→C
    expect(coords[2][1]).toBeCloseTo(39.9, 4); // ON the route, not off-route
  });

  it("handles progress=0 with empty passed geometry", () => {
    const map = new FakeMap();
    const controller = new MapController(map);
    controller.renderRoute({
      ...route,
      geometry: [
        { lat: 39.9, lon: 116.4 },
        { lat: 39.9, lon: 116.41 },
      ],
    });

    controller.updateNavigation({
      status: "navigating",
      raw_location: null,
      matched_location: { lat: 39.9, lon: 116.4 },
      next_maneuver: null,
      remaining_distance_m: 1000,
      off_route: false,
      progress: 0.0,
    } as never);

    const passedData = map.sources.get("route-passed")?.data as {
      geometry: { coordinates: number[][] };
    };
    // Should have minimal geometry (start point only)
    expect(passedData.geometry.coordinates.length).toBeLessThanOrEqual(2);
  });

  it("handles progress=1 with full polyline", () => {
    const map = new FakeMap();
    const controller = new MapController(map);
    controller.renderRoute({
      ...route,
      geometry: [
        { lat: 39.9, lon: 116.4 },
        { lat: 39.9, lon: 116.405 },
        { lat: 39.9, lon: 116.41 },
      ],
    });

    controller.updateNavigation({
      status: "navigating",
      raw_location: null,
      matched_location: { lat: 39.9, lon: 116.41 },
      next_maneuver: null,
      remaining_distance_m: 0,
      off_route: false,
      progress: 1.0,
    } as never);

    const passedData = map.sources.get("route-passed")?.data as {
      geometry: { coordinates: number[][] };
    };
    // Should include all route vertices
    expect(passedData.geometry.coordinates.length).toBe(3);
    expect(passedData.geometry.coordinates[2]).toEqual([116.41, 39.9]);
  });

  it("uses centralized navigation tokens above existing base-map layers", () => {
    const map = new FakeMap();
    map.layers.set("arterial-road-surface", { id: "arterial-road-surface" });
    map.layers.set("poi-label-dense", { id: "poi-label-dense" });
    const controller = new MapController(map);

    controller.renderRoute(route);
    controller.updateNavigation({
      status: "navigating",
      raw_location: { heading: 90 },
      matched_location: { lat: 39.9, lon: 116.4 },
      next_maneuver: null,
      remaining_distance_m: 900,
      off_route: false,
    } as never);

    const casing = map.layers.get("route-casing") as { paint: Record<string, number | string> };
    const active = map.layers.get("route-active") as { paint: Record<string, number | string> };
    const passed = map.layers.get("route-passed") as { paint: Record<string, number | string> };
    const vehicle = map.layers.get("vehicle-marker") as { paint: Record<string, number | string> };
    expect(casing.paint["line-color"]).toBe(MAP_VISUAL_TOKENS.navigation.routeCasing);
    expect(casing.paint["line-width"]).toBe((active.paint["line-width"] as number) + 4);
    expect(passed.paint["line-color"]).toBe(MAP_VISUAL_TOKENS.navigation.routePassed);
    expect(vehicle.paint).toMatchObject({
      "text-color": MAP_VISUAL_TOKENS.navigation.vehicle,
      "text-halo-color": MAP_VISUAL_TOKENS.navigation.vehicleHalo,
    });
    expect([...map.layers.keys()].slice(-4)).toEqual(["route-casing", "route-active", "route-passed", "vehicle-marker"]);
  });
});
