export class CardPopover {
  constructor(root) {
    this._root = root;
    this._el = null;
    this._injectStyles();
  }

  _injectStyles() {
    if (this._root.querySelector("#_cp_styles")) return;
    const s = document.createElement("style");
    s.id = "_cp_styles";
    s.textContent = `
      @keyframes _cpIn  { from{opacity:0} to{opacity:1} }
      @keyframes _cpOut { to{opacity:0} }
    `;
    this._root.appendChild(s);
  }

  open(titleHtml, contentFn) {
    this.close();
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.42);z-index:9998;backdrop-filter:blur(1px);";
    const panel = document.createElement("div");
    panel.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(686px, calc(100vw - 24px));height:min(84vh, 900px);background:var(--ha-card-background,var(--card-background-color,#fff));border-radius:16px;box-shadow:0 16px 50px rgba(0,0,0,.28);display:flex;flex-direction:column;z-index:9999;animation:_cpIn .2s cubic-bezier(.34,1.1,.64,1);overflow:hidden;";
    const header = document.createElement("div");
    header.style.cssText = "padding:12px 14px 11px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--divider-color,#f0f0f0);flex-shrink:0;";
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:var(--primary-text-color,#222);">
        <div style="width:4px;height:18px;background:var(--primary-color,#2196F3);border-radius:2px;flex-shrink:0;"></div>
        <div>${titleHtml}</div>
      </div>
      <button data-close style="background:var(--secondary-background-color,#f5f5f5);border:none;cursor:pointer;width:28px;height:28px;border-radius:50%;color:var(--secondary-text-color,#888);font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
    `;
    const body = document.createElement("div");
    body.style.cssText = "flex:1;overflow-y:auto;padding:12px 14px 20px;";
    panel.appendChild(header);
    panel.appendChild(body);
    this._root.appendChild(overlay);
    this._root.appendChild(panel);
    this._el = { overlay, panel };
    const close = () => this.close();
    overlay.addEventListener("click", close);
    header.querySelector("[data-close]")?.addEventListener("click", close);
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
