import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const sourceUrl = new URL("../public/data/roadops/jiangdong-route-demo.json", import.meta.url);
const outputUrl = new URL("../public/data/roadops/jiangdong-didi-contract-replay.json", import.meta.url);
const manifestUrl = new URL("../public/data/roadops/jiangdong-didi-contract-replay.manifest.json", import.meta.url);
const sourceText = await readFile(sourceUrl, "utf8"), fixture = JSON.parse(sourceText);
const stopOrder = ["origin", "checkpoint-a", "checkpoint-c", "checkpoint-b", "checkpoint-e", "checkpoint-d", "terminal"];
const requiredIds = new Set(["checkpoint-c"]), pointById = new Map(fixture.points.map(point => [point.id, point]));
const featureByLeg = new Map(fixture.legGeometries.features.map(feature => [`${feature.properties.from}|${feature.properties.to}`, feature]));
let distanceMeters = 0, durationSeconds = 0;
const coordinates = [];
for (let index = 1; index < stopOrder.length; index += 1) {
  const from = stopOrder[index - 1], to = stopOrder[index], cost = fixture.matrix[from][to], feature = featureByLeg.get(`${from}|${to}`);
  if (!cost || !feature) throw new Error(`Replay leg missing: ${from} -> ${to}`);
  distanceMeters += cost.distanceMeters; durationSeconds += cost.durationSeconds;
  coordinates.push(...feature.geometry.coordinates.slice(coordinates.length ? 1 : 0));
}
const dwellMinutes = stopOrder.slice(1, -1).reduce((sum, id) => sum + pointById.get(id).defaultDwellMinutes, 0);
const drivingMinutes = Number((durationSeconds / 60).toFixed(1)), totalMinutes = Number((drivingMinutes + dwellMinutes).toFixed(1));
const bounds = [Math.min(...coordinates.map(point => point[0])), Math.min(...coordinates.map(point => point[1])), Math.max(...coordinates.map(point => point[0])), Math.max(...coordinates.map(point => point[1]))];
const plan = {
  schemaVersion: "roadops-driving-plan-v1",
  provider: "didi_contract_replay",
  mode: "didi_replay",
  generatedAt: "2026-09-22T00:00:00.000Z",
  inputFingerprint: createHash("sha256").update(sourceText).digest("hex").slice(0, 20),
  status: "ready",
  stopOrder,
  selectedCandidateIds: stopOrder.slice(1, -1),
  excluded: [{ pointId: "checkpoint-f", pointName: pointById.get("checkpoint-f").name, reason: "unreachable", detail: pointById.get("checkpoint-f").unreachableReason }],
  totalDistanceMeters: Math.round(distanceMeters),
  drivingMinutes,
  dwellMinutes,
  totalMinutes,
  workMinutes: 240,
  overtimeMinutes: 0,
  map: {
    fixtureId: "roadops-didi-contract-replay-v1",
    mode: "didi_replay",
    stops: stopOrder.map((id, index) => {
      const point = pointById.get(id);
      return { ...point, markerRole: index === 0 ? "start" : index === stopOrder.length - 1 ? "end" : "waypoint", visitIndex: index === 0 || index === stopOrder.length - 1 ? null : index, required: requiredIds.has(id) };
    }),
    features: [{ type: "Feature", id: "didi-contract-replay-route", properties: { from: stopOrder[0], to: stopOrder.at(-1), distanceMeters: Math.round(distanceMeters), durationSeconds: Math.round(durationSeconds), source: "didi_contract_replay", legIndex: 1 }, geometry: { type: "LineString", coordinates } }],
    bounds,
  },
  usage: { cached: true, upstreamRequests: 0, dailyUsed: 0, dailyBudget: 50, dailyRemaining: 50, perIdentityUsed: 0, perIdentityLimit: 20 },
  boundary: "固定脱敏契约回放：几何来自仓库内保存的 OSM 演示路线，不是本次滴图调用结果，不消耗额度，不提供导航。",
  provenance: { kind: "contract_replay", liveRequest: false, sourceFixture: fixture.fixtureId, sourceSha256: createHash("sha256").update(sourceText).digest("hex") },
};
const outputText = `${JSON.stringify(plan, null, 2)}\n`;
await writeFile(outputUrl, outputText, "utf8");
await writeFile(manifestUrl, `${JSON.stringify({ schemaVersion: "roadops-didi-contract-replay-manifest-v1", generatedAt: plan.generatedAt, sourceFile: "jiangdong-route-demo.json", sourceSha256: plan.provenance.sourceSha256, outputFile: "jiangdong-didi-contract-replay.json", outputSha256: createHash("sha256").update(outputText).digest("hex"), upstreamRequests: 0, containsDidiResponse: false, disclaimer: plan.boundary }, null, 2)}\n`, "utf8");
console.log(`RoadOps Phase 5 contract replay prepared: ${stopOrder.length} stops, ${coordinates.length} vertices, 0 upstream requests.`);
