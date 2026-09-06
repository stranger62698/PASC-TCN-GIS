import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

const browserPath = process.env.REMEDIATION_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const baseUrl = process.env.REMEDIATION_URL || "http://localhost:3000";
const port = Number(process.env.REMEDIATION_CDP_PORT || 9338);
const profileDir = await mkdtemp(resolve(tmpdir(), "codex-remediation-browser-"));
const sleep = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

async function waitJson(url, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError || new Error("CDP endpoint did not become ready.");
}

async function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  await new Promise((resolvePromise, reject) => {
    socket.onopen = resolvePromise;
    socket.onerror = reject;
  });
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  return {
    call(method, params = {}) {
      const id = ++sequence;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolvePromise, reject) => pending.set(id, { resolve: resolvePromise, reject }));
    },
    close() { socket.close(); },
  };
}

const browser = spawn(browserPath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=" + port,
  "--user-data-dir=" + profileDir,
  "about:blank",
], { stdio: "ignore", windowsHide: true });

let cdp;
try {
  await waitJson("http://127.0.0.1:" + port + "/json/version");
  const pageResponse = await fetch("http://127.0.0.1:" + port + "/json/new?" + encodeURIComponent(baseUrl), { method: "PUT" });
  const page = await pageResponse.json();
  cdp = await connectCdp(page.webSocketDebuggerUrl);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const evaluate = async expression => {
    const result = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser expression failed.");
    return result.result.value;
  };
  const waitFor = async (expression, timeout = 60_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await sleep(250);
    }
    throw new Error("Timed out waiting for: " + expression);
  };
  const clickText = async (scope, text) => {
    const found = await evaluate(`(() => { const root=document.querySelector(${JSON.stringify(scope)}) || document; const element=[...root.querySelectorAll('button,a')].find(item => item.textContent.replace(/\\s+/g,' ').trim().includes(${JSON.stringify(text)})); element?.scrollIntoView({block:'center'}); return Boolean(element); })()`);
    if (!found) throw new Error("Missing action: " + text);
    await sleep(450);
    const target = await evaluate(`(() => { const root=document.querySelector(${JSON.stringify(scope)}) || document; const element=[...root.querySelectorAll('button,a')].find(item => item.textContent.replace(/\\s+/g,' ').trim().includes(${JSON.stringify(text)})); if(!element)return null; const r=element.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,hit:Boolean(hit && (hit===element || element.contains(hit))),hitTag:hit?.tagName||null,hitClass:String(hit?.className||''),pointerEvents:getComputedStyle(element).pointerEvents}; })()`);
    if (!target) throw new Error("Missing action: " + text);
    if (!target.hit) throw new Error("Action is covered and not clickable: " + text + " " + JSON.stringify(target));
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 });
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
  };
  const pressKey = async (key, code, windowsVirtualKeyCode) => {
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
  };

  await waitFor("document.readyState === 'complete' && Boolean(document.querySelector('.home-case-gallery'))");
  const homeAsset = await evaluate("document.querySelector('#home-case-preview img')?.getAttribute('src') || ''");
  if (!homeAsset.includes("home-case-city-displacement.webp")) throw new Error("Xinbu homepage image is not the supplied displacement asset: " + homeAsset);
  await clickText(".case-gallery-selector", "江东新区主要道路时序形变");
  await waitFor("document.querySelector('#home-case-preview img')?.getAttribute('src')?.includes('home-case-road.png')");
  await evaluate("document.getElementById('home-case-tab-road')?.focus(); true");
  await pressKey("ArrowRight", "ArrowRight", 39);
  await waitFor("document.getElementById('home-case-tab-landslide')?.getAttribute('aria-selected') === 'true' && document.activeElement?.id === 'home-case-tab-landslide'");
  await clickText(".platform-highlight-grid", "打开时空地图");
  await waitFor("location.pathname === '/map' && Boolean(document.querySelector('.leaflet-container'))");

  await clickText(".map-swipe-tool", "开启卷帘");
  await waitFor("Boolean(document.querySelector('.map-swipe-divider'))");
  const swipeBefore = await evaluate("Number(document.querySelector('.map-swipe-divider')?.getAttribute('aria-valuenow'))");
  const swipeTarget = await evaluate("(() => { const divider=document.querySelector('.map-swipe-divider'), map=document.querySelector('.leaflet-host'); if(!divider||!map)return null; const d=divider.getBoundingClientRect(),m=map.getBoundingClientRect(); return {startX:d.left+d.width/2,y:d.top+d.height/2,endX:m.left+m.width*.68}; })()");
  if (!swipeTarget) throw new Error("Swipe divider is missing.");
  await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: swipeTarget.startX, y: swipeTarget.y, button: "left", clickCount: 1 });
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: swipeTarget.endX, y: swipeTarget.y, button: "left", buttons: 1 });
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: swipeTarget.endX, y: swipeTarget.y, button: "left", clickCount: 1 });
  await waitFor("Number(document.querySelector('.map-swipe-divider')?.getAttribute('aria-valuenow')) >= 66");
  const swipeAfterDrag = await evaluate("Number(document.querySelector('.map-swipe-divider')?.getAttribute('aria-valuenow'))");
  const swipePixels = await evaluate("(() => { const canvas=document.querySelector('.map-swipe-canvas'); if(!canvas)return 0; const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data; let count=0; for(let i=3;i<data.length;i+=64){if(data[i])count++;} return count; })()");
  if (!swipePixels) throw new Error("Swipe comparison canvas did not render visible points.");
  await evaluate("document.querySelector('.map-swipe-divider')?.focus(); true");
  await pressKey("ArrowLeft", "ArrowLeft", 37);
  await waitFor(`Number(document.querySelector('.map-swipe-divider')?.getAttribute('aria-valuenow')) <= ${swipeAfterDrag - 1}`);
  const swipeAfterKeyboard = await evaluate("Number(document.querySelector('.map-swipe-divider')?.getAttribute('aria-valuenow'))");
  await clickText(".map-swipe-tool", "退出卷帘");
  await waitFor("!document.querySelector('.map-swipe-divider')");

  await clickText(".map-corner-dock", "工作区");
  await waitFor("!document.querySelector('.gis-left')?.classList.contains('is-collapsed')");
  const leftPosition = await evaluate("(() => { const r=document.querySelector('.gis-left').getBoundingClientRect(); return {left:r.left,right:r.right,width:r.width,viewport:innerWidth}; })()");
  if (leftPosition.right < leftPosition.viewport - 100) throw new Error("Workspace drawer did not open beside the right-side tool dock.");
  await clickText(".left-workspace-tabs", "图层");
  await waitFor("document.getElementById('left-workspace-tab-layers')?.getAttribute('aria-selected') === 'true'");
  const tailBefore = await evaluate("document.getElementById('priority-tail-percent')?.value");
  await evaluate("(() => { const input=document.getElementById('priority-tail-percent'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,'7'); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()");
  await waitFor("document.getElementById('priority-tail-percent')?.value === '7'");

  await clickText(".gis-left .panel-head", "×");
  await waitFor("document.querySelector('.gis-left')?.classList.contains('is-collapsed')");
  await clickText(".map-analysis-dock", "发现异常");
  await waitFor("Boolean(document.querySelector('.map-clear-anomaly-control'))");
  const adjacentClear = await evaluate("document.querySelector('.map-discover-control')?.nextElementSibling?.classList.contains('map-clear-anomaly-control') || false");
  if (!adjacentClear) throw new Error("Clear-anomaly action is not adjacent to discovery.");
  await clickText(".map-analysis-dock", "清除异常");
  await waitFor("!document.querySelector('.map-clear-anomaly-control')");

  if (!await evaluate("document.querySelector('.gis-detail')?.classList.contains('is-collapsed')")) {
    await clickText(".gis-detail .panel-head", "×");
    await waitFor("document.querySelector('.gis-detail')?.classList.contains('is-collapsed')");
  }
  await clickText(".map-corner-dock", "分析");
  await waitFor("!document.querySelector('.gis-detail')?.classList.contains('is-collapsed')");
  const rightPosition = await evaluate("(() => { const r=document.querySelector('.gis-detail').getBoundingClientRect(); return {left:r.left,right:r.right,width:r.width,viewport:innerWidth}; })()");
  if (rightPosition.right < rightPosition.viewport - 100) throw new Error("Analysis drawer did not open beside the right-side tool dock.");

  const result = {
    homepageXinbuAsset: homeAsset,
    homepageCaseKeyboard: "passed",
    platformActionNavigation: "passed",
    swipeComparison: { before: swipeBefore, afterDrag: swipeAfterDrag, afterKeyboard: swipeAfterKeyboard, sampledVisiblePixels: swipePixels },
    workspaceSide: leftPosition,
    analysisSide: rightPosition,
    priorityTailPercent: { before: tailBefore, after: "7" },
    anomalyClearAdjacent: adjacentClear,
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  cdp?.close();
  browser.kill();
  await sleep(400);
  const resolvedProfile = resolve(profileDir);
  const resolvedTemp = resolve(tmpdir());
  if (resolvedProfile.startsWith(resolvedTemp + sep)) await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3 });
}
