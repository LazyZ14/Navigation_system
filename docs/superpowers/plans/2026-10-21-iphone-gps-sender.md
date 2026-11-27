# GPS-01 iPhone GPS Sender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 iPhone 在可信局域网持续提交原始 WGS-84 定位，并让 FastAPI 独立验证、排序及回执，而不触及导航管线。

**Architecture:** 新建平台无关的 GPS 入站模型、内存接收服务和独立 API 路由。SwiftUI Sender 将 Core Location 回调转换为同一协议并通过有界、实时优先的发送队列提交。Docker 仅可选地将 API 绑定到用户指定的局域网地址。

**Tech Stack:** Python 3.11+, FastAPI, Pydantic, pytest, Docker Compose, SwiftUI, Core Location, URLSession.

**Spec:** `docs/superpowers/specs/2026-10-21-iphone-gps-sender-design.md`

## Global Constraints

- 在 `feature/iphone-gps-sender` 的独立 linked worktree 内工作；不更改主工作区文件。
- 原始坐标固定 WGS-84 `lat`、`lon`；不得写入 OSM。
- GPS-01 不得调用 OSRM、导航会话、WebSocket 或 MapLibre。
- 不持久化真实 GPS；测试必须使用合成定位。
- 令牌不提交 Git、不写入日志；比较须常量时间。
- 默认 Docker 仅绑定 `127.0.0.1`；局域网只开放 API 指定地址。
- iOS 只做前台定位、配置、发送和状态；不做地图或导航。
- TDD：每项生产行为必须先有观察到失败的测试。
- 不安装全局 Python 依赖；后端验证优先使用 Docker 或已有环境。

## Review Focus

- 跨 stream 的序号应独立，旧流不得阻止新流从 0 开始。
- `received_at` 和 `timestamp` 必须永不混淆，延迟为独立指标。
- 网络恢复时不得重放过期位置或形成无界队列。
- API 接收层不得意外调用 OSRM 或建立导航状态。
- LAN 配置不得默认把 OSRM、前端或 API 暴露到所有网卡。

---

### Task 1: GPS 协议模型与有界接收服务

**Files:**
- Create: `backend/app/gps/__init__.py`
- Create: `backend/app/gps/models.py`
- Create: `backend/app/gps/service.py`
- Create: `backend/tests/test_gps_ingest.py`

**Interfaces:**
- Produces `GpsFixSubmission`, `GpsIngressReceipt`, `IngressDisposition`。
- Produces `GpsIngressService.ingest(fix: GpsFixSubmission, received_at: datetime) -> GpsIngressReceipt`。

- [ ] Write failing service tests for accepted data, duplicate data, same-stream out-of-order data, new-stream sequence reset, stale/future timestamps, and server-supplied receipt time.
- [ ] Run `docker compose run --rm api pytest tests/test_gps_ingest.py -q` and observe failure because the module is absent.
- [ ] Implement the minimum typed models and per-stream bounded in-memory service; log only non-coordinate metadata.
- [ ] Re-run the focused test and the backend suite in the API container.
- [ ] Commit with `feat(gps): 增加独立原始定位接收协议`.

### Task 2: FastAPI adapter, token validation, and LAN-safe configuration

**Files:**
- Create: `backend/app/api/gps.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/config.py`
- Modify: `backend/tests/test_gps_api.py`
- Modify: `docker-compose.yml`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Produces `POST /api/gps/fixes` with Bearer authentication and receipt response.
- `Settings` produces `gps_device_tokens` and `gps_max_active_streams` from environment.

- [ ] Write failing API tests for valid authentication, missing/incorrect token, invalid coordinates, invalid heading/speed, duplicate/ordering status, disconnected-then-recovered newest report, and proof that no OSRM client is invoked.
- [ ] Run focused test and observe failure because the route is absent.
- [ ] Implement the adapter with constant-time token comparison; wire no navigation dependencies.
- [ ] Make the API host binding `${GPS_LAN_BIND_ADDRESS:-127.0.0.1}` and document a non-versioned token setup; update ignore rules for local GPS secrets/logs.
- [ ] Run focused tests, all backend tests through Docker, frontend regression tests, and `docker compose config --quiet`.
- [ ] Commit with `feat(gps): 提供局域网原始定位接收接口`.

### Task 3: Minimal iPhone Sender source and static tests

**Files:**
- Create: `ios/GpsSender/**`
- Create: `ios/README.md`

**Interfaces:**
- `GpsFixPayload` encodes the documented protocol.
- `RealtimeSendQueue.enqueue(_:now:)` enforces capacity, age, retry and real-time-first policy.
- `LocationSenderViewModel` exposes configuration, start/stop, latest location and connection state.

- [ ] Write XCTest cases for stream lifecycle, invalid Core Location normalization, queue capacity, stale drop and retry ordering before production implementations.
- [ ] Record that the local machine lacks Xcode and therefore tests cannot execute here; inspect Swift source and Xcode project references statically.
- [ ] Implement a SwiftUI app with Core Location, Keychain token storage, bounded URLSession sender, foreground-only authorization, Info.plist permissions and narrowly scoped ATS local-network setting.
- [ ] Validate no global ATS bypass or background location permission appears in the project; provide exact Xcode test command for a machine with Xcode.
- [ ] Commit with `feat(ios): 增加最小 iPhone GPS Sender`.

### Task 4: Documentation, complete verification and review

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-10-21-iphone-gps-sender.md`
- Create: `docs/gps-01-manual-validation.md`

**Interfaces:**
- Documents the protocol, Docker environment variables, synthetic test commands, Mac/iPhone manual validation steps, and the Xcode/real-device verification limitation.

- [ ] Write a documentation checklist test or shell inspection for required environment variable names and forbidden global ATS key.
- [ ] Run all executable backend tests in Docker, frontend tests, Compose config validation, and static iOS inspections.
- [ ] Update manual acceptance procedure and risks without recording any real coordinate or token.
- [ ] Mark completed plan steps with actual commands/results and commit with `docs(gps): 补充 GPS-01 联调与验收说明`.
- [ ] Prepare a whole-branch review package, resolve critical findings with TDD, and do not merge or push.
