import type { NavigationState, RouteResponse } from "./types";
import { MAP_VISUAL_TOKENS } from "./map-style";

type GeoJsonPosition = [longitude: number, latitude: number];

type LineFeature = {
  type: "Feature";
  properties: Record<string, never>;
  geometry: { type: "LineString"; coordinates: GeoJsonPosition[] };
};

type PointFeature = {
  type: "Feature";
  properties: { heading: number };
  geometry: { type: "Point"; coordinates: GeoJsonPosition };
};

type GeoJsonFeature = LineFeature | PointFeature;

export type GeoJsonSourceLike = {
  setData: (data: GeoJsonFeature) => void;
};

export type MapLike = {
  getSource: (id: string) => GeoJsonSourceLike | undefined;
  addSource: (id: string, source: { type: "geojson"; data: GeoJsonFeature }) => void;
  addLayer: (layer: { id: string; [key: string]: unknown }) => void;
  getLayer: (id: string) => unknown;
  removeLayer: (id: string) => void;
  removeSource: (id: string) => void;
};

const ROUTE_SOURCE_ID = "route";
const ROUTE_LAYER_IDS = ["route-casing", "route-active"] as const;
const VEHICLE_SOURCE_ID = "vehicle";
const VEHICLE_LAYER_ID = "vehicle-marker";
const PASSED_SOURCE_ID = "route-passed";
const PASSED_LAYER_ID = "route-passed";

export class MapController {
  private routeCoordinates: GeoJsonPosition[] = [];

  constructor(private readonly map: MapLike) {}

  renderRoute(route: RouteResponse): void {
    this.routeCoordinates = route.geometry.map(({ lat, lon }) => [lon, lat]);
    const data = this.toFeature(route);
    const source = this.map.getSource(ROUTE_SOURCE_ID);
    if (source) {
      source.setData(data);
      return;
    }

    this.map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data });
    this.map.addLayer({
      id: "route-casing",
      type: "line",
      source: ROUTE_SOURCE_ID,
      paint: { "line-color": MAP_VISUAL_TOKENS.navigation.routeCasing, "line-width": 11, "line-opacity": 0.9 },
    });
    this.map.addLayer({
      id: "route-active",
      type: "line",
      source: ROUTE_SOURCE_ID,
      paint: { "line-color": MAP_VISUAL_TOKENS.navigation.routeActive, "line-width": 7, "line-opacity": 1 },
    });
  }

  clearRoute(): void {
    this.routeCoordinates = [];
    for (const layerId of ROUTE_LAYER_IDS) {
      if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
    }
    if (this.map.getSource(ROUTE_SOURCE_ID)) this.map.removeSource(ROUTE_SOURCE_ID);
    this.resetNavigation();
  }

  resetNavigation(): void {
    for (const layerId of [PASSED_LAYER_ID, VEHICLE_LAYER_ID]) {
      if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
    }
    if (this.map.getSource(PASSED_SOURCE_ID)) this.map.removeSource(PASSED_SOURCE_ID);
    if (this.map.getSource(VEHICLE_SOURCE_ID)) this.map.removeSource(VEHICLE_SOURCE_ID);
  }

  updateNavigation(state: NavigationState): void {
    if (state.matched_location === null) return;
    this.updatePassedRoute(state.matched_location.lon, state.matched_location.lat, state.progress);
    const data: PointFeature = {
      type: "Feature",
      properties: { heading: state.raw_location?.heading ?? 0 },
      geometry: { type: "Point", coordinates: [state.matched_location.lon, state.matched_location.lat] },
    };
    const source = this.map.getSource(VEHICLE_SOURCE_ID);
    if (source) {
      source.setData(data);
      return;
    }
    this.map.addSource(VEHICLE_SOURCE_ID, { type: "geojson", data });
    this.map.addLayer({
      id: VEHICLE_LAYER_ID,
      type: "symbol",
      source: VEHICLE_SOURCE_ID,
      layout: {
        "text-field": "▲",
        "text-size": 22,
        "text-rotate": ["get", "heading"],
        "text-rotation-alignment": "map",
        "text-allow-overlap": true,
      },
      paint: { "text-color": MAP_VISUAL_TOKENS.navigation.vehicle, "text-halo-color": MAP_VISUAL_TOKENS.navigation.vehicleHalo, "text-halo-width": 2 },
    });
  }

  private updatePassedRoute(lon: number, lat: number, progress: number): void {
    if (this.routeCoordinates.length === 0) return;
    // Use backend progress to determine how much of the route has been passed
    // This is authoritative and avoids independent spatial matching that can jump backwards
    const progressIndex = Math.floor(progress * (this.routeCoordinates.length - 1));
    const coordinates = this.routeCoordinates.slice(0, progressIndex + 1);
    const last = coordinates.at(-1);
    if (last?.[0] !== lon || last?.[1] !== lat) coordinates.push([lon, lat]);
    if (coordinates.length === 1) coordinates.push([coordinates[0][0], coordinates[0][1]]);
    const data: LineFeature = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    };
    const source = this.map.getSource(PASSED_SOURCE_ID);
    if (source) {
      source.setData(data);
      return;
    }
    this.map.addSource(PASSED_SOURCE_ID, { type: "geojson", data });
    this.map.addLayer({
      id: PASSED_LAYER_ID,
      type: "line",
      source: PASSED_SOURCE_ID,
      paint: { "line-color": MAP_VISUAL_TOKENS.navigation.routePassed, "line-width": 7, "line-opacity": 1 },
    });
  }

  private toFeature(route: RouteResponse): LineFeature {
    return {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: route.geometry.map(({ lat, lon }) => [lon, lat]),
      },
    };
  }
}
