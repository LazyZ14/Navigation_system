# 系统架构说明

## 1. 架构概览

本系统采用**“设备无关 `WGS-84` 定位总线 + 离线/在线双前端视图”**的分层架构，兼顾纯离线可复现实验与实车实时导航联调：

1. **离线导航闭环（`frontend/index.html`）**：基于珠海区域 OpenStreetMap 构建 OSRM 路由图与八类语义 GeoJSON 底图，由 FastAPI 协调路线规划、轨迹回放、偏航重规划及 Voice-01 语音目的地检索，MapLibre GL JS 负责渲染。
2. **在线高德增强闭环（`frontend/amap.html`）**：接入高德地图 JS API v2.0，顶部拆分为互不干扰的两种模式：
   - **📡 实车实时导航模式（Live Mode）**：订阅 FastAPI 实时 `WGS-84` 定位流，在边界层转换为 `GCJ-02`，执行静止防抖平滑、高德规划折线连续性+航向角投影吸附、逐步转向提示刷新、到达判定与连续偏航节流自动重算；
   - **🧪 手动演示模式（Demo Mode）**：支持地图手动点选起终点、珠海预设路线一键填充、单次浏览器定位及小车沿路模拟巡航，方便室内汇报演示。
3. **实时定位采集源（`ios/GpsSender/` → 后续平滑切换硬件 GNSS）**：当前阶段使用 iPhone 原生 App 通过 **USB 有线个人热点虚拟网卡（`172.20.10.x`）** 或可信局域网以最高 5Hz 向 FastAPI 上报 `WGS-84` 定位；待外置 USB/串口 GNSS 模块到货后，仅需替换后端定位输入源即可零改动复用整套管线。

---

## 2. 总体拓扑图

```text
  [iPhone GpsSender (USB 有线 / LAN)]    [未来 USB/串口 GNSS 模块]
                  \                        /
                   v  POST /api/gps/fixes (WGS-84 + Bearer Token)
        +----------------------------------------------------+
        |                 FastAPI 协调与定位服务               |
        |  • GpsIngressService: 鉴权、防乱序、时效校验、内存快照 |
        |  • GET /api/gps/latest & WS /ws/gps/live (WGS-84)  |
        |  • NavigationSessionStore & Voice-01 意图/POI 适配  |
        +-------------------+------------------------+-------+
                            |                        |
         REST / WS (WGS-84) |                        | HTTP (lon,lat WGS-84)
                            |                        v
        +-------------------v--------+      +----------------+
        |     前端 Web 多页面应用      |      |  OSRM 路由引擎  |
        |                            |      |  (zhuhai.osrm) |
        | 1) index.html (MapLibre)   |<-----+----------------+
        |    离线八类 GeoJSON 底图     |            ^
        |                            |            | 构建脚本
        | 2) amap.html (高德双模式)   |       [zhuhai.osm]
        |    coord-transform.ts      |
        |    (WGS-84 -> GCJ-02 边界)  |
        |    amap-route-matcher.ts   |
        |    amap-live-controller.ts |
        +----------------------------+
```

---

## 3. 核心组件职责

| 组件 | 关键路径 | 职责 | 明确不负责 |
| --- | --- | --- | --- |
| **OSRM 离线路由引擎** | `docker-compose.yml`、`backend/app/services/osrm.py` | 基于 `zhuhai.osrm` 输出机动车路线几何、总距离、时长与转向步骤 | 采集真实 GPS、渲染界面、处理 `GCJ-02` |
| **FastAPI 定位总线** | `backend/app/gps/`、`backend/app/api/gps.py` | 验证设备 Token、过滤重复/乱序/过期报文，提供 `GET /api/gps/latest` 快照与有界非阻塞 `WS /ws/gps/live` 广播（纯 `WGS-84`） | 落盘保存真实轨迹、调用高德在线 API、转换火星坐标 |
| **FastAPI 离线会话与语音层** | `backend/app/services/navigation.py`、`voice.py` | 维护离线导航会话、道路匹配（`route_matching.py`）、回放控制及本地 OSM POI 语音意图检索 | 直接操作浏览器渲染状态 |
| **离线地图界面** | `frontend/index.html`、`frontend/src/main.ts` | 渲染八类离线 GeoJSON 底图、主/已驶路线、转向卡片与语音候选确认 | 直接访问 OSRM 私有端口 |
| **高德在线双模式界面** | `frontend/amap.html`、`frontend/src/amap-main.ts` | 隔离 `live`/`demo` 双模式 UI、通过 `DrivingSearchGuard` 防止切模式后异步算路回调串台、驱动模糊意图周边检索 | 向后端回写 `GCJ-02` 坐标 |
| **高德路线吸附与偏航控制器** | `frontend/src/amap-route-matcher.ts`、`amap-live-controller.ts` | 边界 `WGS-84 → GCJ-02` 转换、`>100m` 噪点拦截、静止 `<3m` 死区平滑、折线投影吸附、10s 在线心跳与连续 3 帧 `>50m` 偏航节流重算 | 依赖 DOM 或全局 `window.AMap` 单例 |
| **iPhone 定位端** | `ios/GpsSender/` | CoreLocation 5Hz 前台定位实时发送（带退避重试队列）与离线 JSONL 轨迹录制导出 | 坐标加偏、路线规划 |

---

## 4. 关键实时数据流（GPS-02 高德实车闭环）

```text
iPhone CoreLocation (WGS-84, 最高 5Hz)
  -> USB 有线网卡 (172.20.10.1 -> 172.20.10.x:8000) POST /api/gps/fixes
  -> FastAPI GpsIngressService 校验时效与单调序号
  -> WS /ws/gps/live 实时推送 LiveGpsFix (WGS-84)
  -> 前端 AmapLiveController:
       1) (stream_id, sequence) 去重 + 10s 在线心跳计时
       2) 过滤 accuracy_m > 100m 弱信号噪点
       3) wgs84ToGcj02 边界转换
       4) 未算路时：UnroutedJitterFilter 平滑显示并同步实车起点
       5) 导航中：matchPointToAmapRoute 折线吸附 (<= 50m) 更新车标、剩余里程与下一转向；
          连续 3 点偏离 > 50m (accuracy <= 50m, 10s 冷却) 自动调用高德 Driving 重算
```
