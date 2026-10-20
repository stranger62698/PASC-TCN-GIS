import { parseFieldTaskPlan, type FieldTaskPlan } from "./roadops-task-plan";

/** User-authored access history only. Supplier routes and inferred access never belong here. */
export const FIELD_ACCESS_LOG_SCHEMA_VERSION = "field-access-log-v1" as const;
export const FIELD_ACCESS_LOG_MAX_BYTES = 1024 * 1024;
export const FIELD_ACCESS_MAX_CHECKS = 500;
export const FIELD_ACCESS_MAX_REFS = 20;

export type AccessDimension = "vehicle_approach" | "parking_permission" | "entrance_permission" | "last_mile";
export type AccessSubject = { kind: "vehicle_stop"; stopId: string } | { kind: "inspection_task"; taskId: string; visitId: string };
export type FieldAccessCheck = {
  checkId: string;
  subject: AccessSubject;
  dimension: AccessDimension;
  status: "unknown" | "confirmed" | "blocked" | "needs_review";
  coordinateSnapshot: { vehicleCoordinate: [number, number] | null; targetCoordinate: [number, number] | null };
  reviewer: string;
  checkedAt: string | null;
  validUntil: string | null;
  source: "user_statement" | "field_observation" | "authority_notice" | "other";
  basis: string;
  evidenceRefs: string[];
  releaseBlockedCheckIds: string[];
  recordedAt: string;
};
export type FieldAccessLog = {
  schemaVersion: typeof FIELD_ACCESS_LOG_SCHEMA_VERSION;
  planId: string;
  revision: number;
  checks: FieldAccessCheck[];
};
export type FieldAccessStatus = "unknown" | "needs_review" | "confirmed_with_limits" | "blocked";
export type FieldAccessSlot = {
  key: string;
  subject: AccessSubject;
  dimension: AccessDimension;
  status: FieldAccessStatus;
  reason: string;
  latest: FieldAccessCheck | null;
  activeBlockedCheckIds: string[];
};
export type FieldAccessEvaluation = {
  status: FieldAccessStatus;
  canPlan: boolean;
  slots: FieldAccessSlot[];
  orphanedCheckIds: string[];
};

function fail(message: string): never { throw new Error(`人工通行核验无效：${message}`); }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label}必须是对象。`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max: number, empty = false, multiline = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return (code < 32 && !(multiline && [9, 10, 13].includes(code))) || (code >= 127 && code <= 159);
  })) fail(`${label}格式、长度或控制字符不正确。`);
  return value;
}
function identifier(value: unknown, label: string, evidence = false): string {
  const id = string(value, label, 200);
  if (/\s/u.test(id)) fail(`${label}不能包含空白字符。`);
  if (/[\uD800-\uDFFF]/u.test(id)) fail(`${label}包含不完整的 Unicode 字符。`);
  if (evidence && /^(?:[a-z][a-z\d+.-]*:\/\/|(?:https?|ftp|file|data|javascript|mailto):|\/\/|www\.)/i.test(id)) fail(`${label}只能引用本地证据 ID，不能是 URL。`);
  return id;
}
function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) fail(`${label}不受支持。`);
  return value as T;
}
function coordinate(value: unknown, label: string): [number, number] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "number" || typeof value[1] !== "number" || !Number.isFinite(value[0]) || !Number.isFinite(value[1]) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) fail(`${label}应为有效 WGS84 经度、纬度或空值。`);
  return [value[0], value[1]];
}
function isoTime(value: unknown, label: string): string {
  const time = string(value, label, 24);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(time) || !Number.isFinite(Date.parse(time)) || new Date(time).toISOString() !== (time.length === 20 ? time.replace("Z", ".000Z") : time)) fail(`${label}必须是有效 UTC ISO 日期时间。`);
  return time;
}
function optionalTime(value: unknown, label: string): string | null { return value === null ? null : isoTime(value, label); }
function refs(value: unknown, label: string, evidence = false): string[] {
  if (!Array.isArray(value) || value.length > FIELD_ACCESS_MAX_REFS) fail(`${label}最多支持 ${FIELD_ACCESS_MAX_REFS} 个引用。`);
  const ids = value.map(item => identifier(item, label, evidence));
  if (new Set(ids).size !== ids.length) fail(`${label}标识重复。`);
  return ids;
}
function assertSize(value: unknown): void {
  let json: string | undefined;
  try { json = JSON.stringify(value); } catch { fail("不是可序列化的 JSON 数据。"); }
  if (!json || new TextEncoder().encode(json).byteLength > FIELD_ACCESS_LOG_MAX_BYTES) fail("JSON 文件超过 1 MiB 或内容为空。");
}
function subject(value: unknown): AccessSubject {
  const source = record(value, "核验对象");
  const kind = choice(source.kind, ["vehicle_stop", "inspection_task"], "核验对象类型");
  return kind === "vehicle_stop" ? { kind, stopId: identifier(source.stopId, "停车点 ID") } : { kind, taskId: identifier(source.taskId, "任务 ID"), visitId: identifier(source.visitId, "到访 ID") };
}
function dimensionFor(value: unknown, target: AccessSubject): AccessDimension {
  return target.kind === "vehicle_stop" ? choice(value, ["vehicle_approach", "parking_permission"], "车辆核验维度") : choice(value, ["entrance_permission", "last_mile"], "任务核验维度");
}
function keyFor(target: AccessSubject, dimension: AccessDimension): string {
  return target.kind === "vehicle_stop" ? `vehicle_stop:${encodeURIComponent(target.stopId)}:${dimension}` : `inspection_task:${encodeURIComponent(target.taskId)}:${encodeURIComponent(target.visitId)}:${dimension}`;
}
function hasRequiredCoordinates(check: Pick<FieldAccessCheck, "dimension" | "coordinateSnapshot">): boolean {
  const snapshot = check.coordinateSnapshot;
  if (check.dimension === "entrance_permission") return snapshot.targetCoordinate !== null;
  if (check.dimension === "last_mile") return snapshot.targetCoordinate !== null && snapshot.vehicleCoordinate !== null;
  return snapshot.vehicleCoordinate !== null;
}

/** Validate every record and rebuild a whitelist, including nested snapshots and subjects. */
export function parseFieldAccessLog(value: unknown): FieldAccessLog {
  assertSize(value);
  const source = record(value, "核验历史");
  if (source.schemaVersion !== FIELD_ACCESS_LOG_SCHEMA_VERSION) fail("schemaVersion 不受支持。");
  if (typeof source.revision !== "number" || !Number.isSafeInteger(source.revision) || source.revision < 1) fail("修订号必须是正整数。");
  if (!Array.isArray(source.checks) || source.checks.length > FIELD_ACCESS_MAX_CHECKS) fail(`核验记录最多支持 ${FIELD_ACCESS_MAX_CHECKS} 条。`);
  const previous = new Map<string, FieldAccessCheck>();
  const checks = source.checks.map(value => {
    const row = record(value, "核验记录"), target = subject(row.subject), dimension = dimensionFor(row.dimension, target);
    const snapshot = record(row.coordinateSnapshot, "坐标快照");
    const check: FieldAccessCheck = {
      checkId: identifier(row.checkId, "核验记录 ID"), subject: target, dimension,
      status: choice(row.status, ["unknown", "confirmed", "blocked", "needs_review"], "核验状态"),
      coordinateSnapshot: { vehicleCoordinate: coordinate(snapshot.vehicleCoordinate, "车辆坐标"), targetCoordinate: coordinate(snapshot.targetCoordinate, "目标坐标") },
      reviewer: string(row.reviewer, "核验人", 200, true), checkedAt: optionalTime(row.checkedAt, "核验时间"), validUntil: optionalTime(row.validUntil, "有效期限"),
      source: choice(row.source, ["user_statement", "field_observation", "authority_notice", "other"], "依据来源"), basis: string(row.basis, "核验依据", 4000, true, true),
      evidenceRefs: refs(row.evidenceRefs, "证据引用", true), releaseBlockedCheckIds: refs(row.releaseBlockedCheckIds, "解除阻断引用"), recordedAt: isoTime(row.recordedAt, "录入时间"),
    };
    if (previous.has(check.checkId)) fail("核验记录 ID 重复，不能覆盖或复制已有身份。");
    if (check.checkedAt !== null && Date.parse(check.checkedAt) > Date.parse(check.recordedAt)) fail("核验时间不能晚于录入时间。");
    if (check.validUntil !== null && (check.checkedAt === null || Date.parse(check.validUntil) <= Date.parse(check.checkedAt))) fail("有效期限必须晚于核验时间。");
    if ((check.status === "confirmed" || check.status === "blocked") && (!check.reviewer.trim() || !check.basis.trim() || check.checkedAt === null)) fail("确认或阻断记录必须包含核验人、依据和核验时间。");
    if (check.status === "confirmed" && (check.validUntil === null || !hasRequiredCoordinates(check))) fail("确认记录必须包含有效期限与该维度需要的坐标。");
    if (check.releaseBlockedCheckIds.length && check.status !== "confirmed") fail("只有确认记录可以明确解除阻断。");
    for (const blockedId of check.releaseBlockedCheckIds) {
      const blocked = previous.get(blockedId);
      if (!blocked || blocked.status !== "blocked" || keyFor(blocked.subject, blocked.dimension) !== keyFor(check.subject, check.dimension)) fail("解除引用必须指向同一对象与维度的已有阻断记录。");
      if (Date.parse(check.checkedAt!) < Date.parse(blocked.checkedAt!)) fail("解除阻断的核验时间不能早于阻断核验时间。");
    }
    previous.set(check.checkId, check);
    return check;
  });
  return { schemaVersion: FIELD_ACCESS_LOG_SCHEMA_VERSION, planId: identifier(source.planId, "方案 ID"), revision: source.revision, checks };
}

export function createFieldAccessLog(planId: string): FieldAccessLog {
  return parseFieldAccessLog({ schemaVersion: FIELD_ACCESS_LOG_SCHEMA_VERSION, planId, revision: 1, checks: [] });
}

/** Immutable append; the persistence transaction owns the revision increment. */
export function appendFieldAccessCheck(log: FieldAccessLog, check: FieldAccessCheck): FieldAccessLog {
  const previous = parseFieldAccessLog(log);
  return parseFieldAccessLog({ ...previous, checks: [...previous.checks, check] });
}

function capture(plan: FieldTaskPlan, target: AccessSubject, dimension: AccessDimension): FieldAccessCheck["coordinateSnapshot"] {
  if (target.kind === "vehicle_stop") {
    const stop = plan.stops.find(stop => stop.stopId === target.stopId);
    if (!stop) fail("停车点不属于当前方案，不能复制旧对象核验。");
    return { vehicleCoordinate: stop.coordinate ? [...stop.coordinate] : null, targetCoordinate: null };
  }
  const task = plan.tasks.find(task => task.taskId === target.taskId), visit = plan.visits.find(visit => visit.visitId === target.visitId && visit.taskIds.includes(target.taskId));
  if (!task || !visit) fail("任务与到访引用不属于当前方案，不能复制旧对象核验。");
  const stop = plan.stops.find(stop => stop.stopId === visit.stopId)!;
  return { vehicleCoordinate: dimension === "last_mile" && stop.coordinate ? [...stop.coordinate] : null, targetCoordinate: task.targetCoordinate ? [...task.targetCoordinate] : null };
}

/** Capture a dimension-specific current snapshot; unfinished drafts may retain null coordinates. */
export function captureFieldAccessSubject(plan: FieldTaskPlan, value: AccessSubject, dimension: AccessDimension): FieldAccessCheck["coordinateSnapshot"] {
  const clean = parseFieldTaskPlan(plan), target = subject(value), selected = dimensionFor(dimension, target);
  return capture(clean, target, selected);
}

function sameCoordinate(a: [number, number] | null, b: [number, number] | null): boolean { return a === null ? b === null : b !== null && a[0] === b[0] && a[1] === b[1]; }
function confirmationIssue(check: FieldAccessCheck, snapshot: FieldAccessCheck["coordinateSnapshot"], assessedAt: number, availableEvidenceIds: Set<string> | null): string | null {
  if (Date.parse(check.recordedAt) > assessedAt || (check.checkedAt !== null && Date.parse(check.checkedAt) > assessedAt)) return "核验或录入时间晚于评估时间，需核对时钟与记录。";
  if (!check.reviewer.trim() || !check.basis.trim() || check.checkedAt === null || check.validUntil === null || !hasRequiredCoordinates(check)) return "核验记录缺少核验人、时间、有效期限、依据或必要坐标。";
  if (Date.parse(check.validUntil) <= assessedAt) return "核验记录已过期，需重新核验。";
  const vehicleNeeded = check.dimension !== "entrance_permission", targetNeeded = check.dimension === "entrance_permission" || check.dimension === "last_mile";
  if ((vehicleNeeded && !sameCoordinate(check.coordinateSnapshot.vehicleCoordinate, snapshot.vehicleCoordinate)) || (targetNeeded && !sameCoordinate(check.coordinateSnapshot.targetCoordinate, snapshot.targetCoordinate))) return "当前坐标与核验快照不一致，需重新核验。";
  if (check.evidenceRefs.length && (!availableEvidenceIds || check.evidenceRefs.some(id => !availableEvidenceIds.has(id)))) return "引用的证据未提供或已缺失，需人工复核。";
  return null;
}

/** Deterministic review aid only: confirmed_with_limits never certifies real-world safety. */
export function evaluateFieldAccessLog(plan: FieldTaskPlan, log: FieldAccessLog, options: { assessedAt: string; availableEvidenceIds?: string[]; selectedTaskIds?: string[]; selectedVisitIds?: string[] }): FieldAccessEvaluation {
  const current = parseFieldTaskPlan(plan), history = parseFieldAccessLog(log);
  if (current.planId !== history.planId) fail("核验历史的方案 ID 不匹配，不能复制到另一方案。");
  const assessedAt = Date.parse(isoTime(options.assessedAt, "评估时间"));
  const availableEvidenceIds = options.availableEvidenceIds === undefined ? null : new Set(options.availableEvidenceIds.map(id => identifier(id, "可用证据 ID", true)));
  const selectedTasks = options.selectedTaskIds === undefined ? null : new Set(options.selectedTaskIds);
  if (selectedTasks && (selectedTasks.size !== options.selectedTaskIds!.length || [...selectedTasks].some(id => !current.tasks.some(task => task.taskId === id))
    || current.tasks.some(task => task.required && !selectedTasks.has(task.taskId))
    || (!(current.planningGoal === "coverage" || current.planningGoal === "priority") && selectedTasks.size !== current.tasks.length))) fail("执行集合缺少必查任务或包含其他任务，不能缩小通行核验。");
  const selectedVisits = options.selectedVisitIds === undefined ? null : new Set(options.selectedVisitIds);
  if (selectedVisits && (selectedVisits.size !== options.selectedVisitIds!.length || [...selectedVisits].some(id => !current.visits.some(visit => visit.visitId === id))
    || !selectedVisits.has(current.visits[0].visitId) || !selectedVisits.has(current.visits.at(-1)!.visitId)
    || current.visits.some(visit => visit.taskIds.some(id => !selectedTasks || selectedTasks.has(id)) && !selectedVisits.has(visit.visitId)))) fail("执行到访集合与起终点、必查任务不一致。");
  const visits = current.visits.filter((visit, index) => selectedVisits ? selectedVisits.has(visit.visitId) : !selectedTasks || index === 0 || index === current.visits.length - 1 || visit.taskIds.some(id => selectedTasks.has(id)));
  const activeStops = new Set(visits.map(visit => visit.stopId));
  const slots: FieldAccessSlot[] = [];
  const addSlot = (target: AccessSubject, dimension: AccessDimension) => slots.push({ key: keyFor(target, dimension), subject: target, dimension, status: "unknown", reason: "尚无人工核验记录。", latest: null, activeBlockedCheckIds: [] });
  for (const stop of current.stops.filter(stop => activeStops.has(stop.stopId))) for (const dimension of ["vehicle_approach", "parking_permission"] as const) addSlot({ kind: "vehicle_stop", stopId: stop.stopId }, dimension);
  for (const visit of visits) for (const taskId of visit.taskIds.filter(id => !selectedTasks || selectedTasks.has(id))) for (const dimension of ["entrance_permission", "last_mile"] as const) addSlot({ kind: "inspection_task", taskId, visitId: visit.visitId }, dimension);
  const slotMap = new Map(slots.map(slot => [slot.key, slot])), orphanedCheckIds: string[] = [];
  const allSubjectKeys = new Set<string>();
  for (const stop of current.stops) for (const dimension of ["vehicle_approach", "parking_permission"] as const) allSubjectKeys.add(keyFor({ kind: "vehicle_stop", stopId: stop.stopId }, dimension));
  for (const visit of current.visits) for (const taskId of visit.taskIds) for (const dimension of ["entrance_permission", "last_mile"] as const) allSubjectKeys.add(keyFor({ kind: "inspection_task", taskId, visitId: visit.visitId }, dimension));
  for (const check of history.checks) {
    const slot = slotMap.get(keyFor(check.subject, check.dimension));
    if (!slot) { if (!allSubjectKeys.has(keyFor(check.subject, check.dimension))) orphanedCheckIds.push(check.checkId); continue; }
    slot.latest = check;
    if (check.status === "blocked") slot.activeBlockedCheckIds.push(check.checkId);
    if (check.status === "confirmed" && confirmationIssue(check, capture(current, slot.subject, slot.dimension), assessedAt, availableEvidenceIds) === null) {
      const released = new Set(check.releaseBlockedCheckIds);
      slot.activeBlockedCheckIds = slot.activeBlockedCheckIds.filter(id => !released.has(id));
    }
  }
  for (const slot of slots) {
    const target = slot.subject;
    const task = target.kind === "inspection_task" ? current.tasks.find(task => task.taskId === target.taskId) : null;
    if (slot.activeBlockedCheckIds.length || task?.legacyAccessReview === "blocked") {
      slot.status = "blocked";
      const failedRelease = history.checks.some(check => check.status === "confirmed" && keyFor(check.subject, check.dimension) === slot.key && check.releaseBlockedCheckIds.some(id => slot.activeBlockedCheckIds.includes(id)));
      slot.reason = slot.activeBlockedCheckIds.length ? failedRelease ? "解除依据已失效或待复核，原人工禁入记录未解除。" : "存在未明确解除的人工禁入记录；后续未知记录、坐标变化或过期均不能解除。" : "历史任务记录为禁止进入，须处理历史阻断后才能规划。";
      continue;
    }
    const latest = slot.latest;
    if (!latest) continue;
    if (latest.status === "confirmed") {
      const issue = confirmationIssue(latest, capture(current, slot.subject, slot.dimension), assessedAt, availableEvidenceIds);
      slot.status = issue ? "needs_review" : "confirmed_with_limits";
      slot.reason = issue ?? "人工核验记录在声明的坐标与有效期内完整；仅供规划参考，不保证道路、停车或进入安全。";
    } else if (latest.status === "needs_review" || Date.parse(latest.recordedAt) > assessedAt || (latest.checkedAt !== null && Date.parse(latest.checkedAt) > assessedAt)) {
      slot.status = "needs_review";
      slot.reason = latest.status === "needs_review" ? "人工记录要求再次复核。" : "核验或录入时间晚于评估时间，需核对时钟与记录。";
    } else { slot.status = "unknown"; slot.reason = "最新人工记录为未知，尚未形成有效核验。"; }
  }
  const blocked = slots.some(slot => slot.status === "blocked") || current.tasks.some(task => (!selectedTasks || selectedTasks.has(task.taskId)) && task.legacyAccessReview === "blocked");
  const status: FieldAccessStatus = blocked ? "blocked" : slots.some(slot => slot.status === "needs_review") ? "needs_review" : slots.some(slot => slot.status === "unknown") ? "unknown" : "confirmed_with_limits";
  return { status, canPlan: !blocked, slots, orphanedCheckIds };
}

/** Translate current manual blocks into transport eligibility without changing the task pool. */
export function fieldAccessTaskExclusions(plan: FieldTaskPlan, evaluation: FieldAccessEvaluation): Record<string, string> {
  const current = parseFieldTaskPlan(plan), reasons = new Map<string, string>();
  for (const slot of evaluation.slots.filter(slot => slot.status === "blocked")) {
    if (slot.subject.kind === "inspection_task") reasons.set(slot.subject.taskId, slot.reason);
    else {
      const stopId = slot.subject.stopId;
      for (const visit of current.visits.filter(visit => visit.stopId === stopId)) for (const taskId of visit.taskIds) reasons.set(taskId, slot.reason);
    }
  }
  // Imported task IDs may equal Object.prototype names, including __proto__.
  return Object.fromEntries(reasons);
}
