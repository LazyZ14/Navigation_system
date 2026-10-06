import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const SKILL_DIR = "/Users/lazyz14/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations";
const WORKSPACE = "/Users/lazyz14/Projects/Navigation_system";
const BUILD = path.join(WORKSPACE, ".pptx-build");
const SOURCE = path.join(WORKSPACE, "artifacts", "offline-navigation-mvp-report-2026-09-28-v2.pptx");
const FINAL = path.join(WORKSPACE, "artifacts", "offline-navigation-mvp-report-2026-09-28-readable-v3.pptx");
const { finalizePresentation } = await import(pathToFileURL(path.join(SKILL_DIR, "container_tools/artifact_tool_utils.mjs")).href);
const presentation = await PresentationFile.importPptx(await FileBlob.load(SOURCE));

function resize(ids, fontSize) {
  for (const id of ids) {
    const shape = presentation.resolve(id);
    shape.text.style = { typeface: "PingFang SC", fontSize, autoFit: "shrinkText" };
  }
}
function resizeAndReframe(id, left, top, width, height, fontSize) {
  const shape = presentation.resolve(id);
  shape.position = { left, top, width, height };
  shape.text.style = { typeface: "PingFang SC", fontSize, autoFit: "shrinkText" };
}

// Architecture and data pipeline: secondary descriptions are now legible from a room.
resize(["sh/sna103ap", "sh/5cva1cfq", "sh/x8vaxsfe", "sh/h4fa9wfy", "sh/fu9sn2p0", "sh/ilwf69kv", "sh/axcf29kj"], 15);
resize(["sh/oryp8fah", "sh/u1kbu1ov", "sh/twfux0ne", "sh/bq547yhw"], 15);

// MVP replay flow and the command needed to reproduce it.
resize(["sh/sjix0zy1", "sh/m5gvmhwn", "sh/zipwbmdc", "sh/7u5w765k", "sh/i5wva1o3"], 15);
resize(["sh/8bat47ml"], 15);

// iOS GPS flow: enlarge transport and navigation descriptions plus each rollout step.
resize(["sh/ofq5svm5", "sh/p0ji9kf2", "sh/do3id4fy"], 15);
resize(["sh/87a18zqt", "sh/wba1cjqp", "sh/cf6h0fql", "sh/pofy50nu"], 15);

// Vision flow: same treatment; keep the narrow final node compact but readable.
resize(["sh/kzu5c32t", "sh/d87uxg3m", "sh/1cru1g3y"], 15);
resize(["sh/p0ru503u"], 14);

// Flow nodes were designed for a compact screen preview. Give their descriptions
// more vertical room and a larger type size for projected presentation.
[
  ["sh/sna103ap", 90, 260, 200], ["sh/5cva1cfq", 381, 260, 200], ["sh/x8vaxsfe", 672, 260, 230], ["sh/h4fa9wfy", 993, 260, 200],
  ["sh/fu9sn2p0", 216, 458, 220], ["sh/ilwf69kv", 582, 458, 270], ["sh/axcf29kj", 978, 458, 220],
].forEach(([id, left, top, width]) => resizeAndReframe(id, left, top, width, 36, 16));
[
  ["sh/oryp8fah", 90, 310, 160], ["sh/u1kbu1ov", 338, 310, 220], ["sh/twfux0ne", 658, 310, 160], ["sh/bq547yhw", 1008, 310, 160],
].forEach(([id, left, top, width]) => resizeAndReframe(id, left, top, width, 35, 15));
[
  ["sh/sjix0zy1", 90, 288, 155], ["sh/m5gvmhwn", 320, 288, 155], ["sh/zipwbmdc", 550, 288, 155], ["sh/7u5w765k", 780, 286, 155], ["sh/i5wva1o3", 1010, 288, 155],
].forEach(([id, left, top, width]) => resizeAndReframe(id, left, top, width, 38, 16));
[
  ["sh/ofq5svm5", 90, 288, 230], ["sh/p0ji9kf2", 438, 288, 250], ["sh/do3id4fy", 818, 288, 270],
].forEach(([id, left, top, width]) => resizeAndReframe(id, left, top, width, 38, 16));
[
  ["sh/kzu5c32t", 90, 268, 200], ["sh/d87uxg3m", 380, 268, 220], ["sh/1cru1g3y", 762, 268, 220], ["sh/p0ru503u", 1070, 268, 126],
].forEach(([id, left, top, width]) => resizeAndReframe(id, left, top, width, 38, id === "sh/p0ru503u" ? 15 : 16));

await fs.mkdir(BUILD, { recursive: true });
const candidate = path.join(BUILD, "offline-navigation-mvp-report-readable-candidate.pptx");
await (await PresentationFile.exportPptx(presentation)).save(candidate);
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
  layoutArgs: ["--expected-slide-size-emu", "12192000,6858000", "--validate-bullet-geometry", "--validate-heading-fit"],
  fontPolicy: { basis: "design", families: ["PingFang SC"] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(BUILD, "offline-navigation-mvp-report-readable-v3.validation.json"),
});
console.log(FINAL);
