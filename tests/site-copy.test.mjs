import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Source-level editorial checks only. These do not render pages or call any service.
const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("static and server metadata describe the same analysis and field-inspection product", async () => {
  const [layout, html] = await Promise.all([source("app/layout.tsx"), source("static-src/index.html")]);
  const serverTitle = layout.match(/title:\s*"([^"]+)"/)?.[1];
  const staticTitle = html.match(/<title>([^<]+)<\/title>/)?.[1];
  assert.ok(serverTitle);
  assert.equal(staticTitle, serverTitle);
  for (const content of [layout, html]) {
    assert.match(content, /形变/);
    assert.match(content, /外业核查/);
    assert.match(content, /驾车.*规划/);
  }
});

test("homepage explains the field mission and preserves manual planning and access boundaries", async () => {
  const home = await source("app/components/HomePage.tsx");
  assert.match(home, /外业/);
  assert.match(home, /滴图/);
  assert.match(home, /人工|手动/);
  assert.match(home, /不自动/);
  assert.match(home, /入口.*核验/);
  assert.match(home, /不提供实时导航/);
  assert.match(home, /href:\s*"\/map\?demo=road"|href="\/map\?demo=road"/);
});

test("product and project pages retain the distinction between analysis, planning and access", async () => {
  const content = await source("app/components/ContentPages.tsx");
  const platform = content.slice(content.indexOf("function PlatformPage"), content.indexOf("function SolutionsPage"));
  const solutions = content.slice(content.indexOf("function SolutionsPage"), content.indexOf("function AboutPage"));
  const about = content.slice(content.indexOf("function AboutPage"));
  for (const section of [platform, solutions, about]) {
    assert.match(section, /外业/);
    assert.match(section, /人工|手动/);
    assert.match(section, /入口|停车/);
  }
  assert.match(about, /实地.*待验证|实地.*验证|现场验证/);
  assert.match(content, /不提供实时.*导航/);
});

test("case pages expose manual Didi planning without claiming verified entrances", async () => {
  const cases = await source("app/components/CasePages.tsx");
  assert.match(cases, /<FieldInspectionWorkflow caseKey=\{active\.key\} \/>/);
  assert.match(cases, /\/map\?demo=\$\{caseKey\}&panel=route/);
  assert.match(cases, /手动.*滴图 Web 服务/);
  assert.match(cases, /路线生成不等于入口已核验/);
  assert.match(cases, /非实时导航或通行保证/);
  assert.match(cases, /Didi.*independent.*OSM/);
});

test("shared brand, account and workspace help cover field inspection consistently", async () => {
  const [shell, auth, workspace] = await Promise.all([
    source("app/components/SiteShell.tsx"), source("app/components/AuthPage.tsx"), source("app/components/MapWorkspace.tsx"),
  ]);
  assert.match(shell, /外业/);
  assert.match(shell, /非实时导航/);
  assert.match(auth, /外业核查/);
  assert.match(auth, /本机文件可在原分析标签页继续处理/);
  assert.match(auth, /驾车规划需调用已配置的滴图服务/);
  assert.match(workspace, /分析与外业核查指南/);
  assert.match(workspace, /路线由滴图 Web 服务生成，与 OSM 等底图独立/);
  assert.match(workspace, /入口已核验/);
});

test("entry points avoid unvalidated timed completion claims", async () => {
  for (const path of ["HomePage", "SiteShell", "ContentPages", "AuthPage", "CasePages", "MapWorkspace"]) {
    const content = await source(`app/components/${path}.tsx`);
    assert.doesNotMatch(content, /90\s*(?:秒|second|s\b)/i, `${path} should not promise a measured completion time`);
  }
});

test("case count and epoch evidence remains unchanged by editorial updates", async () => {
  const data = await source("app/data/site.ts");
  for (const fact of ["9,069", "210 期", "11,354", "58 期", "27,123", "11,383", "175 期", "25 m"]) {
    assert.ok(data.includes(fact), `Expected case evidence: ${fact}`);
  }
  assert.equal((data.match(/为.*形变复核与外业目标筛选提供点位依据/g) ?? []).length, 3);
});
