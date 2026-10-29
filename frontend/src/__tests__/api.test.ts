import { afterEach, describe, expect, it, vi } from "vitest";

import { createNavigationSession, getNavigationSession, pauseReplay, resumeReplay } from "../api";

afterEach(() => vi.unstubAllGlobals());

describe("replay API", () => {
  it("requests destination snap verification for voice navigation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);
    const origin = { lat: 22.37, lon: 113.58 };
    const destination = { lat: 22.38, lon: 113.55 };
    await createNavigationSession(origin, destination, "current-route", true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ require_safe_destination: true });
  });
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
