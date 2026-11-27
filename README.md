# 智能车载导航系统

使用高德 JS API v2.0 的实时导航与手动演示系统，配套设备无关的 WGS-84 GPS 总线和 iPhone `GpsSender`。旧 MapLibre/OSRM 离线地图、路线规划、回放与本地 OSM POI 检索已移除。

## 本地启动

已有依赖环境可直接使用；首次准备环境需自行安装 `backend/pyproject.toml` 和 `frontend/package-lock.json` 声明的依赖。

1. 复制 `frontend/.env.example` 为 `frontend/.env.local`，填写 `VITE_AMAP_KEY` 与 `VITE_AMAP_SECURITY_KEY`；也可在页面「Key 配置」中填写。不要提交真实凭证。
2. 在仓库根目录创建未跟踪的 `.env.gps.local`，内容如下。将占位文本替换为随机设备令牌，并在手机上使用相同设备 ID/令牌：

```dotenv
GPS_DEVICE_TOKENS_JSON={"iphone":"replace-with-random-token"}
```

3. 从仓库根目录启动后端：

```bash
backend/.venv/bin/uvicorn app.main:app --app-dir backend --env-file .env.gps.local --host 0.0.0.0 --port 8000
```

4. 在另一个终端启动前端：

```bash
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
```

打开 [实时导航](http://127.0.0.1:5173/amap.html?mode=live) 或 [手动演示](http://127.0.0.1:5173/amap.html)。根地址 `/` 会跳转到高德页并保留查询参数。实时模式使用手机/GNSS 定位；演示模式可填充测试点和模拟巡航。地图、搜索和算路需要联网及有效高德凭证。

iPhone USB 热点连接时，手机主机地址填 Mac 的 USB 网卡 IP（以实际配置为准，例如 `172.20.10.10`），端口 `8000`。允许定位、本地网络与精确位置，并保持 App 在前台。精度大于 100 米时暂停位置显示；10 秒无更新判离线。0.2 秒为发送间隔下限，实际采样频率取决于 CoreLocation。

## 容器运行

```bash
docker compose --env-file .env.gps.local up --build
```

只启动 API 与前端，默认绑定回环地址。USB/局域网手机接入需将 `GPS_LAN_BIND_ADDRESS` 设为 Mac 对应网卡的 IP 后再启动容器。Docker 构建上下文不包含本地环境文件；容器前端通过页面「Key 配置」设置高德凭证。

## 检查与测试

```bash
cd backend
.venv/bin/python -m pytest -q
```

从仓库根目录执行：

```bash
npm --prefix frontend test
npm --prefix frontend run build
bash scripts/smoke_test.sh
```

冒烟检查需先启动本地服务，仅检查页面与本地 API，不调用高德或收费语音服务。

## 保留功能与安全边界

- `frontend/src/amap-*`：高德导航、GCJ-02 路线匹配、静止平滑、偏航节流；`coord-transform.ts` 负责 WGS-84/GCJ-02 边界转换。
- `backend/app/gps/`：GPS 鉴权接收、去重/时效校验、在线快照与 WebSocket 广播；`/api/health` 用于健康检查。
- `ios/GpsSender/`：前台定位发送、Keychain 令牌保存、离线轨迹录制与导出；[iOS 指南](ios/README.md)。
- `scripts/analyze_gps_recording.py`：分析用户自行导出的录制文件；真实坐标和轨迹不可入库。
- `/api/voice/transcribe`：保留可选腾讯云转写适配，需独立配置凭证和可选依赖；当前高德页使用浏览器语音识别，不会自动调用该接口。

`.gitignore` 防止环境文件、轨迹、私钥与生成文件被误提交；`.dockerignore` 阻止这些文件进入构建上下文。高德浏览器 Key 在运行页面中可见，环境变量并不把它变为浏览器端秘密，应在控制台配置适用的域名等使用限制。当前源码扫描不等于历史清理：旧提交中出现过的凭证必须轮换，不能继续使用。

详见 [架构](ARCHITECTURE.md)、[开发说明](DEVELOPMENT.md) 与 [隐私规范](DATA_POLICY.md)。历史方案位于 `docs/superpowers/`，不代表当前运行架构。
