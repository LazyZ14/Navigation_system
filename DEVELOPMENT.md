# 开发阶段路线与验收记录

## Phase 1：离线导航 MVP 与语音目的地检索（已完成）

- **珠海实验区域离线数据构建**：通过 `scripts/build_osrm.sh` 与 `scripts/build_tiles.sh` 从 `zhuhai.osm` 可复现生成 OSRM MLD 路由数据及八类语义 GeoJSON 底图（优先 `name:zh` 中文标签）。
- **离线路由、道路匹配与轨迹回放**：FastAPI 封装 OSRM 适配层、连续性与航向感知的道路投影匹配（`route_matching.py`）、暂停/恢复/重播控制与偏航单次重算。
- **一键离线验收**：执行 `bash scripts/demo.sh` 与 `bash scripts/smoke_test.sh` 可在不依赖在线地图与真实 GPS 的条件下验证正常到达与偏航重算。
- **Voice-01 语音交互**：支持按键录音（腾讯云一句话识别转写）或文本输入，经本地 Ollama `qwen2.5:7b` 提取结构化出行意图并匹配本地 OSM POI 候选，经人工确认及终点吸附阈值校验后发起导航。

---

## Phase 2：iPhone 有线/局域网实时定位与高德双模式实车闭环（已完成）

### 1. GPS-01 原始定位接收与离线录制（`ios/GpsSender/` + `/api/gps/fixes`）
- **iOS 真机端**：SwiftUI + CoreLocation（`kCLLocationAccuracyBestForNavigation`，最高 5Hz 发送），具备单消费者发送队列、10 秒过期丢弃、网络闪断指数退避重试，以及无需网络的离线 `.jsonl` 轨迹增量录制与系统分享导出。
- **FastAPI 接收端**：常量时间 Bearer Token 认证、按 `(device_id, stream_id)` 幂等去重与防序号回退、时效窗口校验，常规日志脱敏不记录真实经纬度与密钥。
- **USB 有线实测验证**：通过 macOS `iPhone USB` 虚拟网卡（`172.20.10.x`）完成纯数据线实测，新鲜采样端到端入库延迟约 `23ms～40ms`。

### 2. GPS-02 高德在线增强版双模式与实车导航闭环（`frontend/amap.html`）
- **实时定位分发**：新增 `GET /api/gps/latest`（10s 在线判定快照）与 `WS /ws/gps/live`（每订阅者独立有界队列 `maxsize=10`，慢客户端自动丢弃最旧帧不阻塞写入），Vite 与 Nginx 统一代理 `/api` 与 `/ws`。
- **双模式严格隔离**：
  - **📡 实车实时导航**：自动锁定手机/GNSS 实时位置为起点，点击地图或语音/文字模糊搜索周边 POI 直接设置终点并算路；导航中按道路折线吸附推进车标与车头朝向、实时刷新剩余里程/时间与当前及下一步转向提示，连续 3 个有效点偏离路线 `>50m`（精度 `≤50m`、冷却 `10s`）自动触发高德重算；
  - **🧪 手动演示 Demo**：完整保留手动点击选起终点、珠海测试点一键填充、单次浏览器定位与小车沿路模拟巡航，并通过 `DrivingSearchGuard` 拦截切模式后的迟到异步算路回调。

---

## Phase 3：硬件 GNSS 接入与后续扩展（规划中）

1. **USB/串口 GNSS 硬件模块接入**：待外置 GNSS 模块到货后，编写本地 NMEA-0183 串口采集适配器，输出标准 `WGS-84` 定位直接汇入 `GpsIngressService`，零改动复用现有 WebSocket 广播与高德前端实车闭环；
2. **iOS 毫秒级时间戳优化**：为 `GpsSender` 的 ISO-8601 编码开启 `.withFractionalSeconds`，进一步消除整秒截断带来的延迟显示锯齿；
3. **视觉辅助到达确认**：在接近终点阶段按需扩展商铺招牌 OCR 与视觉提示能力。
