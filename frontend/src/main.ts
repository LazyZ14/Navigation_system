import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import maplibregl from "maplibre-gl";

import { createNavigationSession, requestReplayNext } from "./api";
import { MapController } from "./map-controller";
import { navigationLabel, selectionLabel } from "./navigation-ui";
import type { Coordinate } from "./types";

const map = new maplibregl.Map({
  container: "map",
  center: [116.392, 39.889],
  zoom: 13,
  style: {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": "#f8fafc" } }],
  },
});

const status = document.querySelector<HTMLParagraphElement>("#selection-status")!;
const button = document.querySelector<HTMLButtonElement>("#plan-route")!;
const summary = document.querySelector<HTMLParagraphElement>("#route-summary")!;
const replayButton = document.querySelector<HTMLButtonElement>("#start-replay")!;
let origin: Coordinate | null = null;
let destination: Coordinate | null = null;
let originMarker: maplibregl.Marker | null = null;
let destinationMarker: maplibregl.Marker | null = null;
let sessionId: string | null = null;
let replayTimer: number | null = null;

function refreshSelection(): void {
  status.textContent = selectionLabel(origin, destination);
  button.disabled = origin === null || destination === null;
}

map.on("load", async () => {
  const roads = await fetch("/generated/map-roads.geojson").then((response) => response.json());
  map.addSource("roads", { type: "geojson", data: roads });
  map.addLayer({
    id: "roads-line",
    type: "line",
    source: "roads",
    paint: {
      "line-color": ["match", ["get", "class"], "primary", "#64748b", "secondary", "#94a3b8", "#cbd5e1"],
      "line-width": ["match", ["get", "class"], "primary", 3, "secondary", 2, 1],
    },
  });
  const controller = new MapController(map as unknown as import("./map-controller").MapLike);
  map.on("click", (event) => {
    const point = { lat: event.lngLat.lat, lon: event.lngLat.lng };
    if (origin === null || destination !== null) {
      origin = point;
      destination = null;
      originMarker?.remove();
      destinationMarker?.remove();
      originMarker = new maplibregl.Marker({ color: "#16a34a" }).setLngLat([point.lon, point.lat]).addTo(map);
      destinationMarker = null;
      controller.clearRoute();
      summary.textContent = "";
      sessionId = null;
      replayButton.disabled = true;
      if (replayTimer !== null) window.clearInterval(replayTimer);
    } else {
      destination = point;
      destinationMarker = new maplibregl.Marker({ color: "#dc2626" }).setLngLat([point.lon, point.lat]).addTo(map);
    }
    refreshSelection();
  });
  button.addEventListener("click", async () => {
    if (origin === null || destination === null) return;
    const session = await createNavigationSession(origin, destination, "normal-route");
    sessionId = session.session_id;
    controller.renderRoute(session.route);
    summary.textContent = navigationLabel(session.state);
    replayButton.disabled = false;
  });
  replayButton.addEventListener("click", () => {
    if (sessionId === null || replayTimer !== null) return;
    replayTimer = window.setInterval(async () => {
      if (sessionId === null) return;
      const session = await requestReplayNext(sessionId);
      controller.renderRoute(session.route);
      controller.updateNavigation(session.state);
      summary.textContent = navigationLabel(session.state);
      if (session.state.status === "arrived") {
        window.clearInterval(replayTimer!);
        replayTimer = null;
      }
    }, 1000);
  });
});

refreshSelection();
