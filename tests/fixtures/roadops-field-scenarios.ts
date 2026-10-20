import { createFieldTaskPlan, type FieldTaskPlan } from "../../app/lib/roadops-task-plan";
import { createNavigationDraft, type NavigationDraft } from "../../app/lib/roadops-navigation";

/** Local fixtures only: no supplier response, no real route, no assertion of safe access. */
export const FIELD_SCENARIO_LABEL = "测试/模拟 · 不代表真实道路、路况或进入许可";
const now = "2026-10-08T00:30:00.000Z";

export function makeSimulatedNavigationDraft(): NavigationDraft {
  const draft = createNavigationDraft();
  return { ...draft,
    origin: { ...draft.origin, coordinate: [110.30, 20.00] },
    waypoints: [{ id: "simulation-task-a", name: "模拟核查点 A", coordinate: [110.31, 20.01], role: "candidate", dwellMinutes: 20, accessReview: "unknown", accessNote: "模拟备注：须人工核验入口" }],
    destination: { ...draft.destination, coordinate: [110.32, 20.02] },
  };
}

export function makeSimulatedFieldTaskPlan(): FieldTaskPlan {
  return createFieldTaskPlan(makeSimulatedNavigationDraft(), { planId: "simulation-plan", name: "模拟单程方案", now });
}

export function makeSimulatedReturnPlan(): FieldTaskPlan {
  const plan = makeSimulatedFieldTaskPlan();
  const terminal = plan.visits.at(-1)!;
  return { ...plan, name: "模拟返回原地", tripMode: "return_to_start",
    stops: plan.stops.filter(stop => stop.stopId !== terminal.stopId),
    visits: plan.visits.map((visit, index) => index === plan.visits.length - 1 ? { ...visit, stopId: plan.visits[0].stopId } : visit),
    tasks: plan.tasks.map(task => task.taskId === terminal.taskIds[0] ? { ...task, targetCoordinate: plan.tasks[0].targetCoordinate } : task) };
}

export function makeSimulatedSharedStopPlan(): FieldTaskPlan {
  const plan = makeSimulatedFieldTaskPlan(), base = plan.tasks[1];
  return { ...plan, name: "模拟三个目标共用停车点", tasks: [...plan.tasks,
    { ...base, taskId: "simulation-task-b", name: "模拟核查点 B", targetCoordinate: [110.3101, 20.0101] },
    { ...base, taskId: "simulation-task-c", name: "模拟核查点 C", targetCoordinate: [110.3102, 20.0102] }],
    stops: plan.stops.map((stop, index) => index === 1 ? { ...stop, usesVehicleCoordinate: true } : stop),
    visits: plan.visits.map((visit, index) => index === 1 ? { ...visit, taskIds: [...visit.taskIds, "simulation-task-b", "simulation-task-c"] } : visit) };
}

const ordinary = makeSimulatedFieldTaskPlan();
export const FIELD_TASK_SCENARIOS = {
  ordinary: { mode: "simulation", label: FIELD_SCENARIO_LABEL, plan: ordinary },
  returnToStart: { mode: "simulation", label: FIELD_SCENARIO_LABEL, plan: makeSimulatedReturnPlan() },
  sharedThreeTargets: { mode: "simulation", label: FIELD_SCENARIO_LABEL, plan: makeSimulatedSharedStopPlan() },
  directedCosts: { mode: "simulation", label: FIELD_SCENARIO_LABEL, plan: ordinary,
    costs: [{ from: "A", to: "B", minutes: 10 }, { from: "B", to: "A", minutes: 17 }] },
  unreachable: { mode: "simulation", label: FIELD_SCENARIO_LABEL, plan: ordinary,
    costs: [{ from: "A", to: "B", minutes: null, status: "simulated_unreachable" }] },
  accessUnknown: { mode: "simulation", label: FIELD_SCENARIO_LABEL, plan: ordinary },
  accessBlocked: { mode: "simulation", label: FIELD_SCENARIO_LABEL, plan: { ...ordinary, tasks: ordinary.tasks.map((task, index) => index === 1 ? { ...task, legacyAccessReview: "blocked" as const, accessNote: "模拟禁入：不可当作现实封路事实" } : task) } },
  timeWindowConflict: { mode: "simulation", label: FIELD_SCENARIO_LABEL, plan: ordinary,
    windows: [{ taskId: "simulation-task-a", start: "09:00", end: "09:10", serviceMinutes: 20 }] },
  expiredEvidence: { mode: "simulation", label: FIELD_SCENARIO_LABEL, plan: ordinary,
    evidence: { collectedAt: "2025-01-01T00:00:00.000Z", expiresAt: "2025-02-01T00:00:00.000Z", source: "模拟数据" } },
  corruptStorage: { mode: "simulation", label: FIELD_SCENARIO_LABEL,
    json: '{"schemaVersion":"field-task-plan-v1","visits":[' },
} as const;
