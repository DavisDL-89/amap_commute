export function drawHistoryChart(container, points) {
  if (!points || !points.length) {
    container.innerHTML = `<div style="text-align:center;padding:30px;color:#bbb;font-size:13px;">暂无今日历史数据</div>`;
    return;
  }
  const W = container.clientWidth || 320;
  const H = 150, pL = 42, pR = 16, pT = 16, pB = 32;
  const cW = W - pL - pR, cH = H - pT - pB;
  const vals = points.map((p) => p.value);
  const minV = Math.max(0, Math.min(...vals) - 8);
  const maxV = Math.max(...vals) + 8;
  const range = maxV - minV || 1;
  const toX = (i) => pL + (i / Math.max(points.length - 1, 1)) * cW;
  const toY = (v) => pT + cH - ((v - minV) / range) * cH;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`).join(" ");
  const fill = `${line} L${toX(points.length - 1).toFixed(1)},${(pT + cH).toFixed(1)} L${pL},${(pT + cH).toFixed(1)} Z`;
  const yTicks = [minV, Math.round((minV + maxV) / 2), maxV].map((v) => {
    const y = toY(v);
    return `<line x1="${pL}" y1="${y.toFixed(1)}" x2="${W - pR}" y2="${y.toFixed(1)}" stroke="#eee" stroke-width="1"/>
            <text x="${pL - 5}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#bbb">${Math.round(v)}</text>`;
  }).join("");
  const step = Math.max(1, Math.floor(points.length / 5));
  const xLabels = points.filter((_, i) => i % step === 0 || i === points.length - 1).map((p) => {
    const idx = points.indexOf(p);
    return `<text x="${toX(idx).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="#bbb">${p.time}</text>`;
  }).join("");
  const dots = points.map((p, i) =>
    `<circle cx="${toX(i).toFixed(1)}" cy="${toY(p.value).toFixed(1)}" r="4" fill="${p.color || "#2196F3"}" stroke="#fff" stroke-width="2"><title>${p.time}: ${Math.round(p.value)}分钟</title></circle>`
  ).join("");
  container.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">
      <defs><linearGradient id="cg${W}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#2196F3" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#2196F3" stop-opacity="0.02"/>
      </linearGradient></defs>
      ${yTicks}
      <line x1="${pL}" y1="${pT}" x2="${pL}" y2="${pT + cH}" stroke="#ddd" stroke-width="1"/>
      <path d="${fill}" fill="url(#cg${W})"/>
      <path d="${line}" fill="none" stroke="#2196F3" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}${xLabels}
    </svg>`;
}
