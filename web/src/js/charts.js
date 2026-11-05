// SVG charts as strings: the build pre-renders them into the HTML, the page re-renders on change.
// Hover layers attach in main.js through data-* attributes.

const ENT = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ENT[c]);
export const pctFmt = (v, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%`;
export const usd = (v, d = 2) => `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
const cls = (v) => (v < -0.0005 ? "cut" : v > 0.0005 ? "raise" : "");

/** rows: [{ key, name, cms, all }] sorted for display. */
export function specialtyChart(rows, { you = null } = {}) {
  const W = 640, rowH = 23, top = 26, left = 196, right = 64;
  const H = top + rows.length * rowH + 8;
  const lo = Math.min(-0.1, ...rows.map((r) => Math.min(r.cms, r.all))) - 0.005;
  const hi = Math.max(0.12, ...rows.map((r) => Math.max(r.cms, r.all))) + 0.005;
  const x = lin(lo, hi, left, W - right);
  const ticks = [];
  for (let t = Math.ceil(lo * 20) / 20; t <= hi; t += 0.05) ticks.push(Math.round(t * 100) / 100);
  let s = `<svg class="chart specchart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="spec-t spec-d"><title id="spec-t">2027 change in Medicare payment per service, by specialty</title><desc id="spec-d">For each specialty, CMS's relative-value-only impact and the full change including the conversion factor and geographic changes. A table version follows the chart.</desc>`;
  s += `<g class="axis">`;
  for (const t of ticks) {
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${H - 4}" ${t === 0 ? 'class="zero"' : ""}/><text x="${x(t)}" y="${top - 11}" text-anchor="middle">${t === 0 ? "0" : pctFmt(t, 0)}</text>`;
  }
  s += `</g>`;
  rows.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2;
    const c = cls(r.all);
    s += `<g class="spec-row${r.key === you ? " you" : ""}" data-key="${esc(r.key)}" tabindex="0" role="button" aria-label="${esc(r.name)}: ${pctFmt(r.all)} with the conversion factor; CMS table ${pctFmt(r.cms, 0)}">`;
    s += `<rect class="hit" x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}"/>`;
    s += `<text class="name" x="${left - 12}" y="${y + 4}" text-anchor="end">${esc(r.name)}</text>`;
    s += `<line class="link" x1="${x(r.cms)}" x2="${x(r.all)}" y1="${y}" y2="${y}" style="--i:${i}"/>`;
    s += `<circle class="cms" cx="${x(r.cms)}" cy="${y}" r="4.5"/>`;
    s += `<circle class="all ${c}" cx="${x(r.all)}" cy="${y}" r="5.5" style="--dx:${(x(r.cms) - x(r.all)).toFixed(1)}px;--i:${i}"/>`;
    s += `<text class="num ${c}" x="${W - 2}" y="${y + 4}" text-anchor="end" style="--i:${i}">${pctFmt(r.all)}</text>`;
    s += `</g>`;
  });
  return s + `</svg>`;
}

export function specialtyTable(rows) {
  let s = `<details class="note"><summary>Table: every specialty</summary><table class="lines"><thead><tr><th>Specialty</th><th class="n">CMS table</th><th class="n">With CF and GPCI</th></tr></thead><tbody>`;
  for (const r of rows) s += `<tr><td>${esc(r.name)}</td><td class="n v">${pctFmt(r.cms, 0)}</td><td class="n v">${pctFmt(r.all)}</td></tr>`;
  return s + `</tbody></table></details>`;
}

/** steps: [{ label, value }] — first and last are totals, the middle are signed changes. */
export function waterfall(steps) {
  const W = 640, rowH = 46, top = 22, left = 230, right = 92;
  const H = top + steps.length * rowH + 22;
  let run = steps[0].value;
  const spans = steps.map((st, i) => {
    if (i === 0 || i === steps.length - 1) return { a: 0, b: st.value, total: true };
    const a = run;
    run += st.value;
    return { a, b: run, total: false };
  });
  const vals = spans.flatMap((p) => (p.total ? [p.b] : [p.a, p.b]));
  const lo = Math.floor((Math.min(...vals) - 0.15) * 10) / 10;
  const hi = Math.ceil((Math.max(...vals) + 0.1) * 10) / 10;
  const x = lin(lo, hi, left, W - right);
  let s = `<svg class="chart waterfall" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="wf-t"><title id="wf-t">How the 2027 conversion factor was built from the 2026 one</title><g class="axis">`;
  for (let t = lo; t <= hi + 1e-9; t += 0.2) {
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 4}" y2="${H - 18}"/><text x="${x(t)}" y="${H - 4}" text-anchor="middle">$${t.toFixed(2)}</text>`;
  }
  s += `</g>`;
  steps.forEach((st, i) => {
    const p = spans[i];
    const y = top + i * rowH;
    const x0 = p.total ? left : x(Math.min(p.a, p.b));
    const x1 = x(p.total ? p.b : Math.max(p.a, p.b));
    const kind = p.total ? "total" : st.value > 0 ? "step up" : "step";
    s += `<text class="lbl" x="${left - 12}" y="${y + 18}" text-anchor="end">${esc(st.label)}</text>`;
    if (st.sub) s += `<text class="lbl" x="${left - 12}" y="${y + 33}" text-anchor="end" style="fill:var(--ink-3)">${esc(st.sub)}</text>`;
    s += `<rect class="${kind}" x="${x0}" y="${y + 6}" width="${Math.max(2, x1 - x0)}" height="18" rx="2"/>`;
    s += `<text class="val" x="${x1 + 8}" y="${y + 20}">${p.total ? "$" + st.value.toFixed(4) : (st.value > 0 ? "+" : "−") + "$" + Math.abs(st.value).toFixed(4)}</text>`;
    if (!p.total && i < steps.length - 1) {
      s += `<line x1="${x(p.b)}" x2="${x(p.b)}" y1="${y + 24}" y2="${y + rowH + 6}" stroke="var(--neutral)" stroke-dasharray="2 2"/>`;
    }
  });
  return s + `<text x="${left}" y="${H - 4}" class="axis" style="font-size:10px;fill:var(--ink-3)" text-anchor="end" dx="-6">axis starts at $${lo.toFixed(2)}</text></svg>`;
}

/** series: [{ year, cf, mei }] (mei = the 1992 CF grown by CMS's MEI) */
export function historyChart(series) {
  const W = 640, H = 340, l = 44, r = 70, t = 16, b = 30;
  const y0 = 0, y1 = Math.ceil(Math.max(...series.map((d) => d.mei)) / 10) * 10;
  const xs = lin(series[0].year, series[series.length - 1].year, l, W - r);
  const ys = lin(y0, y1, H - b, t);
  const path = (k) => series.map((d, i) => `${i ? "L" : "M"}${xs(d.year).toFixed(1)},${ys(d[k]).toFixed(1)}`).join("");
  let s = `<svg class="chart history" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="hi-t"><title id="hi-t">Medicare conversion factor 1992 to 2027, against the same 1992 dollar grown by the Medicare Economic Index</title><g class="axis">`;
  for (let v = 0; v <= y1; v += 10) s += `<line x1="${l}" x2="${W - r}" y1="${ys(v)}" y2="${ys(v)}"/><text x="${l - 8}" y="${ys(v) + 4}" text-anchor="end">$${v}</text>`;
  for (const yr of [1992, 2000, 2010, 2020, 2027]) s += `<text x="${xs(yr)}" y="${H - 8}" text-anchor="middle">${yr}</text>`;
  s += `</g>`;
  s += `<path d="${path("mei")}" fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="5 4"/>`;
  s += `<path d="${path("cf")}" fill="none" stroke="var(--cut)" stroke-width="2.5"/>`;
  const last = series[series.length - 1];
  s += `<circle cx="${xs(last.year)}" cy="${ys(last.cf)}" r="4.5" fill="var(--cut)" stroke="var(--sheet)" stroke-width="2"/>`;
  s += `<circle cx="${xs(last.year)}" cy="${ys(last.mei)}" r="4.5" fill="var(--ink-3)" stroke="var(--sheet)" stroke-width="2"/>`;
  s += `<text x="${xs(last.year) + 8}" y="${ys(last.cf) + 4}" style="font-family:var(--typed);font-size:12px;fill:var(--ink)">$${last.cf.toFixed(2)}</text>`;
  s += `<text x="${xs(last.year) + 8}" y="${ys(last.mei) + 4}" style="font-family:var(--typed);font-size:12px;fill:var(--ink)">$${last.mei.toFixed(2)}</text>`;
  s += `<text x="${xs(2004)}" y="${ys(series.find((d) => d.year === 2004).mei) - 12}" style="font-size:12px;fill:var(--ink-2)">If it had kept pace with practice costs (MEI)</text>`;
  s += `<text x="${xs(2004)}" y="${ys(series.find((d) => d.year === 2004).cf) + 22}" style="font-size:12px;fill:var(--cut)">The conversion factor Medicare paid</text>`;
  const step = (W - l - r) / (series.length - 1);
  for (const d of series) {
    s += `<rect class="hhit" x="${xs(d.year) - step / 2}" y="${t}" width="${step}" height="${H - t - b}" fill="transparent" data-year="${d.year}" data-cf="${d.cf}" data-mei="${d.mei.toFixed(2)}"/>`;
  }
  return s + `</svg>`;
}

/** bins: 11 shares; labels: bin labels; youBin: index or -1 */
export function distChart(bins, labels, youBin = -1) {
  const W = 560, H = 260, l = 8, r = 8, t = 24, b = 54;
  const bw = (W - l - r) / bins.length;
  const max = Math.max(0.05, ...bins.map((v) => v || 0));
  const ys = lin(0, max, H - b, t);
  let s = `<svg class="chart dist" viewBox="0 0 ${W} ${H}" role="img" aria-label="Share of practitioners in each range of change in total RVUs">`;
  s += `<line class="zero" x1="${l}" x2="${W - r}" y1="${H - b}" y2="${H - b}"/>`;
  bins.forEach((v, i) => {
    const x = l + i * bw;
    const sign = i < 5 ? "neg" : i > 5 ? "pos" : "";
    const val = v || 0;
    s += `<rect class="bin ${sign}${i === youBin ? " you" : ""}" x="${x + 3}" y="${ys(val)}" width="${bw - 6}" height="${Math.max(0, H - b - ys(val))}" rx="2"><title>${esc(labels[i])}: ${(val * 100).toFixed(0)}% of practitioners</title></rect>`;
    if (val >= 0.005) s += `<text x="${x + bw / 2}" y="${ys(val) - 6}" text-anchor="middle" style="font-family:var(--typed);fill:var(--ink)">${(val * 100).toFixed(0)}%</text>`;
    const [a, c] = labels[i].split(" to ");
    s += `<text x="${x + bw / 2}" y="${H - b + 16}" text-anchor="middle">${esc(a)}</text>`;
    if (c) s += `<text x="${x + bw / 2}" y="${H - b + 30}" text-anchor="middle">to ${esc(c)}</text>`;
    if (i === youBin) s += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" style="font-weight:700;fill:var(--ink)">you</text>`;
  });
  return s + `</svg>`;
}
