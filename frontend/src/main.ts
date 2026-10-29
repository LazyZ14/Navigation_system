import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import maplibregl from "maplibre-gl";

import { createNavigationSession, getNavigationSession, pauseReplay, requestReplayNext, resumeReplay } from "./api";
import { MapController } from "./map-controller";
import { MAP_VISUAL_TOKENS, registerBaseMap, type BaseMapLike } from "./map-style";
import { navigationErrorLabel, navigationLabel, selectionLabel } from "./navigation-ui";
import type { Coordinate } from "./types";
import { RequestVersion, VoiceSelection, type Candidate } from "./voice";

const map = new maplibregl.Map({
  container: "map",
  center: [113.5546, 22.3924],
  zoom: 15,
  localIdeographFontFamily: "PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif",
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
const demoOrigin: Coordinate = { lat: 22.3718, lon: 113.5806 };
const demoDestination: Coordinate = { lat: 22.3691, lon: 113.5714 };
const sessionStorageKey = "offline-navigation-session";
let origin: Coordinate | null = demoOrigin;
let destination: Coordinate | null = demoDestination;
let originMarker: maplibregl.Marker | null = null;
let destinationMarker: maplibregl.Marker | null = null;
let sessionId: string | null = null;
let replayTimer: number | null = null;
let replayCompleted = false;
let replayRunning = false;
let safeDestinationRequired = false;

function stopReplayTimer(): void {
  replayRunning = false;
  if (replayTimer !== null) window.clearTimeout(replayTimer);
  replayTimer = null;
}

function saveSession(): void {
  if (sessionId === null || origin === null || destination === null) return;
  sessionStorage.setItem(
    sessionStorageKey,
    JSON.stringify({ sessionId, origin, destination, trackId: trackSelect.value, safeDestinationRequired }),
  );
}

function loadSavedSession(): { sessionId: string; origin: Coordinate; destination: Coordinate; trackId: string; safeDestinationRequired?: boolean } | null {
  const value = sessionStorage.getItem(sessionStorageKey);
  if (value === null) return null;
  try {
    return JSON.parse(value) as { sessionId: string; origin: Coordinate; destination: Coordinate; trackId: string; safeDestinationRequired?: boolean };
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
    const sourceNames = ["roads", "buildings", "water", "green", "landuse", "road-labels", "place-labels", "poi"] as const;
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
  const voiceText = document.querySelector<HTMLInputElement>("#voice-text")!;
  const voiceStatus = document.querySelector<HTMLParagraphElement>("#voice-status")!;
  const voiceIntent = document.querySelector<HTMLParagraphElement>("#voice-intent")!;
  const candidateList = document.querySelector<HTMLDivElement>("#voice-candidates")!;
  const confirm = document.querySelector<HTMLButtonElement>("#voice-confirm")!;
  const record = document.querySelector<HTMLButtonElement>("#voice-record")!;
  let candidateMarkers: maplibregl.Marker[] = [];
  let recorder: MediaRecorder | null = null;
  let generation = 0;
  const planGeneration = new RequestVersion();
  let roadDestinationMarker: maplibregl.Marker | null = null;
  async function planRoute(selectedDestination: Coordinate, requireSafeDestination: boolean): Promise<void> {
    if (!origin) { voiceStatus.textContent = "请先选择起点"; return; }
    const planVersion = planGeneration.next();
    const selectedOrigin = origin;
    const selectedTrack = trackSelect.value;
    try {
      const session = await createNavigationSession(selectedOrigin, selectedDestination, selectedTrack, requireSafeDestination);
      if (!planGeneration.isCurrent(planVersion)) return;
      stopReplayTimer();
      destination = selectedDestination;
      safeDestinationRequired = requireSafeDestination;
      destinationMarker?.remove();
      destinationMarker = new maplibregl.Marker({ color: "#dc2626" }).setLngLat([destination.lon, destination.lat]).addTo(map);
      roadDestinationMarker?.remove();
      roadDestinationMarker = null;
      if (requireSafeDestination && session.route.road_destination) {
        const road = session.route.road_destination;
        roadDestinationMarker = new maplibregl.Marker({ color: "#2563eb" }).setLngLat([road.lon, road.lat]).setPopup(new maplibregl.Popup().setText(`道路终点，与地点相距 ${Math.round(session.route.destination_snap_distance_m ?? 0)} 米`)).addTo(map);
      }
      sessionId = session.session_id;
      controller.resetNavigation();
      controller.renderRoute(session.route);
      summary.textContent = navigationLabel(session.state);
      if (requireSafeDestination && session.route.destination_snap_distance_m != null) voiceStatus.textContent = `路线已规划；道路终点与地点相距 ${Math.round(session.route.destination_snap_distance_m)} 米`;
      replayButton.disabled = false;
      replayButton.textContent = "开始模拟回放";
      replayCompleted = false;
      refreshSelection();
      saveSession();
    } catch (error) {
      if (!planGeneration.isCurrent(planVersion)) return;
      if (requireSafeDestination) voiceStatus.textContent = error instanceof Error ? error.message : "无法规划路线";
      else summary.textContent = navigationErrorLabel(error instanceof Error ? error : new Error("unknown"));
    }
  }
  const selection = new VoiceSelection(async (candidate: Candidate) => {
    if (!origin) { voiceStatus.textContent = "请先选择起点"; return; }
    await planRoute(candidate.location, true);
  });
  function clearCandidates(): void {
    selection.cancel();
    confirm.disabled = true;
    candidateList.replaceChildren();
    candidateMarkers.forEach((marker) => marker.remove());
    candidateMarkers = [];
  }
  async function parseVoice(): Promise<void> {
    const text = voiceText.value.trim();
    if (!text) { voiceStatus.textContent = "请输入目的地需求"; return; }
    const current = ++generation;
    clearCandidates();
    voiceStatus.textContent = "正在理解需求…";
    try {
      const response = await fetch("/api/voice/intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, origin }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { detail?: string };
        throw new Error(body.detail === "poi_catalog_rebuild_required" ? "地点检索数据未生成，请重新构建地图数据" : "需求解析或地点数据不可用");
      }
      const result = await response.json() as { intent: { intent: string; destination_query: string; category?: string | null; requires_clarification: boolean; constraints?: { text: string; status: string }[] }; candidates: (Candidate & { distance_m?: number })[]; distance_basis?: string | null };
      if (current !== generation) return;
      const categoryNames: Record<string, string> = { food: "餐饮", cafe: "咖啡店", parking: "停车场", fuel: "加油站", hotel: "酒店", park: "公园", supermarket: "超市", convenience: "便利店", pharmacy: "药店", bank: "银行", police: "警察局", station: "车站", bakery: "面包店", mall: "商场", department_store: "百货店", clothes: "服装店", books: "书店", attraction: "景点", museum: "博物馆", sports_centre: "体育中心", stadium: "体育场", government: "政府机构", school: "学校", university: "大学", hospital: "医院" };
      const destinationLabel = result.intent.destination_query || categoryNames[result.intent.category || ""] || "未明确";
      voiceIntent.textContent = `意图：${result.intent.intent === "navigate_to_poi" ? "查找地点" : "无法识别"}；需求：${destinationLabel}`;
      const unverified = result.intent.constraints?.filter((item) => item.status !== "verified").map((item) => item.text).join("、");
      voiceStatus.textContent = result.intent.requires_clarification ? (unverified ? `无法验证条件：${unverified}；请调整需求` : "请明确目的地") : result.candidates.length ? "请选择候选地点" : "没有找到候选地点";
      for (const [index, candidate] of result.candidates.entries()) {
        const option = document.createElement("button");
        option.type = "button";
        const distance = result.distance_basis === "straight_line" && candidate.distance_m != null ? `，距所选起点直线 ${Math.round(candidate.distance_m)} 米` : "";
        option.textContent = `${index + 1}. ${candidate.name}${distance} (${candidate.location.lat.toFixed(4)}, ${candidate.location.lon.toFixed(4)})`;
        option.addEventListener("click", () => { selection.select(candidate); confirm.disabled = false; voiceStatus.textContent = `已选择：${candidate.name}`; });
        candidateList.append(option);
        candidateMarkers.push(new maplibregl.Marker({ color: "#f59e0b" }).setLngLat([candidate.location.lon, candidate.location.lat]).setPopup(new maplibregl.Popup().setText(`${index + 1}. ${candidate.name}`)).addTo(map));
      }
    } catch (error) { if (current === generation) voiceStatus.textContent = error instanceof Error ? error.message : "解析失败"; }
  }
  document.querySelector<HTMLButtonElement>("#voice-submit")!.addEventListener("click", () => void parseVoice());
  voiceText.addEventListener("input", () => { generation++; planGeneration.invalidate(); if (recorder?.state === "recording") recorder.stop(); clearCandidates(); voiceIntent.textContent = ""; });
  trackSelect.addEventListener("change", () => planGeneration.invalidate());
  document.querySelector<HTMLButtonElement>("#voice-cancel")!.addEventListener("click", () => { generation++; planGeneration.invalidate(); if (recorder?.state === "recording") recorder.stop(); clearCandidates(); voiceStatus.textContent = "已取消"; });
  confirm.addEventListener("click", () => { confirm.disabled = true; void selection.confirm(); });
  record.addEventListener("click", async () => {
    if (recorder && recorder.state === "recording") { recorder.stop(); return; }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { voiceStatus.textContent = "录音需要 HTTPS 或 localhost 安全上下文"; return; }
    let activeStream: MediaStream | null = null;
    const current = ++generation;
    try {
      planGeneration.invalidate();
      clearCandidates();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeStream = stream;
      if (current !== generation) { stream.getTracks().forEach((track) => track.stop()); return; }
      const chunks: Blob[] = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        record.textContent = "开始录音";
        if (current !== generation) return;
        voiceStatus.textContent = "正在识别语音…";
        try {
          const response = await fetch("/api/voice/transcribe", { method: "POST", body: new Blob(chunks, { type: recorder?.mimeType }) });
          if (!response.ok) {
            const body = await response.json().catch(() => ({})) as { detail?: string };
            throw new Error(body.detail === "asr_not_configured" ? "腾讯云语音识别尚未配置密钥" : response.status === 422 ? "未检测到语音" : response.status === 400 ? "录音无效或超过 60 秒" : response.status === 408 ? "录音上传超时，请重试" : response.status === 413 ? "录音文件超过大小限制" : response.status === 415 ? "当前浏览器的录音格式不受支持" : response.status === 429 ? "语音服务繁忙，请稍后再试" : response.status === 504 ? "语音识别超时，请重试" : response.status === 403 ? "当前页面来源未获授权" : "语音识别失败或服务不可用");
          }
          const result = (await response.json()) as { text: string };
          if (current !== generation) return;
          voiceText.value = result.text;
          await parseVoice();
        } catch (error) { if (current === generation) voiceStatus.textContent = error instanceof Error ? error.message : "语音识别失败"; }
      };
      recorder.start();
      record.textContent = "停止录音";
      voiceStatus.textContent = "正在录音";
    } catch (error) { activeStream?.getTracks().forEach((track) => track.stop()); if (current === generation) voiceStatus.textContent = error instanceof DOMException && error.name === "NotAllowedError" ? "麦克风权限未授权" : "录音失败"; }
  });
  originMarker = new maplibregl.Marker({ color: "#16a34a" }).setLngLat([demoOrigin.lon, demoOrigin.lat]).addTo(map);
  destinationMarker = new maplibregl.Marker({ color: "#dc2626" }).setLngLat([demoDestination.lon, demoDestination.lat]).addTo(map);
  const saved = loadSavedSession();
  if (saved !== null) {
    try {
      const session = await getNavigationSession(saved.sessionId);
      sessionId = saved.sessionId;
      origin = saved.origin;
      destination = saved.destination;
      safeDestinationRequired = saved.safeDestinationRequired === true;
      trackSelect.value = saved.trackId;
      originMarker.setLngLat([origin.lon, origin.lat]);
      destinationMarker.setLngLat([destination.lon, destination.lat]);
      if (safeDestinationRequired && session.route.road_destination) {
        const road = session.route.road_destination;
        roadDestinationMarker = new maplibregl.Marker({ color: "#2563eb" }).setLngLat([road.lon, road.lat]).setPopup(new maplibregl.Popup().setText(`道路终点，与地点相距 ${Math.round(session.route.destination_snap_distance_m ?? 0)} 米`)).addTo(map);
      }
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
    planGeneration.invalidate();
    roadDestinationMarker?.remove();
    roadDestinationMarker = null;
    const geographicCoordinate: Coordinate = { lat: event.lngLat.lat, lon: event.lngLat.lng };
    if (origin === null || destination !== null) {
      origin = geographicCoordinate;
      destination = null;
      safeDestinationRequired = false;
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
    await planRoute(destination, false);
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
        const session = await createNavigationSession(origin, destination, trackSelect.value, safeDestinationRequired);
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
