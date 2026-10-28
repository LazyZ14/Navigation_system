import { describe, expect, it, vi } from "vitest";
import { VoiceSelection } from "../voice";

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
