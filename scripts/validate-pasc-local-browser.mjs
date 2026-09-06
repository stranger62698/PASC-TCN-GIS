import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const playwrightModule = process.env.PASC_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(playwrightModule);
const targetUrl = process.env.PASC_LOCAL_URL || "http://localhost:3000/pasc-local";
const outputPath = resolve(
  process.env.PASC_BROWSER_RESULT || "artifacts/pasc-tcn-phase2-browser-results.json",
);
const browserCandidates = [
  {
    name: "Edge",
    executablePath: process.env.PASC_EDGE_PATH
      || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  },
  {
    name: "Chrome",
    executablePath: process.env.PASC_CHROME_PATH
      || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  },
  {
    name: "Edge WASM fallback",
    executablePath: process.env.PASC_EDGE_PATH
      || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    args: ["--disable-webgpu"],
    expectedProvider: "wasm",
    urlSuffix: "?pascEp=wasm",
  },
].filter(candidate => existsSync(candidate.executablePath));

if (!browserCandidates.length) throw new Error("Chrome / Edge executable not found.");

const results = [];
for (const candidate of browserCandidates) {
  const browser = await chromium.launch({
    executablePath: candidate.executablePath,
    headless: true,
    args: candidate.args ?? [],
  });
  try {
    const page = await browser.newPage();
    const debugMessages = [];
    page.on("console", message => {
      const text = message.text();
      if (text.includes("[PASC local]")) debugMessages.push(text);
    });
    await page.goto(`${targetUrl}${candidate.urlSuffix ?? ""}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForSelector('[data-phase2-status="passed"]', {
      timeout: 240_000,
    });
    const statusText = await page.locator(".pasc-local-status b").innerText();
    const levels = await page.locator(".pasc-local-levels li").allTextContents();
    const debug = debugMessages.join("\n");
    const provider = /provider=(webgpu|wasm)/.exec(debug)?.[1]
      || /execution provider: (webgpu|wasm)/.exec(debug)?.[1]
      || null;
    const sessionCreateCount = Number(
      /sessionCreateCount=(\d+)/.exec(debug)?.[1] ?? Number.NaN,
    );
    if (
      statusText !== "本地分析引擎验证通过"
      || levels.length !== 4
      || levels.some(level => !level.includes("PASS"))
      || !provider
      || sessionCreateCount !== 1
      || (candidate.expectedProvider && provider !== candidate.expectedProvider)
    ) {
      throw new Error(
        `${candidate.name} Phase 2 acceptance output is incomplete: provider=${provider}; sessions=${sessionCreateCount}; debug=${debug}`,
      );
    }
    results.push({
      browser: candidate.name,
      provider,
      sessionCreateCount,
      statusText,
      levels,
      debugMessages,
    });
  } finally {
    await browser.close();
  }
}

const payload = {
  schemaVersion: "pasc-browser-acceptance-v1",
  targetUrl,
  browsers: results,
};
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(JSON.stringify(payload, null, 2));
