import "./amap-style.css";
import { getAmapCredentials, loadAmapSdk, saveAmapCredentials } from "./amap-config";
import { gcj02ToWgs84, wgs84ToGcj02 } from "./coord-transform";

// UI 元素
const statusEl = document.querySelector<HTMLDivElement>("#amap-status")!;
const locationInfoEl = document.querySelector<HTMLDivElement>("#location-info")!;
const pointsStatusEl = document.querySelector<HTMLDivElement>("#points-status")!;
const btnLocate = document.querySelector<HTMLButtonElement>("#btn-locate")!;
const btnUsePreset = document.querySelector<HTMLButtonElement>("#btn-use-preset")!;
const btnPlanRoute = document.querySelector<HTMLButtonElement>("#btn-plan-route")!;
const routeResultBox = document.querySelector<HTMLDivElement>("#route-result-box")!;
const routeDistTimeEl = document.querySelector<HTMLDivElement>("#route-distance-time")!;
const routeExtraInfoEl = document.querySelector<HTMLDivElement>("#route-extra-info")!;
const routeStepsEl = document.querySelector<HTMLOListElement>("#route-steps")!;
const btnStartCruise = document.querySelector<HTMLButtonElement>("#btn-start-cruise")!;

// POI 智能搜索与语音识别元素
const inputPoiKeyword = document.querySelector<HTMLInputElement>("#input-poi-keyword")!;
const btnVoiceSearch = document.querySelector<HTMLButtonElement>("#btn-voice-search")!;
const btnTextSearch = document.querySelector<HTMLButtonElement>("#btn-text-search")!;
const poiResultsContainer = document.querySelector<HTMLDivElement>("#poi-results-container")!;
const tagPills = document.querySelectorAll<HTMLSpanElement>(".tag-pill");

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

// 语音识别实例
let speechRecognitionInstance: any = null;
let isRecording = false;

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

// 更新点位状态显示
function updatePointsDisplay(): void {
  const originStr = originLngLat
    ? `[${originLngLat[0].toFixed(5)}, ${originLngLat[1].toFixed(5)}]`
    : "未选择";
  const destStr = destLngLat
    ? `[${destLngLat[0].toFixed(5)}, ${destLngLat[1].toFixed(5)}]`
    : "未选择";

  pointsStatusEl.innerHTML = `起点: ${originStr}<br/>终点: ${destStr}`;
  btnPlanRoute.disabled = !originLngLat || !destLngLat;
}

// 设置起点
function setOrigin(lngLat: [number, number], title = "起点"): void {
  originLngLat = lngLat;
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

// 设置终点
function setDestination(lngLat: [number, number], title = "终点"): void {
  destLngLat = lngLat;
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

// 清除所有 POI 标记点
function clearPoiMarkers(): void {
  poiMarkers.forEach((m) => m.setMap(null));
  poiMarkers = [];
}

// 核心函数：根据关键词和当前定位搜索周边 POI
function searchNearbyPoi(keyword: string): void {
  const cleanKeyword = keyword.trim();
  if (!cleanKeyword) return;

  if (!placeSearchPlugin) {
    statusEl.innerHTML = `<span style="color:#ef4444;">搜索插件尚未就绪，请稍候</span>`;
    return;
  }

  // 优先以当前定位/起点为圆心；若未定位则以当前地图视野中心为圆心
  let centerCoords: [number, number];
  if (originLngLat) {
    centerCoords = originLngLat;
  } else {
    const mapCenter = amapInstance.getCenter();
    centerCoords = [mapCenter.getLng(), mapCenter.getLat()];
  }

  clearPoiMarkers();
  poiResultsContainer.style.display = "flex";
  poiResultsContainer.innerHTML = `<div class="status-text">🔍 正在搜索周边 5km 内的“${cleanKeyword}”...</div>`;

  // 搜索周边 5000 米范围内的 POI
  placeSearchPlugin.searchNearBy(
    cleanKeyword,
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

          // 在地图上放置轻量标记点
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

          // 构建 POI 卡片
          const card = document.createElement("div");
          card.className = "poi-card";
          card.innerHTML = `
            <div class="poi-card-header">
              <span class="poi-card-title">${index + 1}. ${poi.name}</span>
              <span class="poi-card-distance">${distanceStr}</span>
            </div>
            <div class="poi-card-address">${poi.address || poi.type || "暂无具体门牌地址"}</div>
          `;

          // 卡片点击事件：设为终点并自动算路
          card.addEventListener("click", () => {
            amapInstance.panTo([poiLng, poiLat]);
            setDestination([poiLng, poiLat], poi.name);

            // 如果当前已有起点（如定位点），自动规划驾车路线
            if (originLngLat) {
              btnPlanRoute.click();
            } else {
              statusEl.textContent = `已将“${poi.name}”设为终点，请点击地图或定位选取起点`;
            }
          });

          // 地图标记点点击也同步设置
          marker.on("click", () => {
            card.click();
          });

          poiResultsContainer.appendChild(card);
        });

        // 调整视野同时包含搜索中心和推荐点
        amapInstance.setFitView([originMarker, ...poiMarkers].filter(Boolean));
      } else {
        poiResultsContainer.innerHTML = `
          <div class="status-text" style="color: #64748b;">
            未在周边 5km 找到与“${cleanKeyword}”相关的地点，可尝试更换关键词或移动地图。
          </div>
        `;
      }
    },
  );
}

// 初始化语音识别 (Web Speech API)
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
      } catch (e) {
        speechRecognitionInstance.stop();
      }
    }
  });
}

// 初始化应用
async function initApp(): Promise<void> {
  try {
    statusEl.textContent = "正在联网加载底图与导航服务...";
    const AMap = await loadAmapSdk();

    // 默认以珠海情侣路/唐家湾附近为初始中心点
    amapInstance = new AMap.Map("amap-container", {
      center: [113.5786, 22.3734],
      zoom: 13,
      viewMode: "3D",
      pitch: 35,
    });

    amapInstance.addControl(new AMap.Scale());
    amapInstance.addControl(new AMap.ToolBar({ position: "RT" }));

    // 实例化定位组件
    geolocationPlugin = new AMap.Geolocation({
      enableHighAccuracy: true,
      timeout: 10000,
      zoomToAccuracy: true,
      buttonPosition: "RB",
      showMarker: true,
      showCircle: true,
    });
    amapInstance.addControl(geolocationPlugin);

    // 实例化驾车路线规划插件
    drivingPlugin = new AMap.Driving({
      map: amapInstance,
      showTraffic: true, // 开启实时交通拥堵态
      policy: AMap.DrivingPolicy.LEAST_TIME,
    });

    // 实例化周边 POI 检索插件
    placeSearchPlugin = new AMap.PlaceSearch({
      pageSize: 8,
      pageIndex: 1,
      city: "全国",
    });

    statusEl.innerHTML = `✅ 底图与导航服务已就绪<br/><span style="color:#10b981;">坐标系：GCJ-02 (火星坐标)</span>`;

    // 地图点击拾取起终点
    amapInstance.on("click", (e: any) => {
      const clickedLngLat: [number, number] = [e.lnglat.getLng(), e.lnglat.getLat()];
      if (!originLngLat || (originLngLat && destLngLat)) {
        if (destMarker) {
          destMarker.setMap(null);
          destMarker = null;
        }
        destLngLat = null;
        setOrigin(clickedLngLat);
      } else {
        setDestination(clickedLngLat);
      }
    });

    // 定位按钮事件
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

          // 将定位点设为起点
          setOrigin([gcjLon, gcjLat], "当前自身位置");
        } else {
          locationInfoEl.innerHTML = `<span style="color:#ef4444;">定位失败: ${result.message || "用户拒绝或网络超时"}</span>`;
        }
      });
    });

    // 快捷标签点击
    tagPills.forEach((pill) => {
      pill.addEventListener("click", () => {
        const keyword = pill.dataset.keyword || pill.textContent || "";
        inputPoiKeyword.value = keyword;
        searchNearbyPoi(keyword);
      });
    });

    // 搜索按钮及回车事件
    btnTextSearch.addEventListener("click", () => {
      searchNearbyPoi(inputPoiKeyword.value);
    });

    inputPoiKeyword.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        searchNearbyPoi(inputPoiKeyword.value);
      }
    });

    // 填充预设测试路线 (珠海金鼎大学城 -> 珠海大剧院日月贝)
    btnUsePreset.addEventListener("click", () => {
      const wgsOrigin = { lon: 113.5786, lat: 22.3734 };
      const wgsDest = { lon: 113.5824, lat: 22.2816 };

      const gcjOrigin = wgs84ToGcj02(wgsOrigin.lat, wgsOrigin.lon);
      const gcjDest = wgs84ToGcj02(wgsDest.lat, wgsDest.lon);

      setOrigin([gcjOrigin.lon, gcjOrigin.lat], "金鼎高新区");
      setDestination([gcjDest.lon, gcjDest.lat], "珠海大剧院(日月贝)");
      amapInstance.setFitView([originMarker, destMarker]);
    });

    // 路线规划
    btnPlanRoute.addEventListener("click", () => {
      if (!originLngLat || !destLngLat) return;

      statusEl.textContent = "正在规划最优驾车路线...";
      drivingPlugin.clear();

      drivingPlugin.search(
        new AMap.LngLat(originLngLat[0], originLngLat[1]),
        new AMap.LngLat(destLngLat[0], destLngLat[1]),
        (status: string, result: any) => {
          if (status === "complete" && result.routes && result.routes.length > 0) {
            const route = result.routes[0];
            const distKm = (route.distance / 1000).toFixed(1);
            const timeMin = Math.round(route.time / 60);

            statusEl.innerHTML = `✅ 算路成功，共找到 ${result.routes.length} 条策略路线`;
            routeResultBox.style.display = "block";
            routeDistTimeEl.textContent = `${distKm} 公里 · 约 ${timeMin} 分钟`;
            routeExtraInfoEl.textContent = `红绿灯: ${route.traffic_lights || 0} 个 · 收费: ¥${route.tolls || 0}`;

            // 渲染导航步骤
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

            amapInstance.setFitView();
          } else {
            statusEl.innerHTML = `<span style="color:#ef4444;">算路失败: ${result.info || "路线无可达"}</span>`;
          }
        },
      );
    });

    // 巡航模拟
    btnStartCruise.addEventListener("click", () => {
      if (currentRoutePath.length === 0) return;

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

      // 沿线移动
      carMarker.moveAlong(currentRoutePath, {
        duration: 200,
        autoRotation: true,
      });

      // 跟随视角
      carMarker.on("moving", (e: any) => {
        amapInstance.setCenter(e.target.getPosition());
      });
    });

    // 初始化语音识别监听
    initSpeechRecognition();
  } catch (err: any) {
    statusEl.innerHTML = `<span style="color:#ef4444;">初始化失败: ${err.message}</span>`;
  }
}

// 启动应用
initApp();
