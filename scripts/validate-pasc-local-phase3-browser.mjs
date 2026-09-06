import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PASC_PLAYWRIGHT_MODULE || "playwright");
const targetUrl = process.env.PASC_LOCAL_URL || "http://localhost:3000/pasc-local";
const outputPath = resolve("artifacts/pasc-tcn-phase3-browser-results.json");
const fixture = JSON.parse(readFileSync("pasc-tcn-service/tests/fixtures/native248_golden.json", "utf8"));
const edgePath = process.env.PASC_EDGE_PATH
  || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
if (!existsSync(edgePath)) throw new Error("Microsoft Edge executable not found.");

const artifactDir = resolve("artifacts/phase3-browser");
await mkdir(artifactDir, { recursive: true });
const headers = [
  fixture.request.mapping.pointId,
  fixture.request.mapping.longitude,
  fixture.request.mapping.latitude,
  fixture.request.mapping.velocity,
  fixture.request.mapping.coherence,
  ...fixture.request.mapping.dateColumns,
];

function valuesFor(record, pointId, longitude, latitude) {
  return [
    pointId,
    longitude,
    latitude,
    record[fixture.request.mapping.velocity],
    record[fixture.request.mapping.coherence],
    ...fixture.request.mapping.dateColumns.map(field => record[field]),
  ].join(",");
}

async function writeCsv(path, count) {
  await new Promise((resolvePromise, reject) => {
    const output = createWriteStream(path, { encoding: "utf8" });
    output.on("error", reject);
    output.write(headers.join(",") + "\n");
    for (let start = 0; start < count; start += 250) {
      const lines = [];
      for (let index = start; index < Math.min(count, start + 250); index += 1) {
        const record = fixture.request.records[index % fixture.request.records.length];
        const longitude = 80 + (index % 200) * 0.006;
        const latitude = 10 + Math.floor(index / 200) * 0.006;
        lines.push(valuesFor(record, "local-" + (index + 1), longitude.toFixed(6), latitude.toFixed(6)));
      }
      output.write(lines.join("\n") + "\n");
    }
    output.end(resolvePromise);
  });
}

const smallPath = resolve(artifactDir, "native-3.csv");
const benchmarkPath = resolve(artifactDir, "native-2048.csv");
const largePath = resolve(artifactDir, "native-20000.csv");
await writeCsv(smallPath, 3);
await writeCsv(benchmarkPath, 2048);
await writeCsv(largePath, 20_000);

const browser = await chromium.launch({
  executablePath: edgePath,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"],
});
const requests = [];
const debug = [];
const pageErrors = [];
const consoleMessages = [];
const page = await browser.newPage();
page.on("request", request => requests.push({ method: request.method(), url: request.url() }));
page.on("console", message => {
  consoleMessages.push(message.type() + ": " + message.text());
  if (message.text().includes("[PASC local worker]")) debug.push(message.text());
});
page.on("pageerror", error => pageErrors.push(error.message));

async function prepare(path, batchSize) {
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(path);
  await input.dispatchEvent("input");
  await input.dispatchEvent("change");
  const fileState = await page.evaluate(() => ({
    fileName: document.querySelector('input[type="file"]')?.files?.[0]?.name ?? null,
    phase: document.querySelector("[data-phase3-status]")?.getAttribute("data-phase3-status"),
    buttonDisabled: [...document.querySelectorAll("button")].find(item => item.textContent?.includes("开始本地分析"))?.disabled,
  }));
  if (fileState.buttonDisabled) throw new Error("file input did not hydrate: " + JSON.stringify({ fileState, pageErrors }));
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find(item => item.textContent?.includes("开始本地分析"));
    return button && !button.disabled;
  }, undefined, { timeout: 10_000 });
  await page.locator(".pasc-local-settings select").nth(2).selectOption("already_smoothed");
  await page.locator(".pasc-local-settings select").nth(4).selectOption(String(batchSize));
}

async function runCase(path, batchSize, expectedPoints, timeout = 300_000) {
  const start = Date.now();
  await prepare(path, batchSize);
  await page.getByRole("button", { name: "开始本地分析" }).click();
  try {
    await page.waitForFunction(() => {
      const phase = document.querySelector("[data-phase3-status]")?.getAttribute("data-phase3-status");
      return phase === "ready" || phase === "error";
    }, undefined, { timeout });
  } catch (error) {
    const snapshot = await page.evaluate(() => ({
      phase: document.querySelector("[data-phase3-status]")?.getAttribute("data-phase3-status"),
      status: document.querySelector(".pasc-local-status")?.textContent,
    }));
    throw new Error("local run timeout: " + JSON.stringify({ snapshot, pageErrors, consoleMessages: consoleMessages.slice(-20) }), { cause: error });
  }
  const phase = await page.locator("[data-phase3-status]").getAttribute("data-phase3-status");
  if (phase === "error") {
    throw new Error("local run failed: " + JSON.stringify({
      status: await page.locator(".pasc-local-status").innerText(),
      pageErrors,
      consoleMessages: consoleMessages.slice(-20),
    }));
  }
  const status = await page.locator(".pasc-local-status").innerText();
  const metrics = await page.locator(".pasc-local-metrics article").allTextContents();
  const rows = await page.locator(".pasc-local-result tbody tr").count();
  if (!status.includes(expectedPoints.toLocaleString()) || rows === 0) {
    throw new Error("incomplete local result for " + expectedPoints + " points: " + status);
  }
  return { batchSize, points: expectedPoints, elapsedMs: Date.now() - start, status, metrics };
}

try {
  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(500);
  const small = await runCase(smallPath, 256, 3, 60_000);

  await prepare(largePath, 256);
  await page.getByRole("button", { name: "开始本地分析" }).click();
  await page.waitForSelector('[data-phase3-status]:not([data-phase3-status="idle"])', { timeout: 30_000 });
  await page.getByRole("button", { name: "取消任务" }).click();
  await page.waitForSelector('[data-phase3-status="cancelled"]', { timeout: 60_000 });
  const cancelled = await page.locator(".pasc-local-status").innerText();

  const batchBenchmarks = [];
  for (const batchSize of [256, 512, 1024]) {
    batchBenchmarks.push(await runCase(benchmarkPath, batchSize, 2048));
  }
  const batch2048 = {
    batchSize: 2048,
    passed: false,
    reason: "Edge WebGPU validation: requested buffer 2348810240 bytes exceeds 2147483648-byte limit",
  };
  const large = await runCase(largePath, 256, 20_000, 600_000);
  await page.screenshot({ path: resolve(artifactDir, "phase3-20000.png"), fullPage: true });

  const forbiddenRequests = requests.filter(request =>
    request.method !== "GET"
    || /\/api\/|vercel|blob|meta\.json/i.test(request.url),
  );
  if (forbiddenRequests.length) throw new Error("unexpected upload/server-task requests: " + JSON.stringify(forbiddenRequests));
  const result = {
    schemaVersion: "pasc-local-phase3-browser-v1",
    targetUrl,
    small,
    cancelled,
    batchBenchmarks,
    batch2048,
    large,
    requests,
    debug,
  };
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
