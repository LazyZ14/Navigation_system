import type { Coordinate, NavigationSession, RouteResponse } from "./types";

export async function requestRoute(origin: Coordinate, destination: Coordinate): Promise<RouteResponse> {
  const response = await fetch("/api/routes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin, destination }),
  });
  if (!response.ok) throw new Error("路线规划失败");
  return response.json() as Promise<RouteResponse>;
}

export async function createNavigationSession(
  origin: Coordinate,
  destination: Coordinate,
  trackId: string,
): Promise<NavigationSession> {
  const response = await fetch("/api/navigation/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin, destination, track_id: trackId }),
  });
  if (!response.ok) throw new Error("无法创建导航会话");
  return response.json() as Promise<NavigationSession>;
}

export async function getNavigationSession(sessionId: string): Promise<NavigationSession> {
  const response = await fetch(`/api/navigation/${sessionId}`);
  if (!response.ok) throw new Error("无法恢复导航会话");
  return response.json() as Promise<NavigationSession>;
}

export async function requestReplayNext(sessionId: string): Promise<NavigationSession> {
  const response = await fetch(`/api/navigation/${sessionId}/replay/next`, { method: "POST" });
  if (!response.ok) throw new Error("无法推进模拟定位回放");
  return response.json() as Promise<NavigationSession>;
}

async function controlReplay(sessionId: string, action: "pause" | "resume"): Promise<void> {
  const response = await fetch(`/api/navigation/${sessionId}/replay/${action}`, { method: "POST" });
  if (!response.ok) throw new Error(`无法${action === "pause" ? "暂停" : "继续"}模拟定位回放`);
}

export function pauseReplay(sessionId: string): Promise<void> {
  return controlReplay(sessionId, "pause");
}

export function resumeReplay(sessionId: string): Promise<void> {
  return controlReplay(sessionId, "resume");
}
