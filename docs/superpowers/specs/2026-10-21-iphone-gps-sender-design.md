# GPS-01 iPhone 实时定位接收设计

## 目标与范围

GPS-01 建立一条只接收原始定位的链路：前台运行的 iPhone Sender 通过可信局域网向 FastAPI 提交 WGS-84 定位。服务端验证、排序并提供接收回执，但不调用 OSRM，不创建导航会话，不发布 WebSocket，也不修改 MapLibre 或 OSM。GPS-02 才能将经确认的原始定位适配到导航管线。

本设计不持久化真实定位；服务端仅在进程内保留每个活动流的最后一条原始报文及顺序元数据。常规日志不记录坐标和令牌。

## 数据协议

### 请求

`POST /api/gps/fixes`

请求头：

```text
Authorization: Bearer <device-token>
Content-Type: application/json
```

请求体：

```json
{
  "schema_version": 1,
  "device_id": "ios-7D0EA7EE-7C7C-4E28-9FF5-406B522A7FD9",
  "stream_id": "f5824845-1c55-40c8-b98f-fdf7d5aa81d9",
  "sequence": 42,
  "lat": 39.9042,
  "lon": 116.4074,
  "accuracy_m": 8.5,
  "speed_mps": 6.2,
  "heading_deg": 85.0,
  "timestamp": "2026-10-21T13:20:30.123Z"
}
```

- 坐标固定为 WGS-84，字段固定为 `lat`、`lon`。
- `timestamp` 是 iPhone Core Location 产生定位的时间，必须带时区。
- `heading_deg` 表示行进方向（Core Location `course`），范围 `[0, 360)`；并非手机朝向。
- Core Location 的无效速度或方向以 `null` 发送；绝不转换为 `0`。
- `device_id` 是安装后持久的 UUID；`stream_id` 是每次用户点“开始发送”时新生成的 UUID；`sequence` 从 0 起，仅在同一 `stream_id` 中递增。

### 回执

```json
{
  "accepted": true,
  "disposition": "accepted",
  "device_id": "ios-7D0EA7EE-7C7C-4E28-9FF5-406B522A7FD9",
  "stream_id": "f5824845-1c55-40c8-b98f-fdf7d5aa81d9",
  "sequence": 42,
  "received_at": "2026-10-21T13:20:30.341Z",
  "network_delay_ms": 218
}
```

`received_at` 完全由服务器产生，代表接收时间；`network_delay_ms = received_at - timestamp` 仅用于观测网络/排队延迟，绝不替代定位时间。

## 服务端处理规则

| 条件 | 结果 |
|---|---|
| 正常的新 `device_id + stream_id + sequence` | `202 accepted` |
| 相同流、相同序号、相同内容 | `200 duplicate`，幂等且不重复存储 |
| 相同流内序号倒退，或同序号内容变化 | `409 out_of_order` |
| 新流 | 接受其从 0 开始的序号，不受旧流序号影响 |
| 原始定位时间早于服务器 30 秒以上，或晚于服务器 5 秒以上 | `422 stale` |
| 坐标、精度、速度、方向、时间格式不合法 | `422 validation_error` |
| 缺失或错误令牌 | `401 unauthorized` |

认证使用配置中的 `device_id -> token` 映射和常量时间比较。令牌不出现在响应、日志或版本库中。结构化日志只写入事件结果、匿名化设备标识、流标识、序号与延迟指标。

服务端按 `(device_id, stream_id)` 维护一个有界状态条目：最后接收的序号、请求摘要和最近的原始定位。容量满时按最久未活动流淘汰；不写文件、不写数据库。接口定义为平台无关模型，可被 Android、USB GNSS 或日志回放实现复用。

## iPhone 行为

首次运行生成并保存 `device_id`；每次点击开始生成新的 `stream_id` 且 `sequence = 0`。点击停止会停止 Core Location 并清空尚未发送的队列；之后再次开始即为新流。App 重启同样生成新流，保留设备 ID。网络重连不生成新流：若当前点仍未过期可按原序号重试，否则直接丢弃并等待新位置。

定位回调不得等待网络。客户端最多保留 20 条待发送定位：

- 单个请求超时 2 秒，最多尝试 3 次，延迟为 0.5、1、2 秒；
- 报文自 `timestamp` 起超过 10 秒时，客户端直接丢弃，不重放历史轨迹；
- 队列满时丢弃最旧报文；每秒最多发送 2 条，优先最新报文；
- `horizontalAccuracy < 0`、非有限坐标、时间戳未来超过 5 秒或超过 10 秒前的定位直接丢弃；
- `speed < 0` 或 `course < 0` 规范化为 `null`。

最小 SwiftUI 界面只包含主机、端口、设备令牌配置、开始/停止与定位/连接状态。定位权限仅请求“使用 App 期间”。令牌使用 Keychain；其他配置使用 `UserDefaults`。Info.plist 使用 `NSLocationWhenInUseUsageDescription`、本地网络使用说明和 `NSAllowsLocalNetworking`，不启用全局 `NSAllowsArbitraryLoads`。

## 网络与部署

Docker Compose 的 API 端口默认继续绑定 `127.0.0.1`。仅联调时通过 `GPS_LAN_BIND_ADDRESS=<Mac 局域网 IPv4>` 绑定 API 到指定网卡；OSRM 与前端继续不对局域网开放。HTTP 明文仅可用于可信测试网络；生产前必须引入 TLS、令牌轮换、受限防火墙和网络分段。

## 测试与非目标

后端测试使用合成 WGS-84 数据，且无需 OSM、OSRM 或 Docker 地图数据。必须覆盖正常接收、非法坐标、令牌、无效速度/航向、同流重复、同流乱序、跨流重新开始及断线恢复后的实时性规则。

本轮不接入 OSRM、导航会话、WebSocket、MapLibre、后台定位、Android、视觉模型或 AR。当前 Mac 未安装 Xcode；iOS 项目只能进行静态审查，不能声明为编译、签名或真机验证通过。
