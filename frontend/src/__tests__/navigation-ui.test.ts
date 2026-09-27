import { describe, expect, it } from "vitest";

import { navigationErrorLabel, navigationLabel } from "../navigation-ui";

describe("navigationLabel", () => {
  it("shows a visible warning when the latest fix was not road matched", () => {
    expect(
      navigationLabel({
        status: "unmatched",
        raw_location: null,
        matched_location: null,
        next_maneuver: null,
        remaining_distance_m: null,
        off_route: false,
      }),
    ).toContain("未匹配");
  });

  it("tells the operator when the local routing service is unavailable", () => {
    expect(navigationErrorLabel(new Error("无法创建导航会话"))).toContain("本地路由服务");
  });

  it("announces a replacement route for the replan state", () => {
    expect(
      navigationLabel({
        status: "navigating",
        raw_location: null,
        matched_location: { lat: 39.9, lon: 116.4 },
        next_maneuver: null,
        remaining_distance_m: 800,
        off_route: true,
      }),
    ).toContain("已重新规划路线");
  });
});
