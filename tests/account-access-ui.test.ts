import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthPage } from "../app/components/AuthPage";
import { SiteHeader, SiteFooter } from "../app/components/SiteShell";
import { WorkspaceHeader } from "../app/components/WorkspaceHeader";
import { LanguageProvider } from "../app/lib/language-context";

const render = (element: ReactElement) => renderToStaticMarkup(createElement(LanguageProvider, null, element));

test("the public header preserves login and registration while local CSV processing remains enabled", () => {
  const html = render(createElement(SiteHeader));
  assert.match(html, /href="\/login"[^>]*>登录 \/ 注册/);
  assert.match(html, /href="\/map"[^>]*>进入工作台/);
  assert.doesNotMatch(html, /本机导入 · 无需登录|我的数据|正在退出/);
  assert.match(render(createElement(SiteFooter)), /本机数据导入 · 需登录/);
});

test("the map keeps its login continuation and return-to-draft action before a session is confirmed", () => {
  const html = render(createElement(WorkspaceHeader, { active: null, onChange() {}, onHelp() {}, onReturnToImport() {} }));
  assert.match(html, /<a href="\/login\?returnTo=%2Fmap&amp;resume=1" target="_blank"[^>]*>登录 \/ 注册/);
  assert.match(html, /<button type="button" class="workspace-home-link" aria-label="返回导入"/);
  assert.doesNotMatch(html, /href="\/datasets"|我的数据|无需登录/);
});

test("the account page explains registered identity, protected import and device-local results without cloud-save promises", () => {
  const html = render(createElement(AuthPage));
  assert.match(html, /登录后可导入自己的 CSV 并使用本机分析/);
  assert.match(html, /注册会保存邮箱和展示用户名/);
  assert.match(html, /CSV 与分析结果按当前浏览器、网站域名保留在本机/);
  assert.match(html, /不会自动上传或跨设备同步/);
  assert.match(html, /超过 1 GiB 先本机分片，再逐片分析/);
  assert.match(html, /href="\/map\?demo=haikou&amp;tour=portfolio"[^>]*>浏览公开案例/);
  assert.match(html, /没有账号？立即注册/);
  assert.doesNotMatch(html, /最高 1 GiB|可保存私人数据集|跨设备继续分析|私人数据集和分析记录按账户管理/);
});
