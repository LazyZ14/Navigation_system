import { describe, expect, it, vi } from "vitest";
import { wgs84ToGcj02 } from "../coord-transform";
import { buildIndexedAmapRoute, type GcjPoint, type IndexedAmapRoute } from "../amap-route-matcher";
import {
  AmapLiveController,
  type LiveGpsFixPayload,
  type LiveNavSnapshot,
} from "../amap-live-controller";

const BASE_TIME_MS = Date.parse("2026-11-27T05:10:00.000Z");

function makeFix(
  overrides: Partial<LiveGpsFixPayload> & { lat: number; lon: number; sequence?: number },
  offsetMs = 0,
): LiveGpsFixPayload {
  const sampleIso = new Date(BASE_TIME_MS + offsetMs).toISOString();
  const recvIso = new Date(BASE_TIME_MS + offsetMs + 28).toISOString();
  return {
    device_id: "iphone",
    stream_id: "19989152-7c55-40c8-b98f-fdf7d5aa81d9",
    sequence: overrides.sequence ?? 0,
    lat: overrides.lat,
    lon: overrides.lon,
    accuracy_m: overrides.accuracy_m ?? 6.0,
    speed_mps: overrides.speed_mps === undefined ? 8.0 : overrides.speed_mps,
    heading_deg: overrides.heading_deg === undefined ? 0 : overrides.heading_deg,
    timestamp: overrides.timestamp ?? sampleIso,
    received_at: overrides.received_at ?? recvIso,
  };
}

function buildZhuhaiNorthRouteFromWgs(): IndexedAmapRoute {
  const startGcj = wgs84ToGcj02(22.3700, 113.5786);
  const endGcj = wgs84ToGcj02(22.3750, 113.5786);
  return buildIndexedAmapRoute({
    distance: 550,
    time: 60,
    steps: [
      {
        instruction: "沿港湾大道向北直行",
        path: [
          [startGcj.lon, startGcj.lat],
          [endGcj.lon, endGcj.lat],
        ],
      },
    ],
  });
}

describe("AmapLiveController", () => {
  it("converts incoming WGS-84 fix to GCJ-02 and marks stream offline after 10s heartbeat timeout", () => {
    const snapshots: LiveNavSnapshot[] = [];
    const controller = new AmapLiveController({
      onSnapshot: (s) => snapshots.push(s),
      requestRecalculateRoute: async () => null,
    });

    controller.setMode("live");
    controller.ingestFix(makeFix({ lat: 22.3734, lon: 113.5786, speed_mps: 5.0, heading_deg: 85 }), BASE_TIME_MS + 50);

    const active = snapshots[snapshots.length - 1];
    const expectedGcj = wgs84ToGcj02(22.3734, 113.5786);
    expect(active.online).toBe(true);
    expect(active.rawWgs84).toEqual({ lat: 22.3734, lon: 113.5786 });
    expect(active.displayPositionGcj?.lat).toBeCloseTo(expectedGcj.lat, 5);
    expect(active.displayPositionGcj?.lon).toBeCloseTo(expectedGcj.lon, 5);
    expect(active.speedKmh).toBeCloseTo(18.0, 1);
    expect(active.delayMs).toBe(28);

    // 11 seconds later without new fixes -> offline
    controller.tickHeartbeat(BASE_TIME_MS + 11_100);
    const expired = snapshots[snapshots.length - 1];
    expect(expired.online).toBe(false);
    expect(expired.statusText).toContain("离线");
  });

  it("rejects noisy fixes with accuracy_m > 100 without moving vehicle or incrementing off-route count", () => {
    const snapshots: LiveNavSnapshot[] = [];
    const recalc = vi.fn(async () => null);
    const controller = new AmapLiveController({
      onSnapshot: (s) => snapshots.push(s),
      requestRecalculateRoute: recalc,
    });

    controller.setMode("live");
    controller.setActiveRoute(buildZhuhaiNorthRouteFromWgs());

    // Valid on-route fix
    controller.ingestFix(makeFix({ sequence: 1, lat: 22.3710, lon: 113.5786, accuracy_m: 8 }), BASE_TIME_MS + 100);
    const goodPos = snapshots[snapshots.length - 1].displayPositionGcj!;

    // 4 wild fixes 500m away with poor accuracy (150m)
    for (let i = 2; i <= 5; i++) {
      controller.ingestFix(
        makeFix({ sequence: i, lat: 22.3710, lon: 113.5840, accuracy_m: 150 }, i * 200),
        BASE_TIME_MS + i * 200 + 30,
      );
    }

    const latest = snapshots[snapshots.length - 1];
    expect(latest.weakSignal).toBe(true);
    expect(latest.displayPositionGcj).toEqual(goodPos);
    expect(latest.offRouteCount).toBe(0);
    expect(recalc).not.toHaveBeenCalled();
  });

  it("snaps to route during normal driving and stops off-route checks once arrived (<= 25m)", () => {
    const snapshots: LiveNavSnapshot[] = [];
    const recalc = vi.fn(async () => null);
    const controller = new AmapLiveController({
      onSnapshot: (s) => snapshots.push(s),
      requestRecalculateRoute: recalc,
    });

    const route = buildZhuhaiNorthRouteFromWgs();
    controller.setMode("live");
    controller.setActiveRoute(route);

    // ~8m east of route in WGS-84 -> should snap back onto route longitude
    controller.ingestFix(makeFix({ sequence: 1, lat: 22.3720, lon: 113.57868, heading_deg: 0 }), BASE_TIME_MS + 100);
    const mid = snapshots[snapshots.length - 1];
    expect(mid.match).not.toBeNull();
    expect(mid.displayPositionGcj?.lon).toBeCloseTo(route.path[0].lon, 5);
    expect(mid.arrived).toBe(false);

    // Arrive within 25m of destination (lat 22.37495 vs 22.3750)
    controller.ingestFix(makeFix({ sequence: 2, lat: 22.37495, lon: 113.5786, heading_deg: 0 }, 1000), BASE_TIME_MS + 1050);
    const end = snapshots[snapshots.length - 1];
    expect(end.arrived).toBe(true);

    // Even if user walks >60m away after arrival, no off-route recalculation fires
    for (let i = 3; i <= 6; i++) {
      controller.ingestFix(makeFix({ sequence: i, lat: 22.37495, lon: 113.5800 }, i * 1000), BASE_TIME_MS + i * 1000 + 30);
    }
    expect(recalc).not.toHaveBeenCalled();
  });

  it("triggers exactly one off-route recalculation after 3 consecutive >50m fixes (accuracy <= 50m) and enforces 10s cooldown", async () => {
    const snapshots: LiveNavSnapshot[] = [];
    const newRouteStart = wgs84ToGcj02(22.3720, 113.5800);
    const newRouteEnd = wgs84ToGcj02(22.3750, 113.5800);
    const rerouted = buildIndexedAmapRoute({
      distance: 330,
      time: 40,
      steps: [{ instruction: "沿新规划金凤路向北行驶", path: [[newRouteStart.lon, newRouteStart.lat], [newRouteEnd.lon, newRouteEnd.lat]] }],
    });

    const recalc = vi.fn(async (_origin: GcjPoint) => rerouted);
    const controller = new AmapLiveController({
      onSnapshot: (s) => snapshots.push(s),
      requestRecalculateRoute: recalc,
    });

    controller.setMode("live");
    controller.setActiveRoute(buildZhuhaiNorthRouteFromWgs());

    // 3 consecutive fixes ~140m east of original route (within 1.5s)
    controller.ingestFix(makeFix({ sequence: 1, lat: 22.3720, lon: 113.5800, accuracy_m: 10 }, 200), BASE_TIME_MS + 230);
    expect(recalc).toHaveBeenCalledTimes(0);
    controller.ingestFix(makeFix({ sequence: 2, lat: 22.3722, lon: 113.5800, accuracy_m: 10 }, 400), BASE_TIME_MS + 430);
    expect(recalc).toHaveBeenCalledTimes(0);
    controller.ingestFix(makeFix({ sequence: 3, lat: 22.3724, lon: 113.5800, accuracy_m: 10 }, 600), BASE_TIME_MS + 630);
    expect(recalc).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await Promise.resolve();

    const afterReroute = snapshots[snapshots.length - 1];
    expect(afterReroute.recalculating).toBe(false);
    expect(afterReroute.statusText).toContain("重新规划");

    // Diverge again during 10s cooldown (at t = +3s) -> must NOT re-trigger yet
    for (let i = 4; i <= 7; i++) {
      controller.ingestFix(
        makeFix({ sequence: i, lat: 22.3725, lon: 113.5820, accuracy_m: 10 }, i * 500),
        BASE_TIME_MS + i * 500 + 30,
      );
    }
    expect(recalc).toHaveBeenCalledTimes(1);

    // After 10s cooldown passes (t = +12s), another valid off-route fix triggers recalculation #2
    controller.ingestFix(
      makeFix({ sequence: 8, lat: 22.3726, lon: 113.5820, accuracy_m: 10 }, 12_000),
      BASE_TIME_MS + 12_030,
    );
    expect(recalc).toHaveBeenCalledTimes(2);
  });

  it("handles unreachable route (requestRecalculateRoute returning null) with clear error status", async () => {
    const snapshots: LiveNavSnapshot[] = [];
    const recalc = vi.fn(async () => null);
    const controller = new AmapLiveController({
      onSnapshot: (s) => snapshots.push(s),
      requestRecalculateRoute: recalc,
    });

    controller.setMode("live");
    controller.setActiveRoute(buildZhuhaiNorthRouteFromWgs());

    for (let i = 1; i <= 3; i++) {
      controller.ingestFix(
        makeFix({ sequence: i, lat: 22.3720, lon: 113.5900, accuracy_m: 8 }, i * 300),
        BASE_TIME_MS + i * 300 + 20,
      );
    }

    await Promise.resolve();
    await Promise.resolve();

    const latest = snapshots[snapshots.length - 1];
    expect(recalc).toHaveBeenCalledTimes(1);
    expect(latest.recalculating).toBe(false);
    expect(latest.statusText).toContain("无可达");
  });

  it("ignores stale in-flight recalculation result after switching back to demo mode", async () => {
    let resolveReroute!: (r: IndexedAmapRoute | null) => void;
    const pendingPromise = new Promise<IndexedAmapRoute | null>((resolve) => {
      resolveReroute = resolve;
    });

    const snapshots: LiveNavSnapshot[] = [];
    const controller = new AmapLiveController({
      onSnapshot: (s) => snapshots.push(s),
      requestRecalculateRoute: () => pendingPromise,
    });

    const route = buildZhuhaiNorthRouteFromWgs();
    controller.setMode("live");
    controller.setActiveRoute(route);

    for (let i = 1; i <= 3; i++) {
      controller.ingestFix(
        makeFix({ sequence: i, lat: 22.3720, lon: 113.5810, accuracy_m: 8 }, i * 200),
        BASE_TIME_MS + i * 200 + 20,
      );
    }
    expect(snapshots[snapshots.length - 1].recalculating).toBe(true);

    // User switches to Demo mode before AMap Driving callback returns
    controller.setMode("demo");
    resolveReroute(route);
    await Promise.resolve();
    await Promise.resolve();

    const finalSnap = snapshots[snapshots.length - 1];
    expect(finalSnap.mode).toBe("demo");
    expect(finalSnap.recalculating).toBe(false);
    expect(finalSnap.statusText).not.toContain("重新规划");
  });
});
