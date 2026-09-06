import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PASC_PLAYWRIGHT_MODULE || "playwright");
const targetUrl = process.env.PASC_LOCAL_URL || "http://localhost:3000/map";
const edgePath = process.env.PASC_EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
if (!existsSync(edgePath)) throw new Error("Microsoft Edge executable not found.");

const artifactDir = resolve("artifacts/phase4-browser");
const fixturePath = resolve(artifactDir, "native-20000.csv");
const outputPath = resolve("artifacts/pasc-tcn-phase4-browser-results.json");
await mkdir(artifactDir, { recursive: true });
const fixture = JSON.parse(readFileSync("pasc-tcn-service/tests/fixtures/native248_golden.json", "utf8"));
const headers = [fixture.request.mapping.pointId, fixture.request.mapping.longitude, fixture.request.mapping.latitude, fixture.request.mapping.velocity, fixture.request.mapping.coherence, ...fixture.request.mapping.dateColumns];

await new Promise((resolvePromise, reject) => {
  const output = createWriteStream(fixturePath, { encoding: "utf8" });
  output.on("error", reject);
  output.write(headers.join(",") + "\n");
  for (let start = 0; start < 20_000; start += 250) {
    const rows = [];
    for (let index = start; index < Math.min(20_000, start + 250); index += 1) {
      const record = fixture.request.records[index % fixture.request.records.length];
      rows.push(["phase4-" + (index + 1), (110.1 + (index % 200) * 0.0009).toFixed(6), (19.9 + Math.floor(index / 200) * 0.0009).toFixed(6), record[fixture.request.mapping.velocity], record[fixture.request.mapping.coherence], ...fixture.request.mapping.dateColumns.map(field => record[field])].join(","));
    }
    output.write(rows.join("\n") + "\n");
  }
  output.end(resolvePromise);
});

const browser = await chromium.launch({ executablePath: edgePath, headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"] });
const page = await browser.newPage({ acceptDownloads: true });
const requests = [];
const pageErrors = [];
page.on("request", request => requests.push({ method: request.method(), url: request.url(), at: Date.now() }));
page.on("pageerror", error => pageErrors.push(error.message));

try {
  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });
  const startedAt = Date.now();
  const input = page.locator('input[type="file"][accept*="csv"]').first();
  await input.setInputFiles(fixturePath);
  await page.waitForSelector('[data-local-analysis-state="idle"]', { timeout: 10_000 });
  await page.locator(".pasc-local-webgis-settings select").nth(2).selectOption("already_smoothed");
  await page.getByRole("button", { name: "开始本地分析并接入地图" }).click();
  await page.waitForFunction(() => {
    const state = document.querySelector("[data-local-analysis-state]")?.getAttribute("data-local-analysis-state");
    return state === "ready" || state === "error";
  }, undefined, { timeout: 600_000 });
  const state = await page.locator("[data-local-analysis-state]").getAttribute("data-local-analysis-state");
  if (state !== "ready") throw new Error(await page.locator(".pasc-local-webgis-status").innerText());

  const status = await page.locator(".pasc-local-webgis-status").innerText();
  const datasetCard = await page.locator(".dataset-card").innerText();
  const pascPanelText = await page.locator(".pasc-workspace-tab").innerText();
  if (!status.includes("20,000") || !datasetCard.includes("20,000") || !datasetCard.includes("浏览器本地 PASC-TCN")) throw new Error("local result was not adapted into the existing WebGIS: " + JSON.stringify({ status, datasetCard }));
  if (!pascPanelText.includes("筛选低置信度") || !pascPanelText.includes("筛选空间受限")) throw new Error("local PASC filters are unavailable after map adaptation");

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "本地导出结果 CSV" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("local result CSV download did not produce a file");
  const exportPreview = (await readFile(downloadPath, "utf8")).slice(0, 240);
  if (!exportPreview.includes("point_id,lon,lat,velocity_mm_per_year,mode,mode_name,confidence")) throw new Error("local export CSV header is incomplete");

  const localRequests = requests.filter(request => request.at >= startedAt);
  const counters = {
    requestChunkPut: localRequests.filter(request => request.method === "PUT" && /request|upload|source|part/i.test(request.url)).length,
    resultChunkPut: localRequests.filter(request => request.method === "PUT" && /result|artifact/i.test(request.url)).length,
    progressPut: localRequests.filter(request => request.method === "PUT" && /progress/i.test(request.url)).length,
    taskList: localRequests.filter(request => /\/v1\/jobs(?:\?|$)|\/api\/pasc-jobs/i.test(request.url)).length,
    taskMetaPut: localRequests.filter(request => request.method === "PUT" && /meta\.json|\/v1\/internal\/jobs/i.test(request.url)).length,
    serverInference: localRequests.filter(request => /\/api\/pasc\/infer/i.test(request.url)).length,
  };
  if (Object.values(counters).some(Boolean)) throw new Error("Local mode crossed the server task boundary: " + JSON.stringify(counters));

  const result = { schemaVersion: "pasc-local-phase4-browser-v1", targetUrl, points: 20_000, elapsedMs: Date.now() - startedAt, provider: (await page.locator(".pasc-local-webgis-result>div").nth(2).innerText()).replace("引擎", "").trim(), counters, exportFilename: download.suggestedFilename(), pageErrors, localRequests };
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
