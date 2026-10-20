import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve, sep } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";

// Bundles the real task UI and styles. Only the initial road response is a
// labelled local fixture; no route/auth/provider request is permitted.
const require = createRequire(import.meta.url);
const bundledModules = process.env.CODEX_NODE_MODULES || "C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright"); }
catch { playwright = require(join(bundledModules, "playwright")); }
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || process.env.PASC_EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
assert.ok(existsSync(executablePath), "Set CHROMIUM_EXECUTABLE_PATH to installed Edge/Chrome.");
const fixtureDir = resolve("build/ui-preview/roadops-driving-clarity-fixture");
const distDir = join(fixtureDir, "dist");
const artifactDir = resolve("artifacts/roadops-driving-clarity-browser");
const resultPath = resolve("artifacts/roadops-driving-clarity-browser.json");
await mkdir(fixtureDir, { recursive: true });
await mkdir(artifactDir, { recursive: true });
await writeFile(join(fixtureDir, ".gitignore"), "*\n", "utf8");
await writeFile(join(fixtureDir, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Driving task clarity acceptance · local simulation</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>`, "utf8");
await writeFile(join(fixtureDir, "main.tsx"), String.raw`
import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../app/globals.css";
import { RoadFieldTaskPanel, type FieldTaskResult } from "../../../app/components/RoadFieldTaskPanel";
import { createNavigationDraft } from "../../../app/lib/roadops-navigation";
import { createFieldTaskPlan, type FieldTaskPlan } from "../../../app/lib/roadops-task-plan";
import { addFieldTaskToVisit } from "../../../app/lib/roadops-task-editor";
import { createFieldTaskStore } from "../../../app/lib/roadops-task-store";
import { createFieldAccessStore, FIELD_ACCESS_DATABASE_NAME } from "../../../app/lib/roadops-access-store";
import { bindFieldTaskRoute, compileFieldTaskRouting } from "../../../app/lib/roadops-task-routing";
import { simulatedFieldResponse } from "../../../tests/fixtures/roadops-field-routing-response";

// Only the outer shell's geometry is fixed here. Every task UI style is real.
const shellStyle = document.createElement("style");
shellStyle.textContent = "body{background:#f4f6f8}.map-route-shell .navigation-workspace{height:auto;min-height:100vh;display:block}.fixture-drawer{position:relative!important;inset:auto!important;width:min(760px,100%)!important;max-height:none!important;height:auto!important;overflow:visible!important;transform:none!important;margin:0 auto;background:white}.fixture-label{margin:0;padding:10px 20px;color:#64748b;font:12px/1.5 system-ui;border-bottom:1px solid #e3e5e8}";
document.head.append(shellStyle);
const now = new Date().toISOString(), draft = createNavigationDraft();
let seed = createFieldTaskPlan({ ...draft,
  origin:{...draft.origin,coordinate:[110.30,20.00],name:"出发地"},
  destination:{...draft.destination,coordinate:[110.34,20.04],name:"结束停靠"},
  waypoints:[
    {id:"clarity-a",name:"异常区 1 · 沿道路边缘检查沉降裂缝与周边排水设施",coordinate:[110.31,20.01],role:"candidate",dwellMinutes:20,accessReview:"unknown",accessNote:""},
    {id:"clarity-b",name:"持续沉降区",coordinate:[110.32,20.02],role:"candidate",dwellMinutes:20,accessReview:"unknown",accessNote:""},
    {id:"clarity-c",name:"突变异常点",coordinate:[110.33,20.03],role:"candidate",dwellMinutes:20,accessReview:"unknown",accessNote:""}
  ],startTime:"08:30",workMinutes:480,bufferMinutes:30
}, {planId:"clarity-browser-plan",name:"沉降异常外业核查",now});
seed = addFieldTaskToVisit(seed, {taskId:"clarity-a-photo",name:"异常区 1 · 拍照与测量",targetCoordinate:[110.3102,20.0102],dwellMinutes:10,required:true,legacyAccessReview:"unknown",accessNote:""},seed.visits[1].visitId);
const taskStore = createFieldTaskStore(), accessStore = createFieldAccessStore();
const saved = await taskStore.get(seed.planId) ?? await taskStore.save(seed,null);
const scenario = new URLSearchParams(window.location.search).get("scenario") ?? "planned";
if (scenario === "corrupt") {
  await accessStore.get(saved.planId);
  await new Promise<void>((resolve,reject) => {
    const request = indexedDB.open(FIELD_ACCESS_DATABASE_NAME,1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db=request.result,tx=db.transaction("logs","readwrite");
      tx.objectStore("logs").put({planId:saved.planId,schemaVersion:"broken-fixture",revision:1,checks:[]});
      tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};
    };
  });
}
function resultFor(plan:FieldTaskPlan):FieldTaskResult {
  const providerPlan=simulatedFieldResponse(plan,undefined,[720,420,540,360]);
  providerPlan.generatedAt=new Date().toISOString();
  return {providerPlan,receipt:bindFieldTaskRoute(plan,{plan:providerPlan},compileFieldTaskRouting(plan))};
}
const counters={focusedPoints:0,focusedLegs:0};
function App(){
  const [plan,setPlan]=useState(saved),[result,setResult]=useState<FieldTaskResult|null>(()=>scenario==="initial"?null:resultFor(saved));
  const [stored,setStored]=useState(true),[pickId,setPickId]=useState<string|null>(null),[activeLegId,setActiveLegId]=useState<string|null>(null);
  const change=useCallback((next:FieldTaskPlan)=>{setPlan(next);setResult(null);},[]);
  const restore=useCallback((next:FieldTaskPlan,isSaved=false)=>{setPlan(next);setStored(isSaved);setResult(null);},[]);
  const save=useCallback((next:FieldTaskPlan)=>{setPlan(next);setStored(true);},[]);
  const focusPoint=useCallback(()=>{counters.focusedPoints+=1;},[]);
  const focusLeg=useCallback((id:string|null)=>{counters.focusedLegs+=1;setActiveLegId(id);},[]);
  const noBusy=useCallback(()=>{},[]);
  return <div className="map-route-shell"><main className="navigation-workspace"><aside className="workspace-task-drawer fixture-drawer"><p className="fixture-label">本机验收 · 模拟任务与道路响应 · 不代表真实道路或通行许可</p><RoadFieldTaskPanel plan={plan} stored={stored} onChange={change} onSaved={save} onRestore={restore} pickId={pickId} onPick={setPickId} result={result} onResult={setResult} onBusy={noBusy} activeLegId={activeLegId} onFocusLeg={focusLeg} onFocusPoint={focusPoint}/></aside></main></div>;
}
(window as any).__clarityAcceptance={ready:true,counters,taskNames:seed.tasks.map(task=>task.name),candidateNames:seed.tasks.filter(task=>task.dwellMinutes>0).map(task=>task.name),inspectHistory:()=>accessStore.get(seed.planId)};
createRoot(document.getElementById("root")!).render(<App/>);
`, "utf8");
await build({ configFile: false, root: fixtureDir, publicDir: false, plugins: [react()], logLevel: "warn", build: { outDir: distDir, emptyOutDir: false, target: "esnext" } });
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
    const path = resolve(distDir, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!path.startsWith(distDir + sep)) { response.writeHead(403); response.end(); return; }
    const data = await readFile(path);
    response.writeHead(200, { "Content-Type": { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" }[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(data);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
const origin = "http://127.0.0.1:" + server.address().port;
const sourceFiles = ["app/components/RoadFieldTaskPanel.tsx", "app/components/RoadTaskDraftPanel.tsx", "app/components/RoadAccessCheckPanel.tsx", "app/workspace-ui.css", "app/globals.css"];
const report = { schemaVersion: "roadops-driving-clarity-browser-v2", startedAt: new Date().toISOString(), passed: false, scope: {ui:"Real React RoadFieldTaskPanel, original button styles, concise copy and IndexedDB stores",initialRoadResponse:"Labelled five-visit synthetic fixture",supplierCalls:false,realDrivingOrSafeAccessValidated:false},sourceHashes:Object.fromEntries(sourceFiles.map(path=>[path,createHash("sha256").update(readFileSync(path)).digest("hex")])),checks:[],screenshots:[],apiRequests:[],externalRequests:[],pageErrors:[],error:null };
const check = (name, actual, expected) => { report.checks.push({name,actual,expected,passed:JSON.stringify(actual)===JSON.stringify(expected)}); assert.deepEqual(actual,expected,name); };
const visibleMessages = page => page.locator(".road-navigation-message").evaluateAll(elements=>elements.filter(element=>element.checkVisibility()).map(element=>element.textContent).join("\n"));
const folded = locator => locator.evaluate(element=>!element.open);
const overflow = page => page.evaluate(()=>({document:document.documentElement.scrollWidth>window.innerWidth+1,panel:document.querySelector(".road-field-task-editor").scrollWidth>document.querySelector(".road-field-task-editor").clientWidth+1}));
let browser;
try {
  browser = await playwright.chromium.launch({executablePath,headless:true,args:["--no-first-run"]});
  report.browserVersion=browser.version();
  const open = async (width,scenario="planned") => {
    const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1});
    await context.route("**/*",route=>{
      const url=route.request().url();
      if(url.startsWith(origin+"/api/")){report.apiRequests.push(url);return route.abort("blockedbyclient");}
      if(url.startsWith(origin+"/")||url.startsWith("data:")||url.startsWith("blob:"))return route.continue();
      report.externalRequests.push(url);return route.abort("blockedbyclient");
    });
    const page=await context.newPage();
    page.on("pageerror",error=>report.pageErrors.push(String(error)));
    await page.goto(origin+"/?scenario="+scenario,{waitUntil:"networkidle"});
    await page.waitForFunction(()=>window.__clarityAcceptance?.ready);
    await page.waitForFunction(()=>!document.querySelector(".road-access-panel > summary")?.textContent?.includes("正在读取"));
    return {context,page};
  };
  const screenshot=async(page,name)=>{const path=join(artifactDir,name+".png");await page.screenshot({path,fullPage:true});report.screenshots.push(path);};
  for(const width of [1000,390]){
    const {context,page}=await open(width);
    const primary=page.locator(".road-navigation-submit");
    check(width+" single primary action",await primary.count(),1);
    const actionStyle=await primary.evaluate(element=>{const style=getComputedStyle(element);return {fontSize:style.fontSize,minHeight:style.minHeight,backgroundColor:style.backgroundColor,color:style.color};});
    check(width+" original primary button dimensions",{fontSize:actionStyle.fontSize,minHeight:actionStyle.minHeight},{fontSize:"13px",minHeight:"42px"});
    check(width+" original filled primary button",actionStyle.backgroundColor!=="rgba(0, 0, 0, 0)"&&actionStyle.color==="rgb(255, 255, 255)",true);
    check(width+" original primary position after editor",await page.evaluate(()=>Boolean(document.querySelector(".road-navigation-edit").compareDocumentPosition(document.querySelector(".road-navigation-submit"))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
    check(width+" no replacement text-only shortcuts",await page.locator(".road-task-secondary-actions").count(),0);
    check(width+" unknown access permits calculation without claiming access",await primary.isEnabled(),true);
    check(width+" all five visits retained",await page.locator(".road-task-report-visit").count(),5);
    const names=await page.evaluate(()=>window.__clarityAcceptance.candidateNames);
    for(const name of names)check(width+" candidate task retained: "+name,await page.locator(".road-task-report-visits").getByText(name,{exact:true}).count(),1);
    check(width+" access initially folded",await folded(page.locator(".road-access-panel")),true);
    check(width+" backup initially folded",await folded(page.locator(".road-task-draft-library")),true);
    check(width+" result editor initially folded",await folded(page.locator(".road-navigation-edit")),true);
    check(width+" no horizontal overflow",await overflow(page),{document:false,panel:false});
    await screenshot(page,width===1000?"completed-wide":"completed-390px");
    await primary.scrollIntoViewIfNeeded();
    await screenshot(page,width===1000?"original-primary-wide":"original-primary-390px");
    const evidence=page.locator(".road-task-report-visit > details");
    check(width+" all five visits retain endpoint evidence",await evidence.count(),5);
    check(width+" endpoint evidence initially folded",await evidence.evaluateAll(elements=>elements.every(element=>!element.open)),true);
    await evidence.nth(1).locator(":scope > summary").click();
    check(width+" original per-visit endpoint evidence accessible",await evidence.nth(1).getByText(/到达 \/ 离开端点间距/).isVisible(),true);
    await page.locator(".road-task-report-visit").nth(1).getByRole("button",{name:"查看车辆位置",exact:true}).click();
    check(width+" focus vehicle still works",await page.evaluate(()=>window.__clarityAcceptance.counters.focusedPoints),1);
    await page.locator(".road-task-report-visit").nth(1).getByRole("button",{name:"查看核查目标",exact:true}).first().click();
    check(width+" focus inspection target still works",await page.evaluate(()=>window.__clarityAcceptance.counters.focusedPoints),2);
    await page.locator(".road-task-report-legs > summary").click();
    await page.locator(".road-task-report-legs > button").first().click();
    check(width+" route segment focus still works",await page.evaluate(()=>window.__clarityAcceptance.counters.focusedLegs),1);
    check(width+" chosen segment active state retained",await page.locator(".road-task-report-legs > button.is-active").count(),1);
    await page.locator(".road-navigation-edit > summary").click();
    check(width+" original disclosure opens real settings",await folded(page.locator(".road-navigation-edit")),false);
    check(width+" original draft controls remain mounted and open",await folded(page.locator(".road-task-drafts")),false);
    await page.locator(".road-task-draft-library > summary").click();
    const downloadPromise=page.waitForEvent("download");
    await page.getByRole("button",{name:"导出当前草稿 JSON",exact:true}).click();
    const downloaded=await downloadPromise,backup=JSON.parse(await readFile(await downloaded.path(),"utf8"));
    check(width+" folded backup exports every task and visit",{tasks:backup.tasks.length,visits:backup.visits.length},{tasks:6,visits:5});
    check(width+" task backup excludes road response",{provider:"provider" in backup,receipt:"receipt" in backup,field:"field" in backup},{provider:false,receipt:false,field:false});
    await context.close();
  }
  const {context:interactiveContext,page}=await open(1000);
  const access=page.locator(".road-access-panel"),primary=page.locator(".road-navigation-submit");
  await access.locator(":scope > summary").click();
  await access.getByLabel("人工核验依据",{exact:true}).fill("未保存的现场核验说明，折叠后必须保留。");
  await access.locator(":scope > summary").click();
  check("dirty access remains folded",await folded(access),true);
  check("dirty access disables planning while folded",await primary.isDisabled(),true);
  check("dirty access remains in mounted form",await access.getByLabel("人工核验依据",{exact:true}).inputValue(),"未保存的现场核验说明，折叠后必须保留。");
  check("dirty access warning visible outside folded form",/未保存|追加记录|重置/.test(await visibleMessages(page)),true);
  await page.evaluate(()=>window.scrollTo(0,0));
  await screenshot(page,"dirty-access-folded");
  await access.locator(":scope > summary").click();
  page.once("dialog",dialog=>dialog.accept());
  await access.getByRole("button",{name:"重置核验表单",exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector(".road-navigation-submit").disabled);
  check("explicit reset releases dirty guard",await primary.isEnabled(),true);
  await access.getByLabel("人工核验状态",{exact:true}).selectOption("blocked");
  await access.getByLabel("核验人",{exact:true}).fill("本机模拟验收");
  await access.getByLabel("人工核验依据",{exact:true}).fill("模拟管理方限制，测试数据不代表真实封路。");
  await access.getByRole("button",{name:"追加核验记录",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector(".road-access-panel > summary")?.textContent?.includes("未解除"));
  await access.locator(":scope > summary").click();
  check("saved blocked access disables planning while folded",await primary.isDisabled(),true);
  check("blocked warning visible outside folded form",/限制|禁入/.test(await visibleMessages(page)),true);
  check("blocked record persisted in actual IndexedDB",(await page.evaluate(()=>window.__clarityAcceptance.inspectHistory())).checks.length,1);
  await page.reload({waitUntil:"networkidle"});
  await page.waitForFunction(()=>document.querySelector(".road-access-panel > summary")?.textContent?.includes("未解除"));
  check("reload keeps access folded",await folded(page.locator(".road-access-panel")),true);
  check("reload preserves blocked planning gate",await page.locator(".road-navigation-submit").isDisabled(),true);
  check("reload shows blocked warning outside fold",/限制|禁入/.test(await visibleMessages(page)),true);
  await screenshot(page,"blocked-access-folded");
  await interactiveContext.close();
  const initial=await open(390,"initial");
  check("unplanned view has no invented report",await initial.page.locator(".road-task-report-visits").count(),0);
  check("unplanned view has no invented zero totals",await initial.page.locator(".road-task-report-metrics").count(),0);
  check("unplanned view opens task settings",await folded(initial.page.locator(".road-navigation-edit")),false);
  check("unplanned view no horizontal overflow",await overflow(initial.page),{document:false,panel:false});
  await screenshot(initial.page,"unplanned-390px");
  await initial.context.close();
  const corrupt=await open(1000,"corrupt");
  check("corrupt history disables planning",await corrupt.page.locator(".road-navigation-submit").isDisabled(),true);
  check("corrupt history stays visible outside folded form",/损坏|格式不受支持/.test(await visibleMessages(corrupt.page)),true);
  check("corrupt history never becomes empty success",await folded(corrupt.page.locator(".road-access-panel")),true);
  await screenshot(corrupt.page,"corrupt-history-folded");
  await corrupt.context.close();
  check("no route or auth API calls",report.apiRequests.length,0);
  check("no external provider calls",report.externalRequests.length,0);
  check("no uncaught page errors",report.pageErrors,[]);
  report.passed=true;
} catch(error){report.error=String(error?.stack??error);process.exitCode=1;}
finally{
  await browser?.close();
  await new Promise(done=>server.close(done));
  report.finishedAt=new Date().toISOString();
  await writeFile(resultPath,JSON.stringify(report,null,2)+"\n","utf8");
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failed:report.checks.filter(check=>!check.passed).map(check=>check.name),resultPath,error:report.error},null,2));
}
