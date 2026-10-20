import assert from "node:assert/strict";
import test from "node:test";
import type { AnomalyRegion } from "../app/lib/anomaly-regions";
import { addInspectionPointToNavigation, addInspectionRegionToNavigation, selectInspectionRepresentative } from "../app/lib/inspection-to-navigation";
import { buildLoginContinuationHref, createLocalAnalysisId, createLocalAnalysisSession, safeReturnTo } from "../app/lib/local-analysis-session";
import { createNavigationDraft, setNavigationCoordinate, buildNavigationRequest, navigationRouteSignature, confirmInspectionNavigationTarget, navigationInspectionIssues } from "../app/lib/roadops-navigation";
import { confirmFieldTaskArrivalSelection, createFieldTaskPlan, fieldTaskInspectionIssues, fieldTaskPlanToNavigationDraft, parseFieldTaskPlan, prepareFieldTaskPlanRestore, serializeFieldTaskPlan } from "../app/lib/roadops-task-plan";

import { setFieldTaskTargetCoordinate, setFieldVehicleStopCoordinate, shareFieldTaskVisit, splitFieldTask } from "../app/lib/roadops-task-editor";
import { compileFieldTaskRouting } from "../app/lib/roadops-task-routing";

const context = { datasetId: "local-file-abc", analysisId: "local-analysis-xyz", datasetTitle: "用户本机数据", observationDate: "2025-05-03", ruleSummary: "速率阈值 -3 mm/yr；相干性 ≥ 0.75" };
const members = [{ id: "p-a", lon: 110.35, lat: 20.03 }, { id: "p-b", lon: 110.3501, lat: 20.03 }, { id: "p-c", lon: 110.3502, lat: 20.03 }];
const region = { id: "AR-01", pointIds: members.map(point => point.id), centroid: [110.35008, 20.03] } as AnomalyRegion;
const metadata = { planId: "field-local-workflow", name: "核查行程", now: "2026-10-10T08:00:00.000Z" };

test("region bridge uses a real member, never a computed centroid or unrelated nearest point", () => {
  const unrelated = { id: "unrelated", lon: region.centroid[0], lat: region.centroid[1] };
  const representative = selectInspectionRepresentative(region, [...members, unrelated]);
  assert.equal(representative.id, "p-b");
  const result = addInspectionRegionToNavigation(createNavigationDraft(), region, [...members, unrelated], context);
  assert.deepEqual(result.point.coordinate, [representative.lon, representative.lat]);
  assert.notDeepEqual(result.point.coordinate, region.centroid);
  assert.equal(result.point.inspectionSource?.representativePointId, "p-b");
  assert.equal(result.point.inspectionSource?.regionPointCount, 3);
  assert.equal(result.point.inspectionSource?.datasetId, context.datasetId);
  assert.equal(result.point.inspectionSource?.analysisId, context.analysisId);
  assert.equal(result.point.inspectionSource?.observationDate, context.observationDate);
  assert.equal(result.point.inspectionSource?.ruleSummary, context.ruleSummary);
  assert.equal(result.point.vehicleCoordinate, null);
  assert.equal(result.point.accessReview, "unknown");
  assert.equal(result.point.inspectionSource?.arrivalSelection, "unconfirmed");
  assert.equal(result.draft.origin.coordinate, null);
  assert.equal(result.draft.destination.coordinate, null);
});

test("bridge identity is stable across member order and re-add preserves edited inputs", () => {
  const first = addInspectionRegionToNavigation(createNavigationDraft(), region, members, context);
  const reordered = addInspectionRegionToNavigation(createNavigationDraft(), { ...region, pointIds: [...region.pointIds].reverse() }, [...members].reverse(), context);
  assert.equal(first.point.id, reordered.point.id);
  const edited = setNavigationCoordinate(first.draft, `vehicle:${first.point.id}`, [110.3505, 20.0305]);
  const repeated = addInspectionRegionToNavigation(edited, region, members, context);
  assert.equal(repeated.added, false);
  assert.equal(repeated.draft, edited);
  assert.deepEqual(repeated.point.vehicleCoordinate, [110.3505, 20.0305]);
  assert.notEqual(addInspectionRegionToNavigation(createNavigationDraft(), region, members, { ...context, analysisId: "new-analysis" }).point.id, first.point.id);
});

test("bridge rejects missing members, invalid source points, coordinate duplicates and a full itinerary", () => {
  assert.throws(() => selectInspectionRepresentative(region, []), /真实成员点/);
  assert.throws(() => addInspectionPointToNavigation(createNavigationDraft(), { id: "broken", lon: NaN, lat: 20 }, context), /坐标无效/);
  assert.throws(() => addInspectionPointToNavigation(createNavigationDraft(), members[0], { ...context, datasetId: "" }), /标识/);
  const occupied = setNavigationCoordinate(createNavigationDraft(), "navigation-origin", [members[0].lon, members[0].lat]);
  assert.throws(() => addInspectionPointToNavigation(occupied, members[0], context), /重复/);
  let draft = createNavigationDraft();
  for (let index = 0; index < 6; index += 1) draft = addInspectionPointToNavigation(draft, { id: `member-${index}`, lon: 110 + index / 10, lat: 20 }, context).draft;
  assert.throws(() => addInspectionPointToNavigation(draft, { id: "member-extra", lon: 111, lat: 20 }, context), /6 个途经点/);
});

test("source survives task save/export/restore and manual changes while provider request excludes local provenance", () => {
  let draft = setNavigationCoordinate(createNavigationDraft(), "navigation-origin", [110.3, 20.04]);
  draft = setNavigationCoordinate(draft, "navigation-destination", [110.4, 20.05]);
  const result = addInspectionRegionToNavigation(draft, region, members, context);
  draft = confirmInspectionNavigationTarget(result.draft, result.point.id);
  const plan = createFieldTaskPlan(draft, metadata);
  const restored = fieldTaskPlanToNavigationDraft(prepareFieldTaskPlanRestore(parseFieldTaskPlan(JSON.parse(serializeFieldTaskPlan(plan, { includeNotes: false })))));
  assert.deepEqual(restored.waypoints[0].inspectionSource, draft.waypoints[0].inspectionSource);
  assert.equal(restored.waypoints[0].inspectionSource?.arrivalSelection, "target");
  assert.equal(navigationRouteSignature(restored), navigationRouteSignature(draft));
  const moved = setNavigationCoordinate(restored, result.point.id, [110.352, 20.032]);
  assert.equal(moved.waypoints[0].inspectionSource?.targetAdjusted, true);
  assert.equal(moved.waypoints[0].inspectionSource?.arrivalSelection, "unconfirmed");
  assert.throws(() => buildNavigationRequest(moved), /明确选择/);
  assert.deepEqual(moved.waypoints[0].inspectionSource?.sourceCoordinate, result.point.coordinate);
  assert.equal(fieldTaskPlanToNavigationDraft(createFieldTaskPlan(moved, metadata)).waypoints[0].inspectionSource?.targetAdjusted, true);
  const request = buildNavigationRequest(restored);
  assert.doesNotMatch(JSON.stringify(request), /datasetId|analysisId|ruleSummary|inspectionSource|用户本机数据/);
  assert.equal(request.points[1].required, true);
});

test("older v1 tasks without provenance remain readable; malformed new provenance fails closed", () => {
  const oldPlan = createFieldTaskPlan(createNavigationDraft(), metadata);
  const oldDraft = fieldTaskPlanToNavigationDraft(parseFieldTaskPlan(oldPlan));
  assert.deepEqual(createFieldTaskPlan(oldDraft, metadata), oldPlan);
  assert.equal(oldDraft.origin.inspectionSource, undefined);
  assert.equal(oldDraft.destination.inspectionSource, undefined);
  const candidate = addInspectionPointToNavigation(createNavigationDraft(), members[0], context).draft;
  const plan = createFieldTaskPlan(candidate, metadata);
  const tampered = { ...plan, tasks: plan.tasks.map(task => task.inspectionSource ? { ...task, inspectionSource: { ...task.inspectionSource, sourceCoordinate: [181, 20] } } : task) };
  assert.throws(() => parseFieldTaskPlan(tampered), /来源点坐标经度/);
});

test("inspection targets require an explicit routing choice; current source identity remains mandatory after edits", () => {
  let initial = setNavigationCoordinate(createNavigationDraft(), "navigation-origin", [110.3, 20.04]);
  initial = setNavigationCoordinate(initial, "navigation-destination", [110.4, 20.05]);
  const result = addInspectionPointToNavigation(initial, members[0], context);
  const scope = { currentDatasetId: context.datasetId, currentAnalysisId: context.analysisId };
  assert.equal(navigationInspectionIssues(result.draft, scope)[0].kind, "arrival");
  assert.throws(() => buildNavigationRequest(result.draft, scope), /明确选择/);
  const direct = confirmInspectionNavigationTarget(result.draft, result.point.id);
  assert.equal(direct.waypoints[0].accessReview, "unknown");
  assert.deepEqual(navigationInspectionIssues(direct, scope), []);
  assert.doesNotThrow(() => buildNavigationRequest(direct, scope));
  const changedScope = { ...scope, currentAnalysisId: "changed-rule" };
  assert.equal(navigationInspectionIssues(direct, changedScope)[0].kind, "stale");
  assert.throws(() => buildNavigationRequest(direct, changedScope), /分析来源已过期/);
  assert.throws(() => buildNavigationRequest(direct, { ...scope, currentDatasetId: "replacement-file" }), /分析来源已过期/);
  assert.throws(() => buildNavigationRequest(direct, { ...scope, currentAnalysisId: null }), /分析来源已过期/);
  const custom = setNavigationCoordinate(direct, `vehicle:${result.point.id}`, [110.355, 20.035]);
  assert.equal(custom.waypoints[0].inspectionSource?.arrivalSelection, "custom");
  assert.deepEqual(buildNavigationRequest(custom, scope).points[1].coordinate, [110.355, 20.035]);
  assert.throws(() => buildNavigationRequest(custom, changedScope), /分析来源已过期/, "Manual arrival edits cannot erase stale analysis lineage.");
  assert.equal(setNavigationCoordinate(custom, `vehicle:${result.point.id}`, null).waypoints[0].inspectionSource?.arrivalSelection, "unconfirmed");
  const restored = fieldTaskPlanToNavigationDraft(createFieldTaskPlan(custom, metadata));
  assert.deepEqual(restored.waypoints[0].inspectionSource, custom.waypoints[0].inspectionSource);
  assert.equal(restored.waypoints[0].inspectionSource?.arrivalSelection, "custom");
  assert.doesNotThrow(() => buildNavigationRequest(direct, scope), "Returning to the exact deterministic analysis identity is allowed.");
});

test("older provenance without arrival selection restores as unconfirmed and malformed choices fail closed", () => {
  const result = addInspectionPointToNavigation(createNavigationDraft(), members[0], context);
  const currentPlan = createFieldTaskPlan(result.draft, metadata);
  const oldPlan = structuredClone(currentPlan);
  delete oldPlan.tasks.find(task => task.inspectionSource)!.inspectionSource!.arrivalSelection;
  const restored = fieldTaskPlanToNavigationDraft(parseFieldTaskPlan(oldPlan));
  assert.equal(restored.waypoints[0].inspectionSource?.arrivalSelection, "unconfirmed");
  const malformed = { ...currentPlan, tasks: currentPlan.tasks.map(task => task.inspectionSource ? ({ ...task, inspectionSource: { ...task.inspectionSource, arrivalSelection: "auto-approved" } }) : task) };
  assert.throws(() => parseFieldTaskPlan(malformed), /算路位置选择/);
});

test("full shared-stop tasks check every source, preserve lineage, and require a current explicit arrival choice", () => {
  let draft = setNavigationCoordinate(createNavigationDraft(), "navigation-origin", [110.3, 20.04]);
  draft = setNavigationCoordinate(draft, "navigation-destination", [110.4, 20.05]);
  const first = addInspectionPointToNavigation(draft, members[0], context);
  const second = addInspectionPointToNavigation(first.draft, members[2], { ...context, analysisId: "older-analysis" });
  const original = createFieldTaskPlan(second.draft, metadata);
  const shared = shareFieldTaskVisit(original, original.visits[2].visitId, original.visits[1].visitId, { confirmed: true });
  const scope = { currentDatasetId: context.datasetId, currentAnalysisId: context.analysisId };
  const choice = confirmFieldTaskArrivalSelection(shared); // Historical input choice alone does not make source current.
  assert.equal(choice.visits[1].taskIds.length, 2);
  const stale = fieldTaskInspectionIssues(choice, scope);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].taskId, second.point.id, "The second task at one shared stop must also be checked.");
  assert.equal(stale[0].kind, "stale");
  assert.throws(() => compileFieldTaskRouting(choice, scope), /分析来源已过期/);
  assert.throws(() => confirmFieldTaskArrivalSelection(choice, scope), /分析来源已过期/);
  assert.doesNotThrow(() => compileFieldTaskRouting(choice));
  const fresh = parseFieldTaskPlan({ ...shared, tasks: shared.tasks.map(task => task.inspectionSource ? { ...task, inspectionSource: { ...task.inspectionSource, analysisId: context.analysisId } } : task) });
  assert.throws(() => compileFieldTaskRouting(fresh, scope), /明确确认/);
  const confirmed = confirmFieldTaskArrivalSelection(fresh, scope);
  for (const task of confirmed.tasks.filter(task => task.inspectionSource)) {
    assert.equal(task.inspectionSource!.arrivalSelection, "custom");
    assert.equal(task.legacyAccessReview, "unknown");
  }
  assert.doesNotThrow(() => compileFieldTaskRouting(confirmed, scope));
  const movedTarget = setFieldTaskTargetCoordinate(confirmed, second.point.id, [110.352, 20.033]);
  const movedTask = movedTarget.tasks.find(task => task.taskId === second.point.id)!;
  assert.equal(movedTask.inspectionSource?.arrivalSelection, "unconfirmed");
  assert.equal(movedTask.inspectionSource?.targetAdjusted, true);
  assert.throws(() => compileFieldTaskRouting(movedTarget, scope), /明确确认/);
  const movedStop = setFieldVehicleStopCoordinate(movedTarget, movedTarget.visits[1].stopId, [110.353, 20.034]);
  assert.deepEqual(fieldTaskInspectionIssues(movedStop, scope), []);
  for (const task of movedStop.tasks.filter(task => task.inspectionSource)) assert.equal(task.inspectionSource!.arrivalSelection, "custom");
  const split = splitFieldTask(movedStop, second.point.id, { visitId: "split-visit", stopId: "split-stop" });
  assert.equal(split.tasks.find(task => task.taskId === second.point.id)!.inspectionSource?.arrivalSelection, "unconfirmed");
  const roundTrip = parseFieldTaskPlan(JSON.parse(serializeFieldTaskPlan(movedStop, { includeNotes: false })));
  assert.deepEqual(roundTrip.tasks.map(task => task.inspectionSource), movedStop.tasks.map(task => task.inspectionSource));
});

test("same File instance gives stable dataset identity; settings and scope change only analysis identity", async () => {
  const file = new File(["id,lon,lat\np-a,110.35,20.03"], "user.csv", { lastModified: 1234 });
  const first = await createLocalAnalysisSession(file, { coherence: 0.75, velocity: -3 }, { date: "2025-05-03" });
  const repeated = await createLocalAnalysisSession(file, { velocity: -3, coherence: 0.75 }, { date: "2025-05-03" });
  assert.deepEqual(repeated, first);
  assert.equal(first.fingerprint.coverage, "full");
  assert.equal(repeated.importId, first.importId);
  assert.equal(first.fingerprint.sampledBytes, file.size);
  const changed = await createLocalAnalysisSession(file, { coherence: 0.8, velocity: -3 }, { date: "2025-05-03" });
  assert.equal(changed.datasetId, first.datasetId);
  assert.notEqual(changed.analysisId, first.analysisId);
  const replacement = await createLocalAnalysisSession(new File(["id,lon,lat\np-b,110.35,20.03"], "user.csv", { lastModified: 1234 }), { coherence: 0.75, velocity: -3 }, { date: "2025-05-03" });
  assert.notEqual(replacement.datasetId, first.datasetId);
  assert.equal(createLocalAnalysisId(first.datasetId, { b: 2, a: 1 }), createLocalAnalysisId(first.datasetId, { a: 1, b: 2 }));
});

test("large-file identity is bounded and advertises sampled coverage instead of whole-file hash", async () => {
  const reads: Array<[number, number]> = [];
  const fakeFile = { name: "large.csv", size: 1024 ** 3, lastModified: 123, slice(start: number, end: number) {
    reads.push([start, end]); return new Blob([new Uint8Array(end - start)]);
  } } as File;
  const session = await createLocalAnalysisSession(fakeFile, {});
  assert.equal(session.fingerprint.coverage, "sampled-first-middle-last");
  assert.ok(session.fingerprint.sampledBytes <= 96 * 1024);
  assert.equal(reads[0][0], 0);
  assert.equal(reads.at(-1)?.[1], fakeFile.size);
  assert.ok(reads[1][0] > 0 && reads[1][1] < fakeFile.size);
});

test("new imports cannot reuse an older dataset identity when changes fall outside sampled ranges", async () => {
  const firstBytes = new Uint8Array(1024 * 1024);
  const changedBytes = new Uint8Array(firstBytes);
  changedBytes[100_000] = 1; // Outside first/middle/last sampled windows.
  const original = new File([firstBytes], "same.csv", { lastModified: 123 });
  const replacement = new File([changedBytes], "same.csv", { lastModified: 123 });
  const [first, changed, identicalImport] = await Promise.all([
    createLocalAnalysisSession(original, {}), createLocalAnalysisSession(replacement, {}),
    createLocalAnalysisSession(new File([firstBytes], "same.csv", { lastModified: 123 }), {}),
  ]);
  assert.equal(first.fingerprint.coverage, "sampled-first-middle-last");
  assert.equal(first.fingerprint.digest, changed.fingerprint.digest, "Bounded samples are not whole-file integrity hashes.");
  assert.notEqual(first.importId, changed.importId);
  assert.notEqual(first.datasetId, changed.datasetId);
  assert.notEqual(first.datasetId, identicalImport.datasetId, "A fresh selection needs its own current analysis and source choice.");
  assert.equal((await createLocalAnalysisSession(original, {})).datasetId, first.datasetId);
});

test("login return target keeps local scope and rejects redirects to other origins or auth/API loops", () => {
  const origin = "https://lanji.example";
  assert.equal(safeReturnTo("/map?source=local#analysis", origin), "/map?source=local#analysis");
  assert.equal(safeReturnTo(`${origin}/map?demo=road`, origin), "/map?demo=road");
  for (const target of ["https://evil.example", "//evil.example/path", "/\\evil.example", "javascript:alert(1)", "/%2f%2fevil.example", "/map\n", "/login?returnTo=/map", "/api/auth", "https://user:password@lanji.example/map", "map"]) {
    assert.equal(safeReturnTo(target, origin), "/datasets", target);
  }
  const href = buildLoginContinuationHref("/map?source=local&view=inspection", origin);
  const parsed = new URL(href, origin);
  assert.equal(parsed.pathname, "/login");
  assert.equal(parsed.searchParams.get("resume"), "1");
  assert.equal(parsed.searchParams.get("returnTo"), "/map?source=local&view=inspection");
});
