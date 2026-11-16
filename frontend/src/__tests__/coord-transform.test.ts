import { describe, expect, it } from "vitest";
import { gcj02ToWgs84, isOutOfChina, wgs84ToGcj02 } from "../coord-transform";

describe("coord-transform", () => {
  it("correctly identifies coordinates outside China", () => {
    // New York: lat ~40.7128, lon ~-74.0060
    expect(isOutOfChina(40.7128, -74.006)).toBe(true);
    // Zhuhai: lat ~22.37, lon ~113.58
    expect(isOutOfChina(22.37, 113.58)).toBe(false);
  });

  it("converts WGS-84 to GCJ-02 with typical China offset", () => {
    // Zhuhai reference point
    const wgs = { lat: 22.3718, lon: 113.5806 };
    const gcj = wgs84ToGcj02(wgs.lat, wgs.lon);

    // In southern China, GCJ-02 offset is typically a few hundred meters
    expect(gcj.lat).not.toEqual(wgs.lat);
    expect(gcj.lon).not.toEqual(wgs.lon);
    expect(Math.abs(gcj.lat - wgs.lat)).toBeLessThan(0.01);
    expect(Math.abs(gcj.lon - wgs.lon)).toBeLessThan(0.01);
  });

  it("round-trips WGS-84 -> GCJ-02 -> WGS-84 accurately", () => {
    const original = { lat: 22.3718, lon: 113.5806 };
    const gcj = wgs84ToGcj02(original.lat, original.lon);
    const recovered = gcj02ToWgs84(gcj.lat, gcj.lon);

    expect(recovered.lat).toBeCloseTo(original.lat, 6);
    expect(recovered.lon).toBeCloseTo(original.lon, 6);
  });

  it("leaves coordinates outside China unchanged", () => {
    const ny = { lat: 40.7128, lon: -74.006 };
    const converted = wgs84ToGcj02(ny.lat, ny.lon);
    expect(converted).toEqual(ny);

    const back = gcj02ToWgs84(ny.lat, ny.lon);
    expect(back).toEqual(ny);
  });
});
