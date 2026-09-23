import type { Coordinate, RouteResponse } from "./types";

export async function requestRoute(origin: Coordinate, destination: Coordinate): Promise<RouteResponse> {
  const response = await fetch("/api/routes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin, destination }),
  });
  if (!response.ok) throw new Error("路线规划失败");
  return response.json() as Promise<RouteResponse>;
}
