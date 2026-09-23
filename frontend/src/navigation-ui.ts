import type { Coordinate, RouteResponse } from "./types";

export function selectionLabel(origin: Coordinate | null, destination: Coordinate | null): string {
  if (origin === null) return "点击地图选择起点";
  if (destination === null) return "点击地图选择终点";
  return "起终点已选择，可规划路线";
}

export function routeLabel(route: RouteResponse): string {
  return "路线 {:.1f} km，预计 {:.0f} 分钟";
}
