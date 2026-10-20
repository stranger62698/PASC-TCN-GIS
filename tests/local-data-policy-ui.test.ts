import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatasetPage } from "../app/components/DatasetPage";
import { MapWorkspace } from "../app/components/MapWorkspace";
import { PascJobPanel } from "../app/components/PascJobPanel";
import { SiteHeader } from "../app/components/SiteShell";
import { WorkspaceHeader } from "../app/components/WorkspaceHeader";
import { LanguageProvider } from "../app/lib/language-context";
import { USER_ACCOUNT_REQUIRED, USER_DATA_LOCAL_ONLY } from "../app/lib/data-processing-policy";
import { PascLocalWebGis } from "../app/components/PascLocalWebGis";
import { PascLocalPrototype } from "../app/components/PascLocalPrototype";

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(LanguageProvider, null, element));
}

test("local-only data onboarding requires a verified account before mounting file selection", () => {
  assert.equal(USER_DATA_LOCAL_ONLY, true);
  assert.equal(USER_ACCOUNT_REQUIRED, true);
  const html = render(createElement(DatasetPage));
  assert.match(html, /正在验证登录状态/);
  assert.match(html, /href="\/login\?returnTo=%2Fdatasets"/);
  assert.match(html, /CSV、分片与计算仍留在您自己的电脑/);
  assert.doesNotMatch(html, /type="file"|无需登录|后台自动分类|容量使用/);
});

test("both shared headers retain account access independently of the local-data policy", () => {
  const headers = [render(createElement(SiteHeader)), render(createElement(WorkspaceHeader, { active: null, onChange() {}, onHelp() {} }))];
  for (const html of headers) {
    assert.match(html, /href="\/login/);
    assert.match(html, /登录 \/ 注册/);
    assert.doesNotMatch(html, /无需登录/);
  }
});

test("a directly mounted cloud job console stays closed even when datasets are supplied", () => {
  const html = render(createElement(PascJobPanel, { datasets: [{ id: "private-existing", name: "Existing CSV", pointCount: 20_000 }] }));
  assert.match(html, /云端分类已关闭/);
  assert.match(html, /不上传云端或创建后台任务/);
  assert.match(html, /href="\/datasets"[^>]*>选择本机 CSV/);
  assert.doesNotMatch(html, /<button|<select|任务列表|Existing CSV/);
});

test("direct map and standalone local engines cannot mount a supplied file before account verification", () => {
  const file = new File(["longitude,latitude,D20240101\r\n110,20,0"], "visitor.csv", { type: "text/csv" });
  const html = render(createElement<NonNullable<Parameters<typeof MapWorkspace>[0]>>(MapWorkspace, { initialImport: { file }, onReturnToImport() {} }));
  const standalone = render(createElement(PascLocalWebGis, { file, onChooseFile() {}, onApplied() {}, onFilter() {} }));
  const prototype = render(createElement(PascLocalPrototype));
  for (const page of [html, standalone, prototype]) {
    assert.match(page, /账户访问验证/);
    assert.match(page, /href="\/login/);
    assert.doesNotMatch(page, /visitor\.csv|type="file"|开始完整分析|开始快速验证/);
  }
});
