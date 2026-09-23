import type { RouteResponse } from "./types";

type RouteFeature = {
  type: "Feature";
  properties: Record<string, never>;
  geometry: { type: "LineString"; coordinates: number[][] };
};

export type GeoJsonSourceLike = {
  setData: (data: RouteFeature) => void;
};

export type MapLike = {
  getSource: (id: string) => GeoJsonSourceLike | undefined;
  addSource: (id: string, source: { type: "geojson"; data: RouteFeature }) => void;
  addLayer: (layer: { id: string; [key: string]: unknown }) => void;
  getLayer: (id: string) => unknown;
  removeLayer: (id: string) => void;
  removeSource: (id: string) => void;
};

const ROUTE_SOURCE_ID = "route";
const ROUTE_LAYER_IDS = ["route-casing", "route-active"] as const;

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

  private toFeature(route: RouteResponse): RouteFeature {
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
