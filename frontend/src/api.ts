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
  requireSafeDestination = false,
): Promise<NavigationSession> {
  const response = await fetch("/api/navigation/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin, destination, track_id: trackId, require_safe_destination: requireSafeDestination }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: { code?: string; distance_m?: number } };
    const code = body.detail?.code;
    if (code === "destination_snap_too_far") {
      const distance = body.detail?.distance_m;
      throw new Error(`目的地距离可行驶道路过远${typeof distance === "number" && Number.isFinite(distance) ? `（约 ${Math.round(distance)} 米）` : ""}，无法安全规划`);
    }
    if (code === "destination_snap_policy_unavailable") throw new Error("请先配置目的地道路吸附距离阈值");
    if (code === "destination_snap_unavailable") throw new Error("无法验证目的地道路吸附距离");
    if (code === "route_not_found") throw new Error("起点到目的地没有可达路线");
    throw new Error("无法创建导航会话");
  }
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
