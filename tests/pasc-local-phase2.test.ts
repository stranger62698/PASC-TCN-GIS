import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calibratePascProbabilities,
  maximumIndex,
  stableSoftmaxRow,
  validatePascLocalFixture,
} from "../app/lib/pasc-local-onnx";

test("Phase 2 browser probability and confidence definitions stay frozen", () => {
  const raw = stableSoftmaxRow([1, 2, 3, 4, 5, 6]);
  const calibrated = calibratePascProbabilities(raw, [2, 3, 4], 1.35);
  const total = Array.from(calibrated).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-6);
  assert.equal(maximumIndex(calibrated), 5);
  assert.equal(Math.max(...calibrated), calibrated[5]);
});

test("Phase 2 fixture contract requires the four formal validation counts", () => {
  assert.throws(
    () => validatePascLocalFixture({ schemaVersion: "pasc-browser-parity-v1" }),
    /fixture/,
  );
});

test("Phase 2 module loads one model, caches one engine, prefers WebGPU, and falls back to WASM", () => {
  const engine = readFileSync("app/lib/pasc-local-engine.ts", "utf8");
  assert.match(engine, /let enginePromise: Promise<PascLocalEngine> \| null = null/);
  assert.match(engine, /if \(enginePromise\) return enginePromise/);
  assert.match(engine, /modelResponse\.arrayBuffer\(\)/);
  assert.match(engine, /createAndWarmSession\(\s*"webgpu"/);
  assert.match(engine, /createAndWarmSession\("wasm"/);
  assert.ok(engine.indexOf('"webgpu"') < engine.lastIndexOf('"wasm"'));
  assert.match(engine, /sessionCreateCount: 1/);
  assert.match(engine, /for \(let offset = 0; offset < count; offset \+= fixture\.batchSize\)/);
});

test("Phase 2 provider remains debug-only after the Phase 3 UI replaces the proof screen", () => {
  const component = readFileSync("app/components/PascLocalPrototype.tsx", "utf8");
  assert.match(component, /LOCAL \/ NO UPLOAD/);
  assert.match(component, /console\.debug/);
  assert.doesNotMatch(component, />\s*WebGPU\s*</);
  assert.doesNotMatch(component, />\s*WASM\s*</);
});

test("Phase 2 private artifacts are served only by the local development server", () => {
  const config = readFileSync("vite.config.ts", "utf8");
  assert.match(config, /apply: "serve"/);
  assert.match(config, /artifacts\/pasc-tcn\.onnx/);
  assert.match(config, /Cache-Control", "no-store"/);
  assert.match(config, /X-Robots-Tag", "noindex, nofollow"/);
  assert.doesNotMatch(config, /public\/models\/pasc-tcn/);
});
