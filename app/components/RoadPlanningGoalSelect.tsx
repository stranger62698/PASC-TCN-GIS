"use client";

import { FIELD_PLANNING_GOALS, type FieldPlanningGoal } from "../lib/roadops-planning-goals";

export function RoadPlanningGoalSelect({ goal: value, disabled, onChange }: { goal: FieldPlanningGoal; disabled?: boolean; onChange: (goal: FieldPlanningGoal) => void }) {
  return <section className="road-navigation-preferences" aria-label="核查需求设置">
    <label className="road-navigation-strategy">本次核查需求
      <select aria-label="本次核查需求" value={value} disabled={disabled} onChange={event => onChange(event.target.value as FieldPlanningGoal)}>
        {FIELD_PLANNING_GOALS.map(goal => <option key={goal.value} value={goal.value}>{goal.label}</option>)}
      </select>
    </label>
    <p className="road-navigation-help">{FIELD_PLANNING_GOALS.find(goal => goal.value === value)!.description} 修改后手动生成方案。</p>
  </section>;
}
