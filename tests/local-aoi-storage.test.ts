import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateStoredAoi, validateStoredAoi } from "../app/lib/local-aoi-storage";
import { aggregateLocalMatrix, type LocalAoiRequest } from "../app/lib/local-analysis-compute";
import { encodeLocalSeriesRows, localSeriesRecordBytes } from "../app/lib/local-series-store";
const dates = ["d1","d2","d3","d4"];
const processed = Float32Array.from([1,NaN,3,9,4,2,5,8,7,6,NaN,7,10,8,9,6]);
const blob = new Blob([encodeLocalSeriesRows(processed, new Float32Array(16), new Uint8Array(16), 4, 4, 4)]);
const input = (method: "mean" | "median"): LocalAoiRequest => ({ rows: Uint32Array.from([3,0,2]), modes: ["A","B","A"], dates, method, storage: {kind:"opfs",directory:"x",fileName:"x",pointCount:4,timeSteps:4,observedEpochs:4,recordBytes:localSeriesRecordBytes(4,4)} });
test("date-block exact median equals full matrix with missing values and non-source row order", async () => {
  const request = input("median"), full = new Float32Array(12);
  request.rows.forEach((row,index) => full.set(processed.subarray(row*4,row*4+4),index*4));
  assert.deepEqual(await aggregateStoredAoi(request,blob,12),aggregateLocalMatrix(full,request.modes,dates,"median"));
});
test("streaming exact mean includes every selected row and preserves group sizes",async () => {
  const request=input("mean"),full=new Float32Array(12);
  request.rows.forEach((row,index)=>full.set(processed.subarray(row*4,row*4+4),index*4));
  assert.deepEqual(await aggregateStoredAoi(request,blob),aggregateLocalMatrix(full,request.modes,dates,"mean"));
});
test("invalid layout, mismatched mode count, duplicate and absent rows reject rather than skip",()=>{
  const request=input("median");
  assert.throws(()=>validateStoredAoi({...request,storage:{...request.storage!,recordBytes:999}},blob));
  assert.throws(()=>validateStoredAoi({...request,modes:[]},blob));
  assert.throws(()=>validateStoredAoi({...request,rows:Uint32Array.from([0,0,2])},blob));
  assert.throws(()=>validateStoredAoi({...request,rows:Uint32Array.from([0,5,2])},blob));
  assert.throws(()=>validateStoredAoi({...request,storage:{...request.storage!,observedEpochs:0}},blob));
});

test("observed aggregation uses original dates and masks instead of model-interpolated values", async () => {
  const original = Float32Array.from([1, 99, 3, 5, 7, 9]), mask = Uint8Array.from([1,0,1,1,1,0]);
  const source = new Blob([encodeLocalSeriesRows(new Float32Array(8).fill(999),original,mask,2,4,3)]);
  const request: LocalAoiRequest = {kind:"observed",rows:Uint32Array.from([0,1]),modes:["A","A"],dates:["o1","o2","o3"],method:"median",storage:{kind:"opfs",directory:"x",fileName:"x",pointCount:2,timeSteps:4,observedEpochs:3,recordBytes:localSeriesRecordBytes(4,3)}};
  assert.deepEqual((await aggregateStoredAoi(request,source,8)).overall,[3,7,3]);
  assert.deepEqual((await aggregateStoredAoi({...request,method:"mean"},source)).overall,[3,7,3]);
  assert.throws(()=>validateStoredAoi({...request,kind:"processed"},source));
});
