import { afterEach, describe, expect, it, vi } from "vitest";

import { pauseReplay, resumeReplay } from "../api";

afterEach(() => vi.unstubAllGlobals());

describe("replay API", () => {
  it.each([
    [pauseReplay, "pause"],
    [resumeReplay, "resume"],
  ])("sends replay control through FastAPI", async (control, action) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await control("session-1");

    expect(fetchMock).toHaveBeenCalledWith(`/api/navigation/session-1/replay/${action}`, { method: "POST" });
  });
});
