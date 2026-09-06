import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cases } from "../app/data/site.js";
import { GRASS_BCYR_COLORS, colorFor, inspectCsv, parseMappedCsv } from "../app/lib/insar-v2.js";
import { buildInspectionBrief, buildInspectionCandidates } from "../app/lib/inspection-action.js";
import type { AnomalyRegion } from "../app/lib/anomaly-regions.js";
import { calculatePriorityThresholds, selectPriorityDeformationPoints } from "../app/lib/priority-deformation.js";

const priorityPoint = (index: number, velocity: number, displacement: number, coherence = .9) => ({
  id: `priority-test-${index}`, name: `priority-test-${index}`, lon: 110 + index * .001, lat: 20,
  velocity, displacement, coherence, missingRate: 0, mode: "线性型", updated: "2026-09-06",
  series: [0, displacement],
});

test("priority deformation uses the joint negative empirical tail and keeps quality separate", () => {
  const points = Array.from({ length: 10 }, (_, index) => priorityPoint(index, -10 + index, -100 + index * 10, index === 0 ? .9 : .5));
  const thresholds = calculatePriorityThresholds(points, 1, 20);
  assert.equal(thresholds.displacementMm, -82);
  assert.equal(thresholds.velocityMmPerYear, -8.2);
  const selection = selectPriorityDeformationPoints(points, 1, { tailPercent: 20, coherenceThreshold: .75 });
  assert.deepEqual(selection.candidates.map(point => point.id), ["priority-test-0", "priority-test-1"]);
  assert.deepEqual(selection.reliable.map(point => point.id), ["priority-test-0"]);
  assert.deepEqual(selection.limited.map(point => point.id), ["priority-test-1"]);
  assert.equal(selection.ruleVersion, "negative-tail-v1");
});

test("priority deformation never promotes the positive side of a distribution", () => {
  const points = Array.from({ length: 10 }, (_, index) => priorityPoint(index, 1 + index, 10 + index * 10));
  const selection = selectPriorityDeformationPoints(points, 1, { tailPercent: 20 });
  assert.equal(selection.candidates.length, 0);
});

test("portfolio homepage states one primary persona and exposes the guided demo", () => {
  const home = readFileSync("app/components/HomePage.tsx", "utf8");
  const shell = readFileSync("app/components/SiteShell.tsx", "utf8");
  const auth = readFileSync("app/components/AuthPage.tsx", "utf8");
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const mapRoute = readFileSync("app/map/page.tsx", "utf8");
  const contentPages = readFileSync("app/components/ContentPages.tsx", "utf8");
  const staticIndex = readFileSync("static-src/index.html", "utf8");
  const styles = readFileSync("app/globals.css", "utf8");
  const layout = readFileSync("app/layout.tsx", "utf8");
  assert.match(home, /面向 InSAR \/ GIS 科研与技术分析人员/);
  assert.match(home, /\/map\?demo=haikou&tour=portfolio/);
  assert.match(home, /90 秒体验一次分析/);
  assert.match(home, /不只看形变量/);
  assert.match(home, /更识别形变模式/);
  assert.doesNotMatch([home, shell, contentPages, staticIndex, layout].join("\n"), /形变过程分析|时序 InSAR 分析|更识别变化过程/);
  assert.match(home, /useLanguage/);
  assert.match(styles, /hero-insar-observation-v2\.webp/);
  assert.match(home, /卫星雷达观测/);
  assert.match(home, /时序形变反演/);
  assert.match(home, /形变模式识别/);
  assert.match(home, /hero-visual-label/);
  assert.match(home, /从观测到可核查证据/);
  assert.match(home, /不代表真实监测点、数值或工程结论/);
  assert.doesNotMatch(home, /hero-point-card|−8\.24|当前点位/);
  assert.doesNotMatch(home, /观测 → 模式 → 证据/);
  assert.match(shell, /function BrandMark/);
  assert.match(shell, /lanjifyw-brand-satellite\.png/);
  assert.match(shell, /InSAR 形变模式识别/);
  assert.match(styles, /\.product-path\{[^}]*background:linear-gradient\(145deg,#edf6ff/);
  assert.doesNotMatch(shell, /可解释形变分析|insar-satellite-v2/);
  assert.match(auth, /<BrandMark \/>/);
  assert.match(styles, /phase-eight-login \.login-scene\{justify-content:flex-start/);
  assert.doesNotMatch(mapRoute, /<SiteHeader/);
  assert.match(workspace, /<WorkspaceHeader/);
  assert.doesNotMatch(workspace, /<BrandMark/);
  assert.match(workspace, /useState<InsarPoint \| null>\(null\)/);
  assert.match(workspace, /risk: false/);
  assert.doesNotMatch(auth, /城市时序 InSAR|insar-satellite-v2/);
  assert.doesNotMatch(workspace, /INSAR WEBGIS|insar-satellite-v2/);
  assert.match(styles, /brand-symbol/);
  assert.match(styles, /hero-deformation-field/);
  assert.match(styles, /@keyframes heroSceneIn/);
  assert.match(styles, /@keyframes heroCardFloat/);
  assert.match(styles, /\.hero-method-badge\{position:relative/);
  assert.doesNotMatch(styles, /\.hero-science-image\{[^}]*grayscale/);
  assert.doesNotMatch(home, /heat h1/);
  assert.doesNotMatch(home, /城市安全信息/);
  assert.match(layout, /InSAR 形变模式识别工作台/);
  assert.match(shell, /90 秒公开体验/);
});

test("map-first workbench uses drawers, adjustable pixel markers and carousel evidence", () => {
  const home = readFileSync("app/components/HomePage.tsx", "utf8");
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const map = readFileSync("app/components/WebGisMap.tsx", "utf8");
  const cases = readFileSync("app/components/DataBackedCasePanel.tsx", "utf8");
  const styles = readFileSync("app/globals.css", "utf8");
  assert.match(workspace, /workspace-data-card/);
  assert.doesNotMatch(workspace, /map-corner-dock/);
  assert.match(workspace, /workspace-export-drawer/);
  assert.match(workspace, /<header className="panel-head"><span>导出材料/);
  assert.doesNotMatch(workspace, /返回首页/);
  assert.match(workspace, /function MapToolIcon/);
  assert.match(workspace, /进入区域统计/);
  assert.match(workspace, /name="screenshot"/);
  assert.match(workspace, /name="rules"/);
  assert.match(workspace, /name="export"/);
  assert.match(workspace, /fileRef\.current\?\.click\(\)/);
  assert.doesNotMatch(workspace, /className="map-tool-wide"/);
  assert.doesNotMatch(workspace, /<header className="map-topbar/);
  assert.doesNotMatch(workspace, /panel-resizer/);
  assert.match(map, /L\.circleMarker\(\[p\.lat,p\.lon\],baseStyle\)/);
  assert.match(map, /renderer:pointRenderer,radius:pointSize/);
  assert.match(workspace, /aria-label="地图监测点大小"/);
  assert.doesNotMatch(map, /aria-label="地图监测点大小"/);
  assert.match(workspace, /卷帘对比/);
  assert.doesNotMatch(map, /map-swipe-tool/);
  assert.match(map, /aria-label="速率与形变模式卷帘位置"/);
  assert.match(map, /latLngToContainerPoint/);
  assert.match(map, /colorFor\(point\.velocity,swipeVelocityStyle\)/);
  assert.match(map, /colorForMode\(point\.mode\)/);
  assert.match(map, /role="slider"/);
  assert.match(styles, /\.map-swipe-divider/);
  assert.match(styles, /\.map-swipe-canvas/);
  assert.match(workspace, /onClick=\{clearFilters\}/);
  assert.match(workspace, /setAttributeState\(result\.periods \? "displacement" : "velocity"\)/);
  assert.match(styles, /\.navigation-workspace \.gis-map\{inset:0 var\(--drawer-width\)/);
  assert.match(cases, /data-case-carousel/);
  assert.match(cases, /data-case-dots/);
  assert.doesNotMatch(cases, /is-stacked/);
  assert.match(styles, /Map-first workbench/);
  assert.doesNotMatch(home, /SPATIOTEMPORAL MAP/);
  assert.doesNotMatch(home, /DEFORMATION PATTERNS/);
  assert.doesNotMatch(home, /LBS FIELD EVIDENCE/);
  assert.doesNotMatch(home, /WORKSPACE DIRECTORY/);
  assert.doesNotMatch(home, /page-directory/);
  assert.doesNotMatch(home, /不涉及路线导航/);
  assert.doesNotMatch(home, /without claiming route navigation/);
  assert.match(home, /\/platform-time-map\.webp/);
  assert.match(home, /\/platform-pattern-analysis\.webp/);
  assert.match(home, /\/platform-field-evidence\.webp/);
  assert.match(home, /className="signature-image" fill/);
  assert.match(styles, /\.signature-shade\{position:absolute/);
  assert.match(styles, /\.case-gallery-selector\{background:linear-gradient\(160deg,#eaf5fc,#d7eaf7\)\}/);
  assert.match(home, /LIVE CASE GALLERY/);
  assert.match(home, /role="tablist"/);
  assert.match(home, /moveCaseTab/);
  assert.match(home, /tabIndex=\{index === activeCaseIndex \? 0 : -1\}/);
  assert.match(home, /onPointerEnter=\{\(\) => setActiveCaseIndex\(index\)\}/);
  assert.match(home, /case-gallery-arrow previous/);
  assert.match(home, /case-gallery-arrow next/);
  assert.match(home, /\/home-case-city-displacement\.webp/);
  assert.match(home, /\/home-case-road\.png/);
  assert.match(home, /\/home-case-landslide\.png/);
  assert.match(styles, /--font-body:/);
  assert.match(styles, /--font-title:"Inter","PingFang SC","Source Han Sans SC"/);
  assert.match(styles, /--font-ui:"Inter","PingFang SC","Microsoft YaHei"/);
  assert.match(styles, /map-tool-drawer>header\.panel-head\{[^}]*background:linear-gradient\(100deg,#f8fbff,#edf5ff\)/);
  assert.match(styles, /\.insar-action-concept\{background:linear-gradient\(145deg,#edf6ff/);
  assert.match(styles, /\.signature-pattern/);
  assert.doesNotMatch(home, /SPACE × TIME/);
  assert.doesNotMatch(home, /RATE → PROCESS/);
  assert.doesNotMatch(home, /PHOTO ↔ COORDINATE/);
  assert.match(home, /href="\/showcase"/);
  assert.match(home, /href="\/about"/);
  assert.match(home, /将现场观察和遥感证据放在同一位置核查/);
  assert.doesNotMatch(home, /\["01",|<i>01<\/i>|01—03/);
});

test("GRASS bcyr deformation scales use the requested classified thresholds", () => {
  const colors = [...GRASS_BCYR_COLORS].reverse();
  const shared = { colors, timeIndex: 0, rangeStart: 0, rangeEnd: 1 };
  const displacement = { ...shared, attribute: "displacement" as const, min: -100, max: 100, interval: 20 };
  const velocity = { ...shared, attribute: "velocity" as const, min: -12.5, max: 12.5, interval: 2.5 };
  assert.deepEqual(GRASS_BCYR_COLORS, ["#0000ff", "#00ffff", "#ffff00", "#ff0000"]);
  assert.equal(colorFor(-101, displacement), "rgb(255,0,0)");
  assert.equal(colorFor(-100, displacement), "rgb(255,70,0)");
  assert.equal(colorFor(100, displacement), "rgb(0,70,255)");
  assert.equal(colorFor(101, displacement), "rgb(0,0,255)");
  assert.equal(colorFor(-13, velocity), "rgb(255,0,0)");
  assert.equal(colorFor(0, velocity), "rgb(93,255,162)");
  assert.equal(colorFor(13, velocity), "rgb(0,0,255)");
});

test("field photo lightbox closes above the map without click-through", () => {
  const lightbox = readFileSync("app/components/FieldPhotoLightbox.tsx", "utf8");
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const styles = readFileSync("app/globals.css", "utf8");
  assert.match(lightbox, /createPortal\(lightbox, document\.body\)/);
  assert.match(lightbox, /const index = photoId \? photos\.findIndex/);
  assert.match(lightbox, /const photo = index >= 0 \? photos\[index\] : null/);
  assert.match(lightbox, /className="field-lightbox-close"[^>]*onPointerDown=\{closeFromPointer\}/);
  assert.match(lightbox, /event\.stopPropagation\(\)/);
  assert.match(lightbox, /event\.key !== "Tab"/);
  assert.match(lightbox, /previouslyFocused\?\.focus/);
  assert.match(workspace, /<select aria-label="分析任务"/);
  assert.match(workspace, /aria-label="数据详情"/);
  assert.match(workspace, /aria-label="点位结果"/);
  assert.match(styles, /\.field-lightbox-close\{z-index:4;pointer-events:auto;touch-action:manipulation\}/);
});

test("portfolio case study exposes role, decisions, evidence and pending validation", () => {
  const about = readFileSync("app/components/ContentPages.tsx", "utf8");
  assert.match(about, /独立产品实践/);
  assert.match(about, /第一目标用户/);
  assert.match(about, /KEY PRODUCT DECISIONS/);
  assert.match(about, /当前已有技术证据/);
  assert.match(about, /下一阶段用户证据/);
  assert.match(about, /不替代现场调查、工程检测或风险判定/);
});

test("case deck exposes three consistently structured real cases with study-area backgrounds", () => {
  assert.equal(cases.find(item => item.key === "city")?.evidenceLevel, "interactive");
  assert.equal(cases.find(item => item.key === "landslide")?.evidenceLevel, "interactive");
  assert.equal(cases.find(item => item.key === "road")?.evidenceLevel, "interactive");
  const city = cases.find(item => item.key === "city");
  const landslide = cases.find(item => item.key === "landslide");
  const road = cases.find(item => item.key === "road");
  cases.forEach(item => {
    assert.match(item.description, /^基于.+InSAR 时序/);
    assert.equal(item.metrics[0][0], "监测点");
    assert.equal(item.metrics[1][0], "观测期数");
    assert.equal(item.researchArea.facts.length, 3);
    assert.ok(item.researchArea.overview.length > 40);
    assert.ok(item.researchArea.boundary.length > 40);
    assert.ok(item.researchArea.sources.every(source => source.href.startsWith("https://")));
  });
  assert.match(city?.researchArea.boundary ?? "", /尚未建立点位到单栋建筑的归属关系/);
  assert.match(landslide?.evidenceLabel ?? "", /真实时序.*可交互 Demo/);
  assert.match(landslide?.demoNote ?? "", /未提供坡体分区、相干性和人工类别/);
  assert.match(road?.evidenceLabel ?? "", /真实时序.*可交互 Demo/);
  assert.match(road?.demoNote ?? "", /未提供道路名称、里程桩、车道方向和现场路况/);
});

test("city public demo uses the complete Xinbu Island dense source without replacing the sampled time-series regression asset", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const manifest = JSON.parse(readFileSync("public/data/xinbu-island-insar.manifest.json", "utf8")) as {
    sourceSha256: string; outputBytes: number; pointCount: number; invalidRows: number; uniquePointIds: number;
    periodCount: number; startDate: string; endDate: string; missingTimeValues: number; bounds: number[]; velocity: { unit: string; min: number; max: number; mean: number };
    classCounts: Record<string, number>; evidenceBoundary: string;
  };
  const buffer = readFileSync("public/data/xinbu-island-insar.csv");
  const csv = buffer.toString("utf8");
  const inspection = inspectCsv(csv);
  const parsed = parseMappedCsv(csv, "xinbu-island-insar.csv", {
    ...inspection.mapping,
    displacementUnit: "mm",
    velocityUnit: "mm/year",
    signConvention: "toward_satellite_positive",
    preprocessingState: "already_smoothed",
  }, false);
  assert.match(workspace, /demo-xinbu-island-dense/);
  assert.match(workspace, /\/data\/xinbu-island-insar\.csv/);
  assert.match(workspace, /9,069 点 · 210 期原始时序/);
  assert.equal(buffer.length, manifest.outputBytes);
  assert.equal(createHash("sha256").update(buffer).digest("hex"), manifest.sourceSha256);
  assert.equal(manifest.pointCount, 9_069);
  assert.equal(manifest.invalidRows, 0);
  assert.equal(manifest.uniquePointIds, 9_069);
  assert.equal(manifest.periodCount, 210);
  assert.equal(manifest.startDate, "20170322");
  assert.equal(manifest.endDate, "20250503");
  assert.equal(manifest.missingTimeValues, 0);
  assert.deepEqual(manifest.bounds, [110.3401, 20.081, 110.3749, 20.09141]);
  assert.deepEqual(manifest.classCounts, { 未定义型: 2469, 稳定型: 1656, 减速型: 1070, 分段型: 2804, 线性型: 800, 加速型: 270 });
  assert.equal(parsed.points.length, 9_069);
  assert.equal(parsed.periods, 210);
  assert.equal(parsed.invalid, 0);
  assert.equal(parsed.points.filter(point => point.series.length === 210).length, 9_069);
  assert.deepEqual(parsed.points[0].dates?.slice(0, 2), ["2017-03-22", "2017-04-03"]);
  assert.equal(parsed.points[0].dates?.at(-1), "2025-05-03");
  assert.equal(parsed.points.filter(point => point.pasc).length, 9_069);
  assert.match(manifest.evidenceBoundary, /未包含建筑物轮廓面/);
  assert.equal(readFileSync("public/data/haikou-insar.csv", "utf8").trim().split(/\r?\n/).length - 1, 3_094);
});

test("landslide public demo is wired to the real normalized CSV", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const manifest = JSON.parse(readFileSync("public/data/lajia-landslide-insar.manifest.json", "utf8")) as {
    pointCount: number; invalidRows: number; periodCount: number; startDate: string; endDate: string;
    displacementUnit: string; precision: string; classification: string;
  };
  const csv = readFileSync("public/data/lajia-landslide-insar.csv", "utf8");
  const inspection = inspectCsv(csv);
  const parsed = parseMappedCsv(csv, "lajia-landslide-insar.csv", inspection.mapping, true);
  assert.match(workspace, /demo-lajia-landslide/);
  assert.match(workspace, /\/data\/lajia-landslide-insar\.csv/);
  assert.equal(manifest.pointCount, 11_354);
  assert.equal(manifest.invalidRows, 0);
  assert.equal(manifest.periodCount, 58);
  assert.equal(manifest.startDate, "20210103");
  assert.equal(manifest.endDate, "20221224");
  assert.equal(manifest.displacementUnit, "mm");
  assert.equal(manifest.precision, "0.1 mm");
  assert.equal(manifest.classification, "not_provided");
  assert.equal(parsed.points.length, 11_354);
  assert.equal(parsed.periods, 58);
  assert.equal(parsed.invalid, 0);
  assert.deepEqual([
    Math.min(...parsed.points.map(point => point.lon)),
    Math.min(...parsed.points.map(point => point.lat)),
    Math.max(...parsed.points.map(point => point.lon)),
    Math.max(...parsed.points.map(point => point.lat)),
  ], [100.5992, 34.65886, 100.7025, 34.70578]);
});

test("road public demo is wired to the normalized Jiangdong road CSV", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const manifest = JSON.parse(readFileSync("public/data/haikou-jiangdong-road-insar.manifest.json", "utf8")) as {
    sourceFile: string; sourcePointCount: number; pointCount: number; invalidRows: number; periodCount: number; startDate: string; endDate: string;
    precision: string; bounds: number[]; selection: { gridMeters: number };
  };
  const csv = readFileSync("public/data/haikou-jiangdong-road-insar.csv", "utf8");
  const inspection = inspectCsv(csv);
  const parsed = parseMappedCsv(csv, "haikou-jiangdong-road-insar.csv", inspection.mapping, true);
  assert.match(workspace, /demo-haikou-jiangdong-road/);
  assert.match(workspace, /\/data\/haikou-jiangdong-road-insar\.csv/);
  assert.equal(manifest.sourceFile, "cumulative_def_network_1.csv");
  assert.equal(manifest.sourcePointCount, 27_123);
  assert.equal(manifest.pointCount, 11_383);
  assert.equal(manifest.invalidRows, 0);
  assert.equal(manifest.periodCount, 175);
  assert.equal(manifest.startDate, "20180104");
  assert.equal(manifest.endDate, "20240202");
  assert.equal(manifest.precision, "0.1 mm");
  assert.equal(manifest.selection.gridMeters, 25);
  assert.equal(parsed.points.length, 11_383);
  assert.equal(parsed.periods, 175);
  assert.equal(parsed.invalid, 0);
  assert.deepEqual(manifest.bounds, [110.37301, 19.95289, 110.52347, 20.07055]);
});

test("showcase headings prevent orphaned Chinese glyphs without shrinking the desktop title", () => {
  const cases = readFileSync("app/components/CasePages.tsx", "utf8");
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(cases, /className="case-feature-title"/);
  assert.match(css, /:where\(h1,h2,h3\)\{text-wrap:balance;line-break:strict\}/);
  assert.match(css, /@media\(min-width:1380px\)\{\.phase-eight-showcase \.case-feature \.case-feature-title\{font-size:36px;white-space:nowrap\}\}/);
});

test("guided walkthrough reuses real anomaly, region and AI actions", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  assert.match(workspace, /tour.*portfolio/);
  assert.match(workspace, /产品操作引导/);
  assert.match(workspace, /discoverAnomalies\(\)/);
  assert.match(workspace, /focusAnomalyRegion\(first\)/);
  assert.match(workspace, /runAiInterpretation\(\)/);
  assert.match(workspace, /不超过 12 KB/);
});

test("static Vercel deployment has a same-origin AI function", () => {
  const route = readFileSync("api/ai/interpret.ts", "utf8");
  const deployment = readFileSync("vercel.json", "utf8");
  assert.match(route, /VercelRequest/);
  assert.match(route, /resolveAiProviderConfig/);
  assert.match(route, /resolvePersonalAiProviderConfig/);
  assert.match(route, /AI_INTERPRET_REQUEST_MAX_BYTES/);
  assert.match(route, /validOrigin/);
  assert.match(deployment, /api\/ai\/interpret\.ts/);
  assert.match(deployment, /"maxDuration": 45/);
});

test("health endpoint distinguishes local readiness from optional service configuration", () => {
  const health = readFileSync("app/api/health/route.ts", "utf8");
  assert.match(health, /status: optionalServicesReady \? "ready" : "degraded"/);
  assert.match(health, /localStaticAnalysis: true/);
  assert.match(health, /pascService:/);
  assert.match(health, /aiProvider:/);
  assert.match(health, /database:/);
  assert.match(health, /objectStorage:/);
  assert.doesNotMatch(health, /PASC_SERVICE_API_KEY\s*[,}]/);
});

test("AI configuration has a discoverable entry and keeps personal keys in memory only", () => {
  const shell = readFileSync("app/components/SiteShell.tsx", "utf8");
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  assert.doesNotMatch(shell, /header-ai-config" href="\/map\?demo=/);
  assert.match(workspace, /<option value="ai">AI 解读/);
  assert.match(workspace, /params\.get\("settings"\) === "personal"/);
  assert.match(workspace, /配置 API/);
  assert.match(workspace, /完成配置/);
  assert.match(workspace, /仅本次会话/);
  assert.match(workspace, /尾号/);
  assert.match(workspace, /help\.aliyun\.com\/zh\/model-studio\/get-api-key/);
  assert.match(workspace, /免费额度用完即停/);
  assert.doesNotMatch(workspace, /(?:localStorage|sessionStorage)\.setItem\([^)]*(?:AiKey|API Key|personalAiKey)/i);
});

test("inspection action ranks evidence-backed regions without claiming navigation safety", () => {
  const region = (id: string, medianVelocity: number, displacement: number, pointCount: number): AnomalyRegion => ({
    id,
    pointIds: Array.from({ length: pointCount }, (_, index) => `${id}-${index}`),
    geometry: { type: "rectangle", coordinates: [[100, 34], [100.01, 34], [100.01, 34.01], [100, 34.01]] },
    bounds: [100, 34, 100.01, 34.01],
    centroid: [100.005, 34.005],
    pointCount,
    areaKm2: 1,
    densityPerKm2: pointCount,
    meanVelocity: medianVelocity,
    medianVelocity,
    minimumVelocity: medianVelocity,
    maximumVelocity: medianVelocity,
    meanCurrentDisplacement: displacement / 2,
    maximumAbsoluteDisplacement: displacement,
    dominantMode: "未分类",
    modeCounts: { 未分类: pointCount },
    clearSubsidenceCount: pointCount,
    acceleratingCount: 0,
    piecewiseCount: 0,
  });
  const candidates = buildInspectionCandidates([region("AR-02", -3, 12, 12), region("AR-01", -11, 62, 120)]);
  assert.equal(candidates[0].region.id, "AR-01");
  assert.equal(candidates[0].priorityLabel, "优先核查");
  const brief = buildInspectionBrief("拉加镇滑坡", "2022-12-24", candidates);
  assert.match(brief, /业务对象边界、基础属性、现场监测与人工复核记录/);
  assert.match(brief, /不等同于风险等级或工程安全结论/);
});

test("evidence scoring does not treat denser sampling as higher risk", () => {
  const region = (id: string, pointCount: number, densityPerKm2: number): AnomalyRegion => ({
    id,
    pointIds: Array.from({ length: pointCount }, (_, index) => `${id}-${index}`),
    geometry: { type: "rectangle", coordinates: [[110.32, 20.03], [110.34, 20.03], [110.34, 20.05], [110.32, 20.05]] },
    bounds: [110.32, 20.03, 110.34, 20.05],
    centroid: [110.33, 20.04],
    pointCount,
    areaKm2: .04,
    densityPerKm2,
    meanVelocity: -8,
    medianVelocity: -8,
    minimumVelocity: -9,
    maximumVelocity: -7,
    meanCurrentDisplacement: -20,
    maximumAbsoluteDisplacement: 42,
    dominantMode: "稳定型",
    modeCounts: { 稳定型: pointCount },
    clearSubsidenceCount: pointCount,
    acceleratingCount: 0,
    piecewiseCount: 0,
  });
  const candidates = buildInspectionCandidates([region("AR-DENSE", 200, 5_000), region("AR-SPARSE", 20, 500)]);
  assert.equal(candidates[0].score, candidates[1].score);
  const brief = buildInspectionBrief("新埠岛建筑", "2025-05-03", candidates);
  assert.match(brief, /空间研判复核简报/);
  assert.match(brief, /证据分/);
  assert.doesNotMatch(brief, /路线|导航|ETA/);
});

test("landslide case exposes the observation-to-action concept and direct action workspace", () => {
  const casesPage = readFileSync("app/components/CasePages.tsx", "utf8");
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  assert.match(casesPage, /遥感负责发现，现场负责确认/);
  assert.match(casesPage, /map\?demo=landslide&panel=action/);
  assert.match(workspace, /核查候选/);
  assert.match(workspace, /InspectionActionPanel/);
});

test("inspection and assisted-analysis UI use product language instead of implementation labels", () => {
  const inspection = readFileSync("app/components/InspectionActionPanel.tsx", "utf8");
  const assistant = readFileSync("app/components/AiEvidencePanel.tsx", "utf8");
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  assert.match(inspection, /空间研判交付/);
  assert.match(inspection, /业务对象关联/);
  assert.match(inspection, /点面关联、邻近检索或相交分析/);
  assert.match(inspection, /进入证据解读/);
  assert.match(inspection, /建筑轮廓与建筑编号/);
  assert.match(inspection, /这些范围由系统自动分组，并不是你手动画出的区域/);
  assert.match(inspection, /尚未选择空间分组/);
  assert.doesNotMatch(inspection, /\?\? candidates\[0\]/);
  assert.doesNotMatch(inspection, /路线|导航|LBS|DEMO|接近路线|停车侧|道路 \/ DEM/);
  assert.match(assistant, /数据分析助手/);
  assert.match(assistant, /范围概览/);
  assert.match(assistant, /区域比较/);
  assert.match(assistant, /图层关联/);
  assert.match(assistant, /模式解释/);
  assert.match(assistant, /数据依据/);
  assert.doesNotMatch(assistant, /AI Tools \+ RAG \+ Evidence|ZERO-COST|不调用高级模型/);
  assert.match(workspace, /activeFilter === "anomaly" \? anomalyRegionResult\.regions : \[\]/);
  assert.doesNotMatch(workspace, /上方本地 AI Tools、RAG 和 Evidence/);
});
