import { AMAP_JS_VERSION, AMAP_JS_VERSION_IOS_APP, AMAP_PLUGIN, TRAFFIC_COLORS } from "./constants.js";

export function detectIOSAppWebView() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isIOSApp = isIOS && /HomeAssistant/i.test(navigator.userAgent);
  return { isIOS, isIOSApp };
}

export function pickAmapJsVersion() {
  const { isIOSApp } = detectIOSAppWebView();
  return isIOSApp ? AMAP_JS_VERSION_IOS_APP : AMAP_JS_VERSION;
}

export function loadAmapScript(key, version = AMAP_JS_VERSION) {
  return new Promise((resolve, reject) => {
    if (window.AMap) { resolve(window.AMap); return; }
    if (!key) {
      reject(new Error("未配置高德 JS API Key"));
      return;
    }
    const scriptId = "__amap_js_sdk__";
    const existing = document.getElementById(scriptId);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.AMap));
      existing.addEventListener("error", () => reject(new Error("高德地图脚本加载失败，请检查 JS Key 与域名/IP 白名单")));
      return;
    }
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = `https://webapi.amap.com/maps?v=${version}&key=${key}&plugin=${AMAP_PLUGIN}`;
    script.onload = () => resolve(window.AMap);
    script.onerror = () => reject(new Error("高德地图脚本加载失败，请检查 JS Key 与域名/IP 白名单"));
    document.head.appendChild(script);
  });
}

export function formatMinutes(minutes) {
  if (minutes == null) return "--";
  const m = Math.round(minutes);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h${rem}m` : `${h} 小时`;
}

export function formatTime(isoStr) {
  const d = new Date(isoStr);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function getTrafficSummary(tmcs) {
  if (!tmcs || !tmcs.length) return { label: "未知", color: "#9E9E9E" };
  for (const p of ["严重拥堵", "拥堵", "缓行", "畅通", "未知"]) {
    if (tmcs.some((t) => t.status === p)) {
      return { label: p, color: TRAFFIC_COLORS[p] || "#9E9E9E" };
    }
  }
  return { label: "未知", color: "#9E9E9E" };
}
