import { assertRoadOpsPlanningMatches, parseRoadOpsDrivingPlan, type RoadOpsDrivingLeg, type RoadOpsDrivingRequest } from "./roadops-driving";
import type { NavigationAnalysisContext } from "./roadops-navigation";
import { fieldTaskInspectionIssues, parseFieldTaskPlan, type FieldPlanningGoal, type FieldTaskPlan } from "./roadops-task-plan";

export type FieldTaskDeferred = { taskId: string; reason: "time_budget" | "unreachable" | "access_blocked" | "input_incomplete"; detail: string };
export type FieldRoutingOptions = { excludedTaskReasons?: Record<string, string> };

/** FP2 core only. No network, persistence, or implicit migration of the current editor. */
export type FieldRoutingVisit = {
  visitId: string; stopId: string; pointId: string; taskIds: string[];
  coordinate: [number, number]; dwellMinutes: number;
};
export type FieldRoutingPreparation = {
  planId: string; revision: number;
  /** Local canonical snapshot; includes private inputs. Never send, log, or persist with supplier data. */
  inputSignature: string;
  mode: "driving" | "no_station_driving";
  request: RoadOpsDrivingRequest | null;
  visits: FieldRoutingVisit[];
  selectedTaskIds: string[]; deferredTasks: FieldTaskDeferred[];
  taskAliases: Array<{ taskId: string; alias: string; pointId: string }>;
  inputExclusions: Record<string, string>; planningGoal?: FieldPlanningGoal;
  localDwellMinutes: number; bufferMinutes: number; workMinutes: number;
};
export type FieldTaskRouteLeg = RoadOpsDrivingLeg & {
  providerLegId: string; fromVisitId: string; toVisitId: string;
  fromStopId: string; toStopId: string;
};
export type FieldTaskRouteReceipt = {
  planId: string; revision: number; generatedAt: string;
  /** Private local binding only; never render, log, export, or persist this snapshot. */
  inputSignature: string;
  visits: FieldRoutingVisit[]; legs: FieldTaskRouteLeg[];
  drivingMinutes: number; localDwellMinutes: number; bufferMinutes: number;
  totalMinutes: number; overtimeMinutes: number;
  /** Route geometry is not proof of parking, permission, last-mile access, or safety. */
  accessStatus: "needs_review";
  endpointEvidence: Array<{ visitId: string; arrival: [number, number] | null; departure: [number, number] | null }>;
  selectedTaskIds: string[]; deferredTasks: FieldTaskDeferred[];
  inputExclusions: Record<string, string>; planningGoal?: FieldPlanningGoal;
};

function fail(message: string): never { throw new Error(`外业停靠规划：${message}`); }
const sameCoordinate = (left: [number, number] | null, right: [number, number] | null) => JSON.stringify(left) === JSON.stringify(right);
const coordinateKey = (value: [number, number]) => value.map(number => Number(number.toFixed(6))).join(",");

/** Compile only physical vehicle stops; task targets and notes are kept out of the request. */
export function compileFieldTaskRouting(value: FieldTaskPlan, context: NavigationAnalysisContext = {}, options: FieldRoutingOptions = {}): FieldRoutingPreparation {
  const plan = parseFieldTaskPlan(value);
  const selectionGoal = plan.planningGoal === "coverage" || plan.planningGoal === "priority";
  const inspectionIssues = fieldTaskInspectionIssues(plan, context);
  const exclusionEntries = Object.entries(options.excludedTaskReasons ?? {});
  for (const [taskId, reason] of exclusionEntries) {
    if (!plan.tasks.some(task => task.taskId === taskId) || typeof reason !== "string" || !reason.trim() || reason.length > 4000) fail("排除依据或任务 ID 无效。");
  }
  const inputExclusions: Record<string, string> = Object.fromEntries(exclusionEntries);
  const deferredTasks: FieldTaskDeferred[] = [];
  for (const task of plan.tasks) {
    const inspectionIssue = inspectionIssues.find(issue => issue.taskId === task.taskId);
    const blocked = task.legacyAccessReview === "blocked" || (Object.hasOwn(inputExclusions, task.taskId) ? inputExclusions[task.taskId] : undefined);
    const incomplete = inspectionIssue?.message ?? (task.targetCoordinate === null ? "核查目标坐标未选择。" : null);
    if (blocked || incomplete) {
      if (!selectionGoal || task.required) fail(blocked ? `“${task.name}”存在明确不可进入的任务或核验阻断，请先调整或补充解除依据，未跳过该任务。` : incomplete!);
      deferredTasks.push({ taskId: task.taskId, reason: blocked ? "access_blocked" : "input_incomplete", detail: typeof blocked === "string" ? blocked : blocked ? "已有人工禁入记录，未解除。" : incomplete! });
    }
  }
  if (plan.date !== null) fail("指定日期和未来 ETA 尚未接入，未忽略日期发起当前路况规划。");
  if (!plan.planningGoal && plan.tasks.some(task => !task.required)) fail("可延期任务须在后续排程中显式处理，未删除或改为必访。");
  if (plan.stops.some(stop => stop.coordinate === null)) fail("仍有目标或车辆坐标未选择；可以保存草稿，但不能编译完整行程。");
  const taskById = new Map(plan.tasks.map(task => [task.taskId, task]));
  const stopById = new Map(plan.stops.map(stop => [stop.stopId, stop]));
  const aliases = new Map<string, string>();
  // Transport aliases fit v1's restricted ID syntax without rewriting user-owned identities.
  plan.visits.forEach(visit => { if (!aliases.has(visit.stopId)) aliases.set(visit.stopId, `field-stop-${aliases.size + 1}`); });
  const visits = plan.visits.map(visit => {
    const stop = stopById.get(visit.stopId)!;
    if (!stop.usesVehicleCoordinate && visit.taskIds.some(id => !deferredTasks.some(task => task.taskId === id) && !sameCoordinate(taskById.get(id)!.targetCoordinate, stop.coordinate))) fail("共用停靠与目标不一致时须显式设置车辆到达位置，未自动吸附或合并入口。");
    return { visitId: visit.visitId, stopId: visit.stopId, pointId: aliases.get(visit.stopId)!,
      taskIds: [...visit.taskIds], coordinate: [...stop.coordinate!] as [number, number],
      dwellMinutes: visit.taskIds.reduce((sum, id) => sum + taskById.get(id)!.dwellMinutes, 0) };
  });
  const taskAliases = plan.tasks.map((task, index) => ({ taskId: task.taskId, alias: `field-task-${index + 1}`, pointId: visits.find(visit => visit.taskIds.includes(task.taskId))!.pointId }));
  const base = { planId: plan.planId, revision: plan.revision, inputSignature: Object.keys(inputExclusions).length ? JSON.stringify({ plan, inputExclusions }) : JSON.stringify(plan), visits,
    taskAliases, inputExclusions, selectedTaskIds: plan.tasks.filter(task => !deferredTasks.some(deferred => deferred.taskId === task.taskId)).map(task => task.taskId), deferredTasks,
    ...(plan.planningGoal ? { planningGoal: plan.planningGoal } : {}),
    localDwellMinutes: visits.reduce((sum, visit) => sum + visit.dwellMinutes, 0), bufferMinutes: plan.bufferMinutes, workMinutes: plan.workMinutes };
  const committedDwell = plan.tasks.filter(task => !selectionGoal || task.required).reduce((sum, task) => sum + task.dwellMinutes * 60, 0);
  const drivingBudgetSeconds = plan.workMinutes * 60 - committedDwell - plan.bufferMinutes * 60;
  if (plan.planningGoal && drivingBudgetSeconds < 0) fail("必查任务的现场停留与机动时间已超过可用工时；请调整耗时或工时，未发送路线请求。");
  const eligibleTaskIds = new Set(base.selectedTaskIds);
  const executingStopIds = new Set(visits.filter((visit, index) => index === 0 || index === visits.length - 1 || visit.taskIds.some(id => eligibleTaskIds.has(id))).map(visit => visit.stopId));
  if (aliases.size === 1 || (selectionGoal && executingStopIds.size === 1)) {
    if (selectionGoal) {
      const available = plan.workMinutes * 60 - plan.bufferMinutes * 60;
      const required = plan.tasks.filter(task => task.required);
      const optional = plan.tasks.filter(task => !task.required && !deferredTasks.some(item => item.taskId === task.taskId));
      const requiredSeconds = required.reduce((sum, task) => sum + task.dwellMinutes * 60, 0);
      // Base 21 encodes high/medium/low counts lexicographically for at most 20 tasks.
      const score = (task: FieldTaskPlan["tasks"][number]) => task.priority === "high" ? 441 : task.priority === "low" ? 1 : 21;
      let best = { mask: 0, count: 0, value: 0, seconds: requiredSeconds };
      for (let mask = 0; mask < 2 ** optional.length; mask++) {
        let seconds = requiredSeconds, count = 0, value = 0;
        for (let index = 0; index < optional.length; index++) if (mask & (1 << index)) { seconds += optional[index].dwellMinutes * 60; count++; value += score(optional[index]); }
        if (seconds > available + 1e-8) continue;
        const better = plan.planningGoal === "coverage" ? count > best.count || (count === best.count && (value > best.value || (value === best.value && seconds < best.seconds)))
          : value > best.value || (value === best.value && (count > best.count || (count === best.count && seconds < best.seconds)));
        if (better) best = { mask, count, value, seconds };
      }
      const selected = new Set([...required.map(task => task.taskId), ...optional.filter((_, index) => best.mask & (1 << index)).map(task => task.taskId)]);
      optional.filter(task => !selected.has(task.taskId)).forEach(task => deferredTasks.push({ taskId: task.taskId, reason: "time_budget", detail: "本次工时内未安排，保留在原任务池。" }));
      base.selectedTaskIds = plan.tasks.filter(task => selected.has(task.taskId)).map(task => task.taskId);
      base.visits = visits.map(visit => ({ ...visit, taskIds: visit.taskIds.filter(id => selected.has(id)), dwellMinutes: visit.taskIds.filter(id => selected.has(id)).reduce((sum, id) => sum + taskById.get(id)!.dwellMinutes, 0) }));
      if (aliases.size > 1) base.visits = base.visits.filter((visit, index, all) => index === 0 || index === all.length - 1 || visit.taskIds.length > 0);
      base.localDwellMinutes = best.seconds / 60;
    }
    return { ...base, mode: "no_station_driving", request: null };
  }
  const first = visits[0], last = visits.at(-1)!;
  const returnToStart = plan.tripMode === "return_to_start";
  const seenStops = new Set<string>();
  visits.forEach((visit, index) => {
    const terminalReturn = returnToStart && index === visits.length - 1 && visit.stopId === first.stopId;
    if (seenStops.has(visit.stopId) && !terminalReturn) fail("除最终返程外的重复停靠需访问实例版服务；当前 v1 不支持，未合并到访或伪造零距离段。");
    seenStops.add(visit.stopId);
  });
  const uniqueVisits = returnToStart ? visits.slice(0, -1) : visits;
  const seenCoordinates = new Set<string>();
  const points = uniqueVisits.map(visit => {
    const key = coordinateKey(visit.coordinate);
    if (seenCoordinates.has(key)) fail("不同停车点在六位小数精度下重合；请确认同站关系或调整入口，未自动归并。");
    seenCoordinates.add(key);
    return { id: visit.pointId, name: `车辆停靠 ${seenCoordinates.size}`, coordinate: visit.coordinate.map(number => Number(number.toFixed(6))) as [number, number],
      role: visit.visitId === first.visitId ? "origin" as const : !returnToStart && visit.visitId === last.visitId ? "destination" as const : "candidate" as const,
      // All task service stays local: v1's 180-min point cap must not truncate a shared station.
      dwellMinutes: 0, inspectionValue: 0, required: !selectionGoal || visit.visitId === first.visitId || visit.visitId === last.visitId || visit.taskIds.some(id => taskById.get(id)!.required), sourceFeatureId: null,
      sourceRoadName: "用户明确指定车辆停靠 · 进入条件待核验" };
  });
  const request: RoadOpsDrivingRequest = { schemaVersion: "roadops-driving-request-v1", startId: first.pointId, endId: last.pointId,
    returnToStart, workMinutes: plan.workMinutes, strategy: plan.strategy, orderMode: plan.optimize ? "optimize" : "input", detailMode: "field", points };
  if (plan.planningGoal) {
    request.planningGoal = plan.planningGoal; request.drivingBudgetSeconds = drivingBudgetSeconds; request.bufferSeconds = plan.bufferMinutes * 60;
    request.fieldTasks = plan.tasks.map(task => {
      const deferred = deferredTasks.find(item => item.taskId === task.taskId), alias = taskAliases.find(item => item.taskId === task.taskId)!;
      return { taskId: alias.alias, pointId: alias.pointId, dwellSeconds: task.dwellMinutes * 60, required: task.required,
        priority: task.priority ?? "medium", eligible: !deferred,
        ...(deferred ? { ineligibleReason: deferred.reason === "access_blocked" ? "人工进入核验未通过。" : "核查输入未完成。", ineligibleReasonCode: deferred.reason as "access_blocked" | "input_incomplete" } : {}) };
    });
  }
  return { ...base, mode: "driving", request };
}

/** Bind supplier legs to occurrences, not physical IDs. This receipt remains in memory only. */
export function bindFieldTaskRoute(value: FieldTaskPlan, response: unknown, issued: FieldRoutingPreparation): FieldTaskRouteReceipt {
  const preparation = compileFieldTaskRouting(value, {}, { excludedTaskReasons: issued?.inputExclusions }), request = preparation.request;
  if (!issued || issued.planId !== preparation.planId || issued.revision !== preparation.revision || issued.inputSignature !== preparation.inputSignature
    || JSON.stringify(issued.request) !== JSON.stringify(request)) fail("请求发出后任务、修订或输入已变化；旧结果未绑定到当前任务，请手动重新规划。");
  if (!request) fail("该任务无需站间驾车，不应提交或接受供应商驾车结果。");
  if (!response || typeof response !== "object" || !("plan" in response)) fail("服务响应缺少 plan。");
  const plan = parseRoadOpsDrivingPlan(response.plan);
  assertRoadOpsPlanningMatches(plan, request);
  if (plan.provider !== "didi_web_service" || plan.mode !== "didi_live" || plan.map.mode !== "didi_live" || !plan.field) fail("需要完整的滴图逐段结果，未接受演示或概括连线。");
  if (plan.status !== "ready" && plan.status !== "infeasible") fail("服务方案状态无效。");
  if (!Number.isFinite(Date.parse(plan.generatedAt)) || plan.totalDistanceMeters < 0 || plan.drivingMinutes < 0) fail("服务时间或行驶指标无效。");
  const origin = preparation.visits[0], destination = preparation.visits.at(-1)!;
  let selectedTaskIds = [...preparation.selectedTaskIds], deferredTasks = [...preparation.deferredTasks];
  if (request.planningGoal) {
    const selection = plan.taskSelection;
    if (!selection) fail("个性化方案缺少任务执行与延期回执。");
    const byAlias = new Map(preparation.taskAliases.map(item => [item.alias, item.taskId]));
    if (!Array.isArray(selection.selectedTaskIds) || !Array.isArray(selection.deferredTasks)) fail("个性化任务集合回执无效。");
    const partition = [...selection.selectedTaskIds, ...selection.deferredTasks.map(item => item.taskId)];
    if (partition.length !== byAlias.size || new Set(partition).size !== byAlias.size || partition.some(id => !byAlias.has(id))) fail("任务执行与延期回执缺少、重复或包含其他任务。");
    selectedTaskIds = selection.selectedTaskIds.map(id => byAlias.get(id)!);
    deferredTasks = selection.deferredTasks.map(item => ({ ...item, taskId: byAlias.get(item.taskId)! }));
    const source = parseFieldTaskPlan(value);
    if (source.tasks.some(task => task.required && !selectedTaskIds.includes(task.taskId))
      || preparation.deferredTasks.some(task => selectedTaskIds.includes(task.taskId))
      || ((request.planningGoal === "time" || request.planningGoal === "distance") && deferredTasks.length)) fail("方案漏掉必查任务、安排了不可进入任务或改变了完整任务目标。");
    const dwellSeconds = source.tasks.filter(task => selectedTaskIds.includes(task.taskId)).reduce((sum, task) => sum + task.dwellMinutes * 60, 0);
    if (Math.abs(selection.dwellSeconds - dwellSeconds) > 1e-8 || selection.bufferSeconds !== source.bufferMinutes * 60
      || selection.workBudgetSeconds !== source.workMinutes * 60 || Math.abs(selection.drivingBudgetSeconds - Math.min(request.drivingBudgetSeconds!, Math.max(0, source.workMinutes * 60 - dwellSeconds - source.bufferMinutes * 60))) > 1e-8) fail("任务回执的现场时间或完整工时与本次输入不一致。");
  }
  const selection = new Set(selectedTaskIds);
  const selectedVisits = preparation.visits.map(visit => ({ ...visit, taskIds: visit.taskIds.filter(id => selection.has(id)),
    dwellMinutes: parseFieldTaskPlan(value).tasks.filter(task => visit.taskIds.includes(task.taskId) && selection.has(task.taskId)).reduce((sum, task) => sum + task.dwellMinutes, 0) }));
  const mayDeferVisits = request.planningGoal === "coverage" || request.planningGoal === "priority";
  const executingCandidates = selectedVisits.slice(1, -1).filter(visit => !mayDeferVisits || visit.taskIds.length > 0);
  const expected = executingCandidates.map(visit => visit.pointId), returned = plan.stopOrder.slice(1, -1);
  if (plan.stopOrder.length !== expected.length + 2 || plan.stopOrder[0] !== origin.pointId || plan.stopOrder.at(-1) !== destination.pointId
    || new Set(returned).size !== expected.length || returned.some(id => !expected.includes(id))
    || plan.selectedCandidateIds.length !== expected.length || new Set(plan.selectedCandidateIds).size !== expected.length || plan.selectedCandidateIds.some(id => !expected.includes(id))
    || (!request.planningGoal && plan.excluded.length > 0)) fail("结果缺少、重复或排除了指定到访，未展示不完整行程。");
  if (request.orderMode === "input" && returned.some((id, index) => id !== expected[index])) fail("结果改变了用户固定的到访顺序。");
  const ordered = [selectedVisits[0], ...returned.map(id => executingCandidates.find(visit => visit.pointId === id)!), selectedVisits.at(-1)!];
  if (plan.map.stops.length !== ordered.length || plan.map.stops.some((stop, index) => !stop || stop.id !== ordered[index].pointId || !sameCoordinate(stop.coordinate, request.points.find(point => point.id === stop.id)!.coordinate))) fail("地图停靠与本次输入不一致，未绑定到任务。");
  const legs = plan.field.legs.map((leg, index): FieldTaskRouteLeg => {
    const from = ordered[index], to = ordered[index + 1];
    return { ...leg, id: JSON.stringify([from.visitId, to.visitId]), providerLegId: leg.id,
      fromVisitId: from.visitId, toVisitId: to.visitId, fromStopId: from.stopId, toStopId: to.stopId,
      coordinates: leg.coordinates.map(point => [...point]), bounds: [...leg.bounds], traffic: leg.traffic.map(segment => ({ ...segment })) };
  });
  // Never rely on a v1 report keyed by physical stopId: it would suppress final-origin dwell.
  const drivingMinutes = legs.reduce((sum, leg) => sum + leg.durationSeconds, 0) / 60;
  const localDwellMinutes = ordered.reduce((sum, visit) => sum + visit.dwellMinutes, 0);
  const totalMinutes = drivingMinutes + localDwellMinutes + preparation.bufferMinutes;
  return { planId: preparation.planId, revision: preparation.revision, inputSignature: preparation.inputSignature, generatedAt: plan.generatedAt, visits: ordered, legs,
    selectedTaskIds, deferredTasks, inputExclusions: preparation.inputExclusions, ...(preparation.planningGoal ? { planningGoal: preparation.planningGoal } : {}),
    drivingMinutes, localDwellMinutes, bufferMinutes: preparation.bufferMinutes,
    totalMinutes, overtimeMinutes: Math.max(0, totalMinutes - preparation.workMinutes), accessStatus: "needs_review",
    endpointEvidence: ordered.map((visit, index) => ({ visitId: visit.visitId,
      arrival: index === 0 ? null : [...legs[index - 1].coordinates.at(-1)!],
      departure: index === legs.length ? null : [...legs[index].coordinates[0]] })) };
}
