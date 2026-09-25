import { describe, expect, it } from "vitest";

import { navigationLabel } from "../navigation-ui";

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
});
