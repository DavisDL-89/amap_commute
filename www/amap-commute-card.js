/**
 * 高德通勤时间卡片 - Lovelace Custom Card  v1.7.7
 *
 * 交互功能：
 * - 点击通勤时间   → 今日历史通勤折线图
 * - 点击距离/红绿灯 → 行车路线详情（多路径切换 + 地图缩放）
 *
 * 卡片配置：
 * type: custom:amap-commute-card
 * entity: sensor.xxx
 * amap_web_key: 你的高德JS-API-Key
 * title: 今日通勤
 *
 * v1.7.7 更新：
 * - ✅ iOS HA App 主卡片地图灰底：在地图创建前强制设置像素尺寸 + 双重 layout 等待 + 强制重排，解决 Shadow DOM 百分比尺寸在 WebView 中计算错误的问题
 * v1.7.6 更新：
 * - ✅ 路线弹窗首次打开：弹层动画后 waitLayoutStable + ResizeObserver + 延迟 getSize/setFitView(路线)，修复地图右侧/底部灰边
 * v1.7.4 更新：
 * - ✅ 历史/路线弹窗：样式注入 document（acp-*），与卡片 ha-card 风格一致（Shadow 内样式原先无法作用到 body）
 * - ✅ 历史统计：图标 + 数值 + 标签三行；平均/最快/最慢统一一位小数；最快=最小、最慢=最大
 * - ✅ 路线「推荐」Tab：安全 closest + data-idx，切换线路不关闭弹窗
 * v1.7.3 更新：
 * - ✅ 历史/路线弹层改为挂到 document.body 全屏 fixed，与 HA 整体弹层一致（不再局限在卡片内）
 * - ✅ 配置流「设备/人员」出发地：兼容 EntitySelector 返回列表，避免校验与 API 测试解析出错
 * v1.7.1 更新：
 * - ✅ 路线 Tab 点击：遮罩仅点背景关闭 + panel stopPropagation + type=button，避免弹窗误关
 * v1.5.1 更新：
 * - ✅ buildAmapMapOptions 统一地图构造参数；非 iOS 手机端也用 scheduleMapResizeRefresh
 * v1.5.0 更新（HA 前端 / iOS App 兼容性）：
 * - ✅ set hass 前校验 _config：避免 hass 早于 setConfig 时抛错导致整页崩溃
 * - ✅ setConfig 不再 throw：错误配置改为卡片内提示，不阻断 Lovelace
 * - ✅ 移除 ?. / ??：兼容较旧 WKWebView（无可选链时整段脚本无法解析）
 * - ✅ 改进 iOS / iPadOS 检测（含 MacIntel + 触摸）
 * - ✅ customElements 防重复注册；高德脚本单例加载、key 转义
 *
 * v1.4.4 更新（Home Assistant 2026.2.1 iOS App 专项修复）：
 * - ✅ 增强 iOS App WebView 检测（识别 HomeAssistant UA）
 * - ✅ 使用 getBoundingClientRect 获取精确容器尺寸
 * - ✅ 添加 translateZ(0) 强制 GPU 加速渲染
 * - ✅ 增加初始化前延迟确保 DOM 完全就绪
 * - ✅ 更频繁的地图刷新策略（6次刷新）
 * - ✅ 强制重绘机制解决白屏问题
 * - ✅ 移除路况色条间隔 gap
 *
 * v1.4.3 更新：
 * - ✅ 修复 iOS App WebView 地图不显示问题
 * - ✅ 添加 iOS WebView 专用容器修复
 * - ✅ 强制设置容器尺寸（px 单位）
 * - ✅ 多次刷新地图尺寸确保正确显示
 * - ✅ 添加 iOS 特定检测和优化
 *
 * v1.4.2 更新：
 * - ✅ 修复手机端地图不显示问题
 * - ✅ 移除导致地图底图缺失的 features 配置
 * - ✅ 添加详细的调试日志
 * - ✅ 优化地图初始化时序
 *
 * v1.4.1 更新：
 * - ✅ 优化手机端地图显示
 * - ✅ 添加响应式布局
 * - ✅ 优化触摸事件处理
 * - ✅ 精简移动端地图要素
 */

const AMAP_JS_VERSION = "2.0";
const AMAP_PLUGIN = "AMap.Driving,AMap.Polyline,AMap.ToolBar";

const TRAFFIC_COLORS = {
  畅通: "#00C851",
  缓行: "#FF8800",
  拥堵: "#FF4444",
  严重拥堵: "#CC0000",
  未知: "#9E9E9E",
};

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 高德脚本只加载一次；多卡片实例共享同一 Promise（成功后常驻 resolved） */
let _amapLoadOnce = null;

function loadAmapScript(key) {
  if (window.AMap) {
    return Promise.resolve(window.AMap);
  }
  if (_amapLoadOnce) {
    return _amapLoadOnce;
  }
  _amapLoadOnce = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src =
      "https://webapi.amap.com/maps?v=" +
      AMAP_JS_VERSION +
      "&key=" +
      encodeURIComponent(key) +
      "&plugin=" +
      AMAP_PLUGIN;
    script.onload = () => {
      resolve(window.AMap);
    };
    script.onerror = () => {
      _amapLoadOnce = null;
      reject(new Error("高德地图脚本加载失败"));
    };
    document.head.appendChild(script);
  });
  return _amapLoadOnce;
}

/** iPhone / iPod / iPad（含 iPadOS 桌面 UA） */
function isIOSLikeDevice() {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return false;
}

/** Home Assistant iOS / Android 伴侣 App 的 WebView */
function isHomeAssistantCompanionApp() {
  const ua = navigator.userAgent || "";
  return /HomeAssistant|io\.robbie\.HomeAssistant/i.test(ua);
}

function isMobileUserAgent() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent || ""
  );
}

/**
 * 弹窗/动画后布局未稳定时，等两帧 + 一次 macrotask 再量宽高，减少高德首次画布尺寸偏小（右侧/底部灰边）。
 */
function waitLayoutStable() {
  return new Promise(function (resolve) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        setTimeout(resolve, 0);
      });
    });
  });
}

/**
 * 多次触发 getSize + 重新 fit 路线，兼容弹窗入场动画与首次测量偏小。
 * @param {number[]} delaysMs
 * @param {function():void} [fitViewCallback] 传入则用其做视野适配（含路线 overlays）；否则 map.setFitView()
 */
function scheduleMapResizeRefresh(map, container, delaysMs, fitViewCallback) {
  if (!map || !container || !delaysMs || !delaysMs.length) return;
  delaysMs.forEach((delay, idx) => {
    setTimeout(() => {
      try {
        if (!map || !container) return;
        map.getSize();
        if (typeof fitViewCallback === "function") {
          fitViewCallback();
        } else {
          map.setFitView();
        }
        container.style.opacity = "0.99";
        setTimeout(() => {
          container.style.opacity = "1";
        }, 50);
      } catch (e) {
        console.warn("[AmapCommuteCard] map resize refresh failed", idx, e);
      }
    }, delay);
  });
}

/**
 * 主图 / 详情图共用的高德 Map 选项。
 * 不设置 features，避免部分移动 WebView 无底图（见项目 MOBILE_MAP_FIX 说明）。
 */
function buildAmapMapOptions(center, isMobile) {
  return {
    zoom: 12,
    center: center,
    mapStyle: "amap://styles/normal",
    resizeEnable: true,
    viewMode: "2D",
    zoomEnable: true,
    dragEnable: true,
    doubleClickZoom: true,
    scrollWheel: !isMobile,
    touchZoom: isMobile,
    rotateEnable: false,
    pitchEnable: false,
  };
}

function formatMinutes(minutes) {
  if (minutes == null) return "--";
  const m = Math.round(minutes);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h${rem}m` : `${h} 小时`;
}

/** 历史统计：分钟值保留一位小数 */
function formatMinutesOneDecimal(minutes) {
  if (minutes == null || typeof minutes !== "number" || isNaN(minutes)) return "--";
  return (Math.round(minutes * 10) / 10).toFixed(1);
}

/** 弹窗内点击「推荐」等：兼容 Text 节点，避免 closest 报错导致整段逻辑失败 */
function acpClosestRouteTab(target) {
  let el = target;
  if (el && el.nodeType === 3) el = el.parentElement;
  if (!el || !el.closest) return null;
  return el.closest(".acp-route-tab");
}

function formatTime(isoStr) {
  const d = new Date(isoStr);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function getTrafficSummary(tmcs) {
  if (!tmcs || !tmcs.length) return { label: "未知", color: "#9E9E9E" };
  for (const p of ["严重拥堵","拥堵","缓行","畅通","未知"]) {
    if (tmcs.some(t => t.status === p))
      return { label: p, color: TRAFFIC_COLORS[p] || "#9E9E9E" };
  }
  return { label: "未知", color: "#9E9E9E" };
}

// SVG 纯前端折线图
function drawHistoryChart(container, points) {
  if (!points || !points.length) {
    container.innerHTML = `<div style="text-align:center;padding:30px;color:#bbb;font-size:13px;">暂无今日历史数据</div>`;
    return;
  }
  const W = container.clientWidth || 320;
  const H = 150, pL = 42, pR = 16, pT = 16, pB = 32;
  const cW = W - pL - pR, cH = H - pT - pB;
  const vals = points.map(p => p.value);
  const minV = Math.max(0, Math.min(...vals) - 8);
  const maxV = Math.max(...vals) + 8;
  const range = maxV - minV || 1;
  const toX = i => pL + (i / Math.max(points.length - 1, 1)) * cW;
  const toY = v => pT + cH - ((v - minV) / range) * cH;
  const line = points.map((p,i) => `${i===0?"M":"L"}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`).join(" ");
  const fill = `${line} L${toX(points.length-1).toFixed(1)},${(pT+cH).toFixed(1)} L${pL},${(pT+cH).toFixed(1)} Z`;
  const yTicks = [minV, Math.round((minV+maxV)/2), maxV].map(v => {
    const y = toY(v);
    return `<line x1="${pL}" y1="${y.toFixed(1)}" x2="${W-pR}" y2="${y.toFixed(1)}" stroke="#eee" stroke-width="1"/>
            <text x="${pL-5}" y="${(y+4).toFixed(1)}" text-anchor="end" font-size="10" fill="#bbb">${Math.round(v)}</text>`;
  }).join("");
  const step = Math.max(1, Math.floor(points.length / 5));
  const xLabels = points.filter((_,i) => i % step === 0 || i === points.length-1).map(p => {
    const idx = points.indexOf(p);
    return `<text x="${toX(idx).toFixed(1)}" y="${H-4}" text-anchor="middle" font-size="9" fill="#bbb">${p.time}</text>`;
  }).join("");
  const dots = points.map((p,i) =>
    `<circle cx="${toX(i).toFixed(1)}" cy="${toY(p.value).toFixed(1)}" r="4" fill="${p.color||'#2196F3'}" stroke="#fff" stroke-width="2"><title>${p.time}: ${Math.round(p.value)}分钟</title></circle>`
  ).join("");
  container.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">
      <defs><linearGradient id="cg${W}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#2196F3" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#2196F3" stop-opacity="0.02"/>
      </linearGradient></defs>
      ${yTicks}
      <line x1="${pL}" y1="${pT}" x2="${pL}" y2="${pT+cH}" stroke="#ddd" stroke-width="1"/>
      <path d="${fill}" fill="url(#cg${W})"/>
      <path d="${line}" fill="none" stroke="#2196F3" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}${xLabels}
    </svg>`;
}

// ─── 全局浮层（挂到 document.body，与 HA 全屏弹层同级体验）────────────────────

class CardPopover {
  /**
   * @param {ShadowRoot} _root  — 保留参数以兼容旧调用（不再用于挂载）
   * @param {HTMLElement} _cardEl — 保留参数以兼容旧调用（不再用于挂载）
   */
  constructor(_root, _cardEl) {
    this._el = null;
    this._onKeyDown = null;
    this._injectStyles();
  }

  _injectStyles() {
    if (document.getElementById("_amap_commute_popover_styles")) return;
    const s = document.createElement("style");
    s.id = "_amap_commute_popover_styles";
    /* 弹窗内容挂在 document.body，须在此定义样式（Shadow 内样式无法作用到 body） */
    s.textContent = `
      @keyframes _acpIn  { from{opacity:0;transform:scale(.96)} to{opacity:1;transform:scale(1)} }
      @keyframes _acpOut { to{opacity:0;transform:scale(.96)} }
      .acp-stat-row{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap}
      .acp-stat-tile{
        flex:1;min-width:72px;text-align:center;padding:10px 8px;
        background:var(--secondary-background-color,rgba(0,0,0,.04));
        border-radius:var(--ha-card-border-radius,12px);
        border:1px solid var(--divider-color,rgba(0,0,0,.06));
        box-sizing:border-box;
      }
      .acp-stat-ico{
        font-size:20px;line-height:1;margin-bottom:6px;opacity:.92;
        color:var(--primary-color,#2196F3);
      }
      .acp-stat-val{font-size:17px;font-weight:700;color:var(--primary-text-color,#222);line-height:1.2}
      .acp-stat-val.acp-accent{color:var(--primary-color,#2196F3)}
      .acp-stat-val.acp-good{color:#00C851}
      .acp-stat-val.acp-bad{color:#FF4444}
      .acp-stat-lbl{font-size:11px;color:var(--secondary-text-color,#888);margin-top:6px}
      .acp-sec-title{
        font-size:12px;font-weight:600;color:var(--primary-text-color,#555);
        margin:14px 0 8px;
      }
      .acp-route-tabs{display:flex;gap:8px;margin-bottom:14px;overflow-x:auto;padding-bottom:2px;-webkit-overflow-scrolling:touch}
      .acp-route-tab{
        flex:0 0 auto;appearance:none;-webkit-appearance:none;
        margin:0;padding:8px 14px;border-radius:999px;font-size:12px;font-weight:600;
        border:1px solid var(--divider-color,#ddd);
        background:var(--ha-card-background,var(--card-background-color,#fff));
        color:var(--secondary-text-color,#666);cursor:pointer;
        white-space:nowrap;transition:background .15s,border-color .15s,color .15s;
        font-family:inherit;text-align:center;line-height:1.35;
      }
      .acp-route-tab:hover{border-color:var(--primary-color,#2196F3);color:var(--primary-text-color,#333)}
      .acp-route-tab.acp-active{
        border-color:var(--primary-color,#2196F3);
        background:var(--primary-color,#2196F3);color:#fff;
      }
      .acp-route-tab .acp-tab-sub{font-size:10px;font-weight:500;opacity:.9;display:block;margin-top:2px}
      .acp-route-tab.acp-active .acp-tab-sub{opacity:.95}
      .acp-traffic-bar{height:10px;border-radius:5px;overflow:hidden;display:flex;margin-bottom:8px}
      .acp-traffic-bar-seg{height:100%}
      .acp-traffic-legend{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:4px}
      .acp-tleg-item{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--secondary-text-color,#666)}
      .acp-tleg-dot{width:10px;height:10px;border-radius:2px;flex-shrink:0}
      .acp-detail-map-wrap{
        position:relative;width:100%;height:220px;border-radius:var(--ha-card-border-radius,12px);
        overflow:hidden;background:#e8edf2;margin-bottom:4px;touch-action:none;
      }
      .acp-detail-map-inner{width:100%;height:100%;display:block;position:absolute;top:0;left:0;z-index:1}
      .acp-detail-zoom-btns{position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:4px;z-index:10}
      .acp-zoom-btn{
        width:30px;height:30px;border-radius:6px;border:none;cursor:pointer;
        background:rgba(255,255,255,.92);color:#444;font-size:18px;line-height:1;
        box-shadow:0 1px 4px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;
      }
      .acp-step-list{list-style:none;margin:0;padding:0}
      .acp-step-item{
        display:flex;align-items:flex-start;gap:10px;padding:10px 0;
        border-bottom:1px solid var(--divider-color,#f0f0f0);
        font-size:13px;color:var(--primary-text-color,#333);line-height:1.5;
      }
      .acp-step-item:last-child{border-bottom:none}
      .acp-step-num{
        flex-shrink:0;width:22px;height:22px;border-radius:50%;
        background:var(--primary-color,#2196F3);color:#fff;
        font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;
      }
      .acp-step-road{font-weight:600;color:var(--primary-text-color,#111);margin-bottom:2px}
      .acp-step-sub{font-size:12px;color:var(--secondary-text-color,#888)}
      .acp-history-hint{text-align:center;font-size:12px;color:var(--secondary-text-color,#999);margin-bottom:12px}
      @media (max-width:768px){.acp-detail-map-wrap{height:180px}}
      @media (max-width:480px){.acp-detail-map-wrap{height:160px}}
    `;
    document.head.appendChild(s);
  }

  open(titleHtml, contentFn) {
    this.close();

    const shell = document.createElement("div");
    shell.setAttribute("data-amap-commute-popover", "1");
    shell.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:100002",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:16px",
      "box-sizing:border-box",
      "pointer-events:auto",
    ].join(";");

    const overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:absolute",
      "inset:0",
      "background:rgba(0,0,0,0.45)",
      "backdrop-filter:saturate(1.1)",
    ].join(";");

    const panel = document.createElement("div");
    panel.style.cssText = [
      "position:relative",
      "width:min(560px,calc(100vw - 32px))",
      "max-height:min(88vh,900px)",
      "background:var(--ha-card-background,var(--card-background-color,#fff))",
      "border-radius:14px",
      "box-shadow:0 12px 40px rgba(0,0,0,0.28)",
      "display:flex",
      "flex-direction:column",
      "z-index:1",
      "animation:_acpIn .2s cubic-bezier(.34,1.1,.64,1)",
      "overflow:hidden",
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = [
      "padding:12px 14px 11px",
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "border-bottom:1px solid var(--divider-color,#f0f0f0)",
      "flex-shrink:0",
    ].join(";");
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:var(--primary-text-color,#222);">
        <div style="width:4px;height:18px;background:var(--primary-color,#2196F3);border-radius:2px;flex-shrink:0;"></div>
        <div>${titleHtml}</div>
      </div>
      <button type="button" data-close style="
        background:var(--secondary-background-color,#f5f5f5);
        border:none;cursor:pointer;
        width:28px;height:28px;border-radius:50%;
        color:var(--secondary-text-color,#888);
        font-size:16px;line-height:1;
        display:flex;align-items:center;justify-content:center;
        flex-shrink:0;transition:background .12s;
      ">✕</button>
    `;

    const body = document.createElement("div");
    body.style.cssText =
      "flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:12px 14px 20px;";

    panel.appendChild(header);
    panel.appendChild(body);

    shell.appendChild(overlay);
    shell.appendChild(panel);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.appendChild(shell);

    const close = () => this.close();

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    panel.addEventListener("click", (e) => e.stopPropagation());
    const closeBtn = header.querySelector("[data-close]");
    if (closeBtn) closeBtn.addEventListener("click", close);

    this._onKeyDown = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", this._onKeyDown);

    this._el = { shell, overlay, panel, prevOverflow };

    contentFn(body);
  }

  close() {
    if (!this._el) return;
    const { shell, panel, prevOverflow } = this._el;
    if (this._onKeyDown) {
      document.removeEventListener("keydown", this._onKeyDown);
      this._onKeyDown = null;
    }
    document.body.style.overflow = prevOverflow || "";
    panel.style.animation = "_acpOut .18s ease forwards";
    setTimeout(() => {
      if (shell && shell.parentNode) shell.parentNode.removeChild(shell);
    }, 190);
    this._el = null;
  }
}

// ─── 地图工具函数 ────────────────────────────────────────────────────────────

function buildMapOverlays(AMap, map, attrs) {
  const polylines = [], markers = [];
  const tmcs = attrs.tmcs || [];
  if (tmcs.length > 0) {
    tmcs.forEach(tmc => {
      const pts = (tmc.polyline || []).map(p => new AMap.LngLat(p[0], p[1]));
      if (pts.length < 2) return;
      polylines.push(new AMap.Polyline({
        path: pts, strokeColor: tmc.color || "#9E9E9E",
        strokeWeight: 6, strokeOpacity: 0.9,
        lineJoin: "round", lineCap: "round", zIndex: 50,
      }));
    });
  } else if ((attrs.polyline || []).length > 0) {
    polylines.push(new AMap.Polyline({
      path: attrs.polyline.map(p => new AMap.LngLat(p[0], p[1])),
      strokeColor: "#2196F3", strokeWeight: 6, strokeOpacity: 0.85,
      lineJoin: "round", lineCap: "round", zIndex: 50,
    }));
  }
  [
    [attrs.origin,      attrs.origin_name || "出发地",  "https://webapi.amap.com/theme/v1.3/markers/n/start.png"],
    [attrs.destination, attrs.destination_name || "目的地", "https://webapi.amap.com/theme/v1.3/markers/n/end.png"],
  ].forEach(([coord, title, img]) => {
    if (!coord) return;
    const [lng, lat] = String(coord).split(",").map(Number);
    if (isNaN(lng) || isNaN(lat)) return;
    markers.push(new AMap.Marker({
      position: new AMap.LngLat(lng, lat), title,
      icon: new AMap.Icon({ size: new AMap.Size(25,34), imageSize: new AMap.Size(25,34), image: img }),
      offset: new AMap.Pixel(-12, -34), zIndex: 100,
    }));
  });
  map.add([...polylines, ...markers]);
  if (polylines.length || markers.length)
    map.setFitView([...polylines, ...markers], false, [24,24,24,24]);
  return { polylines, markers };
}

function clearMapOverlays(map, polylines, markers) {
  map.remove([...polylines, ...markers]);
}

// ─── 卡片主类 ────────────────────────────────────────────────────────────────

class AmapCommuteCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._map = null;
    this._mapInited = false;
    this._polylines = [];
    this._markers = [];
    this._lastRouteHash = null;
    this._currentAttrs = null;
    this._currentEntity = null;
    this._sheet = null; // 在 _render() 后初始化（需要 .card DOM 元素）
    // 详情弹层地图实例
    this._detailMap = null;
    this._detailPolylines = [];
    this._detailMarkers = [];
    /** @type {ResizeObserver|null} */
    this._detailMapResizeObserver = null;
    /** @type {ResizeObserver|null} */
    this._mainMapResizeObserver = null;
  }

  disconnectedCallback() {
    if (this._mainMapResizeObserver) {
      try {
        this._mainMapResizeObserver.disconnect();
      } catch (_) {}
      this._mainMapResizeObserver = null;
    }
    if (this._detailMapResizeObserver) {
      try {
        this._detailMapResizeObserver.disconnect();
      } catch (_) {}
      this._detailMapResizeObserver = null;
    }
    if (this._map) {
      try {
        this._map.destroy();
      } catch (_) {}
      this._map = null;
    }
    this._mapInited = false;
  }

  setConfig(config) {
    this._config = config || {};
    if (!config || !config.entity || !config.amap_web_key) {
      this._renderConfigError(
        "高德通勤卡片：请在卡片编辑器中填写 entity 与 amap_web_key。"
      );
      return;
    }
    this._render();
  }

  /**
   * 配置不完整时渲染提示（避免 throw 导致 Lovelace 整页加载失败）。
   */
  _renderConfigError(message) {
    this.shadowRoot.innerHTML =
      "<style>" +
      ":host{display:block;font-family:var(--primary-font-family,sans-serif);}" +
      ".cc-err{padding:20px 16px;font-size:14px;line-height:1.45;color:var(--error-color,#c62828);" +
      "background:var(--ha-card-background,var(--card-background-color,#fff));border-radius:12px;}" +
      "</style>" +
      '<div class="cc-err"></div>';
    const box = this.shadowRoot.querySelector(".cc-err");
    if (box) {
      box.textContent = message;
    }
  }

  set hass(hass) {
    this._hass = hass;
    // HA 前端可能先于 setConfig 设置 hass；配置不完整时勿访问 entity
    if (!hass || !this._config || !this._config.entity || !this._config.amap_web_key) {
      return;
    }
    const entity = hass.states[this._config.entity];
    if (!entity) return;
    const attrs = entity.attributes || {};
    this._currentAttrs = attrs;
    this._currentEntity = entity;

    // 根据当前 entity 的 route_index 选择路线数据
    const currentRoute = this._getCurrentRouteData();
    this._updateInfo(entity, currentRoute);

    // 延迟初始化地图：iOS App WebView 需等布局稳定后再量宽高，否则底图瓦片不加载（仅灰底+折线）
    if (!this._mapInited && (currentRoute.polyline || []).length > 0) {
      const isIOSLike = isIOSLikeDevice();
      const isIOSApp = isIOSLike && isHomeAssistantCompanionApp();
      const run = () => this._initMap(currentRoute);
      if (isIOSApp) {
        waitLayoutStable().then(() => setTimeout(run, 280));
      } else if (isIOSLike) {
        waitLayoutStable().then(() => setTimeout(run, 120));
      } else {
        setTimeout(run, 100);
      }
    } else if (this._mapInited) {
      this._updateMapRoute(currentRoute);
    }
  }

  // ── 骨架渲染 ──────────────────────────────────────────────────────────────

  _render() {
    const cfg = this._config;
    const mapId = `amap-${cfg.entity.replace(/\./g, "_")}`;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; font-family:var(--primary-font-family,sans-serif); }

        /* 移动端响应式优化 */
        @media (max-width: 768px) {
          .map-container { height:200px; }
          .duration-badge { font-size:17px; padding:4px 12px; }
          .meta-item { font-size:11px; padding:2px 7px; }
          .location-name { font-size:12px; max-width:70px; }
          .zoom-btn { width:32px;height:32px; }
        }

        @media (max-width: 480px) {
          .map-container { height:180px; }
          .duration-badge { font-size:16px; padding:3px 10px; }
          .route-info { padding:6px 12px 12px; }
          .card-header { padding:12px 14px 6px; font-size:13px; }
        }

        .card {
          background:var(--ha-card-background,var(--card-background-color,#fff));
          border-radius:var(--ha-card-border-radius,12px);
          box-shadow:var(--ha-card-box-shadow,0 2px 8px rgba(0,0,0,.1));
          overflow:hidden;
        }
        .card-header {
          padding:14px 16px 8px;
          font-size:14px;
          font-weight:600;
          color:var(--secondary-text-color);
          letter-spacing:.04em;
          display:flex;
          align-items:center;
          gap:6px;
        }
        .card-header ha-icon { --mdc-icon-size:18px; color:var(--primary-color); }
        .route-info {
          padding:8px 16px 14px;
          display:flex;
          align-items:center;
          min-height:60px;
        }
        .location {
          display:flex; flex-direction:column; align-items:center;
          flex:0 0 auto; min-width:68px; max-width:96px;
        }
        .location-dot { width:10px;height:10px;border-radius:50%;margin-bottom:4px; }
        .location-dot.origin { background:#4CAF50; }
        .location-dot.dest   { background:#F44336; }
        .location-name {
          font-size:13px;font-weight:600;color:var(--primary-text-color);
          text-align:center;max-width:90px;overflow:hidden;
          text-overflow:ellipsis;white-space:nowrap;
        }
        .route-middle {
          flex:1;display:flex;flex-direction:column;align-items:center;padding:0 8px;
        }
        .clickable {
          cursor:pointer;user-select:none;
          -webkit-tap-highlight-color:transparent;
          transition:transform .12s,opacity .12s,filter .12s;
        }
        .clickable:hover  { filter:brightness(1.1); }
        .clickable:active { transform:scale(.93);opacity:.7; }
        .duration-badge {
          background:var(--primary-color,#2196F3);color:#fff;
          border-radius:20px;padding:5px 16px;
          font-size:19px;font-weight:700;white-space:nowrap;
          box-shadow:0 2px 8px rgba(33,150,243,.3);margin-bottom:7px;
          position:relative;
        }
        .duration-badge::after {
          content:'📈';position:absolute;right:-2px;top:-8px;font-size:11px;opacity:.7;
        }
        .route-meta {
          display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;
        }
        .meta-item {
          display:inline-flex;align-items:center;gap:3px;
          border-radius:6px;padding:3px 9px;
          border:1px solid var(--divider-color,#e8e8e8);
          background:var(--secondary-background-color,#f9f9f9);
          font-size:12px;color:var(--secondary-text-color);
        }
        .meta-item:hover { border-color:var(--primary-color,#2196F3);background:#e8f0fe; }
        .traffic-badge {
          border-radius:4px;padding:2px 8px;
          font-size:12px;font-weight:600;color:#fff;
        }
        /* 主地图 - 优化手机端显示 */
        .map-container {
          position:relative;
          width:100%;
          height:240px;
          background:#e8edf2;
          overflow:hidden;
          touch-action:none;
        }
        #${mapId} {
          width:100%;
          height:100%;
          display:block;
          position:absolute;
          top:0;
          left:0;
          z-index:1;
        }
        .map-loading {
          position:absolute;
          inset:0;
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:13px;
          color:var(--secondary-text-color);
          background:#f5f5f5;
          z-index:10;
        }
        /* 缩放按钮（主地图右上角） */
        .zoom-btns {
          position:absolute;right:10px;top:10px;
          display:flex;flex-direction:column;gap:4px;z-index:10;
        }
        .zoom-btn {
          width:30px;height:30px;border-radius:6px;border:none;cursor:pointer;
          background:rgba(255,255,255,.92);color:#444;font-size:18px;line-height:1;
          box-shadow:0 1px 4px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;
          transition:background .12s;
        }
        .zoom-btn:hover { background:#fff; }
        /* 图例 */
        .legend {
          display:flex;gap:8px;padding:6px 14px 10px;flex-wrap:wrap;
          border-top:1px solid var(--divider-color,#eee);
          justify-content:flex-end;
        }
        .legend-item { display:flex;align-items:center;gap:4px;font-size:11px;color:var(--secondary-text-color); }
        .legend-dot  { width:10px;height:10px;border-radius:2px; }
        .unavailable { padding:20px;text-align:center;color:var(--secondary-text-color);font-size:14px; }

      </style>
      <ha-card class="card">
        <div class="card-header">
          <ha-icon icon="mdi:map-marker-path"></ha-icon>
          <span>${cfg.title || "通勤时间"}</span>
        </div>
        <div class="route-info" id="route-info">
          <div class="unavailable">正在加载数据…</div>
        </div>
        <div class="map-container">
          <div id="${mapId}" style="width:100%;height:100%;"></div>
          <div class="map-loading" id="map-loading">地图加载中…</div>
          <div class="zoom-btns" id="main-zoom-btns" style="display:none;">
            <button type="button" class="zoom-btn" id="main-zoom-in"  title="放大">＋</button>
            <button type="button" class="zoom-btn" id="main-zoom-out" title="缩小">－</button>
          </div>
        </div>
        <div class="legend">
          ${Object.entries(TRAFFIC_COLORS).map(([l,c]) =>
            `<div class="legend-item"><div class="legend-dot" style="background:${c}"></div><span>${l}</span></div>`
          ).join("")}
        </div>
      </ha-card>
    `;
    // 卡片 DOM 就绪后初始化浮层控制器
    const cardEl = this.shadowRoot.querySelector(".card");
    this._sheet = new CardPopover(this.shadowRoot, cardEl);
  }

  // ── 信息区 ────────────────────────────────────────────────────────────────

  _updateInfo(entity, attrs) {
    const el = this.shadowRoot.getElementById("route-info");
    if (!el) return;
    if (entity.state === "unavailable" || entity.state === "unknown") {
      el.innerHTML = `<div class="unavailable">传感器不可用，请检查集成配置</div>`;
      return;
    }
    const dur  = formatMinutes(attrs.duration_minutes);
    const dist = attrs.distance_km ? `${attrs.distance_km} km` : "--";
    const lts =
      attrs.traffic_lights !== undefined && attrs.traffic_lights !== null
        ? attrs.traffic_lights
        : "--";
    const oName = attrs.origin_name || "出发地";
    const dName = attrs.destination_name || "目的地";
    const tr   = getTrafficSummary(attrs.tmcs);

    el.innerHTML = `
      <div class="location">
        <div class="location-dot origin"></div>
        <div class="location-name" title="${oName}">${oName}</div>
      </div>
      <div class="route-middle">
        <div class="duration-badge clickable" id="btn-duration" title="查看今日历史">${dur}</div>
        <div class="route-meta">
          <span class="meta-item clickable" id="btn-distance" title="查看路线详情">📍 ${dist}</span>
          <span class="meta-item clickable" id="btn-lights"   title="查看路线详情">🚦 ${lts}灯</span>
          <span class="traffic-badge" style="background:${tr.color}">${tr.label}</span>
        </div>
      </div>
      <div class="location">
        <div class="location-dot dest"></div>
        <div class="location-name" title="${dName}">${dName}</div>
      </div>
    `;
    const btnDur = this.shadowRoot.getElementById("btn-duration");
    const btnDist = this.shadowRoot.getElementById("btn-distance");
    const btnLights = this.shadowRoot.getElementById("btn-lights");
    if (btnDur) btnDur.addEventListener("click", () => this._openHistory());
    if (btnDist) btnDist.addEventListener("click", () => this._openRoute());
    if (btnLights) btnLights.addEventListener("click", () => this._openRoute());
  }

  // ── 历史弹层 ──────────────────────────────────────────────────────────────

  async _openHistory() {
    const attrs = this._currentAttrs || {};
    this._sheet.open(
      `今日通勤历史 <span style="font-size:12px;font-weight:400;color:#999;">${attrs.origin_name||"出发地"} → ${attrs.destination_name||"目的地"}</span>`,
      async (body) => {
        body.innerHTML = `<div style="text-align:center;padding:20px;color:#bbb;font-size:13px;">加载中…</div>`;
        let points = [];
        try { points = await this._fetchTodayHistory(); }
        catch (e) {
          body.innerHTML = `<div style="text-align:center;padding:20px;color:#e55;font-size:13px;">加载失败：${e.message}</div>`;
          return;
        }
        const vals = points.map(p => p.value);
        const avgNum = vals.length
          ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length
          : null;
        const fastest = vals.length ? Math.min.apply(null, vals) : null;
        const slowest = vals.length ? Math.max.apply(null, vals) : null;
        body.innerHTML = `
          <div class="acp-history-hint">今日共记录 <b>${points.length}</b> 次</div>
          <div class="acp-stat-row">
            <div class="acp-stat-tile">
              <div class="acp-stat-ico" aria-hidden="true">📊</div>
              <div class="acp-stat-val acp-accent">${formatMinutesOneDecimal(avgNum)}</div>
              <div class="acp-stat-lbl">平均（分钟）</div>
            </div>
            <div class="acp-stat-tile">
              <div class="acp-stat-ico" aria-hidden="true">⚡</div>
              <div class="acp-stat-val acp-good">${formatMinutesOneDecimal(fastest)}</div>
              <div class="acp-stat-lbl">最快</div>
            </div>
            <div class="acp-stat-tile">
              <div class="acp-stat-ico" aria-hidden="true">🐌</div>
              <div class="acp-stat-val acp-bad">${formatMinutesOneDecimal(slowest)}</div>
              <div class="acp-stat-lbl">最慢</div>
            </div>
          </div>
          <div id="hchart"></div>
        `;
        requestAnimationFrame(() => {
          const c = body.querySelector("#hchart");
          if (c) drawHistoryChart(c, points);
        });
      }
    );
  }

  async _fetchTodayHistory() {
    if (!this._hass || typeof this._hass.callApi !== "function") {
      return [];
    }
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const eid = this._config.entity;
    try {
      const resp = await this._hass.callApi(
        "GET",
        "history/period/" +
          start +
          "?filter_entity_id=" +
          encodeURIComponent(eid) +
          "&minimal_response=true&no_attributes=true"
      );
      const records = Array.isArray(resp) ? resp[0] || [] : [];
      return records
        .filter((r) => r.state && r.state !== "unavailable" && r.state !== "unknown")
        .map((r) => {
          const v = parseFloat(r.state);
          const t = formatTime(r.last_changed || r.lu);
          return {
            value: v,
            time: t,
            color: v > 60 ? "#FF4444" : v > 40 ? "#FF8800" : "#00C851",
          };
        })
        .filter((r) => !isNaN(r.value));
    } catch (e) {
      return [];
    }
  }

  // ── 路线详情弹层（多路径切换）─────────────────────────────────────────────

  /**
   * 根据当前 entity 的 route_index 选择路线数据。
   * 如果 entity.attributes.route_index 存在且在 all_routes 中，返回对应路线；
   * 否则返回第一条路线（向后兼容）。
   */
  _getCurrentRouteData() {
    const attrs = this._currentAttrs || {};
    const allRoutes = attrs.all_routes || [];

    // 如果 entity 指定了 route_index，优先使用
    if (attrs.route_index !== undefined && allRoutes.length > 0) {
      const matched = allRoutes.find(r => r.index === attrs.route_index);
      if (matched) return matched;
    }

    // 否则返回第一条路线
    if (allRoutes.length > 0) return allRoutes[0];

    // 降级：用当前属性构造单路径（向后兼容旧配置）
    return {
      index: 0, label: "当前路线",
      duration_minutes: attrs.duration_minutes,
      distance_km: attrs.distance_km,
      traffic_lights: attrs.traffic_lights,
      tolls: attrs.tolls,
      polyline: attrs.polyline,
      tmcs: attrs.tmcs,
      steps: attrs.steps || [],
    };
  }

  _openRoute() {
    const attrs = this._currentAttrs || {};
    const allRoutes = attrs.all_routes || [];
    // 如果没有多路径数据，用当前属性构造单路径
    const routes = allRoutes.length > 0 ? allRoutes : [{
      index: 0, label: "当前路线",
      duration_minutes: attrs.duration_minutes,
      distance_km: attrs.distance_km,
      traffic_lights: attrs.traffic_lights,
      tolls: attrs.tolls,
      polyline: attrs.polyline,
      tmcs: attrs.tmcs,
      steps: attrs.steps || [],
    }];

    let activeIdx = 0;

    this._sheet.open(
      `行车路线 <span style="font-size:12px;font-weight:400;color:#999;">${attrs.origin_name||"出发地"} → ${attrs.destination_name||"目的地"}</span>`,
      (body) => {
        // ── 构建标签页 ──
        const tabsHtml = routes.map((r, i) => `
          <button type="button" class="acp-route-tab${i===0?' acp-active':''}" data-idx="${i}">
            <span class="acp-tab-label">${r.label || `路线${i+1}`}</span>
            <span class="acp-tab-sub">${formatMinutes(r.duration_minutes)}</span>
          </button>
        `).join("");

        body.innerHTML = `
          <div class="acp-route-tabs" id="route-tabs">${tabsHtml}</div>
          <div id="route-detail"></div>
        `;

        const renderDetail = (idx) => {
          const r = routes[idx];
          const tr = getTrafficSummary(r.tmcs || []);
          const tollStr = (r.tolls || 0) > 0 ? `￥${r.tolls}` : "免费";

          // 路况色条
          const tmcs = r.tmcs || [];
          const total = tmcs.reduce((s,t) => s+(t.distance||0), 0) || 1;
          const barSegs = tmcs.map(t =>
            `<div class="acp-traffic-bar-seg" style="flex:${((t.distance||0)/total*100).toFixed(1)};background:${t.color||'#9E9E9E'};" title="${t.status}"></div>`
          ).join("");

          // 分路段
          const steps = r.steps || [];
          const stepsHtml = steps.length > 0 ? `
            <div class="acp-sec-title">分路段导航</div>
            <ul class="acp-step-list">
              ${steps.map((s,i) => `
                <li class="acp-step-item">
                  <div class="acp-step-num">${i+1}</div>
                  <div>
                    <div class="acp-step-road">${s.road || "无名路段"}</div>
                    <div class="acp-step-sub">
                      ${s.distance ? s.distance+" 米" : ""}
                      ${s.instruction ? "· "+s.instruction : ""}
                    </div>
                  </div>
                </li>`).join("")}
            </ul>
          ` : "";

          body.querySelector("#route-detail").innerHTML = `
            <div class="acp-stat-row">
              <div class="acp-stat-tile">
                <div class="acp-stat-ico" aria-hidden="true">⏱</div>
                <div class="acp-stat-val acp-accent" style="font-size:15px;">${formatMinutes(r.duration_minutes)}</div>
                <div class="acp-stat-lbl">预计用时</div>
              </div>
              <div class="acp-stat-tile">
                <div class="acp-stat-ico" aria-hidden="true">📏</div>
                <div class="acp-stat-val acp-accent" style="font-size:15px;">${r.distance_km != null ? r.distance_km : "--"} km</div>
                <div class="acp-stat-lbl">总距离</div>
              </div>
              <div class="acp-stat-tile">
                <div class="acp-stat-ico" aria-hidden="true">🚦</div>
                <div class="acp-stat-val acp-accent" style="font-size:15px;">${r.traffic_lights != null ? r.traffic_lights : "--"}</div>
                <div class="acp-stat-lbl">红绿灯</div>
              </div>
              <div class="acp-stat-tile">
                <div class="acp-stat-ico" aria-hidden="true">💰</div>
                <div class="acp-stat-val" style="font-size:15px;color:${(r.tolls||0)>0?'#FF8800':'#00C851'}">${tollStr}</div>
                <div class="acp-stat-lbl">收费</div>
              </div>
            </div>

            <div class="acp-sec-title">路况分布</div>
            ${tmcs.length > 0
              ? `<div class="acp-traffic-bar">${barSegs}</div>
                 <div class="acp-traffic-legend">
                   ${Object.entries(TRAFFIC_COLORS).map(([l,c]) =>
                     `<div class="acp-tleg-item"><div class="acp-tleg-dot" style="background:${c}"></div>${l}</div>`
                   ).join("")}
                 </div>`
              : `<div style="font-size:12px;color:#bbb;margin-bottom:8px;">暂无路况数据</div>`}

            <div class="acp-sec-title">路线地图</div>
            <div class="acp-detail-map-wrap" id="dmap-wrap">
              <div class="acp-detail-map-inner" id="dmap-inner"></div>
              <div class="acp-detail-zoom-btns">
                <button type="button" class="acp-zoom-btn" id="dmap-zin"  title="放大">＋</button>
                <button type="button" class="acp-zoom-btn" id="dmap-zout" title="缩小">－</button>
              </div>
            </div>

            ${stepsHtml}
          `;

          // 地图：清理旧实例（切路线时销毁重建）
          if (this._detailMapResizeObserver) {
            try {
              this._detailMapResizeObserver.disconnect();
            } catch (_) {}
            this._detailMapResizeObserver = null;
          }
          if (this._detailMap) {
            try { this._detailMap.destroy(); } catch(_) {}
            this._detailMap = null;
          }

          // 弹窗动画 + 滚动区布局后再量尺寸，避免首次推荐线路地图右侧/底部灰边
          waitLayoutStable().then(() => {
            return this._initDetailMap(
              body.querySelector("#dmap-inner"),
              { ...attrs, polyline: r.polyline, tmcs: r.tmcs || [] }
            );
          }).then(map => {
            if (!map) return;
            this._detailMap = map;
            const zi = body.querySelector("#dmap-zin");
            const zo = body.querySelector("#dmap-zout");
            if (zi) zi.addEventListener("click", () => map.zoomIn());
            if (zo) zo.addEventListener("click", () => map.zoomOut());
          });
        };

        // 首次渲染
        renderDetail(0);

        // 标签切换
        const routeTabsEl = body.querySelector("#route-tabs");
        if (routeTabsEl) routeTabsEl.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const btn = acpClosestRouteTab(e.target);
          if (!btn) return;
          const idx = parseInt(btn.getAttribute("data-idx"), 10);
          if (Number.isNaN(idx)) return;
          if (idx === activeIdx) return;
          activeIdx = idx;
          body.querySelectorAll(".acp-route-tab").forEach((b, i) =>
            b.classList.toggle("acp-active", i === idx)
          );
          renderDetail(idx);
        });
      }
    );
  }

  // ── 详情地图初始化 ────────────────────────────────────────────────────────

  async _initDetailMap(container, attrs) {
    if (!container || !this._config.amap_web_key) return null;

    const isIOSLike = isIOSLikeDevice();
    const isIOSApp = isIOSLike && isHomeAssistantCompanionApp();

    const parentWrap = container.parentElement;

    const applyWrapSizeToContainer = () => {
      if (!parentWrap || !container) return;
      const rect = parentWrap.getBoundingClientRect();
      let width = Math.round(rect.width) || parentWrap.clientWidth || 320;
      let height = Math.round(rect.height) || parentWrap.clientHeight || 220;
      if (width < 80) width = 320;
      if (height < 80) height = 220;
      container.style.cssText =
        "width:" +
        width +
        "px;height:" +
        height +
        "px;display:block;position:absolute;top:0;left:0;" +
        (isIOSApp ? "transform:translateZ(0);-webkit-transform:translateZ(0);" : "");
    };

    applyWrapSizeToContainer();

    if (isIOSApp) {
      await new Promise((r) => setTimeout(r, 150));
    }

    try {
      const AMap = await loadAmapScript(this._config.amap_web_key);
      const poly = attrs.polyline || [];
      const center = poly.length > 0 ? poly[Math.floor(poly.length / 2)] : [116.397, 39.909];

      const isMobile = isMobileUserAgent();
      console.log("[AmapCommuteCard] 详情地图 - 移动设备：", isMobile, "iOS：", isIOSLike);

      const map = new AMap.Map(container, buildAmapMapOptions(center, isMobile));

      /** @type {{polylines:any[],markers:any[]}|null} */
      let overlayBundle = null;

      const fitRouteView = () => {
        try {
          if (!map || !overlayBundle) return;
          const pl = overlayBundle.polylines;
          const mk = overlayBundle.markers;
          if ((pl && pl.length) || (mk && mk.length)) {
            map.setFitView([].concat(pl || [], mk || []), false, [24, 24, 24, 24]);
          }
        } catch (e) {
          console.warn("[AmapCommuteCard] detail map fitRouteView", e);
        }
      };

      return new Promise((resolve) => {
        map.on("complete", () => {
          overlayBundle = buildMapOverlays(AMap, map, attrs);
          applyWrapSizeToContainer();
          try {
            map.getSize();
            fitRouteView();
          } catch (_) {}

          // 弹窗首次打开后容器仍会变化：监听尺寸并强制重算画布 + 重 fit 路线（解决右侧/底部灰边）
          if (parentWrap && typeof ResizeObserver !== "undefined") {
            const ro = new ResizeObserver(function () {
              applyWrapSizeToContainer();
              try {
                map.getSize();
                fitRouteView();
              } catch (_) {}
            });
            ro.observe(parentWrap);
            this._detailMapResizeObserver = ro;
          }

          // 全平台多次延迟刷新（桌面原先未调度，首次推荐易灰边；与切换 Tab 后「正常」现象一致）
          const delays = isIOSLike
            ? [0, 80, 200, 450, 900, 1500]
            : isMobile
              ? [0, 80, 250, 600]
              : [0, 50, 150, 400, 800];
          scheduleMapResizeRefresh(map, container, delays, function () {
            applyWrapSizeToContainer();
            map.getSize();
            fitRouteView();
          });

          resolve(map);
        });
        setTimeout(() => resolve(map), 5000);
      });
    } catch (e) {
      container.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#aaa;font-size:13px;">地图加载失败：' +
        e.message +
        "</div>";
      return null;
    }
  }

  // ── 主地图 ────────────────────────────────────────────────────────────────

  /**
   * 主地图：用 .map-container 实测像素写死子 div，避免 iOS WebView 上百分比宽高未参与瓦片计算导致灰底。
   */
  _applyMainMapContainerSize(container) {
    if (!container) return;
    const wrap = container.parentElement;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    let w = Math.round(rect.width) || wrap.clientWidth || 0;
    let h = Math.round(rect.height) || wrap.clientHeight || 0;
    if (w < 40 || h < 40) return;
    container.style.width = w + "px";
    container.style.height = h + "px";
    container.style.position = "absolute";
    container.style.top = "0";
    container.style.left = "0";
    container.style.display = "block";
  }

  async _initMap(attrs) {
    this._mapInited = true;
    const mapId = `amap-${this._config.entity.replace(/\./g, "_")}`;
    const container = this.shadowRoot.getElementById(mapId);
    const loading   = this.shadowRoot.getElementById("map-loading");

    console.log("[AmapCommuteCard] 初始化地图，容器：", container);
    console.log(
      "[AmapCommuteCard] 容器尺寸：",
      container && container.clientWidth,
      "x",
      container && container.clientHeight
    );

    if (!container) {
      console.error("[AmapCommuteCard] 地图容器不存在！");
      if (loading) loading.textContent = "地图容器初始化失败";
      return;
    }

    const isIOSLike = isIOSLikeDevice();
    const isIOSApp = isIOSLike && isHomeAssistantCompanionApp();
    const mapWrap = container.parentElement;

    // iOS HA App 关键修复：在创建地图前强制设置像素尺寸
    // Shadow DOM 内的百分比尺寸在 WebView 中可能未正确计算
    if (isIOSApp) {
      // 先隐藏容器，强制重排后再显示
      container.style.display = "none";
      void container.offsetHeight; // 强制重排
      container.style.display = "block";
      this._applyMainMapContainerSize(container);
      console.log("[AmapCommuteCard] iOS App - 强制设置容器像素尺寸（创建前）");
      container.style.transform = "translateZ(0)";
      container.style.webkitTransform = "translateZ(0)";
    } else if (isIOSLike) {
      this._applyMainMapContainerSize(container);
      console.log("[AmapCommuteCard] iOS 设备，强制设置容器尺寸（首帧）");
    }

    try {
      // iOS App 需要更长的延迟等待布局完全稳定
      if (isIOSApp) {
        await waitLayoutStable();
        await waitLayoutStable(); // 双重等待
        this._applyMainMapContainerSize(container);
        await new Promise(function (r) { setTimeout(r, 350); });
        this._applyMainMapContainerSize(container);
      } else if (isIOSLike) {
        await waitLayoutStable();
        this._applyMainMapContainerSize(container);
      }

      const AMap = await loadAmapScript(this._config.amap_web_key);
      console.log("[AmapCommuteCard] 高德地图脚本加载成功");

      const poly = attrs.polyline || [];
      const center = poly.length > 0 ? poly[Math.floor(poly.length/2)] : [116.397,39.909];

      const isMobile = isMobileUserAgent();
      console.log("[AmapCommuteCard] 移动设备检测：", isMobile, "iOS检测：", isIOSLike);

      // iOS App 创建地图前再次确认容器尺寸
      if (isIOSApp) {
        this._applyMainMapContainerSize(container);
      }

      this._map = new AMap.Map(container, buildAmapMapOptions(center, isMobile));

      console.log("[AmapCommuteCard] 地图对象创建成功");

      const self = this;
      this._map.on("complete", () => {
        console.log("[AmapCommuteCard] 地图加载完成");
        if (loading) loading.style.display = "none";
        const zBtns = self.shadowRoot.getElementById("main-zoom-btns");
        if (zBtns) zBtns.style.display = "flex";
        const zIn = self.shadowRoot.getElementById("main-zoom-in");
        const zOut = self.shadowRoot.getElementById("main-zoom-out");
        if (zIn) zIn.addEventListener("click", () => self._map.zoomIn());
        if (zOut) zOut.addEventListener("click", () => self._map.zoomOut());

        self._applyMainMapContainerSize(container);
        try {
          self._map.getSize();
        } catch (_) {}

        const { polylines, markers } = buildMapOverlays(AMap, self._map, attrs);
        self._polylines = polylines;
        self._markers   = markers;
        self._lastRouteHash = self._routeHash(attrs);

        console.log("[AmapCommuteCard] 地图层添加完成，折线数：", polylines.length, "标记数：", markers.length);

        const fitMainRoute = function () {
          self._applyMainMapContainerSize(container);
          try {
            self._map.getSize();
            if (typeof self._map.resize === "function") {
              self._map.resize();
            }
          } catch (_) {}
          try {
            if (self._polylines && self._markers && (self._polylines.length || self._markers.length)) {
              self._map.setFitView(
                [].concat(self._polylines, self._markers),
                false,
                [24, 24, 24, 24]
              );
            }
          } catch (e2) {
            console.warn("[AmapCommuteCard] fitMainRoute", e2);
          }
        };

        if (mapWrap && typeof ResizeObserver !== "undefined") {
          if (self._mainMapResizeObserver) {
            try {
              self._mainMapResizeObserver.disconnect();
            } catch (_) {}
          }
          let roTimer = null;
          self._mainMapResizeObserver = new ResizeObserver(function () {
            if (roTimer) clearTimeout(roTimer);
            roTimer = setTimeout(function () {
              roTimer = null;
              fitMainRoute();
            }, 120);
          });
          self._mainMapResizeObserver.observe(mapWrap);
        }

        const delays = isIOSApp
          ? [0, 80, 200, 450, 900, 1600, 2600]
          : isIOSLike
            ? [0, 100, 350, 700, 1400]
            : isMobile
              ? [0, 120, 400]
              : [0, 80, 300];
        scheduleMapResizeRefresh(self._map, container, delays, fitMainRoute);
      });

      this._map.on("error", (err) => {
        console.error("[AmapCommuteCard] 地图错误：", err);
        if (loading) loading.textContent = "地图加载错误";
      });

    } catch (e) {
      console.error("[AmapCommuteCard] 地图初始化异常：", e);
      if (loading) loading.textContent = "地图加载失败：" + e.message;
    }
  }

  _routeHash(attrs) {
    const tlen = attrs.tmcs && attrs.tmcs.length ? attrs.tmcs.length : 0;
    const plen = attrs.polyline && attrs.polyline.length ? attrs.polyline.length : 0;
    return tlen + "|" + plen;
  }

  _updateMapRoute(attrs) {
    if (!this._map || !window.AMap) return;
    const h = this._routeHash(attrs);
    if (h === this._lastRouteHash) return;
    this._lastRouteHash = h;
    const mapId = `amap-${this._config.entity.replace(/\./g, "_")}`;
    const container = this.shadowRoot.getElementById(mapId);
    if (container) this._applyMainMapContainerSize(container);
    clearMapOverlays(this._map, this._polylines, this._markers);
    const { polylines, markers } = buildMapOverlays(window.AMap, this._map, attrs);
    this._polylines = polylines;
    this._markers   = markers;
    if (container) {
      try {
        this._map.getSize();
        if (typeof this._map.resize === "function") this._map.resize();
      } catch (_) {}
    }
  }

  getCardSize() { return 4; }
  static getConfigElement() { return document.createElement("amap-commute-card-editor"); }
  static getStubConfig() {
    return { entity: "sensor.commute_time", amap_web_key: "your_key", title: "今日通勤" };
  }
}

// ─── 可视化编辑器 ─────────────────────────────────────────────────────────────

class AmapCommuteCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }
  _render() {
    this.innerHTML = `
      <style>
        .editor{padding:16px;display:flex;flex-direction:column;gap:12px;}
        label{font-size:13px;color:#555;display:flex;flex-direction:column;gap:4px;}
        input{padding:6px 8px;border:1px solid #ccc;border-radius:6px;font-size:14px;}
      </style>
      <div class="editor">
        <label>实体 (entity)<input id="entity" value="${this._config.entity||''}" placeholder="sensor.commute_time"/></label>
        <label>高德JS API Key<input id="amap_web_key" value="${this._config.amap_web_key||''}" placeholder="高德JS端 Key"/></label>
        <label>卡片标题<input id="title" value="${this._config.title||''}" placeholder="今日通勤"/></label>
      </div>
    `;
    ["entity","amap_web_key","title"].forEach(f => {
      this.querySelector(`#${f}`).addEventListener("change", e => {
        this._config = { ...this._config, [f]: e.target.value };
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config: this._config }, bubbles: true, composed: true
        }));
      });
    });
  }
}

// ─── 注册 ─────────────────────────────────────────────────────────────────────

if (!customElements.get("amap-commute-card")) {
  customElements.define("amap-commute-card", AmapCommuteCard);
}
if (!customElements.get("amap-commute-card-editor")) {
  customElements.define("amap-commute-card-editor", AmapCommuteCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "amap-commute-card")) {
  window.customCards.push({
    type: "amap-commute-card",
    name: "高德通勤时间卡片",
    description: "通勤时间 + 路况地图 + 多路径选择 + 历史折线图",
    preview: true,
  });
}

console.info(
  "%c 高德通勤时间卡片 %c v1.7.7 ",
  "color:#fff;background:#4CAF50;padding:2px 6px;border-radius:4px 0 0 4px;font-weight:600",
  "color:#4CAF50;background:#f0f0f0;padding:2px 6px;border-radius:0 4px 4px 0"
);
