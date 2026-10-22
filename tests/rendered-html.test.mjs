import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the LANJIFYW InSAR website", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.match(html, /LANJIFYW/);
  assert.doesNotMatch(html, /lanjifyw-brand-satellite\.png|class="[^"]*\bbrand-system\b|<b>LANJIFYW<\/b>|形变研判 · 外业协同/);
  assert.match(html, /形变分析与外业核查工作台/);
  assert.match(html, /时序形变研判/);
  assert.match(html, /与外业核查协同/);
  assert.match(html, /class="hero-scene" aria-hidden="true"/);
  assert.match(html, /class="hero-scene-note"/);
  assert.match(html, /背景为 InSAR 观测场景示意，非实测结果/);
  assert.doesNotMatch(html, /class="hero-visual|class="hero-observation-flow/);
  assert.match(html, /进入分析工作台/);
  assert.match(html, /规划外业行程/);
  assert.match(html, /不自动将形变结果转为出行任务/);
  assert.match(html, /不提供实时导航/);
  assert.doesNotMatch(html, /90 秒/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});
test("server-renders account verification before mounting a personal map workspace", async () => {
  for (const pathname of ["/map", "/map?intent=upload", "/map?demo=haikou&intent=upload"]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.doesNotMatch(html, developmentPreviewMeta);
    assert.match(html, /class="account-access-gate" aria-label="账户访问验证"/);
    assert.match(html, /正在验证登录状态/);
    assert.match(html, /href="\/login\?[^"]*"[^>]*>登录 \/ 注册/);
    assert.match(html, /CSV、分片与计算仍留在您自己的电脑，不会上传云端/);
    assert.doesNotMatch(html, /type="file"|aria-label="工作台主导航"|class="workspace-view-toolbar"/);
  }
});

test("named public demos retain the hydration entry and current local-analysis map controls", async () => {
  // Demo eligibility uses window.location on the client. SSR stays closed until hydration.
  for (const demo of ["haikou", "landslide", "road"]) {
    const response = await render(`/map?demo=${demo}`);
    assert.equal(response.status, 200, demo);
    const html = await response.text();
    assert.match(html, /class="map-route-shell"/);
    assert.match(html, /class="account-access-gate" aria-label="账户访问验证"/);
    assert.doesNotMatch(html, /type="file"|aria-label="工作台主导航"/);
    assert.match(html, /<script[^>]*src="\/_next\/static\/chunks\/[^"]+\.js"[^>]*>/);
  }
  const chunkRoot = new URL("../dist/client/_next/static/chunks/", import.meta.url);
  const mapChunk = (await readdir(chunkRoot)).find(name => name.startsWith("MapWorkspace-") && name.endsWith(".js"));
  assert.ok(mapChunk, "MapWorkspace client chunk must exist");
  const clientCode = await readFile(new URL(mapChunk, chunkRoot), "utf8");
  assert.match(clientCode, /工作台主导航/);
  assert.match(clientCode, /workspace-view-toolbar/);
  assert.match(clientCode, /地图显示属性/);
  assert.match(clientCode, /["']aria-haspopup["']\s*:\s*[`"']menu[`"']/);
  assert.match(clientCode, /年均速率/);
  assert.match(clientCode, /模式识别 · PASC/);
  assert.match(clientCode, /所有大小的 CSV 均使用本机处理路径，不会转为云端任务/);
  assert.match(clientCode, /普通 WebGIS/);
  assert.doesNotMatch(clientCode, /map-corner-dock|map-tool-drawer|小数据在线识别/);
});
