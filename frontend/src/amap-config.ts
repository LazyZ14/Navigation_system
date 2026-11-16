/**
 * 高德地图配置与动态加载器
 */

const STORAGE_KEY_AMAP_KEY = "amap_user_key";
const STORAGE_KEY_AMAP_SECURITY = "amap_security_key";

// 用户在控制台创建的 Web端(JS API) 凭证
export const DEFAULT_AMAP_KEY = "b55f0d144d7998ee89c145ef36f7379a";
export const DEFAULT_AMAP_SECURITY_KEY = "b806aa15cb03f8cac7e0843f56321acb";

export function getAmapCredentials(): { key: string; securityKey: string } {
  const key = localStorage.getItem(STORAGE_KEY_AMAP_KEY) || DEFAULT_AMAP_KEY;
  const securityKey = localStorage.getItem(STORAGE_KEY_AMAP_SECURITY) || DEFAULT_AMAP_SECURITY_KEY;
  return { key, securityKey };
}

export function saveAmapCredentials(key: string, securityKey: string): void {
  localStorage.setItem(STORAGE_KEY_AMAP_KEY, key.trim());
  localStorage.setItem(STORAGE_KEY_AMAP_SECURITY, securityKey.trim());
}

declare global {
  interface Window {
    _AMapSecurityConfig?: {
      securityJsCode?: string;
    };
    AMap?: any;
  }
}

/**
 * 动态加载高德 JS API v2.0 及核心导航与定位插件
 */
export function loadAmapSdk(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (window.AMap) {
      resolve(window.AMap);
      return;
    }

    const { key, securityKey } = getAmapCredentials();

    // 高德 2.0 强制安全密钥必须在引入前设置
    window._AMapSecurityConfig = {
      securityJsCode: securityKey,
    };

    const script = document.createElement("script");
    script.type = "text/javascript";
    const plugins = ["AMap.Geolocation", "AMap.Driving", "AMap.ToolBar", "AMap.Scale", "AMap.MoveAnimation"].join(",");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${key}&plugin=${plugins}`;
    script.async = true;

    script.onload = () => {
      if (window.AMap) {
        resolve(window.AMap);
      } else {
        reject(new Error("高德地图 SDK 加载异常，window.AMap 不存在"));
      }
    };

    script.onerror = (e) => {
      reject(new Error("加载高德地图 JS API 失败，请检查网络或 Key 权限配置"));
    };

    document.head.appendChild(script);
  });
}
