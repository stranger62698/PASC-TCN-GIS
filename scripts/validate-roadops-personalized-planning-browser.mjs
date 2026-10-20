import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";

// Real React, task/routing models, service/solver and IndexedDB. Only provider
// convert/matrix/leg payloads are synthetic and explicitly labelled. Nothing
// contacts a provider, an account, the production site or a deployment service.
const require = createRequire(import.meta.url);
const bundledModules = process.env.CODEX_NODE_MODULES || "C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright"); }
catch { playwright = require(join(bundledModules, "playwright")); }
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || process.env.PASC_EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
assert.ok(existsSync(executablePath), "Set CHROMIUM_EXECUTABLE_PATH to installed Edge/Chrome.");
const fixtureDir = resolve("build/ui-preview/roadops-personalized-planning-fixture");
const distDir = join(fixtureDir, "dist");
const artifactDir = resolve("artifacts/roadops-personalized-planning-browser");
const resultPath = resolve("artifacts/roadops-personalized-planning-browser.json");
await mkdir(fixtureDir, { recursive: true });
await mkdir(artifactDir, { recursive: true });
await writeFile(join(fixtureDir, ".gitignore"), "*\n", "utf8");
await writeFile(join(fixtureDir, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Personalized planning acceptance · local simulation</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>`, "utf8");
await writeFile(join(fixtureDir, "main.tsx"), String.raw`
import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../app/globals.css";
import { RoadFieldTaskPanel, type FieldTaskResult } from "../../../app/components/RoadFieldTaskPanel";
import { createNavigationDraft } from "../../../app/lib/roadops-navigation";
import { createFieldTaskPlan, type FieldTaskPlan } from "../../../app/lib/roadops-task-plan";
import { addFieldTaskToVisit } from "../../../app/lib/roadops-task-editor";
import { createFieldTaskStore } from "../../../app/lib/roadops-task-store";
import { createFieldExecutionStore } from "../../../app/lib/roadops-task-execution";
import { loadFieldObservations, saveFieldObservations } from "../../../app/lib/field-observation-store";
import { fieldTaskRouteMap } from "../../../app/lib/roadops-task-map";
import { syncFieldTaskPlanMetadata } from "../../../app/lib/roadops-task-session";
const style = document.createElement("style");
style.textContent="body{background:#f4f6f8}.map-route-shell .navigation-workspace{height:auto;min-height:100vh;display:block}.fixture-drawer{position:relative!important;inset:auto!important;width:min(800px,100%)!important;max-height:none!important;height:auto!important;overflow:visible!important;transform:none!important;margin:0 auto;background:white}.fixture-label{margin:0;padding:10px 20px;color:#64748b;font:12px/1.5 system-ui;border-bottom:1px solid #e3e5e8}";
document.head.append(style);
const now = new Date().toISOString(), draft = createNavigationDraft();
let seed = createFieldTaskPlan({...draft,
  origin:{...draft.origin,coordinate:[3,45],name:"出发地"},
  destination:{...draft.destination,coordinate:[3.04,45],name:"结束停靠"},
  waypoints:[
    {id:"personalized-a",name:"必查裂缝测量",coordinate:[3.01,45],role:"candidate",dwellMinutes:10,accessReview:"unknown",accessNote:"模拟任务，不代表现场风险"},
    {id:"personalized-b",name:"排水设施核查",coordinate:[3.02,45],role:"candidate",dwellMinutes:10,accessReview:"unknown",accessNote:"模拟任务"},
    {id:"personalized-c",name:"远端区域核查",coordinate:[3.03,45],role:"candidate",dwellMinutes:20,accessReview:"unknown",accessNote:"模拟任务"}
  ],strategy:"2",optimize:true,startTime:"08:30",workMinutes:240,bufferMinutes:5
},{planId:"personalized-browser-plan",name:"个性化外业核查 · 本机模拟",now});
seed = addFieldTaskToVisit(seed,{taskId:"personalized-photo",name:"同站补充照片核查",targetCoordinate:[3.01,45],dwellMinutes:45,required:true,legacyAccessReview:"unknown",accessNote:"模拟证据任务"},seed.visits[1].visitId);
const taskStore=createFieldTaskStore(),saved=await taskStore.get(seed.planId)??await taskStore.save(seed,null);
if (!(await loadFieldObservations()).length) await saveFieldObservations([{id:"personalized-observation",name:"本机模拟证据",longitude:3.01,latitude:45,capturedAt:null,note:"仅浏览器测试，不代表真实照片或完成证明",coordinateSource:"manual",accuracyMeters:null,links:[],associationRadiusMeters:50,createdAt:now,updatedAt:now,photos:[{id:"personalized-evidence-photo",name:"本机模拟照片.png",photoUrl:"",blob:new Blob([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII="),character=>character.charCodeAt(0))],{type:"image/png"}),capturedAt:null,note:"测试图片",exifLongitude:null,exifLatitude:null,coordinateSource:null,coordinateConfidence:null,coordinateConflict:false}]}]);
const executionStore=createFieldExecutionStore();
const evidenceOptions=(await loadFieldObservations()).flatMap(observation=>observation.photos.map(photo=>({id:photo.id,label:observation.name+" · "+photo.name})));
const state:{plan:FieldTaskPlan;result:FieldTaskResult|null;resultChanges:number;focusedLegs:number;focusedPoints:number}={plan:saved,result:null,resultChanges:0,focusedLegs:0,focusedPoints:0};
function App(){
 const[plan,setPlan]=useState(saved),[result,setResult]=useState<FieldTaskResult|null>(null),[stored,setStored]=useState(true),[pickId,setPickId]=useState<string|null>(null),[activeLegId,setActiveLegId]=useState<string|null>(null);
 const change=useCallback((next:FieldTaskPlan)=>{state.plan=next;setPlan(next);setResult(null);state.result=null;},[]);
 const restore=useCallback((next:FieldTaskPlan,isSaved=false)=>{state.plan=next;setPlan(next);setStored(isSaved);setResult(null);state.result=null;},[]);
 const save=useCallback((saved:FieldTaskPlan)=>{const next=syncFieldTaskPlanMetadata(state.plan,saved,state.result?.receipt??null);state.plan=next.plan;state.result=next.receipt&&state.result?{...state.result,receipt:next.receipt}:null;setPlan(state.plan);setResult(state.result);setStored(true);},[]);
 const accept=useCallback((next:FieldTaskResult|null)=>{state.result=next;state.resultChanges++;setResult(next);},[]);
 const adopt=useCallback((next:FieldTaskPlan,response:FieldTaskResult|null)=>{state.plan=next;state.result=response;state.resultChanges++;setPlan(next);setResult(response);},[]);
 const focusPoint=useCallback(()=>{state.focusedPoints++;},[]),focusLeg=useCallback((id:string|null)=>{state.focusedLegs++;setActiveLegId(id);},[]),noBusy=useCallback(()=>{},[]);
 return <div className="map-route-shell"><main className="navigation-workspace"><aside className="workspace-task-drawer fixture-drawer"><p className="fixture-label">本机验收 · 模拟道路成本与路线 · 不代表实际道路、导航或安全条件</p><RoadFieldTaskPanel plan={plan} stored={stored} onChange={change} onSaved={save} onRestore={restore} pickId={pickId} onPick={setPickId} result={result} onResult={accept} onBusy={noBusy} activeLegId={activeLegId} onFocusLeg={focusLeg} onFocusPoint={focusPoint} onAdopt={adopt} evidenceOptions={evidenceOptions}/></aside></main></div>;
}
(window as any).__personalizedAcceptance={ready:true,inspect:()=>state,inspectSaved:()=>taskStore.get(seed.planId),inspectExecution:()=>executionStore.list(seed.planId),inspectMap:()=>state.result?fieldTaskRouteMap(state.plan,state.result.receipt):null};
createRoot(document.getElementById("root")!).render(<App/>);
`, "utf8");
await writeFile(join(fixtureDir, "service.ts"), `export { createRoadOpsDrivingService } from "../../../app/lib/roadops-driving-server";`, "utf8");
await build({ configFile:false, root:fixtureDir, publicDir:false, plugins:[react()], logLevel:"warn", build:{outDir:distDir,emptyOutDir:false,target:"esnext"} });
await build({ configFile:false, root:fixtureDir, publicDir:false, logLevel:"warn", build:{outDir:join(fixtureDir,"service"),emptyOutDir:false,target:"node22",ssr:join(fixtureDir,"service.ts"),rollupOptions:{output:{entryFileNames:"service.mjs"}}} });
const {createRoadOpsDrivingService}=await import(pathToFileURL(join(fixtureDir,"service/service.mjs")).href+"?t="+Date.now());
const sourceFiles=["app/components/RoadFieldTaskPanel.tsx","app/components/RoadPersonalizedCandidates.tsx","app/components/RoadFieldExecutionPanel.tsx","app/components/RoadTaskDraftPanel.tsx","app/components/RoadAccessCheckPanel.tsx","app/lib/roadops-task-plan.ts","app/lib/roadops-task-routing.ts","app/lib/roadops-task-map.ts","app/lib/roadops-task-session.ts","app/lib/roadops-task-candidates.ts","app/lib/roadops-task-execution.ts","app/lib/roadops-route.ts","app/lib/roadops-driving-server.ts","app/workspace-ui.css","app/globals.css"];
const report={schemaVersion:"roadops-personalized-planning-browser-v1",startedAt:new Date().toISOString(),passed:false,scope:{ui:"Real RoadFieldTaskPanel, task/access/execution stores and production solver/service",provider:"Labelled synthetic costs and line geometries via local fetchImpl; no external network",map:"Panel onResult contract observed; this fixture does not mount MapWorkspace",supplierCalls:false,deployment:false,realDrivingOrSafeAccessValidated:false},sourceHashes:Object.fromEntries(sourceFiles.map(path=>[path,createHash("sha256").update(readFileSync(path)).digest("hex")])),checks:[],screenshots:[],apiRequests:[],providerFixtureCalls:[],externalRequests:[],pageErrors:[],error:null};
const check=(name,actual,expected)=>{report.checks.push({name,actual,expected,passed:JSON.stringify(actual)===JSON.stringify(expected)});assert.deepEqual(actual,expected,name);};
const pointName=pair=>["s","a","b","c","t"][Math.round((Number(pair.split(",")[0])-3)*100)];
const costs=(from,to)=>{
 if(["s>a","a>b","b>c","c>t"].includes(from+">"+to))return {dist:2000,duration:300};
 if(["s>c","c>b","b>a","a>t"].includes(from+">"+to))return {dist:300,duration:600};
 return {dist:1500,duration:600};
};
const providerFetch=async(url,init)=>{
 const body=JSON.parse(String(init?.body??"{}"));
 report.providerFixtureCalls.push({kind:String(url).includes("/convert")?"convert":"route",packs:body.packs?.length??null});
 if(String(url).includes("/convert"))return new Response(JSON.stringify({status:10000,msg:"Synthetic acceptance conversion",results:String(body.locations).split(";").map(pair=>{const[lng,lat]=pair.split(",").map(Number);return{lng,lat};})}),{status:200});
 return new Response(JSON.stringify({status:10000,msg:"Synthetic acceptance matrix/legs",results:body.packs.map(pack=>({errcode:0,errmsg:"Synthetic acceptance",routes:[{...costs(pointName(pack.origin),pointName(pack.destination)),geo_list:pack.need_polyline?[pack.origin,pack.destination].map(pair=>{const[longitude,latitude]=pair.split(",").map(Number);return{longitude,latitude};}):[],tag:"本机模拟验收",cost:{tolls:0}}]}))}),{status:200});
};
const service=createRoadOpsDrivingService({env:{DIDI_MAP_WEB_SERVICE_KEY: "TEST_PERSONALIZED_SYNTHETIC_DUMMY_KEY",DIDI_ROUTE_DAILY_BUDGET:"100",DIDI_ROUTE_PER_USER_DAILY_LIMIT:"100"},fetchImpl:providerFetch,minimumUpstreamGapMs:0});
const server=http.createServer(async(request,response)=>{
 try{const pathname=decodeURIComponent(new URL(request.url||"/","http://127.0.0.1").pathname);const path=resolve(distDir,"."+(pathname==="/"?"/index.html":pathname));if(!path.startsWith(distDir+sep)){response.writeHead(403);response.end();return;}const data=await readFile(path);response.writeHead(200,{"Content-Type":{".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"}[extname(path)]||"application/octet-stream","Cache-Control":"no-store"});response.end(data);}catch{response.writeHead(404);response.end();}
});
await new Promise((done,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",done);});
const origin="http://127.0.0.1:"+server.address().port;
const overflow=page=>page.evaluate(()=>({document:document.documentElement.scrollWidth>window.innerWidth+1,panel:document.querySelector(".road-field-task-editor").scrollWidth>document.querySelector(".road-field-task-editor").clientWidth+1}));
let browser;
try{
 browser=await playwright.chromium.launch({executablePath,headless:true,args:["--no-first-run"]});report.browserVersion=browser.version();
 const open=async(width)=>{
  const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1,timezoneId:"Asia/Shanghai"});
  await context.route("**/*",async route=>{const request=route.request(),url=new URL(request.url());if(url.origin===origin&&url.pathname==="/api/roadops/driving"){
   const payload=request.postDataJSON();report.apiRequests.push({goal:payload.planningGoal,strategy:payload.strategy,orderMode:payload.orderMode,taskCount:payload.fieldTasks?.length??null});
   try{const plan=await service.plan(payload,"local-personalized-browser");return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({plan})});}catch(error){return route.fulfill({status:error.status??500,contentType:"application/json",body:JSON.stringify({error:{code:error.code,message:error.message}})});}
  }if(url.origin===origin&&url.pathname.startsWith("/api/")){report.externalRequests.push({path:url.pathname,unexpectedApi:true});return route.abort("blockedbyclient");}if(url.origin===origin||["data:","blob:"].includes(url.protocol))return route.continue();report.externalRequests.push(url.href);return route.abort("blockedbyclient");});
  const page=await context.newPage();page.on("pageerror",error=>report.pageErrors.push(String(error)));await page.goto(origin,{waitUntil:"networkidle"});await page.waitForFunction(()=>window.__personalizedAcceptance?.ready);await page.getByLabel("本次核查需求",{exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector(".road-access-panel > summary")?.textContent?.includes("正在读取"));return{context,page};
 };
 const screenshot=async(page,name)=>{const path=join(artifactDir,name+".png");await page.screenshot({path,fullPage:true});report.screenshots.push(path);};
 const settings=async page=>{const details=page.locator(".road-navigation-edit");if(!await details.evaluate(element=>element.open))await details.locator(":scope > summary").click();};
 const generate=async(page,goal,label)=>{
  await page.getByLabel("本次核查需求",{exact:true}).selectOption(goal);
  await page.locator(".road-navigation-submit").click();
  try{await page.getByRole("button",{name:"采用"+label+"方案",exact:true}).waitFor({timeout:10000});await page.waitForFunction(()=>window.__personalizedAcceptance.inspect().result!==null,null,{timeout:10000});}
  catch(error){throw new Error(label+" did not produce a bound candidate: "+await page.locator(".road-navigation-message").allTextContents()+"; "+error);}
  return page.evaluate(()=>window.__personalizedAcceptance.inspect());
 };
 const reportSnapshot=async page=>page.evaluate(()=>{const state=window.__personalizedAcceptance.inspect(),map=window.__personalizedAcceptance.inspectMap();return{goal:state.plan.planningGoal,distance:state.result?.providerPlan.totalDistanceMeters,seconds:state.result?.providerPlan.drivingDurationSeconds,total:state.result?.receipt.totalMinutes,selected:state.result?.receipt.selectedTaskIds,deferred:state.result?.receipt.deferredTasks,mapIds:map?.stops.map(stop=>stop.visitId),receiptIds:state.result?.receipt.visits.map(visit=>visit.visitId),mapTasks:map?.stops.flatMap(stop=>stop.taskIds),mapNames:map?.stops.map(stop=>stop.name)};});
 // Every interaction uses the actual public component controls, not direct state mutation.
 for(const width of[1000,390]){
  const beforeOpening=report.apiRequests.length;
  const{context,page}=await open(width);
  check(width+" no automatic route request",report.apiRequests.length,beforeOpening);
  check(width+" four planning goals visible",await page.getByLabel("本次核查需求",{exact:true}).locator("option").allTextContents(),["更快完成","少跑里程","限时多查","重点核查"]);
  check(width+" original primary button dimensions",await page.locator(".road-navigation-submit").evaluate(element=>{const style=getComputedStyle(element);return{minHeight:style.minHeight,fontSize:style.fontSize};}),{minHeight:"42px",fontSize:"13px"});
  check(width+" no horizontal overflow",await overflow(page),{document:false,panel:false});
  await screenshot(page,"unplanned-"+width+"px");
  await generate(page,"time","更快完成");
  const fast=await reportSnapshot(page);
  check(width+" time uses actual service objective",fast.goal,"time");
  check(width+" time route metrics",{distance:fast.distance,seconds:fast.seconds,total:fast.total},{distance:8000,seconds:1200,total:110});
  check(width+" time map and receipt visits match",fast.mapIds,fast.receiptIds);
  check(width+" all six original tasks retained",fast.selected.length,6);
  await generate(page,"distance","少跑里程");
  const shorter=await reportSnapshot(page);
  check(width+" distance route differs",{distance:shorter.distance,seconds:shorter.seconds,total:shorter.total},{distance:1200,seconds:2400,total:130});
  check(width+" two actual candidates retained",await page.getByRole("region",{name:"个性化核查方案对比",exact:true}).locator("tbody tr").count(),2);
  check(width+" distance order differs from time",JSON.stringify(shorter.receiptIds)!==JSON.stringify(fast.receiptIds),true);
  const beforeAdopt=report.apiRequests.length;
  await page.getByRole("button",{name:"采用更快完成方案",exact:true}).click();
  await page.waitForFunction(()=>window.__personalizedAcceptance.inspect().plan.planningGoal==="time");
  const adopted=await reportSnapshot(page);
  check(width+" adopting earlier candidate synchronizes settings/report/map",{goal:adopted.goal,distance:adopted.distance,total:adopted.total,map:adopted.mapIds},{goal:"time",distance:8000,total:110,map:fast.mapIds});
  check(width+" adopting does not request another road result",report.apiRequests.length,beforeAdopt);
  check(width+" comparison table remains inside panel",await overflow(page),{document:false,panel:false});
  await screenshot(page,"two-candidates-"+width+"px");
  await settings(page);
  await page.getByLabel("外业可用工时",{exact:true}).fill("110");
  check(width+" changed work budget clears candidates",await page.getByRole("region",{name:"个性化核查方案对比",exact:true}).count(),0);
  check(width+" changed work budget clears active route",(await page.evaluate(()=>window.__personalizedAcceptance.inspect())).result,null);
  await generate(page,"distance","少跑里程");
  const feasibleShort=await reportSnapshot(page);
  check(width+" distance goal chooses longer feasible order",{distance:feasibleShort.distance,seconds:feasibleShort.seconds,total:feasibleShort.total},{distance:8000,seconds:1200,total:110});
  await settings(page);
  await page.getByLabel("外业可用工时",{exact:true}).fill("75");
  for(const name of["同站补充照片核查","排水设施核查","远端区域核查"]){
   const input=page.getByLabel(name+"必查设置",{exact:true});
   const details=input.locator("xpath=ancestor::details[1]");if(!await details.evaluate(element=>element.open))await details.locator(":scope > summary").click();
   await input.selectOption("optional");
   await page.getByLabel(name+"优先级",{exact:true}).selectOption(name==="同站补充照片核查"?"high":"low");
  }
  await generate(page,"coverage","限时多查");
  const coverage=await reportSnapshot(page);
  check(width+" coverage retains required task",coverage.selected.includes("personalized-a"),true);
  check(width+" coverage chooses both low priority regions",["personalized-b","personalized-c"].every(id=>coverage.selected.includes(id)),true);
  check(width+" coverage defers only optional same-stop photo",coverage.deferred.map(task=>task.taskId),["personalized-photo"]);
  check(width+" coverage preserves six-task pool",(await page.evaluate(()=>window.__personalizedAcceptance.inspect())).plan.tasks.length,6);
  check(width+" coverage map excludes deferred same-stop task",coverage.mapTasks.includes("personalized-photo"),false);
  check(width+" coverage map names exclude deferred same-stop task",coverage.mapNames.some(name=>name.includes("同站补充照片")),false);
  check(width+" coverage explicit deferred explanation visible",await page.locator(".road-task-report-deferred").getByText(/同站补充照片核查/).isVisible(),true);
  check(width+" coverage complete work budget feasible",coverage.total<=75,true);
  await generate(page,"priority","重点核查");
  const priority=await reportSnapshot(page);
  check(width+" priority preserves required and high priority same-stop task",["personalized-a","personalized-photo"].every(id=>priority.selected.includes(id)),true);
  check(width+" priority lists both deferred lower priority tasks",priority.deferred.map(task=>task.taskId).sort(),["personalized-b","personalized-c"]);
  check(width+" priority includes complete work budget",priority.total,75);
  check(width+" coverage and priority retained for selection",await page.getByRole("region",{name:"个性化核查方案对比",exact:true}).locator("tbody tr").count(),2);
  check(width+" different task selections are not called identical",await page.getByRole("region",{name:"个性化核查方案对比",exact:true}).getByText("本次条件下方案一致。",{exact:true}).count(),0);
  check(width+" selected subset labels real terminal",priority.mapNames.at(-1).startsWith("终点"),true);
  await screenshot(page,"personalized-tradeoff-"+width+"px");
  const execution=page.getByLabel("现场执行记录",{exact:true});await execution.locator(":scope > summary").click();
  await page.getByLabel("执行记录任务",{exact:true}).selectOption("personalized-photo");
  await page.getByLabel("实际耗时",{exact:true}).fill("15");
  await execution.getByText(/关联已有照片/).click();
  await execution.getByLabel("本机模拟证据 · 本机模拟照片.png",{exact:true}).check();
  await page.getByRole("button",{name:"保存执行记录",exact:true}).click();
  await page.waitForFunction(()=>window.__personalizedAcceptance.inspectExecution().length===1);
  const completed=(await page.evaluate(()=>window.__personalizedAcceptance.inspectExecution()))[0];
  check(width+" real completed record persisted",{task:completed.taskId,status:completed.status,minutes:completed.actualMinutes,photos:completed.evidenceRefs},{task:"personalized-photo",status:"completed",minutes:15,photos:["personalized-evidence-photo"]});
  check(width+" execution record contains no supplier result",["providerPlan","receipt","coordinates","distanceMeters","drivingMinutes","inputSignature"].some(key=>key in completed),false);
  await page.getByLabel("执行记录任务",{exact:true}).selectOption("personalized-a");
  await page.getByLabel("执行记录状态",{exact:true}).selectOption("incomplete");
  await page.getByLabel("执行记录原因",{exact:true}).fill("模拟现场无法完成，保留下一次核查");
  await page.getByRole("button",{name:"保存执行记录",exact:true}).click();
  await page.waitForFunction(()=>window.__personalizedAcceptance.inspectExecution().length===2);
  check(width+" incomplete record persists reason",(await page.evaluate(()=>window.__personalizedAcceptance.inspectExecution())).some(record=>record.taskId==="personalized-a"&&record.status==="incomplete"&&record.reason==="模拟现场无法完成，保留下一次核查"),true);
  await screenshot(page,"execution-records-"+width+"px");
  await page.reload({waitUntil:"networkidle"});await page.waitForFunction(()=>window.__personalizedAcceptance?.ready);
  check(width+" refresh restores only user execution records",(await page.evaluate(()=>window.__personalizedAcceptance.inspectExecution())).length,2);
  check(width+" refresh has no persisted supplier route",(await page.evaluate(()=>window.__personalizedAcceptance.inspect())).result,null);
  check(width+" refresh has no persisted comparison candidates",await page.getByRole("region",{name:"个性化核查方案对比",exact:true}).count(),0);
  await page.getByLabel("现场执行记录",{exact:true}).locator(":scope > summary").click();
  check(width+" refresh shows both own records",await page.locator(".road-execution-history > li").count(),2);
  check(width+" final no horizontal overflow",await overflow(page),{document:false,panel:false});
  await screenshot(page,"refreshed-own-records-"+width+"px");
  await context.close();
 }
 check("no external requests",report.externalRequests,[]);check("no uncaught page errors",report.pageErrors,[]);report.passed=true;
}catch(error){report.error=String(error?.stack??error);process.exitCode=1;}finally{await browser?.close();await new Promise(done=>server.close(done));report.finishedAt=new Date().toISOString();await writeFile(resultPath,JSON.stringify(report,null,2)+"\n","utf8");console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,resultPath,error:report.error},null,2));}
