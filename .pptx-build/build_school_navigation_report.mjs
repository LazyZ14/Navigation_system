import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const SKILL_DIR = "/Users/lazyz14/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations";
const WORKSPACE = "/Users/lazyz14/Projects/Navigation_system";
const TEMPLATE = "/Users/lazyz14/资料/PolyU/STF/case2第四阶段汇报.pptx";
const SCREENSHOT = path.join(WORKSPACE, ".pptx-build", "navigation-source-rendered", "slide-7.png");
const BUILD = path.join(WORKSPACE, ".pptx-build");
const FINAL = path.join(WORKSPACE, "artifacts", "case2-navigation-system-report.pptx");
const { finalizePresentation } = await import(pathToFileURL(path.join(SKILL_DIR, "container_tools/artifact_tool_utils.mjs")).href);
const p = await PresentationFile.importPptx(await FileBlob.load(TEMPLATE));
const screenshot = await fs.readFile(SCREENSHOT);

const C = { red: "#B43D56", deep: "#8F2E45", yellow: "#FFF200", ink: "#263238", gray: "#64748B", pale: "#F8F3F4", line: "#E6CDD4", white: "#FFFFFF", green: "#2F8B72", blue: "#427EAD", orange: "#D98A2E" };
const FONT = "宋体";

function rect(slide, x, y, w, h, fill = C.white, line = { style: "solid", fill: C.line, width: 1 }, radius = "rounded-lg") {
  return slide.shapes.add({ geometry: "rect", position: { left: x, top: y, width: w, height: h }, fill, line, borderRadius: radius });
}
function text(slide, value, x, y, w, h, opts = {}) {
  const shape = slide.shapes.add({ geometry: "textbox", position: { left: x, top: y, width: w, height: h }, fill: "none", line: { fill: "none", width: 0 } });
  shape.text = value;
  shape.text.style = { typeface: FONT, fontSize: opts.size ?? 18, bold: opts.bold ?? false, color: opts.color ?? C.ink, alignment: opts.align ?? "left", verticalAlignment: opts.valign ?? "middle", autoFit: "shrinkText", marginLeft: opts.pad ?? 0, marginRight: opts.pad ?? 0, marginTop: opts.pad ?? 0, marginBottom: opts.pad ?? 0 };
  return shape;
}
function title(slide, value) {
  const ph = slide.placeholders.getItem("title");
  ph.text = value;
}
function note(slide, value) { slide.speakerNotes.textFrame.setText(value); }
function line(slide, x1, y1, x2, y2, color = C.red) { slide.shapes.add({ geometry: "line", position: { left: x1, top: y1, width: x2 - x1, height: y2 - y1 }, fill: "none", line: { style: "solid", fill: color, width: 2, endArrowType: "triangle" } }); }
function node(slide, headline, detail, x, y, w, accent = C.red, h = 84) {
  rect(slide, x, y, w, h, C.white);
  rect(slide, x, y, 6, h, accent, { fill: "none", width: 0 }, "rounded-sm");
  text(slide, headline, x + 16, y + 13, w - 28, 23, { size: 18, bold: true });
  text(slide, detail, x + 16, y + 41, w - 28, h - 48, { size: 14, color: C.gray });
}
function panel(slide, label, body, x, y, w, accent = C.red) {
  rect(slide, x, y, w, 210, C.pale);
  rect(slide, x, y, w, 7, accent, { fill: "none", width: 0 }, "rounded-sm");
  text(slide, label, x + 20, y + 28, w - 40, 32, { size: 24, bold: true, color: C.deep });
  text(slide, body, x + 20, y + 84, w - 40, 96, { size: 18, color: C.ink });
}

// Existing pages 2–4 plus seven copies form the ten school-template content pages.
const closing = p.slides.getItem(4);
const standard = p.slides.getItem(1);
for (let i = 0; i < 7; i += 1) standard.duplicate();
closing.moveTo(11);
const S = Array.from({ length: 10 }, (_, index) => p.slides.getItem(index + 1));
// The template closing page is background-only after import. Keep its visual intact
// while retaining one drawable object for PPTX structural validation.
text(closing, " ", 1, 1, 1, 1, { size: 1, color: C.white });

// 2. Background
title(S[0], "项目背景 – 从 AR-HUD 原型走向实车架构");
panel(S[0], "原型阶段", "Unity / AR-HUD 适合快速验证 HUD 呈现、路线叠加与交互。\n\n但地图渲染、定位处理和业务状态逐渐耦合，难以承接持续定位与实时重算。", 60, 120, 390, C.red);
panel(S[0], "实车部署目标", "将导航能力从显示工程中拆出。\n\n路由、地图、定位匹配分别承担职责；HUD、Web 和后续车端共用同一导航状态。", 510, 120, 390, C.yellow);
text(S[0], "设计结论：以本地、可复现的导航内核承接实时性要求，AR-HUD 作为可替换的显示终端。", 60, 375, 840, 54, { size: 22, bold: true, color: C.deep, align: "center" });
note(S[0], "项目背景：AR-HUD 的展示价值保留，但导航内核需要独立演进。\n来源：项目 ARCHITECTURE.md。");

// 3. Scope
title(S[1], "MVP 范围 – 先验证离线导航闭环");
const scope = [["当前已实现", "离线路线规划\n离线地图渲染\n模拟轨迹回放\n道路吸附与偏航重算", C.red], ["工程原则", "本地优先、可复现\nWGS-84 统一坐标\nOSRM / MapLibre / FastAPI 分层", C.green], ["后续再接入", "真实 GPS 与车辆 CAN\n实时交通、云地图\n视觉识别、语音与推荐", C.orange]];
scope.forEach(([h, b, c], i) => panel(S[1], h, b, 52 + i * 292, 115, 260, c));
text(S[1], "MVP 不使用真实用户轨迹；所有演示输入均为可重复的合成轨迹。", 60, 402, 840, 34, { size: 19, bold: true, color: C.deep, align: "center" });
note(S[1], "MVP 边界来自 README.md、DEVELOPMENT.md 与 DATA_POLICY.md。");

// 4. Architecture
title(S[2], "总体架构 – 数据、路由、协调与显示分层");
node(S[2], "离线数据构建", "OSM → OSRM / GeoJSON", 50, 120, 185, C.orange);
node(S[2], "OSRM 路由引擎", "路线、最近道路、匹配", 280, 120, 185, C.red);
node(S[2], "FastAPI 协调层", "会话、偏航、状态推送", 510, 120, 185, C.green);
node(S[2], "MapLibre 显示层", "底图、路线、车标、提示", 740, 120, 170, C.blue);
line(S[2], 235, 162, 270, 162); line(S[2], 465, 162, 500, 162); line(S[2], 695, 162, 730, 162);
node(S[2], "定位来源", "当前：JSON 回放\n后续：iOS GPS", 160, 290, 220, C.orange);
node(S[2], "导航状态", "匹配位置、进度、下一动作、偏航", 465, 290, 280, C.red);
node(S[2], "显示终端", "当前：本地 Web\n后续：AR-HUD / 车端", 790, 290, 160, C.green);
line(S[2], 380, 332, 455, 332); line(S[2], 745, 332, 780, 332);
text(S[2], "OSRM 负责路网查询；FastAPI 把定位处理为导航状态；MapLibre 只负责显示。", 60, 418, 840, 36, { size: 20, bold: true, color: C.deep, align: "center" });
note(S[2], "资料来源：ARCHITECTURE.md。浏览器不直接调用 OSRM。");

// 5. Open-source basis
title(S[3], "开源基座 – 复用成熟能力，保留业务边界");
const libs = [["OSRM", "高性能开源路由引擎", "汽车 profile、路线规划、最近道路", "Project-OSRM/osrm-backend", C.red], ["MapLibre GL JS", "浏览器端开源地图渲染", "离线 GeoJSON 图层、路线叠加、相机跟随", "maplibre/maplibre-gl-js", C.green], ["FastAPI", "Python 服务框架", "类型化 API、导航会话、状态推送", "fastapi/fastapi", C.orange]];
libs.forEach(([name, role, use, repo, c], i) => { const y = 112 + i * 105; rect(S[3], 55, y, 850, 82, C.white); rect(S[3], 55, y, 7, 82, c, { fill: "none", width: 0 }, "rounded-sm"); text(S[3], name, 78, y + 18, 145, 28, { size: 22, bold: true, color: C.deep }); text(S[3], role, 240, y + 16, 220, 27, { size: 17, bold: true }); text(S[3], use, 475, y + 15, 285, 29, { size: 15, color: C.gray }); text(S[3], repo, 760, y + 50, 120, 18, { size: 11, color: c, align: "right" }); });
note(S[3], "开源项目：github.com/Project-OSRM/osrm-backend；github.com/maplibre/maplibre-gl-js；github.com/fastapi/fastapi。");

// 6. Data pipeline
title(S[4], "OSM 数据处理 – 一份原始地图，两条离线产线");
node(S[4], "map.osm", "原始 OSM XML\nGit 忽略", 55, 135, 170, C.orange);
node(S[4], "OSRM MLD", "extract → partition → customize\n汽车路网查询", 275, 135, 220, C.red);
node(S[4], "8 类 GeoJSON", "道路、建筑、水系、绿地、用地\n道路名、地点名、POI", 545, 135, 205, C.green);
node(S[4], "MapLibre", "本地静态加载\n不依赖在线瓦片", 800, 135, 110, C.blue);
line(S[4], 225, 177, 265, 177); line(S[4], 495, 177, 535, 177); line(S[4], 750, 177, 790, 177);
rect(S[4], 55, 290, 855, 86, C.pale); text(S[4], "数据治理", 82, 313, 120, 24, { size: 18, bold: true, color: C.deep }); text(S[4], "输入 SHA-256、地图边界、构建时间、工具版本与完整命令均写入元数据。", 210, 306, 650, 38, { size: 18, color: C.ink });
text(S[4], "当前输入为北京局部区域；原始 OSM、OSRM 预处理文件与后续 MBTiles 均不提交 Git。", 60, 405, 840, 28, { size: 17, color: C.gray, align: "center" });
note(S[4], "资料来源：docs/data-build.md；data/metadata/map.osm-build.json；data/metadata/map.osm-maplibre-thematic-geojson-build.json。");

// 7. Rendering with actual screenshot
title(S[5], "离线地图渲染 – 主题 GeoJSON 与导航叠加");
S[5].images.add({ blob: screenshot, contentType: "image/png", alt: "当前离线导航地图实际截图", fit: "cover", crop: { left: 0.04, top: 0.30, right: 0.51, bottom: 0.27 }, position: { left: 55, top: 105, width: 430, height: 265 }, geometry: "roundRect", borderRadius: "rounded-xl" });
const layers = [["表达层", "道路、建筑、水系、绿地、用地与标签分层渲染", C.red], ["导航层", "主路线高亮、已通过路线灰化、车标与转向提示", C.green], ["性能路径", "当前使用主题 GeoJSON；扩展地图范围时升级为 MBTiles", C.orange]];
layers.forEach(([h,b,c],i)=>{const y=108+i*92;rect(S[5],530,y,365,70,C.white);rect(S[5],530,y,7,70,c,{fill:"none",width:0},"rounded-sm");text(S[5],h,550,y+15,82,22,{size:17,bold:true,color:C.deep});text(S[5],b,642,y+12,230,37,{size:14,color:C.gray});});
text(S[5], "MapLibre 不直接解析 OSM XML。项目先将 OSM 转成主题 GeoJSON，再由 MapLibre 以图层规则渲染。", 60, 410, 840, 38, { size: 18, bold: true, color: C.deep, align: "center" });
note(S[5], "截图来自用户更新后的离线导航 MVP 报告第 7 页。资料来源：ARCHITECTURE.md 与 docs/data-build.md。");

// 8. MVP loop
title(S[6], "MVP 当前成果 – 离线导航闭环可演示");
const steps = [["选择起终点", "地图点击或预置端点", C.red], ["路线规划", "距离、时长、逐步转向", C.orange], ["模拟回放", "暂停、继续、重播", C.green], ["道路匹配", "位置、进度、下一动作", C.blue], ["到达 / 重算", "替换路线并继续", C.red]];
steps.forEach(([h,b,c],i)=>{const x=48+i*180;node(S[6],h,b,x,135,145,c); if(i<4) line(S[6],x+145,177,x+172,177,c);});
rect(S[6],55,295,850,94,C.pale);text(S[6],"当前验证",82,320,110,26,{size:19,bold:true,color:C.deep});text(S[6],"正常路线、无可达路线、路网外定位点与偏航重算。\n正常轨迹到达 arrived；偏航轨迹恰好触发一次路线替换。",220,312,620,50,{size:18,color:C.ink});
text(S[6],"运行方式：bash scripts/demo.sh 启动本地服务；bash scripts/smoke_test.sh 验证闭环。",60,420,840,24,{size:15,color:C.gray,align:"center"});
note(S[6], "资料来源：README.md、docs/demo-runbook.md、DEVELOPMENT.md。");

// 9. iOS GPS
title(S[7], "实车路径一 – 通过 iOS 接入 GPS");
node(S[7], "iPhone / iOS", "Core Location\n位置、航向、速度、精度、时间", 60, 125, 230, C.red);
node(S[7], "传输适配层", "局域网 WebSocket 优先\n序号、鉴权、心跳、重连", 365, 125, 240, C.orange);
node(S[7], "导航协调层", "字段校验、时序处理\n道路吸附、偏航判断", 680, 125, 230, C.green);
line(S[7],290,167,355,167);line(S[7],605,167,670,167);
const ios = [["1", "定义定位协议", "lat、lon、heading、speed、accuracy、timestamp"],["2","端到端回放对照","同一轨迹输入应产生同一导航状态序列"],["3","道路匹配上线","只显示匹配位置，原始点保留给诊断"],["4","车端异常处理","弱网、漂移、断连、低精度与恢复"]];
ios.forEach(([n,h,b],i)=>{const x=55+i*215;rect(S[7],x,300,195,87,C.white);text(S[7],n,x+16,315,18,18,{size:16,bold:true,color:C.red});text(S[7],h,x+44,313,130,20,{size:16,bold:true});text(S[7],b,x+16,345,164,31,{size:13,color:C.gray});});
text(S[7],"iOS 只替换定位来源适配器，不直接驱动地图，也不将原始 GPS 写回 OSM。",60,420,840,28,{size:18,bold:true,color:C.deep,align:"center"});
note(S[7], "这是后续设计建议，尚未在 MVP 实现。数据契约来自 DATA_POLICY.md。");

// 10. Vision model
title(S[8], "实车路径二 – 视觉模型作为确认与感知能力");
node(S[8], "相机输入", "车载或手机相机\n帧时间戳与设备标识", 52, 130, 195, C.red);
node(S[8], "视觉推理服务", "检测 / 识别 / 置信度\n可本地部署", 290, 130, 200, C.orange);
node(S[8], "事件适配层", "时空对齐、去抖\n限定结构化事件模型", 533, 130, 200, C.blue);
node(S[8], "导航体验层", "到达确认、提示增强\n不直接改写路由", 776, 130, 135, C.green);
line(S[8],247,172,280,172);line(S[8],490,172,523,172);line(S[8],733,172,766,172);
rect(S[8],55,300,850,95,C.pale);text(S[8],"优先落地场景",82,324,155,27,{size:19,bold:true,color:C.deep});text(S[8],"接近终点时识别商铺招牌或入口，将结果作为“到达确认”的辅助信号。\n视觉服务只输出事件和置信度，由导航会话决定是否展示或触发动作。",255,314,600,56,{size:18,color:C.ink});
note(S[8], "这是后续设计建议，当前 MVP 不包含 OCR、检测模型或真实视频。项目 ARCHITECTURE.md 已定义 OCR 接入边界。");

// 11. Roadmap
title(S[9], "下一阶段计划 – 从可演示闭环走向可路测闭环");
const roadmap = [["近期", "iOS 定位协议与回放工具", "将手机定位数据导入现有模拟器，验证时间戳、精度与断连行为", C.red],["中期", "实车定位适配与路测", "验证道路匹配、偏航阈值与导航状态推送", C.green],["后续", "本地视觉事件服务", "先做终点确认，再扩展到道路感知提示", C.orange],["规模化", "MBTiles 与车端显示集成", "扩大离线地图范围，接入 HUD / 车机显示终端", C.blue]];
roadmap.forEach(([phase,h,b,c],i)=>{const y=105+i*77;rect(S[9],55,y,850,60,C.white);rect(S[9],55,y,8,60,c,{fill:"none",width:0},"rounded-sm");text(S[9],phase,80,y+18,70,21,{size:15,bold:true,color:c});text(S[9],h,180,y+16,270,23,{size:17,bold:true,color:C.deep});text(S[9],b,465,y+14,390,30,{size:15,color:C.gray});});
text(S[9],"持续约束：离线优先、WGS-84 一致、适配层隔离外部服务、真实数据最小化且合规使用。",60,425,840,28,{size:17,bold:true,color:C.deep,align:"center"});
note(S[9], "此页为后续计划，不代表现已具备的能力。");

// The original school master deliberately lets its long RAIDS footer and page
// number overlap the right edge by a fraction of a point. That is visually
// acceptable in the source deck but fails strict export geometry checks once
// the content slide is duplicated. Keep the same footer language, while
// constraining it to a clean, non-overlapping footer band on the ten report
// pages.
const footerSnapshot = await p.inspect({
  kind: "textbox,shape",
  include: "id,slide,name,textPreview",
  exclude: "preview,comments",
  maxChars: 40000,
});
for (const row of footerSnapshot.ndjson.trim().split("\n").filter(Boolean).map(JSON.parse)) {
  if (row.slide < 2 || row.slide > 11) continue;
  const item = p.resolve(row.id);
  if (row.name === "TextBox 4") {
    // Imported text boxes retain their source auto-height. Blank the inherited
    // three-piece footer and rebuild it below with fresh, compact objects.
    item.text = "";
    item.position = { left: 678, top: 470, width: 190, height: 18 };
  } else if (row.name === "Straight Connector 11") {
    item.line = { fill: C.white, width: 0 };
    item.position = { left: 0, top: 539, width: 0, height: 0 };
  } else if (row.name === "Slide Number Placeholder 2") {
    item.text = "";
    item.position = { left: 910, top: 515, width: 28, height: 18 };
  }
}
await fs.mkdir(BUILD, { recursive: true });
const candidate = path.join(BUILD, "case2-navigation-system-report-candidate.pptx");
await (await PresentationFile.exportPptx(p)).save(candidate);
await finalizePresentation({
  explicitTotalSlideCount: 12,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [],
  workspaceDir: WORKSPACE,
  candidatePath: candidate,
  finalPath: FINAL,
  pythonExecutable: "/Users/lazyz14/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3",
  integrityValidatorPath: path.join(SKILL_DIR, "container_tools/inspect_presentation_package_integrity.py"),
  layoutValidatorPath: path.join(SKILL_DIR, "container_tools/inspect_presentation_layout_geometry.py"),
  layoutArgs: ["--expected-slide-size-emu", "9144000,5143500", "--validate-bullet-geometry", "--validate-heading-fit"],
  fontPolicy: { basis: "reference", families: ["Arial", "Calibri", "PingFang SC", "宋体", "微软雅黑"], referencePath: TEMPLATE, referenceSha256: "8338fac5902292f1656aab8cfa63c4e0b4bd1c2904d3af59d0b9463c62e9bbfd" },
  verifyArtifactToolImport: true,
  receiptPath: path.join(BUILD, "case2-navigation-system-report.validation.json"),
});
console.log(FINAL);
