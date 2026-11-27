# 系统架构

项目仅保留高德导航栈。旧离线地图数据、MapLibre 渲染、OSRM 规划、后端导航会话/回放和 OSM POI 索引已退役。

## 定位与导航链路

1. iPhone `GpsSender` 或其他 GNSS 适配端以 WGS-84、显式 `lat`/`lon` 字段上报 `POST /api/gps/fixes`，设备 ID 对应 Bearer Token。
2. FastAPI 校验坐标、时间、流 ID 与序号；通过 `GET /api/gps/latest` 暴露在线快照，通过 `/ws/gps/live` 广播接受的定位。内存状态由单个后端进程持有；当前部署使用一个 worker。
3. Vite 或 Nginx 将 `/api`、`/ws` 转发给后端；设备直接连接后端端口。
4. 高德页实时模式在坐标边界转换为 GCJ-02；巡航时执行精度过滤和静止平滑，导航时执行路线投影吸附、进度更新与偏航节流重算。高德承担地图、POI 搜索及路线规划。

## 组件职责

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| 高德导航页 | `frontend/amap.html`、`src/amap-main.ts` | SDK、地图交互、实时订阅、手动 Demo、浏览器语音搜索 |
| 实时控制器 | `src/amap-live-controller.ts` | 在线心跳、弱信号、导航状态、偏航冷却与模式隔离 |
| 高德路线匹配 | `src/amap-route-matcher.ts` | 路线索引、连续性/航向匹配、静止防抖 |
| 坐标适配 | `src/coord-transform.ts` | WGS-84 与 GCJ-02 显式转换 |
| GPS 总线 | `backend/app/api/gps.py`、`gps/` | 硬件无关接收、认证、去重与广播 |
| 可选语音转写 | `backend/app/api/voice.py`、`services/tencent_asr.py` | 原有腾讯云转写适配及音频/来源/并发限制；不依赖本地地图 |
| iOS 端 | `ios/GpsSender/` | 定位、发送队列、Keychain、离线录制与导出 |

`frontend/index.html` 仅转到高德页，保留 URL 查询与片段。实时与 Demo 模式状态/异步回调隔离。后端无高德私有坐标逻辑，也不维护道路图。

## 部署与凭证

Docker Compose 只包含 `api` 和 `frontend`。默认端口仅本机可访问；通过 `GPS_LAN_BIND_ADDRESS` 显式开放指定设备网络。不要使用多个 worker 分散进程内 GPS 状态。

本地高德配置从 `frontend/.env.local` 或浏览器 Key 配置读取；GPS 令牌通过 `.env.gps.local`/环境变量注入。`.dockerignore` 排除真实环境文件，因此容器前端使用页面配置。高德 JS API 的浏览器凭证无法对页面使用者隐藏，应配置服务端控制台的使用限制。
