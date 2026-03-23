import { TRAFFIC_COLORS } from "./constants.js";
import { CardPopover } from "./popover.js";
import { drawHistoryChart } from "./chart.js";
import { buildMapOverlays, clearMapOverlays } from "./map.js";
import {
  loadAmapScript,
  formatMinutes,
  formatTime,
  getTrafficSummary,
  detectIOSAppWebView,
  pickAmapJsVersion,
} from "./helpers.js";

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
    this._sheet = null;
    this._detailMap = null;
  }

  setConfig(config) {
    if (!config.entity) throw new Error("必须配置 entity");
    if (!config.amap_web_key) throw new Error("必须配置 amap_web_key");
    this._config = config;
    this._render();
  }

  _isDebug() { return Boolean(this._config?.debug); }
  _debug(...args) { if (this._isDebug()) console.debug("[AmapCommuteCard]", ...args); }

  set hass(hass) {
    this._hass = hass;
    const entity = hass.states[this._config.entity];
    if (!entity) return;
    const attrs = entity.attributes || {};
    this._currentAttrs = attrs;
    this._currentEntity = entity;
    const currentRoute = this._getCurrentRouteData();
    this._updateInfo(entity, currentRoute);
    if (!this._mapInited && (currentRoute.polyline || []).length > 0) {
      setTimeout(() => this._initMap(currentRoute), 100);
    } else if (this._mapInited) {
      this._updateMapRoute(currentRoute);
    }
  }

  _render() {
    const cfg = this._config;
    const mapId = `amap-${cfg.entity.replace(/\./g, "_")}`;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; font-family:var(--primary-font-family,sans-serif); }
        .card { background:var(--ha-card-background,var(--card-background-color,#fff)); border-radius:var(--ha-card-border-radius,12px); box-shadow:var(--ha-card-box-shadow,0 2px 8px rgba(0,0,0,.1)); overflow:hidden; }
        .card-header { padding:14px 16px 8px; font-size:14px; font-weight:600; color:var(--secondary-text-color); letter-spacing:.04em; display:flex; align-items:center; gap:6px; }
        .card-header ha-icon { --mdc-icon-size:18px; color:var(--primary-color); }
        .route-info { padding:8px 16px 14px; display:flex; align-items:center; min-height:60px; }
        .location { display:flex; flex-direction:column; align-items:center; flex:0 0 auto; min-width:68px; max-width:96px; }
        .location-dot { width:10px;height:10px;border-radius:50%;margin-bottom:4px; }
        .location-dot.origin { background:#4CAF50; } .location-dot.dest { background:#F44336; }
        .location-name { font-size:13px;font-weight:600;color:var(--primary-text-color); text-align:center;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
        .route-middle { flex:1;display:flex;flex-direction:column;align-items:center;padding:0 8px; }
        .clickable { cursor:pointer; user-select:none; -webkit-tap-highlight-color:transparent; transition:transform .12s,opacity .12s,filter .12s; }
        .duration-badge { background:var(--primary-color,#2196F3);color:#fff;border-radius:20px;padding:5px 16px;font-size:19px;font-weight:700;white-space:nowrap; box-shadow:0 2px 8px rgba(33,150,243,.3);margin-bottom:7px; }
        .route-meta { display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center; }
        .meta-item { display:inline-flex;align-items:center;gap:3px;border-radius:6px;padding:3px 9px;border:1px solid var(--divider-color,#e8e8e8);background:var(--secondary-background-color,#f9f9f9);font-size:12px;color:var(--secondary-text-color); }
        .traffic-badge { border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600;color:#fff; }
        .map-container { position:relative; width:100%; height:240px; background:#e8edf2; overflow:hidden; touch-action:none; }
        #${mapId} { width:100%; height:100%; position:absolute; top:0; left:0; z-index:1; }
        .map-loading { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:13px; color:var(--secondary-text-color); background:#f5f5f5; z-index:10; }
        .zoom-btns { position:absolute;right:10px;top:10px; display:flex;flex-direction:column;gap:4px;z-index:10; }
        .zoom-btn { width:30px;height:30px;border-radius:6px;border:none;cursor:pointer;background:rgba(255,255,255,.92);color:#444;font-size:18px;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center; }
        .legend { display:flex;gap:8px;padding:6px 14px 10px;flex-wrap:wrap;border-top:1px solid var(--divider-color,#eee);justify-content:flex-end; }
        .legend-item { display:flex;align-items:center;gap:4px;font-size:11px;color:var(--secondary-text-color); }
        .legend-dot { width:10px;height:10px;border-radius:2px; }
      </style>
      <ha-card class="card">
        <div class="card-header"><ha-icon icon="mdi:map-marker-path"></ha-icon><span>${cfg.title || "通勤时间"}</span></div>
        <div class="route-info" id="route-info"><div class="unavailable">正在加载数据…</div></div>
        <div class="map-container">
          <div id="${mapId}"></div>
          <div class="map-loading" id="map-loading">地图加载中…</div>
          <div class="zoom-btns" id="main-zoom-btns" style="display:none;">
            <button class="zoom-btn" id="main-zoom-in" title="放大">＋</button>
            <button class="zoom-btn" id="main-zoom-out" title="缩小">－</button>
          </div>
        </div>
        <div class="legend">${Object.entries(TRAFFIC_COLORS).map(([l,c]) => `<div class="legend-item"><div class="legend-dot" style="background:${c}"></div><span>${l}</span></div>`).join("")}</div>
      </ha-card>
    `;
    this._sheet = new CardPopover(this.shadowRoot);
  }

  _getCurrentRouteData() {
    const attrs = this._currentAttrs || {};
    const allRoutes = attrs.all_routes || [];
    if (attrs.route_index !== undefined && allRoutes.length > 0) {
      const matched = allRoutes.find((r) => r.index === attrs.route_index);
      if (matched) return matched;
    }
    if (allRoutes.length > 0) return allRoutes[0];
    return { index: 0, label: "当前路线", duration_minutes: attrs.duration_minutes, distance_km: attrs.distance_km, traffic_lights: attrs.traffic_lights, tolls: attrs.tolls, polyline: attrs.polyline, tmcs: attrs.tmcs, steps: attrs.steps || [] };
  }

  _updateInfo(entity, attrs) {
    const el = this.shadowRoot.getElementById("route-info");
    if (!el) return;
    if (entity.state === "unavailable" || entity.state === "unknown") {
      el.innerHTML = `<div class="unavailable">传感器不可用，请检查集成配置</div>`;
      return;
    }
    const dur = formatMinutes(attrs.duration_minutes);
    const dist = attrs.distance_km ? `${attrs.distance_km} km` : "--";
    const lts = attrs.traffic_lights ?? "--";
    const tr = getTrafficSummary(attrs.tmcs);
    el.innerHTML = `
      <div class="location"><div class="location-dot origin"></div><div class="location-name">${attrs.origin_name || "出发地"}</div></div>
      <div class="route-middle">
        <div class="duration-badge clickable" id="btn-duration">${dur}</div>
        <div class="route-meta">
          <span class="meta-item clickable" id="btn-distance">📍 ${dist}</span>
          <span class="meta-item clickable" id="btn-lights">🚦 ${lts}灯</span>
          <span class="traffic-badge" style="background:${tr.color}">${tr.label}</span>
        </div>
      </div>
      <div class="location"><div class="location-dot dest"></div><div class="location-name">${attrs.destination_name || "目的地"}</div></div>
    `;
    this.shadowRoot.getElementById("btn-duration")?.addEventListener("click", () => this._openHistory());
    this.shadowRoot.getElementById("btn-distance")?.addEventListener("click", () => this._openRoute());
    this.shadowRoot.getElementById("btn-lights")?.addEventListener("click", () => this._openRoute());
  }

  async _openHistory() {
    const attrs = this._currentAttrs || {};
    this._sheet.open(`今日通勤历史 <span style="font-size:12px;font-weight:400;color:#999;">${attrs.origin_name || "出发地"} → ${attrs.destination_name || "目的地"}</span>`, async (body) => {
      body.innerHTML = `<div style="text-align:center;padding:20px;color:#bbb;font-size:13px;">加载中…</div>`;
      let points = [];
      try { points = await this._fetchTodayHistory(); } catch (e) { body.innerHTML = `<div style="text-align:center;padding:20px;color:#e55;font-size:13px;">加载失败：${e.message}</div>`; return; }
      const vals = points.map((p) => p.value);
      const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      const min = vals.length ? Math.min(...vals) : null;
      const max = vals.length ? Math.max(...vals) : null;
      body.innerHTML = `
        <div style="text-align:center;font-size:12px;color:#bbb;margin-bottom:10px;">今日共记录 <b>${points.length}</b> 次</div>
        <div style="display:flex;gap:10px;margin-bottom:14px;">
          <div style="flex:1;min-width:56px;text-align:center;padding:9px 6px;background:#f7f9ff;border-radius:10px;">
            <div style="font-size:17px;font-weight:700;color:var(--primary-color,#2196F3);">${avg ?? "--"}</div>
            <div style="font-size:11px;color:#aaa;margin-top:2px;">平均（分钟）</div>
          </div>
          <div style="flex:1;min-width:56px;text-align:center;padding:9px 6px;background:#f7f9ff;border-radius:10px;">
            <div style="font-size:17px;font-weight:700;color:#00C851;">${min ?? "--"}</div>
            <div style="font-size:11px;color:#aaa;margin-top:2px;">最快</div>
          </div>
          <div style="flex:1;min-width:56px;text-align:center;padding:9px 6px;background:#f7f9ff;border-radius:10px;">
            <div style="font-size:17px;font-weight:700;color:#FF4444;">${max ?? "--"}</div>
            <div style="font-size:11px;color:#aaa;margin-top:2px;">最慢</div>
          </div>
        </div>
        <div id="hchart"></div>
      `;
      requestAnimationFrame(() => {
        const c = body.querySelector("#hchart");
        if (c) drawHistoryChart(c, points);
      });
    });
  }

  async _fetchTodayHistory() {
    if (!this._hass) return [];
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const eid = this._config.entity;
    try {
      const resp = await this._hass.callApi("GET", `history/period/${start}?filter_entity_id=${eid}&minimal_response=true&no_attributes=true`);
      const records = Array.isArray(resp) ? (resp[0] || []) : [];
      return records.filter((r) => r.state && r.state !== "unavailable" && r.state !== "unknown").map((r) => {
        const v = parseFloat(r.state);
        return { value: v, time: formatTime(r.last_changed || r.lu), color: v > 60 ? "#FF4444" : v > 40 ? "#FF8800" : "#00C851" };
      }).filter((r) => !isNaN(r.value));
    } catch {
      return [];
    }
  }

  _openRoute() {
    const attrs = this._currentAttrs || {};
    const allRoutes = attrs.all_routes || [];
    const routes = allRoutes.length > 0 ? allRoutes : [{ index: 0, label: "当前路线", duration_minutes: attrs.duration_minutes, distance_km: attrs.distance_km, traffic_lights: attrs.traffic_lights, tolls: attrs.tolls, polyline: attrs.polyline, tmcs: attrs.tmcs, steps: attrs.steps || [] }];
    let activeIdx = 0;
    this._sheet.open(`行车路线 <span style="font-size:12px;font-weight:400;color:#999;">${attrs.origin_name || "出发地"} → ${attrs.destination_name || "目的地"}</span>`, (body) => {
      const tabsHtml = routes.map((r, i) => `
        <button style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;border:1.5px solid #ddd;background:${i === 0 ? "var(--primary-color,#2196F3)" : "#fff"};color:${i === 0 ? "#fff" : "#666"};cursor:pointer;white-space:nowrap;" class="route-tab" data-idx="${i}">
          ${r.label || `路线${i + 1}`}<br><span style="font-size:10px;opacity:.8;font-weight:400;">${formatMinutes(r.duration_minutes)}</span>
        </button>
      `).join("");
      body.innerHTML = `<div id="route-tabs" style="display:flex;gap:6px;margin-bottom:14px;overflow-x:auto;padding-bottom:2px;">${tabsHtml}</div><div id="route-detail"></div>`;
      const renderDetail = (idx) => {
        const r = routes[idx];
        const tollStr = (r.tolls || 0) > 0 ? `￥${r.tolls}` : "免费";
        const tmcs = r.tmcs || [];
        const total = tmcs.reduce((s, t) => s + (t.distance || 0), 0) || 1;
        const barSegs = tmcs.map((t) =>
          `<div style="height:100%;flex:${((t.distance || 0) / total * 100).toFixed(1)};background:${t.color || "#9E9E9E"};" title="${t.status}"></div>`
        ).join("");
        const steps = r.steps || [];
        const stepsHtml = steps.length > 0 ? `
          <div style="font-size:12px;font-weight:600;color:#555;margin:14px 0 7px;">分路段导航</div>
          <ul style="list-style:none;padding:0;margin:0;">
            ${steps.map((s, i) => `
              <li style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #f5f5f5;">
                <div style="width:22px;height:22px;border-radius:50%;background:var(--primary-color,#2196F3);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i + 1}</div>
                <div>
                  <div style="font-size:13px;font-weight:600;color:#111;">${s.road || "无名路段"}</div>
                  <div style="font-size:12px;color:#888;">${s.distance ? `${s.distance} 米` : ""}${s.instruction ? ` · ${s.instruction}` : ""}</div>
                </div>
              </li>`).join("")}
          </ul>
        ` : "";
        body.querySelector("#route-detail").innerHTML = `
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
            <div style="flex:1;min-width:56px;text-align:center;padding:9px 6px;background:#f7f9ff;border-radius:10px;"><div style="font-size:15px;font-weight:700;color:var(--primary-color,#2196F3);">${formatMinutes(r.duration_minutes)}</div><div style="font-size:11px;color:#aaa;">预计用时</div></div>
            <div style="flex:1;min-width:56px;text-align:center;padding:9px 6px;background:#f7f9ff;border-radius:10px;"><div style="font-size:15px;font-weight:700;color:var(--primary-color,#2196F3);">${r.distance_km ?? "--"} km</div><div style="font-size:11px;color:#aaa;">总距离</div></div>
            <div style="flex:1;min-width:56px;text-align:center;padding:9px 6px;background:#f7f9ff;border-radius:10px;"><div style="font-size:15px;font-weight:700;color:var(--primary-color,#2196F3);">${r.traffic_lights ?? "--"}</div><div style="font-size:11px;color:#aaa;">红绿灯</div></div>
            <div style="flex:1;min-width:56px;text-align:center;padding:9px 6px;background:#f7f9ff;border-radius:10px;"><div style="font-size:15px;font-weight:700;color:${(r.tolls || 0) > 0 ? "#FF8800" : "#00C851"};">${tollStr}</div><div style="font-size:11px;color:#aaa;">收费</div></div>
          </div>
          <div style="font-size:12px;font-weight:600;color:#555;margin:14px 0 7px;">路况分布</div>
          ${tmcs.length > 0 ? `<div style="height:10px;border-radius:5px;overflow:hidden;display:flex;margin-bottom:8px;">${barSegs}</div>` : `<div style="font-size:12px;color:#bbb;margin-bottom:8px;">暂无路况数据</div>`}
          <div style="font-size:12px;font-weight:600;color:#555;margin:14px 0 7px;">路线地图</div>
          <div style="position:relative;width:100%;height:220px;border-radius:10px;overflow:hidden;background:#e8edf2;margin-bottom:4px;">
            <div id="dmap-inner" style="width:100%;height:100%;position:absolute;top:0;left:0;"></div>
            <div style="position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:4px;z-index:10;">
              <button class="zoom-btn" id="dmap-zin">＋</button>
              <button class="zoom-btn" id="dmap-zout">－</button>
            </div>
          </div>
          ${stepsHtml}
        `;
        if (this._detailMap) {
          try { this._detailMap.destroy(); } catch {}
          this._detailMap = null;
        }
        requestAnimationFrame(() => {
          this._initDetailMap(body.querySelector("#dmap-inner"), { ...attrs, polyline: r.polyline, tmcs: r.tmcs || [] }).then((map) => {
            if (!map) return;
            this._detailMap = map;
            body.querySelector("#dmap-zin")?.addEventListener("click", () => map.zoomIn());
            body.querySelector("#dmap-zout")?.addEventListener("click", () => map.zoomOut());
          });
        });
      };
      renderDetail(0);
      body.querySelector("#route-tabs")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".route-tab");
        if (!btn) return;
        const idx = parseInt(btn.dataset.idx, 10);
        if (idx === activeIdx) return;
        activeIdx = idx;
        body.querySelectorAll(".route-tab").forEach((b, i) => {
          b.style.background = i === idx ? "var(--primary-color,#2196F3)" : "#fff";
          b.style.color = i === idx ? "#fff" : "#666";
          b.style.borderColor = i === idx ? "var(--primary-color,#2196F3)" : "#ddd";
        });
        renderDetail(idx);
      });
    });
  }

  async _initDetailMap(container, attrs) {
    if (!container || !this._config.amap_web_key) return null;
    const { isIOS, isIOSApp } = detectIOSAppWebView();
    const parentWrap = container.parentElement;
    const rect = parentWrap?.getBoundingClientRect();
    const width = rect?.width || parentWrap?.clientWidth || 320;
    const height = rect?.height || parentWrap?.clientHeight || 220;
    container.style.cssText = `width:${width}px;height:${height}px;display:block;position:absolute;top:0;left:0;${isIOSApp ? "transform:translateZ(0);-webkit-transform:translateZ(0);" : ""}`;
    if (isIOSApp) await new Promise((r) => setTimeout(r, 150));
    try {
      const jsVersion = pickAmapJsVersion();
      const AMap = await loadAmapScript(this._config.amap_web_key, jsVersion);
      const poly = attrs.polyline || [];
      const center = poly.length > 0 ? poly[Math.floor(poly.length / 2)] : [116.397, 39.909];
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const map = new AMap.Map(container, {
        zoom: 12, center, mapStyle: "amap://styles/normal", resizeEnable: true, viewMode: "2D",
        zoomEnable: true, dragEnable: true, doubleClickZoom: true, scrollWheel: !isMobile, touchZoom: isMobile, rotateEnable: false, pitchEnable: false,
      });
      return new Promise((resolve) => {
        map.on("complete", () => {
          buildMapOverlays(AMap, map, attrs);
          // Panel 动画结束后再做一轮尺寸同步，避免图层偏移
          [120, 260].forEach((delay) => {
            setTimeout(() => {
              map.getSize();
              map.setFitView();
            }, delay);
          });
          resolve(map);
        });
        setTimeout(() => resolve(map), 5000);
        if (isIOS) {
          [100, 300, 600, 1000, 1500].forEach((delay) => {
            setTimeout(() => { map.getSize(); map.setFitView(); }, delay);
          });
        }
      });
    } catch (e) {
      container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#aaa;font-size:13px;">地图加载失败：${e.message}</div>`;
      return null;
    }
  }

  async _initMap(attrs) {
    this._mapInited = true;
    const mapId = `amap-${this._config.entity.replace(/\./g, "_")}`;
    const container = this.shadowRoot.getElementById(mapId);
    const loading = this.shadowRoot.getElementById("map-loading");
    if (!container) return;
    const { isIOS, isIOSApp } = detectIOSAppWebView();
    if (isIOS) {
      const parentRect = container.parentElement?.getBoundingClientRect();
      const width = parentRect?.width || container.clientWidth || 320;
      const height = parentRect?.height || container.clientHeight || 240;
      container.style.width = width + "px";
      container.style.height = height + "px";
      if (isIOSApp) {
        container.style.transform = "translateZ(0)";
        container.style.webkitTransform = "translateZ(0)";
      }
    }
    try {
      const jsVersion = pickAmapJsVersion();
      this._debug("主地图 JSAPI 版本", jsVersion);
      const AMap = await loadAmapScript(this._config.amap_web_key, jsVersion);
      const poly = attrs.polyline || [];
      const center = poly.length > 0 ? poly[Math.floor(poly.length / 2)] : [116.397, 39.909];
      this._map = new AMap.Map(container, {
        zoom: 12, center, mapStyle: "amap://styles/normal", resizeEnable: true, viewMode: "2D",
        zoomEnable: true, dragEnable: false, doubleClickZoom: false, scrollWheel: false, touchZoom: false, rotateEnable: false, pitchEnable: false,
      });
      this._map.on("complete", () => {
        if (loading) loading.style.display = "none";
        const zBtns = this.shadowRoot.getElementById("main-zoom-btns");
        if (zBtns) zBtns.style.display = "flex";
        this.shadowRoot.getElementById("main-zoom-in")?.addEventListener("click", () => this._map.zoomIn());
        this.shadowRoot.getElementById("main-zoom-out")?.addEventListener("click", () => this._map.zoomOut());
        const { polylines, markers } = buildMapOverlays(AMap, this._map, attrs);
        this._polylines = polylines;
        this._markers = markers;
        this._lastRouteHash = this._routeHash(attrs);
      });
    } catch (e) {
      if (loading) loading.textContent = "地图加载失败：" + (e?.message || "未知错误");
    }
  }

  _routeHash(attrs) {
    const tmcs = attrs.tmcs || [];
    const poly = attrs.polyline || [];
    const first = poly[0] || [];
    const last = poly[poly.length - 1] || [];
    return [attrs.duration_minutes ?? "", attrs.distance_km ?? "", tmcs.length, poly.length, first.join(","), last.join(",")].join("|");
  }

  _updateMapRoute(attrs) {
    if (!this._map || !window.AMap) return;
    const h = this._routeHash(attrs);
    if (h === this._lastRouteHash) return;
    this._lastRouteHash = h;
    clearMapOverlays(this._map, this._polylines, this._markers);
    const { polylines, markers } = buildMapOverlays(window.AMap, this._map, attrs);
    this._polylines = polylines;
    this._markers = markers;
  }

  getCardSize() { return 4; }
  static getConfigElement() { return document.createElement("amap-commute-card-editor"); }
  static getStubConfig() { return { entity: "sensor.commute_time", amap_web_key: "your_key", title: "今日通勤", debug: false }; }
}

class AmapCommuteCardEditor extends HTMLElement {
  setConfig(config) { this._config = config; this._render(); }
  _render() {
    this.innerHTML = `
      <style>.editor{padding:16px;display:flex;flex-direction:column;gap:12px;}label{font-size:13px;color:#555;display:flex;flex-direction:column;gap:4px;}input{padding:6px 8px;border:1px solid #ccc;border-radius:6px;font-size:14px;}</style>
      <div class="editor">
        <label>实体 (entity)<input id="entity" value="${this._config.entity || ""}" placeholder="sensor.commute_time"/></label>
        <label>高德JS API Key<input id="amap_web_key" value="${this._config.amap_web_key || ""}" placeholder="高德JS端 Key"/></label>
        <label>卡片标题<input id="title" value="${this._config.title || ""}" placeholder="今日通勤"/></label>
        <label>调试日志 (debug)<input id="debug" type="checkbox" ${this._config.debug ? "checked" : ""}/></label>
      </div>
    `;
    ["entity", "amap_web_key", "title", "debug"].forEach((f) => {
      this.querySelector(`#${f}`)?.addEventListener("change", (e) => {
        const value = f === "debug" ? e.target.checked : e.target.value;
        this._config = { ...this._config, [f]: value };
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
      });
    });
  }
}

if (!customElements.get("amap-commute-card")) customElements.define("amap-commute-card", AmapCommuteCard);
if (!customElements.get("amap-commute-card-editor")) customElements.define("amap-commute-card-editor", AmapCommuteCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "amap-commute-card")) {
  window.customCards.push({ type: "amap-commute-card", name: "高德通勤时间卡片", description: "通勤时间 + 路况地图 + 多路径选择 + 历史折线图", preview: true });
}
