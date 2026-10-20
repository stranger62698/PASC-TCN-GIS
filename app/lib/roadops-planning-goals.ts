export type FieldPlanningGoal = "time" | "distance" | "coverage" | "priority";

export const FIELD_PLANNING_GOALS: ReadonlyArray<{ value: FieldPlanningGoal; label: string; description: string }> = [
  { value: "time", label: "更快完成", description: "保留全部任务，减少已知总耗时。" },
  { value: "distance", label: "少跑里程", description: "保留全部任务，在工时内减少道路里程。" },
  { value: "coverage", label: "限时多查", description: "先保留必查，在剩余时间内安排更多任务。" },
  { value: "priority", label: "重点核查", description: "先保留必查，再优先安排高优先级任务。" },
];

export const fieldPlanningGoalLabel = (goal: FieldPlanningGoal) => FIELD_PLANNING_GOALS.find(item => item.value === goal)!.label;
