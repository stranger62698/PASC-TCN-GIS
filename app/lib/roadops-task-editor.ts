import { FIELD_TASK_MAX_VISITS, parseFieldTaskPlan, type FieldTaskPlan, type InspectionTask, type VisitOccurrence } from "./roadops-task-plan";

type Coordinate = [number, number] | null;
type ConfirmedEdit = { confirmed: true };

function fail(message: string): never { throw new Error(`外业任务编辑：${message}`); }
const copyCoordinate = (value: Coordinate): Coordinate => value === null ? null : [...value];
const sameCoordinate = (left: Coordinate, right: Coordinate) => JSON.stringify(left) === JSON.stringify(right);
function getVisit(plan: FieldTaskPlan, visitId: string): VisitOccurrence {
  const visit = plan.visits.find(value => value.visitId === visitId);
  if (!visit) fail("到访已不存在，请重新选择。");
  return visit;
}
function getTask(plan: FieldTaskPlan, taskId: string): InspectionTask {
  const task = plan.tasks.find(value => value.taskId === taskId);
  if (!task) fail("核查任务已不存在，请重新选择。");
  return task;
}
function resetInspectionArrival(plan: FieldTaskPlan, taskIds: string[]): void {
  const selected = new Set(taskIds);
  plan.tasks.forEach(task => {
    if (selected.has(task.taskId) && task.inspectionSource) task.inspectionSource = { ...task.inspectionSource, arrivalSelection: "unconfirmed" };
  });
}
function finish(plan: FieldTaskPlan): FieldTaskPlan {
  const usedStops = new Set(plan.visits.map(visit => visit.stopId));
  return parseFieldTaskPlan({ ...plan, stops: plan.stops.filter(stop => usedStops.has(stop.stopId)) });
}
function requireConfirmation(options: ConfirmedEdit): void {
  if (options?.confirmed !== true) fail("需要明确确认此次任务移动或删除。");
}
function requireNewIds(plan: FieldTaskPlan, visitId: string, stopId: string): void {
  if (plan.visits.some(visit => visit.visitId === visitId) || plan.stops.some(stop => stop.stopId === stopId)) fail("新到访或停车点标识已存在，未复用旧身份。");
}
function requireVisitCapacity(plan: FieldTaskPlan): void {
  if (plan.visits.length >= FIELD_TASK_MAX_VISITS) fail("新增到访会超过 6 个中途到访、8 次到访，请先明确调整停靠安排。");
}
function insertCandidate(plan: FieldTaskPlan, visit: VisitOccurrence, afterVisitId?: string): void {
  const after = afterVisitId === undefined ? plan.visits.length - 2 : plan.visits.findIndex(value => value.visitId === afterVisitId);
  if (after < 0 || after >= plan.visits.length - 1) fail("中途到访应插入起点之后、结束到访之前。");
  plan.visits.splice(after + 1, 0, visit);
}

/** Pure edits only. The caller owns timestamps/revision, saving and explicit route requests. */
export function setFieldTaskTripMode(value: FieldTaskPlan, mode: FieldTaskPlan["tripMode"], options: { visitId?: string } = {}): FieldTaskPlan {
  const plan = parseFieldTaskPlan(value), origin = plan.visits[0], destination = plan.visits.at(-1)!;
  if (mode !== "one_way" && mode !== "return_to_start") fail("行程方式无效。");
  if (mode === plan.tripMode) return plan;
  if (mode === "return_to_start") {
    if (plan.visits.length >= FIELD_TASK_MAX_VISITS) fail("追加返回到访会超过 6 个中途到访、8 次到访，请先明确调整任务停靠；原结束任务已保留。");
    const generatedId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const visitId = options.visitId ?? `visit:return:${generatedId}`;
    if (plan.visits.some(visit => visit.visitId === visitId)) fail("返回到访标识已存在，未复用出发身份。");
    destination.role = "candidate";
    plan.visits.push({ visitId, stopId: origin.stopId, taskIds: [], role: "destination" });
    plan.tripMode = mode;
    // The former destination remains a real stop. The final return is a new occurrence.
    return finish(plan);
  }
  if (destination.taskIds.length > 0) fail("返回驻点到访仍有任务，请先明确移走或删除这些任务，再关闭返程；未丢弃任务。");
  if (plan.visits.length <= 2) fail("关闭返程会失去独立起终到访，请先设置单程结束停靠。");
  plan.visits.pop();
  plan.visits.at(-1)!.role = "destination";
  plan.tripMode = mode;
  return finish(plan);
}

/** User explicitly confirms one visit; retain each task and append its local work order. */
export function shareFieldTaskVisit(value: FieldTaskPlan, sourceVisitId: string, targetVisitId: string, options: ConfirmedEdit): FieldTaskPlan {
  requireConfirmation(options);
  const plan = parseFieldTaskPlan(value), source = getVisit(plan, sourceVisitId), target = getVisit(plan, targetVisitId);
  if (source === target) fail("请选择另一到访作为共用停车点。");
  if (source.role !== "candidate") fail("只能合并中途到访；起点和结束到访的独立身份须保留。");
  target.taskIds.push(...source.taskIds);
  resetInspectionArrival(plan, target.taskIds);
  plan.stops.find(stop => stop.stopId === target.stopId)!.usesVehicleCoordinate = true;
  plan.visits = plan.visits.filter(visit => visit.visitId !== sourceVisitId);
  return finish(plan);
}

export function splitFieldTask(value: FieldTaskPlan, taskId: string, options: { visitId: string; stopId: string; afterVisitId?: string }): FieldTaskPlan {
  const plan = parseFieldTaskPlan(value), task = getTask(plan, taskId);
  requireNewIds(plan, options.visitId, options.stopId);
  const source = plan.visits.find(visit => visit.taskIds.includes(taskId))!;
  if (source.taskIds.length < 2) fail("此到访只有一项任务，无需拆分。");
  requireVisitCapacity(plan);
  const afterVisitId = options.afterVisitId ?? (source.role === "destination" ? plan.visits.at(-2)!.visitId : source.visitId);
  source.taskIds = source.taskIds.filter(id => id !== taskId);
  resetInspectionArrival(plan, [taskId]);
  plan.stops.push({ stopId: options.stopId, coordinate: copyCoordinate(task.targetCoordinate), usesVehicleCoordinate: false });
  insertCandidate(plan, { visitId: options.visitId, stopId: options.stopId, taskIds: [taskId], role: "candidate" }, afterVisitId);
  return finish(plan);
}

export function addFieldTaskVisit(value: FieldTaskPlan, options: { task: InspectionTask; visitId: string; stopId: string; afterVisitId?: string; coordinate?: Coordinate }): FieldTaskPlan {
  const plan = parseFieldTaskPlan(value);
  requireNewIds(plan, options.visitId, options.stopId);
  requireVisitCapacity(plan);
  if (plan.tasks.some(task => task.taskId === options.task.taskId)) fail("核查任务标识已存在，未复用任务身份。");
  const explicitVehicle = options.coordinate !== undefined;
  plan.tasks.push({ ...options.task, targetCoordinate: copyCoordinate(options.task.targetCoordinate),
    ...(options.task.inspectionSource ? { inspectionSource: { ...options.task.inspectionSource, arrivalSelection: explicitVehicle && options.coordinate ? "custom" : "unconfirmed" } } : {}) });
  plan.stops.push({ stopId: options.stopId, coordinate: copyCoordinate(explicitVehicle ? options.coordinate! : options.task.targetCoordinate), usesVehicleCoordinate: explicitVehicle });
  insertCandidate(plan, { visitId: options.visitId, stopId: options.stopId, taskIds: [options.task.taskId], role: "candidate" }, options.afterVisitId);
  return finish(plan);
}

export function addFieldTaskToVisit(value: FieldTaskPlan, task: InspectionTask, visitId: string): FieldTaskPlan {
  const plan = parseFieldTaskPlan(value), visit = getVisit(plan, visitId);
  if (plan.tasks.some(item => item.taskId === task.taskId)) fail("核查任务标识已存在，未复用任务身份。");
  plan.tasks.push({ ...task, targetCoordinate: copyCoordinate(task.targetCoordinate) });
  visit.taskIds.push(task.taskId);
  resetInspectionArrival(plan, visit.taskIds);
  plan.stops.find(stop => stop.stopId === visit.stopId)!.usesVehicleCoordinate = true;
  return finish(plan);
}

export function setFieldTaskTargetCoordinate(value: FieldTaskPlan, taskId: string, coordinate: Coordinate): FieldTaskPlan {
  const plan = parseFieldTaskPlan(value), task = getTask(plan, taskId);
  const visit = plan.visits.find(item => item.taskIds.includes(taskId))!, stop = plan.stops.find(item => item.stopId === visit.stopId)!;
  if (sameCoordinate(task.targetCoordinate, coordinate)) return plan;
  task.targetCoordinate = copyCoordinate(coordinate);
  if (task.inspectionSource) task.inspectionSource = { ...task.inspectionSource, arrivalSelection: "unconfirmed",
    targetAdjusted: !coordinate || coordinate.some((number, index) => number !== task.inspectionSource!.sourceCoordinate[index]) };
  if (task.legacyAccessReview === "confirmed") task.legacyAccessReview = "unknown";
  if (!stop.usesVehicleCoordinate) {
    const finalReturn = plan.tripMode === "return_to_start" ? plan.visits.at(-1) : undefined;
    const canFollowTarget = visit.taskIds.length === 1 && plan.visits.filter(item => item.stopId === stop.stopId)
      .every(item => item.visitId === visit.visitId || (item.visitId === finalReturn?.visitId && item.taskIds.length === 0));
    if (canFollowTarget) stop.coordinate = copyCoordinate(coordinate);
    else stop.usesVehicleCoordinate = true;
  }
  return finish(plan);
}

export function setFieldVehicleStopCoordinate(value: FieldTaskPlan, stopId: string, coordinate: Coordinate): FieldTaskPlan {
  const plan = parseFieldTaskPlan(value), stop = plan.stops.find(item => item.stopId === stopId);
  if (!stop) fail("停车点已不存在，请重新选择。");
  stop.coordinate = copyCoordinate(coordinate);
  stop.usesVehicleCoordinate = true;
  const taskIds = new Set(plan.visits.filter(visit => visit.stopId === stopId).flatMap(visit => visit.taskIds));
  plan.tasks.forEach(task => {
    if (taskIds.has(task.taskId) && task.inspectionSource) task.inspectionSource = { ...task.inspectionSource, arrivalSelection: coordinate ? "custom" : "unconfirmed" };
  });
  return finish(plan);
}

export function removeFieldTask(value: FieldTaskPlan, taskId: string, options: ConfirmedEdit): FieldTaskPlan {
  requireConfirmation(options);
  const plan = parseFieldTaskPlan(value);
  getTask(plan, taskId);
  const sourceVisitId = plan.visits.find(visit => visit.taskIds.includes(taskId))!.visitId;
  plan.tasks = plan.tasks.filter(task => task.taskId !== taskId);
  plan.visits = plan.visits.map(visit => ({ ...visit, taskIds: visit.taskIds.filter(id => id !== taskId) }))
    .filter(visit => visit.visitId !== sourceVisitId || visit.role !== "candidate" || visit.taskIds.length > 0);
  return finish(plan);
}
