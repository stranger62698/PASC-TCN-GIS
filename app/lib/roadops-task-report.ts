import { parseFieldTaskPlan, type FieldTaskPlan } from "./roadops-task-plan";
import { compileFieldTaskRouting, type FieldRoutingPreparation, type FieldRoutingVisit, type FieldTaskDeferred, type FieldTaskRouteReceipt } from "./roadops-task-routing";

type Coordinate = [number, number];
export type FieldTaskReportIssue = {
  code: string; severity: "blocker" | "review" | "notice"; message: string;
  visitId?: string; taskId?: string;
};
export type FieldTaskVisitReport = {
  visitId: string; stopId: string; visitIndex: number; role: "origin" | "candidate" | "destination";
  coordinate: Coordinate; arrivalMinutes: number; departureMinutes: number;
  arrivalTime: string; departureTime: string; dwellMinutes: number;
  roadEvidence: {
    arrivalOffsetMeters: number | null; departureOffsetMeters: number | null;
    arrivalDepartureGapMeters: number | null;
    /** Absent first-arrival/last-departure evidence is not zero offset or safe access. */
    source: "provider_leg_endpoints" | "not_requested";
  };
  tasks: Array<{
    taskId: string; name: string; targetCoordinate: Coordinate; targetGapMeters: number;
    dwellMinutes: number; startMinutes: number; endMinutes: number; startTime: string; endTime: string;
    accessStatus: "needs_review"; legacyAccessReview: "unknown" | "confirmed";
    lastMileMinutes: null;
  }>;
};
/** In-memory report only. Supplier-derived times/distances are not a draft or export format. */
export type FieldTaskReport = {
  schemaVersion: "field-task-report-v1"; planId: string; revision: number;
  mode: "driving" | "no_station_driving"; status: "needs_review" | "blocked";
  providerHasRoute: boolean; generatedAt: string | null; assessedAt: string;
  routeAgeMinutes: number | null; visits: FieldTaskVisitReport[];
  planningGoal?: FieldTaskPlan["planningGoal"];
  selectedTaskIds: string[]; deferredTasks: FieldTaskDeferred[];
  legs: Array<{
    id: string; fromVisitId: string; toVisitId: string; fromStopId: string; toStopId: string;
    departureMinutes: number; arrivalMinutes: number; departureTime: string; arrivalTime: string;
    distanceMeters: number; drivingMinutes: number;
  }>;
  totals: {
    drivingMinutes: number; distanceMeters: number; dwellMinutes: number; bufferMinutes: number;
    totalMinutes: number; workMinutes: number; overtimeMinutes: number; finishTime: string;
    durationCoverage: "user_entered_dwell_only";
  };
  issues: FieldTaskReportIssue[]; limitations: string[];
};

function fail(message: string): never { throw new Error(`外业访问报告：${message}`); }
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const nonnegative = (value: number) => Number.isFinite(value) && value >= 0;
const validCoordinate = (value: Coordinate) => Array.isArray(value) && value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;

function distanceMeters(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180, latitude = (b[1] - a[1]) * rad, longitude = ((b[0] - a[0] + 540) % 360 - 180) * rad;
  const h = Math.sin(latitude / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(longitude / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

function clock(minutes: number) {
  const whole = Math.ceil(minutes - 1e-8), day = Math.floor(whole / 1440), local = whole % 1440;
  return `${day > 0 ? `+${day}天 ` : ""}${String(Math.floor(local / 60)).padStart(2, "0")}:${String(local % 60).padStart(2, "0")}`;
}

/** Recheck local identity/order before consuming an in-memory receipt; no stale report fallback. */
function receiptVisits(preparation: FieldRoutingPreparation, receipt: FieldTaskRouteReceipt | null): FieldRoutingVisit[] {
  if (preparation.mode === "no_station_driving") {
    if (receipt !== null) fail("同站任务不接受供应商路线回执。");
    return preparation.visits;
  }
  if (!receipt || receipt.planId !== preparation.planId || receipt.revision !== preparation.revision || receipt.inputSignature !== preparation.inputSignature) fail("路线与当前任务不一致或缺失，请手动重新规划；未沿用旧结果。");
  if (!Array.isArray(receipt.selectedTaskIds) || !Array.isArray(receipt.deferredTasks) || receipt.planningGoal !== preparation.planningGoal
    || receipt.deferredTasks.some(task => !task || !["time_budget", "unreachable", "access_blocked", "input_incomplete"].includes(task.reason) || typeof task.detail !== "string" || task.detail.length > 4000)) fail("任务执行与延期集合无效，未生成报告。");
  const selected = new Set(receipt.selectedTaskIds);
  const all = [...receipt.selectedTaskIds, ...receipt.deferredTasks.map(task => task.taskId)];
  const expectedTasks = preparation.taskAliases.map(task => task.taskId);
  if (new Set(all).size !== expectedTasks.length || all.length !== expectedTasks.length || all.some(id => !expectedTasks.includes(id))
    || preparation.deferredTasks.some(task => selected.has(task.taskId))) fail("任务执行与延期集合不完整或失效，未生成报告。");
  const canonicalVisits = preparation.visits.map(visit => ({ ...visit, taskIds: visit.taskIds.filter(id => selected.has(id)),
    dwellMinutes: visit.taskIds.filter(id => selected.has(id)).reduce((sum, id) => {
      const original = preparation.visits.find(item => item.taskIds.includes(id))!;
      // Per-task dwell comes from the request when personalized; legacy keeps whole visits.
      const alias = preparation.taskAliases.find(task => task.taskId === id)!;
      return sum + (preparation.request?.fieldTasks?.find(task => task.taskId === alias.alias)?.dwellSeconds ?? original.dwellMinutes * 60) / 60;
    }, 0) })).filter((visit, index, visits) => !(preparation.planningGoal === "coverage" || preparation.planningGoal === "priority") || index === 0 || index === visits.length - 1 || visit.taskIds.length > 0);
  // Legacy visits may contain several tasks. Their canonical whole-visit dwell is unchanged.
  if (!preparation.planningGoal) canonicalVisits.forEach(visit => { visit.dwellMinutes = preparation.visits.find(item => item.visitId === visit.visitId)!.dwellMinutes; });
  const canonical = new Map(canonicalVisits.map(visit => [visit.visitId, visit]));
  const visits = receipt.visits;
  if (!Array.isArray(visits) || visits.length !== canonicalVisits.length || new Set(visits.map(visit => visit?.visitId)).size !== visits.length
    || visits.some(visit => !visit || !equal(visit, canonical.get(visit.visitId)))
    || visits[0].visitId !== preparation.visits[0].visitId || visits.at(-1)!.visitId !== preparation.visits.at(-1)!.visitId
    || (preparation.request?.orderMode === "input" && visits.some((visit, index) => visit.visitId !== canonicalVisits[index].visitId))) fail("到访与任务绑定不完整或顺序不符，未生成报告。");
  if (!Array.isArray(receipt.legs) || receipt.legs.length !== visits.length - 1 || !Number.isFinite(Date.parse(receipt.generatedAt))) fail("逐段路线或生成时间无效。");
  receipt.legs.forEach((leg, index) => {
    const from = visits[index], to = visits[index + 1];
    if (!leg || leg.id !== JSON.stringify([from.visitId, to.visitId]) || leg.fromVisitId !== from.visitId || leg.toVisitId !== to.visitId
      || leg.index !== index + 1 || leg.fromStopId !== from.stopId || leg.toStopId !== to.stopId || leg.fromId !== from.pointId || leg.toId !== to.pointId
      || !nonnegative(leg.durationSeconds) || !nonnegative(leg.distanceMeters) || !Array.isArray(leg.coordinates) || leg.coordinates.length < 2
      || !leg.coordinates.every(validCoordinate) || !leg.coordinates.some(point => !equal(point, leg.coordinates[0]))) fail("存在缺失、错配或无效的有向路段，未用连点线替代。");
  });
  if (!Number.isFinite(receipt.legs.reduce((sum, leg) => sum + leg.durationSeconds, 0)) || !Number.isFinite(receipt.legs.reduce((sum, leg) => sum + leg.distanceMeters, 0))) fail("分段累计时距溢出，未生成时刻表。");
  return visits;
}

/**
 * Schedule each occurrence/task once. Caller supplies the assessment clock explicitly.
 * No fetch, cache refresh, persistence, safety certification, or walking estimate.
 */
export function buildFieldTaskReport(value: FieldTaskPlan, receipt: FieldTaskRouteReceipt | null, options: { assessedAt: string; inputExclusions?: Record<string, string> }): FieldTaskReport {
  const plan = parseFieldTaskPlan(value), preparation = compileFieldTaskRouting(plan, {}, { excludedTaskReasons: receipt?.inputExclusions ?? options.inputExclusions });
  const ordered = receiptVisits(preparation, receipt), assessedTime = Date.parse(options.assessedAt);
  if (!Number.isFinite(assessedTime)) fail("本地复核时间无效。");
  const tasks = new Map(plan.tasks.map(task => [task.taskId, task]));
  const roles = new Map(plan.visits.map(visit => [visit.visitId, visit.role]));
  const issues: FieldTaskReportIssue[] = [];
  const selectedTaskIds = receipt?.selectedTaskIds ?? preparation.selectedTaskIds;
  const deferredTasks = receipt?.deferredTasks ?? preparation.deferredTasks;
  if (plan.tasks.some(task => task.required && !selectedTaskIds.includes(task.taskId))) fail("执行集合缺少必查任务，未生成报告。");
  const issue = (code: string, severity: FieldTaskReportIssue["severity"], message: string, visitId?: string, taskId?: string) => issues.push({ code, severity, message, ...(visitId ? { visitId } : {}), ...(taskId ? { taskId } : {}) });
  const generatedAt = receipt?.generatedAt ?? null, age = generatedAt === null ? null : (assessedTime - Date.parse(generatedAt)) / 60000;
  const routeAgeMinutes = age !== null && age >= 0 ? age : null;
  if (age !== null && age < 0) issue("route_time_future", "review", "路线生成时间晚于本地复核时间，需检查时钟并手动复核；未重写供应方时间。");
  else if (age !== null && age >= 30) issue("route_stale", "review", "路线已达到 30 分钟复核提示阈值，请出发前手动复核路况；阈值内也不保证畅通。");
  if (preparation.mode === "no_station_driving") issue("no_station_driving", "notice", "本次执行安排共用一个车辆停靠点，无需站间驾车；未请求地图商，不代表车辆能够到达此处。");
  issue("duration_coverage", "review", "停留按用户填写的人工总时长计入；停车、核查与最后一段转移尚未拆分核实，不代表完整现场耗时。");
  const start = Number(plan.startTime.slice(0, 2)) * 60 + Number(plan.startTime.slice(3, 5));
  const legs: FieldTaskReport["legs"] = [], visits: FieldTaskVisitReport[] = [];
  let elapsed = 0, drivingMinutes = 0, totalDistance = 0;
  ordered.forEach((visit, index) => {
    issue("vehicle_access_unknown", "review", "本次到访的车辆接近、停车和出入条件仍待核验；无核查任务的起终到访也不等于已可达。", visit.visitId);
    const incoming = receipt?.legs[index - 1], outgoing = receipt?.legs[index];
    if (incoming) {
      const minutes = incoming.durationSeconds / 60, departure = elapsed;
      elapsed += minutes; drivingMinutes += minutes; totalDistance += incoming.distanceMeters;
      legs.push({ id: incoming.id, fromVisitId: incoming.fromVisitId, toVisitId: incoming.toVisitId, fromStopId: incoming.fromStopId, toStopId: incoming.toStopId,
        departureMinutes: departure, arrivalMinutes: elapsed, departureTime: clock(start + departure), arrivalTime: clock(start + elapsed), distanceMeters: incoming.distanceMeters, drivingMinutes: minutes });
    }
    // Use each directed leg's endpoints. A physical-stop maximum offset loses occurrence evidence.
    const arrival = incoming?.coordinates.at(-1) ?? null, departure = outgoing?.coordinates[0] ?? null;
    const arrivalOffset = arrival === null ? null : distanceMeters(visit.coordinate, arrival);
    const departureOffset = departure === null ? null : distanceMeters(visit.coordinate, departure);
    const endpointGap = arrival === null || departure === null ? null : distanceMeters(arrival, departure);
    if (arrivalOffset !== null && arrivalOffset > 50) issue("arrival_road_offset", "review", "到达路段终点与指定车辆位置偏移超过 50 米，需核实到达位置；不是车辆可达判定。", visit.visitId);
    if (departureOffset !== null && departureOffset > 50) issue("departure_road_offset", "review", "离开路段起点与指定车辆位置偏移超过 50 米，需核实出发位置；不是车辆可达判定。", visit.visitId);
    if (endpointGap !== null && endpointGap > 50) issue("arrival_departure_gap", "review", "到达与离开道路端点相距超过 50 米，请核实路侧和站内转移；不据此认定存在隔离带，也不画连接线表示可通行。", visit.visitId);
    const arrivalMinutes = elapsed;
    const taskReports: FieldTaskVisitReport["tasks"] = visit.taskIds.map(taskId => {
      const task = tasks.get(taskId)!, begin = elapsed;
      elapsed += task.dwellMinutes;
      issue(task.legacyAccessReview === "confirmed" ? "legacy_confirmation_needs_review" : "access_unknown", "review",
        task.legacyAccessReview === "confirmed" ? "原人工确认缺少结构化核验依据、时间及有效期，不能升级为入口已核验。" : "车辆接近、合法停车、入口许可和最后一段进入条件未核验。", visit.visitId, taskId);
      const gap = distanceMeters(visit.coordinate, task.targetCoordinate!);
      if (gap > 0) issue("target_transfer_unverified", "review", "车辆位置与核查目标有直线差距，最后一段路径及耗时未核实；不推算步行耗时。", visit.visitId, taskId);
      return { taskId, name: task.name, targetCoordinate: [...task.targetCoordinate!] as Coordinate, targetGapMeters: gap,
        dwellMinutes: task.dwellMinutes, startMinutes: begin, endMinutes: elapsed, startTime: clock(start + begin), endTime: clock(start + elapsed),
        accessStatus: "needs_review", legacyAccessReview: task.legacyAccessReview as "unknown" | "confirmed", lastMileMinutes: null };
    });
    visits.push({ visitId: visit.visitId, stopId: visit.stopId, visitIndex: index, role: roles.get(visit.visitId)!, coordinate: [...visit.coordinate],
      arrivalMinutes, departureMinutes: elapsed, arrivalTime: clock(start + arrivalMinutes), departureTime: clock(start + elapsed), dwellMinutes: visit.dwellMinutes,
      roadEvidence: { arrivalOffsetMeters: arrivalOffset, departureOffsetMeters: departureOffset, arrivalDepartureGapMeters: endpointGap, source: receipt ? "provider_leg_endpoints" : "not_requested" }, tasks: taskReports });
  });
  const totalMinutes = elapsed + plan.bufferMinutes, overtimeMinutes = Math.max(0, totalMinutes - plan.workMinutes);
  if (overtimeMinutes > 0) issue("work_overtime", "blocker", "已知驾车、人工停留与机动时间超出可用工时，请调整方案；未知转移耗时可能进一步增加总时长。");
  if (start + totalMinutes >= 1440) issue("cross_midnight", "review", "预计行程跨过午夜，已标记次日时刻；本期不支持多日任务与跨日时窗，请调整或拆分计划。");
  return { schemaVersion: "field-task-report-v1", planId: plan.planId, revision: plan.revision, mode: preparation.mode,
    status: overtimeMinutes > 0 ? "blocked" : "needs_review", providerHasRoute: receipt !== null, generatedAt, assessedAt: options.assessedAt, routeAgeMinutes, visits, legs,
    ...(plan.planningGoal ? { planningGoal: plan.planningGoal } : {}), selectedTaskIds: [...selectedTaskIds], deferredTasks: deferredTasks.map(task => ({ ...task })),
    totals: { drivingMinutes, distanceMeters: totalDistance, dwellMinutes: visits.reduce((sum, visit) => sum + visit.dwellMinutes, 0), bufferMinutes: plan.bufferMinutes, totalMinutes,
      workMinutes: plan.workMinutes, overtimeMinutes, finishTime: clock(start + totalMinutes), durationCoverage: "user_entered_dwell_only" }, issues,
    limitations: [
      "这是访问实例行程预估，不提供逐转向、语音或实时定位导航；路线存在与几何偏移小均不证明现场安全或可进入。",
      "到达/离开偏移 50 米和路线 30 分钟是产品复核提示阈值，不是安全标准；不从几何差距判断封路或隔离带。",
      "出发时刻只平移本地时刻表，使用返回的分段时长，不预测未来交通；最终机动时间只计一次。",
      "本站任务按明确顺序逐项执行，人工总停留不额外叠加假定停车或转移时间；未核实的最后一段耗时仍为未知。",
      "未接入额外现场封路、入口许可、停车、限高限宽或风险资料；未发现提示不等于无风险。",
      "本报告含供应商派生时距，仅内存使用；尚不提供持久化或新增打包导出。",
    ] };
}
