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
  assert.match(html, /城市地表形变智能分析平台/);
  assert.match(html, /体验示例数据/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});
test("server-renders the Phase E map recognition flight-check", async () => {
  const response = await render("/map");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, />PASC</);
  const chunkRoot = new URL("../dist/client/_next/static/chunks/", import.meta.url);
  const mapChunk = (await readdir(chunkRoot)).find(name => name.startsWith("MapWorkspace-") && name.endsWith(".js"));
  assert.ok(mapChunk, "MapWorkspace client chunk must exist");
  const clientCode = await readFile(new URL(mapChunk, chunkRoot), "utf8");
  assert.match(clientCode, /小数据在线识别/);
  assert.match(clientCode, /上传与映射/);
  assert.match(clientCode, /能力分级/);
  assert.match(clientCode, /API 失败不清空数据/);
  assert.match(clientCode, /普通 WebGIS/);
});
