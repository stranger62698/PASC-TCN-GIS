import test from "node:test";
import assert from "node:assert/strict";
import { sampleRouteDirectionArrows } from "../app/lib/roadops-map-guidance";

const viewport = { width: 500, height: 300 };
test("direction follows actual polyline order and changes on bends", () => {
  const arrows = sampleRouteDirectionArrows([{ x: 0, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 250 }], viewport, 100);
  assert.deepEqual(arrows, [
    { x: 50, y: 50, angleDegrees: 0 }, { x: 150, y: 50, angleDegrees: 0 },
    { x: 200, y: 100, angleDegrees: 90 }, { x: 200, y: 200, angleDegrees: 90 },
  ]);
  assert.equal(sampleRouteDirectionArrows([{ x: 200, y: 50 }, { x: 0, y: 50 }], viewport, 100)[0].angleDegrees, 180);
});
test("screen-space sampling excludes off-screen spans and caps marker count", () => {
  const arrows = sampleRouteDirectionArrows([{ x: -1e9, y: 50 }, { x: 1e9, y: 50 }], viewport, 100);
  assert.equal(arrows.length, 5);
  assert.ok(arrows.every(arrow => arrow.x >= 0 && arrow.x <= 500));
  assert.equal(sampleRouteDirectionArrows([{ x: 0, y: 50 }, { x: 500, y: 50 }], viewport, 100, 2).length, 2);
  assert.deepEqual(sampleRouteDirectionArrows([{ x: -400, y: -30 }, { x: 400, y: -30 }], viewport), []);
});
test("zero-length vertices and malformed parameters cannot fabricate arrows", () => {
  assert.deepEqual(sampleRouteDirectionArrows([{ x: 5, y: 5 }, { x: 5, y: 5 }], viewport), []);
  assert.deepEqual(sampleRouteDirectionArrows([{ x: NaN, y: 5 }, { x: 400, y: 5 }], viewport), []);
  assert.deepEqual(sampleRouteDirectionArrows([{ x: 0, y: 5 }, { x: 400, y: 5 }], viewport, 0), []);
  assert.deepEqual(sampleRouteDirectionArrows([{ x: 0, y: 5 }, { x: 400, y: 5 }], viewport, 100, 0), []);
});
test("sampling continues through vertices without duplicate arrow positions", () => {
  const arrows = sampleRouteDirectionArrows([{ x: 0, y: 50 }, { x: 50, y: 50 }, { x: 200, y: 50 }], viewport, 100);
  assert.deepEqual(arrows.map(arrow => arrow.x), [50, 150]);
});
