import assert from "node:assert/strict";
import test from "node:test";
import type { Map as LeafletMap } from "leaflet";
import type { InsarPoint } from "../app/data/site";
import { SpatialGridIndex } from "../app/lib/spatial-analysis";
import { aggregateAoiSeries, aggregateValue, geometryBounds, summarizeAoi } from "../app/lib/aoi-analysis";
import { FullPointLayer, pointDataBounds, projectPointWorld, queryNearestPoint, queryPointHits, type FullPointLayerState } from "../app/lib/full-point-layer";

const point = (id: string, lon: number, lat: number, velocity = -5): InsarPoint => ({ id, name: id, lon, lat, velocity, displacement: velocity, mode: "线性型", coherence: .9, missingRate: 0, series: [0, velocity], dates: ["2024-01-01", "2025-01-01"], updated: "2025-01-01" });

test("grid visits all points, including occupied cells in a world-sized viewport", () => {
  const points = Array.from({ length: 25001 }, (_, i) => point(String(i), 110 + i / 1000000, 20));
  const index = new SpatialGridIndex<InsarPoint>(.0001).load(points);
  assert.equal(index.queryBounds({ west: -180, east: 180, south: -90, north: 90 }).length, points.length);
  let visited = 0;
  index.forEachInBounds({ west: 110, east: 110.025, south: 20, north: 20 }, () => { visited += 1; });
  assert.equal(visited, points.length);
  assert.equal(index.queryBounds({ west: NaN, east: 180, south: -90, north: 90 }).length, 0);
  assert.throws(() => new SpatialGridIndex(0), RangeError);
});

test("indexed nearest query examines candidates in the hit bounds and retains edge points", () => {
  const points = [point("outside", 10, 10), point("edge", 1, 1), point("near", .99, .99)];
  const index = new SpatialGridIndex<InsarPoint>().load(points);
  let projected = 0;
  const nearest = queryNearestPoint(index, { west: .9, east: 1, south: .9, north: 1 }, { x: 100, y: 100 }, p => { projected += 1; return { x: p.lon * 100, y: p.lat * 100 }; });
  assert.equal(nearest?.id, "edge");
  assert.equal(projected, 2);
});

test("hidden closest points do not obscure visible hits, and hidden-only layers cannot be selected", () => {
  const points = [point("visible", .6, .5), point("hidden", .5, .5)];
  const index = new SpatialGridIndex<InsarPoint>().load(points);
  const bounds = { west: .3, east: .7, south: .3, north: .7 }, pixel = { x: 50, y: 50 };
  const project = (p: InsarPoint) => ({ x: p.lon * 100, y: p.lat * 100 });
  const visible = (p: InsarPoint) => p.id === "visible";
  assert.equal(queryNearestPoint(index, bounds, pixel, project, 18, visible)?.id, "visible");
  assert.deepEqual(queryPointHits(index, bounds, pixel, project, 18, visible).map(p => p.id), ["visible"]);
  assert.equal(queryNearestPoint(index, bounds, pixel, project, 18, () => false), null);
  assert.deepEqual(queryPointHits(index, bounds, pixel, project, 18, () => false), []);
  assert.equal(index.queryBounds(bounds).length, points.length);
});

test("full-data bounds, extrema, median and AOI series do not use argument-sized spreads", () => {
  const count = 200001;
  const points = Array.from({ length: count }, (_, i) => point(String(i), i / 1000000, 20, i - 100000));
  const summary = summarizeAoi(points, 1, .75)!;
  assert.equal(summary.pointCount, count);
  assert.equal(summary.minimumVelocity, -100000);
  assert.equal(summary.maximumVelocity, 100000);
  assert.equal(summary.medianVelocity, 0);
  assert.equal(summary.maximumAbsoluteDisplacement, 100000);
  assert.deepEqual(pointDataBounds(points), [0, 20, .2, 20]);
  assert.deepEqual(geometryBounds({ type: "polygon", coordinates: points.map(p => [p.lon, p.lat]) }), [0, 20, .2, 20]);
  assert.deepEqual(aggregateAoiSeries(points, "mean").overall, [0, 0]);
  assert.equal(aggregateValue([8, 1, NaN, 3, 2, Infinity], "median"), 2.5);
  assert.equal(aggregateValue([8, 1, NaN, 3, 2, Infinity], "mean"), 3.5);
});

test("Mercator projection remains finite at polar edges", () => {
  assert.deepEqual(projectPointWorld(0, 0), [.5, .5]);
  assert.ok(projectPointWorld(180, 90).every(Number.isFinite));
});

function rendererHarness(webgl: boolean, canvasAvailable = true) {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const queue = new Map<number, FrameRequestCallback>();
  let nextFrame = 0, offsetX = 0, drawn = 0;
  let contextLossHandler: ((event: Event) => void) | null = null;
  const gpuDraws: number[] = [], shaders: string[] = [];
  const context = { setTransform() {}, clearRect() { drawn = 0; }, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, setLineDash() {}, arc() { drawn += 1; }, fill() {}, stroke() {} };
  const gl = {
    ONE: 15, VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, BLEND: 5, SRC_ALPHA: 6, ONE_MINUS_SRC_ALPHA: 7,
    ARRAY_BUFFER: 8, STATIC_DRAW: 9, COLOR_BUFFER_BIT: 10, SCISSOR_TEST: 11, FLOAT: 12, UNSIGNED_BYTE: 13, POINTS: 14,
    createShader: () => ({}), shaderSource: (_: unknown, source: string) => shaders.push(source), compileShader() {}, getShaderParameter: () => true, deleteShader() {},
    createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => true, deleteProgram() {}, enable() {}, disable() {}, blendFuncSeparate() {},
    createBuffer: () => ({}), bindBuffer() {}, bufferData() {}, deleteBuffer() {}, viewport() {}, clearColor() {}, clear() { gpuDraws.length = 0; }, useProgram() {},
    getUniformLocation: () => ({}), uniform1f() {}, uniform2f() {}, uniform4f() {}, getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {}, scissor() {},
    drawArrays: (_: number, __: number, count: number) => gpuDraws.push(count),
  };
  const canvases: Array<{ dataset: Record<string, string>; style: Record<string, string>; width: number; height: number; removed: boolean }> = [];
  const listeners = new Map<string, Set<() => void>>();
  const createElement = () => {
    const canvas = { dataset: {}, style: {}, width: 0, height: 0, removed: false, className: "", setAttribute() {}, addEventListener(event: string, handler: (event: Event) => void) { if (event === "webglcontextlost") contextLossHandler = handler; }, removeEventListener(event: string, handler: (event: Event) => void) { if (event === "webglcontextlost" && contextLossHandler === handler) contextLossHandler = null; }, remove() { this.removed = true; }, getContext(kind: string) { return kind === "webgl" ? webgl ? gl : null : canvasAvailable ? context : null; } };
    canvases.push(canvas); return canvas;
  };
  const map = {
    getPane: () => ({ appendChild() {} }), getSize: () => ({ x: 100, y: 100 }), getZoom: () => 0, getPixelOrigin: () => ({ x: 0, y: 0 }),
    containerPointToLayerPoint: () => ({ x: 0, y: 0 }),
    containerPointToLatLng: ([x, y]: [number, number]) => ({ lng: (x + offsetX) / 100, lat: 1 - y / 100 }),
    latLngToContainerPoint: ([lat, lon]: [number, number]) => ({ x: lon * 100 - offsetX, y: (1 - lat) * 100 }),
    on(events: string, fn: () => void) { for (const event of events.split(" ")) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn); } },
    off(events: string, fn: () => void) { for (const event of events.split(" ")) listeners.get(event)?.delete(fn); },
  };
  for (const [name, value] of Object.entries({ document: { createElement }, window: { devicePixelRatio: 1 }, requestAnimationFrame: (fn: FrameRequestCallback) => { const id = ++nextFrame; queue.set(id, fn); return id; }, cancelAnimationFrame: (id: number) => queue.delete(id) })) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  return {
    map: map as unknown as LeafletMap, canvases, gpuDraws, shaders, drawn: () => drawn,
    loseContext: () => contextLossHandler?.({ preventDefault() {} } as Event),
    pan: (offset: number) => { offsetX = offset; for (const fn of listeners.get("move") ?? []) fn(); },
    flush: () => { const frames = Array.from(queue); queue.clear(); for (const [, fn] of frames) fn(0); },
    restore: () => { for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } },
  };
}
function stateFor(points: InsarPoint[]): FullPointLayerState {
  return { points, index: new SpatialGridIndex<InsarPoint>().load(points), livePoints: [], renderStyle: { attribute: "velocity", min: -12.5, max: 12.5, interval: 2.5, colors: ["#e94b4b", "#1677ff"], timeIndex: 1, rangeStart: 0, rangeEnd: 1 }, pointSize: 3, coherenceThreshold: .75, visible: { points: true, risk: false, quality: false }, priorityIds: new Set(), limitedIds: new Set(), boxIds: new Set(), compareIds: new Set(), selectedId: null, highlightKind: "region" };
}

test("Canvas fallback paints every visible point and finds newly visible points after pan", () => {
  const harness = rendererHarness(false);
  let layer: FullPointLayer | undefined;
  try {
    const left = Array.from({ length: 15001 }, (_, i) => point(`L${i}`, .05 + i / 100000, .5));
    const right = Array.from({ length: 15001 }, (_, i) => point(`R${i}`, 1.05 + i / 100000, .5));
    const points = left.concat(right), statuses: string[] = [];
    // Drawing must never instantiate the lazy full PASC quality result.
    Object.defineProperty(points[0], "pasc", { get() { throw new Error("eager PASC access"); } });
    layer = new FullPointLayer(harness.map, status => statuses.push(status));
    layer.update(stateFor(points)); harness.flush();
    assert.equal(statuses.at(-1), "canvas");
    assert.equal(harness.drawn(), left.length);
    harness.pan(100); harness.flush();
    assert.equal(harness.drawn(), right.length);
    assert.equal(harness.canvases.at(-1)?.dataset.visiblePoints, String(right.length));
    assert.equal(harness.canvases.filter(canvas => !canvas.removed).length, 1);
  } finally { layer?.destroy(); harness.restore(); }
});

test("WebGL draws the full source, and a full selection is a batch rather than markers", () => {
  const harness = rendererHarness(true);
  let layer: FullPointLayer | undefined;
  try {
    const points = Array.from({ length: 20001 }, (_, i) => point(String(i), .1 + i / 100000, .5));
    layer = new FullPointLayer(harness.map);
    const state = stateFor(points);
    layer.update(state); harness.flush();
    assert.deepEqual(harness.gpuDraws, [points.length]);
    layer.update({ ...state, boxIds: new Set(points.map(p => p.id)) }); harness.flush();
    assert.deepEqual(harness.gpuDraws, [points.length, points.length]);
    assert.equal(harness.canvases.length, 1);
    layer.setSwipe(true, 40); harness.flush();
    assert.deepEqual(harness.gpuDraws, [points.length, points.length, points.length]);
  } finally { layer?.destroy(); harness.restore(); }
});

test("missing both drawing contexts is reported rather than silently pretending to draw", () => {
  const harness = rendererHarness(false, false);
  let layer: FullPointLayer | undefined;
  try {
    const statuses: string[] = [];
    layer = new FullPointLayer(harness.map, status => statuses.push(status));
    layer.update(stateFor([point("P1", .5, .5)])); harness.flush();
    assert.equal(statuses.at(-1), "unavailable");
    assert.equal(harness.canvases.at(-1)?.dataset.renderer, "unavailable");
  } finally { layer?.destroy(); harness.restore(); }
});
test("losing an active WebGL context switches to complete Canvas drawing", () => {
  const harness = rendererHarness(true);
  let layer: FullPointLayer | undefined;
  try {
    const points = Array.from({ length: 5001 }, (_, i) => point(String(i), .1 + i / 100000, .5));
    const statuses: string[] = [];
    layer = new FullPointLayer(harness.map, status => statuses.push(status));
    layer.update(stateFor(points)); harness.flush();
    assert.equal(statuses.at(-1), "webgl");
    harness.loseContext(); harness.flush();
    assert.equal(statuses.at(-1), "canvas");
    assert.equal(harness.drawn(), points.length);
    assert.equal(harness.canvases.filter(canvas => !canvas.removed).length, 1);
  } finally { layer?.destroy(); harness.restore(); }
});
test("indexed hit circle retains all coincident records, orders nearest first and excludes square corners", () => {
  const coincident = Array.from({ length: 61 }, (_, i) => point(`coincident-${i}`, .5, .5));
  const near = point("near-edge", .6, .5), corner = point("outside-circle", .67, .67), outside = point("outside-bounds", 2, 2);
  for (const p of coincident) Object.defineProperty(p, "series", { get() { throw new Error("hit query must not hydrate time series"); } });
  const index = new SpatialGridIndex<InsarPoint>(.01).load([...coincident, near, corner, outside]);
  const bounds = { west: .32, east: .68, south: .32, north: .68 }, pixel = { x: 50, y: 50 }, project = (p: InsarPoint) => ({ x: p.lon * 100, y: p.lat * 100 });
  const hits = queryPointHits(index, bounds, pixel, project, 18);
  assert.equal(hits.length, 62);
  assert.equal(hits[0], queryNearestPoint(index, bounds, pixel, project, 18));
  assert.equal(hits.at(-1)!.id, "near-edge");
  assert.deepEqual(hits.slice(0, 61).map(p => p.id).sort(), coincident.map(p => p.id).sort());
  assert.equal(hits.filter(p => p.id === "outside-circle").length, 0);
  assert.equal(hits.filter(p => p.id === "outside-bounds").length, 0);
  assert.equal(new Set(hits.map(p => p.id)).size, hits.length);
  const pages = Array.from({ length: Math.ceil(hits.length / 20) }, (_, page) => hits.slice(page * 20, (page + 1) * 20));
  assert.deepEqual(pages.map(page => page.length), [20, 20, 20, 2]);
  assert.deepEqual(pages.flat().map(p => p.id), hits.map(p => p.id));
});