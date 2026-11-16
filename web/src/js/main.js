import { feeShare, groupShare, presetLines, statement } from "./pricing.js";
import { renderStatement } from "./statement.js";
import { distChart, esc, pctFmt, usd } from "./charts.js";
import { npiRecord, pricingTables, zipToLocality } from "./data.js";
import { SPEC_NAMES, impactGroup } from "./names.js";
import { searchNames } from "./search.js";
import { initMap } from "./map.js";
import { shareImage } from "./share.js";

window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
window.va("beforeSend", (e) => ({ ...e, url: e.url.split(/[?#]/)[0] }));

const boot = JSON.parse(document.getElementById("boot").textContent);
const $ = (s, r = document) => r.querySelector(s);
const tip = $("#tip");
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const scrollToStatement = () => $("#statement").scrollIntoView({ behavior: still ? "auto" : "smooth" });

let T = null; // { table, m25, rbcs }
const st = {
  who: null, title: "", specKey: boot.defaultSpec, zip: "", locKey: null, qp: false, aco: false,
  lines: [], volumes: "", expanded: false, source: "preset",
  edited: false, recZip: "", recSpec: null, // NPI statements: edited lines, and the record's own ZIP and group
};

/* ---------------- tooltips ---------------- */
function showTip(html, ev) {
  tip.innerHTML = html;
  tip.style.display = "block";
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
const hideTip = () => { tip.style.display = "none"; };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); });

/* One persistent polite region (#live) for every announcement. Latest wins, except that a notice (a toast)
   and the statement total that follows it (e.g. an unknown ZIP, then the repriced total) are read together.
   kind: "note" (a toast), "total" (the repriced statement), "hint" (a result count: never merged, a total drops it). */
const live = $("#live");
let note = "", total = "", noteIsHint = false, liveTimer = 0;
function announce(msg, kind = "note") {
  if (kind === "total") { total = msg; if (noteIsHint) note = ""; } else { note = msg; noteIsHint = kind === "hint"; if (noteIsHint) total = ""; }
  clearTimeout(liveTimer);
  live.textContent = ""; // cleared now and set after the pause, so a repeated message is read again
  liveTimer = setTimeout(() => {
    live.textContent = [note, total].filter(Boolean).join(" ");
    note = total = "";
  }, 300);
}
function toast(msg, { quiet = false } = {}) {
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("aria-hidden", "true"); // read out through #live
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
  if (!quiet) announce(msg);
}

/* ---------------- statement ---------------- */
const specByKey = Object.assign(Object.create(null), Object.fromEntries(boot.specs.map((s) => [s.key, s])));

function locFor(key) {
  return (key && boot.localities[key]) || { g26: [1, 1, 1], g27: [1, 1, 1], name: "National average" };
}

function compute() {
  const cfKind = st.qp ? "qp" : "nonqp";
  const loc = locFor(st.locKey);
  const ctx = {
    table: T.table, loc, anesWeights: boot.anesWeights, cfKind,
    m25: T.m25.factors[st.specKey] || null,
    aco: st.aco,
    share: st.who ? feeShare(st.who.type) : groupShare(st.specKey),
  };
  return { res: statement(st.lines, ctx), cfKind, loc };
}

let drawnLoc; // locality at the last draw: the map only repaints its "you" marker when this changes
/** Where focus is in the statement: its action, its line (the object, so take the mark before changing st.lines),
    and its position among controls with that action, read from the DOM before a redraw replaces it. */
function focusMark(root) {
  const a = document.activeElement;
  if (!root.contains(a) || a === root) return null;
  const act = a.dataset.act;
  const tr = a.closest("tr[data-i]");
  return { act, line: tr ? st.lines[Number(tr.dataset.i)] : null, at: act ? [...root.querySelectorAll(`[data-act="${act}"]`)].indexOf(a) : -1, rows: root.querySelectorAll("tr[data-i]").length };
}
function focusRestore(root, m) {
  const same = m.act ? [...root.querySelectorAll(`[data-act="${m.act}"]`)] : [];
  const j = m.line ? st.lines.indexOf(m.line) : -1;
  const el = (j >= 0 && root.querySelector(`tr[data-i="${j}"] [data-act="${m.act}"]`)) // the same line, if it is still shown
    || (m.act === "more" && root.querySelectorAll("tr[data-i]")[m.rows]?.querySelector("[data-act]")) // first newly shown line
    || (m.act === "rm" && same[Math.min(m.at, same.length - 1)]) // after a removal: the next line's Remove, or the last
    || (m.line && m.act !== "rm" ? $("#statement h2") : root.querySelector("#add-code")); // a line no longer shown: the heading
  el?.focus({ preventScroll: true });
}

/* An edit to the lines not yet drawn (touch() sets it; a services box sets it and draws on the next tick). Any redraw
   of the same statement marks the statement edited; a new statement (a preset or clinician load) replaces the lines
   the edit was made on, so drops it. */
let editPending = false;
function markEdited() {
  if (st.source === "preset") { st.source = "custom"; st.title = `${st.title}, edited`; }
  if (st.source === "npi") { st.edited = true; st.volumes = st.volumes.replace(/( \(edited\))?$/, " (edited)"); }
}

/** press: a new statement (the stamp animates; focus is the caller's business). quiet: drawn from the URL, not announced. */
function draw({ press = false, quiet = false, mark = null } = {}) {
  const root = $("#st-root");
  if (!T) return;
  if (editPending && !press) markEdited();
  editPending = false;
  const { res, cfKind, loc } = compute();
  const view = {
    ...st,
    specName: SPEC_NAMES[st.specKey] || st.specKey,
    locName: st.locKey ? `${loc.name}, ${loc.state}` : "National average (no ZIP)",
  };
  if (!press) mark ??= focusMark(root);
  root.innerHTML = renderStatement(view, res, {
    table: T.table, rbcs: T.rbcs, cf: { 2026: T.table.cf[2026][cfKind], 2027: T.table.cf[2027][cfKind] },
  });
  if (mark && !press) focusRestore(root, mark);
  if (!quiet) {
    announce(res.rows.length
      ? `Statement updated: ${pctFmt(res.pct)}, ${res.change > 0 ? "+" : ""}${usd(res.change, 0)} for the same services in 2027.`
      : "Statement updated: no fee-schedule services.", "total");
  }
  if (!press) root.querySelector(".stamp")?.classList.remove("press");
  st.last = res;
  highlightSpec(st.specKey);
  drawDist(st.specKey, res);
  writeUrl();
  if (st.locKey !== drawnLoc) {
    drawnLoc = st.locKey;
    document.dispatchEvent(new Event("rv:locality"));
  }
}

function loadPreset(key, { scroll = false, quiet = false } = {}) {
  loadSeq++;
  const s = specByKey[key];
  if (!s) return;
  st.who = null;
  st.specKey = key;
  st.title = `Typical ${s.name.toLowerCase()} practice`;
  st.volumes = `CMS 2025 claims, average services per ${s.name.toLowerCase()} practitioner (${(s.practitionersK * 1000).toLocaleString("en-US")} nationally)`;
  st.lines = presetLines(s.preset);
  st.expanded = false;
  st.source = "preset";
  st.edited = false;
  $("#st-spec").value = key;
  draw({ press: true, quiet });
  if (scroll) scrollToStatement();
}

let loadSeq = 0; // bumped by every lookup or preset load, so late async steps can tell they're stale

/** Load a clinician's statement. Resolves after drawing (or after the fallback, if the NPI can't be loaded). */
async function loadNpi(npi, { scroll = true, quiet = false } = {}) {
  const res = $("#q-results");
  // Nothing on the statement yet (e.g. a shared ?npi= link): show a typical practice instead of an empty sheet.
  const fallback = async (why) => {
    if (st.lines.length) return;
    await ready;
    loadPreset(boot.defaultSpec, { quiet });
    toast(`${why} Showing a typical practice instead.`, { quiet });
  };
  const seq = ++loadSeq;
  try {
    const rec = await npiRecord(npi);
    if (!rec) {
      showList(res, true);
      res.innerHTML = `<li class="msg">No clinician with NPI ${esc(npi)} in CMS's ${boot.dataYear} file. The file covers clinicians who billed Medicare Part B fee-for-service that year.</li>`;
      await fallback(`No clinician with NPI ${npi} in CMS's ${boot.dataYear} file.`);
      return;
    }
    await ready;
    if (seq !== loadSeq) return; // a newer lookup started meanwhile
    st.who = { name: rec.name, npi: rec.npi, type: rec.providerType };
    st.specKey = impactGroup(rec.providerType);
    st.locKey = rec.locality || null;
    st.zip = rec.zip5 || "";
    st.recZip = st.zip;
    st.recSpec = st.specKey;
    st.edited = false;
    $("#st-zip").value = st.zip;
    st.lines = rec.lines;
    st.volumes = `${rec.providerType}, ${rec.city}, ${rec.state}. CMS public file, ${rec.dataYear} services (the latest year published)`;
    st.expanded = false;
    st.source = "npi";
    if (specByKey[st.specKey]) $("#st-spec").value = st.specKey;
    const picked = res.contains(document.activeElement); // a result button had focus: it is about to be hidden
    showList(res, false);
    draw({ press: true, quiet });
    if (picked) $("#statement h2").focus({ preventScroll: true });
    if (scroll) scrollToStatement();
  } catch (e) {
    showList(res, true);
    res.innerHTML = `<li class="msg">${esc(e.message)}</li>`;
    await fallback(`Couldn't load NPI ${npi}: ${e.message}`);
  }
}

/* URL state: ?npi=…[&s=…&z=…&l=…] (an NPI statement's changes from its record) or ?s=<specialty>&z=<zip>&qp=1&l=code:pos:n,… */
const linesParam = () => st.lines.map((l) => `${l.mod ? `${l.hcpcs}-${l.mod}` : l.hcpcs}:${l.pos}:${Math.round(l.services * 10) / 10}`).join(",");
function parseLines(l) {
  return l.split(",").slice(0, 400).map((t) => {
    const [code, pos, n] = t.split(":");
    const [hcpcs, mod = ""] = (code || "").toUpperCase().split("-");
    return { hcpcs, mod, pos: pos === "F" ? "F" : "O", services: Math.max(0, Number(n) || 0) };
  }).filter((x) => /^[0-9A-Z]{5}$/.test(x.hcpcs) && /^(|26|TC)$/.test(x.mod));
}
function writeUrl() {
  const p = new URLSearchParams();
  if (st.source === "npi" && st.who) {
    p.set("npi", st.who.npi);
    if (st.specKey !== st.recSpec) p.set("s", st.specKey);
    if (st.zip !== st.recZip) p.set("z", st.zip);
    if (st.edited) p.set("l", linesParam());
  } else {
    p.set("s", st.specKey);
    if (st.source === "custom") p.set("l", linesParam());
    if (st.zip) p.set("z", st.zip);
  }
  if (st.qp) p.set("qp", "1");
  if (st.aco) p.set("aco", "1");
  history.replaceState(null, "", `?${p}${location.hash}`);
}

async function readUrl() {
  const p = new URLSearchParams(location.search);
  st.qp = p.get("qp") === "1";
  st.aco = p.get("aco") === "1";
  $("#st-qp").checked = st.qp;
  $("#st-aco").checked = st.aco;
  const npi = p.get("npi");
  const s = p.get("s");
  const z = p.get("z");
  const l = p.get("l");
  if (npi && /^\d{10}$/.test(npi)) {
    await loadNpi(npi, { scroll: false, quiet: true });
    if (st.source !== "npi" || st.who?.npi !== npi) return; // not found (fell back) or superseded
    const seq = loadSeq;
    const recLines = st.lines;
    let changed = false;
    if (s && specByKey[s]) { st.specKey = s; $("#st-spec").value = s; changed = true; }
    if (z != null && (z === "" || /^\d{5}$/.test(z)) && z !== st.zip) {
      const key = z ? await zipToLocality(z) : null;
      if (seq !== loadSeq) return; // the reader looked up someone else meanwhile
      $("#st-zip").value = z;
      st.zip = z;
      st.locKey = key;
      changed = true;
    }
    if (l != null) {
      // Keep each line's average allowed amount from the record (anesthesia lines are priced from it).
      const avg = new Map(recLines.map((x) => [`${x.hcpcs}-${x.mod}:${x.pos}`, x.avgAllowed]));
      st.lines = parseLines(l).map((x) => ({ ...x, avgAllowed: avg.get(`${x.hcpcs}-${x.mod}:${x.pos}`) }));
      markEdited();
      changed = true;
    }
    if (changed) draw({ press: true, quiet: true });
    return;
  }
  loadPreset(specByKey[s] ? s : boot.defaultSpec, { quiet: true });
  if (z && /^\d{5}$/.test(z)) { $("#st-zip").value = z; await setZip(z, { quiet: true }); }
  if (l) {
    st.lines = parseLines(l);
    st.source = "custom";
    st.title = "Custom practice";
    st.volumes = "Entered on this page";
    draw({ quiet: true });
  }
}

async function setZip(z, { quiet = false } = {}) {
  st.zip = z;
  if (!z) { st.locKey = null; draw({ quiet }); return; }
  const key = await zipToLocality(z);
  st.locKey = key;
  if (!key) toast(`ZIP ${z} isn't in CMS's locality file. Using national rates.`, { quiet });
  draw({ quiet });
}

function wireStatement() {
  const root = $("#st-root");
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const tr = b.closest("tr[data-i]");
    const line = tr ? st.lines[Number(tr.dataset.i)] : null;
    const act = b.dataset.act;
    const mark = focusMark(root); // before st.lines changes
    if (act === "pos" && line) { line.pos = line.pos === "F" ? "O" : "F"; touch(mark); }
    if (act === "rm" && line) { st.lines.splice(Number(tr.dataset.i), 1); touch(mark); }
    if (act === "more") { st.expanded = true; draw({ quiet: true }); }
    if (act === "link") {
      try { await navigator.clipboard.writeText(location.href); toast("Link copied"); } catch { toast("Copy the address bar to share this statement"); }
    }
    if (act === "share") shareImage(st, st.last, { specName: SPEC_NAMES[st.specKey] || "", locName: locFor(st.locKey).name, url: boot.siteUrl });
    if (act === "add") addCode(b.dataset.code);
  });
  root.addEventListener("change", (e) => {
    if (e.target.dataset.act !== "svc") return;
    const tr = e.target.closest("tr[data-i]");
    const line = st.lines[Number(tr.dataset.i)];
    line.services = Math.max(0, Number(e.target.value) || 0);
    editPending = true;
    // Draw on the next tick: a Tab fires change before focus moves, so focus is then on the control it went to.
    setTimeout(() => { if (editPending) draw(); });
  });
  let suggestTimer = 0;
  root.addEventListener("input", (e) => {
    if (e.target.id !== "add-code") return;
    const q = e.target.value;
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => suggestCodes(q), 120);
  });
  root.addEventListener("keydown", (e) => {
    if (e.target.id === "add-code" && e.key === "Enter") {
      e.preventDefault();
      if (e.isComposing || e.keyCode === 229) return; // Enter confirms an IME conversion: not an add
      clearTimeout(suggestTimer);
      suggestCodes(e.target.value);
      const first = $("#add-results button");
      if (first) addCode(first.dataset.code);
      return;
    }
    if (e.target.closest(".addrow")) listKeys(e, $("#add-code"), $("#add-results"));
  });
  document.addEventListener("click", (e) => {
    const ul = $("#add-results");
    if (ul && !ul.hidden && !e.target.closest(".addrow")) showList(ul, false);
  });
  $("#st-spec").addEventListener("change", (e) => {
    if (st.source === "npi" || st.source === "custom") { st.specKey = e.target.value; draw(); }
    else loadPreset(e.target.value);
  });
  $("#st-zip").addEventListener("change", (e) => setZip(e.target.value.trim()));
  $("#st-qp").addEventListener("change", (e) => { st.qp = e.target.checked; draw(); });
  $("#st-aco").addEventListener("change", (e) => { st.aco = e.target.checked; draw(); });
}

function touch(mark) {
  editPending = true;
  draw({ mark });
}

/** Show or hide a result list (the lookup and the add-a-code box). `clear` empties it too, so ArrowDown can't reopen old results. */
function showList(ul, open, { clear = false } = {}) {
  ul.hidden = !open;
  if (clear) ul.replaceChildren();
}

/** Arrow keys and Escape for a text box and its list of result buttons. ArrowDown reopens a closed list that has results. */
function listKeys(e, input, ul) {
  const items = [...ul.querySelectorAll("button")];
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" && items.length) { e.preventDefault(); showList(ul, true); items[Math.min(items.length - 1, i + 1)].focus(); }
  if (e.key === "ArrowUp" && i >= 0) { e.preventDefault(); (items[i - 1] ?? input).focus(); }
  if (e.key === "Escape") { showList(ul, false); input.focus(); }
}

let codeIndex = null;
function suggestCodes(q) {
  const ul = $("#add-results");
  q = q.trim().toLowerCase();
  if (q.length < 2) { showList(ul, false, { clear: true }); return; }
  if (!codeIndex) {
    codeIndex = Object.keys(T.table.codes).map((k) => {
      const base = k.split("-")[0];
      const lbl = T.table.labels[base] || (T.rbcs[base] ? T.rbcs[base][1] || T.rbcs[base][0] : "");
      return { k, lbl, hay: `${k.toLowerCase()} ${lbl.toLowerCase()}`, own: !!T.table.labels[base] };
    }).filter((c) => {
      // Only codes the statement can price in both years (or a deleted code CMS crosswalks to 2027 codes).
      const r = T.table.codes[c.k];
      // G2211 has no 2027 RVUs but is priced as modifier B1/B2 on the visits.
      return ((r[0] != null || r[2] != null) && (r[4] != null || r[6] != null)) || !!T.table.crosswalk[c.k] || c.k === "G2211";
    });
  }
  const words = q.split(/\s+/);
  const hits = codeIndex
    .filter((c) => words.every((w) => c.hay.includes(w)))
    .sort((a, b) => (b.k.toLowerCase().startsWith(q) - a.k.toLowerCase().startsWith(q)) || (b.own - a.own) || a.k.localeCompare(b.k))
    .slice(0, 8);
  showList(ul, true);
  announce(hits.length ? `${hits.length} ${hits.length === 1 ? "suggestion" : "suggestions"}. Press Down to choose.` : "No fee-schedule code matches.", "hint");
  ul.innerHTML = hits.length
    ? hits.map((c) => `<li><button type="button" data-act="add" data-code="${esc(c.k)}"><span class="who typed">${esc(c.k)}</span><span class="what">${esc(c.lbl || "No label")}</span></button></li>`).join("")
    : `<li class="msg">No fee-schedule code matches “${esc(q)}”.</li>`;
}

function addCode(k) {
  const [hcpcs, mod = ""] = k.split("-");
  const r = T.table.codes[k];
  // Default to office only where 2027 has a non-facility rate (or, for a code deleted in 2027, 2026 had one).
  const officeOk = r && (r[5] != null || (r[4] == null && r[6] == null && r[1] != null));
  st.lines.unshift({ hcpcs, mod, pos: officeOk ? "O" : "F", services: 100 });
  touch({}); // an empty mark: focus goes back to the add-a-code box
}

/* ---------------- lookup ---------------- */
function wireLookup() {
  const form = $("#lookup");
  const input = $("#q");
  const ul = $("#q-results");
  let timer = 0;
  let seq = 0;
  const run = async () => {
    const q = input.value.trim();
    const my = ++seq;
    if (/^\d{10}$/.test(q)) { showList(ul, false, { clear: true }); loadNpi(q); return; }
    if (q.replace(/[^a-z]/gi, "").length < 2) { showList(ul, false, { clear: true }); return; }
    showList(ul, true);
    ul.innerHTML = `<li class="msg">Searching…</li>`;
    try {
      const hits = await searchNames(q, 30);
      if (my !== seq) return;
      ul.innerHTML = hits.length
        ? hits.map((h) => `<li><button type="button" data-npi="${esc(h.npi)}"><span class="who">${esc(h.name)}</span><span class="typed muted">${esc(h.npi)}</span><span class="what">${esc(h.type)}, ${esc(h.city)}, ${esc(h.state)}</span></button></li>`).join("")
        : `<li class="msg">No match in CMS's ${boot.dataYear} file. Try last name first, or the NPI.</li>`;
      announce(hits.length ? `${hits.length} ${hits.length === 1 ? "clinician" : "clinicians"} found. Press Down to choose.` : ul.textContent, "hint");
    } catch (e) {
      if (my !== seq) return;
      ul.innerHTML = `<li class="msg">${esc(e.message)}</li>`;
      announce(e.message);
    }
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 220); });
  form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); run(); });
  ul.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-npi]");
    if (b) loadNpi(b.dataset.npi);
  });
  document.addEventListener("click", (e) => { if (!ul.hidden && !form.contains(e.target)) showList(ul, false); });
  const keys = (e) => listKeys(e, input, ul);
  input.addEventListener("keydown", keys);
  ul.addEventListener("keydown", keys);
  $("#hero-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-spec]");
    if (b) ready.then(() => loadPreset(b.dataset.spec, { scroll: true }));
  });
}

/* ---------------- specialty chart ---------------- */
let highlighted;
function highlightSpec(key) {
  if (key === highlighted) return;
  highlighted = key;
  document.querySelectorAll(".specchart .spec-row").forEach((g) => g.classList.toggle("you", g.dataset.key === key));
}
function wireSpecChart() {
  const svg = $(".specchart");
  if (!svg) return;
  const html = (k) => {
    const s = specByKey[k];
    return `<b>${esc(s.name)}</b><table>
      <tr><td>CMS impact table (RVUs only)</td><td>${pctFmt(s.cms, 0)}</td></tr>
      <tr><td>Conversion factor</td><td>${pctFmt(s.cf)}</td></tr>
      <tr><td>Geographic indices</td><td>${pctFmt(s.gpci)}</td></tr>
      <tr><td><b>Per service, 2027</b></td><td><b>${pctFmt(s.all)}</b></td></tr>
      <tr><td>2026 allowed charges</td><td>$${s.allowedMil.toLocaleString("en-US")}M</td></tr></table>
      <span class="muted">Click to load a typical practice</span>`;
  };
  svg.addEventListener("mousemove", (e) => {
    const g = e.target.closest(".spec-row");
    if (g) showTip(html(g.dataset.key), e); else hideTip();
  });
  svg.addEventListener("mouseleave", hideTip);
  const pick = (g) => ready.then(() => loadPreset(g.dataset.key, { scroll: true }));
  svg.addEventListener("click", (e) => { const g = e.target.closest(".spec-row"); if (g) pick(g); });
  svg.addEventListener("keydown", (e) => {
    const g = e.target.closest(".spec-row");
    if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(g); }
  });
  svg.addEventListener("focusin", (e) => {
    const g = e.target.closest(".spec-row");
    if (!g) return;
    const r = g.getBoundingClientRect();
    showTip(html(g.dataset.key), { clientX: r.left + r.width * 0.6, clientY: r.bottom });
  });
  svg.addEventListener("focusout", hideTip);
}

/* ---------------- distribution ---------------- */
const BIN_EDGES = [-0.2, -0.1, -0.05, -0.02, -0.01, 0.01, 0.02, 0.05, 0.1, 0.2];
function binOf(p) {
  let i = 0;
  while (i < BIN_EDGES.length && p >= BIN_EDGES[i]) i++;
  return i;
}
let drawnDist;
function drawDist(key, res) {
  const s = specByKey[key] || specByKey[$("#dist-spec").value];
  if (!s || !s.dist) return;
  $("#dist-spec").value = s.key;
  // CMS's bins measure the change in total RVUs: compare the statement's RVU-and-rules effect only.
  const you = res && s.key === st.specKey && res.totals.cf ? binOf(res.effects.rvu / res.totals.cf) : -1;
  const memo = `${s.key}|${you}`;
  if (memo === drawnDist) return;
  drawnDist = memo;
  $("#dist-fig .chart-scroll").innerHTML = distChart(s.dist, boot.bins, you);
  $("#dist-fig figcaption").textContent = `${s.name}: share of about ${(s.practitionersK * 1000).toLocaleString("en-US")} practitioners by their change in total RVUs, CMS's 2025-claims estimate.${you >= 0 ? " “You” is the statement above, relative values and payment rules only." : ""}`;
}

/* Narrow screens: a chart wider than its column scrolls sideways (site.css). While it does, it is a named, focusable
   region keyboard users can scroll; otherwise it is a plain wrapper, so wide screens get no empty landmarks. */
const fitOnBlur = new WeakSet();
function fitScroll(el) {
  if (el.scrollWidth > el.clientWidth + 1) {
    el.tabIndex = 0;
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", el.dataset.label);
  } else if (el === document.activeElement) {
    if (fitOnBlur.has(el)) return; // not while it has focus: once, when it loses it
    fitOnBlur.add(el);
    el.addEventListener("blur", () => { fitOnBlur.delete(el); fitScroll(el); }, { once: true });
  } else {
    for (const a of ["tabindex", "role", "aria-label"]) el.removeAttribute(a);
  }
}
const fitScroller = new ResizeObserver((ents) => ents.forEach((x) => fitScroll(x.target)));
document.querySelectorAll(".chart-scroll").forEach((el) => fitScroller.observe(el));

/* ---------------- history hover ---------------- */
function wireHistory() {
  const svg = $(".history");
  if (!svg) return;
  svg.addEventListener("mousemove", (e) => {
    const r = e.target.closest(".hhit");
    if (!r) return hideTip();
    showTip(`<b>${r.dataset.year}</b><table><tr><td>Conversion factor</td><td>$${Number(r.dataset.cf).toFixed(4)}</td></tr><tr><td>1992 CF grown by the MEI</td><td>$${r.dataset.mei}</td></tr></table>`, e);
  });
  svg.addEventListener("mouseleave", hideTip);
}

/* ---------------- hero: the printer feeds the remittance, then the 2027 column types in ---------------- */
function playDemo() {
  const demo = $(".demo");
  if (!demo || still) return;
  const cells = [...demo.querySelectorAll("td.y27, tfoot .y27")];
  const stamp = demo.querySelector(".stamp");
  const finals = cells.map((c) => c.textContent);
  cells.forEach((c) => { c.textContent = ""; });
  demo.querySelectorAll("td.chg, tfoot .chg").forEach((c) => { c.style.visibility = "hidden"; });
  if (stamp) stamp.style.visibility = "hidden";
  demo.querySelector(".printer").classList.add("feeding");
  let i = 0;
  const typeNext = () => {
    if (i >= cells.length) {
      demo.querySelectorAll("td.chg, tfoot .chg").forEach((c) => { c.style.visibility = ""; });
      if (stamp) { stamp.style.visibility = ""; stamp.classList.add("press"); }
      return;
    }
    const c = cells[i];
    const txt = finals[i];
    let k = 0;
    c.classList.add("typing");
    const t = setInterval(() => {
      c.textContent = txt.slice(0, ++k);
      if (k >= txt.length) { clearInterval(t); c.classList.remove("typing"); i++; setTimeout(typeNext, 110); }
    }, 34);
  };
  setTimeout(typeNext, 2500);
}

function slideSpecialties() {
  const svg = $(".specchart");
  if (!svg || still) return;
  const r = svg.getBoundingClientRect();
  if (r.top < innerHeight * 0.8) return; // already in view: leave it still
  svg.classList.add("pre");
  const io = new IntersectionObserver((ents) => {
    if (!ents.some((x) => x.isIntersecting)) return;
    io.disconnect();
    requestAnimationFrame(() => requestAnimationFrame(() => svg.classList.remove("pre")));
  }, { threshold: 0.2 });
  io.observe(svg);
}

/* ---------------- start ---------------- */
const ready = pricingTables().then(([table, m25, rbcs]) => { T = { table, m25, rbcs }; });
wireLookup();
wireSpecChart();
wireHistory();
playDemo();
slideSpecialties();
wireStatement();
$("#dist-spec").addEventListener("change", (e) => drawDist(e.target.value, e.target.value === st.specKey ? st.last : null));
ready.then(readUrl).catch((e) => { $("#st-root").insertAdjacentHTML("afterbegin", `<p class="empty">${esc(e.message)}</p>`); });
initMap({ boot, getTable: () => ready.then(() => T.table), getYou: () => st.locKey, showTip, hideTip });
