import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve, sep } from "node:path";
import { build } from "vite";

// This fixture bundles the production renderer and index. It does not simulate
// a drawing context, parse CSV, run ONNX, or request a basemap/route provider.
const require = createRequire(import.meta.url);
const bundledModules = process.env.CODEX_NODE_MODULES || "C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || process.env.PASC_PLAYWRIGHT_MODULE || "playwright"); }
catch { playwright = require(join(bundledModules, "playwright")); }
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || process.env.PASC_BROWSER_PATH || process.env.PASC_EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
assert.ok(existsSync(executablePath), "Set CHROMIUM_EXECUTABLE_PATH to installed Edge/Chrome.");
const fixtureDir = resolve("build/ui-preview/full-point-layer-fixture");
const distDir = join(fixtureDir, "dist");
const artifactDir = resolve("artifacts/full-point-layer-browser");
const resultPath = resolve("artifacts/full-point-layer-browser.json");
await mkdir(fixtureDir, { recursive: true });
await mkdir(artifactDir, { recursive: true });
await writeFile(join(fixtureDir, ".gitignore"), "*\n", "utf8");
await writeFile(join(fixtureDir, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FullPointLayer actual browser acceptance</title><style>body{margin:0;font:14px system-ui;color:#142c3c;background:#eef3f8}header{padding:18px 32px}h1{font-size:22px;margin:0 0 8px}p{margin:0;color:#526b80}#map{width:1180px;height:700px;margin:0 32px;background-color:#eef3f6;background-image:linear-gradient(#cbd5e166 1px,transparent 1px),linear-gradient(90deg,#cbd5e166 1px,transparent 1px);background-size:40px 40px;box-shadow:0 2px 12px #152b4422}#status{position:absolute;z-index:1000;left:16px;top:16px;padding:10px 14px;border-radius:5px;background:#ffffffec;pointer-events:none}.leaflet-control-attribution{display:none}</style></head><body><header><h1>真实 FullPointLayer · 100,000 点全量渲染验收</h1><p>合成数据 · 本机 Leaflet + WebGL / Canvas · 不含 CSV 推理或真实地图服务</p></header><div id="map"><div id="status">正在准备真实渲染器…</div></div><script type="module" src="/main.ts"></script></body></html>`, "utf8");
const fixtureSource = String.raw`
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { InsarPoint } from "../../../app/data/site";
import { FullPointLayer, queryNearestPoint, queryPointHits, type FullPointLayerState } from "../../../app/lib/full-point-layer";
import { SpatialGridIndex } from "../../../app/lib/spatial-analysis";
import { geometryBounds, pointInPolygon, type AoiGeometry } from "../../../app/lib/aoi-analysis";
import { numericSeriesView } from "../../../app/lib/local-series-store";
import { colorForMode, deformationModeOrder } from "../../../app/lib/analysis-context";
import type { RenderStyle } from "../../../app/lib/insar-v2";

const count = 100000, columns = 500, west = 110.31, south = 20.04, step = .00002;
const dates = Array.from({length:40}, (_, i) => new Date(Date.UTC(2024, 0, 1 + i * 12)).toISOString().slice(0,10));
const loadedColumns = new Set([39]);
let seriesReads = 0, pascReads = 0;
const generationStart = performance.now();
const points: InsarPoint[] = Array.from({length:count}, (_, i) => {
  const point: InsarPoint = {id:"p" + i,name:"Point " + i,lon:west + (i % columns) * step,lat:south + Math.floor(i / columns) * step,
    velocity:-10 + (i % 200) / 10,displacement:-20 + (i % 100) / 5,coherence:.7 + (i % 30) / 100,missingRate:(i % 15) / 100,
    mode:deformationModeOrder[i % deformationModeOrder.length],modeConfidence:.88,spatialApplicability:"full_reference",updated:dates[39],dates,
    localSeriesIndex:i,localSeriesHydrated:false,series:numericSeriesView(40, epoch => {seriesReads += 1;return loadedColumns.has(epoch) ? -epoch / 2 + (i % 100) / 5 : NaN;})};
  Object.defineProperty(point,"pasc",{get(){pascReads += 1;throw new Error("Renderer must not expand lazy PASC metadata");}});
  return point;
});
const generationMs = performance.now() - generationStart;
const indexStart = performance.now();
const index = new SpatialGridIndex<InsarPoint>().load(points);
const indexMs = performance.now() - indexStart;
const map = L.map("map",{zoomControl:false,attributionControl:false,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false,boxZoom:false,doubleClickZoom:false});
const allBounds = L.latLngBounds([[south,west],[south + 199 * step,west + 499 * step]]);
map.fitBounds(allBounds,{padding:[70,70],animate:false});
const statuses: string[] = [];
const statusElement = document.getElementById("status")!;
const layer = new FullPointLayer(map,status => {statuses.push(status);statusElement.textContent = status + " · 100,000 points · one surface";});
let state: FullPointLayerState = {points,index,livePoints:[],renderStyle:{attribute:"velocity",min:-12.5,max:12.5,interval:2.5,colors:["#e94b4b","#1677ff"],timeIndex:39,rangeStart:0,rangeEnd:39},pointSize:1,coherenceThreshold:.75,
  visible:{points:true,risk:false,quality:false},priorityIds:new Set(),limitedIds:new Set(),boxIds:new Set(),compareIds:new Set(),selectedId:null,highlightKind:"region"};
const settle = async () => {await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));};
const update = async (next: Partial<FullPointLayerState> = {}) => {const start=performance.now();state={...state,...next};layer.update(state);await settle();return performance.now()-start;};
const initialRenderMs = await update();
let overlapSelection: string | null = null,replaceOverlap: (()=>void)|null=null,hideOverlap: (()=>void)|null=null;
let clickedId: string | null = null, clickMs = 0, hitCandidates = 0, selecting = false, boxStart: L.LatLng | null = null;
let boxResult: {ids:string[];bounds:number[];milliseconds:number} | null = null;
let selectionRectangle: L.Rectangle | null = null;
const queryHit = (latlng: L.LatLng) => {
  const pixel=map.latLngToContainerPoint(latlng),a=map.containerPointToLatLng([pixel.x-18,pixel.y-18]),b=map.containerPointToLatLng([pixel.x+18,pixel.y+18]);
  hitCandidates=0;
  return queryNearestPoint(index,{west:Math.min(a.lng,b.lng),east:Math.max(a.lng,b.lng),south:Math.min(a.lat,b.lat),north:Math.max(a.lat,b.lat)},pixel,point=>{hitCandidates+=1;return map.latLngToContainerPoint([point.lat,point.lon]);});
};
map.on("click",(event:L.LeafletMouseEvent)=>{if(selecting)return;const start=performance.now();clickedId=queryHit(event.latlng)?.id??null;clickMs=performance.now()-start;});
map.on("mousedown",(event:L.LeafletMouseEvent)=>{if(selecting)boxStart=event.latlng;});
map.on("mouseup",(event:L.LeafletMouseEvent)=>{
  if(!selecting||!boxStart)return;
  const bounds=L.latLngBounds(boxStart,event.latlng),start=performance.now(),hits=index.queryBounds({west:bounds.getWest(),south:bounds.getSouth(),east:bounds.getEast(),north:bounds.getNorth()});
  boxResult={ids:hits.map(point=>point.id),bounds:[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()],milliseconds:performance.now()-start};
  selectionRectangle?.remove();selectionRectangle=L.rectangle(bounds,{color:"#1677ff",weight:1,fill:false,interactive:false}).addTo(map);boxStart=null;
});
const viewportBounds=(padding=0)=>{const size=map.getSize(),a=map.containerPointToLatLng([-padding,-padding]),b=map.containerPointToLatLng([size.x+padding,size.y+padding]);return {west:Math.min(a.lng,b.lng),east:Math.max(a.lng,b.lng),south:Math.min(a.lat,b.lat),north:Math.max(a.lat,b.lat)};};
const bruteBounds=(bounds:{west:number;south:number;east:number;north:number})=>points.filter(point=>point.lon>=bounds.west&&point.lon<=bounds.east&&point.lat>=bounds.south&&point.lat<=bounds.north);
const canvas=()=>document.querySelector("canvas.leaflet-full-point-layer") as HTMLCanvasElement;
const snapshot=()=>{const c=canvas(),metric=(window as any).__drawingMetrics.get(c)??{drawCounts:[],arcs:0};return {renderer:c.dataset.renderer,total:Number(c.dataset.totalPoints),visible:Number(c.dataset.visiblePoints),expectedVisible:bruteBounds(viewportBounds()).length,expectedCanvasArcs:bruteBounds(viewportBounds(state.pointSize)).length,drawCounts:metric.drawCounts.slice(),canvasArcs:metric.arcs,surfaces:document.querySelectorAll("canvas.leaflet-full-point-layer").length,markers:document.querySelectorAll(".leaflet-marker-icon").length,seriesReads,pascReads,zoom:map.getZoom(),statuses:statuses.slice()};};
const pixel=(i:number)=>{const p=points[i],position=map.latLngToContainerPoint([p.lat,p.lon]),c=canvas(),ratio=c.width/map.getSize().x,x=Math.floor(position.x*ratio),y=Math.floor(position.y*ratio);let rgba:number[];
  if(c.dataset.renderer==="webgl"){const gl=c.getContext("webgl")!,out=new Uint8Array(4);gl.readPixels(x,c.height-y-1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,out);rgba=Array.from(out);if(rgba[3])for(let k=0;k<3;k+=1)rgba[k]=Math.round(rgba[k]*255/rgba[3]);}
  else rgba=Array.from(c.getContext("2d")!.getImageData(x,y,1,1).data);
  return {rgba,position:{x:position.x,y:position.y}};
};
const api={ready:true,count,generationMs,indexMs,initialRenderMs,snapshot,
  coordinate(i:number){const point=points[i],p=map.latLngToContainerPoint([point.lat,point.lon]),rect=map.getContainer().getBoundingClientRect();return {x:rect.left+p.x,y:rect.top+p.y};},
  clickResult(){return {id:clickedId,milliseconds:clickMs,candidates:hitCandidates};},
  beginBox(){selecting=true;boxResult=null;map.dragging.disable();},
  async endBox(){selecting=false;map.dragging.enable();await settle();return boxResult;},
  expectedBox(bounds:number[]){return bruteBounds({west:bounds[0],south:bounds[1],east:bounds[2],north:bounds[3]}).map(point=>point.id).sort();},
  async pan(x:number,y:number){const start=performance.now();map.panBy([x,y],{animate:false});await settle();return {milliseconds:performance.now()-start,...snapshot()};},
  async reset(){selectionRectangle?.remove();selectionRectangle=null;layer.setSwipe(false,50);map.fitBounds(allBounds,{padding:[70,70],animate:false});await update({pointSize:1,boxIds:new Set(),compareIds:new Set(),selectedId:null,visible:{points:true,risk:false,quality:false},renderStyle:{...state.renderStyle,attribute:"velocity"}});return snapshot();},
  async focus(i:number){const p=points[i];map.setView([p.lat,p.lon],20,{animate:false});await update({pointSize:3});return snapshot();},
  async style(attribute:RenderStyle["attribute"],timeIndex=39){const reads=seriesReads,start=performance.now();await update({renderStyle:{...state.renderStyle,attribute,timeIndex,rangeStart:0,rangeEnd:39,min:attribute==="coherence"?0:attribute==="missing"?0:-25,max:attribute==="coherence"?1:attribute==="missing"?100:25,interval:0}});return {milliseconds:performance.now()-start,reads:seriesReads-reads,pixel:pixel(50250),...snapshot()};},
  async loadColumn(epoch:number){loadedColumns.add(epoch);return update({points:[...points]});},
  async stageCache(){for(const p of points){p.renderStageStart=0;p.renderStageEnd=39;p.renderStageVelocity=p.velocity;}return update({points:[...points]});},
  async smallGlyph(i:number){await update({pointSize:1,renderStyle:{...state.renderStyle,attribute:"velocity"}});const p=points[i],position=map.latLngToContainerPoint([p.lat,p.lon]),c=canvas(),x=Math.floor(position.x),y=Math.floor(position.y);let values:Uint8Array|Uint8ClampedArray;
    if(c.dataset.renderer==="webgl"){const gl=c.getContext("webgl")!;values=new Uint8Array(36);gl.readPixels(x-1,c.height-y-2,3,3,gl.RGBA,gl.UNSIGNED_BYTE,values);}else values=c.getContext("2d")!.getImageData(x-1,y-1,3,3).data;
    let colored=0;for(let k=0;k<values.length;k+=4){if(values[k+3]>0&&Math.min(values[k],values[k+1],values[k+2])*255/values[k+3]<230)colored+=1;}await update({pointSize:3});return {colored};},
  pixel,
  expectedModeColor(i:number){return colorForMode(points[i].mode);},
  async highlight(){const ids=new Set(points.filter((_,i)=>i%100===0).map(p=>p.id));await update({boxIds:ids});return {selected:ids.size,...snapshot()};},
  async swipe(){await update({boxIds:new Set()});layer.setSwipe(true,50);await settle();return snapshot();},
  polygon(){const geometry:AoiGeometry={type:"polygon",coordinates:[[west+.002,south+.001],[west+.004,south+.001],[west+.004,south+.003],[west+.002,south+.003]]},[w,s,e,n]=geometryBounds(geometry),start=performance.now();const hits=index.queryBounds({west:w,south:s,east:e,north:n}).filter(p=>pointInPolygon(p.lon,p.lat,geometry.coordinates));const elapsed=performance.now()-start;const expected=points.filter(p=>pointInPolygon(p.lon,p.lat,geometry.coordinates));return {count:hits.length,expected:expected.length,idsMatch:hits.map(p=>p.id).sort().join(",")===expected.map(p=>p.id).sort().join(","),milliseconds:elapsed};},
  async overlapMap(){
    const [{createElement},{createRoot},{flushSync},{default:WebGisMap}]=await Promise.all([import("react"),import("react-dom/client"),import("react-dom"),import("../../../app/components/WebGisMap")]);
    layer.destroy();map.remove();
    const container=document.getElementById("map")!;container.replaceChildren();
    const style=document.createElement("style");style.textContent=".gis-map{width:100%;height:100%;position:relative}.leaflet-host{width:100%;height:100%}.map-badge,.map-coordinates{display:none}";document.head.append(style);
    const overlapPoints:InsarPoint[]=Array.from({length:61},(_,i)=>({...points[50250],id:"coincident-"+i,name:"coincident-"+i,lon:110.33,lat:20.04}));
    const noop=()=>{};
    const props:import("react").ComponentProps<typeof WebGisMap>={
      points:overlapPoints,livePascPoints:[],selected:null,onSelect:p=>{overlapSelection=p.id;},onBoxSelect:noop,onPolygonSelect:noop,onAnomalyRegionSelect:noop,onViewChange:noop,
      visible:{points:true,boundary:false,risk:false,quality:false},base:"custom",tdtKey:"",customBasemap:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1EAAAAASUVORK5CYII=",baseOpacity:0,
      pointSize:4,onEditStyle:noop,swipeEnabled:false,coherenceThreshold:.75,priorityPointIds:[],priorityLimitedPointIds:[],layoutToken:"overlap-acceptance",renderStyle:state.renderStyle,patternVisibility:"all",hiddenModes:[],filteredPointIds:null,onToggleMode:noop,onShowAllModes:noop,
      compareIds:[],boxIds:[],selectionMode:"single",highlightKind:"region",selectionGeometry:null,anomalyRegions:[],activeAnomalyRegionId:null,
      initialView:{center:[20.04,110.33],zoom:20,bounds:[110.32,20.03,110.34,20.05]},focusBounds:null,focusToken:0,gisLayers:[],activeGisFeatureId:null,onGisFeatureSelect:noop,
      roadOpsRoutePlan:null,fieldObservations:[],activeFieldObservationId:null,onFieldObservationSelect:noop,onFieldPhotoOpen:noop,
    };
    let currentOverlapPoints=overlapPoints;
    const overlapRoot=createRoot(container);overlapRoot.render(createElement(WebGisMap,props));
    replaceOverlap=()=>{
      const oldButton=document.querySelector<HTMLButtonElement>(".map-point-candidates button[data-point-id]");
      overlapSelection="replacement-generation";
      currentOverlapPoints=overlapPoints.map(point=>({...point}));
      flushSync(()=>overlapRoot.render(createElement(WebGisMap,{...props,points:currentOverlapPoints})));
      oldButton?.click();
    };
    hideOverlap=()=>{
      const oldButton=document.querySelector<HTMLButtonElement>(".map-point-candidates button[data-point-id]");
      overlapSelection="hidden-selection";
      flushSync(()=>overlapRoot.render(createElement(WebGisMap,{...props,points:currentOverlapPoints,visible:{...props.visible,points:false,risk:false,quality:false}})));
      oldButton?.click();
    };
    return overlapPoints.map(p=>p.id).sort();
  },
  overlapResult(){return overlapSelection;},
  hideOverlapMap(){hideOverlap?.();return overlapSelection;},
  replaceOverlapMap(){replaceOverlap?.();return {selected:overlapSelection,popupCount:document.querySelectorAll(".map-point-candidates").length};},
  coincidentHits(){
    const pixel={x:50,y:50},coincident:Array<InsarPoint>=Array.from({length:61},(_,i)=>({...points[50250],id:"coincident-"+i,lon:.5,lat:.5}));
    const hits=queryPointHits(new SpatialGridIndex<InsarPoint>().load(coincident),{west:.32,east:.68,south:.32,north:.68},pixel,p=>({x:p.lon*100,y:p.lat*100}));
    return {count:hits.length,unique:new Set(hits.map(p=>p.id)).size,all:hits.map(p=>p.id).sort().join(",")===coincident.map(p=>p.id).sort().join(",")};
  },  loseContext(){const gl=canvas().getContext("webgl"),extension=gl?.getExtension("WEBGL_lose_context");if(!extension)return false;extension.loseContext();return true;},
  rendererInfo(){if(canvas().dataset.renderer!=="webgl")return null;const gl=canvas().getContext("webgl")!,debug=gl.getExtension("WEBGL_debug_renderer_info");return {vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),unmaskedRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,preserveDrawingBuffer:gl.getContextAttributes()?.preserveDrawingBuffer};}
};
(window as any).__fullPointAcceptance=api;
`;
await writeFile(join(fixtureDir, "main.ts"), fixtureSource, "utf8");
await build({ configFile: false, root: fixtureDir, publicDir: false, logLevel: "warn", build: { outDir: distDir, emptyOutDir: false, target: "esnext" } });
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
    const path = resolve(distDir, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!path.startsWith(distDir + sep)) { response.writeHead(403); response.end(); return; }
    const data = await readFile(path);
    const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" }[extname(path)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); response.end(data);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
const origin = "http://127.0.0.1:" + server.address().port;
const sourceFiles = ["app/components/WebGisMap.tsx", "app/lib/full-point-layer.ts", "app/lib/spatial-analysis.ts", "app/lib/aoi-analysis.ts", "app/lib/insar-v2.ts", "app/lib/local-series-store.ts"];
const result = { schemaVersion: "full-point-layer-browser-v1", startedAt: new Date().toISOString(), passed: false, count: 100000, origin,
  scope: {data:"100k synthetic grid points with real numericSeriesView lazy proxies",renderer:"Production FullPointLayer, real Leaflet map and SpatialGridIndex; genuine WebGL/Canvas contexts",csvImportValidated:false,onnxInferenceValidated:false,realBasemapOrDrivingValidated:false,performanceScope:"Measured local renderer microbenchmark only; default headless ANGLE SwiftShader may use software rendering"},
  sourceHashes: Object.fromEntries(sourceFiles.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
  checks: [], scenarios: {}, screenshots: [], blockedExternalRequests: [], pageErrors: [], error: null };
const check = (name, actual, expected) => { result.checks.push({name,actual,expected,passed:JSON.stringify(actual)===JSON.stringify(expected)});assert.deepEqual(actual,expected,name); };
const grey = [148,163,184];
const isGrey = pixel => pixel.rgba[3] > 0 && pixel.rgba.slice(0,3).every((value,i)=>Math.abs(value-grey[i])<=3);
const hasColour = pixel => pixel.rgba[3] > 0 && !isGrey(pixel);
let browser;
try {
  browser = await playwright.chromium.launch({ executablePath, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run"] });
  result.browserVersion = browser.version();
  for (const forceCanvas of [false,true]) {
    const name = forceCanvas ? "canvas" : "webgl";
    const context = await browser.newContext({ viewport:{width:1280,height:840},deviceScaleFactor:1 });
    await context.route("**/*",route => {
      const url=route.request().url();
      if(url.startsWith(origin+"/")||url.startsWith("data:")||url.startsWith("blob:"))return route.continue();
      result.blockedExternalRequests.push({scenario:name,url});return route.abort("blockedbyclient");
    });
    await context.addInitScript(({forceCanvas}) => {
      window.__drawingMetrics = new WeakMap();window.__glDiagnostics=[];
      const shaderParameter=WebGLRenderingContext.prototype.getShaderParameter,programParameter=WebGLRenderingContext.prototype.getProgramParameter;
      WebGLRenderingContext.prototype.getShaderParameter=function(shader,key){const value=shaderParameter.call(this,shader,key);if(key===this.COMPILE_STATUS&&!value)window.__glDiagnostics.push(this.getShaderInfoLog(shader));return value;};
      WebGLRenderingContext.prototype.getProgramParameter=function(program,key){const value=programParameter.call(this,program,key);if(key===this.LINK_STATUS&&!value)window.__glDiagnostics.push(this.getProgramInfoLog(program));return value;};
      const metric = canvas => {let value=window.__drawingMetrics.get(canvas);if(!value){value={drawCounts:[],arcs:0};window.__drawingMetrics.set(canvas,value);}return value;};
      const getContext=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,...options){if(forceCanvas && (kind==="webgl"||kind==="webgl2"||kind==="experimental-webgl"))return null;return getContext.call(this,kind,...options);};
      const drawArrays=WebGLRenderingContext.prototype.drawArrays,clear=WebGLRenderingContext.prototype.clear;
      WebGLRenderingContext.prototype.drawArrays=function(mode,first,count){metric(this.canvas).drawCounts.push(count);return drawArrays.call(this,mode,first,count);};
      WebGLRenderingContext.prototype.clear=function(mask){metric(this.canvas).drawCounts=[];return clear.call(this,mask);};
      const arc=CanvasRenderingContext2D.prototype.arc,clearRect=CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.arc=function(...args){metric(this.canvas).arcs+=1;return arc.apply(this,args);};
      CanvasRenderingContext2D.prototype.clearRect=function(...args){metric(this.canvas).arcs=0;return clearRect.apply(this,args);};
    },{forceCanvas});
    const page=await context.newPage();
    page.on("pageerror",error=>result.pageErrors.push({scenario:name,message:String(error)}));
    await page.goto(origin,{waitUntil:"networkidle",timeout:60000});
    await page.waitForFunction(()=>window.__fullPointAcceptance?.ready,null,{timeout:60000});
    const evaluate=(method,...args)=>page.evaluate(({method,args})=>window.__fullPointAcceptance[method](...args),{method,args});
    const initial=await evaluate("snapshot");
    result.scenarios[name]={initial,glDiagnostics:await page.evaluate(()=>window.__glDiagnostics)};
    check(name+" renderer",initial.renderer,name);
    check(name+" full source count",initial.total,100000);
    check(name+" all initial points in viewport",initial.visible,100000);
    check(name+" single point surface",initial.surfaces,1);
    check(name+" no per-point Leaflet markers",initial.markers,0);
    check(name+" initial full draw",forceCanvas?initial.canvasArcs:initial.drawCounts,forceCanvas?100000:[100000]);
    check(name+" no eager lazy-series read for velocity",initial.seriesReads,0);
    check(name+" no full PASC expansion",initial.pascReads,0);
    const scenario={initial,glDiagnostics:await page.evaluate(()=>window.__glDiagnostics),rendererInfo:await evaluate("rendererInfo"),timings:await page.evaluate(()=>{const a=window.__fullPointAcceptance;return {generationMs:a.generationMs,indexMs:a.indexMs,initialRenderMs:a.initialRenderMs};})};
    result.scenarios[name]=scenario;console.log(name+": 100k full source ready");
    const screenshot=join(artifactDir,name+"-100k.png");await page.screenshot({path:screenshot});result.screenshots.push(screenshot);
    const clickPosition=await evaluate("coordinate",50250);await page.mouse.click(clickPosition.x,clickPosition.y);
    scenario.click=await evaluate("clickResult");check(name+" actual mouse click",scenario.click.id,"p50250");
    await evaluate("beginBox");
    const start=await evaluate("coordinate",40100);
    // Select a rectangle wholly within the grid: row 80/column 100 to row 140/column 220.
    const finish=await evaluate("coordinate",70220);
    await page.mouse.move(start.x+.4,start.y+.4);await page.mouse.down();await page.mouse.move(finish.x+.4,finish.y+.4,{steps:8});await page.mouse.up();
    const box=await evaluate("endBox");assert.ok(box && box.ids.length>0,"actual mouse rectangle must select points");
    const expectedIds=await evaluate("expectedBox",box.bounds);check(name+" actual mouse box exact IDs",box.ids.sort(),expectedIds);
    scenario.box={count:box.ids.length,milliseconds:box.milliseconds,bounds:box.bounds};
    scenario.polygon=await evaluate("polygon");check(name+" polygon exact IDs",scenario.polygon.idsMatch,true);
    scenario.pan=await evaluate("pan",400,120);check(name+" pan visible count",scenario.pan.visible,scenario.pan.expectedVisible);
    assert.ok(scenario.pan.visible>0 && scenario.pan.visible<100000,"pan must reveal a strict subset");
    check(name+" pan draw count",forceCanvas?scenario.pan.canvasArcs:scenario.pan.drawCounts,forceCanvas?scenario.pan.expectedCanvasArcs:[100000]);
    scenario.panBack=await evaluate("pan",-400,-120);check(name+" pan back retains every point",scenario.panBack.visible,100000);
    await evaluate("reset");scenario.highlight=await evaluate("highlight");
    if(!forceCanvas)check(name+" sparse highlight batch",scenario.highlight.drawCounts,[100000,1000]);
    scenario.swipe=await evaluate("swipe");if(!forceCanvas)check(name+" swipe full batches",scenario.swipe.drawCounts,[100000,100000]);
    await evaluate("reset");await evaluate("focus",50250);
    scenario.smallGlyph=await evaluate("smallGlyph",50250);check(name+" minimum-radius glyph retains fill",scenario.smallGlyph.colored>0,true);
    scenario.styles={};
    for(const attribute of ["mode","coherence","missing","velocity"]){const sample=await evaluate("style",attribute);scenario.styles[attribute]=sample;check(name+" "+attribute+" no eager series read",sample.reads,0);}
    scenario.styles.unloadedDisplacement=await evaluate("style","displacement",10);
    check(name+" unloaded displacement is gray",isGrey(scenario.styles.unloadedDisplacement.pixel),true);
    await evaluate("loadColumn",10);scenario.styles.loadedDisplacement={pixel:await evaluate("pixel",50250)};
    check(name+" loaded column invalidates cached colors",hasColour(scenario.styles.loadedDisplacement.pixel),true);
    scenario.styles.uncachedStage=await evaluate("style","stageVelocity");
    check(name+" uncached lazy stage is gray",isGrey(scenario.styles.uncachedStage.pixel),true);
    check(name+" uncached stage avoids full-series scans",scenario.styles.uncachedStage.reads,0);
    await evaluate("stageCache");scenario.styles.cachedStage=await evaluate("style","stageVelocity");
    check(name+" cached stage is colored",hasColour(scenario.styles.cachedStage.pixel),true);
    check(name+" cached stage avoids full-series scans",scenario.styles.cachedStage.reads,0);
    check(name+" no PASC expansion after styles",scenario.styles.cachedStage.pascReads,0);
    if(!forceCanvas){await evaluate("reset");check("actual WEBGL_lose_context available",await evaluate("loseContext"),true);await page.waitForFunction(()=>document.querySelector(".leaflet-full-point-layer")?.dataset.renderer==="canvas",null,{timeout:10000});await page.waitForTimeout(100);scenario.contextLoss=await evaluate("snapshot");check("actual context loss switches to Canvas",scenario.contextLoss.renderer,"canvas");check("context loss retains single surface",scenario.contextLoss.surfaces,1);check("context loss Canvas draws all 100k",scenario.contextLoss.canvasArcs,100000);const lostScreenshot=join(artifactDir,"context-loss-canvas-100k.png");await page.screenshot({path:lostScreenshot});result.screenshots.push(lostScreenshot);}
    scenario.coincidentHits=await evaluate("coincidentHits");check(name+" indexed complete coincidence IDs",scenario.coincidentHits,{count:61,unique:61,all:true});
    const overlapExpected=await evaluate("overlapMap");
    await page.waitForSelector(".leaflet-host canvas.leaflet-full-point-layer",{timeout:15000});
    await page.waitForTimeout(350);
    const overlapHost=await page.locator(".leaflet-host").boundingBox();assert.ok(overlapHost,"production map host must exist");
    await page.mouse.click(overlapHost.x+overlapHost.width/2,overlapHost.y+overlapHost.height/2);
    await page.waitForSelector(".map-point-candidates",{timeout:10000});
    check(name+" overlap nearest remains default",await evaluate("overlapResult"),"coincident-60");
    const seen=[];
    for(let pageNumber=0;pageNumber<4;pageNumber+=1){
      const pageIds=await page.locator(".map-point-candidates button[data-point-id]").evaluateAll(buttons=>buttons.map(button=>button.dataset.pointId));
      check(name+" overlap page "+(pageNumber+1)+" size",pageIds.length,pageNumber<3?20:1);seen.push(...pageIds);
      if(pageNumber<3)await page.getByRole("button",{name:"下一页",exact:true}).click();
    }
    check(name+" overlap pagination preserves all IDs",seen.sort(),overlapExpected);
    await page.locator('.map-point-candidates button[data-point-id="coincident-0"]').click();
    check(name+" last-page coincident point selectable",await evaluate("overlapResult"),"coincident-0");
    const overlapScreenshot=join(artifactDir,name+"-coincident-popup.png");await page.screenshot({path:overlapScreenshot});result.screenshots.push(overlapScreenshot);
    check(name+" stale popup cannot select old generation",(await evaluate("replaceOverlapMap")).selected,"replacement-generation");
    // Leaflet removes popup DOM after its fade transition; membership guards act synchronously.
    await page.waitForSelector(".map-point-candidates",{state:"detached",timeout:5000});
    check(name+" popup closes after points replacement",await page.locator(".map-point-candidates").count(),0);
    await page.mouse.click(overlapHost.x+overlapHost.width/2,overlapHost.y+overlapHost.height/2);
    await page.waitForSelector(".map-point-candidates",{timeout:5000});
    check(name+" hidden popup cannot select current point",await evaluate("hideOverlapMap"),"hidden-selection");
    await page.waitForSelector(".map-point-candidates",{state:"detached",timeout:5000});
    await page.mouse.click(overlapHost.x+overlapHost.width/2,overlapHost.y+overlapHost.height/2);
    await page.waitForTimeout(150);
    check(name+" hidden point layer cannot be clicked or reopened",{selected:await evaluate("overlapResult"),popupCount:await page.locator(".map-point-candidates").count()},{selected:"hidden-selection",popupCount:0});
    scenario.overlap={count:seen.length,defaultId:"coincident-60",selectedId:"coincident-0",staleGenerationBlocked:true,hiddenLayerBlocked:true,pages:4,productionComponent:"WebGisMap"};
        console.log(name+": interaction, lazy styles, fallback and overlap paging passed");await context.close();
  }
  check("no unhandled browser errors",result.pageErrors,[]);
  check("no remote dependency requests",result.blockedExternalRequests,[]);
  result.passed=true;
} catch(error) { result.error=String(error?.stack||error);process.exitCode=1; }
finally {await browser?.close();await new Promise(resolveClose=>server.close(resolveClose));result.finishedAt=new Date().toISOString();await writeFile(resultPath,JSON.stringify(result,null,2)+"\n","utf8");}
console.log(JSON.stringify({passed:result.passed,checks:result.checks.length,resultPath,error:result.error},null,2));