import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile, utimes } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PASC_PLAYWRIGHT_MODULE || "playwright"); }
catch {
  const bundledModules = process.env.CODEX_NODE_MODULES || "C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";
  playwright = require(join(bundledModules, "playwright"));
}
const targetUrl = new URL(process.env.LOCAL_WORKFLOW_URL || process.env.PASC_LOCAL_URL || "http://localhost:4192/map?source=local");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(targetUrl.hostname), "This controlled replay must run only against localhost.");
const browserPath = process.env.PASC_BROWSER_PATH || process.env.PASC_EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
assert.ok(existsSync(browserPath), "Set PASC_BROWSER_PATH to an installed Chrome/Edge executable.");
const artifactDir = resolve("artifacts/local-user-workflow-browser");
const outputPath = resolve("artifacts/local-user-workflow-browser.json");
await mkdir(artifactDir, { recursive: true });

const sourceText = readFileSync("public/data/insar-user-template.csv", "utf8").replace(/^\uFEFF/, "").trim();
const sourceRows = sourceText.split(/\r?\n/).map(line => line.split(","));
const sourceHeaders = sourceRows[0], originalRows = sourceRows.slice(1);
const dateHeaders = sourceHeaders.filter(header => /^D\d{8}$/.test(header));
assert.equal(dateHeaders.length, 40);
assert.equal(originalRows.length, 8);
assert.ok(!sourceHeaders.some(header => /mode|label|confidence|predicted/i.test(header)), "Fixture must have no preclassification.");
const csv = rows => rows.map(row => row.join(",")).join("\r\n") + "\r\n";
const stamp = new Date("2024-01-01T00:00:00.000Z");
async function fixture(folder, name, rows) {
  const path = join(artifactDir, folder, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, csv(rows), "utf8");
  await utimes(path, stamp, stamp);
  return path;
}
const basePath = await fixture("original", "insar-user-template.csv", sourceRows);
const missingRows = sourceRows.map(row => [...row]);
missingRows[1][sourceHeaders.length - 1] = "";
const missingPath = await fixture("missing", "last-epoch-missing.csv", missingRows);
const sparsePoint = [...originalRows[0]];
sparsePoint[0] = "limited-19";
sparsePoint[1] = "110.352000";
sparsePoint[2] = "20.032000";
for (let index = 5 + 19; index < sparsePoint.length; index += 1) sparsePoint[index] = "";
const sparsePath = await fixture("sparse", "one-point-19-observations.csv", [...sourceRows, sparsePoint]);
const shortPath = await fixture("short", "only-12-date-columns.csv", sourceRows.map(row => row.slice(0, 5 + 12)));
const duplicateRows = sourceRows.map(row => [...row]);
duplicateRows[2][0] = duplicateRows[1][0];
const duplicatePath = await fixture("duplicate", "duplicate-point-id.csv", duplicateRows);
const replacementRows = sourceRows.map((row, index) => index ? row.map((cell, column) => column === 1 ? (Number(cell) + 0.002).toFixed(6) : cell) : [...row]);
const replacementPath = await fixture("replacement", "insar-user-template.csv", replacementRows);
assert.equal(readFileSync(basePath).byteLength, readFileSync(replacementPath).byteLength, "Same-name replacement must also retain size and mtime.");

const result = {
  schemaVersion: "local-user-workflow-browser-v1",
  targetUrl: targetUrl.href, startedAt: new Date().toISOString(), passed: false,
  evidence: {
    input: "synthetic 8-point/40-date CSV without preclassification",
    inference: "real local ONNX model; harness sets the existing START.forceWasm flag",
    route: "browser HTTP contract replay only; synthetic geometry, no real map-provider request",
    auth: "browser auth HTTP replay only; no real account login",
    productionRouteOrAuthValidated: false,
  },
  performanceMeasurement: {
    workerTimings: "Actual worker instrumentation; hardware/load-specific, includes first model load separately.",
    pageHeap: "CDP Performance JSHeapUsedSize sampled at runFile checkpoints; excludes Worker/WASM heaps and whole browser process memory.",
    largeFileOr100kInferenceBenchmark: false,
  },
  checks: [], screenshots: [], requests: [], blockedExternalRequests: [], pageErrors: [],
};
let authenticated = false;
let drivingCalls = 0;
const drivingRequests = [];
function replayPlan(request) {
  const ordered = [request.points.find(point => point.id === request.startId), ...request.points.filter(point => point.role === "candidate"), request.points.find(point => point.id === request.endId)];
  const legs = ordered.slice(0, -1).map((point, index) => {
    const next = ordered[index + 1], coordinates = [point.coordinate, next.coordinate];
    return { id: "browser-replay-leg-" + index, index: index + 1, fromId: point.id, toId: next.id, coordinates,
      bounds: [Math.min(point.coordinate[0], next.coordinate[0]), Math.min(point.coordinate[1], next.coordinate[1]), Math.max(point.coordinate[0], next.coordinate[0]), Math.max(point.coordinate[1], next.coordinate[1])],
      distanceMeters: 500 + index * 100, durationSeconds: 300 + index * 60, traffic: [], tollsYuan: null, tag: "浏览器测试回放" };
  });
  const seconds = legs.reduce((sum, leg) => sum + leg.durationSeconds, 0);
  const dwellMinutes = ordered.reduce((sum, point) => sum + point.dwellMinutes, 0);
  return {
    schemaVersion: "roadops-driving-plan-v1", provider: "didi_web_service", mode: "didi_live",
    generatedAt: new Date().toISOString(), inputFingerprint: "browser-contract-replay-only",
    planning: { requestedStrategy: request.strategy, orderMode: request.orderMode || "input", orderingObjective: request.orderMode === "optimize" ? request.strategy === "5" ? "distance" : "duration" : "input_order" },
    status: "ready", stopOrder: ordered.map(point => point.id), selectedCandidateIds: ordered.filter(point => point.role === "candidate").map(point => point.id),
    excluded: [], totalDistanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0),
    drivingMinutes: seconds / 60, drivingDurationSeconds: seconds, dwellMinutes, totalMinutes: seconds / 60 + dwellMinutes,
    workMinutes: request.workMinutes, overtimeMinutes: 0,
    usage: { cached: true, upstreamRequests: 0, dailyUsed: 0, dailyBudget: 100, dailyRemaining: 100, perIdentityUsed: 0, perIdentityLimit: 100 },
    map: { fixtureId: "browser-contract-replay-only", mode: "didi_live", bounds: null,
      stops: ordered.map((point, index) => ({ ...point, defaultDwellMinutes: point.dwellMinutes, reachable: true, markerRole: index === 0 ? "start" : index === ordered.length - 1 ? "end" : "waypoint", visitIndex: index === 0 || index === ordered.length - 1 ? null : index })),
      features: legs.map(leg => ({ type: "Feature", id: leg.id, geometry: { type: "LineString", coordinates: leg.coordinates }, properties: { from: leg.fromId, to: leg.toId, legIndex: leg.index, distanceMeters: leg.distanceMeters, durationSeconds: leg.durationSeconds, source: "didi_web_service", testProvenance: "synthetic browser replay" } })),
    },
    field: { schemaVersion: "roadops-field-detail-v1", guidance: "geometry_only", legs,
      access: ordered.map(point => ({ pointId: point.id, coordinate: point.coordinate, roadCoordinate: point.coordinate, offsetMeters: 0, status: "near_route", thresholdMeters: 50 })),
      routePackCount: 0, limitations: ["浏览器测试回放：合成几何，未请求地图商服务，不属于真实道路验收"] },
    boundary: "浏览器测试回放：非真实路线验收",
  };
}
const browser = await playwright.chromium.launch({ executablePath: browserPath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
await context.route("**/*", async route => {
  const request = route.request(), url = new URL(request.url());
  result.requests.push({ method: request.method(), url: request.url(), resourceType: request.resourceType() });
  if (url.origin !== targetUrl.origin && !["blob:", "data:"].includes(url.protocol)) {
    result.blockedExternalRequests.push(request.url());
    return request.resourceType() === "image"
      ? route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/aN5QAAAAASUVORK5CYII=", "base64") })
      : route.abort("blockedbyclient");
  }
  if (url.pathname === "/api/auth") {
    if (url.searchParams.get("op") === "login") authenticated = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated, user: authenticated ? { id: "browser-replay-user", email: "workflow@example.test", name: "测试账户", roles: [] } : null }) });
  }
  if (url.pathname === "/api/roadops/driving") {
    drivingCalls += 1;
    drivingRequests.push(request.postDataJSON());
    return route.fulfill({ status: authenticated ? 200 : 401, contentType: "application/json",
      body: JSON.stringify(authenticated ? { plan: replayPlan(drivingRequests.at(-1)), testProvenance: "browser-contract-replay" } : { error: { code: "AUTH_REQUIRED", message: "测试回放：需要登录", retryable: false, fallbackAvailable: false } }) });
  }
  if (/\/api\/analytics|\/api\/events/.test(url.pathname)) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  if (/\/api\/(?:uploads|pasc(?:\/|$)|pasc-jobs)|\/v1\/jobs/.test(url.pathname)) return route.abort("blockedbyclient");
  return route.continue();
});
await context.addInitScript(() => {
  const trace = { starts: [], completions: [], aois: [], schedulingHolds: [], delayNextAoiMs: 0, workerMessages: [], errors: [] };
  window.__localUserWorkflow = trace;
  Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
  const NativeWorker = window.Worker;
  window.Worker = class WorkflowWorker extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      this.workflowName = options?.name || String(url);
      this.workflowTimers = new Set();
      this.addEventListener("message", event => {
        const message = event.data;
        trace.workerMessages.push({ worker: this.workflowName, type: message?.type, state: message?.state });
        if (message?.type === "ERROR") trace.errors.push(message.message);
        if (message?.type === "AOI" && message.result?.overall) trace.aois.push({ dates: message.result.dates, overall: message.result.overall, groups: message.result.groups.map(group => ({ mode: group.mode, pointCount: group.pointCount })) });
        if (message?.type !== "COMPLETE" || !message.result?.pointIds) return;
        const output = message.result;
        trace.completions.push({
          provider: output.provider, pointIds: Array.from(output.pointIds), sourceEpochs: output.sourceEpochs,
          timeSteps: output.timeSteps, dates: output.dates, totalRows: output.totalRows, invalidRows: output.invalidRows,
          invalidReasons: output.invalidReasons, invalidExamples: output.invalidExamples,
          longitude: Array.from(output.longitude), latitude: Array.from(output.latitude),
          effectiveEpochs: output.effectiveEpochs ? Array.from(output.effectiveEpochs) : null,
          classificationEligible: output.classificationEligible ? Array.from(output.classificationEligible) : null,
          observedDates: output.observedDates || [], observedMask: output.observedMask ? Array.from(output.observedMask) : null,
          inferenceMs: output.inferenceMs, batchCount: output.batchCount, batchSize: output.batchSize,
        });
      });
    }
    terminate() {
      for (const timer of this.workflowTimers) clearTimeout(timer);
      this.workflowTimers.clear();
      super.terminate();
    }
    postMessage(message, transfer) {
      if (message?.type === "AOI" && trace.delayNextAoiMs > 0) {
        const delayMs = trace.delayNextAoiMs; trace.delayNextAoiMs = 0;
        trace.schedulingHolds.push({ type: "AOI", delayMs, purpose: "Deterministic UI cancellation before actual worker delivery; retry executes real worker." });
        const timer = setTimeout(() => { this.workflowTimers.delete(timer); if (transfer === undefined) super.postMessage(message); else super.postMessage(message, transfer); }, delayMs);
        this.workflowTimers.add(timer);
        return;
      }
      if (message?.type === "START" && message.file instanceof Blob) {
        trace.starts.push({ name: message.file.name, size: message.file.size, lastModified: message.file.lastModified, forceWasm: true });
        message = { ...message, forceWasm: true };
      }
      if (transfer === undefined) super.postMessage(message);
      else super.postMessage(message, transfer);
    }
  };
});
const page = await context.newPage();
page.on("pageerror", error => result.pageErrors.push(error.message));
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
let peakHeapBytes = 0;
async function metrics() {
  const measured = await cdp.send("Performance.getMetrics");
  const heap = measured.metrics.find(item => item.name === "JSHeapUsedSize")?.value || 0;
  peakHeapBytes = Math.max(peakHeapBytes, heap);
}
async function check(name, action) {
  const started = Date.now();
  try {
    const evidence = await action();
    result.checks.push({ name, passed: true, elapsedMs: Date.now() - started, evidence });
    console.log("PASS " + name);
    return evidence;
  } catch (error) {
    result.checks.push({ name, passed: false, elapsedMs: Date.now() - started, error: String(error.stack || error) });
    throw error;
  }
}
async function withTestWatermark(targetPage, action) {
  await targetPage.evaluate(() => {
    const banner = document.createElement("div"); banner.id = "local-workflow-test-watermark";
    banner.textContent = "合成样本浏览器验收 · ONNX 实际执行 · 登录及路线接口回放（非真实道路验收）";
    banner.style.cssText = "position:fixed;left:12px;bottom:8px;z-index:2147483647;background:#fff3d6;color:#6b3600;border:1px solid #c57b16;border-radius:6px;padding:7px 11px;font:12px sans-serif;pointer-events:none";
    document.body.append(banner);
  });
  try { return await action(); }
  finally { await targetPage.locator("#local-workflow-test-watermark").evaluate(element => element.remove()); }
}
async function screenshot(name) {
  const path = join(artifactDir, name + ".png");
  await withTestWatermark(page, () => page.screenshot({ path, fullPage: true }));
  result.screenshots.push(path);
}
async function openSection(name) {
  const button = page.locator(".workspace-primary-nav").getByRole("button", { name, exact: true });
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
}
async function openAnalysis(value) {
  await openSection("分析");
  await page.locator('select[aria-label="分析任务"]:visible').selectOption(value);
}
const localPanel = () => page.locator(".pasc-local-webgis:visible");
async function chooseFile(path) {
  await page.locator('input[type="file"][accept*="csv"]').first().setInputFiles(path);
  await page.locator(".pasc-local-field-mapping:visible").waitFor({ timeout: 20_000 });
}
async function identity() {
  return page.locator("[data-local-dataset-id]").evaluate(element => ({
    datasetId: element.getAttribute("data-local-dataset-id"), analysisId: element.getAttribute("data-local-analysis-id"), priorityState: element.getAttribute("data-local-priority-state"),
  }));
}
async function runFile(path) {
  await openAnalysis("pasc");
  await chooseFile(path);
  const before = await page.evaluate(() => window.__localUserWorkflow.completions.length);
  const start = Date.now();
  await localPanel().locator(".pasc-local-webgis-actions button").first().click();
  await page.waitForFunction(count => {
    const state = document.querySelector("[data-local-analysis-state]")?.getAttribute("data-local-analysis-state");
    return state === "error" || state === "cancelled" || (state === "ready" && window.__localUserWorkflow.completions.length > count);
  }, before, { timeout: 180_000 });
  assert.equal(await localPanel().getAttribute("data-local-analysis-state"), "ready", await localPanel().locator(".pasc-local-webgis-status").innerText());
  await page.locator('[data-local-priority-state="ready"]').waitFor({ timeout: 30_000 });
  const completion = await page.evaluate(() => window.__localUserWorkflow.completions.at(-1));
  assert.equal(completion.provider, "wasm", "Must execute the actual WASM model.");
  assert.ok(completion.inferenceMs > 0 && completion.batchCount > 0);
  const performance = JSON.parse(await localPanel().locator("[data-performance]").getAttribute("data-performance"));
  await metrics();
  return { completion, identity: await identity(), performance, browserWallMs: Date.now() - start };
}
async function discover(expected) {
  await openAnalysis("anomaly");
  await page.getByLabel("异常速率绝对值下限").fill("10");
  await page.getByLabel("异常累计量绝对值下限").fill("30");
  await page.getByLabel("异常聚集半径").fill("60");
  await page.getByLabel("异常聚集最少点数").fill("3");
  await page.getByLabel("异常相干性下限").fill("0.75");
  await page.getByLabel("异常形变方向").selectOption("negative");
  await page.locator(".anomaly-apply-button").click();
  await page.locator('[data-local-priority-state="ready"]').waitFor({ timeout: 30_000 });
  await page.locator(".anomaly-region-panel:visible").waitFor();
  await page.waitForFunction(expectedCount => {
    if (document.querySelector("[data-local-priority-state]")?.getAttribute("data-local-priority-state") !== "ready") return false;
    const metric = [...document.querySelectorAll(".anomaly-region-evidence span")].find(element => element.textContent.includes("聚集异常"));
    return Number((metric?.querySelector("b")?.textContent || "").replaceAll(",", "")) === expectedCount;
  }, expected, { timeout: 30_000 });
  const count = Number((await page.locator(".anomaly-region-evidence").locator("span").filter({ hasText: "聚集异常" }).locator("b").innerText()).replaceAll(",", ""));
  assert.equal(count, expected, "Expected deterministic dual-threshold clustering of synthetic raw observations.");
  return { count, list: await page.locator(".anomaly-region-list").innerText(), stats: await page.locator(".anomaly-region-evidence").innerText() };
}
async function renderedPointTargets() {
  await page.locator(".leaflet-full-point-layer").waitFor();
  return page.locator(".leaflet-full-point-layer").evaluate(canvas => {
    const width = canvas.width, height = canvas.height, rect = canvas.getBoundingClientRect();
    const pixels = new Uint8Array(width * height * 4);
    const webgl = canvas.dataset.renderer === "webgl";
    if (webgl) { const gl = canvas.getContext("webgl"); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); }
    else pixels.set(canvas.getContext("2d").getImageData(0, 0, width, height).data);
    const visited = new Uint8Array(width * height), targets = [];
    for (let index = 0; index < visited.length; index += 1) {
      if (visited[index] || pixels[index * 4 + 3] < 60) continue;
      const queue = [index]; visited[index] = 1;
      let sumX = 0, sumY = 0;
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const held = queue[cursor], x = held % width, y = Math.floor(held / width); sumX += x; sumY += y;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nextX = x + dx, nextY = y + dy, next = nextY * width + nextX;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height || visited[next] || pixels[next * 4 + 3] < 60) continue;
          visited[next] = 1; queue.push(next);
        }
      }
      const x = rect.left + (sumX / queue.length + 0.5) * rect.width / width;
      const rawY = sumY / queue.length;
      const y = rect.top + ((webgl ? height - 1 - rawY : rawY) + 0.5) * rect.height / height;
      if (document.elementFromPoint(x, y)?.closest(".leaflet-host")) targets.push({ x, y, pixelCount: queue.length, renderer: canvas.dataset.renderer });
    }
    return targets.sort((a, b) => a.x - b.x || b.y - a.y);
  });
}
async function saveActualSvg(locator, name) {
  const svg = await locator.evaluate(element => {
    const cloned = element.cloneNode(true);
    const originals = [element, ...element.querySelectorAll("*")], copies = [cloned, ...cloned.querySelectorAll("*")];
    originals.forEach((source, index) => { const style = getComputedStyle(source); for (const property of ["fill", "stroke", "stroke-width", "stroke-dasharray", "font-family", "font-size", "font-weight", "opacity"]) copies[index].style.setProperty(property, style.getPropertyValue(property)); });
    cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const box = element.viewBox.baseVal; cloned.setAttribute("width", String(box.width)); cloned.setAttribute("height", String(box.height));
    return new XMLSerializer().serializeToString(cloned);
  });
  assert.doesNotMatch(svg, /NaN|Infinity/);
  const path = join(artifactDir, name + ".svg"); await writeFile(path, svg, "utf8"); return path;
}
async function expandTaskLibrary() {
  const library = page.locator(".road-task-draft-library:visible");
  await library.waitFor();
  if (await library.getAttribute("open") === null) await library.locator(":scope > summary").click();
}
async function download(button, name) {
  const [item] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), button.click()]);
  const path = join(artifactDir, name);
  await item.saveAs(path);
  return { path, suggestedFilename: item.suggestedFilename(), text: readFileSync(path, "utf8").replace(/^\uFEFF/, "") };
}

try {
  await page.goto(targetUrl.href, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator(".workspace-primary-nav").waitFor({ timeout: 45_000 });
  await check("fewer than 20 date columns block inference before creating a worker task", async () => {
    await openAnalysis("pasc");
    await chooseFile(shortPath);
    const starts = await page.evaluate(() => window.__localUserWorkflow.starts.length);
    assert.match(await localPanel().innerText(), /不足 20|至少 20/);
    assert.equal(await localPanel().locator(".pasc-local-webgis-actions button").first().isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__localUserWorkflow.starts.length), starts);
    return { observedDates: 12, inferenceStarted: false };
  });
  await check("cancelling real local inference keeps the selected file and publishes no partial result", async () => {
    await chooseFile(basePath);
    const before = await page.evaluate(() => window.__localUserWorkflow.completions.length);
    await localPanel().locator(".pasc-local-webgis-actions button").first().click();
    await localPanel().getByRole("button", { name: "取消", exact: true }).click();
    await page.locator('[data-local-analysis-state="cancelled"]').waitFor({ timeout: 30_000 });
    assert.equal(await page.evaluate(() => window.__localUserWorkflow.completions.length), before);
    const selected = await localPanel().locator(".pasc-local-webgis-file").innerText();
    assert.ok(selected.includes("insar-user-template.csv"));
    assert.equal(await localPanel().locator(".pasc-local-webgis-actions button").first().isDisabled(), false);
    return { fileRetainedInComponent: selected, partialResultPublished: false, message: await localPanel().locator(".pasc-local-webgis-status").innerText() };
  });
  const baseline = await check("unclassified 40-date CSV executes real local WASM and completes the anomaly worker", async () => {
    const run = await runFile(basePath);
    assert.equal(run.completion.pointIds.length, 8);
    assert.equal(run.completion.sourceEpochs, 40);
    assert.ok(run.identity.datasetId.startsWith("local-file-"));
    assert.ok(run.identity.analysisId);
    const found = await discover(6);
    await screenshot("01-real-wasm-anomaly");
    return { ...run, anomaly: found };
  });
  await check("actual map-point selection exposes model-grid SVG and separately preserves the 40 raw observations", async () => {
    await openAnalysis("point");
    const targets = await renderedPointTargets();
    assert.ok(targets.length > 0, "Actual point renderer must publish clickable pixels.");
    await page.mouse.click(targets[0].x, targets[0].y);
    const panel = page.locator(".point-analysis-tab:visible");
    await panel.locator(".local-observed-series").waitFor({ timeout: 15_000 });
    const pointId = await panel.locator(".point-title h2").innerText();
    const input = originalRows.find(row => row[0] === pointId); assert.ok(input, "Mouse-selected point must exist in the actual CSV.");
    const curve = panel.locator(".series-chart svg"); await curve.waitFor();
    assert.equal((await curve.locator(".data-line").getAttribute("points")).trim().split(/\s+/).length, baseline.completion.timeSteps);
    await panel.locator(".local-observed-series > summary").click();
    const raw = await panel.locator(".local-observed-series tbody tr").evaluateAll(rows => rows.map(row => [...row.querySelectorAll("td")].map(cell => cell.textContent)));
    assert.equal(raw.length, 40);
    assert.equal(raw[0][0], "2022-01-01"); assert.equal(raw.at(-1)[0], "2024-12-28");
    raw.forEach((row, index) => assert.ok(Math.abs(Number(row[1]) - Number(input[5 + index])) <= 0.051));
    const modelExport = await download(panel.getByRole("button", { name: "导出单点 CSV ↓", exact: true }), "selected-point-model-grid.csv");
    const lines = modelExport.text.trim().split(/\r?\n/).map(line => line.split(","));
    const dateStart = lines.findIndex(row => row[0] === "date");
    assert.ok(dateStart >= 0);
    const candidateRows = lines.slice(dateStart + 1), endOfModel = candidateRows.findIndex(row => !/^\d{4}-\d{2}-\d{2}$/.test(row[0]));
    const modelRows = endOfModel < 0 ? candidateRows : candidateRows.slice(0, endOfModel);
    assert.equal(lines[1][0], pointId); assert.equal(modelRows.length, baseline.completion.timeSteps);
    assert.equal(modelRows[0][0], baseline.completion.dates[0]);
    assert.equal(modelRows.at(-1)[0], baseline.completion.dates.at(-1));
    assert.equal(lines[dateStart][1], "processed_displacement_mm");
    const observedStart = lines.findIndex(row => row[0] === "observed_date");
    assert.ok(observedStart > dateStart);
    assert.deepEqual(lines[observedStart], ["observed_date", "observed_displacement_mm", "observation_present"]);
    const observedRows = lines.slice(observedStart + 1);
    assert.equal(observedRows.length, 40);
    observedRows.forEach((row, index) => {
      assert.equal(row[0], raw[index][0]); assert.equal(row[2], "true");
      assert.ok(Math.abs(Number(row[1]) - Number(input[5 + index])) <= 0.002);
    });
    const svgPath = await saveActualSvg(curve, "selected-point-model-grid");
    await curve.scrollIntoViewIfNeeded();
    await screenshot("01b-real-point-model-grid");
    await panel.locator(".local-observed-series").scrollIntoViewIfNeeded();
    await screenshot("01b-real-point-raw-values");
    return { pointId, actualMouse: targets[0], rawDates: 40, modelDates: baseline.completion.timeSteps, graphSource: "actual processed model grid, raw values shown in separate table", svgPath, modelCsvPath: modelExport.path };
  });
  await check("AOI cancellation/retry computes real raw-date aggregate SVG and exports all 40 source dates", async () => {
    await page.evaluate(() => { window.__localUserWorkflow.delayNextAoiMs = 1200; });
    await discover(6);
    await openAnalysis("region");
    const card = page.locator(".aoi-series-card:visible");
    await card.getByRole("button", { name: "取消计算", exact: true }).click();
    await card.getByText("区域计算已取消。", { exact: true }).waitFor();
    await card.getByRole("button", { name: "重试区域计算", exact: true }).click();
    await card.locator("svg").waitFor({ timeout: 30_000 });
    assert.equal((await card.locator(".aoi-overall-line").getAttribute("points")).trim().split(/\s+/).length, 40);
    const aggregate = await download(card.getByRole("button", { name: "导出图表数据 CSV", exact: true }), "aoi-median-original-dates.csv");
    const rows = aggregate.text.trim().split(/\r?\n/).map(line => line.split(","));
    assert.equal(rows.length, 41); assert.equal(rows[0][0], "date"); assert.equal(rows[0][1], "overall_median");
    rows.slice(1).forEach((row, index) => {
      const header = dateHeaders[index].slice(1), date = header.slice(0, 4) + "-" + header.slice(4, 6) + "-" + header.slice(6);
      assert.equal(row[0], date); assert.ok(Math.abs(Number(row[1]) - Number(originalRows[0][5 + index])) < 0.002);
    });
    const svgPath = await saveActualSvg(card.locator("svg"), "aoi-median-original-dates");
    const png = await download(card.getByRole("button", { name: "导出图表 PNG", exact: true }), "aoi-median-original-dates.png");
    assert.deepEqual(Array.from(readFileSync(png.path).subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    await card.getByRole("button", { name: "平均值", exact: true }).click();
    await card.getByRole("img", { name: "AOI 平均值累计形变时序，单位毫米", exact: true }).waitFor({ timeout: 30_000 });
    const mean = await download(card.getByRole("button", { name: "导出图表数据 CSV", exact: true }), "aoi-mean-original-dates.csv");
    assert.equal(mean.text.trim().split(/\r?\n/).length, 41);
    await screenshot("01c-real-aoi-raw-grid");
    return { rawDates: 40, pointCount: 6, medianSourceValuesVerified: true, svgPath, aggregatePath: aggregate.path, pngPath: png.path, meanPath: mean.path, cancellationSchedulingHold: "1200ms before one actual AOI request; retry runs actual worker, no fake aggregate output" };
  });
  await check("model-grid timeline review changes displayed epoch while anomaly evaluation stays bound to the last raw observation", async () => {
    const before = await identity(), timeline = page.getByRole("slider", { name: /日期与累计形变渲染时间轴$/ });
    await timeline.focus(); await page.keyboard.press("Home");
    await page.locator(".timeline-bar b").filter({ hasText: "2022-01-01" }).waitFor();
    assert.match(await page.locator(".selection-summary:visible").innerText(), /当前期 2022-01-01/);
    assert.match(await page.locator(".anomaly-result-banner:visible").innerText(), /2024-12-28/);
    assert.equal((await identity()).analysisId, before.analysisId);
    await timeline.focus(); await page.keyboard.press("End");
    await page.locator(".timeline-bar b").filter({ hasText: "2024-12-28" }).waitFor();
    assert.equal((await identity()).analysisId, before.analysisId);
    return { timelineSource: "processed-model-grid", reviewedDate: "2022-01-01", restoredDate: "2024-12-28", detectionDate: "2024-12-28", analysisId: before.analysisId };
  });
  await check("missing final raw observation stays missing and is excluded from final-epoch anomaly membership", async () => {
    const run = await runFile(missingPath);
    const pointIndex = run.completion.pointIds.indexOf("user-01");
    assert.ok(pointIndex >= 0);
    const epochs = run.completion.observedDates.length;
    assert.equal(run.completion.observedMask[pointIndex * epochs + epochs - 1], 0);
    assert.equal(run.completion.effectiveEpochs[pointIndex], 39);
    const found = await discover(5);
    await openAnalysis("pasc");
    const output = await download(localPanel().getByRole("button", { name: "导出原始数据＋分类字段", exact: true }), "original-plus-classification.csv");
    const parsed = output.text.trim().split(/\r?\n/).map(line => line.split(","));
    const row = parsed.find(row => row[0] === "user-01");
    assert.ok(row);
    assert.equal(row[sourceHeaders.length - 1], "");
    assert.equal(parsed[0][sourceHeaders.length - 1], dateHeaders.at(-1));
    await screenshot("02-preserved-final-missing");
    return { rawMissingPreserved: true, observedEpochs: epochs, anomaly: found, exportPath: output.path };
  });
  await check("a point with 19 valid observations is retained but does not receive a model classification", async () => {
    const run = await runFile(sparsePath), index = run.completion.pointIds.indexOf("limited-19");
    assert.ok(index >= 0, "Keep the valid spatial point instead of deleting its row.");
    assert.equal(run.completion.effectiveEpochs[index], 19);
    assert.equal(run.completion.classificationEligible[index], 0);
    assert.equal(run.completion.pointIds.length, 9);
    return run;
  });
  await check("duplicate point IDs fail explicitly and never publish a new result", async () => {
    await openAnalysis("pasc");
    await chooseFile(duplicatePath);
    const before = await page.evaluate(() => window.__localUserWorkflow.completions.length);
    await localPanel().locator(".pasc-local-webgis-actions button").first().click();
    await page.locator('[data-local-analysis-state="error"]').waitFor({ timeout: 45_000 });
    const message = await localPanel().locator(".pasc-local-webgis-status").innerText();
    assert.match(message, /重复.*编号|重复点编号/);
    assert.equal(await page.evaluate(() => window.__localUserWorkflow.completions.length), before);
    return { message, resultPublished: false };
  });
  const originalAgain = await runFile(basePath);
  await discover(6);
  await openSection("核查");
  await page.locator(".inspection-candidate").first().getByRole("button", { name: "查看分组", exact: true }).click();
  await page.getByRole("button", { name: "加入核查行程", exact: true }).click();
  await page.locator(".road-navigation:visible").waitFor();
  await page.getByRole("button", { name: "使用目标位置算路（入口待核验）", exact: true }).click();
  const replacement = await check("same file name/size/mtime and reused point IDs produce a new dataset identity for changed content", async () => {
    const run = await runFile(replacementPath);
    assert.notEqual(run.identity.datasetId, originalAgain.identity.datasetId);
    assert.notEqual(run.identity.analysisId, originalAgain.identity.analysisId);
    assert.deepEqual(run.completion.pointIds, originalAgain.completion.pointIds);
    assert.ok(Math.abs(run.completion.longitude[0] - Number(replacementRows[1][1])) < 0.00002);
    const observedStarts = await page.evaluate(() => window.__localUserWorkflow.starts.slice(-2));
    assert.equal(observedStarts[0].name, observedStarts[1].name);
    assert.equal(observedStarts[0].size, observedStarts[1].size);
    assert.equal(observedStarts[0].lastModified, observedStarts[1].lastModified);
    await openSection("驾车");
    assert.equal(await page.locator(".road-navigation-source").count(), 1, "Keep old task provenance instead of silently relabelling it.");
    assert.match(await page.locator(".road-navigation-arrival").innerText(), /分析来源已过期/);
    assert.equal(await page.getByRole("button", { name: "规划驾车路线", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "使用目标位置算路（入口待核验）", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: /^删除途经点/ }).click();
    assert.equal(await page.locator(".road-navigation-source").count(), 0);
    return { staleTaskBlocked: true, prior: originalAgain.identity, current: run.identity, sameMetadata: observedStarts, currentLongitude: run.completion.longitude[0] };
  });
  await check("an actual anomaly region bridges to a real member and preserves local dataset/analysis provenance", async () => {
    await discover(6);
    await openSection("核查");
    await page.locator(".inspection-candidate").first().getByRole("button", { name: "查看分组", exact: true }).click();
    await page.getByRole("button", { name: "加入核查行程", exact: true }).click();
    await page.locator(".road-navigation:visible").waitFor();
    await page.locator(".road-navigation-source > summary").click();
    const text = await page.locator(".road-navigation-source").innerText();
    assert.match(text, /真实点 user-0[1-6]/);
    const current = await identity();
    assert.equal(current.datasetId, replacement.current.datasetId);
    assert.ok(text.includes(current.analysisId));
    await screenshot("03-region-to-itinerary");
    return { current, sourcePanel: text };
  });
  await check("explicit arrival choice is required, rule changes block stale source, and the exact analysis identity can resume", async () => {
    const before = await identity();
    assert.equal(await page.locator(".road-navigation-arrival").getAttribute("data-inspection-arrival-selection"), "unconfirmed");
    assert.equal(await page.getByRole("button", { name: "规划驾车路线", exact: true }).isDisabled(), true);
    await openAnalysis("anomaly");
    await page.getByLabel("异常速率绝对值下限").fill("11");
    await page.locator(".anomaly-apply-button").click();
    await page.waitForFunction(prior => {
      const root = document.querySelector("main[data-local-analysis-id]");
      return root?.getAttribute("data-local-priority-state") === "ready" && !!root.getAttribute("data-local-analysis-id") && root.getAttribute("data-local-analysis-id") !== prior;
    }, before.analysisId, { timeout: 30_000 });
    await openSection("驾车");
    assert.match(await page.locator(".road-navigation-arrival").innerText(), /分析来源已过期/);
    assert.equal(await page.getByRole("button", { name: "规划驾车路线", exact: true }).isDisabled(), true);
    await discover(6);
    await page.waitForFunction(prior => document.querySelector("main[data-local-analysis-id]")?.getAttribute("data-local-analysis-id") === prior, before.analysisId, { timeout: 30_000 });
    await openSection("驾车");
    await page.getByRole("button", { name: "使用目标位置算路（入口待核验）", exact: true }).click();
    assert.equal(await page.locator(".road-navigation-arrival").getAttribute("data-inspection-arrival-selection"), "target");
    assert.equal(await page.locator(".road-navigation-point-candidate").getByLabel("途经点 1进入核验").inputValue(), "unknown");
    assert.equal(await page.getByRole("button", { name: "规划驾车路线", exact: true }).isDisabled(), false);
    assert.equal(drivingCalls, 0);
    return { before, restored: await identity(), explicitSelection: "target", accessReview: "unknown", staleRuleBlocked: true, routeRequests: 0 };
  });
  await check("401 opens login in a new tab and returns to the original File/results without automatic route retry", async () => {
    const origin = page.locator(".road-navigation-point-origin"), destination = page.locator(".road-navigation-point-destination");
    await origin.locator(".road-navigation-coordinate-editor > summary").click();
    await origin.getByLabel("起点 WGS84 经度").fill("110.340000");
    await origin.getByLabel("起点 WGS84 纬度").fill("20.020000");
    await origin.getByRole("button", { name: "应用此坐标", exact: true }).click();
    await destination.locator(".road-navigation-coordinate-editor > summary").click();
    await destination.getByLabel("终点 WGS84 经度").fill("110.365000");
    await destination.getByLabel("终点 WGS84 纬度").fill("20.040000");
    await destination.getByRole("button", { name: "应用此坐标", exact: true }).click();
    const before = await identity(), originalUrl = page.url();
    const originalFile = await page.locator(".pasc-local-webgis-file").innerText();
    assert.ok(originalFile.includes("insar-user-template.csv"));
    const completions = await page.evaluate(() => window.__localUserWorkflow.completions.length);
    await page.getByRole("button", { name: "规划驾车路线", exact: true }).click();
    const loginLink = page.locator(".road-navigation").getByRole("link", { name: "在新标签页登录，保留当前分析", exact: true });
    await loginLink.waitFor();
    assert.equal(await loginLink.getAttribute("target"), "_blank");
    assert.match(await loginLink.getAttribute("href"), /returnTo=.*resume=1/);
    assert.equal(drivingCalls, 1);
    await screenshot("04-login-needed-original-preserved");
    const popupEvent = page.waitForEvent("popup");
    await loginLink.click();
    const loginPage = await popupEvent;
    await loginPage.getByLabel("邮箱", { exact: false }).fill("workflow@example.test");
    await loginPage.getByLabel("密码", { exact: false }).fill("test-workflow-pass");
    await loginPage.getByRole("button", { name: /登录并进入平台/ }).click();
    await loginPage.getByRole("heading", { name: "登录已完成", exact: true }).waitFor();
    assert.equal(new URL(loginPage.url()).pathname, "/login");
    const loginShot = join(artifactDir, "05-login-completed-resume.png");
    await withTestWatermark(loginPage, () => loginPage.screenshot({ path: loginShot, fullPage: true }));
    result.screenshots.push(loginShot);
    await page.bringToFront();
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    await page.getByText("登录会话已恢复，点位已保留；请点击规划驾车路线重试。", { exact: true }).waitFor();
    assert.equal(drivingCalls, 1);
    assert.equal(page.url(), originalUrl);
    assert.equal((await identity()).datasetId, before.datasetId);
    assert.equal((await identity()).analysisId, before.analysisId);
    assert.equal(await page.locator(".pasc-local-webgis-file").innerText(), originalFile);
    const startedFile = await page.evaluate(() => window.__localUserWorkflow.starts.at(-1));
    assert.equal(startedFile.name, "insar-user-template.csv");
    assert.equal(startedFile.size, readFileSync(replacementPath).byteLength);
    assert.equal(await page.evaluate(() => window.__localUserWorkflow.completions.length), completions);
    await loginPage.close();
    return { originalFile, identity: before, originalUrl, routeRequests: drivingCalls, focusEventDispatch: true, authReplayOnly: true };
  });
  await check("explicit route retry consumes only the controlled HTTP replay and retains member coordinates", async () => {
    await page.getByRole("button", { name: "规划驾车路线", exact: true }).click();
    await page.locator(".road-field-plan:visible").waitFor({ timeout: 20_000 });
    assert.equal(drivingCalls, 2);
    const candidate = drivingRequests.at(-1).points.find(point => point.role === "candidate");
    const actualMembers = replacementRows.slice(1, 7);
    assert.ok(actualMembers.some(row => Math.abs(Number(row[1]) - candidate.coordinate[0]) < 0.00002 && Math.abs(Number(row[2]) - candidate.coordinate[1]) < 0.00002));
    assert.ok(!JSON.stringify(drivingRequests.at(-1)).includes("analysisId"));
    await screenshot("06-route-contract-replay-only");
    await openAnalysis("pasc");
    assert.equal(await localPanel().getAttribute("data-local-analysis-state"), "ready", "Drawer changes must preserve original analysis results.");
    await localPanel().locator("[data-performance]").waitFor();
    return { requestCount: drivingCalls, upstreamRequests: 0, replayOnly: true, realMemberCoordinate: candidate.coordinate, originalResultStillAvailable: true };
  });
  await check("saving/exporting/restoring the actual itinerary retains source metadata and makes no route call", async () => {
    await openSection("驾车");
    await page.locator(".road-task-advanced-entry").click();
    await page.locator(".road-field-task-editor:visible").waitFor();
    await page.getByLabel("任务名称", { exact: true }).first().fill("本机流程验收");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await page.locator(".road-task-draft-notice").filter({ hasText: "已保存在此浏览器" }).waitFor();
    await expandTaskLibrary();
    const backup = await download(page.getByRole("button", { name: "导出当前草稿 JSON", exact: true }), "inspection-itinerary.json");
    const plan = JSON.parse(backup.text), task = plan.tasks.find(task => task.inspectionSource);
    assert.ok(task?.inspectionSource);
    assert.equal(task.inspectionSource.datasetId, replacement.current.datasetId);
    assert.equal(task.inspectionSource.analysisId, (await identity()).analysisId);
    assert.match(task.inspectionSource.representativePointId, /^user-0[1-6]$/);
    assert.equal(task.inspectionSource.arrivalSelection, "target");
    const callsBefore = drivingCalls;
    await page.getByRole("button", { name: "恢复所选", exact: true }).click();
    await page.getByRole("button", { name: "确认恢复", exact: true }).click();
    await expandTaskLibrary();
    const restored = JSON.parse((await download(page.getByRole("button", { name: "导出当前草稿 JSON", exact: true }), "restored-itinerary.json")).text);
    assert.deepEqual(restored.tasks.find(task => task.inspectionSource).inspectionSource, task.inspectionSource);
    assert.equal(drivingCalls, callsBefore);
    return { savedPlanId: plan.planId, taskId: task.taskId, provenance: task.inspectionSource, routeCallsAfterRestore: drivingCalls, storage: "browser IndexedDB replay test session" };
  });
  await check("restored full task editor blocks stale analysis sources without losing the saved task or requesting a route", async () => {
    const before = await identity(), routeCallsBefore = drivingCalls;
    await openAnalysis("anomaly");
    await page.getByLabel("异常速率绝对值下限").fill("11");
    await page.locator(".anomaly-apply-button").click();
    await page.waitForFunction(prior => {
      const root = document.querySelector("main[data-local-analysis-id]");
      return root?.getAttribute("data-local-priority-state") === "ready" && !!root.getAttribute("data-local-analysis-id") && root.getAttribute("data-local-analysis-id") !== prior;
    }, before.analysisId, { timeout: 30_000 });
    await openSection("驾车");
    const full = page.locator(".road-field-task-editor:visible"); await full.waitFor();
    assert.match(await full.locator(".road-navigation-arrival").innerText(), /分析来源已过期/);
    assert.equal(await full.getByRole("button", { name: "规划外业行程", exact: true }).isDisabled(), true);
    assert.equal(await full.getByRole("button", { name: "确认当前车辆停靠位置用于算路（入口待核验）", exact: true }).isDisabled(), true);
    const source = full.locator(".road-field-task-source");
    if (await source.getAttribute("open") === null) await source.locator(":scope > summary").click();
    assert.ok((await source.innerText()).includes(before.analysisId));
    await full.locator(".road-navigation-arrival").scrollIntoViewIfNeeded();
    await screenshot("07a-restored-full-task-stale-source-blocked");
    await discover(6);
    await page.waitForFunction(prior => document.querySelector("main[data-local-analysis-id]")?.getAttribute("data-local-analysis-id") === prior, before.analysisId, { timeout: 30_000 });
    await openSection("驾车");
    assert.doesNotMatch(await full.locator(".road-navigation-arrival").innerText(), /分析来源已过期/);
    assert.equal(await full.getByRole("button", { name: "确认当前车辆停靠位置用于算路（入口待核验）", exact: true }).isDisabled(), false);
    assert.equal(drivingCalls, routeCallsBefore);
    await source.scrollIntoViewIfNeeded();
    await screenshot("07-restored-full-task-source-guard");
    return { sourceIdentityPreserved: before, staleBlocked: true, recoveredSameFileSettings: true, routeRequestsDuringCheck: 0 };
  });
  await check("clearing temporary analysis preserves the selected File and invalidates retained task sources", async () => {
    const before = await identity(), routeCallsBefore = drivingCalls;
    const startsBefore = await page.evaluate(() => window.__localUserWorkflow.starts.length);
    await openAnalysis("pasc");
    const fileCardBefore = await localPanel().locator(".pasc-local-webgis-file").innerText();
    await localPanel().getByRole("button", { name: "清理当前临时分析结果", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-local-analysis-state]")?.getAttribute("data-local-analysis-state") === "idle");
    await localPanel().getByText("当前临时结果已清理；原始 CSV 保留，可重新分析。", { exact: true }).waitFor();
    assert.equal(await localPanel().locator(".pasc-local-webgis-file").innerText(), fileCardBefore);
    assert.equal(await localPanel().locator("[data-performance]").count(), 0);
    assert.equal(await localPanel().locator(".pasc-local-webgis-actions button").first().isDisabled(), false);
    const after = await identity(); assert.equal(after.datasetId, ""); assert.equal(after.analysisId, "");
    await openSection("驾车");
    const full = page.locator(".road-field-task-editor:visible"); await full.waitFor();
    const source = full.locator(".road-field-task-source");
    if (await source.getAttribute("open") === null) await source.locator(":scope > summary").click();
    assert.ok((await source.innerText()).includes(before.analysisId));
    assert.match(await full.locator(".road-navigation-arrival").innerText(), /分析来源已过期/);
    assert.equal(await full.getByRole("button", { name: "规划外业行程", exact: true }).isDisabled(), true);
    assert.equal(await full.getByRole("button", { name: "确认当前车辆停靠位置用于算路（入口待核验）", exact: true }).isDisabled(), true);
    assert.equal(drivingCalls, routeCallsBefore);
    assert.equal(await page.evaluate(() => window.__localUserWorkflow.starts.length), startsBefore);
    await full.locator(".road-navigation-arrival").scrollIntoViewIfNeeded();
    await screenshot("08-cleanup-file-retained-source-invalid");
    return { previousIdentity: before, clearedIdentity: after, retainedFile: fileCardBefore, taskSourceRetained: true, staleSourceBlocked: true, automaticInferenceOrRouteRequests: 0 };
  });
  await check("local CSV never crosses upload/server-inference boundaries", async () => {
    const forbidden = result.requests.filter(request => /\/api\/(?:uploads|pasc(?:\/|$)|pasc-jobs)|\/v1\/jobs/.test(new URL(request.url).pathname));
    assert.deepEqual(forbidden, []);
    assert.equal(result.pageErrors.length, 0);
    return { rawUploadRequests: 0, serverInferenceRequests: 0, externalModelRequestsAllowed: 0, routeProviderCalls: 0, authAndRouteHttpMocked: true };
  });
  result.baselineInference = baseline.performance;
  result.peakJsHeapBytes = peakHeapBytes;
  result.workerTrace = await page.evaluate(() => window.__localUserWorkflow);
  result.browser = browser.version();
  result.passed = true;
} catch (error) {
  result.failure = String(error.stack || error);
  await screenshot("failure").catch(() => null);
  result.domSnapshot = await page.locator("body").innerText().catch(() => "");
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  result.drivingContractReplayRequests = drivingCalls;
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ outputPath, passed: result.passed, checks: result.checks.map(({ name, passed }) => ({ name, passed })), failure: result.failure }, null, 2));
  await browser.close();
}

