import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

const targetUrl = process.env.FIELD_PHOTO_URL || "http://localhost:3000/map";
const browserPath = process.env.FIELD_PHOTO_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const photoPath = resolve(process.env.FIELD_PHOTO_SAMPLE || "C:\\Users\\Administrator\\Desktop\\结果整理\\南渡江西岸老城区_点位整理\\编号图片\\P001_水印_20260730165758168-41-1397138.jpg");
const outputDir = resolve("artifacts/field-photo-browser");
const port = Number(process.env.FIELD_PHOTO_CDP_PORT || 9337);
if (!existsSync(browserPath)) throw new Error("Microsoft Edge executable not found.");
if (!existsSync(photoPath)) throw new Error("Field photo sample not found.");
await mkdir(outputDir, { recursive: true });
const profileDir = await mkdtemp(resolve(tmpdir(), "codex-field-photo-browser-"));
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

async function connectCdp(webSocketDebuggerUrl, onEvent = () => {}) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  await new Promise((resolvePromise, reject) => {
    socket.onopen = resolvePromise;
    socket.onerror = reject;
  });
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (!message.id) { onEvent(message); return; }
    if (!pending.has(message.id)) return;
    const request = pending.get(message.id);
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

const browserProcess = spawn(browserPath, [
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
  const pageInfoResponse = await fetch("http://127.0.0.1:" + port + "/json/new?" + encodeURIComponent(targetUrl), { method: "PUT" });
  if (!pageInfoResponse.ok) throw new Error("Unable to create CDP page.");
  const pageInfo = await pageInfoResponse.json();
  const requestUrls = new Map();
  const ocrNetwork = [];
  const browserExceptions = [];
  const browserConsole = [];
  cdp = await connectCdp(pageInfo.webSocketDebuggerUrl, message => {
    if (message.method === "Network.requestWillBeSent") requestUrls.set(message.params.requestId, message.params.request.url);
    if (message.method === "Network.responseReceived" && message.params.response.url.includes("/ocr/")) ocrNetwork.push({ type: "response", url: message.params.response.url, status: message.params.response.status, mimeType: message.params.response.mimeType });
    if (message.method === "Network.loadingFailed" && (requestUrls.get(message.params.requestId) || "").includes("/ocr/")) ocrNetwork.push({ type: "failed", url: requestUrls.get(message.params.requestId), error: message.params.errorText });
    if (message.method === "Runtime.exceptionThrown") browserExceptions.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || "unknown browser exception");
    if (message.method === "Runtime.consoleAPICalled") browserConsole.push(message.params.args.map(item => item.value ?? item.description ?? "").join(" "));
  });
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Network.enable");

  const evaluate = async expression => {
    const result = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser expression failed.");
    return result.result.value;
  };
  const waitFor = async (expression, timeout = 30_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await sleep(250);
    }
    throw new Error("Timed out waiting for: " + expression);
  };
  const box = selector => evaluate("(() => { const element=document.querySelector(" + JSON.stringify(selector) + "); if(!element)return null; const r=element.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()");
  const clickSelector = selector => evaluate("document.querySelector(" + JSON.stringify(selector) + ")?.click(); true");
  const clickBox = async selector => {
    const target = await box(selector);
    if (!target) throw new Error("Missing click target: " + selector);
    const x = target.x + target.width / 2, y = target.y + target.height / 2;
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  const screenshot = async name => {
    const image = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(resolve(outputDir, name), Buffer.from(image.data, "base64"));
  };

  await waitFor("document.readyState === 'complete' && Boolean(document.querySelector('.leaflet-container')) && [...document.querySelectorAll('[role=tab]')].some(element => element.textContent.trim() === '现场')", 60_000);
  await sleep(1_000);
  const fieldTabClicked = await evaluate("(() => { const element=document.querySelector('.left-workspace-tabs button:nth-child(3)'); if(!element)return false; element.scrollIntoView({block:'center'}); element.click(); return true; })()");
  if (!fieldTabClicked) throw new Error("Field tab was not found.");
  await waitFor("Boolean(document.querySelector('.field-observation-panel'))", 30_000);
  const documentNode = await cdp.call("DOM.getDocument", { depth: -1 });
  const fileInput = await cdp.call("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: 'input[type="file"][accept*="image/jpeg"]' });
  if (!fileInput.nodeId) throw new Error("Field-photo file input was not found.");
  await cdp.call("DOM.setFileInputFiles", { nodeId: fileInput.nodeId, files: [photoPath] });
  await waitFor("Boolean(document.querySelector('.field-coordinate-origin.watermark')) || document.body.innerText.includes('水印坐标未能自动识别')", 45_000).catch(() => null);
  if (!await evaluate("Boolean(document.querySelector('.field-coordinate-origin.watermark'))")) {
    const fieldMessage = await evaluate("document.querySelector('.field-observation-message')?.innerText || ''");
    console.log("OCR_NETWORK " + JSON.stringify(ocrNetwork));
    console.log("OCR_EXCEPTIONS " + JSON.stringify(browserExceptions));
    console.log("OCR_CONSOLE " + JSON.stringify(browserConsole.filter(line => line.includes("[field-photo-ocr"))));
    console.log("OCR_FIELD_MESSAGE " + JSON.stringify(fieldMessage));
    await screenshot("00-ocr-failure.png");
    throw new Error("Browser OCR did not produce a coordinate.");
  }

  const fieldValue = label => evaluate("(() => { const label=[...document.querySelectorAll('label')].find(item => item.textContent.trim().startsWith(" + JSON.stringify(label) + ")); return label?.querySelector('input,textarea')?.value || null; })()");
  const longitude = await fieldValue("经度");
  const latitude = await fieldValue("纬度");
  if (Math.abs(Number(longitude) - 110.363739) > 1e-7 || Math.abs(Number(latitude) - 20.027695) > 1e-7) throw new Error("OCR coordinate mismatch: " + longitude + ", " + latitude);
  const setField = (label, value, tag) => evaluate("(() => { const label=[...document.querySelectorAll('label')].find(item => item.textContent.trim().startsWith(" + JSON.stringify(label) + ")); const element=label?.querySelector(" + JSON.stringify(tag) + "); if(!element)return false; const setter=Object.getOwnPropertyDescriptor(" + (tag === "textarea" ? "HTMLTextAreaElement" : "HTMLInputElement") + ".prototype,'value').set; setter.call(element," + JSON.stringify(value) + "); element.dispatchEvent(new Event('input',{bubbles:true})); return true; })()");
  await setField("考察点名称", "南渡江西岸老城区现场点 P001", "input");
  await setField("现场记录", "经纬相机水印坐标与现场照片对应验收", "textarea");
  await screenshot("01-watermark-coordinate-confirmation.png");
  await evaluate("([...document.querySelectorAll('button')].find(element => element.textContent.trim() === '保存考察点'))?.click(); true");
  await waitFor("Boolean(document.querySelector('.field-camera-pin'))", 30_000);

  const initialMarker = await box(".field-camera-pin");
  if (!initialMarker || initialMarker.width < 24 || initialMarker.width > 40) throw new Error("Initial camera marker size is outside the intended range.");
  const markerBox = await box(".field-camera-pin");
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: markerBox.x + markerBox.width / 2, y: markerBox.y + markerBox.height / 2 });
  await evaluate("document.querySelector('.field-camera-pin')?.closest('.leaflet-marker-icon')?.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); true");
  await waitFor("Boolean(document.querySelector('.field-map-photo-card'))", 10_000);
  const popupText = await evaluate("document.querySelector('.field-map-photo-card')?.innerText || ''");
  if (!popupText.includes("南渡江西岸老城区现场点 P001") || !popupText.includes("110.363739")) throw new Error("Hover popup is missing field metadata.");
  const popupBox = await box(".field-map-photo-card");
  if (!popupBox || popupBox.width > 330 || popupBox.height > 150) throw new Error("Hover popup is visually oversized.");
  await screenshot("02-camera-hover-card.png");

  await clickSelector(".field-map-photo-cover");
  await waitFor("Boolean(document.querySelector('.field-photo-lightbox'))", 10_000);
  const lightboxImageBox = await box(".field-lightbox-image img");
  if (!lightboxImageBox || lightboxImageBox.width < 500 || lightboxImageBox.height < 500) throw new Error("Photo did not open in a dedicated large preview.");
  await screenshot("03-photo-lightbox.png");
  const closeBox = await box(".field-lightbox-close");
  const closeStack = closeBox ? await evaluate("(() => { const box=" + JSON.stringify(closeBox) + "; return document.elementsFromPoint(box.x+box.width/2,box.y+box.height/2).slice(0,6).map(element => ({tag:element.tagName,className:element.className,pointerEvents:getComputedStyle(element).pointerEvents,zIndex:getComputedStyle(element).zIndex})); })()") : [];
  await evaluate("window.__fieldCloseEvents=[]; ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(type => document.addEventListener(type,event => window.__fieldCloseEvents.push({type,target:event.target?.className||event.target?.tagName}),{capture:true,once:true})); true");
  await clickBox(".field-lightbox-close");
  await sleep(400);
  const closeDebug = { closeBox, closeStack, events: await evaluate("window.__fieldCloseEvents || []"), stillOpen: await evaluate("Boolean(document.querySelector('.field-photo-lightbox'))") };
  if (closeDebug.stillOpen) { console.log("LIGHTBOX_CLOSE_DEBUG " + JSON.stringify(closeDebug)); throw new Error("Photo lightbox close button did not dismiss the dialog."); }

  await evaluate("document.querySelector('.field-camera-pin')?.closest('.leaflet-marker-icon')?.dispatchEvent(new MouseEvent('click',{bubbles:true})); true");
  await waitFor("Boolean(document.querySelector('.field-visit-photo-stage.compact'))", 10_000);
  const compactBox = await box(".field-visit-photo-preview");
  if (!compactBox || compactBox.height > 115) throw new Error("Right-side field photo preview is still oversized.");

  await evaluate("window.scrollTo(0,0); document.querySelector('.gis-map')?.scrollIntoView({block:'nearest'}); true");
  await sleep(500);
  if (!await evaluate("Boolean(document.querySelector('.leaflet-container'))")) throw new Error("Leaflet map was not found for keyboard zoom.");
  await evaluate("document.querySelector('.leaflet-container')?.focus(); true");
  const keyZoom = async (key, code, windowsVirtualKeyCode) => {
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
    await sleep(550);
  };
  for (let index = 0; index < 4; index += 1) await keyZoom("-", "Minus", 189);
  const lowZoomMarker = await box(".field-camera-pin");
  const lowZoomSize = await evaluate("document.querySelector('.field-camera-pin')?.style.getPropertyValue('--field-camera-size') || ''");
  for (let index = 0; index < 4; index += 1) await keyZoom("+", "Equal", 187);
  const highZoomMarker = await box(".field-camera-pin");
  const highZoomSize = await evaluate("document.querySelector('.field-camera-pin')?.style.getPropertyValue('--field-camera-size') || ''");
  if (!lowZoomMarker || !highZoomMarker || highZoomMarker.width <= lowZoomMarker.width) throw new Error("Camera marker did not scale with map zoom: " + JSON.stringify({ lowZoomMarker, highZoomMarker, lowZoomSize, highZoomSize }));

  const result = {
    targetUrl,
    coordinates: { longitude: Number(longitude), latitude: Number(latitude), source: "watermark-ocr" },
    markerPixels: { initial: initialMarker.width, lowZoom: lowZoomMarker.width, highZoom: highZoomMarker.width },
    popupPixels: popupBox,
    compactEvidencePixels: compactBox,
    lightboxImagePixels: lightboxImageBox,
  };
  await writeFile(resolve(outputDir, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
} finally {
  cdp?.close();
  browserProcess.kill();
  await sleep(500);
  const resolvedProfile = resolve(profileDir);
  const resolvedTemp = resolve(tmpdir());
  if (resolvedProfile.startsWith(resolvedTemp + sep)) await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3 });
}
