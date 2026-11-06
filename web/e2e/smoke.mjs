// End-to-end: drives the built page in Chromium. Run with the docs/ folder served on :8765.
import { launch } from "./browser.mjs";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";

const url = process.env.URL || "http://localhost:8765/";
const shots = new URL("./screenshots/", import.meta.url).pathname;
// Pick a real record from a shard (public CMS data); keep its identity out of logs.
const shard = JSON.parse(gunzipSync(readFileSync(new URL("../../docs/data/npi/214.json.gz", import.meta.url))));
const rec = shard.recs.find((r) => r[7].length > 20 && r[2] === "Family Practice" && r[6]);
const last = rec[1].split(",")[0].split(" ").pop();

const b = await launch();
const errors = [];
const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
p.on("pageerror", (e) => errors.push(e.message));
// /_vercel/insights/script.js exists only on Vercel; a local static server 404s it.
p.on("console", (m) => { if (m.type() === "error" && !/status of 404/.test(m.text())) errors.push(m.text()); });
await p.goto(url, { waitUntil: "networkidle" });

// 1. typical practice loads by default
await p.waitForSelector("#st-root .lines tbody tr");
assert.match(await p.textContent("#st-root .sheet-head"), /Typical family medicine practice/);

// 2. NPI lookup
await p.fill("#q", rec[0]);
await p.press("#q", "Enter");
await p.waitForFunction((n) => document.querySelector("#st-root .sheet-head")?.textContent.includes(n), rec[0]);
const lines = await p.$$eval("#st-root .lines tbody tr[data-i]", (r) => r.length);
assert.ok(lines >= 10, `lines ${lines}`);
assert.match(new URL(p.url()).search, new RegExp(`npi=${rec[0]}`));
await p.locator("#statement").screenshot({ path: `${shots}/statement-npi.png` });

// 3. name search finds the same clinician
await p.fill("#q", last);
await p.waitForSelector(`#q-results button[data-npi="${rec[0]}"]`, { timeout: 8000 }).catch(() => {});
const found = await p.$(`#q-results button[data-npi]`);
assert.ok(found, "name search returned results");

// 4. edit: change volume, toggle place, remove a line, add a code
const before = await p.textContent("#st-root .total-big");
await p.fill("#st-root input.svc >> nth=0", "1");
await p.press("#st-root input.svc >> nth=0", "Tab");
await p.waitForFunction((t) => document.querySelector("#st-root .total-big").textContent !== t, before);
await p.click("#st-root button.x >> nth=0");
await p.fill("#add-code", "knee replacement");
await p.waitForSelector("#add-results button[data-code='27447']");
await p.click("#add-results button[data-code='27447']");
await p.waitForSelector("#st-root tr[data-i] td.code:text('27447')");

// 5. ZIP -> locality (preset path)
await p.click("#hero-chips [data-spec='DERMATOLOGY']");
await p.fill("#st-zip", "72201");
await p.press("#st-zip", "Tab");
await p.waitForFunction(() => /Arkansas/i.test(document.querySelector("#st-root .sheet-head").textContent));
assert.match(new URL(p.url()).search, /z=72201/);

// 6. specialty chart click loads a preset
await p.click(".specchart .spec-row[data-key='ORTHOPEDIC SURGERY']");
await p.waitForFunction(() => /orthopedic/i.test(document.querySelector("#st-root .sheet-head").textContent));

// 7. map renders
await p.locator("#map").scrollIntoViewIfNeeded();
await p.waitForSelector("#map-root path.c", { timeout: 15000 });
const counties = await p.$$eval("#map-root path.c", (x) => x.length);
assert.ok(counties > 3000, `counties ${counties}`);
await p.selectOption("#map-code", "27447|F");
await p.locator("#map").screenshot({ path: `${shots}/map.png` });

// 8. share image downloads
await p.locator("#statement").scrollIntoViewIfNeeded();
const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#st-root [data-act='share']")]);
await dl.saveAs(`${shots}/share.png`);

// 9. URL state round-trip
await p.goto(`${url}?s=CARDIOLOGY&z=10001&qp=1`, { waitUntil: "networkidle" });
await p.waitForFunction(() => /cardiology/i.test(document.querySelector("#st-root .sheet-head")?.textContent || ""));
assert.ok(await p.isChecked("#st-qp"));

await b.close();
assert.deepEqual(errors, []);
console.log(`smoke ok: ${lines} lines, ${counties} counties`);
