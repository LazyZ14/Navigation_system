# Navigation System

## Voice-01 本地演示

语音导航使用浏览器录音、腾讯云一句话识别和本机 Ollama `qwen2.5:7b`。录音通过 FastAPI 发送腾讯云，可能产生费用；文本输入可独立测试 LLM。模型只提取地点需求，候选坐标来自本地 OSM。选择候选并确认后才调用导航会话；停车场和地点数据覆盖范围受 OSM 约束。识别文本可编辑，尤其需要核对地名。浏览器录音要求 localhost 或 HTTPS 并授予麦克风权限。

以下步骤使用独立端口，避免影响其他 worktree。需要 Python 3.12、Node.js、Docker、ffmpeg、腾讯云 ASR 服务及凭证、已安装的 Ollama `qwen2.5:7b` 和珠海 OSM 文件。腾讯云语音识别需要网络，其他导航服务仍在本机运行。地图产物与密钥均不提交 Git。Ubuntu 尚需实际验证。

```bash
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -e './backend[voice,dev]'
cd frontend && npm ci && cd ..
# 将已有珠海 OSM 文件放在 data/raw/zhuhai.osm 后：
bash scripts/build_osrm.sh data/raw/zhuhai.osm zhuhai
python3 scripts/build_tiles.sh data/raw/zhuhai.osm
docker run --rm --name voice01-osrm -p 127.0.0.1:15000:5000 -v "$PWD/data/osrm:/data:ro" ghcr.io/project-osrm/osrm-backend:v5.27.1 osrm-routed --algorithm mld /data/zhuhai.osrm
```

另开终端，先运行 `bash`，再在仓库根目录安全地输入腾讯云 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY` 并启动 API（Ollama 需已运行）。不要将密钥放入源码、聊天或提交；区域可通过 `TENCENT_REGION` 设置，默认 `ap-guangzhou`：

```bash
read -r -p 'Tencent SecretId: ' TENCENT_SECRET_ID
read -r -s -p 'Tencent SecretKey: ' TENCENT_SECRET_KEY; printf '\n'
export TENCENT_SECRET_ID TENCENT_SECRET_KEY
OSRM_BASE_URL=http://127.0.0.1:15000 PYTHONPATH=backend backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 18000
```

再开终端启动界面：

```bash
cd frontend
VOICE_API_URL=http://127.0.0.1:18000 npm run dev -- --host 127.0.0.1 --port 15173
```

打开 `http://localhost:15173/`。选择或保留演示起点，点击“开始录音”，说出需求后点击“停止录音”；也可以直接输入文本并点击“解析需求”。录音不超过 60 秒；选择地图上的候选对应按钮，点击“确认导航”；取消不会创建导航会话。服务不可用和没有候选时界面会提示。结束时分别在三个终端按 Ctrl-C。默认 Ollama 地址是 `http://127.0.0.1:11434`，可通过 `OLLAMA_URL`、`OLLAMA_MODEL` 配置。

本地离线导航与 GPS 数据采集系统，支持 macOS Web 界面导航和 iPhone 原始定位录制。

## 当前阶段

### Phase 1：离线导航 MVP（珠海实验区域）

基于 OpenStreetMap 路网的离线汽车路线规划与导航可视化，使用 OSRM 路由引擎、MapLibre GL JS 地图渲染和 FastAPI 协调服务。

**核心能力：**
- 离线道路网络构建（OSRM MLD）
- 八类语义 GeoJSON 底图（道路、建筑、水系、绿地、用地、道路标签、地点标签、POI）
- 中文标签渲染（优先 `name:zh`）
- 模拟轨迹回放与偏航重规划
- 完全离线运行，无云服务依赖

**当前地图：** 珠海实验区域（华夏路 → 港湾大道 → 软件园路）

**快速启动：**
```bash
# 前提：已构建珠海 OSRM 数据和 GeoJSON
bash scripts/demo.sh
```

打开 <http://127.0.0.1:5173/> 查看珠海地图，点击"规划路线"和"开始模拟回放"。

### Phase 2：iPhone GPS 数据采集（GPS-01）

独立的 iPhone App 支持两种模式：

**实时发送模式：**
- 通过局域网 HTTP POST 发送原始定位到 Mac 端 FastAPI
- WGS-84 坐标，区分定位时间戳和接收时间
- 设备令牌认证，队列调度和性能指标监控

**离线录制模式：**
- 无需 Wi-Fi，本地保存 GPS 轨迹到 JSONL 文件
- 增量持久化，包含 lat、lon、timestamp、accuracy、speed、heading
- iOS 系统分享导出（AirDrop、Files）
- Mac 端分析脚本统计采样率、精度、定位年龄等指标

**iOS App 位置：** `ios/GpsSender/`

## 项目结构

```
Navigation_system/
├── backend/              # FastAPI 导航服务和 GPS 接收接口
├── frontend/             # MapLibre GL JS Web 界面
├── scripts/              # 数据构建、演示、测试和分析脚本
├── data/                 # 可再生地图数据（Git 忽略）
│   ├── raw/              # 原始 OSM 文件
│   ├── osrm/             # OSRM 路由数据
│   ├── tracks/           # 模拟轨迹文件
│   └── metadata/         # 构建元数据
├── ios/GpsSender/        # iPhone GPS Sender App
├── docs/                 # 技术文档和测试手册
├── ARCHITECTURE.md       # 系统架构说明
├── AGENTS.md             # AI 协作约束
├── DEVELOPMENT.md        # 开发阶段与验收标准
└── DATA_POLICY.md        # 数据和坐标规范
```

## 前置条件

- **macOS** 本地浏览器作为显示端
- **Docker Desktop** 用于运行 OSRM、FastAPI 和 Nginx
- **Xcode**（可选）用于构建 iOS App
- **Python 3.12+** 用于数据构建和分析脚本

## 一键启动本地 MVP

前提：已通过 `scripts/build_osrm.sh` 生成 OSRM 数据，并通过 `scripts/build_tiles.sh` 生成 GeoJSON。

```bash
bash scripts/demo.sh
```

打开 <http://127.0.0.1:5173/> 后已预置与合成轨迹一致的演示起终点；选择正常或偏航轨迹，再点击"规划路线"和"开始模拟回放"即可。也可点击地图改选起终点。回放按钮支持暂停、继续与重新回放。所有服务仅绑定本机回环地址：前端 `5173`、FastAPI `8000`、OSRM `5000`。

停止服务：
```bash
docker compose down
```

## iPhone GPS 数据采集

### 实时发送模式（需 Wi-Fi）

默认 API 继续只绑定 `127.0.0.1`。仅在可信测试局域网中，将它绑定到 Mac 的**具体局域网 IPv4 地址**，并配置不提交 Git 的设备令牌：

```bash
export GPS_LAN_BIND_ADDRESS=192.168.1.23
export GPS_DEVICE_TOKENS_JSON='{"ios-demo-device":"replace-with-a-long-random-token"}'
docker compose up --build api
```

iPhone 以 `Authorization: Bearer <token>` 提交。HTTP 明文只适用于可信实验网络；部署前需改用 TLS、令牌轮换、主机防火墙和网络隔离。不要把令牌、真实坐标或接收日志提交到版本库。

### 离线录制模式（无需 Wi-Fi）

1. 在 iPhone 上打开 GpsSender App
2. 选择顶部 **"离线录制"** 模式
3. 点击 **"开始录制"**，授予定位权限
4. 室外步行或驾车，保持 App 前台运行
5. 点击 **"停止并保存"**
6. 通过分享图标导出 JSONL 文件（AirDrop 或 Files）

Mac 端分析：
```bash
python3 scripts/analyze_gps_recording.py /path/to/exported/file.jsonl
```

详细测试步骤见 [15 分钟室外测试手册](docs/gps-offline-recording-test.md)。

## 验证与测试

启动后可运行完整闭环验证：
```bash
bash scripts/smoke_test.sh
```

本地容器关系为：浏览器 → `frontend`（Nginx/MapLibre）→ `api`（FastAPI）→ `osrm`。
前端通过 Nginx 将 `/api` 反向代理给 FastAPI，不直接调用 OSRM；离线道路 GeoJSON 由
`frontend` 容器静态提供。三个容器用于隔离职责并让启动可复现，并非业务逻辑必须依赖 Docker。

## 非目标（第一阶段）

以下内容不在当前实现范围内：
- 基于本地 LLM 的模糊需求理解或 POI 推荐
- 腾讯云语音识别、语音合成与语音交互
- 商铺招牌 OCR、视觉 BBox 和到达确认
- 真实 GNSS、手机定位或车辆 CAN 数据接入（Phase 2 仅提供采集接口）
- 实时交通、云端地图和生产级高可用部署

## 后续阶段

1. 将模拟定位适配器替换为手机、USB GNSS 或车辆定位适配器（GPS-02 道路匹配与导航算法测试）
2. 接入本地 LLM 与用户偏好进行 POI 推荐
3. 接入腾讯云语音识别与语音合成
4. 接入 PaddleOCR 进行目的地招牌识别和 BBox 显示
