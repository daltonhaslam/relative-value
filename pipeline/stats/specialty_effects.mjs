// Price every clinician in CMS's public file with the page's own pricing code (web/src/js/pricing.js),
// at their own locality, and aggregate: per-specialty geographic effect + headline counts.
// Run: node pipeline/stats/specialty_effects.mjs  (writes pipeline/stats/specialty_effects.json)
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { feeShare, statement } from "../../web/src/js/pricing.js";
import { impactGroup } from "../../web/src/js/names.js";

const D = (p) => new URL(`../../docs/data/${p}`, import.meta.url);
const table = JSON.parse(readFileSync(D("codes.json")));
const locs = JSON.parse(readFileSync(D("localities.json")));
const FX = JSON.parse(readFileSync(D("m25.json")));
const m25 = FX.factors;
const meta = JSON.parse(readFileSync(D("npi/meta.json")));
const F = meta.recordFields, L = meta.lineFields;
const [iHcpcs, iMod, iPos, iServices, iAvg] = ["hcpcs", "mod", "pos", "services", "avgAllowed"].map((k) => L.indexOf(k));

const groups = {};
const pcts = [];
let floorCost = 0;
const g2211 = { y26: 0, y27: 0, n: 0 };
let n = 0, nCut = 0, nRaise = 0, nNoLoc = 0, nEmpty = 0, nFloorLoss = 0;
const all = { base: 0, cf: 0, rvu: 0, full: 0 };
for (let s = 0; s < 1000; s++) {
  const shard = JSON.parse(gunzipSync(readFileSync(D(`npi/${String(s).padStart(3, "0")}.json.gz`))));
  for (const r of shard.recs) {
    const rec = Object.fromEntries(F.map((k, i) => [k, r[i]]));
    const loc = locs.localities[rec.locality];
    if (!loc) { nNoLoc++; continue; }
    const lines = rec.lines.map((l) => ({ hcpcs: l[iHcpcs], mod: l[iMod] || "", pos: l[iPos] === "F" ? "F" : "O", services: Number(l[iServices]), avgAllowed: l[iAvg] }));
    const g = impactGroup(rec.providerType);
    const res = statement(lines, { table, loc, anesWeights: locs.anesWeights, cfKind: "nonqp", m25: m25[g] || null, share: feeShare(rec.providerType) });
    if (!res.rows.length || res.totals.base <= 0) { nEmpty++; continue; }
    n++;
    if (res.pct < -0.0005) nCut++; else if (res.pct > 0.0005) nRaise++;
    if (loc.g26[0] === 1 && loc.g27[0] < 1) {
      nFloorLoss++;
      // Same 2027 prices with the work GPCI held at the 1.0 floor: the floor's own cost.
      const kept = statement(lines, { table, loc: { g26: loc.g26, g27: [1, loc.g27[1], loc.g27[2]] }, anesWeights: locs.anesWeights, cfKind: "nonqp", m25: m25[g] || null, share: feeShare(rec.providerType) });
      floorCost += kept.totals.full - res.totals.full;
    }
    pcts.push(res.pct);
    for (const row of res.rows) if (row.how === "b1" || row.how === "b2" || row.line.hcpcs === "G2211") { g2211.y26 += row.y26; g2211.y27 += row.y27; g2211.n++; }
    const a = (groups[g] ||= { n: 0, base: 0, cf: 0, rvu: 0, full: 0, cut: 0 });
    a.n++; if (res.pct < -0.0005) a.cut++;
    for (const k of Object.keys(all)) { a[k] += res.totals[k]; all[k] += res.totals[k]; }
  }
}
pcts.sort((a, b) => a - b);
const q = (p) => pcts[Math.floor(p * (pcts.length - 1))];
const out = {
  note: "Every clinician in CMS's Provider-and-Service file with a locality and at least one fee-schedule line, priced at its own locality, non-QP CF, CMS modifier-25 factors by specialty; G2211 becomes B1 on the same visits. gpci = full/rvu - 1 aggregated by impact group.",
  dataYear: meta.dataYear,
  floorCost: Math.round(floorCost), g2211: { clinicians: g2211.n, dollars2026: Math.round(g2211.y26), b1SameVisits2027: Math.round(g2211.y27) }, clinicians: n, cut: nCut, raise: nRaise, flat: n - nCut - nRaise, noLocality: nNoLoc, noFeeScheduleLines: nEmpty, inFloorLossLocalities: nFloorLoss,
  pctQuantiles: { p10: q(0.1), p25: q(0.25), median: q(0.5), p75: q(0.75), p90: q(0.9) },
  overall: { pct: all.full / all.base - 1, cf: all.cf / all.base - 1, rvu: all.rvu / all.cf - 1, gpci: all.full / all.rvu - 1, base: all.base, change: all.full - all.base },
  groups: Object.fromEntries(Object.entries(groups).map(([k, a]) => [k, { n: a.n, cut: a.cut, pct: a.full / a.base - 1, rvu: a.rvu / a.cf - 1, gpci: a.full / a.rvu - 1, base: Math.round(a.base) }])),
};
writeFileSync(new URL("specialty_effects.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, groups: undefined }, null, 1));
