import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

// Measures and operates the real local MapWorkspace. No supplier, AI, or route
// requests are allowed; authentication is a labelled synthetic session replay.
const require = createRequire(import.meta.url);
const runtimeModules = process.env.CODEX_NODE_MODULES || "C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright"); }
catch { playwright = require(join(runtimeModules, "playwright")); }
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || process.env.PASC_EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
assert.ok(existsSync(executablePath), "Set CHROMIUM_EXECUTABLE_PATH to installed Edge/Chrome.");
const targetUrl = new URL(process.env.WORKSPACE_CONTROL_TEST_URL || "http://127.0.0.1:4195/map?demo=city");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(targetUrl.hostname), "This development check only operates localhost.");
const artifactDir = resolve("artifacts/workspace-control-size-browser");
const resultPath = resolve("artifacts/workspace-control-size-browser.json");
await mkdir(artifactDir, { recursive: true });
const sourceFiles = ["app/globals.css", "app/workspace-ui.css", "app/components/WorkspaceHeader.tsx", "app/components/WorkspaceSelect.tsx", "app/components/MapWorkspace.tsx"];
const report = {
  schemaVersion: "workspace-control-size-browser-v1", startedAt: new Date().toISOString(), passed: false,
  scope: { page: targetUrl.href, ui: "Actual MapWorkspace, WorkspaceHeader and WorkspaceSelect", testZoom: "Fresh headless browser context, deviceScaleFactor 1", userBrowserZoomKnown: false, auth: "Synthetic local session replay; no actual login or account request", mapTiles: "External OSM tiles blocked; screenshots assess controls only", supplierCalls: false, aiCalls: false },
  sourceHashes: Object.fromEntries(sourceFiles.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
  checks: [], measurements: [], screenshots: [], blockedApiRequests: [], replayedAuthRequests: [], externalRequests: [], pageErrors: [], error: null,
};
const check = (name, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  report.checks.push({ name, actual, expected, passed });
  assert.deepEqual(actual, expected, name);
};
const measure = locator => locator.evaluateAll(elements => elements.filter(element => element.checkVisibility()).map(element => {
  const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
  const label = element.querySelector(".workspace-nav-label,.workspace-control-copy b") || element;
  const icon = element.querySelector("svg");
  return { label: element.textContent.trim(), width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, fontSize: parseFloat(getComputedStyle(label).fontSize), minHeight: style.minHeight, iconWidth: icon ? icon.getBoundingClientRect().width : null };
}));
let browser;
try {
  browser = await playwright.chromium.launch({ executablePath, headless: true, args: ["--no-first-run"] });
  report.browserVersion = browser.version();
  for (const width of [1920, 1280, 900, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === targetUrl.origin && url.pathname === "/api/auth" && url.searchParams.get("op") === "session") {
        report.replayedAuthRequests.push({ width, method: request.method() });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, user: { id: "control-size-local-fixture", email: "controls@example.invalid", name: "尺寸验收账号", roles: ["user"] } }) });
      }
      if (url.origin === targetUrl.origin && url.pathname.startsWith("/api/")) {
        report.blockedApiRequests.push({ width, path: url.pathname, method: request.method() });
        return route.abort("blockedbyclient");
      }
      if (url.origin === targetUrl.origin || ["data:", "blob:"].includes(url.protocol)) return route.continue();
      report.externalRequests.push({ width, origin: url.origin, path: url.pathname });
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.on("pageerror", error => report.pageErrors.push({ width, error: String(error) }));
    await page.goto(targetUrl.href, { waitUntil: "domcontentloaded" });
    await page.locator(".workspace-primary-nav button").last().waitFor();
    await page.locator(".workspace-view-toolbar").waitFor();
    await page.waitForFunction(() => document.querySelectorAll(".workspace-primary-nav button").length === 6 && document.querySelector(".workspace-data-card strong")?.textContent?.length);
    await page.waitForFunction(() => {
      const count = parseInt((document.querySelector(".workspace-data-card small")?.textContent ?? "").replaceAll(",", ""), 10);
      return count > 5 && !/正在加载/.test(document.querySelector(".workspace-status-line > span")?.textContent ?? "");
    }, null, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    check(width + " synthetic account utility is visible", await page.locator(".workspace-header-utilities").getByRole("link", { name: "我的数据", exact: true }).isVisible(), true);

    // Close any initial drawer using the real active navigation action.
    const initiallyActive = page.locator('.workspace-primary-nav button[aria-expanded="true"]');
    if (await initiallyActive.count()) await initiallyActive.click();
    const nav = await measure(page.locator(".workspace-primary-nav button"));
    const selectors = await measure(page.locator(".workspace-select-trigger"));
    const actions = await measure(page.locator(".workspace-view-toolbar > .workspace-view-action"));
    const utilities = await measure(page.locator(".workspace-header-utilities"));
    report.measurements.push({ width, nav, selectors, actions, utilities, browser: await page.evaluate(() => ({ innerWidth: window.innerWidth, devicePixelRatio: window.devicePixelRatio, visualViewportScale: window.visualViewport?.scale ?? null })) });
    check(width + " all six primary commands visible", nav.length, 6);
    check(width + " navigation target height", nav.every(item => item.height >= (width < 768 ? 50 : 44)), true);
    check(width + " navigation text remains readable", nav.every(item => item.fontSize >= (width < 768 ? 12 : width < 1024 ? 14 : 15)), true);
    check(width + " primary icons restored", nav.every(item => item.iconWidth >= (width >= 768 && width <= 1200 ? 20 : 22)), true);
    check(width + " both view selectors visible", selectors.length, 2);
    check(width + " selector target height", selectors.every(item => item.height >= (width < 768 ? 40 : 52)), true);
    check(width + " selector text restored", selectors.every(item => item.fontSize >= (width < 768 ? 13 : 15)), true);
    check(width + " view action target height", actions.every(item => item.height >= (width < 768 ? 40 : 48)), true);
    check(width + " view action text restored", actions.every(item => item.fontSize >= (width < 768 ? 13 : 15)), true);
    check(width + " controls remain inside viewport", [...nav, ...selectors, ...actions].every(item => item.left >= -1 && item.right <= width + 1), true);
    const noOverlap = controls => controls.every((a, index) => controls.slice(index + 1).every(b => a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1));
    check(width + " navigation commands do not overlap", noOverlap(nav), true);
    check(width + " view controls do not overlap", noOverlap([...selectors, ...actions]), true);
    const utilitiesLeft = await page.locator(".workspace-header-utilities").evaluate(element => element.getBoundingClientRect().left);
    check(width + " navigation and utilities remain separated", width < 768 || nav.at(-1).right <= utilitiesLeft + 1, true);
    check(width + " account utilities remain inside viewport", utilities.every(item => item.left >= -1 && item.right <= width + 1), true);
    check(width + " no horizontal document overflow", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    check(width + " header retains original height", await page.locator(".workspace-header").evaluate(element => Math.round(element.getBoundingClientRect().height)), width < 768 ? 50 : 56);
    const screenshotPath = join(artifactDir, "map-controls-" + width + "px.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    report.screenshots.push(screenshotPath);

    for (const label of ["数据", "图层", "驾车", "分析", "核查", "导出"]) {
      const button = page.locator(".workspace-primary-nav").getByRole("button", { name: label, exact: true });
      await button.click();
      check(width + " command opens " + label, await button.getAttribute("aria-expanded"), "true");
      check(width + " task surface remains visible for " + label, await page.locator(".workspace-task-drawer:visible,.workspace-export-drawer:visible").count() >= 1, true);
      await button.click();
      check(width + " command closes " + label, await button.getAttribute("aria-expanded"), "false");
    }
    const selection = page.getByRole("button", { name: /^地图选择方式：/ });
    await selection.click();
    check(width + " selection menu opens", await page.getByRole("menu", { name: "地图选择方式", exact: true }).isVisible(), true);
    await page.getByRole("menuitemradio", { name: /矩形框选/ }).click();
    check(width + " selection choice applies", await selection.getAttribute("aria-label"), "地图选择方式：矩形框选");
    check(width + " selected menu closes", await selection.getAttribute("aria-expanded"), "false");
    await selection.focus();
    await page.keyboard.press("ArrowDown");
    check(width + " keyboard opens selection menu", await selection.getAttribute("aria-expanded"), "true");
    await page.keyboard.press("Escape");
    check(width + " Escape closes menu and restores trigger focus", await selection.evaluate(element => document.activeElement === element && element.getAttribute("aria-expanded") === "false"), true);
    const display = page.getByRole("button", { name: /^地图显示属性：/ });
    await display.click();
    await page.getByRole("menuitemradio", { name: "年均速率", exact: true }).click();
    check(width + " display choice applies", await display.getAttribute("aria-label"), "地图显示属性：年均速率");
    if (width === 1280) {
      await page.locator(".workspace-header .language-switch").getByRole("button", { name: "EN", exact: true }).click();
      await page.locator(".workspace-primary-nav").getByRole("button", { name: "Inspection", exact: true }).waitFor();
      const englishNav = await measure(page.locator(".workspace-primary-nav button"));
      const englishUtilities = await measure(page.locator(".workspace-header-utilities"));
      const englishUtilitiesLeft = await page.locator(".workspace-header-utilities").evaluate(element => element.getBoundingClientRect().left);
      report.measurements.push({ width, locale: "en", nav: englishNav, utilities: englishUtilities, utilitiesLeft: englishUtilitiesLeft });
      const englishScreenshot = join(artifactDir, "map-controls-1280px-en.png");
      await page.screenshot({ path: englishScreenshot, fullPage: true });
      report.screenshots.push(englishScreenshot);
      check("1280 English navigation commands do not overlap", noOverlap(englishNav), true);
      check("1280 English navigation and utilities remain separated", englishNav.at(-1).right <= englishUtilitiesLeft + 1, true);
      check("1280 English navigation remains inside viewport", englishNav.every(item => item.left >= -1 && item.right <= width + 1), true);
      check("1280 English account utilities remain inside viewport", englishUtilities.every(item => item.left >= -1 && item.right <= width + 1), true);
    }
    await context.close();
  }
  check("no uncaught browser errors", report.pageErrors, []);
  check("no route or AI calculation requested", report.blockedApiRequests.filter(request => /^\/api\/(roadops|ai|pasc)/.test(request.path)), []);
  report.passed = true;
} catch (error) {
  report.error = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(resultPath, JSON.stringify(report, null, 2) + "\n", "utf8");
}
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, resultPath, screenshots: report.screenshots, error: report.error }, null, 2));
