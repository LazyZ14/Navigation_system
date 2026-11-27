# GPS-02 合并 iPhone 有线定位分支并打通高德实车导航闭环设计文档

## 1. 意图与背景（Intent & Why）

在车载外置 USB/串口 GNSS 硬件模块尚未到货前，项目需要复用已在真机有线通道（`iPhone USB` 虚拟网卡 `172.20.10.x`）验证通过的 `feature/iphone-gps-sender` 分支能力，将 iPhone 采集的实时定位接入 `main` 分支的高德在线增强导航页面（`frontend/amap.html`），跑通从“手机有线 `WGS-84` 定位上报 → FastAPI 定位总线 → 高德 `GCJ-02` 边界转换 → 路线吸附、转向提示推进与偏航自动重算”的完整实车导航闭环。

同时，界面上需明确区分 **「📡 实车实时导航」**（生产/实车联调实现）与 **「🧪 手动演示 Demo」**（脱离真机 GPS 的室内汇报与答辩演示），确保实车联调不误触改起点、室内演示不依赖手机在线。后端定位总线保持与设备无关的标准 `WGS-84` 协议，待硬件 GNSS 模块到货后可直接替换数据源而无需修改后端分发接口与高德前端逻辑。

---

## 2. 目标、非目标与反目标（Goals, Non-Goals & Anti-Goals）

### 目标（Goals）
1. **分支干净合入 `main`**：保存 `feature/iphone-gps-sender` 在 Xcode 27 下的编译修复，移除误跟踪的 Xcode 用户界面状态文件（`UserInterfaceState.xcuserstate`），无冲突合入 `main` 并保留全部已有离线导航与语音能力。
2. **标准 `WGS-84` 实时定位出口**：在 FastAPI 的 `GpsIngressService` 上提供最新定位快照查询（`GET /api/gps/latest`）与实时 WebSocket 广播（`WS /ws/gps/live`），在开发态（Vite）与容器态（Nginx）均可通过统一路径访问。
3. **高德页面双模式隔离**：在 `amap.html` 左侧控制面板顶部提供清晰的模式切换（`📡 实车实时导航` / `🧪 手动演示 Demo`），两套交互状态互不污染。
4. **实车完整导航闭环**：
   - 边界层使用本地 `wgs84ToGcj02` 完成零延迟坐标转换；
   - 未规划路线时对原始定位做精度门限过滤与静止微抖动平滑，自动同步为算路起点与周边语音/文字 POI 搜索圆心；
   - 已规划路线时对车辆位置执行“连续性 + 航向角消歧”的路线折线投影吸附（不直接裸画原始抖动 GPS 点），实时更新小车位置、车头朝向、剩余总里程/预计剩余耗时、当前与下一步导航文字指引，以及终点到达状态；
   - 当定位有效但连续偏离当前高德路线超过阈值时，节流触发高德 `AMap.Driving` 自动重算路线并平滑切换至新路线。

### 非目标（Non-Goals）
- 本阶段不编写串口/USB 硬件 GNSS 的 NMEA 解析器（留待硬件模块到货后作为新 Producer 接入同一 `GpsIngressService`）。
- 本阶段不改动离线 MapLibre 页面（`index.html`）的既有回放与语音交互流程。
- 本阶段不在服务端持久化或落盘任何真实 GPS 轨迹，也不引入高德收费 Web Service REST 坐标转换接口。

### 反目标（Anti-Goals）
- **严禁坐标系混用**：不得在后端内部存储或广播 `GCJ-02` 坐标，也不得将未经转换的 `WGS-84` 坐标直接传给高德 `Marker`、`Driving` 或 `PlaceSearch`。
- **严禁裸绘原始 GPS 跳点**：导航中不得跳过路线吸附直接将原始抖动定位点画在路外；静止低速时不得因 GPS 漂移导致车头乱转。
- **严禁偏航风暴**：偏航重算必须带连续帧确认、精度门限与冷却时间，不得在路口或信号弱时每秒反复请求高德算路 API。
- **严禁使用真实个人轨迹入库测试**：所有单元与集成测试一律使用合成坐标序列。

---

## 3. 约束条件（Constraints）

1. **遵循 `AGENTS.md` 架构边界**：
   - 内部标准坐标系固定为 `WGS-84`，数据模型字段固定为 `lat`、`lon`（禁止使用无类型 `[number, number]` 数组表达 API 契约坐标）；
   - 高德 JS API 要求的 `[lng, lat]`（`GCJ-02`）数组仅限在前端高德边界适配层内转换与消费；
   - 自动化测试必须覆盖四类核心场景：**正常路线推进**、**无可达路线**、**定位点在路网外/大偏差点**、**偏航触发重算**。
2. **隐私与安全约束**：
   - `POST /api/gps/fixes` 继续要求 `Authorization: Bearer <token>` 常量时间鉴权；
   - `GET /api/gps/latest` 与 `WS /ws/gps/live` 仅面向本机/同源前端消费，输出脱敏后的定位状态（不含设备 Token），服务端常规日志不打印经纬度与密钥。
3. **本地开发与容器代理一致性**：
   - `frontend/nginx.conf` 已配置 `/ws/` 升级代理；`frontend/vite.config.ts` 须补齐 `/ws` 的 `ws: true` 代理配置，使 `npm run dev` 与 Docker 部署行为完全一致。

---

## 4. 方案对比与选型（Approaches）

| 维度 | 方案 A：后端纯 `WGS-84` 实时定位总线 + 高德前端边界层转换、吸附与偏航重算（已选定） | 方案 B：前端将高德路线反算 `WGS-84` 上传后端匹配后再推回前端 |
|---|---|---|
| **职责划分** | FastAPI 专注设备接入、鉴权、时效校验与 `WGS-84` 实时分发；高德适配层闭环消费高德自身的 `GCJ-02` 路线几何 | FastAPI 需额外维护“高德在线路线会话”，前后端共同持有在线算路状态 |
| **坐标转换次数** | 单向一次（前端边界 `WGS-84 → GCJ-02`） | 往返两次（路线 `GCJ-02 → WGS-84` 入后端，吸附点再 `WGS-84 → GCJ-02` 回前端） |
| **实时性与复杂度** | 5Hz 定位单跳直达前端，算路/重算无需跨端重传整条折线 | 每次算路与重算均需跨端同步数百个折线顶点，状态同步复杂 |
| **未来 GNSS 兼容性** | 极佳：硬件 GNSS 模块只需向 `GpsIngressService` 写入 `WGS-84` 点，前后端其余部分零改动 | 相同，但后端背负不必要的在线地图状态耦合 |

**选定结论**：采用 **方案 A**。

---

## 5. 详细设计（Detailed Design）

### 5.1 分支整理与合并策略（集成分支 `feature/amap-live-gps`）
1. 在 `feature/iphone-gps-sender` 分支提交 iOS 工程编译修复（`project.pbxproj`、`ContentView.swift`、`GpsRecordingSession.swift`、`LocationRecorder.swift`、`GpsSenderTests.swift`、`LocationRecorderTests.swift`），同时执行 `git rm --cached` 移除误提交的 `UserInterfaceState.xcuserstate`（`.gitignore` 已忽略 `*.xcuserstate`）。
2. 基于当前干净的 `main` 创建集成分支 `feature/amap-live-gps`（保持 `main` 全程稳定不被半成品污染），将 `feature/iphone-gps-sender` 合并入 `feature/amap-live-gps`，待全链路自动化测试与真机高德联调验收通过后再合入 `main`。合并时融合以下共享文件：
   - `backend/app/main.py`：同时挂载 `routes`、`voice`、`gps`、`navigation` 与 `websocket` 路由；
   - `backend/app/config.py`：保留 `osrm_base_url` 的同时合入 `gps_device_tokens` 与 `gps_max_active_streams`；
   - `docker-compose.yml`：保留 `main` 的 `zhuhai.osrm` 配置，同时合入 `GPS_LAN_BIND_ADDRESS:-127.0.0.1` 与 `GPS_DEVICE_TOKENS_JSON:-{}` 环境变量透传；
   - `.gitignore` 与 `README.md`：保留双方新增忽略项与文档说明。

### 5.2 后端实时定位分发接口（FastAPI）

#### 数据模型（`backend/app/gps/models.py`）
所有模型均带显式字段类型与最小示例（`model_config = ConfigDict(json_schema_extra={"example": ...})`）：

1. **`LiveGpsFix`（单条已确认的 `WGS-84` 实时定位）**：
   ```json
   {
     "device_id": "iphone",
     "stream_id": "19989152-7c55-40c8-b98f-fdf7d5aa81d9",
     "sequence": 14,
     "lat": 22.3734,
     "lon": 113.5786,
     "accuracy_m": 6.5,
     "speed_mps": 8.3,
     "heading_deg": 85.0,
     "timestamp": "2026-11-27T05:07:16.000Z",
     "received_at": "2026-11-27T05:07:16.039Z"
   }
   ```
2. **`LatestGpsStatusResponse`（`GET /api/gps/latest` 响应）**：
   - 当存在活跃流且 `now - last_received_at <= live_timeout`（默认 `10s`）时：`active = true`，携带最新 `fix` 及 `age_ms`；
   - 当尚无任何定位上报时：`active = false, fix = null, age_ms = null`；
   - 当有历史最后一点但已超过 `10s` 未更新时：`active = false`，仍返回最后一次 `fix` 与 `age_ms` 供前端展示“信号中断（上次更新 Xs 前）”，前端据此禁止将其当作新鲜实时起点自动重算。
   ```json
   {
     "active": true,
     "age_ms": 120,
     "fix": {
       "device_id": "iphone",
       "stream_id": "19989152-7c55-40c8-b98f-fdf7d5aa81d9",
       "sequence": 14,
       "lat": 22.3734,
       "lon": 113.5786,
       "accuracy_m": 6.5,
       "speed_mps": 8.3,
       "heading_deg": 85.0,
       "timestamp": "2026-11-27T05:07:16.000Z",
       "received_at": "2026-11-27T05:07:16.039Z"
     }
   }
   ```
3. **`WS /ws/gps/live`（实时定位流）**：
   - 客户端连接建立后，若当前已有未过期的最新定位（`active == true`），服务端立即推送首帧 `LiveGpsFix` JSON；
   - 此后每当 `GpsIngressService.ingest()` 接收新的有效定位（`disposition == ACCEPTED`）时，通过每个订阅者独立的有界异步队列（`asyncio.Queue(maxsize=10)`，满队列丢弃最旧帧保最新帧）向所有在线 WebSocket 客户端广播 `LiveGpsFix` JSON；
   - 注意：`POST /api/gps/fixes` 若是同步路由或异步路由，统一改为 `async def` 并在同一事件循环内调用非阻塞广播，确保 `asyncio.Queue` 线程/协程安全。

### 5.3 前端双模式状态机（`amap.html` + `amap-main.ts`）

在控制面板顶部引入分段模式切换器（默认进入 `🧪 手动演示 Demo` 或可通过 URL 参数 `?mode=live` 直接打开实车模式，也支持一键点击切换）：

| 行为维度 | `📡 实车实时导航`（Live Mode） | `🧪 手动演示 Demo`（Demo Mode） |
|---|---|---|
| **定位连接** | 自动建立 `/ws/gps/live` 连接（断线指数退避重连 + 初始拉取 `GET /api/gps/latest`），每 1s 检查一次信号新鲜度（>10s 视为信号离线） | 关闭 `/ws/gps/live` 订阅，不消费手机定位流 |
| **起点来源** | **完全由手机实时定位锁定**：收到有效定位后自动设为/更新起点（未进导航态时跟随更新；进入导航态后起点固定为规划时刻起点，自车图标独立沿路线推进） | 手动点击地图（第 1 次点击）、点击「📍 获取浏览器单次定位」或点击「🎯 填充珠海测试点」 |
| **地图点击行为** | 点击地图**直接设置/更换终点**（若当前手机定位在线，设完终点可直接算路或点算路按钮） | 保持原逻辑：第 1 次设起点，第 2 次设终点 |
| **周边 POI 搜索** | 优先以当前手机实时 `GCJ-02` 位置为 5km 搜索圆心；点击 POI 卡片设为终点并立即从当前实车位置规划驾车路线 | 保持原逻辑：以手动起点或地图中心为圆心 |
| **巡航按钮** | 隐藏「▶ 模拟小车沿路巡航」，显示实时导航遥测卡片（当前车速 km/h、航向、GPS 精度、吸附状态、当前路段指引） | 显示「▶ 模拟小车沿路巡航」，保留 `carMarker.moveAlong` 动画演示 |
| **模式切换清理** | 切入时停止任何正在播放的 Demo `moveAlong` 巡航动画，清除手动起点，立即绑定实时定位流 | 切入时断开实时定位流与偏航重算计时器，恢复手动选点与模拟巡航按钮 |

### 5.4 高德边界层坐标转换、平滑、路线吸附与偏航重算（独立纯逻辑模块）

将核心算法抽离为无 DOM / 无全局 `window.AMap` 依赖的纯 TypeScript 模块（如 `frontend/src/amap-route-matcher.ts` 与 `frontend/src/amap-live-controller.ts`），以便用 Vitest 做确定性测试：

1. **精度门限与边界转换**：
   - 丢弃 `accuracy_m > 100` 的极差噪点（仅在状态栏提示“GPS 信号弱，精度 ±Xm”，不驱动小车跳变，也不触发偏航）；
   - 通过 `wgs84ToGcj02(fix.lat, fix.lon)` 转换为 `GcjCoordinate { lat, lon }`，仅在调用高德 SDK 时映射为 `[lon, lat]`。
2. **未导航巡航态（无规划路线时）的防抖显示**：
   - 为避免室内/等红灯时原始 GPS 轻微漂移导致车辆乱跳（遵守 `AGENTS.md` 不直接裸绘原始噪点原则），当没有规划路线时采用**位移死区 + 指数平滑（EMA）**：若新点与上一显示点距离 `< 3m` 且 `speed_mps < 1.0`，保持车辆位置与车头角度不变；否则以平滑系数更新位置，车头角度仅在 `heading_deg != null && (speed_mps ?? 0) >= 1.0` 时更新。
3. **导航态（已有高德规划路线时）的路线吸附与进度计算**：
   - 解析 `AMap.Driving` 返回的 `route.steps`，提取扁平化折线顶点序列及每一步（`step`）对应的起止累计里程区间 `[startDistM, endDistM]` 与转向文案 `instruction`；
   - 使用与后端 `route_matching.py` 一致的二阶段匹配算法（空间候选窗口 `[prevDist - 15m, prevDist + 1000m]` + 距离/连续性/航向角综合评分）计算：
     - `projected`: 吸附在路线折线上的 `GCJ-02` 坐标；
     - `segmentHeadingDeg`: 当前匹配折线段的道路切线朝向；
     - `distanceToRouteM`: 车辆到规划路线的垂直偏离距离；
     - `distanceAlongRouteM` / `remainingDistanceM`: 已行驶距离与剩余总距离；
     - `currentStepIndex` / `nextInstruction`: 当前所在步骤及剩余步内距离。
   - **车辆渲染规则**：
     - 当 `distanceToRouteM <= 50m`（正常在路上）：小车图标严格绘制在**路线吸附点 `projected`** 上，车头角度优先采用道路切线方向（或高速行驶下的融合航向），消除横向漂移；
     - 当 `distanceToRouteM > 50m`（已明显驶离规划路线，处于路网外或待重算区间）：不再强行拉回旧路线，改画在平滑后的实车 `GCJ-02` 位置并高亮提示“已偏离路线 X 米”。
   - **到达判定**：当 `remainingDistanceM <= 25m` 时，标记导航状态为“🎉 已到达终点附近”，停止偏航检测。
4. **偏航检测与自动重算节流（Off-Route Recalculation）**：
   - **触发条件**：处于实车导航态、未到达终点、`fix.accuracy_m <= 50m`（防止进隧道/高架下定位发散误判偏航），且**连续 `3` 个有效定位点**满足 `distanceToRouteM > 50m`；
   - **节流保护**：两次自动重算之间至少间隔 **`10` 秒冷却期**，且同一时刻最多只有 `1` 个进行中的 `AMap.Driving.search` 请求；
   - **重算结果处理**：
     - 算路成功：用新路线替换地图折线、重置匹配器历史进度（`previousMatch = null`）、刷新步骤列表，状态栏提示“🔄 已偏航重新规划路线”；
     - 无可达路线或网络失败：保留当前终点与实车显示，明确展示错误状态“重算失败：当前位置无可达驾车路线”，等待冷却期后若仍在有效道路再试或由用户重选终点。

---

## 6. 留给实现者的细节（Left to the Builder）

- CSS 样式细节（分段按钮配色、在线绿点呼吸灯、实时遥测小字排版），复用 `amap-style.css` 现有色板（`#2563eb`、`#10b981`、`#ef4444`、`#f8fafc`）。
- 高德小车图标旋转偏移角换算细节（高德默认示例 `car.png` 车头朝向与正北顺时针 `0~360°` 角度的对齐公式，需结合 `AMap.Marker.setAngle` 验证方向一致）。
- WebSocket 断线重连的具体退避梯度（如 `1s → 2s → 5s` 上限）。

---

## 7. 验证策略（Verification Plan）

1. **后端单元测试（Pytest）**：
   - `GET /api/gps/latest`：无数据返回 `active=false`、新鲜点返回 `active=true`、超过 10s 过期返回 `active=false` 但保留最后点；
   - `WS /ws/gps/live`：连接即收当前活跃点、新 `POST /api/gps/fixes` 实时广播、重复包/乱序包/鉴权失败包绝不广播、多客户端并发订阅与断开清理。
2. **前端单元与集成测试（Vitest）**：
   - **正常路线**：合成沿珠海路线行驶的 `WGS-84` 轨迹序列，验证 `WGS-84 → GCJ-02` 转换、路线吸附落点在折线上、剩余里程递减、步骤指引推进与到达终点判定；
   - **无可达路线**：模拟 `Driving.search` 返回无路线/失败（如跨海孤立点），验证实车模式与偏航重算均给出明确错误提示且状态机不卡死；
   - **定位点在路网外 / 低精度噪点**：输入远离道路的大偏差点及 `accuracy_m > 100m` 噪点，验证低精度点被过滤、路网外点不错误吸回数公里外的旧线段；
   - **偏航重算与节流**：输入先沿主路行驶、随后连续 3 点偏离 >50m 的合成轨迹，验证恰好触发 **1 次**重算请求，且冷却期内后续偏离点不重复刷爆算路接口；
   - **双模式隔离**：验证从实车模式切回手动 Demo 模式时，WebSocket 正常关闭、手动选起终点与模拟巡航恢复正常。
3. **iOS 与全栈回归验证**：
   - 运行后端全量 Pytest、前端全量 Vitest & `npm run build`、以及 `xcodebuild` 验证三端零回归。
