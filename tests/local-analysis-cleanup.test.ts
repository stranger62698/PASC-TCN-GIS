import test from "node:test";
import assert from "node:assert/strict";
import { discardLocalTemporaryResults, localTemporaryStorageBytes } from "../app/lib/local-analysis-cleanup";
import type { PascLocalCompletePayload } from "../app/lib/pasc-local-worker-protocol";
const result={resultStorage:{kind:"opfs",directory:"local",fileName:"result.csv",byteLength:50},seriesStorage:{kind:"opfs",directory:"local",fileName:"series.bin",pointCount:4,timeSteps:2,observedEpochs:2,recordBytes:20}} as PascLocalCompletePayload;
test("explicit cleanup removes only the two current result files and leaves other analyses intact",async()=>{
 const files=new Set(["result.csv","series.bin","other.csv"]);let calls=0;
 const root={getDirectoryHandle:async(name:string)=>{assert.equal(name,"local");return root;},removeEntry:async(name:string)=>{calls++;assert.ok(files.delete(name));}};
 assert.equal(localTemporaryStorageBytes(result),130);
 assert.equal(await discardLocalTemporaryResults(result,async()=>root),2);
 assert.deepEqual([...files],["other.csv"]);assert.equal(calls,2);
});
test("unsafe storage names fail before any access; memory results need no OPFS",async()=>{
 let calls=0;const rootProvider=async()=>{calls++;throw new Error("should not access");};
 await assert.rejects(discardLocalTemporaryResults({...result,seriesStorage:{...result.seriesStorage!,directory:"../outside"}},rootProvider));
 assert.equal(await discardLocalTemporaryResults({} as PascLocalCompletePayload,rootProvider),0);assert.equal(calls,0);
});
