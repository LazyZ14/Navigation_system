import type { NavigationState, RouteResponse } from "./types";

type LineFeature = {
  type: "Feature";
  properties: Record<string, never>;
  geometry: { type: "LineString"; coordinates: number[][] };
};

type PointFeature = {
  type: "Feature";
  properties: { heading: number };
  geometry: { type: "Point"; coordinates: number[] };
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

export class MapController {
  constructor(private readonly map: MapLike) {}

  renderRoute(route: RouteResponse): void {
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
      paint: { "line-color": "#172554", "line-width": 12, "line-opacity": 0.9 },
    });
    this.map.addLayer({
      id: "route-active",
      type: "line",
      source: ROUTE_SOURCE_ID,
      paint: { "line-color": "#2f80ed", "line-width": 7, "line-opacity": 1 },
    });
  }

  clearRoute(): void {
    for (const layerId of ROUTE_LAYER_IDS) {
      if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
    }
    if (this.map.getSource(ROUTE_SOURCE_ID)) this.map.removeSource(ROUTE_SOURCE_ID);
  }

  updateNavigation(state: NavigationState): void {
    if (state.matched_location === null) return;
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
      paint: { "text-color": "#dc2626", "text-halo-color": "#ffffff", "text-halo-width": 2 },
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
