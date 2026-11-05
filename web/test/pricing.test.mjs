// National pricing must reproduce CMS's "Impact on CY 2027 Payment for Selected Procedures" to the cent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { price, statement, codeKey } from "../src/js/pricing.js";

const root = new URL("../../", import.meta.url);
const table = JSON.parse(readFileSync(new URL("docs/data/codes.json", root)));
const locs = JSON.parse(readFileSync(new URL("docs/data/localities.json", root)));
const cms = readFileSync(new URL("data/raw/pfs27/x/cy-2027-pfs-final-rule-impact-payment-selected-procedures/CMS-1848-F_Impact of Final Rule on CY 2026 Payment for Selected Procedures_508.txt", root), "latin1");

const money = (s) => (s && s.includes("$") ? Number(s.replace(/[$,"\s]/g, "")) : null);
const rows = cms.split(/\r?\n/).map((l) => l.split("\t")).filter((p) => /^[0-9A-Z]\d{3}[0-9A-Z]$/.test(p[0]));

test("selected procedures match CMS to the cent", () => {
  let n = 0;
  for (const p of rows) {
    const key = codeKey(p[0].trim(), p[1].trim());
    const want = { F26: money(p[3]), F27: money(p[4]), O26: money(p[6]), O27: money(p[7]) };
    for (const [k, v] of Object.entries(want)) {
      if (v == null) continue;
      const got = price(table, key, { rvuYear: Number("20" + k.slice(1)), pos: k[0] });
      assert.ok(got != null, `${key} ${k} missing`);
      assert.ok(Math.abs(got - v) <= 0.011, `${key} ${k}: got ${got.toFixed(2)} want ${v}`);
      n++;
    }
  }
  assert.ok(n > 60, `only ${n} comparisons`);
});

test("statement effects multiply to the total and CF effect equals the CF ratio", () => {
  const loc = locs.localities["10112-00"]; // Alabama: work GPCI falls from the 1.0 floor
  const ctx = { table, loc, anesWeights: locs.anesWeights, cfKind: "nonqp" };
  const lines = [
    { hcpcs: "99214", mod: "", pos: "O", services: 1000 },
    { hcpcs: "27447", mod: "", pos: "F", services: 50 },
  ];
  const s = statement(lines, ctx);
  assert.equal(s.rows.length, 2);
  const cfRatio = table.cf[2027].nonqp / table.cf[2026].nonqp;
  assert.ok(Math.abs(s.totals.cf / s.totals.base - cfRatio) < 1e-12);
  assert.ok(Math.abs(s.effects.cf + s.effects.rvu + s.effects.gpci - s.change) < 1e-6);
  assert.ok(s.effects.gpci < 0, "Alabama loses the work floor");
});

test("G2211 becomes modifier B1 on the same visits, and lines off the fee schedule are set aside", () => {
  const ctx = { table, loc: { g26: [1, 1, 1], g27: [1, 1, 1] }, anesWeights: locs.anesWeights, cfKind: "nonqp" };
  const s = statement([
    { hcpcs: "99214", mod: "", pos: "O", services: 100 },
    { hcpcs: "G2211", mod: "", pos: "O", services: 100 },
    { hcpcs: "J1100", mod: "", pos: "O", services: 10, avgAllowed: 1 },
  ], ctx);
  const g = s.rows.find((r) => r.line.hcpcs === "G2211");
  assert.equal(g.how, "b1");
  assert.ok(Math.abs(g.y27 - 100 * 0.16 * table.codes["99214"][4] * table.cf[2027].nonqp) < 1e-6);
  const b2 = statement([{ hcpcs: "99214", mod: "", pos: "O", services: 100 }, { hcpcs: "G2211", mod: "", pos: "O", services: 100 }], { ...ctx, aco: true });
  assert.ok(Math.abs(b2.rows[1].y27 - 2 * g.y27) < 1e-6, "B2 is twice B1");
  assert.equal(s.off.length, 1);
});
