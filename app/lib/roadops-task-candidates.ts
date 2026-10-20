import { parseRoadOpsDrivingPlan, type RoadOpsDrivingPlan } from "./roadops-driving";
import { parseFieldTaskPlan, type FieldPlanningGoal, type FieldTaskPlan } from "./roadops-task-plan";
import { buildFieldTaskReport, type FieldTaskReport } from "./roadops-task-report";
import { bindFieldTaskRoute, compileFieldTaskRouting, type FieldTaskRouteReceipt } from "./roadops-task-routing";

/** Supplier results and private snapshots stay in memory. Never put this in draft storage. */
export type FieldTaskCandidate = {
  candidateId: string; objective: FieldPlanningGoal; generatedAt: string; baseKey: string;
  plan: Readonly<FieldTaskPlan>; receipt: FieldTaskRouteReceipt | null;
  providerPlan: RoadOpsDrivingPlan | null; report: FieldTaskReport;
  inputExclusions: Record<string, string>;
};

function fail(message: string): never { throw new Error(`外业候选方案：${message}`); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Preference-only autosaves may have different revisions; all real task inputs remain bound. */
export function candidateBaseKey(value: FieldTaskPlan): string {
  const plan = parseFieldTaskPlan(value);
  const { planningGoal: _goal, strategy: _strategy, revision: _revision, updatedAt: _updatedAt, name: _name, ...inputs } = plan;
  void _goal; void _strategy; void _revision; void _updatedAt; void _name;
  return JSON.stringify(inputs);
}

export function createFieldTaskCandidate(value: FieldTaskPlan, options: {
  candidateId: string; generatedAt: string; assessedAt: string;
  receipt: FieldTaskRouteReceipt | null; providerPlan?: RoadOpsDrivingPlan | null;
  inputExclusions?: Record<string, string>;
}): FieldTaskCandidate {
  const plan = parseFieldTaskPlan(value), generatedAt = options.receipt?.generatedAt ?? options.generatedAt;
  if (!options.candidateId.trim() || options.candidateId.length > 200 || /\s/.test(options.candidateId) || !Number.isFinite(Date.parse(generatedAt))) fail("候选身份或生成时间无效。");
  const receipt = options.receipt ? clone(options.receipt) : null;
  const providerPlan = options.providerPlan ? clone(parseRoadOpsDrivingPlan(options.providerPlan)) : null;
  if (receipt) {
    if (!providerPlan) fail("驾车候选缺少对应的内存道路结果。");
    const issued = compileFieldTaskRouting(plan, {}, { excludedTaskReasons: receipt.inputExclusions });
    const rebound = bindFieldTaskRoute(plan, { plan: providerPlan }, issued);
    if (JSON.stringify(rebound) !== JSON.stringify(receipt)) fail("道路地图与逐站回执不一致，未创建候选。");
  } else if (providerPlan) fail("同站方案不得附带伪造道路结果。");
  const inputExclusions = clone(receipt?.inputExclusions ?? options.inputExclusions ?? {});
  const report = buildFieldTaskReport(plan, receipt, { assessedAt: options.assessedAt, inputExclusions });
  return freeze({ candidateId: options.candidateId, objective: plan.planningGoal ?? (plan.strategy === "5" ? "distance" : "time"),
    generatedAt, baseKey: candidateBaseKey(plan), plan: clone(plan), receipt, providerPlan, report, inputExclusions });
}

/** Adopt the validated snapshot itself; never rewrite a receipt onto a newer draft. */
export function validateFieldTaskCandidate(current: FieldTaskPlan, candidate: FieldTaskCandidate, options: { assessedAt?: string; maxAgeMinutes?: number } = {}): FieldTaskCandidate {
  if (!candidate || candidate.baseKey !== candidateBaseKey(current) || candidate.baseKey !== candidateBaseKey(candidate.plan)) fail("任务、位置、工时或顺序约束已变化，旧候选已失效，请重新生成。");
  if (options.assessedAt) {
    const age = (Date.parse(options.assessedAt) - Date.parse(candidate.generatedAt)) / 60000;
    if (!Number.isFinite(age) || age < 0 || age >= (options.maxAgeMinutes ?? 30)) fail("候选时间已过期或时钟不一致，请手动重新规划。");
  }
  const rebuilt = createFieldTaskCandidate(candidate.plan, { candidateId: candidate.candidateId, generatedAt: candidate.generatedAt,
    assessedAt: candidate.report.assessedAt, receipt: candidate.receipt, providerPlan: candidate.providerPlan, inputExclusions: candidate.inputExclusions });
  if (rebuilt.objective !== candidate.objective || JSON.stringify(rebuilt.report) !== JSON.stringify(candidate.report)) fail("候选快照或报告已被改写，未采用。");
  return rebuilt;
}
