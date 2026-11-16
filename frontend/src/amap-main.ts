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
let originMarker: any = null;
let destMarker: any = null;
let carMarker: any = null;

let originLngLat: [number, number] | null = null;
let destLngLat: [number, number] | null = null;
let currentRoutePath: [number, number][] = [];

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

// 初始化高德地图
async function initApp(): Promise<void> {
  try {
    statusEl.textContent = "正在联网加载高德矢量底图...";
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

    // 实例化高德定位组件
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

    statusEl.innerHTML = `✅ 高德 JS API 加载成功<br/><span style="color:#10b981;">坐标系：GCJ-02 (火星坐标)</span>`;

    // 地图点击拾取起终点
    amapInstance.on("click", (e: any) => {
      const clickedLngLat: [number, number] = [e.lnglat.getLng(), e.lnglat.getLat()];
      if (!originLngLat || (originLngLat && destLngLat)) {
        // 重置并设置起点
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
            高德坐标(GCJ-02): ${gcjLon.toFixed(5)}, ${gcjLat.toFixed(5)}<br/>
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

    // 填充预设测试路线 (珠海金鼎大学城 -> 珠海大剧院日月贝)
    btnUsePreset.addEventListener("click", () => {
      // 预设 WGS-84 点位，展示边界自动转换能力
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

      statusEl.textContent = "正在调用高德 Driving API 规划路线...";
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

              // 提取坐标点集合用于巡航动画
              if (step.path) {
                step.path.forEach((p: any) => {
                  currentRoutePath.push([p.getLng(), p.getLat()]);
                });
              }
            });

            amapInstance.setFitView();
          } else {
            statusEl.innerHTML = `<span style="color:#ef4444;">算路失败: ${result.info || "路线无可达或Key受限"}</span>`;
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
        duration: 200, // 每段步长耗时
        autoRotation: true,
      });

      // 跟随视角
      carMarker.on("moving", (e: any) => {
        amapInstance.setCenter(e.target.getPosition());
      });
    });
  } catch (err: any) {
    statusEl.innerHTML = `<span style="color:#ef4444;">初始化失败: ${err.message}</span>`;
  }
}

// 启动应用
initApp();
