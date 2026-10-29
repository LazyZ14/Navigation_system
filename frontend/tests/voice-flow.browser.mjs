// Isolated browser regression with synthetic API responses; no cloud calls.
// PLAYWRIGHT_CORE_HOME=/path/to/npm/prefix CHROME_PATH=/path/to/chrome node tests/voice-flow.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

if (!process.env.PLAYWRIGHT_CORE_HOME || !process.env.CHROME_PATH) throw new Error("Set PLAYWRIGHT_CORE_HOME and CHROME_PATH");
const require = createRequire(resolve(process.env.PLAYWRIGHT_CORE_HOME, "package.json"));
const { chromium } = require("playwright-core");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage();
const navigationRequests = [];
const coord = (lat, lon) => ({ lat, lon });
const origin = coord(22.3718, 113.5806);
const candidates = { A: coord(22.375, 113.576), B: coord(22.386, 113.56), FAIL: coord(22.39, 113.56) };

await page.addInitScript(() => {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => {
    if (window.delayMicrophone) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      throw new DOMException("denied", "NotAllowedError");
    }
    if (window.rejectMicrophone) throw new DOMException("denied", "NotAllowedError");
    return { getTracks: () => [{ stop() {} }] };
  } } });
  class FakeRecorder {
    state = "inactive";
    mimeType = "audio/webm";
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.onstop?.(); }
  }
  window.MediaRecorder = FakeRecorder;
});
await page.route("**/api/voice/transcribe", async (route) => {
  await new Promise((r) => setTimeout(r, 400));
  await route.fulfill({ status: 503, json: { detail: "asr_unavailable_or_failed" } });
});
await page.route("**/api/voice/intent", async (route) => {
  const request = route.request().postDataJSON();
  if (request.text === "DELAY") await new Promise((r) => setTimeout(r, 500));
  const name = request.text === "DELAY" ? "A" : request.text;
  await route.fulfill({ json: { intent: { intent: "navigate_to_poi", destination_query: name, category: null, requires_clarification: false, constraints: [] }, candidates: [{ name, location: candidates[name] || candidates.A }] } });
});
await page.route("**/api/navigation/sessions", async (route) => {
  const request = route.request().postDataJSON();
  navigationRequests.push(request);
  assert.equal(request.require_safe_destination, true);
  const isA = request.destination.lat === candidates.A.lat;
  const isFail = request.destination.lat === candidates.FAIL.lat;
  await new Promise((r) => setTimeout(r, isA ? 550 : 50));
  if (isFail) return route.fulfill({ status: 422, json: { detail: { code: "destination_snap_too_far" } } });
  await route.fulfill({ status: 201, json: {
    session_id: isA ? "session-A" : "session-B",
    route: { geometry: [origin, request.destination], distance_m: 100, duration_s: 20, maneuvers: [], road_destination: request.destination, destination_snap_distance_m: 10 },
    state: { status: "ready", raw_location: null, matched_location: null, next_maneuver: null, remaining_distance_m: 100, off_route: false, progress: 0 },
  } });
});

try {
  await page.goto(process.env.VOICE_TEST_BASE_URL || "http://127.0.0.1:16173/", { waitUntil: "networkidle" });
  async function select(name) {
    await page.locator("#voice-text").fill(name);
    await page.locator("#voice-submit").click();
    await page.locator("#voice-candidates button").first().waitFor();
    await page.locator("#voice-candidates button").first().click();
  }
  await select("A");
  await page.locator("#voice-text").fill("changed");
  assert.equal(await page.locator("#voice-confirm").isDisabled(), true);
  assert.equal(await page.locator("#voice-candidates button").count(), 0);
  await select("A");
  await page.locator("#voice-record").click();
  assert.equal(await page.locator("#voice-confirm").isDisabled(), true);
  assert.equal(await page.locator("#voice-candidates button").count(), 0);
  await page.locator("#voice-cancel").click();
  assert.equal(navigationRequests.length, 0);

  await page.evaluate(() => { window.rejectMicrophone = true; });
  await page.locator("#voice-record").click();
  assert.match(await page.locator("#voice-status").textContent(), /权限未授权/);
  await page.evaluate(() => { window.rejectMicrophone = false; });

  await page.evaluate(() => { window.delayMicrophone = true; });
  await page.locator("#voice-record").click();
  await page.locator("#voice-cancel").click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#voice-status").textContent(), "已取消");
  await page.evaluate(() => { window.delayMicrophone = false; });

  await page.locator("#voice-record").click();
  await page.locator("#voice-record").click();
  await page.locator("#voice-cancel").click();
  await page.waitForTimeout(600);
  assert.equal(await page.locator("#voice-status").textContent(), "已取消");

  await page.locator("#voice-text").fill("DELAY");
  await page.locator("#voice-submit").click();
  await page.locator("#voice-cancel").click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator("#voice-candidates button").count(), 0);
  assert.equal(await page.locator("#voice-status").textContent(), "已取消");

  await select("A");
  await page.locator("#voice-confirm").click();
  await select("B");
  await page.locator("#voice-confirm").click();
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("offline-navigation-session")));
  assert.equal(saved.sessionId, "session-B");
  assert.equal(saved.safeDestinationRequired, true);

  await select("FAIL");
  await page.locator("#voice-confirm").click();
  await page.waitForTimeout(200);
  assert.match(await page.locator("#voice-status").textContent(), /过远/);
  const afterFailure = await page.evaluate(() => JSON.parse(sessionStorage.getItem("offline-navigation-session")));
  assert.equal(afterFailure.sessionId, "session-B");
  console.log("PASS: candidate invalidation, cancellation, reversed route responses, failed route rollback");
} finally {
  await browser.close();
}
