// The statement: a remittance-style sheet with the same services priced at 2026 and 2027 rates.
import { esc, pctFmt, usd } from "./charts.js";
import { HOW_NOTES } from "./names.js";

const clsPct = (v) => (v < -0.0005 ? "cut" : v > 0.0005 ? "raise" : "");
const clsUsd = (v) => (v < -0.005 ? "cut" : v > 0.005 ? "raise" : "");
const signed = (v, d = 2) => (v > 0 ? "+" : "") + usd(v, d);
const SHOW_LINES = 14;

function labelFor(code, table, rbcs) {
  const base = code.split("-")[0];
  const mod = code.includes("-") ? code.split("-")[1] : "";
  const own = table?.labels?.[base];
  const cat = rbcs?.[base];
  const lbl = own || (cat ? cat[1] || cat[0] : "");
  const modTxt = mod === "26" ? "professional component" : mod === "TC" ? "technical component" : mod ? `modifier ${mod}` : "";
  return { lbl, sub: [modTxt, !own && cat ? "CMS category" : ""].filter(Boolean).join(" · ") };
}

function effectRow(name, v, base, scale) {
  const p = base ? v / base : 0;
  const w = Math.min(50, (Math.abs(p) / scale) * 50);
  const side = p < 0 ? `right:50%;width:${w}%` : `left:50%;width:${w}%`;
  return `<span>${name}</span><span class="bar" aria-hidden="true"><i class="${p < 0 ? "neg" : "pos"}" style="${side}"></i></span><span class="v ${clsPct(p)}">${pctFmt(p)}</span>`;
}

/**
 * state: { who, specName, locName, locKey, volumes, lines, qp, expanded }
 * res: output of pricing.statement()
 */
export function renderStatement(state, res, { table, rbcs, cf }) {
  const { who } = state;
  const head = `
  <div class="sheet-title"><span>MEDICARE PHYSICIAN FEE SCHEDULE: SAME SERVICES, PRICED TWO WAYS</span><span>CY2026 → CY2027</span></div>
  <div class="sheet-head">
    <div class="box w2"><span class="lab">Rendering clinician</span><div class="val">${esc(who ? who.name : state.title || "Typical practice")}</div></div>
    <div class="box"><span class="lab">NPI</span><div class="val">${esc(who ? who.npi : "—")}</div></div>
    <div class="box w2"><span class="lab">Specialty group (CMS)</span><div class="val">${esc(state.specName || "—")}</div></div>
    <div class="box"><span class="lab">Locality</span><div class="val">${esc(state.locName || "National average")}</div></div>
    <div class="box w4"><span class="lab">Volumes</span><div class="val">${esc(state.volumes || "")}</div></div>
    <div class="box w2"><span class="lab">Conversion factor${state.qp ? " (QP)" : ""}</span><div class="val">$${cf[2026].toFixed(4)} → $${cf[2027].toFixed(4)}</div></div>
  </div>`;

  const total = res.totals.base;
  const pct = res.pct;
  const stamp = res.rows.length
    ? `<div class="stamp ${clsPct(pct)} press" aria-hidden="true">${pct < -0.0005 ? "CUT" : pct > 0.0005 ? "RAISE" : "FLAT"} ${pctFmt(Math.abs(pct)).replace(/^[+−]/, "")}<small>2027 vs 2026</small></div>`
    : "";

  const rows = state.expanded ? res.rows : res.rows.slice(0, SHOW_LINES);
  let body = "";
  for (const r of rows) {
    const code = r.line.mod ? `${r.line.hcpcs}-${r.line.mod}` : r.line.hcpcs;
    const { lbl, sub } = labelFor(code, table, rbcs);
    const d = r.y27 - r.y26;
    const per26 = r.line.services ? r.y26 / r.line.services : 0;
    const per27 = r.line.services ? r.y27 / r.line.services : 0;
    const how = r.how && HOW_NOTES[r.how] ? HOW_NOTES[r.how] : "";
    body += `<tr data-i="${r.idx}">
      <td class="code">${esc(code)}</td>
      <td class="lbl">${esc(lbl) || '<span class="muted">No plain-English label yet</span>'}${sub || how ? `<small>${esc([sub, how].filter(Boolean).join(". "))}</small>` : ""}</td>
      <td><button type="button" class="pos" data-act="pos" aria-label="Place of service: ${r.line.pos === "F" ? "facility" : "office"}. Switch">${r.line.pos === "F" ? "Facility" : "Office"}</button></td>
      <td class="n v"><input class="svc" data-act="svc" type="number" min="0" step="1" value="${Math.round(r.line.services * 10) / 10}" aria-label="Services per year for ${esc(code)}"></td>
      <td class="n v hide-sm">${usd(per26)}</td>
      <td class="n v hide-sm">${usd(per27)}</td>
      <td class="n v delta ${clsPct(per26 ? d / r.y26 : 0)}">${per26 ? pctFmt(per27 / per26 - 1) : ""}</td>
      <td class="n v ${clsUsd(d)}">${signed(d, 0)}</td>
      <td><button type="button" class="x" data-act="rm" aria-label="Remove ${esc(code)}">×</button></td>
    </tr>`;
  }
  const adjRows = [
    ["mod25", "Same-day modifier-25 reduction", "CMS's average for this specialty: 20% off all but the highest-paid service when a visit and a 0-day procedure fall on the same day"],
  ].filter(([k]) => res.adj && Math.abs(res.adj[k].y27) >= 0.5)
    .map(([k, name, note]) => `<tr class="adj"><td class="code">adj.</td><td class="lbl">${name}<small>${note}</small></td><td></td><td></td><td class="n v hide-sm"></td><td class="n v hide-sm">${usd(res.adj[k].y27, 0)}</td><td></td><td class="n v ${clsUsd(res.adj[k].y27)}">${signed(res.adj[k].y27, 0)}</td><td></td></tr>`).join("");
  const more = !state.expanded && res.rows.length > SHOW_LINES
    ? `<tr><td colspan="9"><button type="button" class="btn ghost small" data-act="more">Show all ${res.rows.length} lines</button></td></tr>`
    : "";

  const table_ = res.rows.length ? `
  <div class="lines-wrap"><table class="lines">
    <thead><tr><th>Code</th><th>Service</th><th>Place</th><th class="n">Services a year</th><th class="n hide-sm">2026 rate</th><th class="n hide-sm">2027 rate</th><th class="n">Rate change</th><th class="n">Dollar change</th><th><span class="sr">Remove</span></th></tr></thead>
    <tbody>${body}${more}${adjRows}</tbody>
    <tfoot><tr><td colspan="4">Total, ${res.rows.length} fee-schedule ${res.rows.length === 1 ? "line" : "lines"}</td><td class="n v hide-sm">${usd(total, 0)}</td><td class="n v hide-sm">${usd(res.totals.full, 0)}</td><td class="n v ${clsPct(pct)}">${pctFmt(pct)}</td><td class="n v ${clsUsd(res.change)}">${signed(res.change, 0)}</td><td></td></tr></tfoot>
  </table></div>` : `<p class="empty">No fee-schedule services yet. Add a code below, or start from a specialty.</p>`;

  const add = `
  <div class="addrow">
    <div class="box"><span class="lab">Add a code (number or plain words)</span><input id="add-code" type="text" autocomplete="off" spellcheck="false" placeholder="99214, knee replacement, echo" aria-label="Add a code" aria-controls="add-results"></div>
    <ul class="results suggest" id="add-results" hidden></ul>
  </div>`;

  const scale = Math.max(0.03, Math.abs(res.effects.cf / (total || 1)), Math.abs(res.effects.rvu / (total || 1)), Math.abs(res.effects.gpci / (total || 1)));
  const foot = res.rows.length ? `
  <div class="sheet-foot">
    <div>
      <div class="effects">
        ${effectRow("Conversion factor", res.effects.cf, total, scale)}
        ${effectRow("Relative values and payment rules", res.effects.rvu, total, scale)}
        ${effectRow("Geographic indices (GPCI)", res.effects.gpci, total, scale)}
      </div>
    </div>
    <div class="foot-total"><!--stamp-->
      <div class="total-big ${clsPct(pct)}">${signed(res.change, 0)}</div>
      <div class="total-sub">${pctFmt(pct)} for the same ${res.rows.length === 1 ? "service" : "services"} in 2027${state.who ? ", at this clinician's last reported volume" : ""}.</div>
      <p style="margin:0.8rem 0 0;display:flex;gap:0.5rem;flex-wrap:wrap"><button type="button" class="btn small" data-act="share">Make a share image</button><button type="button" class="btn ghost small" data-act="link">Copy link</button></p>
    </div>
  </div>` : "";

  const off = res.off.length
    ? `<p class="offsched">${res.off.length} ${res.off.length === 1 ? "line is" : "lines are"} paid outside the physician fee schedule (drugs, lab tests, supplies) and ${res.off.length === 1 ? "is" : "are"} left out.</p>`
    : "";

  return `<div class="sheet">${head}${table_}${add}${foot.replace("<!--stamp-->", stamp)}${off}</div>`;
}
