import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  nearestNeighborOrder,
  optimizeRoadOpsRoute,
  parseRoadOpsRouteFixture,
  twoOptDirected,
  type RoadOpsRouteCost,
  type RoadOpsRouteFixture,
  type RoadOpsRouteRequest,
} from "../app/lib/roadops-route";

const fixtureText = readFileSync("public/data/roadops/jiangdong-route-demo.json", "utf8");
const fixture = parseRoadOpsRouteFixture(JSON.parse(fixtureText));
const manifest = JSON.parse(readFileSync("public/data/roadops/jiangdong-route-demo.manifest.json", "utf8")) as { outputSha256: string; externalRouteRequests: number };
const request = (patch: Partial<RoadOpsRouteRequest> = {}): RoadOpsRouteRequest => ({
  startId: "origin",
  endId: "terminal",
  candidateIds: ["checkpoint-a", "checkpoint-b", "checkpoint-c", "checkpoint-d", "checkpoint-e", "checkpoint-f"],
  requiredIds: ["checkpoint-c"],
  dwellMinutes: { "checkpoint-a": 35, "checkpoint-b": 25, "checkpoint-c": 40, "checkpoint-d": 30, "checkpoint-e": 20, "checkpoint-f": 25 },
  workMinutes: 240,
  returnToStart: false,
  ...patch,
});

const objectiveFixture = (): RoadOpsRouteFixture => {
  const ids = ["s", "a", "b", "t"];
  const matrix: RoadOpsRouteFixture["matrix"] = Object.fromEntries(ids.map(from => [from, Object.fromEntries(ids.map(to => [to, from === to ? { distanceMeters: 0, durationSeconds: 0 } : null]))]));
  const assign = (from: string, to: string, distanceMeters: number, durationSeconds: number) => { matrix[from][to] = { distanceMeters, durationSeconds }; };
  assign("s", "t", 1000, 5);
  assign("s", "a", 1000, 10);
  assign("a", "b", 1000, 10);
  assign("b", "t", 1000, 10);
  assign("s", "b", 100, 100);
  assign("b", "a", 100, 100);
  assign("a", "t", 100, 100);
  assign("a", "s", 100, 100);
  assign("b", "s", 1000, 10);
  const points = ids.map((id, index) => ({ ...fixture.points[0], id, name: id, role: id === "s" ? "origin" as const : id === "t" ? "destination" as const : "candidate" as const, coordinate: [110 + index * 0.001, 20] as [number, number], defaultDwellMinutes: 0, inspectionValue: 1, reachable: true }));
  const features: RoadOpsRouteFixture["legGeometries"]["features"] = [];
  for (const from of points) for (const to of points) {
    const leg = matrix[from.id][to.id];
    if (from.id !== to.id && leg) features.push({ type: "Feature", id: `${from.id}-${to.id}`, properties: { from: from.id, to: to.id, ...leg, source: "saved_osm_route_demo" }, geometry: { type: "LineString", coordinates: [from.coordinate, to.coordinate] } });
  }
  return { ...fixture, fixtureId: "objective-counterexample", points, matrix, legGeometries: { type: "FeatureCollection", name: "synthetic-test-costs", features } };
};
const objectiveRequest = (patch: Partial<RoadOpsRouteRequest> = {}): RoadOpsRouteRequest => ({ startId: "s", endId: "t", candidateIds: ["a", "b"], requiredIds: ["a", "b"], dwellMinutes: {}, workMinutes: 100, returnToStart: false, ...patch });

test("fixed Jiangdong fixture is traceable, asymmetric and contains saved road geometry", () => {
  assert.equal(fixture.points.length, 8);
  assert.equal(fixture.points.filter(point => point.role === "candidate").length, 6);
  assert.notEqual(fixture.matrix.origin.terminal?.durationSeconds, fixture.matrix.terminal.origin?.durationSeconds);
  assert.ok(fixture.legGeometries.features.length >= 40);
  assert.ok(fixture.legGeometries.features.some(feature => feature.geometry.coordinates.length > 10));
  assert.equal(manifest.outputSha256, createHash("sha256").update(fixtureText).digest("hex"));
  assert.equal(manifest.externalRouteRequests, 0);
});

test("nearest-neighbor and directed 2-opt are deterministic and 2-opt never worsens the selected route", () => {
  const candidates = ["checkpoint-a", "checkpoint-b", "checkpoint-c", "checkpoint-d", "checkpoint-e"];
  const first = nearestNeighborOrder(fixture, "origin", candidates, "terminal");
  const second = nearestNeighborOrder(fixture, "origin", candidates, "terminal");
  assert.deepEqual(first, second);
  const improved = twoOptDirected(fixture, first.order);
  const firstPlan = optimizeRoadOpsRoute(fixture, request({ candidateIds: candidates, requiredIds: candidates, workMinutes: 600 }));
  assert.deepEqual(twoOptDirected(fixture, first.order), improved);
  assert.ok(firstPlan.totalDistanceMeters <= firstPlan.baselineDistanceMeters);
  assert.ok(firstPlan.distanceSavedMeters >= 0);
});

test("time budget insertion changes selection monotonically and retains required points", () => {
  const short = optimizeRoadOpsRoute(fixture, request({ workMinutes: 120 }));
  const long = optimizeRoadOpsRoute(fixture, request({ workMinutes: 420 }));
  assert.ok(short.selectedCandidateIds.includes("checkpoint-c"));
  assert.ok(long.selectedCandidateIds.includes("checkpoint-c"));
  assert.ok(short.selectedCandidateIds.length < long.selectedCandidateIds.length);
  assert.ok(short.totalMinutes <= 120);
  assert.ok(long.totalMinutes <= 420);
});

test("required overtime and unreachable candidates have explicit non-destructive outcomes", () => {
  const plan = optimizeRoadOpsRoute(fixture, request({ candidateIds: ["checkpoint-c", "checkpoint-f"], requiredIds: ["checkpoint-c", "checkpoint-f"], workMinutes: 20 }));
  assert.equal(plan.status, "infeasible");
  assert.ok(plan.selectedCandidateIds.includes("checkpoint-c"));
  assert.ok(plan.overtimeMinutes > 0);
  assert.ok(plan.excluded.some(item => item.pointId === "checkpoint-f" && item.reason === "unreachable"));
  assert.ok(!plan.selectedCandidateIds.includes("checkpoint-f"));
});

test("return-to-start plan keeps list, map markers and saved route legs in the same order", () => {
  const plan = optimizeRoadOpsRoute(fixture, request({ returnToStart: true, workMinutes: 360 }));
  assert.equal(plan.stopOrder[0], "origin");
  assert.equal(plan.stopOrder.at(-1), "origin");
  assert.deepEqual(plan.map.stops.map(stop => stop.id), plan.stopOrder);
  assert.equal(plan.map.features.length, plan.stopOrder.length - 1);
  assert.deepEqual(plan.map.features.map(feature => feature.properties.from), plan.stopOrder.slice(0, -1));
  assert.deepEqual(plan.map.features.map(feature => feature.properties.to), plan.stopOrder.slice(1));
});

test("duration and distance consistently choose different insertion, nearest-neighbor and directed 2-opt orders", () => {
  const decision = objectiveFixture();
  const fastOrder = ["s", "a", "b", "t"], shortOrder = ["s", "b", "a", "t"];
  assert.deepEqual(nearestNeighborOrder(decision, "s", ["a", "b"], "t", "duration").order, fastOrder);
  assert.deepEqual(nearestNeighborOrder(decision, "s", ["a", "b"], "t", "distance").order, shortOrder);
  assert.deepEqual(twoOptDirected(decision, shortOrder, "duration"), fastOrder);
  assert.deepEqual(twoOptDirected(decision, fastOrder, "distance"), shortOrder);
  const fast = optimizeRoadOpsRoute(decision, objectiveRequest({ objective: "duration" }));
  const short = optimizeRoadOpsRoute(decision, objectiveRequest({ objective: "distance" }));
  assert.deepEqual(fast.stopOrder, fastOrder);
  assert.deepEqual(short.stopOrder, shortOrder);
  assert.equal(fast.totalDistanceMeters, 3000);
  assert.equal(short.totalDistanceMeters, 300);
  assert.equal(fast.drivingMinutes, 0.5);
  assert.equal(short.drivingMinutes, 5);
  assert.equal(fast.status, "ready");
  assert.equal(short.status, "ready");
});

test("distance objective preserves work-window feasibility including dwell and alternate insertion positions", () => {
  const decision = objectiveFixture();
  const constraints = { objective: "distance" as const, workMinutes: 3, dwellMinutes: { a: 1, b: 1 } };
  const required = optimizeRoadOpsRoute(decision, objectiveRequest(constraints));
  const optional = optimizeRoadOpsRoute(decision, objectiveRequest({ ...constraints, requiredIds: ["a"] }));
  for (const plan of [required, optional]) {
    assert.deepEqual(plan.stopOrder, ["s", "a", "b", "t"]);
    assert.equal(plan.status, "ready");
    assert.equal(plan.totalMinutes, 2.5);
    assert.equal(plan.overtimeMinutes, 0);
  }
  assert.deepEqual(twoOptDirected(decision, ["s", "a", "b", "t"], "distance", 60), ["s", "a", "b", "t"]);
  const noFeasibleOrder = optimizeRoadOpsRoute(decision, objectiveRequest({ ...constraints, workMinutes: 2 }));
  assert.equal(noFeasibleOrder.status, "infeasible");
  assert.deepEqual(noFeasibleOrder.selectedCandidateIds, ["a", "b"]);
  assert.ok(noFeasibleOrder.overtimeMinutes > 0);
});

test("distance final candidates cannot silently omit required stops at a directed nearest-neighbor dead end", () => {
  const decision = objectiveFixture();
  const leg = (distanceMeters: number, durationSeconds: number): RoadOpsRouteCost => ({ distanceMeters, durationSeconds });
  decision.matrix.s.a = leg(1, 1);
  decision.matrix.s.b = leg(5, 5);
  decision.matrix.a.b = null;
  decision.matrix.b.a = leg(5, 5);
  decision.matrix.a.t = leg(1, 1);
  decision.matrix.b.t = leg(5, 5);
  const nearest = nearestNeighborOrder(decision, "s", ["a", "b"], "t", "distance");
  assert.deepEqual(nearest.unreachable, ["b"]);
  const plan = optimizeRoadOpsRoute(decision, objectiveRequest({ objective: "distance" }));
  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.stopOrder, ["s", "b", "a", "t"]);
  assert.deepEqual(new Set(plan.selectedCandidateIds), new Set(["a", "b"]));
  assert.deepEqual(twoOptDirected(decision, plan.stopOrder, "distance"), plan.stopOrder);
});

test("distance return-to-start respects directed return costs and keeps required stops and geometry", () => {
  const decision = objectiveFixture();
  const plan = optimizeRoadOpsRoute(decision, objectiveRequest({ objective: "distance", returnToStart: true }));
  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.stopOrder, ["s", "b", "a", "s"]);
  assert.equal(plan.totalDistanceMeters, 300);
  assert.deepEqual(plan.map.stops.map(stop => stop.id), plan.stopOrder);
  assert.deepEqual(plan.map.features.map(feature => [feature.properties.from, feature.properties.to]), [["s", "b"], ["b", "a"], ["a", "s"]]);
});

test("omitted objective retains duration behavior for requests and exported helpers", () => {
  const decision = objectiveFixture();
  assert.deepEqual(optimizeRoadOpsRoute(decision, objectiveRequest()), optimizeRoadOpsRoute(decision, objectiveRequest({ objective: "duration" })));
  assert.deepEqual(nearestNeighborOrder(decision, "s", ["a", "b"], "t"), nearestNeighborOrder(decision, "s", ["a", "b"], "t", "duration"));
  assert.deepEqual(twoOptDirected(decision, ["s", "b", "a", "t"]), twoOptDirected(decision, ["s", "b", "a", "t"], "duration"));
  assert.deepEqual(optimizeRoadOpsRoute(fixture, request()), optimizeRoadOpsRoute(fixture, request({ objective: "duration" })));
});

test("Phase 4 offline workflow remains available and route calls stay manual in Phase 5", () => {
  const planner = readFileSync("app/components/RoadRoutePlannerPanel.tsx", "utf8");
  const map = readFileSync("app/components/WebGisMap.tsx", "utf8");
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const styles = readFileSync("app/globals.css", "utf8");
  assert.match(planner, /出发地/);
  assert.match(planner, /结束地/);
  assert.match(planner, /候选途经点/);
  assert.match(planner, /必选/);
  assert.match(planner, /单组工作时长/);
  assert.match(planner, /不可达/);
  assert.match(planner, /演示数据 · 离线规划/);
  assert.match(planner, /生成实时驾车路线/);
  assert.match(planner, /onClick=\{runLiveDriving\}/);
  assert.match(map, /route-\$\{kind\}/);
  assert.match(styles, /\.road-route-pin\.route-start/);
  assert.match(styles, /\.road-route-pin\.route-end/);
  assert.match(map, /roadOpsRoutePlan\.stops/);
  assert.match(workspace, /roadOpsRoutePlan/);
  assert.doesNotMatch(planner, /https?:\/\//i);
  const effects = [...planner.matchAll(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g)].map(match => match[0]).join("\n");
  assert.doesNotMatch(effects, /api\/roadops\/driving/i);
});
