import assert from "node:assert/strict";
import test from "node:test";
import { cloneSvgForExport } from "../app/lib/analysis-exports";

Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, writable: true, value: () => { throw new Error("Unmocked computed style"); } });

// The fixture supplies browser-resolved styles separately from SVG attributes,
// reproducing a curve whose fill comes only from a surrounding page selector.
class SvgFixture {
  attributes = new Map<string, string>();
  properties = new Map<string, string>();
  computed: Record<string, string> = {};
  children: SvgFixture[] = [];
  style = {
    setProperty: (key: string, value: string) => { this.properties.set(key, value); },
    removeProperty: (key: string) => { this.properties.delete(key); },
  };
  viewBox = { baseVal: { x: 0, y: 0, width: 400, height: 260 } };
  bounds = { x: -4, y: 0, width: 414, height: 260 };
  getBoundingClientRect() { return { width: 350, height: 228 }; }
  getBBox() { return this.bounds; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  querySelectorAll(selector: string): SvgFixture[] { return selector === "*" ? this.children.flatMap(child => [child, ...child.querySelectorAll("*")]) : []; }
  cloneNode() {
    const clone = new SvgFixture();
    clone.attributes = new Map(this.attributes); clone.properties = new Map(this.properties);
    clone.children = this.children.map(child => child.cloneNode());
    return clone;
  }
}

test("PNG SVG snapshot retains CSS-only no-fill curves, colors, and translucent regions", context => {
  context.mock.method(globalThis, "getComputedStyle", (node: SvgFixture) => ({ getPropertyValue: (key: string) => node.computed[key] || "" }));
  const svg = new SvgFixture(), curve = new SvgFixture(), region = new SvgFixture(), label = new SvgFixture();
  curve.computed = { fill: "none", stroke: "rgb(22, 119, 255)", "stroke-width": "1.8px", "vector-effect": "non-scaling-stroke" };
  region.computed = { fill: "rgb(22, 119, 255)", "fill-opacity": "0.12" };
  label.computed = { fill: "rgb(80, 96, 118)", "font-size": "13px", "font-family": "Arial", "text-anchor": "end" };
  svg.children = [curve, region, label];
  const result = cloneSvgForExport(svg as unknown as SVGSVGElement);
  const copies = (result.clone as unknown as SvgFixture).children;
  assert.equal(copies[0].properties.get("fill"), "none");
  assert.equal(copies[0].properties.get("stroke"), "rgb(22, 119, 255)");
  assert.equal(copies[0].properties.get("stroke-width"), "1.8px");
  assert.equal(copies[1].properties.get("fill-opacity"), "0.12");
  assert.equal(copies[2].properties.get("font-size"), "13px");
  assert.equal(copies[2].properties.get("text-anchor"), "end");
  assert.equal(curve.properties.size, 0, "Export must not mutate the displayed chart");
});

test("PNG bounds include overflowing axis labels and remove page-specific width", context => {
  context.mock.method(globalThis, "getComputedStyle", () => ({ getPropertyValue: () => "" }));
  const svg = new SvgFixture();
  svg.style.setProperty("width", "100%");
  const { clone, width, height } = cloneSvgForExport(svg as unknown as SVGSVGElement);
  const copy = clone as unknown as SvgFixture;
  assert.equal(copy.attributes.get("viewBox"), "-12 -8 430 276");
  assert.equal(width, 430); assert.equal(height, 276);
  assert.equal(copy.properties.has("width"), false);
  assert.equal(svg.properties.get("width"), "100%");
});

test("Detached charts still export from the viewBox", context => {
  context.mock.method(globalThis, "getComputedStyle", () => ({ getPropertyValue: () => "" }));
  const svg = new SvgFixture();
  svg.getBBox = () => { throw new Error("Detached SVG"); };
  const result = cloneSvgForExport(svg as unknown as SVGSVGElement);
  assert.equal(result.width, 416); assert.equal(result.height, 276);
});
