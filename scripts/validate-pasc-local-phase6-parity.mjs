import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const pytorch = JSON.parse(await readFile(resolve("artifacts/pasc-tcn-parity.json"), "utf8"));
const browsers = JSON.parse(await readFile(resolve("artifacts/pasc-tcn-phase2-browser-results.json"), "utf8"));
assert.equal(pytorch.passed, true);
assert.equal(pytorch.metrics.classAgreementRate, 1);
assert.ok(pytorch.metrics.calibratedProbabilityMaxAbsDiff <= pytorch.tolerances.probabilityMaxAbsDiff);
assert.ok(pytorch.metrics.confidenceMaxAbsDiff <= pytorch.tolerances.probabilityMaxAbsDiff);
for (const browser of browsers.browsers) {
  assert.equal(browser.sessionCreateCount, 1);
  assert.ok(browser.levels.every(level => level.includes("PASS")));
}
const result = { schemaVersion: "pasc-local-phase6-parity-v1", modelVersion: pytorch.modelVersion, samples: pytorch.metrics.sampleCount, pytorchVsOnnxClassAgreement: pytorch.metrics.classAgreementRate, calibratedProbabilityMaxAbsDiff: pytorch.metrics.calibratedProbabilityMaxAbsDiff, confidenceMaxAbsDiff: pytorch.metrics.confidenceMaxAbsDiff, probabilityTolerance: pytorch.tolerances.probabilityMaxAbsDiff, browserProviders: browsers.browsers.map(browser => ({ browser: browser.browser, provider: browser.provider, levelsPassed: browser.levels.length, sessionCreateCount: browser.sessionCreateCount })), passed: true };
await writeFile(resolve("artifacts/pasc-tcn-phase6-parity-results.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify(result, null, 2));
