import { fieldPlanningGoalLabel, type FieldPlanningGoal } from "../lib/roadops-planning-goals";

export type CandidateSummary = {
  candidateId: string; goal: FieldPlanningGoal; active: boolean;
  distanceMeters: number; totalMinutes: number; finishTime: string; workMinutes: number;
  selectedCount: number; requiredCount: number; deferredCount: number;
  sequence: string; strategy: string;
};
const minutes = (value: number) => `${Number(value.toFixed(1))} 分`;

export function RoadPersonalizedCandidates({ candidates, disabled, onAdopt }: { candidates: CandidateSummary[]; disabled: boolean; onAdopt: (id: string) => void }) {
  if (!candidates.length) return null;
  const identical = candidates.length > 1 && candidates.every(candidate => candidate.distanceMeters === candidates[0].distanceMeters && candidate.totalMinutes === candidates[0].totalMinutes && candidate.selectedCount === candidates[0].selectedCount && candidate.sequence === candidates[0].sequence);
  return <section className="road-field-plan road-personalized-candidates" aria-label="个性化核查方案对比">
    <div className="road-field-heading"><h4>方案对比</h4><span>仅本页保留</span></div>
    <div className="road-personalized-table"><table><thead><tr><th scope="col">方案</th><th scope="col">里程</th><th scope="col">时间与任务</th><th scope="col">选择</th></tr></thead><tbody>
      {candidates.map(candidate => <tr key={candidate.candidateId} aria-current={candidate.active ? "true" : undefined}>
        <th scope="row">{fieldPlanningGoalLabel(candidate.goal)}<small>{candidate.strategy}</small></th>
        <td>{(candidate.distanceMeters / 1000).toFixed(3)} km</td>
        <td>{minutes(candidate.totalMinutes)} · {candidate.finishTime} 结束<small>计划 {candidate.selectedCount} 项 · 必查 {candidate.requiredCount} 项 · 延期 {candidate.deferredCount} 项</small><small>{candidate.totalMinutes > candidate.workMinutes ? `超时 ${minutes(candidate.totalMinutes - candidate.workMinutes)}` : `剩余 ${minutes(candidate.workMinutes - candidate.totalMinutes)}`}</small></td>
        <td><button type="button" aria-label={`采用${fieldPlanningGoalLabel(candidate.goal)}方案`} disabled={disabled || candidate.active || candidate.totalMinutes > candidate.workMinutes} onClick={() => onAdopt(candidate.candidateId)}>{candidate.active ? "已采用" : "采用方案"}</button></td>
      </tr>)}
    </tbody></table></div>
    {identical ? <p className="road-navigation-help">本次条件下方案一致。</p> : candidates.length > 1 ? <p className="road-navigation-help">比较总时间、里程和计划任务；选择后同步地图与逐站安排。</p> : <p className="road-navigation-help">选择另一需求并手动规划，即可比较。</p>}
  </section>;
}
