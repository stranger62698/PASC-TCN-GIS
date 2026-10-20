import test from "node:test";
import assert from "node:assert/strict";
import type { InsarPoint } from "../app/data/site";
import { resolveLocalAnomalyScope } from "../app/lib/local-anomaly-scope";
import { computePrioritySnapshot, createPrioritySnapshot, restorePrioritySelection } from "../app/lib/local-analysis-compute";
const point=(id:string,longitude:number):InsarPoint=>({id,name:id,lon:longitude,lat:20,velocity:-15,displacement:-45,coherence:.9,missingRate:0,mode:"Linear",updated:"2024-01-13",series:[0,-45],dates:["2024-01-01","2024-01-13"]});
test("full scope retains the entire source, including points beyond the former map sample",()=>{
  const points=Array.from({length:25003},(_,index)=>point(String(index),110+index*.001));
  assert.equal(resolveLocalAnomalyScope(points,null),points);
  assert.equal(resolveLocalAnomalyScope(points,["25001","25002"]).length,2);
  assert.throws(()=>resolveLocalAnomalyScope(points,["unknown"]));
  assert.throws(()=>resolveLocalAnomalyScope(points,["1","1"]));
});
test("oversized global candidates stay unassessed; an explicit local scope recomputes all selected rows",()=>{
  const points=Array.from({length:1002},(_,index)=>point(String(index),110+index*.00001));
  const options={maximumCandidates:1000,minimumPoints:3};
  const full=computePrioritySnapshot(createPrioritySnapshot(points,1,options));
  assert.equal(full.regions.status,"too_large");assert.equal(full.indices.anomalies.length,0);
  const selected=resolveLocalAnomalyScope(points,["999","1000","1001"]);
  const local=restorePrioritySelection(computePrioritySnapshot(createPrioritySnapshot(selected,1,options)),selected);
  assert.equal(local.regions.status,"ready");assert.equal(local.anomalies.length,3);
  assert.deepEqual(local.anomalies.map(row=>row.id),["999","1000","1001"]);
});
