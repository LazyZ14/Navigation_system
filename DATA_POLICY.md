# 数据、坐标与隐私安全规范

## 1. 地图数据规范

当前离线实验区域采用珠海区域 OpenStreetMap 数据 `zhuhai.osm`（历史合成单测亦兼容小型测试夹具）。原始地图文件存放在 `data/raw/`，不得提交 Git，统一通过可复现脚本生成：

- `scripts/build_osrm.sh`：生成 OSRM MLD 路由查询文件（`data/osrm/`）；
- `scripts/build_tiles.sh`：生成八类离线语义 GeoJSON 图层与检索索引（`frontend/public/generated/`）；
- `data/metadata/`：记录输入文件、边界、校验值与生成时间。

---

## 2. 坐标系与边界转换规范

1. **后端与内部契约统一使用 `WGS-84`**：
   - 所有后端模型（`Coordinate`、`LocationFix`、`GpsFixSubmission`、`LiveGpsFix`）固定使用显式字段 `lat`（纬度）、`lon`（经度），时间戳须包含时区偏移并统一归一化为 UTC：
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
   - iPhone `CoreLocation`（`CLLocationManager`）与标准硬件 GNSS 模块（NMEA）原生输出均为 `WGS-84`，上报后端前**不得**做任何人为加偏。
2. **外部服务边界层转换规则**：
   - **OSRM**：URL 参数要求的 `lon,lat` 顺序仅在 `backend/app/services/osrm.py` 内转换；
   - **MapLibre GL JS（`index.html`）**：直接使用 `WGS-84`；
   - **高德地图 JS API（`amap.html`）**：高德底图、`Marker`、`Driving`、`PlaceSearch` 全链路使用 **`GCJ-02`（火星坐标）** 且数组顺序为 `[lon, lat]`。必须在前端高德边界层通过 `frontend/src/coord-transform.ts`（`wgs84ToGcj02` / `gcj02ToWgs84`）完成显式转换，严禁将 `WGS-84` 原始点直接传入高德 SDK。

---

## 3. 测试数据与隐私要求

- 仓库内的自动化测试与演示轨迹（`data/tracks/*.json`、`backend/tests/`、`frontend/src/__tests__/`）必须全部使用合成坐标序列，严禁提交真实个人出行轨迹。
- 后端 GPS 接收服务仅在进程内存中保留有界活跃流的最新一点，不写数据库、不落盘轨迹文件，常规结构化日志仅输出匿名化设备摘要、流 ID、序号与网络延迟。

---

## 4. 严禁提交版本库的文件清单

以下可再生大文件、本机状态与敏感配置已在 `.gitignore` 中屏蔽，严禁强行提交：
- 地图与模型产物：`data/raw/*`、`data/osrm/*`、`data/tiles/*`、`data/models/`、`frontend/public/generated/*`、`*.osrm*`、`*.mbtiles`；
- 密钥与环境配置：`.env`、`.env*.local`、`frontend/.env.local`（高德 Key 与安全密钥）、`.env.gps.local`（GPS 设备 Token）；
- 轨迹与运行日志：`*.jsonl`、`*.log`；
- 构建与 IDE 状态：`node_modules/`、`dist/`、`.venv/`、`**/xcuserdata/`、`**/*.xcuserstate`、`.worktrees/`、`.superpowers/`。
