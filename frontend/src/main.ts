import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import maplibregl from "maplibre-gl";

import { createNavigationSession, getNavigationSession, pauseReplay, requestReplayNext, resumeReplay } from "./api";
import { MapController } from "./map-controller";
import { MAP_VISUAL_TOKENS, registerBaseMap, type BaseMapLike } from "./map-style";
import { navigationErrorLabel, navigationLabel, selectionLabel } from "./navigation-ui";
import type { Coordinate } from "./types";

const map = new maplibregl.Map({
  container: "map",
  center: [116.402, 39.8997],
  zoom: 15,
  style: {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": MAP_VISUAL_TOKENS.background } }],
  },
});

const status = document.querySelector<HTMLParagraphElement>("#selection-status")!;
const button = document.querySelector<HTMLButtonElement>("#plan-route")!;
const summary = document.querySelector<HTMLParagraphElement>("#route-summary")!;
const replayButton = document.querySelector<HTMLButtonElement>("#start-replay")!;
const trackSelect = document.querySelector<HTMLSelectElement>("#track-select")!;
const demoOrigin: Coordinate = { lat: 39.9, lon: 116.4 };
const demoDestination: Coordinate = { lat: 39.8994, lon: 116.404 };
const sessionStorageKey = "offline-navigation-session";
let origin: Coordinate | null = demoOrigin;
let destination: Coordinate | null = demoDestination;
let originMarker: maplibregl.Marker | null = null;
let destinationMarker: maplibregl.Marker | null = null;
let sessionId: string | null = null;
let replayTimer: number | null = null;
let replayCompleted = false;
let replayRunning = false;

function stopReplayTimer(): void {
  replayRunning = false;
  if (replayTimer !== null) window.clearTimeout(replayTimer);
  replayTimer = null;
}

function saveSession(): void {
  if (sessionId === null || origin === null || destination === null) return;
  sessionStorage.setItem(
    sessionStorageKey,
    JSON.stringify({ sessionId, origin, destination, trackId: trackSelect.value }),
  );
}

function loadSavedSession(): { sessionId: string; origin: Coordinate; destination: Coordinate; trackId: string } | null {
  const value = sessionStorage.getItem(sessionStorageKey);
  if (value === null) return null;
  try {
    return JSON.parse(value) as { sessionId: string; origin: Coordinate; destination: Coordinate; trackId: string };
  } catch {
    sessionStorage.removeItem(sessionStorageKey);
    return null;
  }
}

function refreshSelection(): void {
  status.textContent = selectionLabel(origin, destination);
  button.disabled = origin === null || destination === null;
}

map.on("load", async () => {
  try {
    const sourceNames = ["roads", "buildings", "water", "green", "landuse"] as const;
    const collections = await Promise.all(sourceNames.map(async (name) => {
      const response = await fetch(`/generated/${name}.geojson`);
      if (!response.ok) throw new Error("offline map data unavailable");
      const collection = (await response.json()) as { type: string; features: unknown };
      if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) throw new Error("offline map data invalid");
      return collection as { type: "FeatureCollection"; features: unknown[] };
    }));
    registerBaseMap(map as unknown as BaseMapLike, Object.fromEntries(sourceNames.map((name, index) => [name, collections[index]])) as Parameters<typeof registerBaseMap>[1]);
  } catch {
    summary.textContent = "无法加载离线地图数据：请先运行地图构建脚本。";
    button.disabled = true;
    return;
  }
  const controller = new MapController(map as unknown as import("./map-controller").MapLike);
  originMarker = new maplibregl.Marker({ color: "#16a34a" }).setLngLat([demoOrigin.lon, demoOrigin.lat]).addTo(map);
  destinationMarker = new maplibregl.Marker({ color: "#dc2626" }).setLngLat([demoDestination.lon, demoDestination.lat]).addTo(map);
  const saved = loadSavedSession();
  if (saved !== null) {
    try {
      const session = await getNavigationSession(saved.sessionId);
      sessionId = saved.sessionId;
      origin = saved.origin;
      destination = saved.destination;
      trackSelect.value = saved.trackId;
      originMarker.setLngLat([origin.lon, origin.lat]);
      destinationMarker.setLngLat([destination.lon, destination.lat]);
      controller.renderRoute(session.route);
      controller.updateNavigation(session.state);
      summary.textContent = navigationLabel(session.state);
      replayCompleted = session.state.status === "arrived" || session.state.status === "replay_finished";
      replayButton.disabled = false;
      replayButton.textContent = replayCompleted ? "重新模拟回放" : "继续模拟回放";
      refreshSelection();
    } catch {
      sessionStorage.removeItem(sessionStorageKey);
    }
  }
  map.on("click", (event) => {
    const geographicCoordinate: Coordinate = { lat: event.lngLat.lat, lon: event.lngLat.lng };
    if (origin === null || destination !== null) {
      origin = geographicCoordinate;
      destination = null;
      originMarker?.remove();
      destinationMarker?.remove();
      originMarker = new maplibregl.Marker({ color: "#16a34a" })
        .setLngLat([geographicCoordinate.lon, geographicCoordinate.lat])
        .addTo(map);
      destinationMarker = null;
      controller.clearRoute();
      summary.textContent = "";
      sessionId = null;
      sessionStorage.removeItem(sessionStorageKey);
      replayButton.disabled = true;
      replayButton.textContent = "开始模拟回放";
      replayCompleted = false;
      stopReplayTimer();
    } else {
      destination = geographicCoordinate;
      destinationMarker = new maplibregl.Marker({ color: "#dc2626" })
        .setLngLat([geographicCoordinate.lon, geographicCoordinate.lat])
        .addTo(map);
    }
    refreshSelection();
  });
  button.addEventListener("click", async () => {
    if (origin === null || destination === null) return;
    try {
      stopReplayTimer();
      const session = await createNavigationSession(origin, destination, trackSelect.value);
      sessionId = session.session_id;
      controller.resetNavigation();
      controller.renderRoute(session.route);
      summary.textContent = navigationLabel(session.state);
      replayButton.disabled = false;
      replayButton.textContent = "开始模拟回放";
      replayCompleted = false;
      saveSession();
    } catch (error) {
      summary.textContent = navigationErrorLabel(error instanceof Error ? error : new Error("unknown"));
    }
  });
  const advanceReplay = async (): Promise<void> => {
    replayTimer = null;
    if (!replayRunning || sessionId === null) return;
    try {
      const session = await requestReplayNext(sessionId);
      controller.renderRoute(session.route);
      controller.updateNavigation(session.state);
      summary.textContent = navigationLabel(session.state);
      if (session.state.status === "arrived" || session.state.status === "replay_finished") {
        stopReplayTimer();
        replayCompleted = true;
        replayButton.textContent = "重新模拟回放";
      } else if (replayRunning) {
        replayTimer = window.setTimeout(() => void advanceReplay(), 1000);
      }
    } catch (error) {
      stopReplayTimer();
      replayButton.textContent = "继续模拟回放";
      summary.textContent = navigationErrorLabel(error instanceof Error ? error : new Error("unknown"));
    }
  };
  replayButton.addEventListener("click", async () => {
    if (sessionId === null || origin === null || destination === null) return;
    try {
      if (replayRunning) {
        stopReplayTimer();
        await pauseReplay(sessionId);
        replayButton.textContent = "继续模拟回放";
        return;
      }
      if (replayCompleted) {
        const session = await createNavigationSession(origin, destination, trackSelect.value);
        sessionId = session.session_id;
        controller.resetNavigation();
        controller.renderRoute(session.route);
        replayCompleted = false;
        saveSession();
      }
      await resumeReplay(sessionId);
      replayRunning = true;
      replayButton.textContent = "暂停模拟回放";
      replayTimer = window.setTimeout(() => void advanceReplay(), 0);
    } catch (error) {
      stopReplayTimer();
      replayButton.textContent = "继续模拟回放";
      summary.textContent = navigationErrorLabel(error instanceof Error ? error : new Error("unknown"));
    }
  });
});

refreshSelection();
