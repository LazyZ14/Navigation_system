export type Coordinate = {
  lat: number;
  lon: number;
};

export type Maneuver = {
  instruction: string;
  distance_m: number;
  location: Coordinate;
};

export type RouteResponse = {
  geometry: Coordinate[];
  distance_m: number;
  duration_s: number;
  maneuvers: Maneuver[];
};
