import { wgs84ToGcj02 } from "./coord-transform";
import {
  matchPointToAmapRoute,
  UnroutedJitterFilter,
  type AmapRouteMatch,
  type GcjPoint,
  type IndexedAmapRoute,
} from "./amap-route-matcher";

export type AmapAppMode = "demo" | "live";

export interface LiveGpsFixPayload {
  device_id: string;
  stream_id: string;
  sequence: number;
  lat: number;
  lon: number;
  accuracy_m: number;
  speed_mps: number | null;
  heading_deg: number | null;
  timestamp: string;
  received_at: string;
}

export interface LiveNavSnapshot {
  mode: AmapAppMode;
  online: boolean;
  weakSignal: boolean;
  statusText: string;
  rawWgs84: { lat: number; lon: number } | null;
  displayPositionGcj: GcjPoint | null;
  displayHeadingDeg: number | null;
  speedKmh: number | null;
  accuracyM: number | null;
  delayMs: number | null;
  match: AmapRouteMatch | null;
  offRouteCount: number;
  recalculating: boolean;
  arrived: boolean;
}

export interface AmapLiveControllerCallbacks {
  onSnapshot: (snapshot: LiveNavSnapshot) => void;
  requestRecalculateRoute: (originGcj: GcjPoint) => Promise<IndexedAmapRoute | null>;
}

const HEARTBEAT_TIMEOUT_MS = 10_000;
const MAX_ACCEPTABLE_ACCURACY_M = 100;
const MAX_RECALC_ACCURACY_M = 50;
const OFF_ROUTE_DISTANCE_M = 50;
const OFF_ROUTE_STRIKES = 3;
const RECALC_COOLDOWN_MS = 10_000;

export class AmapLiveController {
  private readonly callbacks: AmapLiveControllerCallbacks;
  private readonly jitterFilter = new UnroutedJitterFilter();

  private mode: AmapAppMode = "demo";
  private epoch = 0;
  private online = false;
  private weakSignal = false;
  private statusText = "手动演示模式：点击地图选取起终点或使用预设测试点";
  private lastFixWallMs: number | null = null;
  private lastStreamId: string | null = null;
  private lastSequence: number | null = null;

  private rawWgs84: { lat: number; lon: number } | null = null;
  private displayPositionGcj: GcjPoint | null = null;
  private displayHeadingDeg: number | null = null;
  private speedKmh: number | null = null;
  private accuracyM: number | null = null;
  private delayMs: number | null = null;

  private activeRoute: IndexedAmapRoute | null = null;
  private previousMatch: AmapRouteMatch | null = null;
  private match: AmapRouteMatch | null = null;
  private offRouteCount = 0;
  private recalculating = false;
  private recalcFailed = false;
  private lastRecalcTriggerMs = -Infinity;
  private arrived = false;

  constructor(callbacks: AmapLiveControllerCallbacks) {
    this.callbacks = callbacks;
  }

  getMode(): AmapAppMode {
    return this.mode;
  }

  getSnapshot(): LiveNavSnapshot {
    return {
      mode: this.mode,
      online: this.online,
      weakSignal: this.weakSignal,
      statusText: this.statusText,
      rawWgs84: this.rawWgs84 ? { ...this.rawWgs84 } : null,
      displayPositionGcj: this.displayPositionGcj ? { ...this.displayPositionGcj } : null,
      displayHeadingDeg: this.displayHeadingDeg,
      speedKmh: this.speedKmh,
      accuracyM: this.accuracyM,
      delayMs: this.delayMs,
      match: this.match ? { ...this.match, projected: { ...this.match.projected } } : null,
      offRouteCount: this.offRouteCount,
      recalculating: this.recalculating,
      arrived: this.arrived,
    };
  }

  setMode(mode: AmapAppMode): void {
    this.mode = mode;
    this.epoch += 1;
    this.recalculating = false;
    this.recalcFailed = false;
    this.offRouteCount = 0;
    this.previousMatch = null;
    this.match = null;
    this.arrived = false;
    this.lastStreamId = null;
    this.lastSequence = null;
    this.jitterFilter.reset();

    if (mode === "demo") {
      this.online = false;
      this.weakSignal = false;
      this.lastFixWallMs = null;
      this.statusText = "手动演示模式：点击地图选取起终点或使用预设测试点";
    } else {
      this.statusText = this.online ? "🟢 手机/GNSS 实时定位在线" : "⏳ 等待手机/GNSS 实时定位信号...";
    }
    this.emitSnapshot();
  }

  setActiveRoute(route: IndexedAmapRoute | null): void {
    this.epoch += 1;
    this.activeRoute = route;
    this.previousMatch = null;
    this.match = null;
    this.offRouteCount = 0;
    this.recalculating = false;
    this.recalcFailed = false;
    this.arrived = false;
  }

  clearRoute(): void {
    this.setActiveRoute(null);
  }

  ingestFix(fix: LiveGpsFixPayload, nowMs = Date.now(), initialAgeMs = 0): void {
    if (this.mode !== "live") {
      return;
    }

    if (
      this.lastStreamId === fix.stream_id &&
      this.lastSequence !== null &&
      fix.sequence <= this.lastSequence
    ) {
      return;
    }
    this.lastStreamId = fix.stream_id;
    this.lastSequence = fix.sequence;

    const effectiveAgeMs = Math.max(0, initialAgeMs);
    this.lastFixWallMs = nowMs - effectiveAgeMs;
    this.online = effectiveAgeMs <= HEARTBEAT_TIMEOUT_MS;

    const sampleMs = Date.parse(fix.timestamp);
    const recvMs = Date.parse(fix.received_at);
    this.delayMs =
      Number.isFinite(sampleMs) && Number.isFinite(recvMs)
        ? Math.max(0, Math.round(recvMs - sampleMs))
        : null;

    if (!Number.isFinite(fix.accuracy_m) || fix.accuracy_m > MAX_ACCEPTABLE_ACCURACY_M) {
      this.weakSignal = true;
      this.accuracyM = fix.accuracy_m;
      if (!this.recalculating) {
        this.statusText = `⚠️ GPS 信号弱，精度 ±${Math.round(fix.accuracy_m)}m（已暂缓位置更新）`;
      }
      this.emitSnapshot();
      return;
    }

    this.weakSignal = false;
    this.rawWgs84 = { lat: fix.lat, lon: fix.lon };
    this.accuracyM = fix.accuracy_m;
    this.speedKmh = fix.speed_mps !== null && Number.isFinite(fix.speed_mps) ? fix.speed_mps * 3.6 : null;

    const gcj = wgs84ToGcj02(fix.lat, fix.lon);
    const smoothed = this.jitterFilter.update(gcj, fix.speed_mps, fix.heading_deg);

    if (this.activeRoute === null) {
      this.displayPositionGcj = smoothed.position;
      this.displayHeadingDeg = smoothed.headingDeg;
      this.match = null;
      this.statusText = this.online
        ? "🟢 手机/GNSS 实时定位在线（请选择终点开始导航）"
        : `⚠️ 实时定位信号已离线（上次更新 ${Math.round(effectiveAgeMs / 1000)}s 前）`;
      this.emitSnapshot();
      return;
    }

    if (this.arrived) {
      this.displayPositionGcj = smoothed.position;
      this.displayHeadingDeg = smoothed.headingDeg;
      this.statusText = "🎉 已到达终点附近";
      this.emitSnapshot();
      return;
    }

    const routeMatch = matchPointToAmapRoute(gcj, this.activeRoute, this.previousMatch, fix.heading_deg);
    this.match = routeMatch;

    if (routeMatch.distanceToRouteM <= OFF_ROUTE_DISTANCE_M) {
      this.previousMatch = routeMatch;
      this.offRouteCount = 0;
      this.recalcFailed = false;

      if (routeMatch.arrived) {
        this.arrived = true;
        this.displayPositionGcj = routeMatch.projected;
        this.displayHeadingDeg = routeMatch.segmentHeadingDeg;
        this.statusText = "🎉 已到达终点附近";
        this.emitSnapshot();
        return;
      }

      this.displayPositionGcj = routeMatch.projected;
      this.displayHeadingDeg =
        (fix.speed_mps ?? 0) >= 3.0 && fix.heading_deg !== null
          ? fix.heading_deg
          : routeMatch.segmentHeadingDeg;
      if (!this.recalculating) {
        this.statusText = routeMatch.currentInstruction || "🟢 正在沿规划路线导航";
      }
      this.emitSnapshot();
      return;
    }

    // Off-route (> 50m): render smoothed real vehicle position rather than snapping to wrong road
    this.displayPositionGcj = smoothed.position;
    this.displayHeadingDeg = smoothed.headingDeg;
    if (fix.accuracy_m <= MAX_RECALC_ACCURACY_M) {
      this.offRouteCount += 1;
    }

    const inCooldown = nowMs - this.lastRecalcTriggerMs < RECALC_COOLDOWN_MS;
    const canRecalc =
      this.offRouteCount >= OFF_ROUTE_STRIKES &&
      !this.recalculating &&
      !inCooldown;

    if (canRecalc) {
      void this.triggerRecalculation(gcj, nowMs);
      return;
    }

    if (this.recalculating) {
      this.statusText = "🔄 检测到偏航，正在重新规划路线...";
    } else if (this.recalcFailed && inCooldown) {
      this.statusText = `❌ 重算失败：当前位置无可达驾车路线（偏离 ${Math.round(routeMatch.distanceToRouteM)}m）`;
    } else {
      this.statusText = `⚠️ 已偏离路线 ${Math.round(routeMatch.distanceToRouteM)} 米`;
    }
    this.emitSnapshot();
  }

  tickHeartbeat(nowMs = Date.now()): void {
    if (this.mode !== "live" || !this.online || this.lastFixWallMs === null) {
      return;
    }
    if (nowMs - this.lastFixWallMs > HEARTBEAT_TIMEOUT_MS) {
      this.online = false;
      const elapsedSec = Math.round((nowMs - this.lastFixWallMs) / 1000);
      this.statusText = `⚠️ 实时定位信号已离线（上次更新 ${elapsedSec}s 前）`;
      this.emitSnapshot();
    }
  }

  private async triggerRecalculation(originGcj: GcjPoint, nowMs: number): Promise<void> {
    const callEpoch = this.epoch;
    this.recalculating = true;
    this.recalcFailed = false;
    this.lastRecalcTriggerMs = nowMs;
    this.statusText = "🔄 检测到偏航，正在重新规划路线...";
    this.emitSnapshot();

    let newRoute: IndexedAmapRoute | null = null;
    try {
      newRoute = await this.callbacks.requestRecalculateRoute(originGcj);
    } catch {
      newRoute = null;
    }

    if (this.epoch !== callEpoch || this.mode !== "live") {
      return;
    }

    this.recalculating = false;
    if (newRoute && newRoute.path.length >= 2) {
      this.activeRoute = newRoute;
      this.previousMatch = null;
      this.match = null;
      this.offRouteCount = 0;
      this.recalcFailed = false;
      this.arrived = false;
      this.statusText = "✅ 已偏航重新规划路线";
    } else {
      this.recalcFailed = true;
      this.statusText = "❌ 重算失败：当前位置无可达驾车路线";
    }
    this.emitSnapshot();
  }

  private emitSnapshot(): void {
    this.callbacks.onSnapshot(this.getSnapshot());
  }
}
