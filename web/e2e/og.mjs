// Social card: the share image for the default statement, saved as docs/og.png (1200x630).
import { launch } from "./browser.mjs";
import { execFileSync } from "node:child_process";
const url = process.env.URL || "http://localhost:8765/";
const out = new URL("../../docs/og.png", import.meta.url).pathname;
const b = await launch();
const p = await b.newPage({ acceptDownloads: true, colorScheme: "light" });
await p.goto(`${url}?s=ORTHOPEDIC%20SURGERY`, { waitUntil: "networkidle" });
await p.waitForSelector("#st-root [data-act='share']");
const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#st-root [data-act='share']")]);
await dl.saveAs(out);
await b.close();
execFileSync("sips", ["-z", "630", "1200", out], { stdio: "ignore" });
console.log("wrote", out);
