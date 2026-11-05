import { feeShare, groupShare, presetLines, statement } from "./pricing.js";
import { renderStatement } from "./statement.js";
import { distChart, esc, pctFmt } from "./charts.js";
import { npiRecord, pricingTables, zipToLocality } from "./data.js";
import { SPEC_NAMES, impactGroup } from "./names.js";
import { searchNames } from "./search.js";
import { initMap } from "./map.js";
import { shareImage } from "./share.js";

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
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
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
function draw({ press = false } = {}) {
  const root = $("#st-root");
  if (!T) return;
  const { res, cfKind, loc } = compute();
  const view = {
    ...st,
    specName: SPEC_NAMES[st.specKey] || st.specKey,
    locName: st.locKey ? `${loc.name}, ${loc.state}` : "National average (no ZIP)",
  };
  root.innerHTML = renderStatement(view, res, {
    table: T.table, rbcs: T.rbcs, cf: { 2026: T.table.cf[2026][cfKind], 2027: T.table.cf[2027][cfKind] },
  });
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

function loadPreset(key, { scroll = false } = {}) {
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
  draw({ press: true });
  if (scroll) scrollToStatement();
}

/** Load a clinician's statement. Resolves after drawing (or after the fallback, if the NPI can't be loaded). */
async function loadNpi(npi, { scroll = true } = {}) {
  const res = $("#q-results");
  // Nothing on the statement yet (e.g. a shared ?npi= link): show a typical practice instead of an empty sheet.
  const fallback = async () => {
    if (st.lines.length) return;
    await ready;
    loadPreset(boot.defaultSpec);
    toast(`No clinician with NPI ${npi} in CMS's ${boot.dataYear} file; showing a typical practice instead.`);
  };
  try {
    const rec = await npiRecord(npi);
    if (!rec) {
      res.hidden = false;
      res.innerHTML = `<li class="msg">No clinician with NPI ${esc(npi)} in CMS's ${boot.dataYear} file. The file covers clinicians who billed Medicare Part B fee-for-service that year.</li>`;
      await fallback();
      return;
    }
    await ready;
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
    res.hidden = true;
    draw({ press: true });
    if (scroll) scrollToStatement();
  } catch (e) {
    res.hidden = false;
    res.innerHTML = `<li class="msg">${esc(e.message)}</li>`;
    await fallback();
  }
}

/* URL state: ?npi=…[&s=…&z=…&l=…] (an NPI statement's changes from its record) or ?s=<specialty>&z=<zip>&qp=1&l=code:pos:n,… */
const linesParam = () => st.lines.map((l) => `${l.mod ? `${l.hcpcs}-${l.mod}` : l.hcpcs}:${l.pos}:${Math.round(l.services * 10) / 10}`).join(",");
function parseLines(l) {
  return l.split(",").slice(0, 200).map((t) => {
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
    await loadNpi(npi, { scroll: false });
    if (st.source !== "npi") return; // not found: loadNpi fell back to a typical practice
    if (s && specByKey[s]) { st.specKey = s; $("#st-spec").value = s; }
    if (z != null && (z === "" || /^\d{5}$/.test(z)) && z !== st.zip) { $("#st-zip").value = z; await setZip(z); }
    if (l != null) { st.lines = parseLines(l); st.edited = true; st.volumes = st.volumes.replace(/( \(edited\))?$/, " (edited)"); }
    draw();
    return;
  }
  loadPreset(specByKey[s] ? s : boot.defaultSpec);
  if (z && /^\d{5}$/.test(z)) { $("#st-zip").value = z; await setZip(z); }
  if (l) {
    st.lines = parseLines(l);
    st.source = "custom";
    st.title = "Custom practice";
    st.volumes = "Entered on this page";
    draw();
  }
}

async function setZip(z) {
  st.zip = z;
  if (!z) { st.locKey = null; draw(); return; }
  const key = await zipToLocality(z);
  st.locKey = key;
  if (!key) toast(`ZIP ${z} isn't in CMS's locality file. Using national rates.`);
  draw();
}

function wireStatement() {
  const root = $("#st-root");
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const tr = b.closest("tr[data-i]");
    const line = tr ? st.lines[Number(tr.dataset.i)] : null;
    const act = b.dataset.act;
    if (act === "pos" && line) { line.pos = line.pos === "F" ? "O" : "F"; touch(); }
    if (act === "rm" && line) { st.lines.splice(Number(tr.dataset.i), 1); touch(); }
    if (act === "more") { st.expanded = true; draw(); }
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
    touch();
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
      clearTimeout(suggestTimer);
      suggestCodes(e.target.value);
      const first = $("#add-results button");
      if (first) addCode(first.dataset.code);
    }
  });
  $("#st-spec").addEventListener("change", (e) => {
    if (st.source === "npi" || st.source === "custom") { st.specKey = e.target.value; draw(); }
    else loadPreset(e.target.value);
  });
  $("#st-zip").addEventListener("change", (e) => setZip(e.target.value.trim()));
  $("#st-qp").addEventListener("change", (e) => { st.qp = e.target.checked; draw(); });
  $("#st-aco").addEventListener("change", (e) => { st.aco = e.target.checked; draw(); });
}

function touch() {
  if (st.source === "preset") { st.source = "custom"; st.title = `${st.title}, edited`; }
  if (st.source === "npi") { st.edited = true; st.volumes = st.volumes.replace(/( \(edited\))?$/, " (edited)"); }
  draw();
}

let codeIndex = null;
function suggestCodes(q) {
  const ul = $("#add-results");
  q = q.trim().toLowerCase();
  if (q.length < 2) { ul.hidden = true; return; }
  if (!codeIndex) {
    codeIndex = Object.keys(T.table.codes).map((k) => {
      const base = k.split("-")[0];
      const lbl = T.table.labels[base] || (T.rbcs[base] ? T.rbcs[base][1] || T.rbcs[base][0] : "");
      return { k, lbl, hay: `${k.toLowerCase()} ${lbl.toLowerCase()}`, own: !!T.table.labels[base] };
    }).filter((c) => {
      // Only codes the statement can price in both years (or a deleted code CMS crosswalks to 2027 codes).
      const r = T.table.codes[c.k];
      return ((r[0] != null || r[2] != null) && (r[4] != null || r[6] != null)) || !!T.table.crosswalk[c.k];
    });
  }
  const words = q.split(/\s+/);
  const hits = codeIndex
    .filter((c) => words.every((w) => c.hay.includes(w)))
    .sort((a, b) => (b.k.toLowerCase().startsWith(q) - a.k.toLowerCase().startsWith(q)) || (b.own - a.own) || a.k.localeCompare(b.k))
    .slice(0, 8);
  ul.hidden = false;
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
  touch();
  $("#add-code")?.focus();
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
    if (/^\d{10}$/.test(q)) { loadNpi(q); return; }
    if (q.replace(/[^a-z]/gi, "").length < 2) { ul.hidden = true; return; }
    ul.hidden = false;
    ul.innerHTML = `<li class="msg">Searching…</li>`;
    try {
      const hits = await searchNames(q, 30);
      if (my !== seq) return;
      ul.innerHTML = hits.length
        ? hits.map((h) => `<li><button type="button" data-npi="${esc(h.npi)}"><span class="who">${esc(h.name)}</span><span class="typed muted">${esc(h.npi)}</span><span class="what">${esc(h.type)}, ${esc(h.city)}, ${esc(h.state)}</span></button></li>`).join("")
        : `<li class="msg">No match in CMS's ${boot.dataYear} file. Try last name first, or the NPI.</li>`;
    } catch (e) {
      ul.innerHTML = `<li class="msg">${esc(e.message)}</li>`;
    }
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 220); });
  form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); run(); });
  ul.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-npi]");
    if (b) loadNpi(b.dataset.npi);
  });
  document.addEventListener("click", (e) => { if (!form.contains(e.target)) ul.hidden = true; });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); ul.querySelector("button")?.focus(); }
    if (e.key === "Escape") ul.hidden = true;
  });
  ul.addEventListener("keydown", (e) => {
    const items = [...ul.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); (i <= 0 ? input : items[i - 1]).focus(); }
    if (e.key === "Escape") { ul.hidden = true; input.focus(); }
  });
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
  $("#dist-fig").innerHTML = distChart(s.dist, boot.bins, you)
    + `<figcaption>${esc(s.name)}: share of about ${(s.practitionersK * 1000).toLocaleString("en-US")} practitioners by their change in total RVUs, CMS's 2025-claims estimate.${you >= 0 ? " “You” is the statement above, relative values and payment rules only." : ""}</figcaption>`;
}

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
