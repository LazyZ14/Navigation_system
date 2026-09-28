import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("track selector", () => {
  it("defaults to current-route", () => {
    const html = readFileSync(resolve(__dirname, "../../index.html"), "utf-8");
    expect(html).toContain('value="current-route"');
    expect(html).toContain('selected>模拟当前路线</option>');
  });

  it("includes all three track options with clear labels", () => {
    const html = readFileSync(resolve(__dirname, "../../index.html"), "utf-8");
    expect(html).toContain('value="current-route"');
    expect(html).toContain('value="normal-route"');
    expect(html).toContain('value="off-route"');
    expect(html).toContain("模拟当前路线");
    expect(html).toContain("回归测试：正常轨迹");
    expect(html).toContain("回归测试：偏航轨迹");
  });
});
