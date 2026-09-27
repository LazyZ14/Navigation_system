import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import maplibregl from "maplibre-gl";

import { createNavigationSession, pauseReplay, requestReplayNext, resumeReplay } from "./api";
import { MapController } from "./map-controller";
import { navigationErrorLabel, navigationLabel, selectionLabel } from "./navigation-ui";
import type { Coordinate } from "./types";

const map = new maplibregl.Map({
  container: "map",
  center: [116.402, 39.8997],
  zoom: 15,
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
const trackSelect = document.querySelector<HTMLSelectElement>("#track-select")!;
const demoOrigin: Coordinate = { lat: 39.9, lon: 116.4 };
const demoDestination: Coordinate = { lat: 39.8994, lon: 116.404 };
let origin: Coordinate | null = demoOrigin;
let destination: Coordinate | null = demoDestination;
let originMarker: maplibregl.Marker | null = null;
let destinationMarker: maplibregl.Marker | null = null;
let sessionId: string | null = null;
let replayTimer: number | null = null;
let replayCompleted = false;

function stopReplayTimer(): void {
  if (replayTimer !== null) window.clearInterval(replayTimer);
  replayTimer = null;
}

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
  originMarker = new maplibregl.Marker({ color: "#16a34a" }).setLngLat([demoOrigin.lon, demoOrigin.lat]).addTo(map);
  destinationMarker = new maplibregl.Marker({ color: "#dc2626" }).setLngLat([demoDestination.lon, demoDestination.lat]).addTo(map);
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
      replayButton.textContent = "开始模拟回放";
      replayCompleted = false;
      stopReplayTimer();
    } else {
      destination = point;
      destinationMarker = new maplibregl.Marker({ color: "#dc2626" }).setLngLat([point.lon, point.lat]).addTo(map);
    }
    refreshSelection();
  });
  button.addEventListener("click", async () => {
    if (origin === null || destination === null) return;
    try {
      stopReplayTimer();
      const session = await createNavigationSession(origin, destination, trackSelect.value);
      sessionId = session.session_id;
      controller.renderRoute(session.route);
      summary.textContent = navigationLabel(session.state);
      replayButton.disabled = false;
      replayButton.textContent = "开始模拟回放";
      replayCompleted = false;
    } catch (error) {
      summary.textContent = navigationErrorLabel(error instanceof Error ? error : new Error("unknown"));
    }
  });
  replayButton.addEventListener("click", async () => {
    if (sessionId === null || origin === null || destination === null) return;
    if (replayTimer !== null) {
      stopReplayTimer();
      await pauseReplay(sessionId);
      replayButton.textContent = "继续模拟回放";
      return;
    }
    if (replayCompleted) {
      const session = await createNavigationSession(origin, destination, trackSelect.value);
      sessionId = session.session_id;
      controller.renderRoute(session.route);
      replayCompleted = false;
    }
    await resumeReplay(sessionId);
    replayButton.textContent = "暂停模拟回放";
    replayTimer = window.setInterval(async () => {
      if (sessionId === null) return;
      try {
        const session = await requestReplayNext(sessionId);
        controller.renderRoute(session.route);
        controller.updateNavigation(session.state);
        summary.textContent = navigationLabel(session.state);
        if (session.state.status === "arrived" || session.state.status === "replay_finished") {
          stopReplayTimer();
          replayCompleted = true;
          replayButton.textContent = "重新模拟回放";
        }
      } catch (error) {
        stopReplayTimer();
        replayButton.textContent = "继续模拟回放";
        summary.textContent = navigationErrorLabel(error instanceof Error ? error : new Error("unknown"));
      }
    }, 1000);
  });
});

refreshSelection();
