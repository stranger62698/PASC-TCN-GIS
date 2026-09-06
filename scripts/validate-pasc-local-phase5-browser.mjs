import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PASC_PLAYWRIGHT_MODULE || "playwright");
const targetUrl = process.env.PASC_LOCAL_URL || "http://localhost:3000/map";
const edgePath = process.env.PASC_EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
if (!existsSync(edgePath)) throw new Error("Microsoft Edge executable not found.");

const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const context = await browser.newContext();
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(targetUrl).origin });
const page = await context.newPage();
const requests = [];
const pageErrors = [];
page.on("request", request => requests.push({ method: request.method(), url: request.url() }));
page.on("pageerror", error => pageErrors.push(error.message));

try {
  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector(".dataset-card")?.textContent?.includes("3,094"), undefined, { timeout: 30_000 });
  await page.getByRole("tab", { name: "筛选" }).click();
  await page.getByRole("button", { name: /发现异常/ }).click();
  await page.getByRole("tab", { name: "AI 解读" }).click();
  const before = requests.filter(request => /deepseek|\/api\/ai/i.test(request.url)).length;
  await page.getByRole("button", { name: "复制受限摘要提示词" }).click();
  await page.waitForSelector('.ai-manual-flow textarea[aria-label="DeepSeek 受限摘要提示词"]', { timeout: 10_000 }).catch(async error => { throw new Error(`${error.message}\nAI panel: ${await page.locator(".phase-five-ai-panel").innerText()}`); });
  const prompt = await page.locator('textarea[aria-label="DeepSeek 受限摘要提示词"]').inputValue();
  if (!prompt.includes("AnalysisSummary") || /pointIds|rawSeries|timeSeries|fullCsv/.test(prompt)) throw new Error("manual prompt violates the bounded summary contract");
  const interpretation = { overview: "当前区域摘要已完成解释。", mainPatterns: ["主要模式来自摘要中的模式分布。"], anomalies: ["异常数量仅按既定统计规则解释。"], regionFeatures: ["区域特征仅引用聚合速率与形变统计。"], uncertainty: "存在低置信度分类；PASC-TCN 结果不等同于灾害结论。", recommendations: ["结合完整时序和现场资料复核。"] };
  await page.getByLabel("DeepSeek 返回 JSON").fill(JSON.stringify(interpretation));
  await page.getByRole("button", { name: "导入网页解读" }).click();
  await page.waitForSelector(".ai-result-card");
  const output = await page.locator(".ai-result-card").innerText();
  if (!output.includes("不确定性与使用建议") || !output.includes("不等同于灾害结论")) throw new Error("manual AI result did not render uncertainty");
  const externalRequests = requests.filter(request => /deepseek|\/api\/ai/i.test(request.url));
  const forbiddenTaskRequests = requests.filter(request => /@vercel\/blob|\/v1\/jobs|pasc-jobs|meta\.json/i.test(request.url) || (request.method === "PUT" && /result|progress|request|artifact/i.test(request.url)));
  if (externalRequests.length !== before || forbiddenTaskRequests.length) throw new Error("manual AI workflow made an external AI or task Blob request");
  const result = { schemaVersion: "pasc-local-phase5-browser-v2", targetUrl, aiNetworkRequests: externalRequests.length, promptBytes: Buffer.byteLength(prompt, "utf8"), manuallyImported: true, uncertaintyRendered: true, forbiddenTaskRequests: forbiddenTaskRequests.length, pageErrors };
  await writeFile(resolve("artifacts/pasc-tcn-phase5-browser-results.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
