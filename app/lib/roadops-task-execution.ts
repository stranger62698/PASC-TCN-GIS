import { validateFieldTaskCandidate, type FieldTaskCandidate } from "./roadops-task-candidates";

/** User-entered observations only; no provider route/time/geometry is stored. */
export type FieldExecutionRecord = {
  recordId: string; planId: string; revision: number; candidateId: string; taskId: string; visitId: string;
  status: "completed" | "incomplete"; actualStart: string | null; actualEnd: string | null;
  actualMinutes: number | null; reason: string; evidenceRefs: string[]; recordedAt: string;
};
export type FieldExecutionInput = Omit<FieldExecutionRecord, "planId" | "revision" | "candidateId">;
const STORAGE_KEY = "lanjifyw:field-execution:v1";
function fail(message: string): never { throw new Error(`外业执行记录：${message}`); }
function text(value: unknown, label: string, max = 200, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || (code >= 127 && code <= 159);
  })) fail(`${label}无效。`);
  return value;
}
function id(value: unknown, label: string): string {
  const result = text(value, label);
  if (/\s/.test(result)) fail(`${label}不能包含空白字符。`);
  return result;
}
function time(value: unknown, label: string): string | null {
  if (value === null) return null;
  const result = text(value, label, 24);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result) || !Number.isFinite(Date.parse(result))) fail(`${label}必须是 UTC ISO 时间。`);
  if (new Date(result).toISOString() !== (result.length === 20 ? result.replace("Z", ".000Z") : result)) fail(`${label}日期无效。`);
  return result;
}
export function parseFieldExecutionRecord(value: unknown): FieldExecutionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("记录必须是对象。");
  const item = value as Record<string, unknown>;
  if (!Number.isSafeInteger(item.revision) || (item.revision as number) < 1) fail("计划修订号无效。");
  if (item.status !== "completed" && item.status !== "incomplete") fail("完成状态无效。");
  const actualStart = time(item.actualStart, "实际开始"), actualEnd = time(item.actualEnd, "实际结束"), recordedAt = time(item.recordedAt, "录入时间");
  if (!recordedAt) fail("录入时间不能为空。");
  if (actualStart && actualEnd && Date.parse(actualEnd) < Date.parse(actualStart)) fail("实际结束不能早于开始。");
  const actualMinutes = item.actualMinutes;
  if (actualMinutes !== null && (typeof actualMinutes !== "number" || !Number.isFinite(actualMinutes) || actualMinutes < 0 || actualMinutes > 43200)) fail("实际耗时应为非负分钟或未知。");
  if (actualStart && actualEnd && actualMinutes !== null && Math.abs((Date.parse(actualEnd) - Date.parse(actualStart)) / 60000 - (actualMinutes as number)) > 1e-8) fail("实际时刻与实际耗时不一致。");
  const reason = text(item.reason, "未完成原因", 4000, item.status === "completed");
  if (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length > 20) fail("最多引用 20 项已有证据。");
  const evidenceRefs = item.evidenceRefs.map(value => id(value, "证据 ID"));
  if (new Set(evidenceRefs).size !== evidenceRefs.length || evidenceRefs.some(value => /^(?:[a-z][a-z\d+.-]*:\/\/|(?:https?|ftp|file|data|javascript|mailto):|\/\/|www\.)/i.test(value))) fail("证据只能引用唯一的本地照片 ID，不能是 URL。");
  return { recordId: id(item.recordId, "记录 ID"), planId: id(item.planId, "计划 ID"), revision: item.revision as number,
    candidateId: id(item.candidateId, "采用方案 ID"), taskId: id(item.taskId, "任务 ID"), visitId: id(item.visitId, "到访 ID"), status: item.status,
    actualStart, actualEnd, actualMinutes: actualMinutes as number | null, reason, evidenceRefs, recordedAt };
}

export function createFieldExecutionRecord(candidate: FieldTaskCandidate, input: FieldExecutionInput, options: { availableEvidenceIds?: string[] } = {}): FieldExecutionRecord {
  const validated = validateFieldTaskCandidate(candidate.plan, candidate);
  if (!validated.report.selectedTaskIds.includes(input.taskId) || !validated.report.visits.some(visit => visit.visitId === input.visitId && visit.tasks.some(task => task.taskId === input.taskId))) fail("只能记录本次采用方案中已安排的任务与到访。");
  const record = parseFieldExecutionRecord({ ...input, planId: validated.plan.planId, revision: validated.plan.revision, candidateId: validated.candidateId });
  if (record.evidenceRefs.length && (!options.availableEvidenceIds || record.evidenceRefs.some(id => !options.availableEvidenceIds!.includes(id)))) fail("引用的照片证据不存在或未提供，请重新选择。");
  return record;
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
}
export function createFieldExecutionStore(storage: Pick<Storage, "getItem" | "setItem"> | undefined = defaultStorage()) {
  const all = (): FieldExecutionRecord[] => {
    if (!storage) fail("本地存储不可用，未保存完成状态。");
    let raw: string | null;
    try { raw = storage.getItem(STORAGE_KEY); } catch { fail("无法读取本地执行记录。"); }
    if (raw === null) return [];
    if (new TextEncoder().encode(raw).byteLength > 1024 * 1024) fail("执行记录超过 1 MiB。");
    try {
      const value = JSON.parse(raw);
      if (value.schemaVersion !== "field-execution-log-v1" || !Array.isArray(value.records) || value.records.length > 1000) fail("执行记录格式无效。");
      const records = value.records.map(parseFieldExecutionRecord) as FieldExecutionRecord[];
      if (new Set(records.map(record => record.recordId)).size !== records.length) fail("执行记录 ID 重复。");
      return records;
    } catch { fail("本地执行记录损坏，未覆盖原数据。"); }
  };
  return {
    list(planId: string): FieldExecutionRecord[] { return all().filter(record => record.planId === id(planId, "计划 ID")).sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt)); },
    save(value: FieldExecutionRecord): FieldExecutionRecord {
      const record = parseFieldExecutionRecord(value), records = all(), existing = records.find(item => item.recordId === record.recordId);
      if (existing && ["planId", "revision", "candidateId", "taskId", "visitId"].some(key => existing[key as keyof FieldExecutionRecord] !== record[key as keyof FieldExecutionRecord])) fail("已有记录的计划、修订或任务身份不能改写。");
      const next = records.filter(item => item.recordId !== record.recordId); next.push(record);
      if (next.length > 1000) fail("执行记录已达上限，请先备份；未删除旧记录。");
      const raw = JSON.stringify({ schemaVersion: "field-execution-log-v1", records: next });
      if (new TextEncoder().encode(raw).byteLength > 1024 * 1024) fail("执行记录超过 1 MiB，未删除旧记录。");
      try { storage!.setItem(STORAGE_KEY, raw); } catch { fail("本地空间不足或写入失败，未声明已保存。"); }
      return record;
    },
  };
}
