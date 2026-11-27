import { describe, expect, it } from "vitest";
import {
  buildIndexedAmapRoute,
  matchPointToAmapRoute,
  UnroutedJitterFilter,
} from "../amap-route-matcher";

describe("amap-route-matcher", () => {
  it("builds indexed route and skips consecutive duplicate zero-length vertices without NaN", () => {
    const rawRoute = {
      distance: 1000,
      time: 120,
      steps: [
        {
          instruction: "沿港湾大道向北行驶 500 米",
          path: [
            { getLng: () => 113.5786, getLat: () => 22.3700 },
            { getLng: () => 113.5786, getLat: () => 22.3700 }, // duplicate vertex
            { getLng: () => 113.5786, getLat: () => 22.3745 },
          ],
        },
        {
          instruction: "右转进入软件园路行驶 500 米",
          path: [
            [113.5786, 22.3745] as [number, number], // step boundary duplicate
            [113.5835, 22.3745] as [number, number],
          ],
        },
      ],
    };

    const indexed = buildIndexedAmapRoute(rawRoute);
    expect(indexed.path.length).toBe(3);
    expect(indexed.steps.length).toBe(2);
    expect(indexed.totalDistanceM).toBeGreaterThan(950);

    const match = matchPointToAmapRoute({ lat: 22.3720, lon: 113.57865 }, indexed, null, 0);
    expect(Number.isFinite(match.distanceToRouteM)).toBe(true);
    expect(Number.isFinite(match.segmentHeadingDeg)).toBe(true);
    expect(match.distanceToRouteM).toBeLessThan(10);
  });

  it("snaps vehicle onto route polyline, advances step instructions, and detects arrival within 25m", () => {
    const indexed = buildIndexedAmapRoute({
      distance: 1000,
      time: 100,
      steps: [
        {
          instruction: "沿港湾大道向北直行",
          path: [
            [113.5786, 22.3700],
            [113.5786, 22.3745],
          ],
        },
        {
          instruction: "右转进入金凤路到达终点",
          path: [
            [113.5786, 22.3745],
            [113.5835, 22.3745],
          ],
        },
      ],
    });

    // ~6m east of northbound leg
    const first = matchPointToAmapRoute({ lat: 22.3720, lon: 113.57866 }, indexed, null, 2);
    expect(first.projected.lon).toBeCloseTo(113.5786, 5);
    expect(first.projected.lat).toBeCloseTo(22.3720, 4);
    expect(first.distanceToRouteM).toBeLessThan(10);
    expect(first.currentStepIndex).toBe(0);
    expect(first.currentInstruction).toBe("沿港湾大道向北直行");
    expect(first.nextInstruction).toBe("右转进入金凤路到达终点");
    expect(first.arrived).toBe(false);

    // Move onto eastbound second leg
    const second = matchPointToAmapRoute({ lat: 22.37448, lon: 113.5810 }, indexed, first, 90);
    expect(second.currentStepIndex).toBe(1);
    expect(second.currentInstruction).toBe("右转进入金凤路到达终点");
    expect(second.nextInstruction).toBeNull();
    expect(second.remainingDistanceM).toBeLessThan(first.remainingDistanceM);
    expect(second.arrived).toBe(false);

    // Within 25m of destination
    const nearEnd = matchPointToAmapRoute({ lat: 22.3745, lon: 113.5834 }, indexed, second, 90);
    expect(nearEnd.remainingDistanceM).toBeLessThanOrEqual(25);
    expect(nearEnd.arrived).toBe(true);
  });

  it("wraps heading across 359 to 1 degree north boundary and disambiguates opposite-direction parallel lane", () => {
    // Northbound out (heading ~0°), U-turn, southbound back (heading ~180°) 4m apart
    const indexed = buildIndexedAmapRoute({
      steps: [
        {
          instruction: "向北行驶",
          path: [
            [113.57860, 22.3700],
            [113.57860, 22.3750],
          ],
        },
        {
          instruction: "掉头向南行驶",
          path: [
            [113.57860, 22.3750],
            [113.57864, 22.3750],
            [113.57864, 22.3700],
          ],
        },
      ],
    });

    // Vehicle between the two lanes heading 359° (almost due north, wrapping 0°)
    const northMatch = matchPointToAmapRoute({ lat: 22.3725, lon: 113.57862 }, indexed, null, 359);
    expect(northMatch.segmentIndex).toBe(0);
    expect(northMatch.currentInstruction).toBe("向北行驶");

    // Vehicle at exact same spot heading 181° (southbound)
    const southMatch = matchPointToAmapRoute({ lat: 22.3725, lon: 113.57862 }, indexed, null, 181);
    expect(southMatch.segmentIndex).toBe(2);
    expect(southMatch.currentInstruction).toBe("掉头向南行驶");
  });

  it("reports large distanceToRouteM (> 50m) when vehicle moves off-road or onto diverging street", () => {
    const indexed = buildIndexedAmapRoute({
      steps: [
        {
          instruction: "沿情侣路向北直行",
          path: [
            [113.5786, 22.3700],
            [113.5786, 22.3750],
          ],
        },
      ],
    });

    // ~120m east of the route
    const offRoad = matchPointToAmapRoute({ lat: 22.3725, lon: 113.5798 }, indexed, null, 90);
    expect(offRoad.distanceToRouteM).toBeGreaterThan(80);
  });

  it("freezes position and heading inside 3m stationary deadzone and smooths when moving", () => {
    const filter = new UnroutedJitterFilter();

    const first = filter.update({ lat: 22.3734, lon: 113.5786 }, 0, 85);
    expect(first.position).toEqual({ lat: 22.3734, lon: 113.5786 });
    expect(first.headingDeg).toBe(85);

    // Stationary drift ~1.5m with wild GPS heading noise (270°) while speed = 0.2 m/s
    const drifted = filter.update({ lat: 22.37341, lon: 113.57861 }, 0.2, 270);
    expect(drifted.position).toEqual({ lat: 22.3734, lon: 113.5786 });
    expect(drifted.headingDeg).toBe(85);

    // Real movement (~22m north, speed = 6.5 m/s, heading = 10°)
    const moved = filter.update({ lat: 22.3736, lon: 113.5786 }, 6.5, 10);
    expect(moved.position.lat).toBeGreaterThan(22.3734);
    expect(moved.position.lat).toBeLessThan(22.3736); // EMA smoothed
    expect(moved.headingDeg).toBe(10);
  });
});
