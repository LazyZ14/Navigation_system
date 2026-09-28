export const MAP_VISUAL_TOKENS = {
  background: "#F4F6F8",
  buildings: { fill: "#D9E0E7", outline: "#C4CDD6" },
  water: { fill: "#B9DDF2", outline: "#95C6E2" },
  green: { park: "#D8EACB", forest: "#BFD9B6", grass: "#E5F0DB" },
  landuse: { fill: "#EDF1F4" },
  roads: { casing: "#C3CCD5", surface: "#FAFBFC" },
  labels: {
    text: "#475569",
    halo: "#FFFFFF",
    placeText: "#334155",
    poiText: "#64748B",
  },
  navigation: {
    routeCasing: "#172554",
    routeActive: "#2F80ED",
    routePassed: "#94A3B8",
    vehicle: "#0F766E",
    vehicleHalo: "#FFFFFF",
  },
} as const;

export const ROAD_CLASS_GROUPS = {
  arterial: ["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"],
  local: ["tertiary", "tertiary_link", "residential", "service", "unclassified", "pedestrian", "footway", "cycleway"],
} as const;

type Expression = unknown[];
type SourceName = "roads" | "buildings" | "water" | "green" | "landuse" | "road-labels" | "place-labels" | "poi";
type FeatureCollection = { type: "FeatureCollection"; features: unknown[] };

export type BaseMapLike = {
  addSource: (id: string, source: { type: "geojson"; data: FeatureCollection }) => void;
  addLayer: (layer: { id: string; [key: string]: unknown }) => void;
};

const LOCAL_FONT_STACK = "PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif";

const ROAD_WIDTHS: Record<string, [number, number, number]> = {
  motorway: [7, 13, 20], motorway_link: [6, 11, 17],
  trunk: [6, 12, 18], trunk_link: [5, 10, 16],
  primary: [5, 10, 16], primary_link: [4, 9, 14],
  secondary: [4, 8, 13], secondary_link: [3, 7, 11],
  tertiary: [3, 6, 10], tertiary_link: [3, 5, 9],
  residential: [2, 4, 7], service: [2, 3, 5],
  unclassified: [2, 3.5, 6], pedestrian: [1.5, 3, 5],
  footway: [1, 2, 3], cycleway: [1.5, 2.5, 4],
};

const widthsAtZoom = (index: 0 | 1 | 2, fallback: number, offset = 0): Expression => [
  "match", ["get", "class"],
  ...Object.entries(ROAD_WIDTHS).flatMap(([roadClass, widths]) => [roadClass, widths[index] + offset]),
  fallback,
];

const interpolatedRoadWidth = (offset = 0): Expression => [
  "interpolate", ["linear"], ["zoom"],
  10, widthsAtZoom(0, 1 + offset, offset),
  15, widthsAtZoom(1, 2 + offset, offset),
  18, widthsAtZoom(2, 3 + offset, offset),
];

export const roadWidthExpression = interpolatedRoadWidth();

function roadFilter(classes: readonly string[]): Expression {
  return ["in", ["get", "class"], ["literal", classes]];
}

function roadLayers(group: "local" | "arterial"): Array<{ id: string; [key: string]: unknown }> {
  const filter = roadFilter(ROAD_CLASS_GROUPS[group]);
  return [
    {
      id: `${group}-road-casing`, type: "line", source: "roads", filter,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": MAP_VISUAL_TOKENS.roads.casing, "line-width": interpolatedRoadWidth(2) },
    },
    {
      id: `${group}-road-surface`, type: "line", source: "roads", filter,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": MAP_VISUAL_TOKENS.roads.surface, "line-width": roadWidthExpression },
    },
  ];
}

function labelLayers(): Array<{ id: string; [key: string]: unknown }> {
  const baseLayout = {
    "text-font": [LOCAL_FONT_STACK],
    "text-allow-overlap": false,
    "text-ignore-placement": false,
  };
  return [
    {
      id: "road-label-major",
      type: "symbol",
      source: "road-labels",
      minzoom: 11,
      filter: ["match", ["get", "class"], ["trunk", "primary"], true, false],
      layout: {
        ...baseLayout,
        "symbol-placement": "line",
        "symbol-spacing": 300,
        "text-field": ["get", "name"],
        "text-size": 12,
        "text-rotation-alignment": "map",
        "symbol-sort-key": ["get", "priority"],
      },
      paint: {
        "text-color": MAP_VISUAL_TOKENS.labels.text,
        "text-halo-color": MAP_VISUAL_TOKENS.labels.halo,
        "text-halo-width": 1.5,
      },
    },
    {
      id: "road-label-secondary",
      type: "symbol",
      source: "road-labels",
      minzoom: 13,
      filter: ["match", ["get", "class"], ["secondary", "tertiary"], true, false],
      layout: {
        ...baseLayout,
        "symbol-placement": "line",
        "symbol-spacing": 250,
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-rotation-alignment": "map",
        "symbol-sort-key": ["get", "priority"],
      },
      paint: {
        "text-color": MAP_VISUAL_TOKENS.labels.text,
        "text-halo-color": MAP_VISUAL_TOKENS.labels.halo,
        "text-halo-width": 1.2,
      },
    },
    {
      id: "place-label-important",
      type: "symbol",
      source: "place-labels",
      minzoom: 13,
      layout: {
        ...baseLayout,
        "text-field": ["get", "name"],
        "text-size": 12,
        "symbol-sort-key": ["get", "priority"],
      },
      paint: {
        "text-color": MAP_VISUAL_TOKENS.labels.placeText,
        "text-halo-color": MAP_VISUAL_TOKENS.labels.halo,
        "text-halo-width": 1.5,
      },
    },
    {
      id: "road-label-local",
      type: "symbol",
      source: "road-labels",
      minzoom: 16,
      filter: ["match", ["get", "class"], ["residential", "unclassified"], true, false],
      layout: {
        ...baseLayout,
        "symbol-placement": "line",
        "symbol-spacing": 200,
        "text-field": ["get", "name"],
        "text-size": 10,
        "text-rotation-alignment": "map",
        "symbol-sort-key": ["get", "priority"],
      },
      paint: {
        "text-color": MAP_VISUAL_TOKENS.labels.text,
        "text-halo-color": MAP_VISUAL_TOKENS.labels.halo,
        "text-halo-width": 1,
      },
    },
    {
      id: "poi-label-important",
      type: "symbol",
      source: "poi",
      minzoom: 15,
      filter: ["<=", ["get", "priority"], 3],
      layout: {
        ...baseLayout,
        "text-field": ["get", "name"],
        "text-size": 11,
        "symbol-sort-key": ["get", "priority"],
      },
      paint: {
        "text-color": MAP_VISUAL_TOKENS.labels.poiText,
        "text-halo-color": MAP_VISUAL_TOKENS.labels.halo,
        "text-halo-width": 1.2,
      },
    },
    {
      id: "poi-label-dense",
      type: "symbol",
      source: "poi",
      minzoom: 17,
      filter: [">", ["get", "priority"], 3],
      layout: {
        ...baseLayout,
        "text-field": ["get", "name"],
        "text-size": 10,
        "symbol-sort-key": ["get", "priority"],
      },
      paint: {
        "text-color": MAP_VISUAL_TOKENS.labels.poiText,
        "text-halo-color": MAP_VISUAL_TOKENS.labels.halo,
        "text-halo-width": 1,
      },
    },
  ];
}

export function registerBaseMap(map: BaseMapLike, dataBySource: Record<SourceName, FeatureCollection>): void {
  (Object.keys(dataBySource) as SourceName[]).forEach((sourceName) => {
    map.addSource(sourceName, { type: "geojson", data: dataBySource[sourceName] });
  });
  const layers = [
    { id: "landuse-fill", type: "fill", source: "landuse", paint: { "fill-color": MAP_VISUAL_TOKENS.landuse.fill, "fill-opacity": 0.45 } },
    { id: "green-fill", type: "fill", source: "green", paint: { "fill-color": ["match", ["get", "class"], "park", MAP_VISUAL_TOKENS.green.park, "forest", MAP_VISUAL_TOKENS.green.forest, MAP_VISUAL_TOKENS.green.grass], "fill-opacity": 0.7 } },
    { id: "water-fill", type: "fill", source: "water", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": MAP_VISUAL_TOKENS.water.fill, "fill-outline-color": MAP_VISUAL_TOKENS.water.outline } },
    { id: "waterway-line", type: "line", source: "water", filter: ["==", ["get", "class"], "waterway"], paint: { "line-color": MAP_VISUAL_TOKENS.water.outline, "line-width": 2 } },
    { id: "buildings-fill", type: "fill", source: "buildings", paint: { "fill-color": MAP_VISUAL_TOKENS.buildings.fill, "fill-outline-color": MAP_VISUAL_TOKENS.buildings.outline } },
    ...roadLayers("local"),
    ...roadLayers("arterial"),
    ...labelLayers(),
  ];
  layers.forEach((layer) => map.addLayer(layer));
}
