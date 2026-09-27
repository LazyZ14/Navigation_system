import { afterEach, describe, expect, it, vi } from "vitest";

import { getNavigationSession, pauseReplay, resumeReplay } from "../api";

afterEach(() => vi.unstubAllGlobals());

describe("replay API", () => {
  it("restores a session through the public FastAPI endpoint", async () => {
    const session = { session_id: "session-1", route: {}, state: {} };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(session) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getNavigationSession("session-1")).resolves.toBe(session);
    expect(fetchMock).toHaveBeenCalledWith("/api/navigation/session-1");
  });

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
