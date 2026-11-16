import { describe, expect, it } from "vitest";
import { analyzeUserIntent } from "../intent-parser";

describe("intent-parser", () => {
  it("accurately parses hunger / dining fuzzy queries", () => {
    const inputs = ["我饿了", "好饿啊", "想找点吃的", "晚上去吃火锅", "肚子好饿想吃饭"];
    for (const text of inputs) {
      const result = analyzeUserIntent(text);
      expect(result.intent, `failed for text: ${text}`).toBe("dining");
      expect(result.isFuzzyMatched).toBe(true);
      expect(result.searchKeywords).toContain("美食");
    }
  });

  it("accurately parses fatigue / coffee queries", () => {
    const inputs = ["我有点困了", "开车好困想买咖啡", "想喝杯奶茶提神"];
    for (const text of inputs) {
      const result = analyzeUserIntent(text);
      expect(result.intent).toBe("coffee_drink");
      expect(result.isFuzzyMatched).toBe(true);
      expect(result.searchKeywords).toContain("咖啡馆");
    }
  });

  it("accurately parses low battery / charging queries", () => {
    const inputs = ["车快没电了", "找个快充充电桩", "电量不足想充电"];
    for (const text of inputs) {
      const result = analyzeUserIntent(text);
      expect(result.intent).toBe("charging_station");
      expect(result.isFuzzyMatched).toBe(true);
      expect(result.searchKeywords).toContain("充电站");
    }
  });

  it("accurately parses urgent restroom queries", () => {
    const inputs = ["我想上厕所", "附近有洗手间吗", "人有三急"];
    for (const text of inputs) {
      const result = analyzeUserIntent(text);
      expect(result.intent).toBe("restroom");
      expect(result.isFuzzyMatched).toBe(true);
      expect(result.searchKeywords).toContain("公共厕所");
    }
  });

  it("falls back to direct keyword when specific place name is provided", () => {
    const result = analyzeUserIntent("珠海大剧院日月贝");
    expect(result.intent).toBe("direct_keyword");
    expect(result.isFuzzyMatched).toBe(false);
    expect(result.searchKeywords).toEqual(["珠海大剧院日月贝"]);
  });
});
