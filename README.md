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
