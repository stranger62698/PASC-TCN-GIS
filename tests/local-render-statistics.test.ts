import test from "node:test";
import assert from "node:assert/strict";
import type { InsarPoint } from "../app/data/site";
import { renderedDisplacementAt } from "../app/lib/insar-v2";
import { summarizeAoi } from "../app/lib/aoi-analysis";
import { aoiPointsCsv } from "../app/lib/analysis-exports";
import { currentDisplacement } from "../app/lib/point-comparison";
import { buildAnalysisSummary } from "../app/lib/ai-summary";
import { filterPascOnlinePoints } from "../app/lib/pasc-online";
const point = { id:"p",name:"p",lon:110,lat:20,mode:"线性型",velocity:-15,displacement:-45,coherence:.9,missingRate:0,dates:["2024-01-01","2024-01-02"],series:[NaN,NaN],localSeriesIndex:0,localSeriesHydrated:false,modeConfidence:.5,spatialApplicability:"limited_reference",renderTimeIndex:0,renderDisplacement:-12 } as InsarPoint;
test("map, AOI, comparison and CSV use the same loaded scalar after row cache eviction",()=> {
 assert.equal(renderedDisplacementAt(point,0),-12);assert.equal(currentDisplacement(point,0),-12);
 assert.equal(summarizeAoi([point],0,.75,p=>p.mode)?.meanCurrentDisplacement,-12);
 assert.ok(aoiPointsCsv([point],0).includes("-12,2024-01-01"));
 assert.ok(Number.isNaN(renderedDisplacementAt(point,1)));
});
test("local filters never expand lazy PASC objects, and incomplete AI range is explicitly unavailable",()=>{
 const lazy={...point};Object.defineProperty(lazy,"pasc",{get(){throw new Error("must not hydrate");}});
 assert.equal(filterPascOnlinePoints([lazy],"lowConfidence").length,1);
 assert.equal(filterPascOnlinePoints([lazy],"limitedReference").length,1);
 assert.throws(()=>buildAnalysisSummary({points:[lazy],datasetLabel:"local",timeRange:{startDate:"2024-01-01",endDate:"2024-01-02"},filterDescription:"all",coherenceThreshold:.75}),/完整时序未载入/);
});
