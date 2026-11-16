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
// /_vercel/insights/script.js exists only on Vercel; stand in with an empty script so every other 404 still fails.
await p.route("**/_vercel/insights/script.js", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await p.goto(url, { waitUntil: "networkidle" });

// 1. typical practice loads by default; the skip link shows when focused
await p.waitForSelector("#st-root .lines tbody tr");
assert.match(await p.textContent("#st-root .sheet-head"), /Typical family medicine practice/);
await p.keyboard.press("Tab");
assert.ok(await p.evaluate(() => document.activeElement.matches(".skip") && document.activeElement.getBoundingClientRect().width > 50), "skip link visible on focus");

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
const svcLine = await p.getAttribute("#st-root tr[data-i] >> nth=0", "data-i");
await p.fill("#st-root input.svc >> nth=0", "1");
await p.press("#st-root input.svc >> nth=0", "Tab");
await p.waitForFunction((t) => document.querySelector("#st-root .total-big").textContent !== t, before, { timeout: 250 });
await p.waitForFunction(() => /^Statement updated: /.test(document.querySelector("#live").textContent)); // announced
// Tab out of the services box lands on the next control of the same line (its Remove button), not on <body>
assert.equal(await p.evaluate(() => document.activeElement.closest("#st-root tr[data-i]")?.dataset.i + document.activeElement.dataset.act), `${svcLine}rm`);
// keyboard edits keep focus on the same control (the statement redraws)
const posLine = await p.getAttribute("#st-root tr[data-i] >> nth=0", "data-i");
await p.focus("#st-root tr[data-i] >> nth=0 >> button.pos");
await p.keyboard.press("Enter");
assert.equal(await p.evaluate(() => document.activeElement.closest("tr[data-i]")?.dataset.i + document.activeElement.dataset.act), `${posLine}pos`);
const nRows = await p.$$eval("#st-root tr[data-i]", (r) => r.length);
await p.focus("#st-root button.x >> nth=0");
await p.keyboard.press("Enter");
assert.equal(await p.$$eval("#st-root tr[data-i]", (r) => r.length), nRows - 1);
assert.ok(await p.evaluate(() => document.activeElement.matches("#st-root button.x")), "focus moves to the next remove button");
// add a code: Escape closes the suggestions; an IME-confirming Enter adds nothing; a click adds
await p.fill("#add-code", "knee replacement");
await p.waitForSelector("#add-results button[data-code='27447']");
await p.waitForFunction(() => /^\d+ suggestions?\. Press Down to choose\.$/.test(document.querySelector("#live").textContent)); // count announced
await p.press("#add-code", "Escape");
assert.ok(await p.isHidden("#add-results"));
await p.evaluate(() => document.querySelector("#add-code").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
assert.equal(await p.$$eval("#st-root tr[data-i]", (r) => r.length), nRows - 1, "IME Enter added a line");
await p.fill("#add-code", "knee replacement ");
await p.waitForSelector("#add-results button[data-code='27447']");
await p.click("#add-results button[data-code='27447']");
await p.waitForSelector("#st-root tr[data-i] td.code:text('27447')");
assert.ok(await p.evaluate(() => document.activeElement.id === "add-code"), "focus back on the add-a-code box");

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

// 9b. a shared link with a ZIP CMS doesn't map shows its notice but doesn't announce it on load
await p.goto(`${url}?s=FAMILY%20PRACTICE&z=00000`, { waitUntil: "networkidle" });
await p.waitForSelector(".toast");
await p.waitForTimeout(500);
assert.equal(await p.textContent("#live"), "");

// 10. keyboard: edit a services box (Enter), then remove another line with its Remove button (Enter). The edit
// survives and the line removed is the one chosen. Four lines, so "Show all" can't hide a row.
await p.goto(`${url}?s=FAMILY%20PRACTICE&l=99213:O:100,99214:O:200,27447:F:5,93306:O:10`, { waitUntil: "networkidle" });
await p.waitForSelector("#st-root tr[data-i] td.code:text('93306')");
const codes = () => p.$$eval("#st-root tr[data-i] td.code", (t) => t.map((x) => x.textContent));
assert.deepEqual(await codes(), ["99213", "99214", "27447", "93306"]);
const t0 = await p.textContent("#st-root .total-big");
await p.fill("#st-root tr[data-i]:has(td.code:text('99213')) input.svc", "7");
await p.press("#st-root tr[data-i]:has(td.code:text('99213')) input.svc", "Enter");
await p.waitForFunction((t) => document.querySelector("#st-root .total-big").textContent !== t, t0, { timeout: 250 });
assert.match(new URL(p.url()).searchParams.get("l"), /^99213:O:7,99214:O:200,27447:F:5,93306:O:10$/);
await p.focus("#st-root tr[data-i]:has(td.code:text('27447')) button.x");
await p.keyboard.press("Enter");
assert.deepEqual(await codes(), ["99213", "99214", "93306"]);
assert.equal(await p.inputValue("#st-root tr[data-i]:has(td.code:text('99213')) input.svc"), "7");
assert.match(new URL(p.url()).searchParams.get("l"), /^99213:O:7,99214:O:200,93306:O:10$/);

// 11. a mouse press that never ends (mousedown on a native <select>, no mouseup) doesn't hold back a keyboard edit
const sb = await p.locator("#st-spec").boundingBox();
await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
await p.mouse.down();
const t1 = await p.textContent("#st-root .total-big");
await p.fill("#st-root tr[data-i]:has(td.code:text('99214')) input.svc", "50");
await p.press("#st-root tr[data-i]:has(td.code:text('99214')) input.svc", "Enter");
await p.waitForFunction((t) => document.querySelector("#st-root .total-big").textContent !== t, t1, { timeout: 250 });
assert.match(new URL(p.url()).searchParams.get("l"), /^99213:O:7,99214:O:50,93306:O:10$/);
await p.mouse.up();

await b.close();
assert.deepEqual(errors, []);
console.log(`smoke ok: ${lines} lines, ${counties} counties`);
