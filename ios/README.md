# GPS Sender（iPhone）

在 macOS 安装完整 Xcode 后，打开 `GpsSender/GpsSender.xcodeproj`，选择真实 iPhone 后执行：

```bash
xcodebuild -project GpsSender/GpsSender.xcodeproj -scheme GpsSender -destination 'platform=iOS,name=<你的 iPhone>' test
```

填写 Mac 的局域网 IPv4、`8000`、持久设备 ID 和与 `GPS_DEVICE_TOKENS_JSON` 相同的令牌。每次点“开始发送”产生新的 `stream_id`；停止、重启后再次开始也会产生新流。网络恢复不换流，只短暂重试新鲜数据；超过 10 秒的数据会丢弃。

仅请求“使用 App 期间”的定位权限，使用 `NSAllowsLocalNetworking`，没有后台定位权限或全局 ATS 放开。当前开发机没有完整 Xcode，本工程未在此机编译、签名或真机测试。
