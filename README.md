# Navigation System（智能车载导航系统）

面向车载实验与实车联调的双栈导航系统：同时提供 **纯离线可复现导航闭环（MapLibre + OSRM + 本地语音/意图解析）** 与 **高德在线增强导航闭环（支持「📡 实车实时导航」与「🧪 手动演示 Demo」双模式）**，配套 **iPhone 5Hz 有线/局域网 GPS 采集端（`GpsSender`）** 及标准 `WGS-84` 实时定位总线（可直接平滑切换至外置 USB/串口 GNSS 模块）。

---

## 核心功能矩阵

| 模块 | 入口 / 位置 | 核心能力 |
| --- | --- | --- |
| **高德在线增强导航（双模式）** | `frontend/amap.html` | • **📡 实车实时导航**：接入手机 USB/LAN 或 GNSS 实时定位（边界 `WGS-84 → GCJ-02` 转换）、静止防抖、规划折线连续性+航向角吸附、剩余里程/转向指引实时刷新、连续偏航自动节流重算<br>• **🧪 手动演示 Demo**：地图点选起终点、珠海预设路线（金鼎 → 日月贝）、浏览器定位与小车模拟沿路巡航<br>• **🎤 智能 POI 搜寻**：支持语音/文字口语模糊意图理解（如“我饿了”、“车快没电了”）检索周边 5km 地点 |
| **离线导航 MVP + Voice-01** | `frontend/index.html` | 珠海实验区八类语义 GeoJSON 离线底图、OSRM 机动车算路、轨迹回放、偏航重规划，以及基于腾讯云一句话 ASR + 本地 Ollama `qwen2.5:7b` 的本地 OSM POI 语音导航 |
| **FastAPI 协调与定位总线** | `backend/app/` | OSRM 路由适配、离线导航会话管理、`POST /api/gps/fixes`（Token 鉴权 + 防乱序/时效校验）、`GET /api/gps/latest` 在线快照与 `WS /ws/gps/live` 实时非阻塞广播 |
| **iPhone 定位端（GpsSender）** | `ios/GpsSender/` | SwiftUI + CoreLocation 导航级精度最高 5Hz 实时上报（支持 USB 有线热点低延迟传输）与无网离线 `.jsonl` 轨迹录制导出 |

---

## 快速开始一：高德实车实时导航 + iPhone USB 有线联调（推荐）

在硬件 GNSS 模块到货前，可通过一根数据线将 iPhone 作为高精度 `WGS-84` 定位源接入 Mac 主机：

### 1. 配置高德前端密钥（本地忽略，不入 Git）

```bash
cp frontend/.env.example frontend/.env.local
# 在 frontend/.env.local 中填入你的 VITE_AMAP_KEY 与 VITE_AMAP_SECURITY_CODE
```

### 2. 建立 iPhone USB 有线连接

1. 用数据线连接 iPhone 与 Mac，开启 iPhone **「设置 → 个人热点 → 允许其他人加入」**；
2. 打开 Mac **「系统设置 → 网络 → iPhone USB」**，关闭 **「除非需要，否则停用」**，查看分配给 Mac 的有线 IP（通常为 `172.20.10.x`，也可通过 `ifconfig` 查看）；
3. 用 Xcode 打开 `ios/GpsSender/GpsSender.xcodeproj` 编译安装到真机（详见 [ios/README.md](ios/README.md)）。

### 3. 启动后端 GPS 接收总线与前端开发服务

终端 1（配置临时设备令牌并启动 FastAPI，切勿将令牌提交 Git）：

```bash
export GPS_DEVICE_TOKENS_JSON='{"iphone":"replace-with-random-token"}'
PYTHONPATH=backend backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

终端 2（启动前端多页面服务，自动代理 `/api` 与 `/ws`）：

```bash
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
```

### 4. 开始实车导航或演示

- **实车实时模式**：打开 <http://127.0.0.1:5173/amap.html?mode=live>，在手机 `GpsSender` 填入 Mac 的 USB 有线 IP（如 `172.20.10.10`）、端口 `8000`、设备 ID `iphone` 与对应令牌后点 **「开始发送」**。页面显示 `🟢 手机/GNSS 实时定位在线` 后，点击地图任意位置或通过语音/文字搜索周边 POI 即可开始实时跟车导航与偏航自动重算。
- **手动演示模式**：打开 <http://127.0.0.1:5173/amap.html>（默认进入「🧪 手动演示 Demo」），无需连接手机即可点击「🎯 填充珠海测试点」、算路并播放「▶ 模拟小车沿路巡航」。

---

## 快速开始二：离线导航 MVP（Docker 一键启动）

前提：已准备 `data/raw/zhuhai.osm` 并通过脚本生成离线数据：

```bash
bash scripts/build_osrm.sh data/raw/zhuhai.osm zhuhai
python3 scripts/build_tiles.sh data/raw/zhuhai.osm
bash scripts/demo.sh
```

打开 <http://127.0.0.1:5173/> 即可在无外网环境下规划珠海区域路线并进行正常/偏航轨迹模拟回放。停止容器执行 `docker compose down`。

---

## 快速开始三：Voice-01 本地语音导航演示

语音导航在离线地图基础上结合腾讯云一句话识别（需网络与凭证）和本机 Ollama `qwen2.5:7b`（只提取地点需求，候选坐标均来自本地 OSM `search-poi.geojson`）：

```bash
# 1. 启动独立端口 OSRM
docker run --rm --name voice01-osrm -p 127.0.0.1:15000:5000 -v "$PWD/data/osrm:/data:ro" ghcr.io/project-osrm/osrm-backend:v5.27.1 osrm-routed --algorithm mld /data/zhuhai.osrm

# 2. 另开终端注入凭证并启动 API（确保本机 Ollama 已运行）
read -r -p 'Tencent SecretId: ' TENCENT_SECRET_ID
read -r -s -p 'Tencent SecretKey: ' TENCENT_SECRET_KEY; printf '\n'
read -r -p 'Maximum destination snap distance in metres: ' VOICE_MAX_DESTINATION_SNAP_M
export TENCENT_SECRET_ID TENCENT_SECRET_KEY VOICE_MAX_DESTINATION_SNAP_M
OSRM_BASE_URL=http://127.0.0.1:15000 PYTHONPATH=backend backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 18000

# 3. 另开终端启动前端
VOICE_API_URL=http://127.0.0.1:18000 npm --prefix frontend run dev -- --host 127.0.0.1 --port 15173
```

打开 `http://localhost:15173/` 即可录音或输入文本检索候选并确认导航。

---

## iPhone 离线 GPS 轨迹录制与分析

无需局域网或热点时，可在 `GpsSender` App 顶部切至 **「离线录制」**，采集完成后通过系统分享导出 `.jsonl` 文件并在 Mac 上统计采样率、精度与定位年龄：

```bash
python3 scripts/analyze_gps_recording.py /path/to/exported/session.jsonl
```

详细步骤参见 [离线录制测试手册](docs/gps-offline-recording-test.md) 与 [GPS-01 联调手册](docs/gps-01-manual-validation.md)。

---

## 项目目录结构

```text
Navigation_system/
├── backend/              # FastAPI 路由协调、GPS 实时总线与语音意图服务
├── frontend/             # Vite + TypeScript 双入口前端（index.html 离线 / amap.html 高德增强）
├── ios/GpsSender/        # iPhone 实时 GPS 发送与离线轨迹录制工程（Xcode）
├── scripts/              # OSM/OSRM 数据构建、冒烟测试与 GPS 录制分析脚本
├── data/                 # 本地地图与构建产物目录（大文件与敏感数据均已 Git 忽略）
├── docs/                 # 架构调研、联调手册、设计规范与实施计划
├── AGENTS.md             # AI 协作与工程红线约束
├── ARCHITECTURE.md       # 系统总体架构与实时数据流说明
├── DEVELOPMENT.md        # 阶段演进路线与验收记录
└── DATA_POLICY.md        # 坐标系边界转换、隐私与数据管理规范
```

---

## 自动化测试与构建验证

```bash
# 后端单元与接口测试（Pytest）
PYTHONPATH=backend backend/.venv/bin/pytest backend/tests -q

# 前端单元测试（Vitest）与多页面生产构建校验
npm --prefix frontend test -- --run
npm --prefix frontend run build

# 离线容器全链路冒烟测试（需 Docker 运行中）
bash scripts/smoke_test.sh
```
