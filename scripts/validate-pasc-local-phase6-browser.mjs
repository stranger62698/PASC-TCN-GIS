import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PASC_PLAYWRIGHT_MODULE || "playwright");
const targetUrl = process.env.PASC_LOCAL_URL || "http://localhost:3000/map";
const browserPath = process.env.PASC_BROWSER_PATH || process.env.PASC_EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browserLabel = process.env.PASC_BROWSER_LABEL || "Microsoft Edge";
const outputPath = resolve(process.env.PASC_PHASE6_OUTPUT || "artifacts/pasc-tcn-phase6-browser-results.json");
if (!existsSync(browserPath)) throw new Error(`${browserLabel} executable not found.`);

const pointCount = 21_610;
const artifactDir = resolve("artifacts/phase6-browser");
const fixturePath = resolve(artifactDir, "native-21610.csv");
await mkdir(artifactDir, { recursive: true });
const fixture = JSON.parse(readFileSync("pasc-tcn-service/tests/fixtures/native248_golden.json", "utf8"));
const headers = [fixture.request.mapping.pointId, fixture.request.mapping.longitude, fixture.request.mapping.latitude, fixture.request.mapping.velocity, fixture.request.mapping.coherence, ...fixture.request.mapping.dateColumns];
await new Promise((resolvePromise, reject) => {
  const output = createWriteStream(fixturePath, { encoding: "utf8" });
  output.on("error", reject);
  output.write(headers.join(",") + "\n");
  for (let start = 0; start < pointCount; start += 250) {
    const rows = [];
    for (let index = start; index < Math.min(pointCount, start + 250); index += 1) {
      const record = fixture.request.records[index % fixture.request.records.length];
      rows.push(["phase6-" + (index + 1), (110.1 + (index % 210) * 0.00085).toFixed(6), (19.9 + Math.floor(index / 210) * 0.00085).toFixed(6), record[fixture.request.mapping.velocity], record[fixture.request.mapping.coherence], ...fixture.request.mapping.dateColumns.map(field => record[field])].join(","));
    }
    output.write(rows.join("\n") + "\n");
  }
  output.end(resolvePromise);
});

const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"] });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
const requests = [];
const pageErrors = [];
page.on("request", request => requests.push({ method: request.method(), url: request.url(), at: Date.now() }));
page.on("pageerror", error => pageErrors.push(error.message));

const waitForTerminal = () => page.waitForFunction(() => ["ready", "error", "cancelled"].includes(document.querySelector("[data-local-analysis-state]")?.getAttribute("data-local-analysis-state") || ""), undefined, { timeout: 600_000 });

try {
  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector(".dataset-card")?.textContent?.includes("3,094"), undefined, { timeout: 30_000 });
  const input = page.locator('input[type="file"][accept*="csv"]').first();

  const malformed = { name: "insufficient-dates.csv", mimeType: "text/csv", buffer: Buffer.from("lon,lat,2024-01-01\n110,20,1\n") };
  await input.setInputFiles(malformed);
  await page.getByRole("button", { name: "开始本地分析并接入地图" }).click();
  await waitForTerminal();
  const validationError = await page.locator(".pasc-local-webgis-status").innerText();
  if (!validationError.includes("至少需要 20")) throw new Error("insufficient-date CSV did not render a friendly error: " + validationError);

  await input.setInputFiles(fixturePath);
  await page.waitForSelector(".pasc-local-webgis-warning");
  await page.locator(".pasc-local-webgis-settings select").nth(2).selectOption("already_smoothed");
  await page.getByRole("button", { name: "开始本地分析并接入地图" }).click();
  await page.waitForFunction(() => !["idle", "ready", "error", "cancelled"].includes(document.querySelector("[data-local-analysis-state]")?.getAttribute("data-local-analysis-state") || ""), undefined, { timeout: 30_000 });
  await page.getByRole("button", { name: "取消" }).click();
  await waitForTerminal();
  const cancelled = await page.locator("[data-local-analysis-state]").getAttribute("data-local-analysis-state");
  if (cancelled !== "cancelled") throw new Error("cancel did not reach CANCELLED state");

  const analysisStartedAt = Date.now();
  await page.getByRole("button", { name: "开始本地分析并接入地图" }).click();
  const distinctProgress = new Set();
  let peakHeapBytes = 0;
  let sampling = true;
  const sample = async () => {
    while (sampling) {
      const text = await page.locator(".pasc-local-webgis-status strong").textContent().catch(() => "");
      if (text) distinctProgress.add(text);
      const metrics = await cdp.send("Performance.getMetrics").catch(() => ({ metrics: [] }));
      const heap = metrics.metrics.find(item => item.name === "JSHeapUsedSize")?.value || 0;
      peakHeapBytes = Math.max(peakHeapBytes, heap);
      await new Promise(resolvePromise => setTimeout(resolvePromise, 200));
    }
  };
  const samplingPromise = sample();
  const interactionStartedAt = Date.now();
  await page.getByRole("tab", { name: "图层" }).click();
  const interactionLatencyMs = Date.now() - interactionStartedAt;
  await waitForTerminal();
  sampling = false;
  await samplingPromise;
  const state = await page.locator("[data-local-analysis-state]").getAttribute("data-local-analysis-state");
  if (state !== "ready") throw new Error(await page.locator(".pasc-local-webgis-status").innerText());

  const performance = JSON.parse(await page.locator(".pasc-local-webgis-result").getAttribute("data-performance"));
  const status = await page.locator(".pasc-local-webgis-status").innerText();
  await page.getByRole("tab", { name: "数据" }).click();
  const datasetCard = await page.locator(".dataset-card").innerText();
  if (!status.includes("21,610") || !datasetCard.includes("21,610")) throw new Error("21,610 points were not adapted into the map");
  if (interactionLatencyMs > 2_000) throw new Error(`map UI interaction blocked for ${interactionLatencyMs} ms`);
  if (distinctProgress.size < 3) throw new Error(`progress did not update normally: ${JSON.stringify([...distinctProgress])}`);

  const system = await page.evaluate(async () => {
    const value = { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGiB: navigator.deviceMemory ?? null, gpu: null };
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      value.gpu = adapter?.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } : { available: Boolean(adapter) };
    } catch { /* GPU detail is optional */ }
    return value;
  });
  const localRequests = requests.filter(request => request.at >= analysisStartedAt);
  const counters = {
    upload: localRequests.filter(request => request.method !== "GET" && /upload|source|part|request/i.test(request.url)).length,
    requestChunk: localRequests.filter(request => request.method === "PUT" && /request|source|part/i.test(request.url)).length,
    resultChunk: localRequests.filter(request => request.method === "PUT" && /result|artifact/i.test(request.url)).length,
    progress: localRequests.filter(request => request.method === "PUT" && /progress/i.test(request.url)).length,
    taskList: localRequests.filter(request => /\/v1\/jobs(?:\?|$)|\/api\/pasc-jobs/i.test(request.url)).length,
    serverInference: localRequests.filter(request => /\/api\/pasc\/infer/i.test(request.url)).length,
  };
  if (Object.values(counters).some(Boolean)) throw new Error("Local mode crossed the zero-upload boundary: " + JSON.stringify(counters));

  const result = { schemaVersion: "pasc-local-phase6-browser-v1", targetUrl, browser: `${browserLabel} ${browser.version()}`, points: pointCount, fileSizeBytes: readFileSync(fixturePath).byteLength, timeSteps: performance.timeSteps, provider: performance.provider, batchSize: performance.batchSize, csvParsingMs: performance.csvParsingMs, preprocessingMs: performance.preprocessingMs, modelLoadingMs: performance.modelLoadingMs, inferenceMs: performance.inferenceMs, totalMs: performance.totalMs, averageBatchMs: performance.averageBatchMs, batchCount: performance.batchCount, browserWallMs: Date.now() - analysisStartedAt, peakJsHeapBytes: peakHeapBytes, system, ui: { interactionLatencyMs, distinctProgressUpdates: distinctProgress.size, cancelPassed: true, validationErrorPassed: true, mapApplied: true }, counters, pageErrors };
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
