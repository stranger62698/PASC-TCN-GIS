import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { GisFeature, GisLayer, Position } from "../app/lib/gis-layer";
import {
  ROADOPS_RULE_CODES,
  buildRoadQualityReport,
  roadQualityReportToCsv,
  roadQualityReportToJson,
  type RoadRiskEvidenceInput,
} from "../app/lib/roadops-quality";
import { buildRoadIssueTypeSafeRequest, parseRoadIssueTypeSafeResponse, TYPESAFE_SYSTEM_ONE_URL } from "../app/lib/roadops-typesafe";

const line = (id: string, coordinates: Position[], properties: Record<string, unknown> = {}): GisFeature => ({
  type: "Feature", id, geometry: { type: "LineString", coordinates }, properties: { osm_id: id.replace(/\D/g, "") || id, osm_type: "way", highway: "residential", ...properties },
});
const layer = (features: GisFeature[], bounds: GisLayer["bounds"] = { west: 110.37, south: 19.95, east: 110.53, north: 20.08 }): GisLayer => ({
  id: "phase2-fixture", name: "Phase 2 fixture", sourceName: "fixture.geojson", sourceType: "geojson", role: "road", visible: true, opacity: 1,
  featureCount: features.length, geometryTypes: ["LineString"], bounds, features, importedAt: "2026-09-21T12:29:51Z",
  provenance: { kind: "osm", builtIn: true },
});
const codes = (features: GisFeature[], evidence: RoadRiskEvidenceInput[] = []) => buildRoadQualityReport(layer(features), evidence).issues.map(issue => issue.ruleCode);

test("R001-R010 all have normal, abnormal and boundary fixtures", () => {
  const fixtures: Record<string, { abnormal: GisFeature[]; evidence?: RoadRiskEvidenceInput[]; normal: GisFeature[]; boundary?: GisFeature[] }> = {
    R001: { abnormal: [line("way/1", [[110.4, 20], [Number.NaN, 20]])], normal: [line("way/2", [[110.4, 20], [110.401, 20]])], boundary: [line("way/3", [[110.4, 20], [110.4, 20]])] },
    R002: { abnormal: [line("way/4", [[110.4, 20], [110.400001, 20]])], normal: [line("way/5", [[110.4, 20], [110.401, 20]])], boundary: [line("way/6", [[110.4, 20], [110.400045, 20]])] },
    R003: { abnormal: [line("way/7", [[110.4, 20], [110.401, 20]]), line("way/8", [[110.401, 20], [110.4, 20]])], normal: [line("way/9", [[110.4, 20], [110.401, 20.001]]), line("way/10", [[110.4, 20.002], [110.401, 20.003]])], boundary: [] },
    R004: { abnormal: [line("way/11", [[110.4, 20], [110.405, 20]], { highway: "primary", name: "A", maxspeed: "60" })], normal: [line("way/12", [[110.4, 20], [110.405, 20]], { highway: "service", surface: "asphalt" })], boundary: [line("way/13", [[110.370001, 20], [110.375, 20]], { highway: "primary", name: "A", maxspeed: "60" })] },
    R005: { abnormal: [line("way/14", [[110.4, 20], [110.402, 20.002]], { highway: "primary", name: "A", maxspeed: "60" }), line("way/15", [[110.4, 20.002], [110.402, 20]], { highway: "secondary", name: "B", maxspeed: "50" })], normal: [line("way/16", [[110.4, 20], [110.402, 20]], { bridge: "yes" }), line("way/17", [[110.401, 19.999], [110.401, 20.001]])], boundary: [] },
    R006: { abnormal: [line("way/18", [[110.4, 20], [110.402, 20.002], [110.4, 20.002], [110.402, 20]])], normal: [line("way/19", [[110.4, 20], [110.401, 20.001], [110.402, 20]])], boundary: [] },
    R007: { abnormal: [line("way/20", [[110.4, 20], [110.401, 20]], { highway: "road" })], normal: [line("way/21", [[110.4, 20], [110.401, 20]], { highway: "residential", name: "A", surface: "asphalt" })], boundary: [] },
    R008: { abnormal: [line("way/22", [[110.4, 20], [110.401, 20]], { highway: "primary" })], normal: [line("way/23", [[110.4, 20], [110.401, 20]], { highway: "primary", name: "A", maxspeed: "60" })], boundary: [line("way/24", [[110.4, 20], [110.401, 20]], { highway: "service" })] },
    R009: { abnormal: [line("way/25", [[110.401, 20], [110.4, 20]], { highway: "primary", name: "A", maxspeed: "60", oneway: "yes" }), line("way/26", [[110.401, 20], [110.402, 20]], { highway: "primary", name: "A", maxspeed: "60", oneway: "yes" })], normal: [line("way/27", [[110.4, 20], [110.401, 20]], { highway: "primary", name: "A", maxspeed: "60", oneway: "yes" }), line("way/28", [[110.401, 20], [110.402, 20]], { highway: "primary", name: "A", maxspeed: "60", oneway: "yes" })], boundary: [] },
    R010: { abnormal: [line("way/29", [[110.4, 20], [110.402, 20]], { surface: "asphalt" })], evidence: [{ id: "insar-1", type: "insar", longitude: 110.401, latitude: 20.0001, confidence: .9, summary: "高价值形变候选" }], normal: [line("way/30", [[110.4, 20], [110.402, 20]], { surface: "asphalt" })], boundary: [] },
  };
  for (const code of ROADOPS_RULE_CODES) {
    const fixture = fixtures[code];
    assert.ok(codes(fixture.abnormal, fixture.evidence).includes(code), `${code} abnormal fixture should hit`);
    assert.ok(!codes(fixture.normal).includes(code), `${code} normal fixture should not hit`);
    assert.ok(Array.isArray(fixture.boundary), `${code} boundary fixture must be declared`);
  }
});

test("OSM normalization retains raw tags, direction, mph speed and endpoint adjacency", () => {
  const report = buildRoadQualityReport(layer([
    line("way/101", [[110.4, 20], [110.401, 20]], { highway: "primary", name: "测试路", ref: "G1", oneway: "-1", maxspeed: "30 mph", surface: "asphalt", bridge: "yes", access: "destination" }),
    line("way/102", [[110.401, 20], [110.402, 20]], { highway: "secondary", name: "测试路", maxspeed: "50" }),
  ]));
  const first = report.segments[0];
  assert.equal(first.direction, "reverse");
  assert.equal(first.maxSpeedKph, 48.3);
  assert.equal(first.roadGroup, "arterial");
  assert.equal(first.bridge, true);
  assert.equal(first.rawTags.oneway, "-1");
  assert.equal(report.nodes.find(node => node.longitude === 110.401)?.connectedSegmentIds.length, 2);
});

test("one rule-object work order preserves repeated endpoint and risk evidence without duplicate IDs", () => {
  const source = layer([line("way/401", [[110.4, 20], [110.405, 20]], { highway: "primary", name: "A", maxspeed: "60" })]);
  const risk = [
    { id: "risk-a", type: "insar" as const, longitude: 110.401, latitude: 20, summary: "evidence A" },
    { id: "risk-b", type: "manual" as const, longitude: 110.402, latitude: 20, summary: "evidence B" },
  ];
  const result = buildRoadQualityReport(source, risk);
  assert.equal(new Set(result.issues.map(issue => issue.id)).size, result.issues.length);
  const endpoints = result.issues.filter(issue => issue.ruleCode === "R004");
  assert.equal(endpoints.length, 1);
  assert.equal(endpoints[0].evidence.observationCount, 2);
  assert.match(endpoints[0].description, /110.4000000/);
  assert.match(endpoints[0].description, /110.4050000/);
  const combined = result.issues.find(issue => issue.ruleCode === "R010")!;
  assert.equal(combined.evidenceIds.length, 2);
  assert.equal(combined.id, buildRoadQualityReport(source, [risk[0]]).issues.find(issue => issue.ruleCode === "R010")!.id);
  assert.equal(result.counts.ruleHits, result.counts.issues + 2);
  assert.match(roadQualityReportToJson(result), /evidence A/);
  assert.match(roadQualityReportToCsv(result), /evidence B/);
});

test("quality report and JSON/CSV exports are deterministic and trace every issue", () => {
  const source = [line("way/201", [[110.4, 20], [110.400001, 20]], { highway: "road" })];
  const first = buildRoadQualityReport(layer(source)), second = buildRoadQualityReport(layer(structuredClone(source)));
  assert.equal(roadQualityReportToJson(first), roadQualityReportToJson(second));
  assert.equal(roadQualityReportToCsv(first), roadQualityReportToCsv(second));
  assert.ok(first.issues.every(issue => issue.ruleVersion && issue.featureIds.length && issue.suggestion));
  assert.equal(first.denominators.geometryRules, source.length);
  assert.match(roadQualityReportToCsv(first), /rule_code/);
});

test("checked-in OSM baseline produces a bounded deterministic Phase 2 report", () => {
  const geojson = JSON.parse(readFileSync("public/data/roadops/jiangdong-osm-roads.geojson", "utf8"));
  const manifest = JSON.parse(readFileSync("public/data/roadops/jiangdong-osm-roads.manifest.json", "utf8"));
  const realLayer = layer(geojson.features, { west: manifest.aoi.bounds[0], south: manifest.aoi.bounds[1], east: manifest.aoi.bounds[2], north: manifest.aoi.bounds[3] });
  realLayer.id = manifest.datasetId; realLayer.importedAt = manifest.source.extractedAt; realLayer.featureCount = geojson.features.length;
  const report = buildRoadQualityReport(realLayer);
  assert.equal(report.counts.inputFeatures, manifest.featureCount);
  assert.ok(report.counts.normalizedSegments >= manifest.featureCount, "MultiLineString features may normalize into multiple road segments");
  assert.ok(report.counts.nodes > 0 && report.counts.issues > 0);
  assert.equal(report.counts.ruleHits, 1289);
  assert.equal(report.counts.issues, 1272);
  assert.equal(new Set(report.issues.map(issue => issue.id)).size, report.counts.issues);
  assert.deepEqual(Object.keys(report.ruleCounts), [...ROADOPS_RULE_CODES]);
  assert.equal(roadQualityReportToJson(report), roadQualityReportToJson(buildRoadQualityReport(realLayer)));
});

test("TypeSafe integration uses typed parallel judgments and validates responses", () => {
  const report = buildRoadQualityReport(layer([line("way/301", [[110.4, 20], [110.401, 20]], { highway: "road" })]));
  const issue = report.issues.find(item => item.ruleCode === "R007")!;
  const request = buildRoadIssueTypeSafeRequest(issue, report.segments, report.evidences);
  assert.equal(TYPESAFE_SYSTEM_ONE_URL, "https://api.typesafe.ai/v1/systemone");
  assert.deepEqual(Object.values(request.questions).map(question => question.type), ["choice", "score", "noul"]);
  assert.equal(request.state.issue.id, issue.id);
  const ambiguityQuestion = JSON.stringify(request.questions.semantic_ambiguity);
  assert.doesNotMatch(ambiguityQuestion, /selected review queue|suggested queue/);
  assert.match(ambiguityQuestion, /Using only `issue`, `roads`, `evidences`, and `policy`/);
  assert.match(ambiguityQuestion, /Missing evidence stays unknown/);
  const assessment = parseRoadIssueTypeSafeResponse(issue.id, {
    model: "jev-test", usage: { input_tokens: 123 }, answers: {
      review_queue: { type: "choice", choice: "attribute_research", confidence: .82, probabilities: { field_check: .05, map_edit_review: .08, attribute_research: .82, hold: .05 } },
      field_check_need: { type: "score", score: 1.2, confidence: .71, probabilities: { 0: .2, 1: .5, 2: .2, 3: .08, 4: .02 } },
      semantic_ambiguity: { type: "noul", noul: .33 },
    },
  });
  assert.equal(assessment.reviewQueue, "attribute_research");
  assert.equal(assessment.fieldCheckNeed, 1.2);
  assert.equal(assessment.semanticAmbiguityProbability, .33);
  assert.throws(() => parseRoadIssueTypeSafeResponse(issue.id, { answers: {} }));
});

test("Phase 2 UI exposes filters, map focus, exports and optional TypeSafe review", () => {
  const panel = readFileSync("app/components/RoadQualityPanel.tsx", "utf8");
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const map = readFileSync("app/components/WebGisMap.tsx", "utf8");
  assert.match(panel, /路网模型与质量规则/);
  assert.match(panel, /导出 JSON/);
  assert.match(panel, /TypeSafe 语义复核（可选）/);
  assert.match(workspace, /focusGisFeature/);
  assert.match(map, /feature\?\.id===activeGisFeatureId\?5/);
});
