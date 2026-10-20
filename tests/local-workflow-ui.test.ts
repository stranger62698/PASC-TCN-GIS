import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnomalyRegion } from "../app/lib/anomaly-regions";
import { InspectionActionPanel } from "../app/components/InspectionActionPanel";
import { RoadNavigationPanel } from "../app/components/RoadNavigationPanel";
import { RoadFieldTaskPanel } from "../app/components/RoadFieldTaskPanel";
import { createFieldTaskPlan } from "../app/lib/roadops-task-plan";
import { addInspectionPointToNavigation } from "../app/lib/inspection-to-navigation";
import { createNavigationDraft, setNavigationCoordinate } from "../app/lib/roadops-navigation";

const noop = () => {};
const region = { id: "AR-01", pointIds: ["p-real"], centroid: [110.35, 20.03], pointCount: 1, medianVelocity: -5, maximumAbsoluteDisplacement: 30, acceleratingCount: 0, piecewiseCount: 0, dominantMode: "线性型" } as AnomalyRegion;
const inspectionProps = { regions: [region], activeRegionId: region.id, datasetTitle: "本机数据", observationDate: "2025-05-03", layers: [], clusterRadiusMeters: 200, clusterMinimumPoints: 3, onDiscover: noop, onFocus: noop, onClearFocus: noop, onOpenLayers: noop, onOpenAi: noop, onExport: noop, onAddRegionToNavigation: noop };

test("only a selected candidate exposes its actionable route bridge and route activity disables it", () => {
  const selected = renderToStaticMarkup(createElement(InspectionActionPanel, inspectionProps));
  assert.match(selected, /加入核查行程/);
  assert.match(selected, /真实成员点/);
  const unselected = renderToStaticMarkup(createElement(InspectionActionPanel, { ...inspectionProps, activeRegionId: null }));
  assert.doesNotMatch(unselected, /加入核查行程/);
  const busy = renderToStaticMarkup(createElement(InspectionActionPanel, { ...inspectionProps, navigationBusy: true }));
  assert.match(busy, /disabled=""[^>]*>加入核查行程/);
});

test("navigation renders original point/date/rule provenance after manual adjustment without fetching routes", () => {
  const context = { datasetId: "local-file-abc", analysisId: "analysis-xyz", datasetTitle: "本机 CSV", observationDate: "2025-05-03", ruleSummary: "速率阈值 -3 mm/yr" };
  const original = addInspectionPointToNavigation(createNavigationDraft(), { id: "p-real", lon: 110.35, lat: 20.03 }, context);
  const draft = setNavigationCoordinate(original.draft, original.point.id, [110.36, 20.04]);
  const fetchBefore = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error("SSR must not fetch routes"); };
  try {
    const html = renderToStaticMarkup(createElement(RoadNavigationPanel, { draft, onChange: noop, pickId: null, onPick: noop, plan: null, onPlan: noop, onBusy: noop, evidence: [], activeLegId: null, onFocusLeg: noop, onFocusPoint: noop }));
    for (const expected of ["本机 CSV", "真实点 p-real", "2025-05-03", "速率阈值 -3 mm/yr", "analysis-xyz", "目标位置已人工调整", "使用目标位置算路（入口待核验）"]) assert.ok(html.includes(expected), expected);
    assert.match(html, /data-inspection-arrival-selection="unconfirmed"/);
    assert.match(html, /class="road-navigation-submit" disabled=""/);
    const stale = renderToStaticMarkup(createElement(RoadNavigationPanel, { draft, onChange: noop, pickId: null, onPick: noop, plan: null, onPlan: noop, onBusy: noop, evidence: [], activeLegId: null, onFocusLeg: noop, onFocusPoint: noop, currentDatasetId: "other-file", currentAnalysisId: "other-analysis" }));
    assert.match(stale, /分析来源已过期/);
    assert.match(stale, /disabled=""[^>]*>使用目标位置算路（入口待核验）/);
    assert.match(stale, /class="road-navigation-submit" disabled=""/);
    const taskPlan = createFieldTaskPlan(draft, { planId: "source-ui-plan", name: "来源任务", now: "2026-10-11T01:00:00.000Z" });
    const advanced = renderToStaticMarkup(createElement(RoadFieldTaskPanel, { plan: taskPlan, stored: false, onChange: noop, onSaved: noop, onRestore: noop, pickId: null, onPick: noop, result: null, onResult: noop, onBusy: noop, activeLegId: null, onFocusLeg: noop, onFocusPoint: noop, currentDatasetId: "other-file", currentAnalysisId: "other-analysis" }));
    assert.match(advanced, /分析来源已过期/);
    assert.match(advanced, /真实点 p-real/);
    assert.match(advanced, /disabled=""[^>]*>确认当前车辆停靠位置用于算路（入口待核验）/);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = fetchBefore; }
});
