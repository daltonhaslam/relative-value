// Build docs/index.html: data + pre-rendered charts + copy, CSS and JS inlined; fonts copied; vercel.json CSP hashed.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { presetLines, price, statement } from "./src/js/pricing.js";
import { esc, historyChart, pctFmt, specialtyChart, specialtyTable, usd, waterfall, distChart } from "./src/js/charts.js";
import { SPEC_NAMES } from "./src/js/names.js";

const R = (p) => new URL(`../${p}`, import.meta.url);
const read = (p) => readFileSync(R(p), "utf8");
const json = (p) => JSON.parse(read(p));
const SITE_URL = process.env.SITE_URL || "https://relative-value-rho.vercel.app";
const FEEDBACK = "https://docs.google.com/forms/d/e/1FAIpQLSekdB41siZs44_4gLNBGD2OqalK2TGNk7o8Q0bHl20ggYBy_Q/viewform"
  + `?entry.2047320042=${encodeURIComponent("Relative Value")}&entry.1326474028=${encodeURIComponent(SITE_URL + "/")}`;
const DATA_DATE = "November 5, 2026 (CY2027 PFS final rule, public inspection November 4, 2026)";

const codes = json("docs/data/codes.json");
const locs = json("docs/data/localities.json");
const specs = json("docs/data/specialties.json");
const effects = json("pipeline/stats/specialty_effects.json");
const b12 = json("pipeline/stats/cms_b12.json");
const CFR = codes.cf[2027].nonqp / codes.cf[2026].nonqp - 1;
const CFR_QP = codes.cf[2027].qp / codes.cf[2026].qp - 1;
const CF_CUT = pctFmt(CFR, 2).slice(1); // "2.31%", the size of the cut without its sign

/* ---------- specialty rows ---------- */
const rows = specs.specialties
  .filter((s) => SPEC_NAMES[s.name])
  .map((s) => {
    const e = effects.groups[s.name];
    const gpci = e ? e.gpci : 0;
    const anes = s.name === "ANESTHESIOLOGY" || s.name === "NURSE ANES / ANES ASST";
    const cf = anes ? codes.anesCf[2027].nonqp / codes.anesCf[2026].nonqp - 1 : CFR;
    const all = (1 + s.cms.combined) * (1 + cf) * (1 + gpci) - 1;
    return {
      key: s.name, name: SPEC_NAMES[s.name], cms: s.cms.combined, cf, gpci, all,
      allowedMil: s.allowedMil, practitionersK: s.practitionersK, dist: s.dist, preset: s.preset,
    };
  })
  .sort((a, b) => b.all - a.all);
// The prose below names these specialties; fail the build if the data moves them.
if (rows[0].key !== "CLINICAL SOCIAL WORKER" || rows[1].key !== "CLINICAL PSYCHOLOGIST" || rows[rows.length - 1].key !== "ORTHOPEDIC SURGERY") {
  throw new Error(`SPEC_BODY names clinical social workers and psychologists as the biggest gains and orthopedic surgery as the biggest loss; the data now has ${rows[0].key}, ${rows[1].key} first and ${rows[rows.length - 1].key} last. Update SPEC_BODY.`);
}
const nCut = rows.filter((r) => r.all < -0.0005).length;
const nRaise = rows.filter((r) => r.all > 0.0005).length;
const pick = (k) => rows.find((r) => r.key === k);

/* ---------- demo statement (typical family medicine, national) ---------- */
const DEMO_SPEC = "FAMILY PRACTICE";
const demoSpec = pick(DEMO_SPEC);
const demoLines = presetLines(demoSpec.preset.slice(0, 6));
const fx = json("docs/data/m25.json");
const demoRes = statement(demoLines, {
  table: codes, loc: { g26: [1, 1, 1], g27: [1, 1, 1] }, anesWeights: locs.anesWeights, cfKind: "nonqp", m25: fx.factors[DEMO_SPEC],
});
const cls = (v) => (v < -0.0005 ? "cut" : v > 0.0005 ? "raise" : "");
function demoHtml() {
  let body = "";
  for (const r of demoRes.rows) {
    const code = r.line.mod ? `${r.line.hcpcs}-${r.line.mod}` : r.line.hcpcs;
    const p26 = r.y26 / r.line.services, p27 = r.y27 / r.line.services;
    body += `<tr><td class="code">${code}</td><td class="lbl">${esc(codes.labels[r.line.hcpcs] || "")}${r.line.pos === "F" ? "<small>in a facility</small>" : ""}</td><td class="n v">${usd(p26)}</td><td class="n v y27">${usd(p27)}</td><td class="n v chg ${cls(p27 / p26 - 1)}">${pctFmt(p27 / p26 - 1)}</td></tr>`;
  }
  const pct = demoRes.pct;
  return `<div class="printer"><div class="slot" aria-hidden="true"><i></i></div><div class="paper-clip"><div class="sheet">
    <div class="sheet-title"><span>REMITTANCE PREVIEW, CY2027</span><span>National rates</span></div>
    <div class="stamp ${cls(pct)}" aria-hidden="true">${pct < 0 ? "CUT" : "RAISE"} ${pctFmt(Math.abs(pct)).slice(1)}<small>2027 vs 2026</small></div>
    <div class="lines-wrap"><table class="lines">
      <thead><tr><th>Code</th><th>Service</th><th class="n">2026</th><th class="n">2027</th><th class="n">Change</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="2">A year of these six${demoRes.adj.mod25.y27 ? "*" : ""}</td><td class="n v">${usd(demoRes.totals.base, 0)}</td><td class="n v y27">${usd(demoRes.totals.full, 0)}</td><td class="n v chg ${cls(pct)}">${pctFmt(pct)}</td></tr></tfoot>
    </table></div>
    <p class="caption">An average family physician's six highest-paid services in CMS's 2025 claims, at national rates.${demoRes.adj.mod25.y27 ? " *Total includes CMS's average modifier-25 reduction." : ""}</p>
  </div></div></div>`;
}

/* ---------- conversion factor waterfall ---------- */
const cf26 = codes.cf[2026].nonqp, cfNoBump = 32.5863, cfUpd = cfNoBump * 1.0025;
// The literals above are CMS's published steps; fail the build if the data no longer agrees with them.
if (Math.abs(cfNoBump * 1.0025 * 0.9988 - codes.cf[2027].nonqp) >= 0.0006 || Math.abs(cf26 / 1.025 - cfNoBump) >= 0.0006) {
  throw new Error("Conversion factor waterfall literals (cfNoBump, +0.25%, -0.12%) no longer reproduce codes.json; update build.mjs.");
}
const steps = [
  { label: "2026 conversion factor", sub: "includes a one-year 2.50% increase", value: cf26 },
  { label: "The 2.50% increase ends", sub: "Pub. L. 119-21 §71202", value: cfNoBump - cf26 },
  { label: "Statutory update, +0.25%", sub: "SSA §1848(d)(20); +0.75% for QPs", value: cfUpd - cfNoBump },
  { label: "Budget neutrality, −0.12%", sub: "offsets 2027 relative-value changes", value: codes.cf[2027].nonqp - cfUpd },
  { label: "2027 conversion factor", sub: "non-qualifying APM", value: codes.cf[2027].nonqp },
];

/* ---------- history ---------- */
const hist = read("pipeline/history/history.csv").trim().split(/\r?\n/);
const hh = hist[0].split(",");
const parseCsv = (line) => { const out = []; let cur = "", q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
let meiRun = null;
const series = hist.slice(1).map(parseCsv).map((p) => {
  const o = Object.fromEntries(hh.map((k, i) => [k, p[i]]));
  const year = Number(o.year);
  const cf = Number(o.cf_wtd || o.cf);
  meiRun = meiRun == null ? cf : meiRun * (1 + Number(o.mei_pct) / 100);
  return { year, cf, mei: meiRun };
});
const h0 = series[0], hN = series[series.length - 1];

/* ---------- drivers (CMS-1848-F, public-inspection page cites) ---------- */
const p90837 = [2026, 2027].map((rvuYear) => price(codes, "90837", { rvuYear, pos: "O" }));
// Joint replacement: the copy names 27130 and 27447 with one pair of work RVUs.
const tka = codes.codes["27447"], tha = codes.codes["27130"];
if (tka[0] !== tha[0] || tka[4] !== tha[4]) throw new Error(`Drivers copy gives 27130 and 27447 one pair of work RVUs; the data has 27130 ${tha[0]} -> ${tha[4]}, 27447 ${tka[0]} -> ${tka[4]}. Update the joint-replacement driver.`);
const pTka = [2026, 2027].map((rvuYear) => price(codes, "27447", { rvuYear, pos: "F" }));
const tkaPct = pctFmt(pTka[1] / pTka[0] - 1, 0);
// B1 on a level-4 established visit vs the G2211 it replaces (2026 non-facility total RVUs).
if (codes.b1.b1 !== 0.16 || codes.b1.b2 !== 0.32) throw new Error(`Copy says B1 is 16% and B2 32% of work RVUs; codes.json has ${codes.b1.b1}, ${codes.b1.b2}. Update the G2211 driver, HOW_NOTES and methods.`);
const b1Rvu = (codes.b1.b1 * codes.codes["99214"][4]).toFixed(2);
const g2211 = codes.codes.G2211;
const g2211Rvu = (g2211[0] + g2211[1] + g2211[3]).toFixed(2);
// The end of the work GPCI floor: the lowest 2027 work GPCI and the localities at it.
const minWork27 = Math.min(...Object.values(locs.localities).map((l) => l.g27[0]));
const lowest = Object.values(locs.localities).filter((l) => l.g27[0] === minWork27).map((l) => l.name);
const andList = (a) => (a.length < 3 ? a.join(" and ") : `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`);
const lowestTxt = `${andList(lowest)} ${lowest.length === 1 ? "falls" : "fall"} furthest, to ${minWork27.toFixed(3)}.`;
const drivers = [
  [pctFmt(CFR, 2), "The conversion factor", `${usd(codes.cf[2026].nonqp, 4)} becomes ${usd(codes.cf[2027].nonqp, 4)}. Most of that is the end of 2026's one-year 2.50% increase; the statute's +0.25% update and a −0.12% budget-neutrality factor follow. Qualifying APM participants get ${usd(codes.cf[2027].qp, 4)} (${pctFmt(CFR_QP, 2)}). CMS's specialty table leaves this out: the conversion factor updates "are not captured in the specialty impacts" (PI pp. 1971–1977).`],
  ["−20%", "Same-day visits with modifier 25", "When an office visit billed with modifier 25 falls on the same day as a 0-day-global procedure by the same physician, or a same-specialty colleague in the group, every service except the highest-paid one is paid 20% less. CMS had proposed 50% across 0-, 10- and 90-day globals. It hits dermatology, otolaryngology and orthopedics hardest (PI pp. 402–403, 1974)."],
  ["G2211 → B1", "The complexity add-on becomes a modifier", `G2211 ends. Office and home visits instead carry modifier B1, worth 16% of the visit's work RVUs, or B2 (32%) for Shared Savings Program ACO and LEAD participants. On a level-4 established visit B1 adds ${b1Rvu} RVU; G2211 added ${g2211Rvu} (PI pp. 329, 341; CMS B1/B2 file). CMS's budget-neutrality math expects B1 and B2 to pay about $${(b12.b12Dollars2027 / 1e9).toFixed(1)} billion in 2027. In CMS's ${effects.dataYear} clinician file G2211 paid $${Math.round(effects.g2211.dollars2026 / 1e6)} million at 2026 rates; B1 on those same visits would pay $${Math.round(effects.g2211.b1SameVisits2027 / 1e6)} million.`],
  ["½", "The indirect practice cost index is halved", "CMS is removing the index it uses to spread indirect practice costs across specialties: half in 2027, all of it in 2028. A new cap limits any code's practice-expense change to 5% a year (PI p. 1974)."],
  [tkaPct, "Total hip and knee replacement", `Work RVUs for 27130 and 27447 fall from ${tka[0].toFixed(2)} to ${tka[4].toFixed(2)}. With the conversion factor, the national facility payment for a total knee drops from ${usd(pTka[0])} to ${usd(pTka[1])} (CMS selected-procedures file).`],
  [pctFmt(p90837[1] / p90837[0] - 1, 1), "Behavioral health", `The last of four annual behavioral-health work increases and the practice-expense changes lift psychotherapy: 90837 in an office goes from $${p90837[0].toFixed(2)} to $${p90837[1].toFixed(2)} nationally. Clinical social workers (${pctFmt(pick("CLINICAL SOCIAL WORKER").cms, 0)}) and psychologists (${pctFmt(pick("CLINICAL PSYCHOLOGIST").cms, 0)}) lead CMS's table (PI pp. 1973–1974).`],
  [`1.0 → ${minWork27.toFixed(3)}`, "The work GPCI floor ends", `Since 2004 no locality's work GPCI could be below 1.0. The statute ends that floor for services on or after January 1, 2027 (SSA §1848(e)(1)(E), as amended by Pub. L. 119-75 §6208). It isn't offset anywhere in the 2027 conversion factor. ${lowestTxt}`],
  ["Not in 2027", "The efficiency adjustment", "The −2.5% cut to work RVUs for non-time-based services applied in 2026 is not repeated. CMS plans it every three years; the next is CY2029 (PI pp. 114–115)."],
];

/* ---------- copy ---------- */
// methods.html is static text with ${name} placeholders for figures that come from the data.
function fillMethods(src) {
  const m = {
    effects_year: String(effects.dataYear),
    cf26: usd(codes.cf[2026].nonqp, 4), cf26qp: usd(codes.cf[2026].qp, 4),
    cf27: usd(codes.cf[2027].nonqp, 4), cf27qp: usd(codes.cf[2027].qp, 4),
    anes26: usd(codes.anesCf[2026].nonqp, 4), anes27: usd(codes.anesCf[2027].nonqp, 4),
    b12_bil: `$${(b12.b12Dollars2027 / 1e9).toFixed(1)}`,
    clinicians_mil: (effects.clinicians / 1e6).toFixed(2),
  };
  return src.replace(/\$\{(\w+)\}/g, (_, k) => {
    if (!(k in m)) throw new Error(`methods.html placeholder \${${k}} has no value in build.mjs fillMethods`);
    return m[k];
  });
}
const below = Object.values(locs.localities).filter((l) => l.g27[0] < 1).length;
const nLoc = Object.keys(locs.localities).length;
const pct0 = (v) => `${Math.round(v * 100)}%`;
const mil = (v) => `${(v / 1e6).toFixed(2)} million`;
const copy = {
  DESCRIPTION: `The 2027 Medicare physician fee schedule cuts the conversion factor ${CF_CUT} and ends the work GPCI floor. See every specialty's change and price any clinician's own services and locality.`,
  HERO_DEK: `In 2027 the conversion factor falls <strong>${CF_CUT}</strong> and the floor under the work GPCI ends. Priced on what each clinician billed in ${effects.dataYear}, <strong>${pct0(effects.cut / effects.clinicians)}</strong> of the ${mil(effects.clinicians)} clinicians in CMS's public file are paid less for the same work. Look anyone up.`,
  LOOKUP_NOTE: `Names, NPIs and service counts are from CMS's public file of Medicare Part B services by clinician (${effects.dataYear}, the latest year published). Your searches and entries are not recorded or sent anywhere. Page views are counted anonymously with Vercel Web Analytics: no cookies, no personal identifiers, only the page path.`,
  HERO_CHIPS: ["FAMILY PRACTICE", "INTERNAL MEDICINE", "CARDIOLOGY", "ORTHOPEDIC SURGERY", "DERMATOLOGY", "NURSE PRACTITIONER", "CLINICAL SOCIAL WORKER", "OPHTHALMOLOGY", "EMERGENCY MEDICINE", "RADIOLOGY"]
    .map((k) => `<button type="button" class="chip" data-spec="${esc(k)}">${esc(SPEC_NAMES[k])}</button>`).join(""),
  SPEC_LEDE: "CMS's impact table shows how each specialty's relative values move. It leaves out the conversion factor, which falls for everyone, and the end of the work GPCI floor.",
  SPEC_FACTS: `Priced clinician by clinician on the services each billed in ${effects.dataYear}, Medicare would pay $${(-effects.overall.change / 1e9).toFixed(1)} billion (${pctFmt(effects.overall.pct)}) less in 2027 for the same work; the median clinician sees ${pctFmt(effects.pctQuantiles.median)}. That is deeper than CMS's table because CMS assumes modifiers B1 and B2 will be billed far more often than G2211 was. The end of the work floor alone accounts for about $${Math.round(effects.floorCost / 1e6)} million, in the ${below} localities that lose it.`,
  N_CUT: String(nCut),
  N_RAISE: String(nRaise),
  SPEC_BODY: `Clinical social workers and psychologists gain the most, from practice-expense changes and the last step of the behavioral-health work increase. Orthopedic surgery and otolaryngology lose the most, from the new same-day modifier-25 reduction, the halving of the indirect practice cost index and, for joint replacement, ${/^(8|11|18)/.test(tkaPct.slice(1)) ? "an" : "a"} ${tkaPct.slice(1)} cut per case. Click a specialty to price a typical practice.`,
  SPEC_NOTE: `Each figure is a change in payment per service, holding the specialty's 2025 mix of services fixed. More or fewer services will move actual revenue. CMS rounds its table to whole percents, so the combined figures can be off by about half a point. Anesthesia services use the anesthesia conversion factor (${pctFmt(codes.anesCf[2027].nonqp / codes.anesCf[2026].nonqp - 1)}).`,
  SPEC_CHART: specialtyChart(rows) + specialtyTable(rows),
  SPEC_CAPTION: `Hollow mark: CMS's estimated impact of relative-value changes on 2027 allowed charges, by specialty (CY2027 PFS final rule specialty impact file, updated November 5, 2026). Filled mark: that change combined with the conversion factor (Tables D-B1, D-B2) and each specialty's average change in geographic indices, from CMS's ${effects.dataYear} clinician-level file priced at 2026 and 2027 GPCIs. Suppliers and facilities (labs, testing facilities, portable x-ray) are left off.`,
  SPEC_OPTIONS: [...rows].sort((a, b) => a.name.localeCompare(b.name)).filter((r) => r.preset.length).map((r) => `<option value="${esc(r.key)}"${r.key === DEMO_SPEC ? " selected" : ""}>${esc(r.name)}</option>`).join(""),
  STATEMENT_STATIC: `<p class="empty">The statement needs JavaScript. The specialty chart above and the methods below work without it.</p>`,
  STATEMENT_NOTE: "Rates are Medicare allowed amounts (Medicare's payment plus the patient's coinsurance) before sequestration and MIPS adjustments, which apply the same way in both years. Place of service follows CMS's file: “Office” is non-facility, “Facility” is a hospital or ASC. A clinician's locality comes from the practice ZIP in CMS's file; clinicians who work in several localities are priced in one.",
  DIST_LEDE: "CMS also estimates how the change spreads across individual practitioners. In most specialties a real share lands well above or below the average, because no two practices bill the same mix.",
  DIST_NOTE: "These bins count relative-value changes only, before the conversion factor and geographic changes. Anesthesia services are excluded, as in CMS's file.",
  DIST_CHART: distChart(pick(DEMO_SPEC).dist, specs.bins),
  MAP_LEDE: `Since 2004 no locality's work GPCI could fall below 1.0. That floor ends with 2026. In 2027, ${below} of ${nLoc} Medicare payment localities have a work GPCI below 1.0, so the same service pays less there on top of the national cut.`,
  MAP_OPTIONS: [["99214|O", "Established-patient office visit, level 4"], ["99213|O", "Established-patient office visit, level 3"], ["99232|F", "Hospital follow-up visit, level 2"], ["99284|F", "ED visit, level 4"], ["90837|O", "Psychotherapy, 60 minutes"], ["27447|F", "Total knee replacement"], ["93306|O", "Complete echocardiogram"], ["66984|F", "Cataract removal with lens implant"]]
    .map(([v, l], i) => `<option value="${v}"${i ? "" : " selected"}>${esc(l)} (${v.split("|")[0]})</option>`).join(""),
  MAP_ALT: "Map of US counties shaded by the 2026-to-2027 change in Medicare payment for the selected service in each payment locality.",
  MAP_CAPTION: "Each county takes its Medicare payment locality's rate (CMS 2026 locality-county file). 2026 work GPCIs include the 1.0 floor; 2027 work GPCIs are from Addendum E of the CY2027 final rule. Non-qualifying APM conversion factor.",
  WHY_LEDE: "Most of the 2027 cut isn't new. It's the end of a one-year 2.50% increase Congress set for 2026. Underneath, CMS moved value between specialties, and Congress let the work GPCI floor lapse.",
  WATERFALL: waterfall(steps),
  WATERFALL_CAPTION: `CY2027 PFS final rule, Table D-B2. The qualifying APM conversion factor follows the same steps with a +0.75% update: ${usd(codes.cf[2026].qp, 4)} to ${usd(codes.cf[2027].qp, 4)} (Table D-B1).`,
  DRIVERS: drivers.map(([fig, h, p]) => `<li><span class="fig">${esc(fig)}</span><div><h4>${esc(h)}</h4><p>${esc(p)}</p></div></li>`).join(""),
  HISTORY_LEDE: `In ${h0.year} the conversion factor was $${h0.cf.toFixed(2)}. In ${hN.year} it is $${hN.cf.toFixed(2)}. Over the same years CMS's Medicare Economic Index, its own measure of the cost of running a practice, rose ${Math.round((hN.mei / h0.cf - 1) * 100)}%. A ${h0.year} conversion factor grown by the MEI would be $${hN.mei.toFixed(2)} in ${hN.year}.`,
  HISTORY_NOTE: "Before 1998 Medicare had separate conversion factors for surgery, primary care and other services; the line follows the primary-care factor for 1993–1997. Years with a mid-year change use the day-weighted average. Values for 1992–1994 are from the House Ways and Means Green Book; later years from each year's final rule or CMS rate file. The 2027 MEI (2.6%) is CMS's estimate.",
  HISTORY_CHART: historyChart(series),
  HISTORY_CAPTION: "Conversion factor (non-qualifying APM from 2026) and the 1992 factor grown each year by the MEI used in that year's rule. Relative values are rescaled over time, so the conversion factor alone is not the price of any one service.",
  METHODS: fillMethods(read("web/src/methods.html")),
  FEEDBACK: FEEDBACK,
  DATA_DATE,
  SITE_URL,
};

/* ---------- boot data for the page script ---------- */
const bootData = {
  siteUrl: SITE_URL,
  dataYear: effects.dataYear,
  defaultSpec: DEMO_SPEC,
  anesWeights: locs.anesWeights,
  bins: specs.bins,
  localities: Object.fromEntries(Object.entries(locs.localities).map(([k, l]) => [k, { name: l.name, state: l.state, g26: l.g26, g27: l.g27 }])),
  specs: rows.map((r) => ({ key: r.key, name: r.name, cms: r.cms, cf: r.cf, gpci: r.gpci, all: r.all, allowedMil: r.allowedMil, practitionersK: r.practitionersK, dist: r.dist, preset: r.preset })),
};

/* ---------- bundle ---------- */
const js = await build({ entryPoints: [new URL("src/js/main.js", import.meta.url).pathname], bundle: true, format: "esm", minify: true, write: false, target: "es2020" });
const jsText = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = read("web/src/styles/site.css");
let html = read("web/src/shell.html");
const fill = { ...copy, CSS: css, JS: jsText, BOOT: JSON.stringify(bootData).replace(/</g, "\\u003c"), DEMO: demoHtml() };
html = html.replace(/\{\{([A-Z_0-9]+)\}\}/g, (m, k) => {
  if (!(k in fill)) throw new Error(`missing fill ${k}`);
  return fill[k];
});

mkdirSync(R("docs/fonts"), { recursive: true });
for (const f of ["@fontsource-variable/archivo/files/archivo-latin-standard-normal.woff2", "@fontsource/courier-prime/files/courier-prime-latin-400-normal.woff2", "@fontsource/courier-prime/files/courier-prime-latin-700-normal.woff2"]) {
  copyFileSync(new URL(`node_modules/${f}`, import.meta.url), R(`docs/fonts/${f.split("/").pop()}`));
}
copyFileSync(new URL("src/favicon.svg", import.meta.url), R("docs/favicon.svg"));
writeFileSync(R("docs/index.html"), html);

const sha = (s) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
const scriptHash = sha(jsText);
const vercel = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  framework: null,
  outputDirectory: "docs",
  redirects: [{ source: "/index.html", destination: "/", permanent: true }],
  headers: [
    { source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' ${scriptHash}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` },
    ] },
    { source: "/fonts/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    { source: "/data/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
  ],
};
writeFileSync(R("vercel.json"), JSON.stringify(vercel, null, 2) + "\n");
console.log(`docs/index.html ${(html.length / 1024).toFixed(0)} KB; ${nCut} cut, ${nRaise} raise; script ${scriptHash}`);
