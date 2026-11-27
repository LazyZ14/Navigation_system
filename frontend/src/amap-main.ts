import "./amap-style.css";
import { getAmapCredentials, loadAmapSdk, saveAmapCredentials } from "./amap-config";
import { gcj02ToWgs84, wgs84ToGcj02 } from "./coord-transform";
import { analyzeUserIntent } from "./intent-parser";
import {
  buildIndexedAmapRoute,
  type GcjPoint,
  type IndexedAmapRoute,
} from "./amap-route-matcher";
import {
  AmapLiveController,
  type AmapAppMode,
  type LiveGpsFixPayload,
  type LiveNavSnapshot,
} from "./amap-live-controller";

export interface MapClickAction {
  target: "origin" | "destination";
  clearDestination: boolean;
}

export interface ModePanelVisibility {
  showDemoLocateBox: boolean;
  showPresetButton: boolean;
  showCruiseButton: boolean;
  showLiveTelemetryBox: boolean;
}

export function resolveMapClickAction(
  mode: AmapAppMode,
  hasOrigin: boolean,
  hasDest: boolean,
): MapClickAction {
  if (mode === "live") {
    return { target: "destination", clearDestination: false };
  }
  if (!hasOrigin || (hasOrigin && hasDest)) {
    return { target: "origin", clearDestination: hasOrigin && hasDest };
  }
  return { target: "destination", clearDestination: false };
}

export function computeModePanelVisibility(mode: AmapAppMode): ModePanelVisibility {
  if (mode === "live") {
    return {
      showDemoLocateBox: false,
      showPresetButton: false,
      showCruiseButton: false,
      showLiveTelemetryBox: true,
    };
  }
  return {
    showDemoLocateBox: true,
    showPresetButton: true,
    showCruiseButton: true,
    showLiveTelemetryBox: false,
  };
}

export interface LiveGpsStreamClientOptions {
  wsUrl: string;
  latestUrl: string;
  onFix: (fix: LiveGpsFixPayload, initialAgeMs?: number) => void;
  onHeartbeat: () => void;
  fetchImpl?: typeof fetch;
  createWebSocket?: (url: string) => WebSocket;
}

export class DrivingSearchGuard {
  private activeToken = 0;
  private sessionValid = false;

  beginSearch(): number {
    this.activeToken += 1;
    this.sessionValid = true;
    return this.activeToken;
  }

  invalidateSession(): void {
    this.activeToken += 1;
    this.sessionValid = false;
  }

  isCurrent(token: number): boolean {
    return this.sessionValid && token === this.activeToken;
  }

  acceptOrCleanupStale(token: number, clearMapOverlay: () => void): boolean {
    if (this.isCurrent(token)) {
      return true;
    }
    if (!this.sessionValid) {
      clearMapOverlay();
    }
    return false;
  }
}

const RECONNECT_DELAYS_MS = [1000, 2000, 5000];

export class LiveGpsStreamClient {
  private readonly opts: LiveGpsStreamClientOptions;
  private running = false;
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: LiveGpsStreamClientOptions) {
    this.opts = opts;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.reconnectAttempt = 0;
    void this.fetchInitialLatest();
    this.openSocket();
    this.heartbeatTimer = setInterval(() => {
      if (this.running) {
        this.opts.onHeartbeat();
      }
    }, 1000);
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws !== null) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private async fetchInitialLatest(): Promise<void> {
    const fetchFn = this.opts.fetchImpl ?? fetch;
    try {
      const resp = await fetchFn(this.opts.latestUrl);
      if (!resp.ok || !this.running) return;
      const body = (await resp.json()) as {
        active?: boolean;
        age_ms?: number | null;
        fix?: LiveGpsFixPayload | null;
      };
      if (this.running && body.active && body.fix) {
        this.opts.onFix(body.fix, body.age_ms ?? 0);
      }
    } catch {
      // Initial snapshot is best-effort; WebSocket stream handles recovery
    }
  }

  private openSocket(): void {
    if (!this.running) return;
    const makeWs = this.opts.createWebSocket ?? ((url: string) => new WebSocket(url));
    let socket: WebSocket;
    try {
      socket = makeWs(this.opts.wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
    };

    socket.onmessage = (event: { data: string }) => {
      if (!this.running) return;
      try {
        const parsed = JSON.parse(event.data) as LiveGpsFixPayload;
        if (typeof parsed.lat === "number" && typeof parsed.lon === "number") {
          this.opts.onFix(parsed);
        }
      } catch {
        // Ignore malformed frame
      }
    };

    socket.onclose = () => {
      if (!this.running) return;
      this.ws = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer !== null) return;
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }
}

function bootstrapAmapPage(): void {
  const statusEl = document.querySelector<HTMLDivElement>("#amap-status")!;
  const locationInfoEl = document.querySelector<HTMLDivElement>("#location-info")!;
  const pointsStatusEl = document.querySelector<HTMLDivElement>("#points-status")!;
  const routeModeTipEl = document.querySelector<HTMLDivElement>("#route-mode-tip")!;
  const btnLocate = document.querySelector<HTMLButtonElement>("#btn-locate")!;
  const btnUsePreset = document.querySelector<HTMLButtonElement>("#btn-use-preset")!;
  const btnPlanRoute = document.querySelector<HTMLButtonElement>("#btn-plan-route")!;
  const routeResultBox = document.querySelector<HTMLDivElement>("#route-result-box")!;
  const routeDistTimeEl = document.querySelector<HTMLDivElement>("#route-distance-time")!;
  const routeExtraInfoEl = document.querySelector<HTMLDivElement>("#route-extra-info")!;
  const routeStepsEl = document.querySelector<HTMLOListElement>("#route-steps")!;
  const btnStartCruise = document.querySelector<HTMLButtonElement>("#btn-start-cruise")!;

  // 模式切换与实车遥测元素
  const btnModeLive = document.querySelector<HTMLButtonElement>("#btn-mode-live")!;
  const btnModeDemo = document.querySelector<HTMLButtonElement>("#btn-mode-demo")!;
  const demoLocateBox = document.querySelector<HTMLDivElement>("#demo-locate-box")!;
  const liveTelemetryBox = document.querySelector<HTMLDivElement>("#live-telemetry-box")!;
  const liveSignalBadge = document.querySelector<HTMLDivElement>("#live-signal-badge")!;
  const liveMetricSpeed = document.querySelector<HTMLSpanElement>("#live-metric-speed")!;
  const liveMetricHeading = document.querySelector<HTMLSpanElement>("#live-metric-heading")!;
  const liveMetricAccuracy = document.querySelector<HTMLSpanElement>("#live-metric-accuracy")!;
  const liveMetricDelay = document.querySelector<HTMLSpanElement>("#live-metric-delay")!;
  const liveCoordsEl = document.querySelector<HTMLDivElement>("#live-coords")!;
  const liveTurnBanner = document.querySelector<HTMLDivElement>("#live-turn-banner")!;
  const liveTurnCurrent = document.querySelector<HTMLDivElement>("#live-turn-current")!;
  const liveTurnNext = document.querySelector<HTMLDivElement>("#live-turn-next")!;

  // POI 智能搜索与语音识别元素
  const inputPoiKeyword = document.querySelector<HTMLInputElement>("#input-poi-keyword")!;
  const btnVoiceSearch = document.querySelector<HTMLButtonElement>("#btn-voice-search")!;
  const btnTextSearch = document.querySelector<HTMLButtonElement>("#btn-text-search")!;
  const poiResultsContainer = document.querySelector<HTMLDivElement>("#poi-results-container")!;
  const tagPills = document.querySelectorAll<HTMLSpanElement>(".tag-pill");
  const aiAgentBubble = document.querySelector<HTMLDivElement>("#ai-agent-bubble")!;
  const aiAgentTag = document.querySelector<HTMLDivElement>("#ai-agent-tag")!;
  const aiAgentText = document.querySelector<HTMLDivElement>("#ai-agent-text")!;

  // Key 模态框元素
  const btnConfigKey = document.querySelector<HTMLButtonElement>("#btn-config-key")!;
  const keyModal = document.querySelector<HTMLDivElement>("#key-modal")!;
  const btnCloseModal = document.querySelector<HTMLButtonElement>("#btn-close-modal")!;
  const btnSaveKey = document.querySelector<HTMLButtonElement>("#btn-save-key")!;
  const inputAmapKey = document.querySelector<HTMLInputElement>("#input-amap-key")!;
  const inputAmapSecurity = document.querySelector<HTMLInputElement>("#input-amap-security")!;

  let amapInstance: any = null;
  let geolocationPlugin: any = null;
  let drivingPlugin: any = null;
  let placeSearchPlugin: any = null;

  let originMarker: any = null;
  let destMarker: any = null;
  let carMarker: any = null;
  let poiMarkers: any[] = [];

  let originLngLat: [number, number] | null = null;
  let destLngLat: [number, number] | null = null;
  let currentRoutePath: [number, number][] = [];
  let isLiveRouteActive = false;
  let hasCenteredLiveVehicle = false;
  let hasStickyStatusAlert = false;
  const searchGuard = new DrivingSearchGuard();

  let speechRecognitionInstance: any = null;
  let isRecording = false;

  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const liveWsUrl = `${wsProtocol}//${window.location.host}/ws/gps/live`;

  const liveController = new AmapLiveController({
    onSnapshot: renderLiveSnapshot,
    requestRecalculateRoute: async (originGcj: GcjPoint) => {
      if (!destLngLat || !drivingPlugin) return null;
      setOrigin([originGcj.lon, originGcj.lat], "偏航重算起点");
      return planDrivingRoute([originGcj.lon, originGcj.lat], destLngLat, true);
    },
  });

  const liveStreamClient = new LiveGpsStreamClient({
    wsUrl: liveWsUrl,
    latestUrl: "/api/gps/latest",
    onFix: (fix, initialAgeMs) => liveController.ingestFix(fix, Date.now(), initialAgeMs ?? 0),
    onHeartbeat: () => liveController.tickHeartbeat(),
  });

  // 初始化模态框逻辑
  btnConfigKey.addEventListener("click", () => {
    const { key, securityKey } = getAmapCredentials();
    inputAmapKey.value = key;
    inputAmapSecurity.value = securityKey;
    keyModal.style.display = "flex";
  });

  btnCloseModal.addEventListener("click", () => {
    keyModal.style.display = "none";
  });

  btnSaveKey.addEventListener("click", () => {
    saveAmapCredentials(inputAmapKey.value, inputAmapSecurity.value);
    keyModal.style.display = "none";
    window.location.reload();
  });

  function updatePointsDisplay(): void {
    const mode = liveController.getMode();
    const originStr = originLngLat
      ? `[${originLngLat[0].toFixed(5)}, ${originLngLat[1].toFixed(5)}]${mode === "live" ? " (实车)" : ""}`
      : mode === "live"
        ? "等待手机/GNSS 定位..."
        : "未选择";
    const destStr = destLngLat
      ? `[${destLngLat[0].toFixed(5)}, ${destLngLat[1].toFixed(5)}]`
      : "未选择";

    pointsStatusEl.innerHTML = `起点: ${originStr}<br/>终点: ${destStr}`;
    const liveReady = mode !== "live" || liveController.getSnapshot().online;
    btnPlanRoute.disabled = !originLngLat || !destLngLat || !liveReady;
  }

  function setOrigin(lngLat: [number, number], title = "起点"): void {
    originLngLat = lngLat;
    if (!amapInstance) {
      updatePointsDisplay();
      return;
    }
    if (originMarker) {
      originMarker.setPosition(lngLat);
    } else {
      originMarker = new window.AMap.Marker({
        position: lngLat,
        title,
        label: { content: "起", offset: new window.AMap.Pixel(0, -20) },
        map: amapInstance,
      });
    }
    updatePointsDisplay();
  }

  function setDestination(lngLat: [number, number], title = "终点"): void {
    destLngLat = lngLat;
    if (!amapInstance) {
      updatePointsDisplay();
      return;
    }
    if (destMarker) {
      destMarker.setPosition(lngLat);
    } else {
      destMarker = new window.AMap.Marker({
        position: lngLat,
        title,
        label: { content: "终", offset: new window.AMap.Pixel(0, -20) },
        map: amapInstance,
      });
    }
    updatePointsDisplay();
  }

  function clearMapSessionState(): void {
    if (carMarker) {
      if (typeof carMarker.stopMove === "function") {
        carMarker.stopMove();
      }
      carMarker.setMap(null);
      carMarker = null;
    }
    if (originMarker) {
      originMarker.setMap(null);
      originMarker = null;
    }
    if (destMarker) {
      destMarker.setMap(null);
      destMarker = null;
    }
    if (drivingPlugin) {
      drivingPlugin.clear();
    }
    originLngLat = null;
    destLngLat = null;
    currentRoutePath = [];
    isLiveRouteActive = false;
    hasCenteredLiveVehicle = false;
    hasStickyStatusAlert = false;
    searchGuard.invalidateSession();
    routeResultBox.style.display = "none";
    liveTurnBanner.style.display = "none";
    liveController.clearRoute();
    updatePointsDisplay();
  }

  function ensureLiveCarMarker(lngLat: [number, number], headingDeg: number | null): void {
    if (!amapInstance) return;
    if (!carMarker) {
      carMarker = new window.AMap.Marker({
        map: amapInstance,
        position: lngLat,
        icon: "https://a.amap.com/jsapi_demos/static/demo-center-v2/car.png",
        offset: new window.AMap.Pixel(-13, -26),
        angle: headingDeg ?? 0,
      });
    } else {
      carMarker.setPosition(lngLat);
      if (headingDeg !== null && Number.isFinite(headingDeg) && typeof carMarker.setAngle === "function") {
        carMarker.setAngle(headingDeg);
      }
    }
  }

  function highlightActiveStep(stepIndex: number): void {
    const items = routeStepsEl.querySelectorAll("li");
    items.forEach((item, idx) => {
      if (idx === stepIndex) {
        item.classList.add("active-step");
        if (typeof item.scrollIntoView === "function") {
          item.scrollIntoView({ block: "nearest" });
        }
      } else {
        item.classList.remove("active-step");
      }
    });
  }

  function renderLiveSnapshot(snap: LiveNavSnapshot): void {
    if (snap.mode !== "live") return;

    // 1. 信号徽章
    if (snap.recalculating) {
      liveSignalBadge.className = "live-badge recalculating";
    } else if (snap.online && !snap.weakSignal) {
      liveSignalBadge.className = "live-badge online";
    } else {
      liveSignalBadge.className = "live-badge offline";
    }
    liveSignalBadge.textContent = snap.statusText;
    if (!isRecording && (!hasStickyStatusAlert || snap.recalculating)) {
      statusEl.textContent = snap.statusText;
    }

    // 2. 遥测四格指标
    liveMetricSpeed.textContent = snap.speedKmh !== null ? `${snap.speedKmh.toFixed(1)} km/h` : "-- km/h";
    liveMetricHeading.textContent =
      snap.displayHeadingDeg !== null ? `${Math.round(snap.displayHeadingDeg)}°` : "--°";
    liveMetricAccuracy.textContent =
      snap.accuracyM !== null ? `±${snap.accuracyM.toFixed(1)} m` : "±-- m";
    liveMetricDelay.textContent = snap.delayMs !== null ? `${snap.delayMs} ms` : "-- ms";

    // 3. 坐标与车辆图标更新
    if (snap.displayPositionGcj && snap.rawWgs84) {
      const gcjTuple: [number, number] = [snap.displayPositionGcj.lon, snap.displayPositionGcj.lat];
      liveCoordsEl.innerHTML =
        `高德(GCJ-02): ${gcjTuple[0].toFixed(5)}, ${gcjTuple[1].toFixed(5)}<br/>` +
        `原生(WGS-84): ${snap.rawWgs84.lon.toFixed(5)}, ${snap.rawWgs84.lat.toFixed(5)}`;

      ensureLiveCarMarker(gcjTuple, snap.displayHeadingDeg);

      if (!isLiveRouteActive) {
        setOrigin(gcjTuple, "实车当前位置");
      }

      if (amapInstance) {
        if (!hasCenteredLiveVehicle) {
          amapInstance.setZoomAndCenter(16, gcjTuple);
          hasCenteredLiveVehicle = true;
        } else if (isLiveRouteActive) {
          amapInstance.panTo(gcjTuple);
        }
      }
    }

    // 4. 导航中实时进度、转向提示与到达状态
    if (snap.match && isLiveRouteActive) {
      if (snap.arrived) {
        routeDistTimeEl.textContent = "🎉 已到达终点附近";
        liveTurnBanner.style.display = "block";
        liveTurnCurrent.textContent = "🎉 您已到达目的地附近，本次实车导航结束";
        liveTurnNext.textContent = "";
      } else {
        const remKm =
          snap.match.remainingDistanceM >= 1000
            ? `${(snap.match.remainingDistanceM / 1000).toFixed(2)} 公里`
            : `${Math.round(snap.match.remainingDistanceM)} 米`;
        const remMin = Math.max(1, Math.round(snap.match.remainingDurationS / 60));
        routeDistTimeEl.textContent = `剩余 ${remKm} · 约 ${remMin} 分钟`;

        liveTurnBanner.style.display = "block";
        liveTurnCurrent.textContent = `⬆️ 当前：${snap.match.currentInstruction}`;
        liveTurnNext.textContent = snap.match.nextInstruction
          ? `↪️ 下一步：${snap.match.nextInstruction}`
          : "🏁 即将抵达终点";
        highlightActiveStep(snap.match.currentStepIndex);
      }
    } else {
      liveTurnBanner.style.display = "none";
    }

    updatePointsDisplay();
  }

  function applyModeUI(mode: AmapAppMode): void {
    const vis = computeModePanelVisibility(mode);
    btnModeLive.classList.toggle("active", mode === "live");
    btnModeDemo.classList.toggle("active", mode === "demo");
    demoLocateBox.style.display = vis.showDemoLocateBox ? "block" : "none";
    btnUsePreset.style.display = vis.showPresetButton ? "inline-flex" : "none";
    btnStartCruise.style.display = vis.showCruiseButton ? "inline-flex" : "none";
    liveTelemetryBox.style.display = vis.showLiveTelemetryBox ? "block" : "none";

    routeModeTipEl.textContent =
      mode === "live"
        ? "提示：起点已由手机实时定位锁定，点击地图或搜索 POI 直接设置终点。"
        : "提示：可以直接在地图上点击设置起点与终点。";
  }

  function switchAppMode(mode: AmapAppMode): void {
    clearMapSessionState();
    applyModeUI(mode);
    liveController.setMode(mode);

    const url = new URL(window.location.href);
    if (mode === "live") {
      url.searchParams.set("mode", "live");
      window.history.replaceState({}, "", url.toString());
      liveStreamClient.start();
    } else {
      url.searchParams.delete("mode");
      window.history.replaceState({}, "", url.toString());
      liveStreamClient.stop();
      statusEl.innerHTML = `✅ 手动演示模式就绪<br/><span style="color:#10b981;">坐标系：GCJ-02 (火星坐标)</span>`;
    }
    updatePointsDisplay();
  }

  btnModeLive.addEventListener("click", () => {
    if (liveController.getMode() !== "live") {
      switchAppMode("live");
    }
  });

  btnModeDemo.addEventListener("click", () => {
    if (liveController.getMode() !== "demo") {
      switchAppMode("demo");
    }
  });

  function clearPoiMarkers(): void {
    poiMarkers.forEach((m) => m.setMap(null));
    poiMarkers = [];
  }

  function planDrivingRoute(
    origin: [number, number],
    dest: [number, number],
    isAutoRecalc = false,
  ): Promise<IndexedAmapRoute | null> {
    if (!drivingPlugin || !amapInstance) {
      return Promise.resolve(null);
    }

    const searchToken = searchGuard.beginSearch();
    if (!isAutoRecalc) {
      hasStickyStatusAlert = false;
      statusEl.textContent = "正在规划最优驾车路线...";
      if (liveController.getMode() === "live") {
        isLiveRouteActive = false;
        routeResultBox.style.display = "none";
        liveTurnBanner.style.display = "none";
        liveController.clearRoute();
      }
    }
    drivingPlugin.clear();

    return new Promise((resolve) => {
      drivingPlugin.search(
        new window.AMap.LngLat(origin[0], origin[1]),
        new window.AMap.LngLat(dest[0], dest[1]),
        (status: string, result: any) => {
          if (!searchGuard.acceptOrCleanupStale(searchToken, () => drivingPlugin?.clear())) {
            resolve(null);
            return;
          }

          if (status === "complete" && result.routes && result.routes.length > 0) {
            hasStickyStatusAlert = false;
            const route = result.routes[0];
            const distKm = (route.distance / 1000).toFixed(1);
            const timeMin = Math.round(route.time / 60);

            statusEl.innerHTML = isAutoRecalc
              ? `✅ 已偏航重新规划路线`
              : `✅ 算路成功，共找到 ${result.routes.length} 条策略路线`;
            routeResultBox.style.display = "block";
            routeDistTimeEl.textContent = `${distKm} 公里 · 约 ${timeMin} 分钟`;
            routeExtraInfoEl.textContent = `红绿灯: ${route.traffic_lights || 0} 个 · 收费: ¥${route.tolls || 0}`;

            routeStepsEl.innerHTML = "";
            currentRoutePath = [];
            route.steps.forEach((step: any) => {
              const li = document.createElement("li");
              li.innerHTML = step.instruction;
              routeStepsEl.appendChild(li);

              if (step.path) {
                step.path.forEach((p: any) => {
                  currentRoutePath.push([p.getLng(), p.getLat()]);
                });
              }
            });

            const indexed = buildIndexedAmapRoute(route);
            if (liveController.getMode() === "live") {
              isLiveRouteActive = true;
              if (!isAutoRecalc) {
                liveController.setActiveRoute(indexed);
              }
            } else {
              amapInstance.setFitView();
            }
            resolve(indexed);
          } else {
            if (!isAutoRecalc) {
              hasStickyStatusAlert = true;
            }
            statusEl.innerHTML = `<span style="color:#ef4444;">算路失败: ${result?.info || "当前位置无可达驾车路线"}</span>`;
            resolve(null);
          }
        },
      );
    });
  }

  function searchNearbyPoi(rawInput: string): void {
    const cleanInput = rawInput.trim();
    if (!cleanInput) return;

    if (!placeSearchPlugin) {
      statusEl.innerHTML = `<span style="color:#ef4444;">搜索插件尚未就绪，请稍候</span>`;
      return;
    }

    const intentResult = analyzeUserIntent(cleanInput);

    aiAgentBubble.style.display = "flex";
    if (intentResult.isFuzzyMatched) {
      aiAgentTag.innerHTML = `🤖 AI 意图理解：【${intentResult.categoryName}】`;
      aiAgentText.innerHTML = `${intentResult.replyMessage}<br/><span style="font-size:11px;color:#15803d;opacity:0.85;">(已智能提取检索词：${intentResult.searchKeywords.join(" / ")})</span>`;
    } else {
      aiAgentTag.innerHTML = `📍 地点精确搜索`;
      aiAgentText.innerHTML = `${intentResult.replyMessage}`;
    }

    let centerCoords: [number, number];
    const liveSnap = liveController.getSnapshot();
    if (liveController.getMode() === "live" && liveSnap.displayPositionGcj) {
      centerCoords = [liveSnap.displayPositionGcj.lon, liveSnap.displayPositionGcj.lat];
    } else if (originLngLat) {
      centerCoords = originLngLat;
    } else {
      const mapCenter = amapInstance.getCenter();
      centerCoords = [mapCenter.getLng(), mapCenter.getLat()];
    }

    clearPoiMarkers();
    poiResultsContainer.style.display = "flex";
    const searchWord = intentResult.searchKeywords[0] || cleanInput;
    poiResultsContainer.innerHTML = `<div class="status-text">🔍 正在搜寻周边 5km 内的“${searchWord}”...</div>`;

    placeSearchPlugin.searchNearBy(
      searchWord,
      centerCoords,
      5000,
      (status: string, result: any) => {
        if (status === "complete" && result.poiList && result.poiList.pois && result.poiList.pois.length > 0) {
          const pois = result.poiList.pois;
          poiResultsContainer.innerHTML = "";

          pois.forEach((poi: any, index: number) => {
            const poiLng = poi.location.getLng();
            const poiLat = poi.location.getLat();
            const distanceStr = poi.distance ? `${Math.round(poi.distance)} 米` : "附近";

            const marker = new window.AMap.Marker({
              map: amapInstance,
              position: [poiLng, poiLat],
              title: poi.name,
              label: {
                content: `${index + 1}. ${poi.name}`,
                offset: new window.AMap.Pixel(0, -20),
              },
            });
            poiMarkers.push(marker);

            const card = document.createElement("div");
            card.className = "poi-card";
            card.innerHTML = `
              <div class="poi-card-header">
                <span class="poi-card-title">${index + 1}. ${poi.name}</span>
                <span class="poi-card-distance">${distanceStr}</span>
              </div>
              <div class="poi-card-address">${poi.address || poi.type || "暂无具体门牌地址"}</div>
            `;

            card.addEventListener("click", () => {
              amapInstance.panTo([poiLng, poiLat]);
              if (liveController.getMode() === "live") {
                const snap = liveController.getSnapshot();
                if (snap.displayPositionGcj) {
                  setOrigin([snap.displayPositionGcj.lon, snap.displayPositionGcj.lat], "实车当前位置");
                }
              }
              setDestination([poiLng, poiLat], poi.name);

              if (originLngLat && (liveController.getMode() !== "live" || liveController.getSnapshot().online)) {
                void planDrivingRoute(originLngLat, [poiLng, poiLat]);
              } else {
                statusEl.textContent =
                  liveController.getMode() === "live"
                    ? `已将“${poi.name}”设为终点，等待手机实时定位在线后即可算路`
                    : `已将“${poi.name}”设为终点，请点击地图或定位选取起点`;
              }
            });

            marker.on("click", () => {
              card.click();
            });

            poiResultsContainer.appendChild(card);
          });

          amapInstance.setFitView([carMarker, originMarker, ...poiMarkers].filter(Boolean));
        } else {
          poiResultsContainer.innerHTML = `
            <div class="status-text" style="color: #64748b;">
              未在周边 5km 找到与“${searchWord}”匹配的地点，可尝试更换关键词或移动地图。
            </div>
          `;
        }
      },
    );
  }

  function initSpeechRecognition(): void {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      btnVoiceSearch.title = "当前浏览器不支持 Web Speech API，可直接键盘输入";
      btnVoiceSearch.addEventListener("click", () => {
        alert("当前浏览器未开放原生 Web 语音识别，建议在 Google Chrome / Edge 浏览器中使用，或直接在输入框打字搜索。");
      });
      return;
    }

    speechRecognitionInstance = new SpeechRecognition();
    speechRecognitionInstance.lang = "zh-CN";
    speechRecognitionInstance.continuous = false;
    speechRecognitionInstance.interimResults = false;

    speechRecognitionInstance.onstart = () => {
      isRecording = true;
      btnVoiceSearch.classList.add("recording");
      statusEl.innerHTML = `🎙️ <strong style="color:#ef4444;">正在倾听中...</strong> 请说出您想去的地点（如“附近的咖啡馆”或“加油站”）`;
    };

    speechRecognitionInstance.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.replace(/[。？！，]/g, "").trim();
      inputPoiKeyword.value = transcript;
      statusEl.innerHTML = `🎙️ 识别成功：“<strong>${transcript}</strong>”，正在为您推荐附近地点...`;
      searchNearbyPoi(transcript);
    };

    speechRecognitionInstance.onerror = (event: any) => {
      isRecording = false;
      btnVoiceSearch.classList.remove("recording");
      statusEl.innerHTML = `<span style="color:#ef4444;">语音识别未接收到有效声音或被取消 (${event.error})</span>`;
    };

    speechRecognitionInstance.onend = () => {
      isRecording = false;
      btnVoiceSearch.classList.remove("recording");
    };

    btnVoiceSearch.addEventListener("click", () => {
      if (isRecording) {
        speechRecognitionInstance.stop();
      } else {
        try {
          speechRecognitionInstance.start();
        } catch {
          speechRecognitionInstance.stop();
        }
      }
    });
  }

  async function initApp(): Promise<void> {
    const initialMode: AmapAppMode =
      new URLSearchParams(window.location.search).get("mode") === "live" ? "live" : "demo";
    applyModeUI(initialMode);

    try {
      statusEl.textContent = "正在联网加载底图与导航服务...";
      const AMap = await loadAmapSdk();

      amapInstance = new AMap.Map("amap-container", {
        center: [113.5786, 22.3734],
        zoom: 13,
        viewMode: "3D",
        pitch: 35,
      });

      amapInstance.addControl(new AMap.Scale());
      amapInstance.addControl(new AMap.ToolBar({ position: "RT" }));

      geolocationPlugin = new AMap.Geolocation({
        enableHighAccuracy: true,
        timeout: 10000,
        zoomToAccuracy: true,
        buttonPosition: "RB",
        showMarker: true,
        showCircle: true,
      });
      amapInstance.addControl(geolocationPlugin);

      drivingPlugin = new AMap.Driving({
        map: amapInstance,
        showTraffic: true,
        policy: AMap.DrivingPolicy.LEAST_TIME,
      });

      placeSearchPlugin = new AMap.PlaceSearch({
        pageSize: 8,
        pageIndex: 1,
        city: "全国",
      });

      // 地图点击拾取：按当前模式严格隔离
      amapInstance.on("click", (e: any) => {
        const clickedLngLat: [number, number] = [e.lnglat.getLng(), e.lnglat.getLat()];
        const action = resolveMapClickAction(
          liveController.getMode(),
          Boolean(originLngLat),
          Boolean(destLngLat),
        );

        if (action.clearDestination && destMarker) {
          destMarker.setMap(null);
          destMarker = null;
          destLngLat = null;
        }

        if (action.target === "origin") {
          setOrigin(clickedLngLat);
        } else {
          if (liveController.getMode() === "live") {
            const snap = liveController.getSnapshot();
            if (snap.displayPositionGcj) {
              setOrigin([snap.displayPositionGcj.lon, snap.displayPositionGcj.lat], "实车当前位置");
            }
          }
          setDestination(clickedLngLat);
          if (liveController.getMode() === "live" && originLngLat && liveController.getSnapshot().online) {
            void planDrivingRoute(originLngLat, clickedLngLat);
          }
        }
      });

      // Demo 浏览器定位按钮事件
      btnLocate.addEventListener("click", () => {
        locationInfoEl.textContent = "正在请求浏览器 GPS/网络定位...";
        geolocationPlugin.getCurrentPosition((status: string, result: any) => {
          if (status === "complete") {
            const gcjLat = result.position.lat;
            const gcjLon = result.position.lng;
            const wgs = gcj02ToWgs84(gcjLat, gcjLon);

            locationInfoEl.innerHTML = `
              <strong>定位成功:</strong><br/>
              坐标(GCJ-02): ${gcjLon.toFixed(5)}, ${gcjLat.toFixed(5)}<br/>
              GPS原生(WGS-84): ${wgs.lon.toFixed(5)}, ${wgs.lat.toFixed(5)}<br/>
              精度半径: 约 ${Math.round(result.accuracy)} 米<br/>
              ${result.formattedAddress ? `位置: ${result.formattedAddress}` : ""}
            `;

            setOrigin([gcjLon, gcjLat], "当前自身位置");
          } else {
            locationInfoEl.innerHTML = `<span style="color:#ef4444;">定位失败: ${result.message || "用户拒绝或网络超时"}</span>`;
          }
        });
      });

      tagPills.forEach((pill) => {
        pill.addEventListener("click", () => {
          const keyword = pill.dataset.keyword || pill.textContent || "";
          inputPoiKeyword.value = keyword;
          searchNearbyPoi(keyword);
        });
      });

      btnTextSearch.addEventListener("click", () => {
        searchNearbyPoi(inputPoiKeyword.value);
      });

      inputPoiKeyword.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          searchNearbyPoi(inputPoiKeyword.value);
        }
      });

      // Demo 预设测试路线 (珠海金鼎大学城 -> 珠海大剧院日月贝)
      btnUsePreset.addEventListener("click", () => {
        const wgsOrigin = { lon: 113.5786, lat: 22.3734 };
        const wgsDest = { lon: 113.5824, lat: 22.2816 };

        const gcjOrigin = wgs84ToGcj02(wgsOrigin.lat, wgsOrigin.lon);
        const gcjDest = wgs84ToGcj02(wgsDest.lat, wgsDest.lon);

        setOrigin([gcjOrigin.lon, gcjOrigin.lat], "金鼎高新区");
        setDestination([gcjDest.lon, gcjDest.lat], "珠海大剧院(日月贝)");
        amapInstance.setFitView([originMarker, destMarker]);
      });

      btnPlanRoute.addEventListener("click", () => {
        if (liveController.getMode() === "live") {
          const snap = liveController.getSnapshot();
          if (snap.displayPositionGcj) {
            setOrigin([snap.displayPositionGcj.lon, snap.displayPositionGcj.lat], "实车当前位置");
          }
        }
        if (!originLngLat || !destLngLat) return;
        void planDrivingRoute(originLngLat, destLngLat);
      });

      // Demo 模拟巡航
      btnStartCruise.addEventListener("click", () => {
        if (liveController.getMode() !== "demo" || currentRoutePath.length === 0) return;

        if (carMarker) {
          carMarker.stopMove();
          carMarker.setMap(null);
        }

        carMarker = new AMap.Marker({
          map: amapInstance,
          position: currentRoutePath[0],
          icon: "https://a.amap.com/jsapi_demos/static/demo-center-v2/car.png",
          offset: new AMap.Pixel(-13, -26),
          autoRotation: true,
          angle: -90,
        });

        carMarker.moveAlong(currentRoutePath, {
          duration: 200,
          autoRotation: true,
        });

        carMarker.on("moving", (e: any) => {
          amapInstance.setCenter(e.target.getPosition());
        });
      });

      initSpeechRecognition();
      switchAppMode(initialMode);
    } catch (err: any) {
      statusEl.innerHTML = `<span style="color:#ef4444;">初始化失败: ${err.message}</span>`;
    }
  }

  void initApp();
}

if (typeof document !== "undefined" && document.querySelector("#amap-container")) {
  bootstrapAmapPage();
}
