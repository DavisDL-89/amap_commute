/**
 * 高德通勤时间卡片 - Lovelace Custom Card  v1.4.0
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

function loadAmapScript(key) {
  return new Promise((resolve, reject) => {
    if (window.AMap) { resolve(window.AMap); return; }
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=${AMAP_JS_VERSION}&key=${key}&plugin=${AMAP_PLUGIN}`;
    script.onload = () => resolve(window.AMap);
    script.onerror = () => reject(new Error("高德地图脚本加载失败"));
    document.head.appendChild(script);
  });
}

function formatMinutes(minutes) {
  if (minutes == null) return "--";
  const m = Math.round(minutes);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h${rem}m` : `${h} 小时`;
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

// ─── 卡片内浮层（完全在 Shadow DOM 内，不依赖 fixed 定位）────────────────────

class CardPopover {
  /**
   * @param {ShadowRoot} root  — 卡片的 shadowRoot
   * @param {HTMLElement} cardEl — .card 元素（用于定位参考）
   */
  constructor(root, cardEl) {
    this._root   = root;
    this._cardEl = cardEl;
    this._el     = null;
    this._injectStyles();
  }

  _injectStyles() {
    if (this._root.querySelector("#_cp_styles")) return;
    const s = document.createElement("style");
    s.id = "_cp_styles";
    s.textContent = `
      @keyframes _cpIn  { from{opacity:0;transform:scale(.96)} to{opacity:1;transform:scale(1)} }
      @keyframes _cpOut { to{opacity:0;transform:scale(.96)} }
    `;
    this._root.appendChild(s);
  }

  open(titleHtml, contentFn) {
    this.close();

    /* 遮罩：覆盖整张卡片 */
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:absolute;inset:0;
      background:rgba(0,0,0,0.38);
      z-index:200;border-radius:inherit;
    `;

    /* 浮层面板：居中覆盖在卡片上 */
    const panel = document.createElement("div");
    panel.style.cssText = `
      position:absolute;
      top:8px;left:8px;right:8px;bottom:8px;
      background:var(--ha-card-background,var(--card-background-color,#fff));
      border-radius:14px;
      box-shadow:0 8px 32px rgba(0,0,0,0.22);
      display:flex;flex-direction:column;
      z-index:201;
      animation:_cpIn .2s cubic-bezier(.34,1.1,.64,1);
      overflow:hidden;
    `;

    /* 标题栏 */
    const header = document.createElement("div");
    header.style.cssText = `
      padding:12px 14px 11px;
      display:flex;align-items:center;justify-content:space-between;
      border-bottom:1px solid var(--divider-color,#f0f0f0);
      flex-shrink:0;
    `;
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:var(--primary-text-color,#222);">
        <div style="width:4px;height:18px;background:var(--primary-color,#2196F3);border-radius:2px;flex-shrink:0;"></div>
        <div>${titleHtml}</div>
      </div>
      <button data-close style="
        background:var(--secondary-background-color,#f5f5f5);
        border:none;cursor:pointer;
        width:28px;height:28px;border-radius:50%;
        color:var(--secondary-text-color,#888);
        font-size:16px;line-height:1;
        display:flex;align-items:center;justify-content:center;
        flex-shrink:0;transition:background .12s;
      ">✕</button>
    `;

    /* 内容区 */
    const body = document.createElement("div");
    body.style.cssText = "flex:1;overflow-y:auto;padding:12px 14px 20px;";

    panel.appendChild(header);
    panel.appendChild(body);

    /* 挂载到 .card（需要 position:relative） */
    this._cardEl.style.position = "relative";
    this._cardEl.appendChild(overlay);
    this._cardEl.appendChild(panel);
    this._el = { overlay, panel };

    const close = () => this.close();
    overlay.addEventListener("click", close);
    header.querySelector("[data-close]").addEventListener("click", close);
    contentFn(body);
  }

  close() {
    if (!this._el) return;
    const { overlay, panel } = this._el;
    panel.style.animation = "_cpOut .18s ease forwards";
    setTimeout(() => { overlay.remove(); panel.remove(); }, 190);
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
  }

  setConfig(config) {
    if (!config.entity) throw new Error("必须配置 entity");
    if (!config.amap_web_key) throw new Error("必须配置 amap_web_key");
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const entity = hass.states[this._config.entity];
    if (!entity) return;
    const attrs = entity.attributes || {};
    this._currentAttrs = attrs;
    this._currentEntity = entity;

    // 根据当前 entity 的 route_index 选择路线数据
    const currentRoute = this._getCurrentRouteData();
    this._updateInfo(entity, currentRoute);
    if (!this._mapInited && (currentRoute.polyline || []).length > 0) {
      this._initMap(currentRoute);
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
        .card {
          background:var(--ha-card-background,var(--card-background-color,#fff));
          border-radius:var(--ha-card-border-radius,12px);
          box-shadow:var(--ha-card-box-shadow,0 2px 8px rgba(0,0,0,.1));
          overflow:hidden;
        }
        .card-header {
          padding:14px 16px 8px; font-size:14px; font-weight:600;
          color:var(--secondary-text-color); letter-spacing:.04em;
          display:flex; align-items:center; gap:6px;
        }
        .card-header ha-icon { --mdc-icon-size:18px; color:var(--primary-color); }
        .route-info { padding:8px 16px 14px; display:flex; align-items:center; }
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
        /* 主地图 */
        .map-container { position:relative;width:100%;height:240px;background:#f0f0f0; }
        #${mapId} { width:100%;height:100%; }
        .map-loading {
          position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
          font-size:13px;color:var(--secondary-text-color);background:#f5f5f5;
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

        /* ── 弹层内公共 ── */
        .stat-row { display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap; }
        .stat-box {
          flex:1;min-width:56px;text-align:center;padding:9px 6px;
          background:#f7f9ff;border-radius:10px;
        }
        .stat-val { font-size:17px;font-weight:700;color:var(--primary-color,#2196F3); }
        .stat-lbl { font-size:11px;color:#aaa;margin-top:2px; }
        .sec-title { font-size:12px;font-weight:600;color:#555;margin:14px 0 7px; }

        /* ── 路径标签页 ── */
        .route-tabs {
          display:flex;gap:6px;margin-bottom:14px;overflow-x:auto;padding-bottom:2px;
        }
        .route-tab {
          flex:0 0 auto;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;
          border:1.5px solid #ddd;background:#fff;color:#666;cursor:pointer;
          white-space:nowrap;transition:all .15s;
        }
        .route-tab.active {
          border-color:var(--primary-color,#2196F3);
          background:var(--primary-color,#2196F3);color:#fff;
        }
        .route-tab:hover:not(.active) { border-color:#aaa;color:#333; }

        /* ── 路况色条 ── */
        .traffic-bar {
          height:10px;border-radius:5px;overflow:hidden;display:flex;gap:1px;margin-bottom:8px;
        }
        .traffic-bar-seg { height:100%; }
        .traffic-legend { display:flex;gap:10px;flex-wrap:wrap;margin-bottom:4px; }
        .tleg-item { display:flex;align-items:center;gap:3px;font-size:11px;color:#666; }
        .tleg-dot  { width:10px;height:10px;border-radius:2px; }

        /* ── 详情地图 ── */
        .detail-map-wrap {
          position:relative;width:100%;height:220px;border-radius:10px;overflow:hidden;
          background:#e8edf2;margin-bottom:4px;
        }
        .detail-map-inner { width:100%;height:100%; }
        .detail-zoom-btns {
          position:absolute;right:8px;top:8px;
          display:flex;flex-direction:column;gap:4px;z-index:10;
        }

        /* ── 分路段 ── */
        .step-list { list-style:none; }
        .step-item {
          display:flex;align-items:flex-start;gap:10px;
          padding:10px 0;border-bottom:1px solid #f5f5f5;
          font-size:13px;color:#333;line-height:1.5;
        }
        .step-item:last-child { border-bottom:none; }
        .step-num {
          flex-shrink:0;width:22px;height:22px;border-radius:50%;
          background:var(--primary-color,#2196F3);color:#fff;
          font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;
        }
        .step-road { font-weight:600;color:#111;margin-bottom:2px; }
        .step-sub  { font-size:12px;color:#888; }

        /* ── 历史图 ── */
        .history-stat { display:flex;gap:10px;margin-bottom:14px; }
        .history-hint { text-align:center;font-size:12px;color:#bbb;margin-bottom:10px; }
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
            <button class="zoom-btn" id="main-zoom-in"  title="放大">＋</button>
            <button class="zoom-btn" id="main-zoom-out" title="缩小">－</button>
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
    const lts  = attrs.traffic_lights ?? "--";
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
    this.shadowRoot.getElementById("btn-duration")?.addEventListener("click", () => this._openHistory());
    this.shadowRoot.getElementById("btn-distance")?.addEventListener("click", () => this._openRoute());
    this.shadowRoot.getElementById("btn-lights")?.  addEventListener("click", () => this._openRoute());
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
        const avg = vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
        const min = vals.length ? Math.min(...vals) : null;
        const max = vals.length ? Math.max(...vals) : null;
        body.innerHTML = `
          <div class="history-hint">今日共记录 <b>${points.length}</b> 次</div>
          <div class="history-stat">
            <div class="stat-box"><div class="stat-val">${avg??'--'}</div><div class="stat-lbl">平均（分钟）</div></div>
            <div class="stat-box"><div class="stat-val" style="color:#00C851">${min??'--'}</div><div class="stat-lbl">最快</div></div>
            <div class="stat-box"><div class="stat-val" style="color:#FF4444">${max??'--'}</div><div class="stat-lbl">最慢</div></div>
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
    if (!this._hass) return [];
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const eid = this._config.entity;
    try {
      const resp = await this._hass.callApi("GET",
        `history/period/${start}?filter_entity_id=${eid}&minimal_response=true&no_attributes=true`);
      const records = Array.isArray(resp) ? (resp[0] || []) : [];
      return records
        .filter(r => r.state && r.state !== "unavailable" && r.state !== "unknown")
        .map(r => {
          const v = parseFloat(r.state);
          const t = formatTime(r.last_changed || r.lu);
          return { value: v, time: t, color: v > 60 ? "#FF4444" : v > 40 ? "#FF8800" : "#00C851" };
        }).filter(r => !isNaN(r.value));
    } catch { return []; }
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
          <button class="route-tab${i===0?' active':''}" data-idx="${i}">
            ${r.label || `路线${i+1}`}<br>
            <span style="font-size:10px;opacity:.8;font-weight:400;">${formatMinutes(r.duration_minutes)}</span>
          </button>
        `).join("");

        body.innerHTML = `
          <div class="route-tabs" id="route-tabs">${tabsHtml}</div>
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
            `<div class="traffic-bar-seg" style="flex:${((t.distance||0)/total*100).toFixed(1)};background:${t.color||'#9E9E9E'};" title="${t.status}"></div>`
          ).join("");

          // 分路段
          const steps = r.steps || [];
          const stepsHtml = steps.length > 0 ? `
            <div class="sec-title">分路段导航</div>
            <ul class="step-list">
              ${steps.map((s,i) => `
                <li class="step-item">
                  <div class="step-num">${i+1}</div>
                  <div>
                    <div class="step-road">${s.road || "无名路段"}</div>
                    <div class="step-sub">
                      ${s.distance ? s.distance+" 米" : ""}
                      ${s.instruction ? "· "+s.instruction : ""}
                    </div>
                  </div>
                </li>`).join("")}
            </ul>
          ` : "";

          body.querySelector("#route-detail").innerHTML = `
            <!-- 概览 -->
            <div class="stat-row">
              <div class="stat-box"><div class="stat-val" style="font-size:15px;">${formatMinutes(r.duration_minutes)}</div><div class="stat-lbl">预计用时</div></div>
              <div class="stat-box"><div class="stat-val" style="font-size:15px;">${r.distance_km??'--'} km</div><div class="stat-lbl">总距离</div></div>
              <div class="stat-box"><div class="stat-val" style="font-size:15px;">${r.traffic_lights??'--'}</div><div class="stat-lbl">红绿灯</div></div>
              <div class="stat-box"><div class="stat-val" style="font-size:15px;color:${(r.tolls||0)>0?'#FF8800':'#00C851'}">${tollStr}</div><div class="stat-lbl">收费</div></div>
            </div>

            <!-- 路况 -->
            <div class="sec-title">路况分布</div>
            ${tmcs.length > 0
              ? `<div class="traffic-bar">${barSegs}</div>
                 <div class="traffic-legend">
                   ${Object.entries(TRAFFIC_COLORS).map(([l,c]) =>
                     `<div class="tleg-item"><div class="tleg-dot" style="background:${c}"></div>${l}</div>`
                   ).join("")}
                 </div>`
              : `<div style="font-size:12px;color:#bbb;margin-bottom:8px;">暂无路况数据</div>`}

            <!-- 地图 -->
            <div class="sec-title">路线地图</div>
            <div class="detail-map-wrap" id="dmap-wrap">
              <div class="detail-map-inner" id="dmap-inner"></div>
              <div class="detail-zoom-btns">
                <button class="zoom-btn" id="dmap-zin"  title="放大">＋</button>
                <button class="zoom-btn" id="dmap-zout" title="缩小">－</button>
              </div>
            </div>

            ${stepsHtml}
          `;

          // 地图：清理旧实例（切路线时销毁重建）
          if (this._detailMap) {
            try { this._detailMap.destroy(); } catch(_) {}
            this._detailMap = null;
          }

          // 延一帧等 DOM
          requestAnimationFrame(() => {
            this._initDetailMap(
              body.querySelector("#dmap-inner"),
              { ...attrs, polyline: r.polyline, tmcs: r.tmcs || [] }
            ).then(map => {
              if (!map) return;
              this._detailMap = map;
              const zi = body.querySelector("#dmap-zin");
              const zo = body.querySelector("#dmap-zout");
              zi?.addEventListener("click", () => map.zoomIn());
              zo?.addEventListener("click", () => map.zoomOut());
            });
          });
        };

        // 首次渲染
        renderDetail(0);

        // 标签切换
        body.querySelector("#route-tabs")?.addEventListener("click", (e) => {
          const btn = e.target.closest(".route-tab");
          if (!btn) return;
          const idx = parseInt(btn.dataset.idx, 10);
          if (idx === activeIdx) return;
          activeIdx = idx;
          body.querySelectorAll(".route-tab").forEach((b,i) =>
            b.classList.toggle("active", i === idx)
          );
          renderDetail(idx);
        });
      }
    );
  }

  // ── 详情地图初始化 ────────────────────────────────────────────────────────

  async _initDetailMap(container, attrs) {
    if (!container || !this._config.amap_web_key) return null;
    container.style.cssText = "width:100%;height:100%;";
    try {
      const AMap = await loadAmapScript(this._config.amap_web_key);
      const poly = attrs.polyline || [];
      const center = poly.length > 0 ? poly[Math.floor(poly.length/2)] : [116.397,39.909];
      const map = new AMap.Map(container, {
        zoom: 12, center,
        mapStyle: "amap://styles/normal",
        resizeEnable: true,
      });
      return new Promise(resolve => {
        map.on("complete", () => {
          buildMapOverlays(AMap, map, attrs);
          resolve(map);
        });
        // 超时保底
        setTimeout(() => resolve(map), 5000);
      });
    } catch (e) {
      container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#aaa;font-size:13px;">地图加载失败：${e.message}</div>`;
      return null;
    }
  }

  // ── 主地图 ────────────────────────────────────────────────────────────────

  async _initMap(attrs) {
    this._mapInited = true;
    const mapId = `amap-${this._config.entity.replace(/\./g, "_")}`;
    const container = this.shadowRoot.getElementById(mapId);
    const loading   = this.shadowRoot.getElementById("map-loading");
    try {
      const AMap = await loadAmapScript(this._config.amap_web_key);
      const poly = attrs.polyline || [];
      const center = poly.length > 0 ? poly[Math.floor(poly.length/2)] : [116.397,39.909];
      this._map = new AMap.Map(container, {
        zoom: 12, center,
        mapStyle: "amap://styles/normal",
        resizeEnable: true,
      });
      this._map.on("complete", () => {
        if (loading) loading.style.display = "none";
        // 显示缩放按钮
        const zBtns = this.shadowRoot.getElementById("main-zoom-btns");
        if (zBtns) zBtns.style.display = "flex";
        // 绑定缩放
        this.shadowRoot.getElementById("main-zoom-in") ?.addEventListener("click", () => this._map.zoomIn());
        this.shadowRoot.getElementById("main-zoom-out")?.addEventListener("click", () => this._map.zoomOut());
        const { polylines, markers } = buildMapOverlays(AMap, this._map, attrs);
        this._polylines = polylines;
        this._markers   = markers;
        this._lastRouteHash = this._routeHash(attrs);
      });
    } catch (e) {
      console.error("[AmapCommuteCard]", e);
      if (loading) loading.textContent = "地图加载失败，请检查 amap_web_key";
    }
  }

  _routeHash(attrs) {
    return `${attrs.tmcs?.length}|${attrs.polyline?.length}`;
  }

  _updateMapRoute(attrs) {
    if (!this._map || !window.AMap) return;
    const h = this._routeHash(attrs);
    if (h === this._lastRouteHash) return;
    this._lastRouteHash = h;
    clearMapOverlays(this._map, this._polylines, this._markers);
    const { polylines, markers } = buildMapOverlays(window.AMap, this._map, attrs);
    this._polylines = polylines;
    this._markers   = markers;
  }

  getCardSize() { return 4; }
  static getConfigElement() { return document.createElement("amap-commute-card-editor"); }
  static getStubConfig() {
    return { entity: "sensor.commute_time", amap_web_key: "your_key", title: "今日通勤" };
  }
}

// ─── 可视化编辑器 ─────────────────────────────────────────────────────────────

class AmapCommuteCardEditor extends HTMLElement {
  setConfig(config) { this._config = config; this._render(); }
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

customElements.define("amap-commute-card", AmapCommuteCard);
customElements.define("amap-commute-card-editor", AmapCommuteCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "amap-commute-card",
  name: "高德通勤时间卡片",
  description: "通勤时间 + 路况地图 + 多路径选择 + 历史折线图",
  preview: true,
});

console.info(
  "%c 高德通勤时间卡片 %c v1.4.0 ",
  "color:#fff;background:#4CAF50;padding:2px 6px;border-radius:4px 0 0 4px;font-weight:600",
  "color:#4CAF50;background:#f0f0f0;padding:2px 6px;border-radius:0 4px 4px 0"
);
