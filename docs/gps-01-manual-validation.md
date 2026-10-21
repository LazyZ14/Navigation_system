# GPS-01 人工联调与验收指南

本文档说明如何在 Mac 和真实 iPhone 之间建立 GPS-01 数据链路，完成从手机定位到 FastAPI 接收的端到端验证。

## 前提条件

### 软件要求

1. **macOS**：已安装完整 Xcode（不仅是 Command Line Tools）
   - 从 App Store 下载 Xcode
   - 首次启动后在终端执行 `sudo xcode-select --switch /Applications/Xcode.app` 确保使用正确的版本
   - 验证：`xcodebuild -version` 应显示完整版本号

2. **Docker Desktop**：已安装并正在运行
   - 验证：`docker info` 应能正常返回信息

3. **iPhone**：iOS 16.0 或更高版本，已连接并信任此 Mac

### 网络要求

Mac 和 iPhone 必须在同一局域网（同一 WiFi 或通过有线网络连接）。

## 第一步：确定 Mac 的局域网 IP 地址

```bash
# WiFi 连接
ifconfig en0 | grep "inet " | awk '{print $2}'

# 或者以太网连接
ifconfig en1 | grep "inet " | awk '{print $2}'

# 更简单的方法（推荐）
ipconfig getifaddr en0
```

记下输出的 IP 地址（例如 `192.168.1.23`），后续步骤会用到。

## 第二步：生成 GPS 设备令牌

**重要**：令牌是敏感数据，不要提交到 Git，不要记录在日志中。

```bash
cd /Users/lazyz14/.codex/worktrees/iphone-gps-sender/Navigation_system

# 生成随机令牌并设置环境变量
export GPS_DEVICE_TOKENS_JSON='{"test-device":"'$(openssl rand -hex 32)'"}'

# 查看生成的令牌（复制保存，稍后需要在 iPhone 上输入）
echo "设备令牌: $(echo $GPS_DEVICE_TOKENS_JSON | python3 -c "import sys,json; print(json.load(sys.stdin)['test-device'])")"

# 设置局域网绑定地址（替换为第一步获取的实际 IP）
export GPS_LAN_BIND_ADDRESS=192.168.1.23  # 替换为你的实际 IP

echo "Mac 局域网 IP: $GPS_LAN_BIND_ADDRESS"
```

将输出的"设备令牌"值复制保存，后续需要在 iPhone App 中配置。

## 第三步：启动 FastAPI GPS 接收服务

```bash
# 确保在仓库根目录
cd /Users/lazyz14/.codex/worktrees/iphone-gps-sender/Navigation_system

# 启动 API 服务（仅启动 api 容器，不需要 OSRM 和前端）
docker compose up --build api

# 等待看到类似输出：
# api-1  | INFO:     Application startup complete.
# api-1  | INFO:     Uvicorn running on http://192.168.1.23:8000 (Press CTRL+C to quit)
```

保持此终端窗口打开，服务将在后台运行。

### 验证服务可访问性

在另一个终端窗口测试：

```bash
# 测试本地访问
curl -X POST http://127.0.0.1:8000/api/gps/fixes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{"schema_version":1,"device_id":"test","stream_id":"00000000-0000-0000-0000-000000000000","sequence":0,"lat":0,"lon":0,"accuracy_m":1,"timestamp":"2026-10-21T13:20:30Z"}'

# 应返回 401（令牌错误），证明服务正在运行且鉴权生效
```

## 第四步：在 Xcode 中打开 iOS 工程

```bash
# 方法 1：命令行打开
open ios/GpsSender/GpsSender.xcodeproj

# 方法 2：在 Finder 中双击 ios/GpsSender/GpsSender.xcodeproj
```

### 配置签名

1. 在 Xcode 左侧项目导航器中选择 `GpsSender` 项目
2. 选择 `GpsSender` Target
3. 切换到 "Signing & Capabilities" 标签
4. 勾选 "Automatically manage signing"
5. 选择你的 Team（需要 Apple Developer 账号，免费个人账号也可）
6. 确保 Bundle Identifier 为 `com.navigation-system.GpsSender`

### 选择目标设备

1. 在 Xcode 顶部工具栏的设备选择器中选择你的 iPhone
2. 如果 iPhone 未出现，确保：
   - iPhone 已通过 USB 连接到 Mac
   - iPhone 已信任此电脑
   - iPhone 已启用开发者模式（设置 > 隐私与安全性 > 开发者模式）

## 第五步：安装到 iPhone

1. 点击 Xcode 顶部的 Run 按钮（▶️）或按 `Cmd+R`
2. 等待构建和安装完成
3. 在 iPhone 上找到并打开 "GpsSender" App
4. 首次启动时会请求定位权限，选择"使用 App 期间允许"

## 第六步：配置 iPhone Sender

在 iPhone 上的 GpsSender App 中：

1. **连接设置**部分填写：
   - **Mac 主机或局域网 IP**：输入第二步获取的 Mac IP（例如 `192.168.1.23`）
   - **端口**：`8000`
   - **设备 ID**：保持默认值（例如 `ios-xxxxx`）或自定义
   - **设备令牌**：粘贴第二步生成的令牌

2. 点击键盘外的区域关闭键盘

3. **注意**：当前实现不会自动保存配置，每次重启 App 需要重新输入。如需持久化，修改代码中的 `saveConfiguration()` 调用时机。

## 第七步：开始发送 GPS

1. 点击底部的"开始发送"按钮
2. 观察状态变化：
   - "正在请求前台定位权限" → "正在发送"
3. 移动 iPhone 或等待几秒，应看到最新定位坐标更新
4. 状态应显示类似："已发送 #0"、"已发送 #1" 等

## 第八步：在后端验证接收

在运行 Docker 的终端窗口，应看到类似日志：

```
INFO:app.gps.service:gps_fix_accepted device=<hash> stream_id=f5824845-... sequence=0 network_delay_ms=42
INFO:app.gps.service:gps_fix_accepted device=<hash> stream_id=f5824845-... sequence=1 network_delay_ms=38
```

或者实时跟踪日志：

```bash
# 在另一个终端窗口
docker logs -f navigation-system-api-1 2>&1 | grep gps_fix
```

### 验证关键字段

确认日志中包含：
- ✅ `gps_fix_accepted` 事件
- ✅ `sequence` 递增（0, 1, 2, ...）
- ✅ `network_delay_ms` 为合理值（通常 < 100ms 局域网）
- ✅ 没有坐标或令牌泄露到日志中

## 第九步：错误场景测试

### 测试 1：401 未授权

1. 在 iPhone App 中故意修改设备令牌（删除几个字符）
2. 点击"停止发送"，再点击"开始发送"
3. 观察状态应显示"网络失败，短暂重试"或类似错误
4. 后端日志不应出现 `gps_fix_accepted`

### 测试 2：定位权限拒绝

1. 在 iPhone 设置 > 隐私与安全性 > 定位服务 > GpsSender 中选择"永不"
2. 回到 App，点击"开始发送"
3. 状态应显示"定位权限未授予"
4. App 不应崩溃

### 测试 3：断网重连

1. 在 iPhone 上开启飞行模式或关闭 WiFi
2. 观察 App 显示"网络失败，短暂重试"
3. 等待超过 10 秒（让队列中的旧数据过期）
4. 关闭飞行模式恢复网络
5. 移动 iPhone 产生新位置
6. 应看到新的序列号继续递增（不会重放过期数据）

### 测试 4：停止发送

1. 点击"停止发送"
2. 状态应变为"已停止；下次开始将使用新的 stream"
3. 在后端日志中确认不再有新的心跳
4. 再次点击"开始发送"
5. 后端日志中的 `stream_id` 应改变（新流）
6. `sequence` 应从 0 重新开始

### 测试 5：409 乱序拒绝（后端测试）

此场景难以通过 iPhone 手动触发，可通过 curl 测试：

```bash
TOKEN="your-token-here"
DEVICE_ID="test-device"
STREAM_ID="f5824845-1c55-40c8-b98f-fdf7d5aa81d9"
IP="192.168.1.23"

# 发送 sequence=5
curl -X POST http://$IP:8000/api/gps/fixes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"schema_version\":1,\"device_id\":\"$DEVICE_ID\",\"stream_id\":\"$STREAM_ID\",\"sequence\":5,\"lat\":39.9,\"lon\":116.4,\"accuracy_m\":8,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}"

# 应返回 202

# 发送 sequence=3（倒退）
curl -X POST http://$IP:8000/api/gps/fixes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"schema_version\":1,\"device_id\":\"$DEVICE_ID\",\"stream_id\":\"$STREAM_ID\",\"sequence\":3,\"lat\":39.9,\"lon\":116.4,\"accuracy_m\":8,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}"

# 应返回 409 {"detail":{"code":"out_of_order"}}
```

### 测试 6：422 过期数据

```bash
# 发送 35 秒前的时间戳（超过 30 秒阈值）
PAST_TIME=$(python3 -c "from datetime import datetime, timedelta, timezone; print((datetime.now(timezone.utc) - timedelta(seconds=35)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))")

curl -X POST http://$IP:8000/api/gps/fixes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"schema_version\":1,\"device_id\":\"$DEVICE_ID\",\"stream_id\":\"$STREAM_ID\",\"sequence\":10,\"lat\":39.9,\"lon\":116.4,\"accuracy_m\":8,\"timestamp\":\"$PAST_TIME\"}"

# 应返回 422 {"detail":{"code":"stale"}}
```

## 第十步：清理测试环境

### 停止服务

```bash
# 在运行 docker compose 的终端按 Ctrl+C

# 或者在另一个终端
docker compose down
```

### 清除环境变量

```bash
unset GPS_DEVICE_TOKENS_JSON
unset GPS_LAN_BIND_ADDRESS
```

### 清理敏感数据

1. **不要**将设备令牌提交到 Git
2. **不要**将真实 GPS 轨迹截图或复制到文档
3. **不要**将 `.env.gps.local` 文件添加到版本控制（已在 `.gitignore` 中）

如果需要持久化令牌配置，可以创建本地文件：

```bash
cat > .env.gps.local << 'EOF'
GPS_DEVICE_TOKENS_JSON={"test-device":"your-token-here"}
GPS_LAN_BIND_ADDRESS=192.168.1.23
EOF

# 确保该文件不会被提交
grep ".env.gps.local" .gitignore || echo ".env.gps.local" >> .gitignore
```

然后加载：

```bash
set -a && source .env.gps.local && set +a
docker compose up --build api
```

## 故障排查

### 问题：iPhone 无法连接到 Mac

**检查清单**：
1. 确认 Mac 和 iPhone 在同一 WiFi 网络
2. 确认防火墙未阻止 8000 端口：
   ```bash
   sudo lsof -i :8000
   ```
3. 尝试从 iPhone 的 Safari 访问 `http://<Mac-IP>:8000/docs`，应看到 FastAPI Swagger UI

### 问题：Docker 容器启动失败

**检查清单**：
1. 确认 Docker Desktop 正在运行：`docker info`
2. 检查 Compose 配置：`docker compose config --quiet`
3. 查看容器日志：`docker compose logs api`

### 问题：iOS 编译失败

**检查清单**：
1. 确认 Xcode 版本 ≥ 14.0
2. 确认 Swift 版本：`swift --version` 应显示 5.0+
3. 清理构建文件夹：Product > Clean Build Folder (`Cmd+Shift+K`)
4. 检查签名配置是否正确

### 问题：收到 GPS 但 sequence 不连续

这是正常行为。iPhone 的网络重试和队列丢弃机制可能导致：
- 某些报文在网络层丢失
- 过期数据被客户端丢弃
- 重试成功后跳过中间序号

只要 `sequence` 单调递增且不重复，就是正确的。

## 安全注意事项

⚠️ **当前实现仅适用于可信测试网络**：

1. HTTP 明文传输，令牌和数据可被局域网内嗅探
2. 无 TLS 加密
3. 令牌无自动轮换机制
4. 无速率限制（依赖客户端自律）

**生产环境必须**：
- 启用 HTTPS/TLS
- 实现令牌轮换和撤销
- 添加速率限制和防火墙规则
- 网络分段隔离 GPS 接收服务

## 验收标准

GPS-01 达到真机联调准备状态的标志：

- [x] 后端 GPS 接收服务通过所有自动化测试
- [x] iOS 源码完整，包含必要权限声明
- [x] Docker Compose 配置支持局域网绑定
- [x] 设备令牌通过 Keychain 安全存储
- [x] 平台无关的协议设计（不强制 `ios-` 前缀）
- [ ] 在真实 iPhone 上成功上报 GPS 坐标（需人工执行）
- [ ] 后端日志确认接收到至少 10 条连续序列的定位
- [ ] 完成至少 3 种错误场景测试

前 5 项已由 dsh agent 验证通过，后 3 项需要用户在真实设备上执行。
