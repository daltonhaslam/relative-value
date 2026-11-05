// Medicare PFS pricing, CY2026 vs CY2027. Pure functions: used by the page, the build and the tests.
//
// payment = (work RVU x work GPCI + PE RVU x PE GPCI + MP RVU x MP GPCI) x conversion factor
// Office (non-facility) lines use non-facility PE; a code with non-facility PE "NA" is paid at facility PE.

const IDX = { 2026: [0, 1, 2, 3], 2027: [4, 5, 6, 7] };
const ANES = /^0[01]\d{3}$/;

export const isAnesthesia = (hcpcs) => ANES.test(hcpcs);

export function codeKey(hcpcs, mod) {
  return mod ? `${hcpcs}-${mod}` : hcpcs;
}

/** RVUs for one year: { w, pe, mp } or null when the code isn't payable that year. */
export function rvus(table, key, year, pos) {
  const r = table.codes[key];
  if (!r) return null;
  const [iw, inf, ifac, imp] = IDX[year];
  if (r[iw] == null && r[ifac] == null) return null;
  const pe = pos === "F" ? r[ifac] : (r[inf] ?? r[ifac]);
  return { w: r[iw] ?? 0, pe: pe ?? 0, mp: r[imp] ?? 0 };
}

const NATIONAL = [1, 1, 1];

/** Payment for one service. gpci = [work, PE, MP]. cfKind = "nonqp" | "qp". */
export function price(table, key, { rvuYear, gpci = NATIONAL, cfYear = rvuYear, pos = "O", cfKind = "nonqp" }) {
  const v = rvus(table, key, rvuYear, pos);
  if (!v) return null;
  return (v.w * gpci[0] + v.pe * gpci[1] + v.mp * gpci[2]) * table.cf[cfYear][cfKind];
}

/** Anesthesia conversion factor for a locality: national anesthesia CF x CMS's locality blend. */
export function anesCf(table, weights, gpci, year, cfKind = "nonqp") {
  const [a, b, c] = weights;
  return table.anesCf[year][cfKind] * (a * gpci[0] + b * gpci[1] + c * gpci[2]);
}

/**
 * Price one statement line under a scenario { rvuYear, gpciYear, cfYear }.
 * Returns { amount, how } where how explains non-standard pricing, or null if not on the fee schedule.
 *
 * line: { hcpcs, mod, pos, services, avgAllowed }
 * ctx:  { table, loc: {g26, g27}, anesWeights, cfKind, m25, aco, share }  (m25: CMS factors for one specialty)
 */
export function priceLine(line, s, ctx) {
  const { table, loc, cfKind } = ctx;
  const gpci = s.gpciYear === 2026 ? loc.g26 : loc.g27;
  const key = codeKey(line.hcpcs, line.mod);

  if (isAnesthesia(line.hcpcs)) {
    // Base and time units aren't in CMS's public file: move the line's average allowed amount
    // by the change in this locality's anesthesia conversion factor.
    if (line.avgAllowed == null) return null;
    const base = anesCf(table, ctx.anesWeights, loc.g26, 2026, cfKind);
    const now = anesCf(table, ctx.anesWeights, gpci, s.cfYear, cfKind);
    return { amount: line.services * line.avgAllowed * (now / base), how: "anesthesia" };
  }

  if (line.hcpcs === "G2211" && s.rvuYear === 2027) {
    // G2211 ends in 2027. The same visits carry modifier B1 instead: 16% of the visit's work RVUs
    // (B2, 32%, for Shared Savings Program ACO and LEAD participants). Same visits, same count.
    const uplift = ctx.aco ? table.b1.b2 : table.b1.b1;
    const work = ctx.emWork27 ?? table.codes["99214"][4];
    const amt = uplift * work * gpci[0] * table.cf[s.cfYear][cfKind] * (ctx.share ?? 1);
    return { amount: line.services * amt, how: ctx.aco ? "b2" : "b1" };
  }

  const share = ctx.share ?? 1; // statutory share of the fee schedule (NP/PA 85%, LCSW and counselors 75%)
  let unit = price(table, key, { rvuYear: s.rvuYear, gpci, cfYear: s.cfYear, pos: line.pos, cfKind });
  if (unit == null && s.rvuYear === 2027 && table.crosswalk[key]) {
    // Code deleted for 2027: CMS's analytic crosswalk spreads its volume over the new codes.
    let sum = 0;
    let any = false;
    for (const [dst, ratio] of table.crosswalk[key]) {
      const p = price(table, dst, { rvuYear: 2027, gpci, cfYear: s.cfYear, pos: line.pos, cfKind });
      if (p != null) { sum += p * ratio; any = true; }
    }
    if (any) return { amount: line.services * sum * share, how: "crosswalk" };
  }
  if (unit == null) return null;
  const out = { amount: line.services * unit * share, how: null, adj: null };
  if (s.rvuYear === 2027) {
    // Modifier 25 (claims-time 20% same-day reduction): CMS's own average rate-setting factor for this
    // specialty, code and setting (2025 utilization file). Reported as its own adjustment row.
    const f25 = ctx.m25?.[`${key}|${line.pos === "F" ? "F" : "O"}`];
    if (f25 != null) out.adj = { mod25: out.amount * (f25 - 1) };
  }
  return out;
}

/** Services-weighted 2027 work RVU of the office and home visits on a statement (prices B1 for G2211). */
export function emWork27(table, lines) {
  let n = 0;
  let w = 0;
  for (const l of lines) {
    const r = table.codes[l.hcpcs];
    if (!table.b1.codes.includes(l.hcpcs) || !r || r[4] == null) continue;
    n += l.services;
    w += l.services * r[4];
  }
  return n ? w / n : null;
}

/** Medicare pays some clinicians a statutory share of the fee schedule amount. */
export function feeShare(providerType) {
  if (/^(Nurse Practitioner|Physician Assistant|Certified Clinical Nurse Specialist)$/.test(providerType || "")) return 0.85;
  if (/^(Licensed Clinical Social Worker|Licensed Professional Counselor|Marriage and Family Therapist)$/.test(providerType || "")) return 0.75;
  return 1;
}

const S = {
  base: { rvuYear: 2026, gpciYear: 2026, cfYear: 2026 },
  cf: { rvuYear: 2026, gpciYear: 2026, cfYear: 2027 },
  rvu: { rvuYear: 2027, gpciYear: 2026, cfYear: 2027 },
  full: { rvuYear: 2027, gpciYear: 2027, cfYear: 2027 },
};

/**
 * Price a whole statement. Steps are applied in order (conversion factor, then RVUs, then GPCIs)
 * so the three effects multiply to the total change.
 */
export function statement(lines, ctx) {
  const rows = [];
  const totals = { base: 0, cf: 0, rvu: 0, full: 0 };
  const adj = { mod25: { y26: 0, y27: 0 } };
  ctx = { ...ctx, emWork27: emWork27(ctx.table, lines) };
  const off = [];
  for (const line of lines) {
    const p = {};
    let ok = true;
    for (const k of Object.keys(S)) {
      const r = priceLine(line, S[k], ctx);
      if (!r) { ok = false; break; }
      p[k] = r;
    }
    if (!ok) { off.push(line); continue; }
    for (const k of Object.keys(S)) {
      totals[k] += p[k].amount;
      if (p[k].adj) totals[k] += p[k].adj.mod25;
    }
    if (p.full.adj) adj.mod25.y27 += p.full.adj.mod25;
    rows.push({ line, y26: p.base.amount, y27: p.full.amount, how: p.full.how || p.base.how });
  }
  const pct = (a, b) => (b ? a / b - 1 : 0);
  return {
    rows, off, totals, adj,
    change: totals.full - totals.base,
    pct: pct(totals.full, totals.base),
    effects: {
      cf: totals.cf - totals.base,
      rvu: totals.rvu - totals.cf,
      gpci: totals.full - totals.rvu,
    },
  };
}
