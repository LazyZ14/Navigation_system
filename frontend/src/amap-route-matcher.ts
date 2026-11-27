export interface GcjPoint {
  lat: number;
  lon: number;
}

export interface IndexedRouteStep {
  index: number;
  instruction: string;
  startDistanceM: number;
  endDistanceM: number;
}

export interface IndexedAmapRoute {
  path: GcjPoint[];
  steps: IndexedRouteStep[];
  totalDistanceM: number;
  totalDurationS: number;
}

export interface AmapRouteMatch {
  segmentIndex: number;
  projected: GcjPoint;
  segmentHeadingDeg: number;
  distanceToRouteM: number;
  distanceAlongRouteM: number;
  remainingDistanceM: number;
  remainingDurationS: number;
  currentStepIndex: number;
  currentInstruction: string;
  nextInstruction: string | null;
  arrived: boolean;
}

type RawVertex = { getLng?: () => number; getLat?: () => number } | [number, number];

export interface RawAmapRoute {
  distance?: number;
  time?: number;
  steps?: Array<{
    instruction?: string;
    path?: RawVertex[];
  }>;
}

const EARTH_RADIUS_M = 6_371_000;
const ARRIVAL_THRESHOLD_M = 25;
const MAX_ARRIVAL_LATERAL_M = 50;
const BACKWARD_TOLERANCE_M = 15;
const FORWARD_SEARCH_RANGE_M = 1000;

export function distanceBetweenGcjM(a: GcjPoint, b: GcjPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function calculateSegmentHeadingDeg(start: GcjPoint, end: GcjPoint): number {
  const midLatRad = (((start.lat + end.lat) / 2) * Math.PI) / 180;
  const dx = (end.lon - start.lon) * Math.cos(midLatRad);
  const dy = end.lat - start.lat;
  if (dx === 0 && dy === 0) {
    return 0;
  }
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

export function circularHeadingDiffDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function normalizeVertex(v: RawVertex): GcjPoint | null {
  if (Array.isArray(v)) {
    const [lon, lat] = v;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon };
    }
    return null;
  }
  if (v && typeof v === "object" && typeof v.getLng === "function" && typeof v.getLat === "function") {
    const lon = v.getLng();
    const lat = v.getLat();
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon };
    }
  }
  return null;
}

export function buildIndexedAmapRoute(rawRoute: RawAmapRoute): IndexedAmapRoute {
  const path: GcjPoint[] = [];
  const steps: IndexedRouteStep[] = [];
  let cumulativeM = 0;

  for (const [idx, rawStep] of (rawRoute.steps ?? []).entries()) {
    const stepStartM = cumulativeM;
    for (const rawVertex of rawStep.path ?? []) {
      const pt = normalizeVertex(rawVertex);
      if (!pt) continue;
      if (path.length === 0) {
        path.push(pt);
      } else {
        const prev = path[path.length - 1];
        const segLen = distanceBetweenGcjM(prev, pt);
        if (segLen >= 0.05) {
          path.push(pt);
          cumulativeM += segLen;
        }
      }
    }
    steps.push({
      index: idx,
      instruction: (rawStep.instruction ?? "").replace(/<[^>]+>/g, "").trim() || `路段 ${idx + 1}`,
      startDistanceM: stepStartM,
      endDistanceM: cumulativeM,
    });
  }

  return {
    path,
    steps,
    totalDistanceM: cumulativeM > 0 ? cumulativeM : (rawRoute.distance ?? 0),
    totalDurationS: rawRoute.time ?? 0,
  };
}

function projectPointToSegment(
  point: GcjPoint,
  start: GcjPoint,
  end: GcjPoint,
): { projected: GcjPoint; distanceM: number; offsetAlongSegmentM: number; segmentLengthM: number } {
  const midLatRad = (((start.lat + end.lat) / 2) * Math.PI) / 180;
  const latScale = 111_320;
  const lonScale = 111_320 * Math.cos(midLatRad);

  const dx = (end.lon - start.lon) * lonScale;
  const dy = (end.lat - start.lat) * latScale;
  const segLenSq = dx * dx + dy * dy;
  const segmentLengthM = distanceBetweenGcjM(start, end);

  if (segLenSq === 0 || segmentLengthM === 0) {
    return {
      projected: start,
      distanceM: distanceBetweenGcjM(point, start),
      offsetAlongSegmentM: 0,
      segmentLengthM: 0,
    };
  }

  const px = (point.lon - start.lon) * lonScale;
  const py = (point.lat - start.lat) * latScale;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / segLenSq));

  const projected: GcjPoint = {
    lat: start.lat + t * (end.lat - start.lat),
    lon: start.lon + t * (end.lon - start.lon),
  };

  return {
    projected,
    distanceM: distanceBetweenGcjM(point, projected),
    offsetAlongSegmentM: t * segmentLengthM,
    segmentLengthM,
  };
}

interface CandidateMatch {
  segmentIndex: number;
  projected: GcjPoint;
  segmentHeadingDeg: number;
  distanceToRouteM: number;
  distanceAlongRouteM: number;
}

export function matchPointToAmapRoute(
  point: GcjPoint,
  route: IndexedAmapRoute,
  previousMatch: AmapRouteMatch | null,
  headingDeg?: number | null,
): AmapRouteMatch {
  if (route.path.length === 0) {
    return {
      segmentIndex: 0,
      projected: point,
      segmentHeadingDeg: headingDeg ?? 0,
      distanceToRouteM: 0,
      distanceAlongRouteM: 0,
      remainingDistanceM: 0,
      remainingDurationS: 0,
      currentStepIndex: 0,
      currentInstruction: "",
      nextInstruction: null,
      arrived: true,
    };
  }

  if (route.path.length === 1) {
    const d = distanceBetweenGcjM(point, route.path[0]);
    return {
      segmentIndex: 0,
      projected: route.path[0],
      segmentHeadingDeg: headingDeg ?? 0,
      distanceToRouteM: d,
      distanceAlongRouteM: 0,
      remainingDistanceM: d,
      remainingDurationS: 0,
      currentStepIndex: 0,
      currentInstruction: route.steps[0]?.instruction ?? "",
      nextInstruction: null,
      arrived: d <= ARRIVAL_THRESHOLD_M,
    };
  }

  const allCandidates: CandidateMatch[] = [];
  const windowCandidates: CandidateMatch[] = [];
  let cumulativeM = 0;

  for (let i = 0; i < route.path.length - 1; i++) {
    const start = route.path[i];
    const end = route.path[i + 1];
    const proj = projectPointToSegment(point, start, end);
    const distanceAlong = cumulativeM + proj.offsetAlongSegmentM;
    const candidate: CandidateMatch = {
      segmentIndex: i,
      projected: proj.projected,
      segmentHeadingDeg: calculateSegmentHeadingDeg(start, end),
      distanceToRouteM: proj.distanceM,
      distanceAlongRouteM: distanceAlong,
    };
    allCandidates.push(candidate);

    if (previousMatch !== null) {
      const minDist = Math.max(0, previousMatch.distanceAlongRouteM - BACKWARD_TOLERANCE_M);
      const maxDist = previousMatch.distanceAlongRouteM + FORWARD_SEARCH_RANGE_M;
      if (cumulativeM + proj.segmentLengthM >= minDist && cumulativeM <= maxDist) {
        windowCandidates.push(candidate);
      }
    }
    cumulativeM += proj.segmentLengthM;
  }

  const pool = previousMatch !== null && windowCandidates.length > 0 ? windowCandidates : allCandidates;
  const hasValidHeading = headingDeg !== null && headingDeg !== undefined && Number.isFinite(headingDeg);

  const scoreCandidate = (c: CandidateMatch): number => {
    const distanceScore = c.distanceToRouteM * 1000;
    const continuityScore =
      previousMatch !== null
        ? Math.abs(c.distanceAlongRouteM - previousMatch.distanceAlongRouteM) * 0.1
        : 0;
    const headingScore = hasValidHeading
      ? circularHeadingDiffDeg(c.segmentHeadingDeg, headingDeg!) * 2.0
      : 0;
    return distanceScore + continuityScore + headingScore;
  };

  let best = pool[0];
  let bestScore = scoreCandidate(best);
  for (let i = 1; i < pool.length; i++) {
    const s = scoreCandidate(pool[i]);
    if (s < bestScore) {
      best = pool[i];
      bestScore = s;
    }
  }

  const totalDistM = Math.max(cumulativeM, route.totalDistanceM);
  const remainingDistanceM = Math.max(0, totalDistM - best.distanceAlongRouteM);
  const remainingDurationS =
    totalDistM > 0 ? Math.max(0, Math.round(route.totalDurationS * (remainingDistanceM / totalDistM))) : 0;

  let currentStepIndex = Math.max(0, route.steps.length - 1);
  for (let sIdx = 0; sIdx < route.steps.length; sIdx++) {
    if (best.distanceAlongRouteM <= route.steps[sIdx].endDistanceM + 0.5) {
      currentStepIndex = sIdx;
      break;
    }
  }

  const currentInstruction = route.steps[currentStepIndex]?.instruction ?? "";
  const nextInstruction =
    currentStepIndex + 1 < route.steps.length ? route.steps[currentStepIndex + 1].instruction : null;

  return {
    segmentIndex: best.segmentIndex,
    projected: best.projected,
    segmentHeadingDeg: best.segmentHeadingDeg,
    distanceToRouteM: best.distanceToRouteM,
    distanceAlongRouteM: best.distanceAlongRouteM,
    remainingDistanceM,
    remainingDurationS,
    currentStepIndex,
    currentInstruction,
    nextInstruction,
    arrived: remainingDistanceM <= ARRIVAL_THRESHOLD_M && best.distanceToRouteM <= MAX_ARRIVAL_LATERAL_M,
  };
}

export class UnroutedJitterFilter {
  private lastPosition: GcjPoint | null = null;
  private lastHeadingDeg: number | null = null;
  private readonly deadzoneM: number;
  private readonly minMovingSpeedMps: number;
  private readonly emaAlpha: number;

  constructor(deadzoneM = 3.0, minMovingSpeedMps = 1.0, emaAlpha = 0.5) {
    this.deadzoneM = deadzoneM;
    this.minMovingSpeedMps = minMovingSpeedMps;
    this.emaAlpha = emaAlpha;
  }

  reset(): void {
    this.lastPosition = null;
    this.lastHeadingDeg = null;
  }

  update(
    point: GcjPoint,
    speedMps: number | null,
    headingDeg: number | null,
  ): { position: GcjPoint; headingDeg: number | null } {
    if (this.lastPosition === null) {
      this.lastPosition = { ...point };
      this.lastHeadingDeg = headingDeg;
      return { position: { ...this.lastPosition }, headingDeg: this.lastHeadingDeg };
    }

    const distM = distanceBetweenGcjM(this.lastPosition, point);
    const speed = speedMps ?? 0;
    if (distM < this.deadzoneM && speed < this.minMovingSpeedMps) {
      return { position: { ...this.lastPosition }, headingDeg: this.lastHeadingDeg };
    }

    this.lastPosition = {
      lat: this.lastPosition.lat + this.emaAlpha * (point.lat - this.lastPosition.lat),
      lon: this.lastPosition.lon + this.emaAlpha * (point.lon - this.lastPosition.lon),
    };

    if (headingDeg !== null && Number.isFinite(headingDeg) && (speed >= this.minMovingSpeedMps || distM >= this.deadzoneM * 2)) {
      this.lastHeadingDeg = headingDeg;
    }

    return { position: { ...this.lastPosition }, headingDeg: this.lastHeadingDeg };
  }
}
