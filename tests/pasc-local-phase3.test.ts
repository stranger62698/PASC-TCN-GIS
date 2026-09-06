import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseAndPreprocessLocalCsv,
  preprocessTimeSeries,
  savgolFilter9x3,
} from "../app/lib/pasc-local-preprocess";

type NativeGolden = {
  request: {
    mapping: { dateColumns: string[] };
    settings: { preprocessingState: "already_smoothed" };
    records: Array<Record<string, number | string>>;
  };
  expected: Array<{
    normalizedSeries: number[];
    featuresScaled: number[];
    velocityMmPerYear: number;
    coherence: number;
  }>;
};

function maximumDifference(actual: ArrayLike<number>, expected: ArrayLike<number>) {
  let maximum = 0;
  for (let index = 0; index < actual.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(Number(actual[index]) - Number(expected[index])));
  }
  return maximum;
}

test("Phase 3 preprocessTimeSeries reuses the frozen native-248 golden contract", () => {
  const fixture = JSON.parse(readFileSync("pasc-tcn-service/tests/fixtures/native248_golden.json", "utf8")) as NativeGolden;
  const origin = Date.parse(fixture.request.mapping.dateColumns[0].slice(1, 5) + "-" + fixture.request.mapping.dateColumns[0].slice(5, 7) + "-" + fixture.request.mapping.dateColumns[0].slice(7, 9) + "T00:00:00Z");
  const sourceDays = Float32Array.from(fixture.request.mapping.dateColumns, field => {
    const timestamp = Date.parse(field.slice(1, 5) + "-" + field.slice(5, 7) + "-" + field.slice(7, 9) + "T00:00:00Z");
    return (timestamp - origin) / 86_400_000;
  });
  const years = Float32Array.from(sourceDays, day => Math.fround(day / 365.25));
  fixture.request.records.forEach((record, index) => {
    const actual = preprocessTimeSeries({
      sourceDays,
      sourceValues: Float32Array.from(fixture.request.mapping.dateColumns, field => Number(record[field])),
      targetDays: sourceDays,
      years,
      velocity: Number(record.Vel),
      coherence: Number(record.coherence),
      preprocessingState: "already_smoothed",
    });
    assert.ok(maximumDifference(actual.normalizedSeries, fixture.expected[index].normalizedSeries) <= 2e-5);
    assert.ok(maximumDifference(actual.scaledPhysics, fixture.expected[index].featuresScaled) <= 2e-5);
  });
});

test("Phase 3 SG implementation preserves a cubic sequence under the frozen 9x3 filter", () => {
  const cubic = Float32Array.from({ length: 20 }, (_, index) => index ** 3 - 2 * index ** 2 + 4 * index - 7);
  const filtered = savgolFilter9x3(cubic);
  assert.ok(maximumDifference(filtered, cubic) <= 1e-3);
});

test("Phase 3 CSV path streams a File into typed arrays without File.text", async () => {
  const dates = Array.from({ length: 20 }, (_, index) => {
    const date = new Date(Date.UTC(2024, 0, 1 + index * 12));
    return "D" + date.toISOString().slice(0, 10).replaceAll("-", "");
  });
  const header = ["fid", "xpos", "ypos", "Vel", "coherence", ...dates].join(",");
  const row = ["p-1", "110.2", "20.1", "-8", "0.9", ...dates.map((_, index) => String(-index))].join(",");
  const file = new File([header + "\n" + row + "\n"], "local.csv", { type: "text/csv" });
  const data = await parseAndPreprocessLocalCsv(
    file,
    { displacementUnit: "mm", velocityUnit: "mm/year", signConvention: "subsidence_negative", preprocessingState: "raw" },
    () => undefined,
    () => false,
  );
  assert.equal(data.pointIds[0], "p-1");
  assert.equal(data.timeSteps, 20);
  assert.ok(data.series instanceof Float32Array);
  assert.ok(data.physics instanceof Float32Array);
});

test("Local quick validation stops after the requested number of valid points", async () => {
  const dates = Array.from({ length: 20 }, (_, index) => {
    const date = new Date(Date.UTC(2024, 0, 1 + index * 12));
    return "D" + date.toISOString().slice(0, 10).replaceAll("-", "");
  });
  const header = ["fid", "xpos", "ypos", "Vel", "coherence", ...dates].join(",");
  const rows = Array.from({ length: 8 }, (_, rowIndex) => [
    `p-${rowIndex + 1}`,
    String(110.2 + rowIndex * 0.001),
    "20.1",
    "-8",
    "0.9",
    ...dates.map((_, index) => String(-index - rowIndex)),
  ].join(","));
  const file = new File([[header, ...rows].join("\n")], "quick.csv", { type: "text/csv" });
  const data = await parseAndPreprocessLocalCsv(
    file,
    { displacementUnit: "mm", velocityUnit: "mm/year", signConvention: "subsidence_negative", preprocessingState: "raw" },
    () => undefined,
    () => false,
    3,
  );
  assert.deepEqual(data.pointIds, ["p-1", "p-2", "p-3"]);
  assert.equal(data.totalRows, 3);
});

test("Phase 3 Worker contract is local, cancellable, typed, and batched", () => {
  const worker = readFileSync("app/workers/pasc-local.worker.ts", "utf8");
  const component = readFileSync("app/components/PascLocalPrototype.tsx", "utf8");
  assert.match(worker, /type === "CANCEL"/);
  assert.match(worker, /type: "BATCH_DONE"/);
  assert.match(worker, /for \(let offset = 0; offset < total; offset \+= message\.batchSize\)/);
  assert.match(worker, /new Uint8Array\(total\)/);
  assert.match(worker, /new Float32Array\(total\)/);
  assert.match(component, /type="file"/);
  assert.match(component, /new Worker\(PASC_LOCAL_WORKER_URL/);
  assert.match(component, /worker\.postMessage\(request\)/);
  assert.doesNotMatch(component, /file\.text\(\)/);
  assert.doesNotMatch(worker, /meta\.json|@vercel\/blob|\bput\(/i);
  assert.doesNotMatch(component, /fetch\(|XMLHttpRequest/);
});
