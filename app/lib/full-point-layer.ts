import type { Map as LeafletMap } from "leaflet";
import type { InsarPoint } from "../data/site";
import { colorForMode } from "./analysis-context";
import { INSAR_RED_GREEN_COLORS, renderValue, type RenderStyle } from "./insar-v2";
import { patternPointOpacity } from "./v2-map-analysis";
import { SpatialGridIndex, type SpatialPoint } from "./spatial-analysis";
import type { GisBounds } from "./gis-layer";

export function pointDataBounds(points: readonly SpatialPoint[]): [number, number, number, number] | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.lon) || !Number.isFinite(point.lat)) continue;
    west = Math.min(west, point.lon); east = Math.max(east, point.lon);
    south = Math.min(south, point.lat); north = Math.max(north, point.lat);
  }
  return west === Infinity ? null : [west, south, east, north];
}

/** Normalized EPSG:3857 world coordinates, before the current Leaflet zoom scale. */
export function projectPointWorld(longitude: number, latitude: number): [number, number] {
  const clamped = Math.max(-85.0511287798, Math.min(85.0511287798, latitude));
  const sine = Math.sin(clamped * Math.PI / 180);
  return [(longitude + 180) / 360, .5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)];
}

export function queryNearestPoint<T extends SpatialPoint>(index: SpatialGridIndex<T>, bounds: GisBounds, pixel: { x: number; y: number }, project: (point: T) => { x: number; y: number }, tolerance = 18, accept: (point: T) => boolean = () => true): T | null {
  let nearest: T | null = null, distanceSquared = tolerance * tolerance;
  index.forEachInBounds(bounds, point => {
    const position = project(point), distance = (position.x - pixel.x) ** 2 + (position.y - pixel.y) ** 2;
    if (distance <= distanceSquared && accept(point)) { nearest = point; distanceSquared = distance; }
  });
  return nearest;
}

/** Every point within the hit circle, nearest first; equal-position records remain accessible. */
export function queryPointHits<T extends SpatialPoint>(index: SpatialGridIndex<T>, bounds: GisBounds, pixel: { x: number; y: number }, project: (point: T) => { x: number; y: number }, tolerance = 18, accept: (point: T) => boolean = () => true): T[] {
  if (!Number.isFinite(tolerance) || tolerance < 0) return [];
  const hits: Array<{ point: T; distance: number; order: number }> = [];
  const maximumDistance = tolerance * tolerance;
  let order = 0;
  index.forEachInBounds(bounds, point => {
    const position = project(point), distance = (position.x - pixel.x) ** 2 + (position.y - pixel.y) ** 2;
    if (distance <= maximumDistance && accept(point)) hits.push({ point, distance, order });
    order += 1;
  });
  // Match the existing nearest query's last-record preference on an exact tie.
  hits.sort((a, b) => a.distance - b.distance || b.order - a.order);
  return hits.map(hit => hit.point);
}
type Color = readonly [number, number, number];
type Rgba = readonly [number, number, number, number];
const parsedColors = new Map<string, Color>();
function parseColor(color: string): Color {
  const known = parsedColors.get(color); if (known) return known;
  let rgb: Color;
  if (color.startsWith("#")) {
    const hex = color.slice(1), expanded = hex.length === 3 ? hex.split("").map(part => part + part).join("") : hex;
    rgb = [parseInt(expanded.slice(0, 2), 16), parseInt(expanded.slice(2, 4), 16), parseInt(expanded.slice(4, 6), 16)];
  } else {
    const channels = color.match(/[\d.]+/g) ?? [];
    rgb = [Number(channels[0]) || 0, Number(channels[1]) || 0, Number(channels[2]) || 0];
  }
  parsedColors.set(color, rgb); return rgb;
}

// A palette is compiled once per style. Repeated color tuples are reused, rather
// than allocating marker/style/tooltip objects for every point.
function paletteFor(style: RenderStyle) {
  const ramp = (style.colors.length >= 2 ? style.colors : ["#e94b4b", "#1677ff"]).map(parseColor);
  const cache = new Map<number, Color>();
  const classified = ["velocity", "displacement", "stageVelocity"].includes(style.attribute) && style.interval > 0 && style.max > style.min;
  return (value: number): Color => {
    if (!Number.isFinite(value)) return parseColor("#94a3b8");
    let ratio = (value - style.min) / (style.max - style.min || 1);
    if (classified) {
      const steps = Math.max(1, Math.round((style.max - style.min) / style.interval));
      const bin = value < style.min ? 0 : value > style.max ? steps + 1 : Math.min(steps, Math.floor((value - style.min) / style.interval) + 1);
      ratio = bin / (steps + 1);
    }
    const scaled = (Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : .5) * (ramp.length - 1);
    const index = Math.min(ramp.length - 2, Math.floor(scaled)), amount = scaled - index, start = ramp[index], end = ramp[index + 1];
    const red = Math.round(start[0] + (end[0] - start[0]) * amount), green = Math.round(start[1] + (end[1] - start[1]) * amount), blue = Math.round(start[2] + (end[2] - start[2]) * amount);
    const key = red * 65536 + green * 256 + blue;
    let result = cache.get(key); if (!result) { result = [red, green, blue]; cache.set(key, result); }
    return result;
  };
}

type Source = { points: readonly InsarPoint[]; index: SpatialGridIndex<InsarPoint>; anchor: [number, number]; positions: Float32Array };
type Batch = { source: Source; positions: Float32Array; colors: Uint8Array; count: number; radius: number; stroke: Rgba; strokeWidth: number; dashed: boolean; color: (point: InsarPoint) => Color; opacity: (point: InsarPoint) => number; accept?: (point: InsarPoint) => boolean; clip?: "left" | "right" };
export type FullPointRendererStatus = "webgl" | "canvas" | "unavailable";
export type FullPointLayerState = {
  points: InsarPoint[]; index: SpatialGridIndex<InsarPoint>; livePoints: InsarPoint[];
  renderStyle: RenderStyle; pointSize: number; coherenceThreshold: number;
  visible: { points: boolean; risk: boolean; quality: boolean };
  priorityIds: ReadonlySet<string>; limitedIds: ReadonlySet<string>;
  boxIds: ReadonlySet<string>; compareIds: ReadonlySet<string>; selectedId: string | null;
  highlightKind: "region" | "filter" | "anomaly";
};
const velocityStyle: RenderStyle = { attribute: "velocity", min: -12.5, max: 12.5, interval: 2.5, colors: [...INSAR_RED_GREEN_COLORS], timeIndex: 0, rangeStart: 0, rangeEnd: 0 };
const VERTEX = `attribute vec2 a_position; attribute vec4 a_color; uniform vec2 u_origin; uniform vec2 u_view; uniform float u_scale; uniform mediump float u_size; varying mediump vec4 v_color;
void main(){ vec2 pixel=(a_position-u_origin)*u_scale; gl_Position=vec4(pixel.x/u_view.x*2.0-1.0,1.0-pixel.y/u_view.y*2.0,0.0,1.0); gl_PointSize=u_size; v_color=a_color; }`;
const FRAGMENT = `precision mediump float; varying mediump vec4 v_color; uniform vec4 u_stroke; uniform mediump float u_size; uniform float u_strokeWidth; uniform float u_dashed;
void main(){
  vec2 p=gl_PointCoord-vec2(0.5); float d=length(p)*u_size; float radius=u_size*0.5;
  if(d>radius)discard;
  float fillAlpha=d<=radius-u_strokeWidth*0.5?v_color.a:0.0;
  bool stroke=d>radius-u_strokeWidth;
  if(stroke&&u_dashed>0.5&&mod(atan(p.y,p.x)+3.141593,0.7)>0.4)stroke=false;
  if(stroke){float alpha=u_stroke.a+fillAlpha*(1.0-u_stroke.a);vec3 rgb=(u_stroke.rgb*u_stroke.a+v_color.rgb*fillAlpha*(1.0-u_stroke.a))/max(alpha,0.0001);gl_FragColor=vec4(rgb,alpha);}
  else{if(fillAlpha<=0.0)discard;gl_FragColor=vec4(v_color.rgb,fillAlpha);}
}`;

/** One Leaflet-pane surface for every point and point highlight. No point sampling. */
export class FullPointLayer {
  private canvas!: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private program: WebGLProgram | null = null;
  private buffers = new Map<Float32Array | Uint8Array, WebGLBuffer>();
  private batches: Batch[] = [];
  private hoverBatch: Batch | null = null;
  private hoverPoint: InsarPoint | null = null;
  private baseCache = new Map<string, { points: readonly InsarPoint[]; styleKey: string; batch: Batch }>();
  private primary: Source | null = null;
  private live: Source | null = null;
  private state: FullPointLayerState | null = null;
  private frame = 0;
  private swipe = { active: false, position: 50 };
  private removed = false;
  constructor(private readonly map: LeafletMap, private readonly onStatus?: (status: FullPointRendererStatus) => void) {
    this.createSurface(true);
    map.on("move zoom resize viewreset zoomend moveend", this.schedule);
  }
  private createSurface(preferWebGl: boolean) {
    this.canvas?.removeEventListener("webglcontextlost", this.contextLost);
    this.canvas?.remove();
    this.canvas = document.createElement("canvas");
    this.canvas.className = "leaflet-full-point-layer leaflet-zoom-hide";
    this.canvas.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:1";
    this.canvas.setAttribute("aria-hidden", "true");
    this.map.getPane("overlayPane")?.appendChild(this.canvas);
    this.gl = null; this.context = null; this.program = null;
    if (preferWebGl) {
      try {
        this.gl = this.canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
        if (this.gl) this.initializeGl();
      } catch { this.gl = null; }
      if (!this.gl) {
        // A canvas that acquired a WebGL context cannot acquire a 2D context.
        this.createSurface(false); return;
      }
    } else { try { this.context = this.canvas.getContext("2d"); } catch { this.context = null; } }
    const status: FullPointRendererStatus = this.gl ? "webgl" : this.context ? "canvas" : "unavailable";
    this.canvas.dataset.renderer = status; this.onStatus?.(status);
    this.canvas.addEventListener("webglcontextlost", this.contextLost);
  }
  private initializeGl() {
    const gl = this.gl!;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type); if (!shader) throw new Error("Point shader unavailable");
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error("Point shader compilation failed"); }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX), fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT), program = gl.createProgram();
    if (!program) throw new Error("Point renderer unavailable");
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); throw new Error("Point renderer linking failed"); }
    this.program = program;
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  private contextLost = (event: Event) => {
    event.preventDefault(); this.useCanvasFallback();
  };
  private useCanvasFallback() {
    for (const buffer of this.buffers.values()) this.gl?.deleteBuffer(buffer);
    if (this.program) this.gl?.deleteProgram(this.program);
    this.buffers.clear(); this.baseCache.clear();
    if (this.primary) this.primary.positions = new Float32Array(0);
    if (this.live) this.live.positions = new Float32Array(0);
    this.createSurface(false); this.rebuildBatches(); this.schedule();
  }
  private makeSource(points: readonly InsarPoint[], index: SpatialGridIndex<InsarPoint>): Source {
    const bounds = pointDataBounds(points), anchor = bounds ? projectPointWorld((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2) : [0, 0] as [number, number];
    const positions = new Float32Array(this.gl ? points.length * 2 : 0);
    for (let i = 0; this.gl && i < points.length; i += 1) {
      const point = points[i], latitude = Math.max(-85.0511287798, Math.min(85.0511287798, point.lat)), sine = Math.sin(latitude * Math.PI / 180);
      positions[i * 2] = (point.lon + 180) / 360 - anchor[0];
      positions[i * 2 + 1] = .5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI) - anchor[1];
    }
    return { points, index, anchor, positions };
  }
  update(state: FullPointLayerState) {
    this.state = state;
    if (this.primary?.points !== state.points) {
      this.baseCache.clear();
      const previous = this.primary;
      let unchanged = previous?.points.length === state.points.length;
      if (unchanged && previous) for (let i = 0; i < state.points.length; i += 1) if (previous.points[i] !== state.points[i]) { unchanged = false; break; }
      if (unchanged && previous) { previous.points = state.points; previous.index = state.index; }
      else this.primary = this.makeSource(state.points, state.index);
    }
    if (this.live?.points !== state.livePoints) this.live = this.makeSource(state.livePoints, new SpatialGridIndex<InsarPoint>().load(state.livePoints));
    this.rebuildBatches(); this.schedule();
  }
  setHover(point: InsarPoint | null, radius = 6) {
    if (this.hoverPoint === point && (!point || this.hoverBatch?.radius === radius)) return;
    if (this.hoverBatch) for (const data of [this.hoverBatch.positions, this.hoverBatch.colors]) {
      const buffer = this.buffers.get(data); if (buffer) this.gl?.deleteBuffer(buffer); this.buffers.delete(data);
    }
    this.hoverPoint = point; this.hoverBatch = null;
    if (point) {
      const source = this.makeSource([point], new SpatialGridIndex<InsarPoint>().load([point]));
      this.hoverBatch = this.makeBatch(source, radius, [.027, .102, .22, 1], 2.2, () => parseColor("#ffffff"), () => .18);
    }
    this.schedule();
  }
  setSwipe(active: boolean, position: number) {
    const changed = active !== this.swipe.active;
    this.swipe = { active, position: Math.max(0, Math.min(100, position)) };
    if (changed) this.rebuildBatches();
    this.schedule();
  }
  private makeBatch(source: Source, radius: number, stroke: Rgba, strokeWidth: number, color: (point: InsarPoint) => Color, opacity: (point: InsarPoint) => number, accept?: (point: InsarPoint) => boolean, dashed = false, clip?: "left" | "right"): Batch {
    let count = source.points.length;
    if (accept) { count = 0; for (const point of source.points) if (accept(point)) count += 1; }
    const positions = this.gl && accept ? new Float32Array(count * 2) : source.positions, colors = new Uint8Array(this.gl ? count * 4 : 0);
    let next = 0;
    for (let i = 0; this.gl && i < source.points.length; i += 1) {
      const point = source.points[i]; if (accept && !accept(point)) continue;
      if (accept) { positions[next * 2] = source.positions[i * 2]; positions[next * 2 + 1] = source.positions[i * 2 + 1]; }
      const rgb = color(point); colors[next * 4] = rgb[0]; colors[next * 4 + 1] = rgb[1]; colors[next * 4 + 2] = rgb[2]; colors[next * 4 + 3] = Math.round(opacity(point) * 255); next += 1;
    }
    return { source, positions, colors, count, radius, stroke, strokeWidth, color, opacity, accept, dashed, clip };
  }
  private cachedBase(key: string, styleKey: string, source: Source, radius: number, stroke: Rgba, color: (point: InsarPoint) => Color, opacity: (point: InsarPoint) => number, clip?: "left" | "right") {
    const old = this.baseCache.get(key);
    if (old && old.points === source.points && old.styleKey === styleKey && old.batch.source.positions === source.positions) {
      return { ...old.batch, source, radius, stroke, color, opacity, clip };
    }
    const batch = this.makeBatch(source, radius, stroke, 1, color, opacity, undefined, false, clip);
    this.baseCache.set(key, { points: source.points, styleKey, batch });
    return batch;
  }
  private rebuildBatches() {
    if (!this.state || !this.primary || !this.live) return;
    const s = this.state, source = this.primary, size = Math.max(1, s.pointSize), batches: Batch[] = [];
    const palette = paletteFor(s.renderStyle), modeColor = (p: InsarPoint) => parseColor(colorForMode(p.mode));
    const baseColor = s.renderStyle.attribute === "mode" ? modeColor : (p: InsarPoint) => palette(renderValue(p, s.renderStyle));
    const baseOpacity = s.renderStyle.attribute === "mode" ? (p: InsarPoint) => patternPointOpacity(p.mode) : () => .94;
    const white: Rgba = [1, 1, 1, .78], dark: Rgba = [.027, .102, .22, 1];
    if (s.visible.points) {
      if (this.swipe.active) {
        const velocityPalette = paletteFor(velocityStyle);
        batches.push(this.cachedBase("swipe-left", "velocity", source, Math.max(3, size + .75), white, p => velocityPalette(p.velocity), () => .96, "left"));
        batches.push(this.cachedBase("swipe-right", "mode", source, Math.max(3, size + .75), white, modeColor, p => Math.max(.72, patternPointOpacity(p.mode)), "right"));
      } else batches.push(this.cachedBase("base", JSON.stringify(s.renderStyle), source, size, white, baseColor, baseOpacity));
    }
    if (s.visible.risk) {
      batches.push(this.makeBatch(source, size + 5, [.914, .294, .294, 1], 1.8, () => parseColor("#e94b4b"), () => .12, p => s.priorityIds.has(p.id) && !s.limitedIds.has(p.id)));
      batches.push(this.makeBatch(source, size + 5, [.961, .62, .043, 1], 2, () => parseColor("#f59e0b"), () => .04, p => s.priorityIds.has(p.id) && s.limitedIds.has(p.id), true));
    }
    if (s.visible.quality) batches.push(this.makeBatch(source, size + 3, [1, .729, .031, 1], 2, () => parseColor("#ffba08"), () => 0, p => (p.coherence > 0 && p.coherence < s.coherenceThreshold) || p.missingRate > .2, true));
    if (this.live.points.length) batches.push(this.makeBatch(this.live, size + 1, [1, 1, 1, 1], 1.8, modeColor, () => 1));
    if (s.visible.points) {
      const anomaly = s.highlightKind === "anomaly", boxPalette = anomaly ? (p: InsarPoint) => palette(renderValue(p, s.renderStyle)) : () => parseColor(s.highlightKind === "filter" ? "#58a6ff" : "#ffd22e");
      const stroke: Rgba = anomaly ? [.839, .184, .184, 1] : s.highlightKind === "filter" ? [.027, .337, .788, 1] : [.478, .29, 0, 1];
      if (s.boxIds.size) batches.push(this.makeBatch(source, size + (anomaly ? 3 : 2), stroke, anomaly ? 2.2 : 1.5, boxPalette, () => anomaly ? .96 : 1, p => s.boxIds.has(p.id) && !(anomaly && s.limitedIds.has(p.id))));
      if (anomaly && s.boxIds.size) batches.push(this.makeBatch(source, size + 3, [.82, .549, .141, 1], 2.2, boxPalette, () => .96, p => s.boxIds.has(p.id) && s.limitedIds.has(p.id), true));
      if (s.compareIds.size) batches.push(this.makeBatch(source, size + 3, dark, 2.5, () => parseColor("#fff36d"), () => .94, p => s.compareIds.has(p.id) && !s.boxIds.has(p.id)));
      if (s.selectedId && !s.boxIds.has(s.selectedId) && !s.compareIds.has(s.selectedId)) batches.push(this.makeBatch(source, size + 4, dark, 2.5, () => parseColor("#ffd22e"), () => .94, p => p.id === s.selectedId));
    }
    this.batches = batches.filter(batch => batch.count > 0);
    const retained = new Set<Float32Array | Uint8Array>();
    for (const batch of this.hoverBatch ? this.batches.concat(this.hoverBatch) : this.batches) { retained.add(batch.positions); retained.add(batch.colors); }
    if (this.hoverBatch) { retained.add(this.hoverBatch.positions); retained.add(this.hoverBatch.colors); }
    for (const [data, buffer] of this.buffers) if (!retained.has(data)) { this.gl?.deleteBuffer(buffer); this.buffers.delete(data); }
  }
  private schedule = () => { if (!this.removed && !this.frame) this.frame = requestAnimationFrame(this.draw); };
  private viewportBounds(padding = 0): GisBounds {
    const size = this.map.getSize(), top = this.map.containerPointToLatLng([-padding, -padding]), bottom = this.map.containerPointToLatLng([size.x + padding, size.y + padding]);
    return { west: Math.min(top.lng, bottom.lng), east: Math.max(top.lng, bottom.lng), south: Math.min(top.lat, bottom.lat), north: Math.max(top.lat, bottom.lat) };
  }
  private upload(data: Float32Array | Uint8Array) {
    const gl = this.gl!;
    let buffer = this.buffers.get(data);
    if (!buffer) { buffer = gl.createBuffer() ?? undefined; if (!buffer) throw new Error("Point buffer unavailable"); this.buffers.set(data, buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); }
    else gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  }
  private draw = () => {
    this.frame = 0;
    if (this.removed) return;
    const size = this.map.getSize(), ratio = Math.min(window.devicePixelRatio || 1, 2), width = Math.max(1, Math.round(size.x * ratio)), height = Math.max(1, Math.round(size.y * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; this.canvas.style.width = `${size.x}px`; this.canvas.style.height = `${size.y}px`; }
    const origin = this.map.containerPointToLayerPoint([0, 0]);
    this.canvas.style.transform = `translate3d(${origin.x}px,${origin.y}px,0)`;
    let visibleCount = 0;
    this.primary?.index.forEachInBounds(this.viewportBounds(), () => { visibleCount += 1; });
    this.canvas.dataset.totalPoints = String(this.primary?.points.length ?? 0);
    this.canvas.dataset.visiblePoints = String(visibleCount);
    if (this.gl && this.program) {
      try { this.drawGl(size.x, size.y, ratio); } catch { this.useCanvasFallback(); }
    } else this.drawCanvas(size.x, size.y, ratio);
  };
  private drawGl(width: number, height: number, ratio: number) {
    const gl = this.gl!, program = this.program!, origin = this.map.getPixelOrigin(), topLeft = this.map.containerPointToLayerPoint([0, 0]), scale = 256 * 2 ** this.map.getZoom(), world = [(origin.x + topLeft.x) / scale, (origin.y + topLeft.y) / scale];
    gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(program);
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    gl.uniform2f(uniform("u_view"), width, height); gl.uniform1f(uniform("u_scale"), 256 * 2 ** this.map.getZoom());
    const position = gl.getAttribLocation(program, "a_position"), color = gl.getAttribLocation(program, "a_color");
    gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(color);
    const divider = Math.round(this.canvas.width * this.swipe.position / 100);
    for (const batch of this.hoverBatch ? this.batches.concat(this.hoverBatch) : this.batches) {
      if (batch.clip) { gl.enable(gl.SCISSOR_TEST); gl.scissor(batch.clip === "left" ? 0 : divider, 0, batch.clip === "left" ? divider : this.canvas.width - divider, this.canvas.height); }
      else gl.disable(gl.SCISSOR_TEST);
      gl.uniform2f(uniform("u_origin"), world[0] - batch.source.anchor[0], world[1] - batch.source.anchor[1]);
      // Canvas strokes are centered on the radius; include their outer half in the GL glyph.
      gl.uniform1f(uniform("u_size"), (batch.radius * 2 + batch.strokeWidth) * ratio); gl.uniform1f(uniform("u_strokeWidth"), batch.strokeWidth * ratio); gl.uniform1f(uniform("u_dashed"), batch.dashed ? 1 : 0);
      gl.uniform4f(uniform("u_stroke"), batch.stroke[0], batch.stroke[1], batch.stroke[2], batch.stroke[3]);
      this.upload(batch.positions); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      this.upload(batch.colors); gl.vertexAttribPointer(color, 4, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.drawArrays(gl.POINTS, 0, batch.count);
    }
    gl.disable(gl.SCISSOR_TEST);
  }
  private drawCanvas(width: number, height: number, ratio: number) {
    const ctx = this.context; if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    for (const batch of this.hoverBatch ? this.batches.concat(this.hoverBatch) : this.batches) {
      ctx.save();
      if (batch.clip) { const divider = width * this.swipe.position / 100; ctx.beginPath(); ctx.rect(batch.clip === "left" ? 0 : divider, 0, batch.clip === "left" ? divider : width - divider, height); ctx.clip(); }
      ctx.lineWidth = batch.strokeWidth; ctx.strokeStyle = `rgba(${Math.round(batch.stroke[0] * 255)},${Math.round(batch.stroke[1] * 255)},${Math.round(batch.stroke[2] * 255)},${batch.stroke[3]})`; ctx.setLineDash(batch.dashed ? [3, 2] : []);
      batch.source.index.forEachInBounds(this.viewportBounds(batch.radius), point => {
        if (batch.accept && !batch.accept(point)) return;
        const pixel = this.map.latLngToContainerPoint([point.lat, point.lon]), color = batch.color(point);
        ctx.beginPath(); ctx.arc(pixel.x, pixel.y, batch.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${batch.opacity(point)})`; ctx.fill(); ctx.stroke();
      });
      ctx.restore();
    }
  }
  destroy() {
    this.removed = true; this.map.off("move zoom resize viewreset zoomend moveend", this.schedule);
    if (this.frame) cancelAnimationFrame(this.frame);
    for (const buffer of this.buffers.values()) this.gl?.deleteBuffer(buffer);
    if (this.program) this.gl?.deleteProgram(this.program);
    this.buffers.clear(); this.baseCache.clear(); this.canvas.removeEventListener("webglcontextlost", this.contextLost); this.canvas.remove();
  }
}