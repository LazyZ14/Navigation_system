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

export type LocationFix = Coordinate & {
  heading: number;
  speed_mps: number;
  accuracy_m: number;
  timestamp: string;
};

export type NavigationState = {
  status: "ready" | "navigating" | "unmatched" | "arrived" | "replay_finished";
  raw_location: LocationFix | null;
  matched_location: Coordinate | null;
  next_maneuver: Maneuver | null;
  remaining_distance_m: number | null;
  off_route: boolean;
  progress: number;
};

export type NavigationSession = {
  session_id: string;
  route: RouteResponse;
  state: NavigationState;
};
