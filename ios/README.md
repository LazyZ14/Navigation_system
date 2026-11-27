# GPS Sender（iPhone 实时定位发送与离线录制端）

基于 SwiftUI + `CoreLocation` 的轻量级 iPhone 定位工具（最低支持 `iOS 16.0`），为车载主机提供最小发送间隔 **0.2s** 的 `WGS-84` 定位流（实际采样频率由 CoreLocation 决定）（`kCLLocationAccuracyBestForNavigation`），同时支持无网络离线 `.jsonl` 轨迹录制与导出。

## 1. 真机编译与安装

在已安装完整 Xcode 的 Mac 上连接 iPhone（确保手机已信任电脑并开启「设置 → 隐私与安全性 → 开发者模式」）：

```bash
open ios/GpsSender/GpsSender.xcodeproj
```

1. 在 `Signing & Capabilities` 中勾选 `Automatically manage signing` 并选择你的 Apple Developer / Personal Team；
2. 顶部设备栏选择真实 iPhone，按 `Cmd + R` 编译安装；
3. 首次在手机打开 App 时，允许**「使用 App 期间定位」**、开启**「精确位置」**并允许**「本地网络」**权限（若使用免费个人签名首次安装，需在 iPhone「设置 → 通用 → VPN 与设备管理」中信任开发者证书）。

命令行编译与测试构建校验：

```bash
xcodebuild -project ios/GpsSender/GpsSender.xcodeproj -scheme GpsSender -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build-for-testing
```

## 2. 推荐联调方式：USB 有线直连（低延迟 + 边充边跑）

1. 用数据线连接 iPhone 与 Mac，开启 iPhone **「设置 → 个人热点 → 允许其他人加入」**；
2. 在 Mac **「系统设置 → 网络 → iPhone USB」** 中关闭 **「除非需要，否则停用」**，记下分配给 Mac 的有线 IP（如 `172.20.10.10`）；
3. 在 App 顶部选择 **「实时发送」**，填写：
   - **Mac 主机或局域网 IP**：`172.20.10.x`（若走同局域网 Wi-Fi 则填 Mac 的 `en0` IP）
   - **端口**：`8000`
   - **设备 ID** 与 **设备令牌**：与后端 `GPS_DEVICE_TOKENS_JSON` 中配置保持一致
4. 点击 **「开始发送」** 即可产生新的 `stream_id` 并实时驱动高德导航页面（`http://127.0.0.1:5173/amap.html?mode=live`）。

## 3. 传输与安全机制

- **实时优先**：单消费者异步发送队列最多保留最新 20 条定位，超过 10 秒的旧点自动丢弃，网络短暂波动按 `0.5s / 1s / 2s` 退避重试，停止后重开自动切换新 `stream_id`；
- **离线录制**：切换顶部至 **「离线录制」** 可将原始 `WGS-84` 样本增量追加写入沙盒 `Documents/GPS_Recordings/*.jsonl`，支持通过系统分享（AirDrop / 文件）导出并用 `scripts/analyze_gps_recording.py` 分析；
- **最小权限**：仅申请前台 `WhenInUse` 定位与 `NSAllowsLocalNetworking`，设备令牌保存在 iOS `Keychain` 中。
