# 开发与验证

当前维护高德实时/Demo 双模式导航、设备无关 GPS 总线与 iOS 采集/录制。旧离线地图和本地路线算法已移除；历史设计文档仅供追溯。

## 本地流程

启动步骤参见 [README](README.md)。服务使用后端单进程、前端 Vite；不需要地图下载、OSRM、Ollama 或生成 GeoJSON。

- 后端全量测试：在 `backend/` 运行 `.venv/bin/python -m pytest -q`。
- 前端全量测试：在仓库根目录运行 `npm --prefix frontend test`。
- 类型与生产构建：`npm --prefix frontend run build`。
- 容器配置校验：`docker compose config --quiet`。
- 本地冒烟检查：启动服务后运行 `bash scripts/smoke_test.sh`；可用 `API_BASE_URL`/`FRONTEND_BASE_URL` 调整端口。

GPS 测试使用合成坐标和测试令牌；高德控制器测试覆盖正常推进、无可达路线、路外/低精度噪点、偏航触发节流重算及模式切换。iOS 真机定位和在线高德算路仍需人工验收，自动测试不会调用收费 API。

## 隐私与提交

新增配置只能提交空值示例。真实 `.env*`、录制轨迹、日志、签名密钥和本地数据库不得入库。忽略规则测试使用 `git check-ignore --no-index` 验证任意层级路径；源码凭证检查只报告路径，不输出值。

`.gitignore` 不会阻止 `git add -f`，也不能清理已跟踪文件/历史。`VITE_` 配置会写进本地构建的 JS，构建产物不得提交。Docker 构建显式排除本地环境文件，避免把高德或 GPS 凭证带入镜像。

2026-11-27 本地审计发现高德 Key/安全密钥曾出现在旧提交 `28cba08` 的配置源码中，`87a2a5b` 已从当时源码移除；历史仍保留。需要在控制台轮换旧凭证，本分支不重写历史。
