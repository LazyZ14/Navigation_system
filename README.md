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
docker compose up --build
```

打开 <http://127.0.0.1:5173/>，在地图上依次选择起点和终点，再点击“规划路线”。
所有服务仅绑定本机回环地址：前端 `5173`、FastAPI `8000`、OSRM `5000`。

停止服务：

```bash
docker compose down
```
