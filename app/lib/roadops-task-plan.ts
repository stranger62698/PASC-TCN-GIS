import { navigationPoints, type NavigationAnalysisContext, type NavigationDraft, type NavigationInspectionSource, type NavigationPoint } from "./roadops-navigation";

/** This document contains user-owned inputs only. Never add supplier route results here. */
export const FIELD_TASK_PLAN_SCHEMA_VERSION = "field-task-plan-v1" as const;
export const FIELD_TASK_MAX_TASKS = 20;
export const FIELD_TASK_MAX_INTERMEDIATE_VISITS = 6;
export const FIELD_TASK_MAX_VISITS = 8;
export const FIELD_TASK_JSON_MAX_BYTES = 1024 * 1024;
export const FIELD_TASK_PLAN_MAX_BYTES = FIELD_TASK_JSON_MAX_BYTES;
export const FIELD_TASK_HISTORY_NOTE_PREFIX = "历史确认待补充：";
export type FieldPlanningGoal = "time" | "distance" | "coverage" | "priority";
export type FieldTaskPriority = "high" | "medium" | "low";

export type InspectionTask = {
  taskId: string;
  name: string;
  targetCoordinate: [number, number] | null;
  dwellMinutes: number;
  required: boolean;
  /** Human-authored priority; absence in v1 means medium, never inferred danger. */
  priority?: FieldTaskPriority;
  legacyAccessReview: "unknown" | "confirmed" | "blocked";
  accessNote: string;
  inspectionSource?: NavigationInspectionSource;
};

export type VehicleStop = {
  stopId: string;
  coordinate: [number, number] | null;
  usesVehicleCoordinate: boolean;
};

export type VisitOccurrence = {
  visitId: string;
  stopId: string;
  taskIds: string[];
  role: NavigationPoint["role"];
};

export type FieldTaskPlan = {
  schemaVersion: typeof FIELD_TASK_PLAN_SCHEMA_VERSION;
  planId: string;
  revision: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  date: string | null;
  timezone: "Asia/Shanghai";
  tripMode: "one_way" | "return_to_start";
  strategy: NavigationDraft["strategy"];
  optimize: boolean;
  /** Absent legacy plans retain the all-required scheduling contract. */
  planningGoal?: FieldPlanningGoal;
  startTime: string;
  workMinutes: number;
  bufferMinutes: number;
  tasks: InspectionTask[];
  stops: VehicleStop[];
  visits: VisitOccurrence[];
};

function fail(message: string): never { throw new Error(`外业任务方案无效：${message}`); }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label}必须是对象。`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || Array.from(value).some(character => character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0)))) fail(`${label}格式或长度不正确。`);
  return value;
}
function identifier(value: unknown, label: string): string {
  const id = string(value, label, 200);
  if (id.trim() !== id || /\s/.test(id)) fail(`${label}不能包含空白字符。`);
  return id;
}
function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(`${label}必须在 ${min}–${max} 范围内。`);
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label}必须是布尔值。`);
  return value;
}
function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) fail(`${label}不受支持。`);
  return value as T;
}
function coordinate(value: unknown, label: string): [number, number] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 2) fail(`${label}应为 WGS84 经度、纬度或空值。`);
  return [number(value[0], `${label}经度`, -180, 180), number(value[1], `${label}纬度`, -90, 90)];
}
function isoTime(value: unknown, label: string): string {
  const time = string(value, label, 24);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(time) || !Number.isFinite(Date.parse(time))) fail(`${label}必须是有效 UTC ISO 时间。`);
  if (new Date(time).toISOString() !== (time.length === 20 ? time.replace("Z", ".000Z") : time)) fail(`${label}不是有效日期。`);
  return time;
}
function array(value: unknown, label: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label}数量须为 ${min}–${max}。`);
  return value;
}
function assertUnique(ids: string[], label: string): void {
  if (new Set(ids).size !== ids.length) fail(`${label}标识重复。`);
}
function assertSize(value: unknown): void {
  let json: string | undefined;
  try { json = JSON.stringify(value); } catch { fail("不是可序列化的 JSON 数据。"); }
  if (!json || new TextEncoder().encode(json).byteLength > FIELD_TASK_JSON_MAX_BYTES) fail("JSON 文件超过 1 MiB 或内容为空。");
}
function accessNote(value: unknown): string {
  const note = string(value, "核验备注", 4000 + FIELD_TASK_HISTORY_NOTE_PREFIX.length, true);
  if (!note.startsWith(FIELD_TASK_HISTORY_NOTE_PREFIX) && note.length > 4000) fail("核验备注格式或长度不正确。");
  return note;
}

function inspectionSource(value: unknown): NavigationInspectionSource {
  const source = record(value, "分析来源");
  if (source.schemaVersion !== "inspection-navigation-source-v1") fail("分析来源版本不受支持。");
  const kind = choice(source.kind, ["point", "region"], "来源类型");
  const sourceCoordinate = coordinate(source.sourceCoordinate, "来源点坐标");
  if (!sourceCoordinate) fail("分析来源必须包含真实点坐标。");
  const representativeSelection = choice(source.representativeSelection, ["selected-point", "nearest-member-to-centroid"], "代表点选取方式");
  if ((kind === "point") !== (representativeSelection === "selected-point")) fail("来源类型与代表点选取方式不一致。");
  let region: Pick<NavigationInspectionSource, "regionId" | "regionPointCount" | "regionMembershipId"> = {};
  if (kind === "region") {
    const count = number(source.regionPointCount, "区域成员数", 1, 1_000_000_000);
    if (!Number.isSafeInteger(count)) fail("区域成员数必须是正整数。");
    region = { regionId: string(source.regionId, "来源区域 ID", 200), regionPointCount: count, regionMembershipId: identifier(source.regionMembershipId, "区域成员标识") };
  }
  return {
    schemaVersion: "inspection-navigation-source-v1", kind,
    datasetId: identifier(source.datasetId, "来源数据集 ID"), analysisId: identifier(source.analysisId, "来源分析 ID"),
    datasetTitle: string(source.datasetTitle, "来源数据集名称", 1000),
    observationDate: string(source.observationDate, "来源观测日期", 120),
    ruleSummary: string(source.ruleSummary, "来源规则", 4000),
    representativePointId: string(source.representativePointId, "真实点 ID", 200),
    sourceCoordinate, representativeSelection, targetAdjusted: boolean(source.targetAdjusted, "目标调整标记"),
    arrivalSelection: source.arrivalSelection === undefined ? "unconfirmed" : choice<NonNullable<NavigationInspectionSource["arrivalSelection"]>>(source.arrivalSelection, ["unconfirmed", "target", "custom"], "算路位置选择"), ...region,
  };
}

/** Validate and rebuild a whitelist; unknown fields are not persisted or exported. */
export function parseFieldTaskPlan(value: unknown): FieldTaskPlan {
  assertSize(value);
  const source = record(value, "方案");
  if (source.schemaVersion !== FIELD_TASK_PLAN_SCHEMA_VERSION) fail("schemaVersion 不受支持，请勿用旧版覆盖新版本方案。");
  const revision = number(source.revision, "修订号", 1, Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(revision)) fail("修订号必须是正整数。");
  const createdAt = isoTime(source.createdAt, "创建时间"), updatedAt = isoTime(source.updatedAt, "更新时间");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) fail("更新时间不能早于创建时间。");
  let date: string | null = null;
  if (source.date !== null) {
    date = string(source.date, "计划日期", 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) fail("计划日期应为有效 YYYY-MM-DD。");
  }
  const startTime = string(source.startTime, "出发时间", 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) fail("出发时间应为 HH:mm。");
  const tasks: InspectionTask[] = array(source.tasks, "核查任务", 0, FIELD_TASK_MAX_TASKS).map((value, index) => {
    const task = record(value, `任务 ${index + 1}`);
    return {
      taskId: identifier(task.taskId, "任务 ID"), name: string(task.name, "任务名称", 80),
      targetCoordinate: coordinate(task.targetCoordinate, "目标坐标"), dwellMinutes: number(task.dwellMinutes, "核查耗时", 0, 180),
      required: boolean(task.required, "必访标记"), legacyAccessReview: choice(task.legacyAccessReview, ["unknown", "confirmed", "blocked"], "历史核验状态"),
      ...(task.priority !== undefined ? { priority: choice<FieldTaskPriority>(task.priority, ["high", "medium", "low"], "任务优先级") } : {}),
      accessNote: accessNote(task.accessNote),
      ...(task.inspectionSource !== undefined ? { inspectionSource: inspectionSource(task.inspectionSource) } : {}),
    };
  });
  const stops: VehicleStop[] = array(source.stops, "停车点", 1, FIELD_TASK_MAX_VISITS).map(value => {
    const stop = record(value, "停车点");
    return { stopId: identifier(stop.stopId, "停车点 ID"), coordinate: coordinate(stop.coordinate, "车辆坐标"), usesVehicleCoordinate: boolean(stop.usesVehicleCoordinate, "独立车辆坐标标记") };
  });
  const visits: VisitOccurrence[] = array(source.visits, "到访实例", 2, FIELD_TASK_MAX_VISITS).map(value => {
    const visit = record(value, "到访实例");
    const taskIds = array(visit.taskIds, "到访任务", 0, FIELD_TASK_MAX_TASKS).map(id => identifier(id, "引用的任务 ID"));
    assertUnique(taskIds, "到访任务");
    return { visitId: identifier(visit.visitId, "到访 ID"), stopId: identifier(visit.stopId, "引用的停车点 ID"), taskIds, role: choice(visit.role, ["origin", "candidate", "destination"], "到访角色") };
  });
  assertUnique(tasks.map(task => task.taskId), "任务");
  assertUnique(stops.map(stop => stop.stopId), "停车点");
  assertUnique(visits.map(visit => visit.visitId), "到访");
  const taskIds = new Set(tasks.map(task => task.taskId)), stopIds = new Set(stops.map(stop => stop.stopId));
  const visitedTasks = new Set<string>(), visitedStops = new Set<string>();
  visits.forEach((visit, index) => {
    const expectedRole = index === 0 ? "origin" : index === visits.length - 1 ? "destination" : "candidate";
    if (visit.role !== expectedRole) fail("到访序列应为起点、中途到访、终点。");
    if (!stopIds.has(visit.stopId)) fail("到访引用了不存在的停车点。");
    visitedStops.add(visit.stopId);
    visit.taskIds.forEach(id => {
      if (!taskIds.has(id)) fail("到访引用了不存在的任务。");
      if (visitedTasks.has(id)) fail("同一核查任务不能分配给多个到访；重复核查请建立独立任务。");
      visitedTasks.add(id);
    });
  });
  if (visits.length - 2 > FIELD_TASK_MAX_INTERMEDIATE_VISITS) fail("最多支持 6 个中途到访。");
  if (visitedTasks.size !== tasks.length || visitedStops.size !== stops.length) fail("存在未分配到访的任务或停车点。");
  const tripMode = choice(source.tripMode, ["one_way", "return_to_start"], "行程方式");
  if (tripMode === "return_to_start" && visits[0].stopId !== visits.at(-1)!.stopId) fail("返程必须复用出发停车点，并保留独立到访 ID。");
  return {
    schemaVersion: FIELD_TASK_PLAN_SCHEMA_VERSION, planId: identifier(source.planId, "方案 ID"), revision,
    name: string(source.name, "方案名称", 120), createdAt, updatedAt, date,
    timezone: choice(source.timezone, ["Asia/Shanghai"], "时区"), tripMode,
    strategy: choice(source.strategy, ["1", "2", "5", "11", "13"], "驾车策略"), optimize: boolean(source.optimize, "顺序优化标记"),
    ...(source.planningGoal !== undefined ? { planningGoal: choice<FieldPlanningGoal>(source.planningGoal, ["time", "distance", "coverage", "priority"], "核查目标") } : {}),
    startTime, workMinutes: number(source.workMinutes, "可用工时", 30, 720), bufferMinutes: number(source.bufferMinutes, "机动时间", 0, 720),
    tasks, stops, visits,
  };
}

function draftParts(draft: NavigationDraft, previous?: FieldTaskPlan): Pick<FieldTaskPlan, "tasks" | "stops" | "visits"> {
  if (draft.origin.role !== "origin" || draft.destination.role !== "destination" || draft.waypoints.some(point => point.role !== "candidate")) fail("导航点位角色无效。");
  const previousVisits = new Map(previous?.visits.map(visit => [visit.taskIds[0], visit]));
  const previousTasks = new Map(previous?.tasks.map(task => [task.taskId, task]));
  const tasks: InspectionTask[] = [], stops: VehicleStop[] = [], visits: VisitOccurrence[] = [];
  for (const point of navigationPoints(draft)) {
    const existing = previousVisits.get(point.id);
    const stopId = existing?.stopId ?? `stop:${point.id}`, visitId = existing?.visitId ?? `visit:${point.id}`;
    const usesVehicleCoordinate = point.vehicleCoordinate != null;
    tasks.push({ taskId: point.id, name: point.name || (point.role === "origin" ? "起点" : point.role === "destination" ? "终点" : "核查点"),
      targetCoordinate: point.coordinate, dwellMinutes: point.role === "origin" ? 0 : (point.dwellMinutes ?? (point.role === "candidate" ? 20 : 0)),
      required: true, legacyAccessReview: point.accessReview ?? "unknown", accessNote: point.accessNote ?? "",
      ...(previousTasks.get(point.id)?.priority ? { priority: previousTasks.get(point.id)!.priority } : {}),
      ...(point.inspectionSource ? { inspectionSource: point.inspectionSource } : {}) });
    stops.push({ stopId, coordinate: point.vehicleCoordinate ?? point.coordinate, usesVehicleCoordinate });
    visits.push({ visitId, stopId, taskIds: [point.id], role: point.role });
  }
  return { tasks, stops, visits };
}

export function createFieldTaskPlan(draft: NavigationDraft, metadata: { planId: string; name: string; now: string }): FieldTaskPlan {
  return parseFieldTaskPlan({
    schemaVersion: FIELD_TASK_PLAN_SCHEMA_VERSION, planId: metadata.planId, revision: 1, name: metadata.name,
    createdAt: metadata.now, updatedAt: metadata.now, date: null, timezone: "Asia/Shanghai", tripMode: "one_way",
    strategy: draft.strategy, optimize: draft.optimize, startTime: draft.startTime ?? "08:30", workMinutes: draft.workMinutes ?? 480, bufferMinutes: draft.bufferMinutes ?? 30,
    ...((draft as NavigationDraft & { planningGoal?: FieldPlanningGoal }).planningGoal ? { planningGoal: (draft as NavigationDraft & { planningGoal?: FieldPlanningGoal }).planningGoal } : {}),
    ...draftParts(draft),
  });
}

/** The storage transaction, not this pure adapter, owns the revision increment. */
export function updateFieldTaskPlan(plan: FieldTaskPlan, draft: NavigationDraft, name = plan.name, now = new Date().toISOString()): FieldTaskPlan {
  const previous = parseFieldTaskPlan(plan);
  fieldTaskPlanToNavigationDraft(previous); // Fail closed before adapting richer future plans.
  return parseFieldTaskPlan({ ...previous, name, updatedAt: now,
    strategy: draft.strategy, optimize: draft.optimize, startTime: draft.startTime ?? "08:30", workMinutes: draft.workMinutes ?? 480, bufferMinutes: draft.bufferMinutes ?? 30,
    ...((draft as NavigationDraft & { planningGoal?: FieldPlanningGoal }).planningGoal ? { planningGoal: (draft as NavigationDraft & { planningGoal?: FieldPlanningGoal }).planningGoal } : {}),
    ...draftParts(draft, previous) });
}

/** Explicit v1 compatibility boundary: never flatten a richer task/visit graph. */
export function fieldTaskPlanToNavigationDraft(value: FieldTaskPlan): NavigationDraft {
  const plan = parseFieldTaskPlan(value);
  if (plan.tripMode !== "one_way") fail("当前导航编辑器尚不支持返程方案，已保留原数据，未截断恢复。");
  if (plan.date !== null) fail("当前导航编辑器尚不支持指定日期排程，未丢弃日期或冒充未来路况预测。");
  if (plan.tasks.some(task => task.taskId.startsWith("vehicle:"))) fail("任务 ID 与当前车辆选点标识冲突，未恢复到编辑器。");
  if (plan.tasks.some(task => task.taskId.length > 80 || !/^[a-zA-Z0-9._:/#-]+$/.test(task.taskId))) fail("任务 ID 不符合当前驾车请求格式，未重写身份或恢复到编辑器。");
  if (plan.visits.some(visit => visit.taskIds.length !== 1) || new Set(plan.visits.map(visit => visit.stopId)).size !== plan.visits.length) fail("当前导航编辑器尚不支持共用停车点或一站多任务，未截断恢复。");
  if (plan.tasks.some(task => !task.required)) fail("当前导航编辑器尚不支持可延期任务，未改变必访标记。");
  const tasks = new Map(plan.tasks.map(task => [task.taskId, task])), stops = new Map(plan.stops.map(stop => [stop.stopId, stop]));
  const points: NavigationPoint[] = plan.visits.map(visit => {
    const task = tasks.get(visit.taskIds[0])!, stop = stops.get(visit.stopId)!;
    if (!stop.usesVehicleCoordinate && JSON.stringify(stop.coordinate) !== JSON.stringify(task.targetCoordinate)) fail("停车点与目标坐标不一致，不能静默恢复为目标坐标。");
    if (stop.usesVehicleCoordinate && stop.coordinate === null) fail("独立车辆坐标为空，当前导航编辑器无法无损恢复。");
    if (visit.role === "origin" && task.dwellMinutes !== 0) fail("当前导航编辑器不支持起点核查耗时，未丢弃该耗时。");
    const legacyConfirmed = task.legacyAccessReview === "confirmed";
    return { id: task.taskId, name: task.name, coordinate: task.targetCoordinate ? [...task.targetCoordinate] : null, role: visit.role,
      vehicleCoordinate: stop.usesVehicleCoordinate && stop.coordinate ? [...stop.coordinate] : null, dwellMinutes: task.dwellMinutes,
      accessReview: legacyConfirmed ? "unknown" : task.legacyAccessReview,
      ...(task.inspectionSource ? { inspectionSource: { ...task.inspectionSource, targetAdjusted: !task.targetCoordinate || task.targetCoordinate.some((value, index) => value !== task.inspectionSource!.sourceCoordinate[index]) } } : {}),
      accessNote: legacyConfirmed && !task.accessNote.startsWith(FIELD_TASK_HISTORY_NOTE_PREFIX) ? `${FIELD_TASK_HISTORY_NOTE_PREFIX}${task.accessNote}` : task.accessNote };
  });
  return { origin: points[0], destination: points.at(-1)!, waypoints: points.slice(1, -1), strategy: plan.strategy, optimize: plan.optimize,
    ...(plan.planningGoal ? { planningGoal: plan.planningGoal } : {}),
    startTime: plan.startTime, workMinutes: plan.workMinutes, bufferMinutes: plan.bufferMinutes };
}

export type FieldTaskInspectionIssue = { taskId: string; kind: "stale" | "arrival"; message: string };

/** Inspect every task, including second and later tasks sharing one vehicle stop. */
export function fieldTaskInspectionIssues(plan: FieldTaskPlan, context: NavigationAnalysisContext = {}): FieldTaskInspectionIssue[] {
  const stops = new Map(plan.stops.map(stop => [stop.stopId, stop]));
  const taskStops = new Map(plan.visits.flatMap(visit => visit.taskIds.map(taskId => [taskId, stops.get(visit.stopId)!] as const)));
  return plan.tasks.flatMap<FieldTaskInspectionIssue>(task => {
    const source = task.inspectionSource;
    if (!source) return [];
    if ((context.currentDatasetId !== undefined && context.currentDatasetId !== source.datasetId)
      || (context.currentAnalysisId !== undefined && context.currentAnalysisId !== source.analysisId)) {
      return [{ taskId: task.taskId, kind: "stale" as const, message: `“${task.name}”的分析来源已过期；请删除此任务，再从当前分析候选加入。` }];
    }
    const stop = taskStops.get(task.taskId);
    const expected = stop?.usesVehicleCoordinate ? "custom" : "target";
    if (stop?.coordinate && source.arrivalSelection === expected) return [];
    return [{ taskId: task.taskId, kind: "arrival" as const, message: `请明确确认“${task.name}”的车辆停靠位置用于算路；停车与入口许可仍待核验。` }];
  });
}

/** Records routing input only. It never changes a task's manual access review. */
export function confirmFieldTaskArrivalSelection(value: FieldTaskPlan, context: NavigationAnalysisContext = {}): FieldTaskPlan {
  const plan = parseFieldTaskPlan(value);
  const stale = fieldTaskInspectionIssues(plan, context).find(issue => issue.kind === "stale");
  if (stale) fail(stale.message);
  const stops = new Map(plan.stops.map(stop => [stop.stopId, stop]));
  const taskStops = new Map(plan.visits.flatMap(visit => visit.taskIds.map(taskId => [taskId, stops.get(visit.stopId)!] as const)));
  if (plan.tasks.some(task => !taskStops.get(task.taskId)?.coordinate)) fail("仍有任务未选择车辆停靠位置，未确认算路输入。");
  return parseFieldTaskPlan({ ...plan, tasks: plan.tasks.map(task => task.inspectionSource ? { ...task,
    inspectionSource: { ...task.inspectionSource,
      arrivalSelection: taskStops.get(task.taskId)!.usesVehicleCoordinate ? "custom" : "target",
      targetAdjusted: !task.targetCoordinate || task.targetCoordinate.some((coordinate, index) => coordinate !== task.inspectionSource!.sourceCoordinate[index]),
    },
  } : task) });
}

export function serializeFieldTaskPlan(value: FieldTaskPlan, options: { includeNotes: boolean }): string {
  const plan = parseFieldTaskPlan(value);
  return JSON.stringify({ ...plan, tasks: plan.tasks.map(task => ({ ...task, accessNote: options.includeNotes ? task.accessNote : "" })) }, null, 2);
}

/** Restore self-authored inputs without promoting incomplete historical access confirmations. */
export function prepareFieldTaskPlanRestore(value: FieldTaskPlan): FieldTaskPlan {
  const plan = parseFieldTaskPlan(value);
  return parseFieldTaskPlan({ ...plan, tasks: plan.tasks.map(task => task.legacyAccessReview === "confirmed" ? {
    ...task, legacyAccessReview: "unknown",
    accessNote: task.accessNote.startsWith(FIELD_TASK_HISTORY_NOTE_PREFIX) ? task.accessNote : `${FIELD_TASK_HISTORY_NOTE_PREFIX}${task.accessNote}`,
  } : task) });
}
