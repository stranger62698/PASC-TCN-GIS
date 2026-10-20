import assert from "node:assert/strict";
import test from "node:test";
import { fieldMarkerBadge, groupCoincidentFieldMarkers } from "../app/lib/roadops-task-markers";

test("FP2 marker aggregation preserves all visit identities at an unchanged coordinate", () => {
  const points = [
    { id: "departure", coordinate: [110.3, 20] as [number, number], role: "origin" as const, index: 0 },
    { id: "work", coordinate: [110.31, 20.01] as [number, number], role: "candidate" as const, index: 1 },
    { id: "return", coordinate: [110.3, 20] as [number, number], role: "destination" as const, index: 2 },
  ];
  const before = JSON.stringify(points), groups = groupCoincidentFieldMarkers(points);
  assert.equal(groups.length, 2); assert.deepEqual(groups[0].members.map(point => point.id), ["departure", "return"]);
  assert.deepEqual(groups[0].coordinate, [110.3, 20]); assert.deepEqual(fieldMarkerBadge(groups[0].members), { kind: "start", label: "起/返" });
  groups[0].coordinate[0] = 0; assert.equal(JSON.stringify(points), before);
});

test("FP2 visual grouping never rounds nearby stops or discards coincident target tasks", () => {
  const points = [
    { id: "task-a", coordinate: [110.3, 20] as [number, number] },
    { id: "task-b", coordinate: [110.3, 20] as [number, number] },
    { id: "task-c", coordinate: [110.30000001, 20] as [number, number] },
  ];
  const groups = groupCoincidentFieldMarkers(points);
  assert.equal(groups.length, 2); assert.deepEqual(groups[0].members.map(point => point.id), ["task-a", "task-b"]);
  assert.deepEqual(groups[1].coordinate, points[2].coordinate);
});

test("FP2 station badge handles start, end, and repeated intermediate visits", () => {
  assert.deepEqual(fieldMarkerBadge([{ role: "origin" }]), { kind: "start", label: "起" });
  assert.deepEqual(fieldMarkerBadge([{ role: "destination" }]), { kind: "end", label: "终" });
  assert.deepEqual(fieldMarkerBadge([{ role: "candidate", index: 2 }]), { kind: "waypoint", label: "2" });
  assert.deepEqual(fieldMarkerBadge([{ role: "candidate", visitIndex: 1 }, { role: "candidate", visitIndex: 3 }]), { kind: "waypoint", label: "1+" });
});
