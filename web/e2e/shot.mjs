// Screenshots for design review: node e2e/shot.mjs [url] [outdir]
import { chromium } from "playwright";
const url = process.argv[2] || "http://localhost:8765/";
const out = process.argv[3] || new URL("./screenshots/", import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` });
const errors = [];
for (const [name, vp, scheme] of [["desktop", { width: 1440, height: 900 }, "light"], ["mobile", { width: 390, height: 844 }, "light"], ["dark", { width: 1440, height: 900 }, "dark"]]) {
  const p = await b.newPage({ viewport: vp, colorScheme: scheme, reducedMotion: "reduce" });
  p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error") errors.push(`${name}: ${m.text()}`); });
  await p.goto(url, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/${name}-top.png` });
  await p.screenshot({ path: `${out}/${name}-full.png`, fullPage: true });
  await p.close();
}
await b.close();
console.log(errors.length ? errors.join("\n") : "no console errors");
