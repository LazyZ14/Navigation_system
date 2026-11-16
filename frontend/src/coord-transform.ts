/**
 * 坐标系转换工具模块 (Coordinate Transformation)
 * 遵循项目 AGENTS.md 约束：
 * 内部标准坐标系为 WGS-84，引入高德时必须在边界层与 GCJ-02 进行明确转换。
 */

const PI = Math.PI;
const A = 6378245.0; // 椭球长半轴
const EE = 0.00669342162296594323; // 第一偏心率平方

/**
 * 判断经纬度是否在中国境外
 */
export function isOutOfChina(lat: number, lon: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320.0 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLon(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

/**
 * WGS-84 (GPS标准) 转换为 GCJ-02 (高德/火星坐标系)
 */
export function wgs84ToGcj02(lat: number, lon: number): { lat: number; lon: number } {
  if (isOutOfChina(lat, lon)) {
    return { lat, lon };
  }
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return {
    lat: lat + dLat,
    lon: lon + dLon,
  };
}

/**
 * GCJ-02 (高德/火星坐标系) 转换为 WGS-84 (GPS标准)
 * 采用迭代逼近算法，精度达到米级以内
 */
export function gcj02ToWgs84(lat: number, lon: number): { lat: number; lon: number } {
  if (isOutOfChina(lat, lon)) {
    return { lat, lon };
  }
  let wgsLat = lat;
  let wgsLon = lon;
  for (let i = 0; i < 4; i++) {
    const gcj = wgs84ToGcj02(wgsLat, wgsLon);
    const dLat = gcj.lat - lat;
    const dLon = gcj.lon - lon;
    wgsLat -= dLat;
    wgsLon -= dLon;
  }
  return {
    lat: wgsLat,
    lon: wgsLon,
  };
}
