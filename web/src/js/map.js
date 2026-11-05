// County map: every county takes its Medicare payment locality's rate for one service.
// Geometry is us-atlas counties-albers-10m (already projected to 975x610), so paths are planar.
import { feature } from "topojson-client";
import { price } from "./pricing.js";
import { esc, pctFmt, usd } from "./charts.js";
import { load } from "./data.js";

const ring = (pts) => `M${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L")}Z`;
function d(geom) {
  if (!geom) return "";
  if (geom.type === "Polygon") return geom.coordinates.map(ring).join("");
  if (geom.type === "MultiPolygon") return geom.coordinates.flatMap((p) => p.map(ring)).join("");
  if (geom.type === "MultiLineString") return geom.coordinates.map((l) => `M${l.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L")}`).join("");
  return "";
}

// Bins are anchored to the service's national change, so the map shows where geography adds to the cut.
const OFFSETS = [0.005, 0, -0.005, -0.01, -0.015];
function pctClass(v, nat) {
  if (v > 0.0005) return "qr";
  let i = 0;
  while (i < OFFSETS.length && v < nat + OFFSETS[i]) i++;
  return `q${i + 1}`; // q1 = better than national, q6 = 1.5+ points worse
}

export function initMap({ boot, getTable, getYou, showTip, hideTip }) {
  const root = document.getElementById("map-root");
  const scale = document.getElementById("map-scale");
  const codeSel = document.getElementById("map-code");
  const measSel = document.getElementById("map-measure");
  if (!root) return;
  let geo = null, table = null, svg = null, paths = null, vals = null;
  let byLoc = null; // locKey -> county paths
  let cache = null; // per selected code: { code, vals, nat, usdEdges, usdLo, usdHi }
  let youLoc = null;

  function stats() {
    const code = codeSel.value;
    if (cache?.code === code) return cache;
    const [key, pos] = code.split("|");
    vals = {};
    for (const [k, l] of Object.entries(boot.localities)) {
      const a = price(table, key, { rvuYear: 2026, gpci: l.g26, pos });
      const b = price(table, key, { rvuYear: 2027, gpci: l.g27, pos });
      vals[k] = a && b ? { a, b, pct: b / a - 1 } : null;
    }
    const usdVals = Object.values(vals).filter(Boolean).map((v) => v.b).sort((x, y) => x - y);
    const q = (p) => usdVals[Math.min(usdVals.length - 1, Math.floor(p * usdVals.length))];
    const nat = price(table, key, { rvuYear: 2027, pos }) / price(table, key, { rvuYear: 2026, pos }) - 1;
    cache = { code, nat, usdEdges: [q(1 / 6), q(2 / 6), q(3 / 6), q(4 / 6), q(5 / 6)], usdLo: usdVals[0], usdHi: usdVals[usdVals.length - 1] };
    return cache;
  }

  function paint() {
    const { nat, usdEdges, usdLo, usdHi } = stats();
    const meas = measSel.value;
    youLoc = getYou();
    for (const [loc, ps] of byLoc) {
      const v = vals[loc];
      let c = "qn";
      if (v) {
        if (meas === "pct") c = pctClass(v.pct, nat);
        else { let i = 0; while (i < usdEdges.length && v.b >= usdEdges[i]) i++; c = `u${i + 1}`; }
      }
      const cl = `c ${c}${loc === youLoc ? " you" : ""}`;
      for (const p of ps) p.setAttribute("class", cl);
    }
    if (meas === "pct") {
      scale.innerHTML = `<span>${pctFmt(nat + OFFSETS[0], 1)} or better</span><span class="ramp">${[1, 2, 3, 4, 5, 6].map((i) => `<i class="sw q${i}"></i>`).join("")}</span><span>${pctFmt(nat + OFFSETS[4], 1)} or worse</span><span class="muted">National change for this service: ${pctFmt(nat, 1)}. Steps every half point.</span>`;
    } else {
      scale.innerHTML = `<span>${usd(usdLo)}</span><span class="ramp">${[1, 2, 3, 4, 5, 6].map((i) => `<i class="sw u${i}"></i>`).join("")}</span><span>${usd(usdHi)}</span><span class="muted">2027 payment, in sixths of localities</span>`;
    }
  }

  // The locality changed: only the old and new "you" localities need their class touched.
  function moveYou() {
    const next = getYou();
    if (next === youLoc) return;
    for (const [loc, on] of [[youLoc, false], [next, true]]) {
      for (const p of byLoc.get(loc) || []) p.classList.toggle("you", on);
    }
    youLoc = next;
  }

  async function start() {
    root.innerHTML = `<p class="note">Loading the county map…</p>`;
    try {
      [geo, table] = await Promise.all([load("map/counties.json"), getTable()]);
    } catch (e) {
      root.innerHTML = `<p class="note">${esc(e.message)}</p>`;
      return;
    }
    const counties = feature(geo, geo.objects.counties).features;
    const states = geo.objects.statesMesh ? feature(geo, geo.objects.statesMesh) : null;
    const locMesh = geo.objects.localityMesh ? feature(geo, geo.objects.localityMesh) : null;
    let s = `<svg class="chart" viewBox="0 0 975 610" aria-hidden="true">`;
    for (const c of counties) s += `<path class="c" data-l="${esc(c.properties.l)}" data-n="${esc(c.properties.n)}" d="${d(c.geometry)}"/>`;
    if (locMesh) s += `<path class="st loc" d="${d(locMesh.geometry || locMesh)}"/>`;
    if (states) s += `<path class="st" d="${d(states.geometry || states)}"/>`;
    root.innerHTML = s + `</svg>`;
    svg = root.querySelector("svg");
    paths = [...svg.querySelectorAll("path.c")];
    byLoc = new Map();
    for (const p of paths) {
      const l = p.dataset.l;
      if (!byLoc.has(l)) byLoc.set(l, []);
      byLoc.get(l).push(p);
    }
    paint();
    svg.addEventListener("mousemove", (e) => {
      const p = e.target.closest("path.c");
      if (!p) return hideTip();
      const l = boot.localities[p.dataset.l];
      const v = vals[p.dataset.l];
      if (!l || !v) return hideTip();
      showTip(`<b>${esc(p.dataset.n)}</b><br><span class="muted">${esc(l.name)}, ${esc(l.state)} locality</span><table>
        <tr><td>2026</td><td>${usd(v.a)}</td></tr><tr><td>2027</td><td>${usd(v.b)}</td></tr>
        <tr><td>Change</td><td>${pctFmt(v.pct)}</td></tr>
        <tr><td>Work GPCI</td><td>${l.g26[0].toFixed(3)} → ${l.g27[0].toFixed(3)}</td></tr></table>`, e);
    });
    svg.addEventListener("mouseleave", hideTip);
  }

  codeSel.addEventListener("change", () => paths && paint());
  measSel.addEventListener("change", () => paths && paint());
  document.addEventListener("rv:locality", () => paths && moveYou());
  const io = new IntersectionObserver((ents) => {
    if (ents.some((x) => x.isIntersecting)) { io.disconnect(); start(); }
  }, { rootMargin: "400px" });
  io.observe(root);
}
