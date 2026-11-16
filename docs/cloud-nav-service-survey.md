# 在线导航 API / MCP 服务调研（面向实车部署）

> 调研时间：2026-11
> 目的：实车已具备联网能力，评估直接复用成熟导航/位置服务（API 或 MCP）的可行性。
> 结论只影响**接入层选型**，不改变 Phase 1「离线导航闭环」的边界（见 `AGENTS.md`）。

---

## 0. 一句话结论

**MCP 不能替代导航运行时。** 它只是「让大模型调用位置服务」的工具协议；真正开车用的转向引导、实时重算、车标跟随仍然要靠车端导航 SDK 或本地引擎。
可行的组合是：**车端本地导航做主链路（离线优先），云端 API/MCP 做增强层（实时路况、POI、地址解析、沿途充电桩）与未来的语音 Agent 层。**

---

## 1. 先厘清：MCP 与导航 API 的关系

| 维度 | 导航 Web API | MCP Server |
| --- | --- | --- |
| 面向对象 | 程序（确定性调用） | LLM / Agent（模型决定何时调用） |
| 返回 | 结构化 JSON | 转成「模型易读」的文本/JSON，交给模型再加工 |
| 时延 | 单次 HTTP，百毫秒级 | 一次对话可能串多个工具调用，秒级 |
| 适合 | 算路、路况、地理编码、POI | 自然语言目的地、行程规划、多步查询 |
| 不适合 | 自然语言编排 | 转向级实时引导、10Hz 车标更新 |

**关键判断：**

1. 国内三家（高德/百度/腾讯）的 MCP Server 本质是**对其 Web 服务 API 的封装**，能力边界 = 底层 API 的配额与权限。
2. 因此如果车端**没有 LLM**（当前 Phase 1 明确禁止），直接调 Web API 更简单、可控、可测试；MCP 只在引入语音/Agent 后才有价值。
3. 若一定要用 MCP，**不要让车端直连**：应由云端 Agent 调 MCP，再向车端下发结构化导航指令（`RouteRequest` / `Waypoint`），避免车端承担模型推理、密钥管理和公网端点依赖。

---

## 2. 国内可用（实车合规前提下的必选项）

### 2.1 高德地图 MCP Server

- 端点：`https://mcp.amap.com/mcp?key=<Web服务Key>`（Streamable HTTP，官方推荐）
- 本地 stdio：`npx @amap/amap-maps-mcp-server`（官方 npm 包）
- 坐标系：**GCJ-02**
- 工具（约 15 个）：地理编码、逆地理编码、IP 定位、天气、驾车/步行/骑行/公交路径规划、距离测量、关键词搜索、周边搜索、详情搜索、生成专属地图、导航唤端、打车
- 特点：与高德地图 App 打通，可产出「专属地图」链接、一键导航/打车唤端
- 车机侧：前装走 **高德 AutoSDK**（见 4.1），与 MCP 是两条产品线

来源：<https://lbs.amap.com/api/mcp-server/summary>、<https://lbs.amap.com/api/mcp-server/gettingstarted>

### 2.2 百度地图 MCP Server

- 端点：`https://mcp.map.baidu.com/mcp?ak=<AK>`（Streamable HTTP，推荐）/ `https://mcp.map.baidu.com/sse?ak=<AK>`（SSE）
- 本地 stdio：`npx @baidumap/mcp-server-baidu-map` 或 `pip install mcp-server-baidu-maps`
- 开源：<https://github.com/baidu-maps/mcp>（MIT）
- 坐标系：**BD-09（bd09ll）** —— 比 GCJ-02 还要多一层转换
- 工具（托管版核心 6 个，另含天气等）：`map_geocode`、`map_reverse_geocode`、`map_search_places`、`map_place_details`、`map_directions`、`map_directions_matrix`
- 特点：最早支持 MCP（2025-03）、开源可自托管、文档对坐标系标注清楚

来源：<https://lbsyun.baidu.com/docs/ai?title=mcpserver/quickstart>、<https://github.com/baidu-maps/mcp>

### 2.3 腾讯位置服务 MCP Server

- 端点：`https://mcp.map.qq.com/sse?key=<Key>`（SSE；官方称亦支持 Streamable HTTP，路径以接入说明为准）
- 参数：`format=0` 文本（默认，适合模型）、`format=1` 原始 JSON（适合程序）
- 坐标系：**GCJ-02**
- 工具（约 15 个）：地址解析、逆地址解析、关键词提示、周边搜索、**沿途搜索**、POI 详情、驾车（含途经点智能排序、**未来出发时间算路**）、公交、骑行、步行、距离矩阵、IP 定位、天气
- 特点：沿途搜索 + 未来路况算路对「行程规划型 Agent」很实用；结果做了语义化转换

来源：<https://lbs.qq.com/service/MCPServer/MCPServerGuide/Overview>

### 2.4 三家对比

| 项 | 高德 | 百度 | 腾讯 |
| --- | --- | --- | --- |
| 传输 | Streamable HTTP（推荐）/ stdio | Streamable HTTP / SSE / stdio | SSE / Streamable HTTP |
| 坐标系 | GCJ-02 | **BD-09** | GCJ-02 |
| 工具数量 | 约 15 | 6 起（开源版可扩展） | 约 15 |
| 开源 | 否（npm 包） | **是（MIT）** | 否 |
| 差异化 | App 唤端、专属地图、车机生态最强 | 文档规范、开源可自托管 | 沿途搜索、未来路况、语义化返回 |
| 车机前装 | 高德 AutoSDK，40+ 车厂 | 导航 SDK 明确「请勿在车机上使用」，需商务对接 | 需商务对接 |

> 计费：MCP 层不单独收费，**按底层 Web 服务 API 的配额/商用授权计费**。免费额度仅适合 POC，实车量产/运营必须走商业授权（需商务报价确认）。

---

## 3. 海外可用（车辆在境外时）

| 服务 | 端点 | 传输/鉴权 | 坐标 | 能力要点 |
| --- | --- | --- | --- | --- |
| Mapbox MCP | `https://mcp.mapbox.com/mcp` | Streamable HTTP + OAuth | WGS-84 | 搜索、directions、等时圈、矩阵、地图匹配、静态图、离线地理工具；也可 `npx` 本地部署 |
| TomTom Maps MCP | `https://mcp.tomtom.com/maps` | 远端 + API Key（Public Preview） | WGS-84 | Orbis 地图、实时路况算路、交互式地图（MCP Apps） |
| HERE Location Reasoning | `https://hlr.here.ai/mcp` | Bearer Token / 浏览器登录 | WGS-84 | 13 个工具：geocode、calculate-route、isoline、real-time-traffic、discover、data-visualization、EV 充电路线 |
| Google Maps | Code Assist MCP / Maps Experience agent tools | 实验阶段 | WGS-84 | 目前偏「开发期代码辅助」与实验性 search places / compute routes，**不适合做生产导航依赖** |

来源：<https://docs.mapbox.com/api/guides/mcp-server/>、<https://docs.tomtom.com/tomtom-maps-mcp/documentation/overview>、<https://docs.here.com/location-reasoning/docs/hlroverview>、<https://developers.google.com/maps/ai/mcp>

> **境内实车不要用境外端点**：中国境内地图展示需审图号，境外图商公开 SaaS 端点通常不满足；且车辆精确位置属敏感数据，出境受《汽车数据安全管理若干规定（试行）》约束。

---

## 4. 真正「能上路」的车载导航产品（非 MCP）

### 4.1 高德 AutoSDK（前装首选）

- 面向车企的工具包：定位、搜索、地图渲染、路线规划、离线导航、ISA 信息播发
- 国际版覆盖 170+ 国家、19 种语言，海外数据与 HERE 合作
- 已与 40+ 车厂、100+ 品牌合作，200+ 在交付项目

### 4.2 百度导航 SDK

- Android 导航 SDK 明确写：**「请勿在车机或其他设备上使用」**，车机/后装需求需单独联系商务
- 手机端 SDK 免费、无调用次数限制；商业用途需看《使用须知》

### 4.3 开源 / 自托管（与现有栈最契合）

| 方案 | 说明 |
| --- | --- |
| OSRM（已用） | 自托管算路，WGS-84，完全离线 |
| Valhalla | 自托管，支持实时交通注入、多模式、地图匹配 |
| OpenRouteService | SaaS + 可自托管，有社区 MCP 封装 |
| 社区 OSM MCP | `osm-mcp`、`mcp-openrouteservice`、`openroute-mcp` 等，可本地跑，天然 WGS-84 |
| 天地图 | 国家平台，CGCS2000（≈WGS-84），有免费 key 和配额；仅社区 MCP 封装，无官方 MCP |

来源：<https://github.com/pipeworx-io/mcp-openrouteservice>、<https://github.com/vemonet/openroute-mcp>

---

## 5. 合规红线（中国境内实车）

1. **测绘资质**：导航电子地图制作需甲级测绘资质。高德、百度、腾讯（大地通途）、四维图新、天地图持证；自采/自绘图商不具备。
2. **审图号**：地图展示界面必须标注审图号，境外图商境内服务需具备资质或与持证方合作。
3. **汽车数据**：《汽车数据安全管理若干规定（试行）》要求重要数据境内存储，出境需安全评估；默认不收集，车外人脸/车牌需匿名化。
   <https://www.gov.cn/gongbao/content/2021/content_5647363.htm>
4. **坐标一致**：内部 WGS-84 是硬约束。高德/腾讯 GCJ-02、百度 BD-09，混用会产生 50–500 m 偏移，必须在边界层单向转换。
5. **密钥**：三家 MCP 都是 key 拼在 URL 里，日志/抓包易泄露。车端不得持有，应由后端代理并限流。

---

## 6. 建议架构

```text
车端                         云端                       第三方
┌──────────────┐      ┌──────────────────┐      ┌──────────────┐
│ 本地导航引擎 │      │  NavProvider 适配层│─────▶│ 高德/腾讯 API │
│ OSRM/Valhalla│◀────▶│  (WGS-84 内部)    │      └──────────────┘
│ MapLibre     │ REST │  - geocode        │      ┌──────────────┐
│ 离线兜底      │      │  - route          │─────▶│ 路况/POI/充电 │
└──────────────┘      │  - search_along   │      └──────────────┘
                      │  - traffic        │
                      │  MCP 适配器(可选) │─────▶ Agent / 语音
                      └──────────────────┘
```

**接口约定（WGS-84 进出，转换在适配层内部完成）：**

```python
class NavProvider(Protocol):
    def geocode(self, address: str, city: str | None) -> list[Place]: ...
    def reverse_geocode(self, point: LatLon) -> Address: ...
    def route(self, req: RouteRequest) -> Route: ...
    def search_along(self, polyline: list[LatLon], keyword: str, radius_m: int) -> list[Place]: ...
    def traffic(self, polyline: list[LatLon]) -> TrafficReport: ...
```

**降级链**：`在线 API → 本地 OSRM → 缓存路线`。任何在线失败都不能让导航中断。

**接入优先级建议：**

| 场景 | 建议 |
| --- | --- |
| 珠海本地实车 POC | 保持 OSRM 离线；只接「实时路况 + POI 搜索」做增量 |
| 要快速验证云端能力 | 高德（生态最全、车机合作最多）或腾讯（文档与沿途搜索最好） |
| 需要自托管/可审计 | 百度开源 MCP 或社区 OSM/ORS MCP |
| 车辆出海 | HERE / Mapbox / TomTom |
| 引入语音助手后 | 云端 Agent 调 MCP，车端只收结构化指令 |

---

## 7. 风险清单

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 隧道/地库/弱网断网 | 导航中断 | 离线兜底 + 路线缓存 |
| MCP 多步调用延迟 | 语音响应慢 | 只用于非实时场景；实时链路走 Web API |
| 坐标系混用 | 偏移数十至数百米 | 边界层单向转换 + 单元测试 |
| key 泄露 | 被盗刷、费用 | 后端代理、限额、轮换 |
| 供应商锁定 | 换图商成本高 | NavProvider 抽象 + 契约测试 |
| 端点仍在 Preview/实验 | 接口变更 | 不把 Preview 服务放进主链路 |
| POI 内容注入 | 模型被诱导 | 车端只接受白名单指令类型 |
| 商用授权 | 量产合规 | 提前走商务，免费额度不用于运营 |

---

## 8. 两周 POC 建议

1. 申请高德 Web 服务 Key + 腾讯 Key（个人开发者即可），各写一个 20 行的 `curl` 验证：地理编码、驾车算路、沿途搜索。
2. 用真实珠海起终点，对比三家返回的距离/时长/路径形状与 OSRM 差异。
3. 在 `backend/app/services/` 下加 `nav_provider.py` 抽象与 `amap_provider.py` 实现，**先写测试再实现**（正常、无路线、点网外、偏航重算四类）。
4. 验证坐标转换：同一 WGS-84 点经 GCJ-02 往返误差 < 2 m。
5. 不接入车端 UI，先在本地页面加一个「在线路况」开关对比效果。

---

## 参考链接

- 高德 MCP：<https://lbs.amap.com/api/mcp-server/summary>
- 百度 MCP：<https://lbsyun.baidu.com/docs/ai?title=mcpserver/quickstart>
- 腾讯 MCP：<https://lbs.qq.com/service/MCPServer/MCPServerGuide/Overview>
- Mapbox MCP：<https://docs.mapbox.com/api/guides/mcp-server/>
- TomTom MCP：<https://docs.tomtom.com/tomtom-maps-mcp/documentation/overview>
- HERE Location Reasoning：<https://docs.here.com/location-reasoning/docs/hlroverview>
- Google Maps AI：<https://developers.google.com/maps/ai/mcp>
- 汽车数据安全管理若干规定：<https://www.gov.cn/gongbao/content/2021/content_5647363.htm>
