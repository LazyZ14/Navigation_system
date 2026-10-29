import { describe, expect, it, vi } from "vitest";
import { RequestVersion, VoiceSelection } from "../voice";

describe("voice candidate confirmation", () => {
  it("does not navigate after cancellation", async () => {
    const navigate = vi.fn();
    const selection = new VoiceSelection(navigate);
    selection.select({ name: "停车场", location: { lat: 22.3, lon: 113.5 } });
    selection.cancel();
    await selection.confirm();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates only after a candidate is confirmed", async () => {
    const navigate = vi.fn();
    const selection = new VoiceSelection(navigate);
    const place = { name: "停车场", location: { lat: 22.3, lon: 113.5 } };
    selection.select(place);
    expect(navigate).not.toHaveBeenCalled();
    await selection.confirm();
    expect(navigate).toHaveBeenCalledWith(place);
  });
});

describe("navigation request versions", () => {
  it("invalidates stale responses after a newer request or cancellation", () => {
    const version = new RequestVersion();
    const first = version.next();
    const second = version.next();
    expect(version.isCurrent(first)).toBe(false);
    expect(version.isCurrent(second)).toBe(true);
    version.invalidate();
    expect(version.isCurrent(second)).toBe(false);
  });
});
