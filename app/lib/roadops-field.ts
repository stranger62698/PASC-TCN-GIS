import type { Position } from "./gis-layer";
import type { RoadOpsDrivingPlan } from "./roadops-driving";
import type { RoadRiskEvidenceInput } from "./roadops-quality";

export type FieldVisitInput = {
  id: string;
  name: string;
  /** The inspection target, not an asserted parking or entry location. */
  coordinate: Position;
  vehicleCoordinate: Position | null;
  dwellMinutes: number;
  accessReview: "unknown" | "confirmed" | "blocked";
  accessNote: string;
};
export type FieldScheduleInput = { startTime: string; workMinutes: number; bufferMinutes: number };
export type FieldIssue = { code: string; severity: "blocker" | "review" | "notice"; message: string; pointId?: string; legId?: string };
export type FieldEvidenceItem = {
  id: string;
  type: RoadRiskEvidenceInput["type"];
  summary: string;
  capturedAt: string | null;
  ageDays: number | null;
  freshness: "recent" | "stale" | "unknown" | "future";
  distanceMeters: number;
  legIds: string[];
  pointIds: string[];
};
export type FieldPlanReport = {
  schemaVersion: "roadops-field-report-v1";
  generatedAt: string;
  status: "needs_replan" | "blocked" | "needs_review" | "ready_with_checks";
  providerHasRoute: boolean;
  issues: FieldIssue[];
  stops: Array<{
    id: string; name: string; visitIndex: number;
    arrivalTime: string; departureTime: string; arrivalMinutes: number; departureMinutes: number;
    dwellMinutes: number; providerHasRoute: boolean; accessReview: FieldVisitInput["accessReview"];
    targetGapMeters: number; roadOffsetMeters: number | null;
    coordinate: Position; vehicleCoordinate: Position;
  }>;
  legs: Array<{
    id: string; index: number; fromId: string; toId: string; fromName: string; toName: string;
    departureTime: string; arrivalTime: string; distanceMeters: number; drivingMinutes: number;
  }>;
  totals: {
    distanceMeters: number; drivingMinutes: number; dwellMinutes: number; bufferMinutes: number;
    totalMinutes: number; workMinutes: number; overtimeMinutes: number; finishTime: string;
  };
  evidence: {
    providedCount: number; evaluatedCount: number; truncatedCount: number; matchedCount: number; unmatchedCount: number; invalidCount: number;
    unsupportedCount: number; radiusMeters: number; staleDays: number; items: FieldEvidenceItem[];
  };
  coverage: string[];
  limitations: string[];
};
export type FieldAssessmentOptions = { evidenceRadiusMeters?: number; evidenceStaleDays?: number; assessedAt?: string };

const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;
const nonnegative = (value: number) => Number.isFinite(value) && value >= 0;
const coordinateValid = (p: Position) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const longitudeDelta = (value: number) => ((value + 540) % 360) - 180;
const rounded = (value: number) => Math.round(value * 10) / 10;

function distanceMeters(a: Position, b: Position) {
  const dLat = (b[1] - a[1]) * RAD, dLon = longitudeDelta(b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/** Local metric projection onto each segment; unlike vertex-nearest checks it finds mid-segment proximity. */
export function fieldDistanceToLineMeters(point: Position, line: Position[]) {
  if (!coordinateValid(point) || line.length < 2 || !line.every(coordinateValid)) return Infinity;
  const cos = Math.cos(point[1] * RAD);
  const project = (p: Position) => [longitudeDelta(p[0] - point[0]) * RAD * EARTH_RADIUS * cos, (p[1] - point[1]) * RAD * EARTH_RADIUS];
  let nearest = Infinity;
  for (let index = 1; index < line.length; index += 1) {
    const a = project(line[index - 1]), b = project(line[index]);
    const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
    const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / length2));
    nearest = Math.min(nearest, Math.hypot(a[0] + t * dx, a[1] + t * dy));
  }
  return nearest;
}

function clockTime(minutes: number) {
  const roundedMinutes = Math.ceil(minutes - 1e-8), day = Math.floor(roundedMinutes / 1440), time = ((roundedMinutes % 1440) + 1440) % 1440;
  return `${day > 0 ? `+${day}天 ` : ""}${String(Math.floor(time / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}`;
}

function hasUsableFieldDetail(plan: RoadOpsDrivingPlan) {
  const field = plan.field;
  return Boolean(field && field.schemaVersion === "roadops-field-detail-v1" && field.guidance === "geometry_only"
    && plan.stopOrder.length >= 2 && field.legs.length === plan.stopOrder.length - 1
    && field.legs.every((leg, i) => leg.index === i + 1 && leg.fromId === plan.stopOrder[i] && leg.toId === plan.stopOrder[i + 1]
      && nonnegative(leg.distanceMeters) && nonnegative(leg.durationSeconds)
      && leg.coordinates.length >= 2 && leg.coordinates.every(coordinateValid)
      && leg.coordinates.some(point => distanceMeters(point, leg.coordinates[0]) > 0))
    && plan.stopOrder.every(id => field.access.some(item => item.pointId === id && coordinateValid(item.coordinate)
      && coordinateValid(item.roadCoordinate) && nonnegative(item.offsetMeters))));
}

export function assessFieldPlan(
  plan: RoadOpsDrivingPlan,
  visits: FieldVisitInput[],
  schedule: FieldScheduleInput,
  evidence: RoadRiskEvidenceInput[] = [],
  options: FieldAssessmentOptions = {},
): FieldPlanReport {
  const issues: FieldIssue[] = [];
  const issue = (code: string, severity: FieldIssue["severity"], message: string, pointId?: string) => issues.push({ code, severity, message, ...(pointId ? { pointId } : {}) });
  const assessedAt = options.assessedAt ?? plan.generatedAt;
  const assessedTime = Date.parse(assessedAt), routeTime = Date.parse(plan.generatedAt);
  if (!Number.isFinite(assessedTime) || !Number.isFinite(routeTime) || routeTime > assessedTime + 60_000) issue("route_time_unknown", "review", "无法可靠核验路线生成时间，请检查时钟并手动重新规划。");
  else if (assessedTime - routeTime >= 30 * 60_000) issue("route_stale", "review", `路线已生成 ${Math.floor((assessedTime - routeTime) / 60_000)} 分钟，路况与预计时长可能变化；出发前请手动重新规划。30分钟只是产品复核阈值，不代表此前保证畅通。`);
  const radius = Number.isFinite(options.evidenceRadiusMeters) && (options.evidenceRadiusMeters ?? 0) > 0 ? options.evidenceRadiusMeters! : 100;
  const staleDays = Number.isFinite(options.evidenceStaleDays) && (options.evidenceStaleDays ?? 0) > 0 ? options.evidenceStaleDays! : 30;
  const validStart = /^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.startTime);
  const start = validStart ? Number(schedule.startTime.slice(0, 2)) * 60 + Number(schedule.startTime.slice(3, 5)) : 0;
  const validWork = Number.isFinite(schedule.workMinutes) && schedule.workMinutes > 0;
  const validBuffer = nonnegative(schedule.bufferMinutes);
  if (!validStart) issue("invalid_start_time", "blocker", "出发时间必须为有效的 HH:mm（例如 08:30），当前时刻表不可使用。");
  if (!validWork || !validBuffer) issue("invalid_schedule", "blocker", "工作时长必须大于 0，预留机动时间不能为负数或非数值。");
  const workMinutes = validWork ? schedule.workMinutes : 0, bufferMinutes = validBuffer ? schedule.bufferMinutes : 0;
  const live = plan.mode === "didi_live" && plan.provider === "didi_web_service";
  const usableDetail = hasUsableFieldDetail(plan);
  const providerHasRoute = live && usableDetail;
  let needsReplan = !providerHasRoute;
  if (!providerHasRoute) issue("needs_field_replan", "review", "缺少滴图实时逐段路线及道路吸附核验，请重新生成外业路线；现有概览或回放不能用于确认到达。");
  const byId = new Map(visits.map(visit => [visit.id, visit]));
  if (byId.size !== visits.length) issue("duplicate_visit", "blocker", "核查点 ID 重复，无法可靠关联路线与任务。");
  for (const visit of visits) {
    if (!coordinateValid(visit.coordinate) || (visit.vehicleCoordinate !== null && !coordinateValid(visit.vehicleCoordinate))) issue("invalid_coordinate", "blocker", `${visit.name} 的坐标无效。`, visit.id);
    if (!nonnegative(visit.dwellMinutes)) issue("invalid_dwell", "blocker", `${visit.name} 的停留时长无效。`, visit.id);
    if (!plan.stopOrder.includes(visit.id)) issue("unplanned_visit", "blocker", `${visit.name} 未包含在本次路线中，请重新规划。`, visit.id);
  }
  const stops: FieldPlanReport["stops"] = [], legs: FieldPlanReport["legs"] = [];
  let elapsed = 0, drivingMinutes = 0, dwellMinutes = 0, totalDistanceMeters = 0;
  plan.stopOrder.forEach((id, index) => {
    const visit = byId.get(id);
    if (!visit) { issue("missing_visit", "blocker", `路线中的点 ${id} 缺少核查任务信息。`, id); return; }
    const leg = providerHasRoute && index > 0 ? plan.field!.legs[index - 1] : null;
    if (leg) {
      const minutes = leg.durationSeconds / 60;
      const departureTime = validStart ? clockTime(start + elapsed) : "未设置";
      elapsed += minutes; drivingMinutes += minutes; totalDistanceMeters += leg.distanceMeters;
      legs.push({ id: leg.id, index: leg.index, fromId: leg.fromId, toId: leg.toId, fromName: byId.get(leg.fromId)?.name ?? leg.fromId, toName: visit.name,
        departureTime, arrivalTime: validStart ? clockTime(start + elapsed) : "未设置", distanceMeters: leg.distanceMeters, drivingMinutes: minutes });
    }
    const access = providerHasRoute ? plan.field!.access.find(item => item.pointId === id) : undefined;
    const effective = visit.vehicleCoordinate ?? visit.coordinate;
    const validCoordinates = coordinateValid(effective) && coordinateValid(visit.coordinate);
    const targetGap = validCoordinates ? distanceMeters(effective, visit.coordinate) : 0;
    const accessReview = visit.accessReview === "confirmed" && !visit.accessNote.trim() ? "unknown" : visit.accessReview;
    if (accessReview === "blocked") issue("manual_blocked", "blocker", `${visit.name} 已人工标记不可进入：${visit.accessNote.trim() || "尚未记录原因"}。调整停靠点或任务后重新规划。`, id);
    else if (accessReview !== "confirmed") issue("access_unknown", "review", `${visit.name} 的停车/入口/最后一段进入方式未核实。${visit.accessReview === "confirmed" ? "勾选确认但未填写依据，仍按未核实处理。" : ""}`, id);
    if (access && validCoordinates && distanceMeters(access.coordinate, effective) > 5) {
      needsReplan = true;
      issue("stale_stop_coordinate", "review", `${visit.name} 的驾车位置已变化，当前路线不能沿用，请重新规划。`, id);
    }
    if (access && access.offsetMeters > 50) issue("road_offset", "review", `${visit.name} 的驾车位置距返回路线约 ${Math.round(access.offsetMeters)} 米，超过 50 米提示阈值，不能据此确认车辆可达。`, id);
    if (targetGap > 50 && accessReview !== "confirmed") issue("target_gap", "review", `${visit.name} 的停靠位置距核查目标直线约 ${Math.round(targetGap)} 米；入口、步行路径和所需时间尚未核实。`, id);
    else if (targetGap > 0) issue("target_transfer", "notice", `${visit.name} 停靠点至核查目标直线约 ${Math.round(targetGap)} 米，不是步行路线或耗时；现场转移时间需包含在该点停留时长中。`, id);
    const dwell = index === 0 || id === plan.stopOrder[0] ? 0 : (nonnegative(visit.dwellMinutes) ? visit.dwellMinutes : 0);
    const arrivalMinutes = elapsed;
    elapsed += dwell; dwellMinutes += dwell;
    stops.push({ id, name: visit.name, visitIndex: index, arrivalTime: providerHasRoute && validStart ? clockTime(start + arrivalMinutes) : "待重新规划",
      departureTime: providerHasRoute && validStart ? clockTime(start + elapsed) : "待重新规划", arrivalMinutes, departureMinutes: elapsed, dwellMinutes: dwell,
      providerHasRoute, accessReview, targetGapMeters: rounded(targetGap), roadOffsetMeters: access ? rounded(access.offsetMeters) : null,
      coordinate: [...visit.coordinate], vehicleCoordinate: [...effective] });
  });
  const totalMinutes = drivingMinutes + dwellMinutes + bufferMinutes;
  const overtimeMinutes = Math.max(0, totalMinutes - workMinutes);
  if (providerHasRoute && overtimeMinutes > 0) issue("work_overtime", "blocker", `驾车、停留及机动时间合计 ${Math.ceil(totalMinutes)} 分钟，超出工作时长 ${Math.ceil(overtimeMinutes)} 分钟；请减少任务或调整时间。`);
  if (plan.status === "infeasible" && !issues.some(item => item.code === "work_overtime")) issue("previous_budget", "notice", "路线生成时的旧工时判定为不可行；本任务单已按当前停留、机动和工时重新核算，不复用旧工时结论。");

  const evidenceItems: FieldEvidenceItem[] = [];
  let invalidCount = 0, unsupportedCount = 0, unmatchedCount = 0;
  const generated = assessedTime;
  const evaluatedEvidence = evidence.slice(0, 200);
  const truncatedCount = evidence.length - evaluatedEvidence.length;
  if (truncatedCount > 0) issue("evidence_truncated", "review", `为控制本地计算量，本次只评估输入的前 200 条证据，另 ${truncatedCount} 条未评估；未发现邻近证据不代表风险已排除，请先缩小数据范围。`);
  for (const item of evaluatedEvidence) {
    if (!["insar", "landslide", "field_photo"].includes(item.type)) { unsupportedCount += 1; continue; }
    const point: Position = [item.longitude, item.latitude];
    if (!coordinateValid(point)) { invalidCount += 1; continue; }
    const legDistances = providerHasRoute ? plan.field!.legs.map(leg => ({ id: leg.id, distance: fieldDistanceToLineMeters(point, leg.coordinates) })) : [];
    const pointDistances = visits.filter(visit => coordinateValid(visit.coordinate)).map(visit => ({ id: visit.id, distance: distanceMeters(point, visit.coordinate) }));
    const legIds = legDistances.filter(entry => entry.distance <= radius).map(entry => entry.id);
    const pointIds = pointDistances.filter(entry => entry.distance <= radius).map(entry => entry.id);
    if (!legIds.length && !pointIds.length) { unmatchedCount += 1; continue; }
    const captured = item.capturedAt ? Date.parse(item.capturedAt) : NaN;
    const ageDays = Number.isFinite(generated) && Number.isFinite(captured) ? (generated - captured) / 86400000 : null;
    const freshness = ageDays === null ? "unknown" : ageDays < 0 ? "future" : ageDays >= staleDays ? "stale" : "recent";
    evidenceItems.push({ id: item.id, type: item.type, summary: item.summary, capturedAt: item.capturedAt ?? null, ageDays: ageDays === null ? null : rounded(ageDays), freshness,
      distanceMeters: rounded(Math.min(...legDistances.map(entry => entry.distance), ...pointDistances.map(entry => entry.distance))), legIds, pointIds });
  }
  if (evidenceItems.length) issue("nearby_evidence", "review", `路线或核查目标 ${radius} 米内关联 ${evidenceItems.length} 条已有证据，仅提示邻近风险，尚未确认影响通行；不自动绕行或认定封路。`);
  if (evidenceItems.some(item => item.freshness !== "recent")) issue("evidence_age", "notice", `部分邻近证据缺少可靠时间或达到 ${staleDays} 天复核提示阈值；该阈值只是产品提示规则，不是证据失效或道路状态判定。`);
  if (invalidCount || unsupportedCount) issue("evidence_excluded", "notice", `${invalidCount} 条无效坐标、${unsupportedCount} 条非本次支持类型的证据未参与空间关联。`);
  const hasBlocked = issues.some(item => item.severity === "blocker");
  const status = hasBlocked ? "blocked" : needsReplan ? "needs_replan" : issues.some(item => item.severity === "review") ? "needs_review" : "ready_with_checks";
  const coverage = [
    `驾车路线：${providerHasRoute ? "滴图实时逐段路线" : "缺少可验收的实时逐段路线"}，路线生成时间 ${plan.generatedAt}。`,
    `本地核验时间：${assessedAt}；时间经过本身不会触发地图接口。`,
    `现有证据：输入 ${evidence.length} 条，本次评估前 ${evaluatedEvidence.length} 条，${truncatedCount} 条未评估；${radius} 米范围内关联 ${evidenceItems.length} 条（现场照片 ${evidenceItems.filter(item => item.type === "field_photo").length} 条）。`,
    "车辆按普通小客车；未接入现场封路、禁入、施工、道路坡度、限高限宽、路面承载、合法停车及入口许可数据。",
    "地图商返回可算路线不等于核查目标可进入；人工确认只记录核实情况，不构成安全保证。",
  ];
  const limitations = [...new Set([
    ...(plan.field?.limitations ?? []),
    "本工具提供外业行程与真实路线预览，不提供逐转向、语音或实时定位导航；没有真实转向字段，不生成左右转指令。",
    "道路偏移 50 米与证据邻近半径为复核提示阈值，不是可达性结论。坐标转换及路线吸附可能存在误差。",
    "停靠点到目标仅计算直线距离，未计算步行路线或步行耗时；现场转移、停车与核查时间需由执行人计入停留时长。",
    "出发时刻仅用于本地排程；ETA 使用规划时返回的分段时长，不预测指定出发时段或未来路况。机动时间统一保留在行程末尾，不能代替具体风险核验。",
    "无额外现场数据时不能确认可通行；出发前复核路况和进入许可，驾驶中不得操作本页面。",
  ])];
  return { schemaVersion: "roadops-field-report-v1", generatedAt: plan.generatedAt, status, providerHasRoute, issues, stops, legs,
    totals: { distanceMeters: totalDistanceMeters, drivingMinutes, dwellMinutes, bufferMinutes, totalMinutes, workMinutes, overtimeMinutes,
      finishTime: providerHasRoute && validStart ? clockTime(start + totalMinutes) : "待重新规划" },
    evidence: { providedCount: evidence.length, evaluatedCount: evaluatedEvidence.length, truncatedCount, matchedCount: evidenceItems.length, unmatchedCount, invalidCount, unsupportedCount, radiusMeters: radius, staleDays, items: evidenceItems },
    coverage, limitations };
}

const statusLabel: Record<FieldPlanReport["status"], string> = { needs_replan: "需要重新生成逐段路线", blocked: "当前任务不可执行", needs_review: "待核验，不可视为已可达", ready_with_checks: "已记录核验，仍需出发前复核" };
const cleanText = (value: string) => Array.from(value, character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? " " : character).join("").replace(/\s+/g, " ").trim();
const coordinatesText = (value: Position) => `${value[0].toFixed(6)}, ${value[1].toFixed(6)}`;

/** A local text task brief, deliberately excluding full supplier geometry and credentials. */
export function buildFieldBrief(report: FieldPlanReport, plan: RoadOpsDrivingPlan, visits: FieldVisitInput[]) {
  const byId = new Map(visits.map(visit => [visit.id, visit]));
  const lines = ["外业小客车核查任务单", `状态：${statusLabel[report.status]}`, `路线来源：${report.providerHasRoute ? "滴图驾车 Web Service" : "未确认实时逐段路线"}`,
    `路线生成时间：${cleanText(plan.generatedAt)}`, "坐标：WGS84 展示坐标（经度, 纬度）；不能直接当作 GCJ-02 输入其他导航应用。", "",
    `驾车 ${report.totals.drivingMinutes.toFixed(1)} 分钟 / ${(report.totals.distanceMeters / 1000).toFixed(2)} 公里；停留 ${report.totals.dwellMinutes} 分钟；机动 ${report.totals.bufferMinutes} 分钟。`,
    `总计 ${report.totals.totalMinutes.toFixed(1)} 分钟 / 工时预算 ${report.totals.workMinutes} 分钟；含机动预计结束 ${report.totals.finishTime}。`, "", "逐段行程（无逐转向指令）"];
  for (const leg of report.legs) {
    const from = byId.get(leg.fromId), to = byId.get(leg.toId);
    lines.push(`${leg.index}. ${cleanText(leg.fromName)} → ${cleanText(leg.toName)} | ${leg.departureTime}–${leg.arrivalTime} | ${(leg.distanceMeters / 1000).toFixed(2)} km / ${leg.drivingMinutes.toFixed(1)} min`);
    if (from && to) lines.push(`   驾车起终坐标：${coordinatesText(from.vehicleCoordinate ?? from.coordinate)} → ${coordinatesText(to.vehicleCoordinate ?? to.coordinate)}`);
  }
  if (!report.legs.length) lines.push("未生成可用的真实逐段行程，不能用直线连点代替。");
  lines.push("", "逐站任务与进入核验");
  for (const stop of report.stops) {
    const visit = byId.get(stop.id);
    lines.push(`${stop.visitIndex}. ${cleanText(stop.name)} | ${stop.arrivalTime}–${stop.departureTime} | 停留 ${stop.dwellMinutes} min`,
      `   核查目标：${coordinatesText(stop.coordinate)}；驾车位置：${coordinatesText(stop.vehicleCoordinate)}`,
      `   进入核验：${stop.accessReview === "confirmed" ? "已记录人工确认" : stop.accessReview === "blocked" ? "不可进入" : "未核实"}；道路偏移 ${stop.roadOffsetMeters === null ? "未知" : `${stop.roadOffsetMeters} m`}；到目标直线差距 ${stop.targetGapMeters} m（未算步行耗时）`,
      `   核验备注：${cleanText(visit?.accessNote ?? "") || "无"}`);
  }
  lines.push("", "待办 / 阻断项", ...report.issues.map(item => `- [${item.severity}] ${cleanText(item.message)}`));
  if (!report.issues.length) lines.push("无自动阻断项；这不表示道路或现场安全已获保证。");
  lines.push("", "证据覆盖与时间", ...report.coverage.map(item => `- ${cleanText(item)}`));
  for (const item of report.evidence.items) lines.push(`- ${cleanText(item.id)} / ${item.type}：${cleanText(item.summary)}；采集时间 ${cleanText(item.capturedAt ?? "未知")}；时间标记 ${item.freshness}；距路线/目标 ${item.distanceMeters} m。`);
  lines.push("", "使用边界", ...report.limitations.map(item => `- ${cleanText(item)}`), "", "本任务单不含地图商完整路线几何，不代表通行许可或安全保证。");
  return `${lines.join("\n")}\n`;
}
