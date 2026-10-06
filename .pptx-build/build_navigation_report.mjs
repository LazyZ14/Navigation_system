import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const SKILL_DIR = "/Users/lazyz14/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations";
const WORKSPACE = "/Users/lazyz14/Projects/Navigation_system";
const BUILD = path.join(WORKSPACE, ".pptx-build");
const FINAL = path.join(WORKSPACE, "artifacts", "offline-navigation-mvp-report-2026-09-28-v2.pptx");
const { resolvePresentationFont, finalizePresentation } = await import(
  pathToFileURL(path.join(SKILL_DIR, "container_tools/artifact_tool_utils.mjs")).href,
);
const font = resolvePresentationFont({ fontFamily: "PingFang SC" });
const p = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const C = { navy: "#071B33", blue: "#1677FF", cyan: "#32C5FF", ink: "#172033", muted: "#5B667A", pale: "#F4F7FB", line: "#DCE5F0", green: "#16A085", orange: "#F59E0B", white: "#FFFFFF", red: "#E85D75" };

function box(slide, text, x, y, w, h, opts = {}) {
  const s = slide.shapes.add({ geometry: opts.geometry ?? "textbox", position: { left: x, top: y, width: w, height: h }, fill: opts.fill ?? "none", line: opts.line ?? { fill: "none", width: 0 }, borderRadius: opts.radius, shadow: opts.shadow });
  s.text = text;
  s.text.style = { typeface: font, fontSize: opts.size ?? 20, color: opts.color ?? C.ink, bold: opts.bold ?? false, alignment: opts.align ?? "left", autoFit: "shrinkText", breakLine: false, verticalAlignment: opts.valign ?? "middle", marginLeft: opts.pad ?? 0, marginRight: opts.pad ?? 0, marginTop: opts.pad ?? 0, marginBottom: opts.pad ?? 0 };
  return s;
}
function rect(slide, x, y, w, h, fill, radius = "rounded-xl", line = { fill: "none", width: 0 }) { return slide.shapes.add({ geometry: "rect", position: { left: x, top: y, width: w, height: h }, fill, line, borderRadius: radius }); }
function title(slide, n, text, sub = "") {
  box(slide, String(n).padStart(2, "0"), 72, 48, 46, 22, { size: 12, bold: true, color: C.blue });
  box(slide, text, 72, 76, 1120, 52, { size: 32, bold: true, color: C.navy });
  if (sub) box(slide, sub, 72, 132, 1100, 34, { size: 15, color: C.muted });
}
function foot(slide, n) { box(slide, `离线导航系统 MVP 汇报  ·  2026.09  ·  ${String(n).padStart(2, "0")}`, 72, 680, 1136, 18, { size: 10, color: "#8390A3", align: "right" }); }
function node(slide, label, sub, x, y, w, fill, accent = C.blue) { const r = rect(slide, x, y, w, 82, fill, "rounded-xl", { style: "solid", fill: C.line, width: 1 }); rect(slide, x, y, 6, 82, accent, "rounded-sm"); box(slide, label, x + 18, y + 15, w - 34, 25, { size: 17, bold: true }); box(slide, sub, x + 18, y + 45, w - 30, 22, { size: 12, color: C.muted }); return r; }
function arrow(slide, x1, y1, x2, y2, color = C.blue) { slide.shapes.add({ geometry: "line", position: { left: x1, top: y1, width: x2 - x1, height: y2 - y1 }, fill: "none", line: { style: "solid", fill: color, width: 2, endArrowType: "triangle" } }); }
function notes(slide, text) { slide.speakerNotes.textFrame.setText(text); }

// 1. Cover
{ const s = p.slides.add(); s.background.fill = C.navy;
  for (let i=0;i<7;i++) { rect(s, 770 + i*70, 90 + i*42, 340, 8, i%2 ? "#0B335A" : "#11436F", "rounded-full"); }
  rect(s, 72, 70, 110, 7, C.cyan, "rounded-full");
  box(s, "面向实车部署的\n离线导航系统", 72, 160, 660, 180, { size: 47, bold: true, color: C.white });
  box(s, "从 AR-HUD 原型到可扩展的实时导航架构", 76, 365, 630, 34, { size: 22, color: "#C9D8EA" });
  box(s, "MVP 阶段成果与下一步演进方案", 76, 418, 500, 26, { size: 16, color: C.cyan });
  box(s, "2026.09", 76, 610, 160, 24, { size: 16, color: "#B4C7DC" });
  notes(s, "汇报聚焦当前 MVP 已完成的离线导航闭环，以及走向实车部署时的架构路径。");
}

// 2 Context
{ const s = p.slides.add(); s.background.fill = C.white; title(s, 2, "为什么从 Unity 原型走向独立导航架构", "AR-HUD 的表现层前提仍成立，但实车部署需要把实时导航能力从渲染工程中解耦。");
  rect(s, 72, 205, 526, 290, C.pale); rect(s, 636, 205, 572, 290, "#EEF6FF");
  box(s, "原型阶段：Unity / AR-HUD", 104, 238, 420, 34, { size: 24, bold: true, color: C.navy });
  box(s, "• 适合快速验证 HUD 呈现、路线叠加与交互\n• 业务逻辑、地图渲染、定位处理容易耦合\n• 面向持续定位与实时重算时，调试与替换成本上升", 104, 300, 435, 125, { size: 18, color: C.ink });
  box(s, "实车部署：导航内核独立", 668, 238, 440, 34, { size: 24, bold: true, color: C.navy });
  box(s, "• 路由、地图、定位匹配分别承担明确职责\n• HUD、Web 与后续车端显示共享同一导航状态\n• iOS GPS 与视觉识别通过适配层接入，不侵入路由引擎", 668, 300, 465, 125, { size: 18, color: C.ink });
  box(s, "设计结论：用本地可复现的导航服务承接实时性要求，AR-HUD 作为可替换的显示终端。", 72, 548, 1136, 62, { size: 22, bold: true, color: C.navy, fill: "#E8F3FF", radius: "rounded-xl", pad: 24 }); foot(s,2);
  notes(s, "当前项目没有否定 AR-HUD 的价值，而是把它定位为显示层。导航内核可独立演进，并向其他车端或 Web 显示端复用。");
}

// 3 Scope
{ const s = p.slides.add(); s.background.fill=C.white; title(s,3,"MVP 目标与边界", "先验证一条完整、离线、可重复的汽车导航闭环。");
  const xs=[72,456,840]; const cols=[C.blue,C.green,C.orange]; const heads=["本阶段已纳入","架构原则","明确暂不纳入"]; const bodies=["离线路线规划\n离线地图渲染\n模拟轨迹回放\n道路吸附与偏航重算","本地优先、可复现\nWGS-84 统一坐标\nOSRM / MapLibre / FastAPI 分层\n前端不直接依赖 OSRM", "真实 GPS 与车辆 CAN\n云地图、实时交通\n语音、LLM、OCR\n真实用户或车辆轨迹"]; 
  for(let i=0;i<3;i++){rect(s,xs[i],215,320,330,"#FFFFFF","rounded-2xl",{style:"solid",fill:C.line,width:1});rect(s,xs[i],215,320,10,cols[i],"rounded-full");box(s,heads[i],xs[i]+26,255,260,34,{size:22,bold:true,color:C.navy});box(s,bodies[i],xs[i]+26,320,266,170,{size:18,color:C.ink});}
  box(s,"这套边界让 MVP 的结果可验证，也为后续硬件与算法接入预留明确接口。",72,595,1040,30,{size:18,bold:true,color:C.muted}); foot(s,3); notes(s,"MVP 不将尚未实现的 GPS、视觉和云端能力混入当前成果。测试轨迹全部为合成数据。"); }

// 4 architecture
{ const s=p.slides.add(); s.background.fill=C.white; title(s,4,"总体架构：四层分工，导航状态统一输出", "浏览器、未来 HUD 与车端显示都只消费协调服务发布的导航状态。");
  const a=node(s,"离线数据构建","OSM → OSRM / GeoJSON",72,220,230,C.pale,C.orange); const b=node(s,"OSRM 路由引擎","路线、最近道路、匹配",363,220,230,"#EEF6FF",C.blue); const c=node(s,"FastAPI 协调层","会话、偏航、状态推送",654,220,260,"#EEF9F5",C.green); const d=node(s,"MapLibre 显示层","底图、路线、车标、提示",975,220,230,C.pale,C.cyan);
  arrow(s,302,261,356,261,C.orange); arrow(s,593,261,647,261); arrow(s,914,261,968,261);
  node(s,"轨迹来源","当前：JSON 回放\n后续：iOS GPS",198,420,250,C.pale,C.red); node(s,"导航状态","匹配位置、进度、下一动作、偏航",564,420,300,"#EEF6FF",C.blue); node(s,"显示终端","当前：本地 Web\n后续：AR-HUD / 车端",960,420,250,C.pale,C.cyan);
  arrow(s,448,461,556,461,C.red); arrow(s,864,461,952,461,C.blue);
  box(s,"关键边界：OSRM 只负责路由与路网查询；MapLibre 只负责显示；FastAPI 负责把位置变成可消费的导航状态。",72,565,1136,54,{size:19,bold:true,color:C.navy,fill:"#E8F3FF",radius:"rounded-xl",pad:20}); foot(s,4); notes(s,"项目 ARCHITECTURE.md：OSRM 负责路网与路线，FastAPI 负责会话和导航协调，MapLibre 负责渲染。浏览器不直接调用 OSRM。"); }

// 5 OSS
{ const s=p.slides.add(); s.background.fill=C.white; title(s,5,"开源基座：复用成熟能力，保留业务边界", "不是从零实现路由、地图渲染或 API 框架，而是在适配层实现导航业务规则。");
  const items=[
    ["OSRM","高性能开源路由引擎","汽车 profile、Route / Nearest / Match 能力","Project-OSRM/osrm-backend","#EAF3FF",C.blue],
    ["MapLibre GL JS","浏览器端开源地图渲染","离线 GeoJSON 图层、路线叠加、相机跟随","maplibre/maplibre-gl-js","#EAF8F3",C.green],
    ["FastAPI","Python 服务框架","类型化 API、导航会话、WebSocket 状态推送","fastapi/fastapi","#FFF5E8",C.orange],
  ];
  items.forEach((it,i)=>{const y=205+i*130;rect(s,72,y,1136,104,"#FFFFFF","rounded-xl",{style:"solid",fill:C.line,width:1});rect(s,72,y,9,104,it[5],"rounded-full");box(s,it[0],105,y+22,185,30,{size:23,bold:true,color:C.navy});box(s,it[1],290,y+18,270,28,{size:16,bold:true});box(s,it[2],570,y+17,360,58,{size:15,color:C.muted});box(s,it[3],948,y+37,220,21,{size:12,bold:true,color:it[5],align:"right"});});
  foot(s,5); notes(s,"开源参考：\nOSRM https://github.com/Project-OSRM/osrm-backend\nMapLibre GL JS https://github.com/maplibre/maplibre-gl-js\nFastAPI https://github.com/fastapi/fastapi\n仓库 package.json 与 pyproject.toml 分别声明 maplibre-gl、FastAPI 等依赖。"); }

// 6 data pipeline
{ const s=p.slides.add(); s.background.fill=C.white; title(s,6,"OSM 数据处理：一份原始地图，两条可追溯的离线产线", "实验区域为北京局部路网。输入、边界、校验值、构建时间与命令均记录在元数据中。");
  rect(s,72,205,1136,358,C.pale,"rounded-2xl");
  const stages=[["map.osm","原始 OSM XML\nGit 忽略",72,C.orange],["OSRM MLD","extract → partition → customize\n汽车路网查询",320,C.blue],["8 类 GeoJSON","道路 / 建筑 / 水系 / 绿地 / 用地\n道路名 / 地点名 / POI",640,C.green],["MapLibre","本地静态加载\n不依赖在线瓦片",990,C.cyan]];
  stages.forEach((it,i)=>{node(s,it[0],it[1],it[2],270,i===1?250:190,C.white,it[3]);if(i<3)arrow(s,it[2]+(i===1?250:190),311,stages[i+1][2]-8,311,it[3]);});
  box(s,"数据治理",112,455,160,24,{size:15,bold:true,color:C.orange}); box(s,"输入 SHA-256 · 地图边界 · 构建 UTC 时间 · 工具版本 · 完整命令",272,455,750,24,{size:16,color:C.ink});
  box(s,"当前实验范围：39.86864–39.90006 N，116.36676–116.41706 E。原始 OSM、OSRM 文件、MBTiles 均不提交 Git。",72,590,1136,32,{size:16,color:C.muted}); foot(s,6); notes(s,"资料来源：docs/data-build.md；data/metadata/map.osm-build.json；data/metadata/map.osm-maplibre-thematic-geojson-build.json。OSRM 使用 MLD 构建流程。"); }

// 7 map visuals optimizations
{ const s=p.slides.add(); s.background.fill=C.white; title(s,7,"离线可视化：以主题 GeoJSON 降低 MVP 复杂度", "先交付可读、可离线的底图与导航叠加；地图规模扩大后无缝替换为 MBTiles 矢量瓦片。");
  rect(s,72,210,530,330,"#091F38","rounded-2xl");
  // Stylized map using simple functional lines / labels
  [[115,265,390,0],[126,355,360,0],[164,455,320,0],[245,240,0,250],[380,235,0,270],[515,250,0,240]].forEach(v=>{s.shapes.add({geometry:"line",position:{left:v[0],top:v[1],width:v[2],height:v[3]},fill:"none",line:{style:"solid",fill:"#39536E",width:6}})});
  s.shapes.add({geometry:"line",position:{left:118,top:285,width:410,height:160,rotation:159},fill:"none",line:{style:"solid",fill:C.cyan,width:8}});
  s.shapes.add({geometry:"ellipse",position:{left:115,top:432,width:20,height:20},fill:C.green,line:{fill:"none",width:0}}); s.shapes.add({geometry:"ellipse",position:{left:515,top:273,width:20,height:20},fill:C.red,line:{fill:"none",width:0}});
  box(s,"模拟离线导航视图",108,505,240,26,{size:15,bold:true,color:"#CFE6FF"});
  const ops=[["表达层","道路、建筑、水系、绿地、用地与标签分层渲染",C.blue],["导航层","主路线高亮、已通过路线灰化、箭头、旋转车标、下一转向",C.green],["性能路径","当前主题 GeoJSON；更大范围与高缩放级别转 MBTiles / 矢量瓦片",C.orange]];
  ops.forEach((it,i)=>{const y=225+i*105;rect(s,652,y,520,78,"#FFFFFF","rounded-xl",{style:"solid",fill:C.line,width:1});rect(s,652,y,8,78,it[2],"rounded-full");box(s,it[0],676,y+16,110,25,{size:17,bold:true,color:C.navy});box(s,it[1],790,y+13,350,50,{size:14,color:C.muted});});
  box(s,"优化原则：不为当前约 10 MB 的实验地图提前引入 PBF / MBTiles 转换链复杂度。",72,590,1136,32,{size:16,color:C.muted}); foot(s,7); notes(s,"资料来源：ARCHITECTURE.md 第 4 节与 docs/data-build.md。当前为同一 OSM 构建的 8 类 GeoJSON，后续可替换为 MBTiles 而无需改变前端路由 API。"); }

// 8 MVP
{ const s=p.slides.add();s.background.fill=C.white;title(s,8,"MVP 当前成果：离线导航闭环已经可演示", "从选点到到达、从偏航到重新规划，均可在本地 Docker 环境复现。");
  const flow=[["选择起终点","路线规划","开始模拟回放","道路匹配\n与导航状态","到达 / 偏航重算"]]; const labels=flow[0]; labels.forEach((v,i)=>{const x=72+i*230;node(s,v,i===0?"地图点击或预置端点":i===1?"距离、时长、逐步转向":i===2?"暂停、继续、重播":i===3?"匹配位置、进度、下一动作":"替换路线并继续",x,250,185,C.pale,[C.blue,C.blue,C.orange,C.green,C.red][i]);if(i<4)arrow(s,x+185,291,x+222,291,C.blue);});
  rect(s,72,410,1136,160,"#EEF6FF","rounded-2xl"); box(s,"当前验证点",104,440,190,28,{size:21,bold:true,color:C.navy}); box(s,"正常路线  ·  无可达路线  ·  路网外定位点  ·  偏航重算\n正常轨迹到达 arrived；偏航轨迹要求恰好触发一次路线替换。",330,431,710,70,{size:18,color:C.ink});
  box(s,"运行方式：bash scripts/demo.sh 启动本地三容器；bash scripts/smoke_test.sh 验证闭环。",104,530,900,22,{size:14,color:C.muted});foot(s,8);notes(s,"资料来源：README.md、docs/demo-runbook.md、DEVELOPMENT.md。此页描述项目定义的验证标准和演示闭环，不把其表述为生产实车验证。"); }

// 9 GPS roadmap
{const s=p.slides.add();s.background.fill=C.white;title(s,9,"实车路径一：通过 iOS 接入 GPS，保持导航内核不变", "建议把 iPhone 视为定位传感器与上行网关，先解决稳定传输、时间同步与断连恢复。");
  const a=node(s,"iPhone / iOS","Core Location：WGS-84\n位置、航向、速度、精度、时间",72,250,260,"#EEF6FF",C.blue);const b=node(s,"传输适配层","局域网 WebSocket 优先\n序列号、鉴权、心跳、重连",420,250,280,"#FFF5E8",C.orange);const c=node(s,"导航协调层","字段校验、时序处理\n道路吸附、偏航判断",800,250,300,"#EEF9F5",C.green);arrow(s,332,291,412,291);arrow(s,700,291,792,291);
  const steps=[["1", "定义稳定定位协议", "lat / lon / heading / speed_mps / accuracy_m / timestamp"],["2","端到端回放对照","同一轨迹输入应产生同一状态序列"],["3","道路匹配上线","前端只显示匹配后位置，保留原始点供诊断"],["4","车端异常处理","弱网、漂移、断连、低精度与重新获得定位"]];
  steps.forEach((it,i)=>{const x=72+i*284;rect(s,x,450,260,105,"#FFFFFF","rounded-xl",{style:"solid",fill:C.line,width:1});box(s,it[0],x+18,467,28,24,{size:18,bold:true,color:C.blue});box(s,it[1],x+55,464,184,24,{size:16,bold:true});box(s,it[2],x+18,500,225,38,{size:13,color:C.muted});});
  box(s,"接口原则：iOS 仅替换“定位来源”适配器，不直接驱动地图，不将原始 GPS 写回 OSM。",72,600,1136,28,{size:16,bold:true,color:C.navy});foot(s,9);notes(s,"这是后续设计建议，尚未在 MVP 实现。数据契约沿用项目 DATA_POLICY.md 中的 WGS-84 模型。传输方案建议局域网 WebSocket 优先，后续可评估 USB / BLE 等链路。");}

// 10 vision
{const s=p.slides.add();s.background.fill=C.white;title(s,10,"实车路径二：视觉模型作为“确认与感知”能力接入", "视觉不替代地图路由；它为接近目的地、道路事件或 HUD 提示提供附加证据。");
  const a=node(s,"相机输入","车载或手机相机\n帧时间戳与设备标识",72,230,230,C.pale,C.red);const b=node(s,"视觉推理服务","检测 / 识别 / 置信度\n可本地部署",362,230,250,"#FFF5E8",C.orange);const c=node(s,"事件适配层","时空对齐、去抖\n限定输出事件模型",744,230,250,"#EEF6FF",C.blue);const d=node(s,"导航体验层","到达确认、提示增强\n不直接改写路由",1052,230,156,"#EEF9F5",C.green);arrow(s,302,271,354,271,C.red);arrow(s,612,271,736,271,C.orange);arrow(s,994,271,1044,271,C.blue);
  rect(s,72,420,1136,145,C.pale,"rounded-2xl"); box(s,"优先落地场景",105,450,190,27,{size:20,bold:true,color:C.navy});box(s,"接近终点时识别商铺招牌 / 入口，作为“到达确认”的辅助信号。",335,444,730,32,{size:18,color:C.ink});box(s,"约束：只输出结构化感知事件与置信度；导航会话决定是否展示或触发业务动作；保留人工验证与失败降级。",335,495,750,32,{size:15,color:C.muted});foot(s,10);notes(s,"这是后续设计建议，当前 MVP 不包含 OCR、检测模型或真实视频。项目 ARCHITECTURE.md 已定义 OCR 只在接近终点时验证商铺招牌的边界。");}

// 11 plan
{const s=p.slides.add();s.background.fill=C.white;title(s,11,"下一阶段计划：从可演示闭环走向可路测闭环", "每一步都以可重复输入、可观测状态和明确验收为前提。");
  const lines=[["近期","iOS 定位协议与回放工具","把手机定位数据导入现有模拟器；验证时间戳、精度与断连行为",C.blue],["中期","实车定位适配与路测","道路匹配、偏航阈值、状态推送的实车数据验证",C.green],["后续","本地视觉事件服务","先做终点确认，再扩展到道路感知提示",C.orange],["规模化","MBTiles 与车端显示集成","扩大离线地图范围，接入 HUD / 车机显示终端",C.red]];
  lines.forEach((it,i)=>{const y=205+i*92;rect(s,72,y,1136,70,"#FFFFFF","rounded-xl",{style:"solid",fill:C.line,width:1});rect(s,72,y,10,70,it[3],"rounded-full");box(s,it[0],110,y+21,90,22,{size:15,bold:true,color:it[3]});box(s,it[1],240,y+16,310,26,{size:18,bold:true,color:C.navy});box(s,it[2],575,y+15,580,38,{size:15,color:C.muted});});
  box(s,"需要持续守住的约束：离线优先、WGS-84 一致、适配层隔离外部服务、真实数据最小化且合规使用。",72,605,1136,30,{size:16,bold:true,color:C.navy});foot(s,11);notes(s,"本页为规划，不代表现已具备的能力。计划沿用现有架构边界，避免 iOS、视觉模型或车端 UI 直接耦合 OSRM / MapLibre 内核。");}

// 12 close
{const s=p.slides.add();s.background.fill=C.navy;rect(s,72,74,110,7,C.cyan,"rounded-full");box(s,"当前 MVP 已验证：离线路由、离线地图、\n模拟定位与偏航重算。",72,150,980,150,{size:34,bold:true,color:C.white});box(s,"下一步的核心不是扩展功能清单，而是把真实传感器接入现有的、可观测且可替换的导航内核。",76,372,820,70,{size:22,color:"#C9D8EA"});rect(s,76,515,850,2,"#315272","rounded-full");box(s,"Q & A",76,560,200,44,{size:29,bold:true,color:C.cyan});box(s,"架构、数据链路与实车演进",76,614,450,25,{size:15,color:"#B4C7DC"});notes(s,"感谢。可根据听众继续展开数据构建、偏航匹配算法、iOS 传输协议或视觉服务边界。");}

await fs.mkdir(BUILD,{recursive:true}); await fs.mkdir(path.dirname(FINAL),{recursive:true});
const candidate = path.join(BUILD,"offline-navigation-mvp-report-candidate.pptx");
await (await PresentationFile.exportPptx(p)).save(candidate);
const requirements={ explicitTotalSlideCount:12, requiredNativeTableOwnerSlides:[], requiredNativeChartOwnerSlides:[] };
await finalizePresentation({ ...requirements, workspaceDir:WORKSPACE, candidatePath:candidate, finalPath:FINAL, pythonExecutable:"/Users/lazyz14/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3", integrityValidatorPath:path.join(SKILL_DIR,"container_tools/inspect_presentation_package_integrity.py"), layoutValidatorPath:path.join(SKILL_DIR,"container_tools/inspect_presentation_layout_geometry.py"), layoutArgs:["--expected-slide-size-emu","12192000,6858000","--validate-bullet-geometry","--validate-heading-fit"], fontPolicy:{basis:"design",families:[font]}, verifyArtifactToolImport:true, receiptPath:path.join(BUILD,"offline-navigation-mvp-report-v2.validation.json") });
console.log(FINAL);
