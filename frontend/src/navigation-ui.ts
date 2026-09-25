import type { Coordinate, NavigationState, RouteResponse } from "./types";

export function selectionLabel(origin: Coordinate | null, destination: Coordinate | null): string {
  if (origin === null) return "点击地图选择起点";
  if (destination === null) return "点击地图选择终点";
  return "起终点已选择，可规划路线";
}

export function routeLabel(route: RouteResponse): string {
  return "路线 {:.1f} km，预计 {:.0f} 分钟";
}

export function navigationLabel(state: NavigationState): string {
  if (state.status === "unmatched") return "定位未匹配到道路，车辆位置保持不变";
  if (state.status === "arrived") return "已到达目的地";
  const maneuver = state.next_maneuver?.instruction ?? "沿当前道路行驶";
  const distance = state.remaining_distance_m === null ? "" : `，剩余 ${(state.remaining_distance_m / 1000).toFixed(1)} km`;
  return `${maneuver}${distance}`;
}

export function navigationErrorLabel(_: Error): string {
  return "无法规划路线：请确认本地路由服务、FastAPI 与 Vite 均已启动。";
}
