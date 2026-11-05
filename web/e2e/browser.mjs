// Launch Chromium for the e2e scripts: $CHROME if set, else the cached Chrome for Testing, else Playwright's default.
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const CACHED = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

export function launch(opts = {}) {
  const executablePath = process.env.CHROME || (existsSync(CACHED) ? CACHED : undefined);
  return chromium.launch(executablePath ? { executablePath, ...opts } : opts);
}
