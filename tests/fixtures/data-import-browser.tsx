import React from "react";
import { createRoot } from "react-dom/client";
import { DatasetPage } from "../../app/components/DatasetPage";
import { MapWorkspace } from "../../app/components/MapWorkspace";
import { LanguageProvider } from "../../app/lib/language-context";
import { AUTH_CHANGED_EVENT } from "../../app/lib/auth-client";
import "../../app/globals.css";
import "../../app/pasc.css";
import "../../app/pasc-job-progress.css";

let unavailable = true;
let authenticated = false;
let fixtureAccountId = "synthetic-user";
const requests: Array<{ path: string; method: string; op: string; id: string | null }> = [];
const items: Record<string, unknown>[] = [];
const fail = () => Response.json({ error: "模拟 Vercel 私有数据存储已暂停；请检查用量与恢复条件，或继续本机分析。", code: "PRIVATE_DATASET_STORAGE_SUSPENDED", retryable: false, requestId: "synthetic-request-only" }, { status: 503 });
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  const method = init?.method ?? "GET";
  if (url.origin !== window.location.origin) throw new Error("External requests are disabled in this fixture.");
  if (url.pathname.startsWith("/api/")) requests.push({ path: url.pathname, method, op: url.searchParams.get("op") ?? "list", id: url.searchParams.get("id") });
  if (url.pathname === "/api/auth") return Response.json({ authenticated, user: authenticated ? { id: fixtureAccountId, name: "本地模拟账号", email: "fixture@example.invalid", roles: [] } : null });
  if (url.pathname === "/api/private-datasets") {
    if (method === "GET") return Response.json({ items, account: { userId: "synthetic-user", email: "fixture@example.invalid", roles: [], usedBytes: 0, maxUserBytes: 5 * 1024 ** 3, maxFileSize: 2 * 1024 ** 3, isAdmin: false } });
    if (unavailable) return fail();
    if (url.searchParams.get("op") === "chunk") return Response.json({ ok: true, index: Number(url.searchParams.get("index")) });
    const metadata = JSON.parse(String(init?.body));
    const item = { ...metadata, id: url.searchParams.get("id"), uploadedAt: new Date().toISOString(), version: 1 };
    items.push(item);
    return Response.json({ ok: true, item });
  }
  return fail();
};

const dateFields = Array.from({ length: 24 }, (_, index) => `D${new Date(Date.UTC(2024, 0, 1 + index * 12)).toISOString().slice(0, 10).replaceAll("-", "")}`);
const fixtureFile = new File([
  ["point_id", "longitude", "latitude", "velocity", "coherence", ...dateFields].join(",") + "\n" +
  Array.from({ length: 4 }, (_, row) => [`SYNTH-${row + 1}`, 110.35 + row * .0001, 20.08 + row * .0001, -row - 2, .9, ...dateFields.map((_, index) => -index * (row + 1))].join(",")).join("\n"),
], "synthetic-import.csv", { type: "text/csv", lastModified: 1 });

const mixedDates = dateFields.map((field, index) => {
  const compact = field.slice(1), iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  return { index, field: [field, `D_${compact}`, compact, `D_${iso}`, `date_${iso.replaceAll("-", "/")}`, `t${compact}`][index % 6] };
}).reverse();
const mixedDateFile = new File([
  ["point_id", "longitude", "latitude", "velocity", "coherence", ...mixedDates.map(date => date.field)].join(",") + "\n" +
  Array.from({ length: 4 }, (_, row) => [`SYNTH-${row + 1}`, 110.35 + row * .0001, 20.08 + row * .0001, -row - 2, .9, ...mixedDates.map(date => -date.index * (row + 1))].join(",")).join("\n"),
], "synthetic-mixed-dates.csv", { type: "text/csv", lastModified: 1 });

function FixtureTools() {
  const [state, setState] = React.useState("模拟云端故障；无真实云请求");
  return <aside style={{ position: "fixed", bottom: 4, left: 4, zIndex: 10000, background: "#fff", border: "1px solid #1769d2", padding: 8, fontSize: 12 }} aria-label="本地验收工具">
    <span>{state} </span>
    <button type="button" onClick={() => { authenticated = true; window.dispatchEvent(new Event(AUTH_CHANGED_EVENT)); setState("模拟登录：仅本地合成账号，需服务响应核验"); }}>模拟登录</button>
    <button type="button" onClick={() => { authenticated = false; window.dispatchEvent(new Event(AUTH_CHANGED_EVENT)); setState("模拟会话过期：原文件与结果保留"); }}>模拟会话过期</button>
    <button type="button" onClick={() => { authenticated = true; fixtureAccountId = "synthetic-other-user"; window.dispatchEvent(new Event(AUTH_CHANGED_EVENT)); setState("模拟切换另一账号：不能继续前一账号工作区"); }}>模拟另一账号</button>
    <button type="button" onClick={() => {
      const input = document.querySelector<HTMLInputElement>('.dataset-import-workflow input[type="file"]');
      if (!input) { setState("请先回到选择文件步骤"); return; }
      const transfer = new DataTransfer(); transfer.items.add(fixtureFile); input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      setState("已选入4点24期合成CSV");
    }}>载入合成 CSV</button>
    <button type="button" onClick={() => {
      const input = document.querySelector<HTMLInputElement>('.dataset-import-workflow input[type="file"]');
      if (!input) { setState("请先回到选择文件步骤"); return; }
      const transfer = new DataTransfer(); transfer.items.add(mixedDateFile); input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      setState("已选入4点24期混合日期CSV，原列顺序为倒序");
    }}>载入混合日期 CSV</button>
    <button type="button" onClick={() => {
      const input = document.querySelector<HTMLInputElement>('.map-page input[type="file"][accept*=".csv"]');
      if (!input) { setState("请先进入本机地图"); return; }
      const transfer = new DataTransfer(); transfer.items.add(new File([fixtureFile], fixtureFile.name, { type: "text/csv", lastModified: fixtureFile.lastModified }));
      input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
      setState("已替换同名同大小同修改时间的新File");
    }}>替换同名文件</button>
    <button type="button" onClick={() => { unavailable = false; setState("模拟云端已恢复"); }}>恢复模拟云端</button>
    <button type="button" onClick={() => setState(`认证请求${requests.filter(request => request.path === "/api/auth").length}；数据接口请求${requests.filter(request => request.path !== "/api/auth").length}；CSV上传${requests.filter(request => request.op === "chunk").length}`)}>查看模拟请求</button>
  </aside>;
}

createRoot(document.getElementById("fixture-tools")!).render(<FixtureTools />);
createRoot(document.getElementById("root")!).render(<React.StrictMode><LanguageProvider>{new URLSearchParams(window.location.search).get("view") === "map" ? <MapWorkspace /> : <DatasetPage />}</LanguageProvider></React.StrictMode>);
