# Navigation System

第一阶段目标：在 macOS 本地浏览器中，基于北京实验区域的 OpenStreetMap 路网完成离线汽车路线规划与导航可视化。

当前范围仅包括 OSRM 路由、MapLibre 渲染和模拟定位轨迹。POI 推荐、LLM、语音、OCR 和真实 GPS 接入均不属于本阶段。

在开始实现前，请先阅读：

- [架构说明](ARCHITECTURE.md)
- [AI 与开发协作约束](AGENTS.md)
- [开发阶段与验收](DEVELOPMENT.md)
- [数据和坐标规范](DATA_POLICY.md)

## 实验数据

第一阶段地图源文件为用户提供的北京区域 `map.osm`。原始 OSM、OSRM 构建文件和离线地图瓦片均为可再生数据，不应提交到 Git。

## 一键启动本地 MVP

前提：Docker Desktop 已启动，且本机已通过 `scripts/build_osrm.sh` 生成忽略的
`data/osrm/beijing.osrm*` 文件，并已生成 `frontend/public/generated/map-roads.geojson`。

```bash
bash scripts/demo.sh
```

打开 <http://127.0.0.1:5173/> 后已预置与合成轨迹一致的演示起终点；选择正常或偏航轨迹，
再点击“规划路线”和“开始模拟回放”即可。也可点击地图改选起终点。回放按钮支持暂停、继续与重新回放。
所有服务仅绑定本机回环地址：前端 `5173`、FastAPI `8000`、OSRM `5000`。

## Phase 2：iPhone 原始 GPS 局域网接收

GPS-01 提供独立的 `POST /api/gps/fixes` 原始定位接收接口；它不会调用 OSRM、创建导航会话、推送 WebSocket 或改变地图。请求使用 WGS-84 的 `lat`、`lon`，且区分 iPhone 定位 `timestamp` 与服务端 `received_at`。

默认 API 继续只绑定 `127.0.0.1`。仅在可信测试局域网中，将它绑定到 Mac 的**具体局域网 IPv4 地址**，并配置不提交 Git 的设备令牌：

```bash
export GPS_LAN_BIND_ADDRESS=192.168.1.23
export GPS_DEVICE_TOKENS_JSON='{"ios-demo-device":"replace-with-a-long-random-token"}'
docker compose up --build api
```

iPhone 以 `Authorization: Bearer <token>` 提交。HTTP 明文只适用于可信实验网络；部署前需改用 TLS、令牌轮换、主机防火墙和网络隔离。不要把令牌、真实坐标或接收日志提交到版本库。

启动后可运行完整闭环验证：

```bash
bash scripts/smoke_test.sh
```

本地容器关系为：浏览器 → `frontend`（Nginx/MapLibre）→ `api`（FastAPI）→ `osrm`。
前端通过 Nginx 将 `/api` 反向代理给 FastAPI，不直接调用 OSRM；离线道路 GeoJSON 由
`frontend` 容器静态提供。三个容器用于隔离职责并让启动可复现，并非业务逻辑必须依赖 Docker。

停止服务：

```bash
docker compose down
```
