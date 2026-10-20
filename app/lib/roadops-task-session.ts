import { parseFieldTaskPlan, type FieldTaskPlan } from "./roadops-task-plan";
import { compileFieldTaskRouting, type FieldTaskRouteReceipt } from "./roadops-task-routing";
import { buildFieldTaskReport } from "./roadops-task-report";

function userContent(plan: FieldTaskPlan): string {
  // These fields are controlled by the explicit save/copy transaction, not route inputs.
  const content: Partial<FieldTaskPlan> = { ...plan };
  delete content.planId; delete content.revision; delete content.createdAt; delete content.updatedAt; delete content.name;
  return JSON.stringify(content);
}

function currentReceipt(plan: FieldTaskPlan, receipt: FieldTaskRouteReceipt | null): FieldTaskRouteReceipt | null {
  if (!receipt || receipt.planId !== plan.planId || receipt.revision !== plan.revision) return null;
  try {
    const issued = compileFieldTaskRouting(plan, {}, { excludedTaskReasons: receipt.inputExclusions });
    if (receipt.inputSignature !== issued.inputSignature) return null;
    // A matching metadata string alone cannot legitimize a corrupted task/visit selection.
    buildFieldTaskReport(plan, receipt, { assessedAt: receipt.generatedAt });
    return receipt;
  } catch { return null; }
}

/**
 * Apply only save/copy metadata to the current session. All user route inputs and identities
 * must match exactly. Supplier geometry/time remains in memory; this helper never saves/fetches.
 */
export function syncFieldTaskPlanMetadata(current: FieldTaskPlan, saved: FieldTaskPlan, receipt: FieldTaskRouteReceipt | null): {
  plan: FieldTaskPlan; receipt: FieldTaskRouteReceipt | null;
} {
  const plan = parseFieldTaskPlan(current), persisted = parseFieldTaskPlan(saved), bound = currentReceipt(plan, receipt);
  if ((persisted.planId === plan.planId && persisted.revision < plan.revision) || userContent(plan) !== userContent(persisted)) return { plan, receipt: bound };
  return {
    plan: persisted,
    receipt: bound === null ? null : { ...bound, planId: persisted.planId, revision: persisted.revision,
      inputSignature: compileFieldTaskRouting(persisted, {}, { excludedTaskReasons: bound.inputExclusions }).inputSignature },
  };
}
