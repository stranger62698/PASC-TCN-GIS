import type { RoadOpsDrivingPlan } from "../lib/roadops-driving";
import { strategyLabel, type RoadStrategyComparison, type RoadStrategyComparisonUnavailableReason, type RoadDrivingStrategy } from "../lib/roadops-strategy-comparison";
import styles from "./RoadStrategySummary.module.css";

type PlanWithPlanning = RoadOpsDrivingPlan & { planning?: { requestedStrategy: RoadDrivingStrategy; orderMode: "input" | "optimize"; orderingObjective: "input_order" | "duration" | "distance" }; drivingDurationSeconds?: number };
const reasons: Record<RoadStrategyComparisonUnavailableReason, string> = {
  input_changed: "规划输入已变化，不能与上次方案直接比较。",
  same_strategy: "本次仍使用相同策略；手动重算其他策略后对比。",
  invalid_time: "方案生成时间无效，暂不比较。",
  future_time: "方案生成时间异常，暂不比较。",
  expired: "对比快照已超过 30 分钟，请手动重新规划。",
  provenance_changed: "两次方案的数据来源或运行模式不同，不能直接比较。",
  invalid_metrics: "缺少有效的原始时距指标，暂不比较。",
};
const objectiveLabels = { input_order: "按输入顺序", distance: "按道路距离排序", duration: "按预计耗时排序" };
const finiteNonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function durationLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60), remainder = seconds - minutes * 60;
  return `${minutes} 分 ${remainder} 秒`;
}

function timeLabel(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(parsed) : "时间未知";
}

function signed(value: number, unit: string): string {
  return `${value > 0 ? "+" : ""}${value} ${unit}`;
}

export function RoadStrategySummary({ plan, comparison = null }: { plan: RoadOpsDrivingPlan; comparison?: RoadStrategyComparison | null }) {
  const response = plan as PlanWithPlanning;
  const seconds = finiteNonnegative(response.drivingDurationSeconds) ? response.drivingDurationSeconds : undefined;
  const strategy = response.planning ? strategyLabel(response.planning.requestedStrategy) : "未回显（旧方案）";
  return <section className={styles.summary} aria-label="本次驾车策略与方案对比">
    <div className={styles.heading}><strong>本次驾车方案</strong><span className={styles.strategy}>{strategy}</span></div>
    <p className={styles.meta}>{response.planning ? objectiveLabels[response.planning.orderingObjective] : "排序目标未回显"}<span aria-hidden="true"> · </span>{plan.mode === "didi_replay" ? "契约回放" : plan.usage.cached ? "复用缓存" : "本次请求"}<span aria-hidden="true"> · </span>生成于 {timeLabel(plan.generatedAt)}（北京时间）</p>
    <dl className={styles.metrics}>
      <div><dt>道路距离</dt><dd>{finiteNonnegative(plan.totalDistanceMeters) ? `${(plan.totalDistanceMeters / 1000).toFixed(3)} 公里` : "未知"}<small>{finiteNonnegative(plan.totalDistanceMeters) ? `${plan.totalDistanceMeters} 米（原始指标）` : "原始距离缺失"}</small></dd></div>
      <div><dt>驾车预计耗时</dt><dd>{seconds === undefined ? "原始秒值缺失" : durationLabel(seconds)}<small>{seconds === undefined ? "不以舍入分钟判断精确差值" : `${seconds} 秒（原始指标）`}</small></dd></div>
    </dl>
    {comparison?.status === "comparable" ? <div className={styles.comparison}>
      <h5>{strategyLabel(comparison.previousStrategy)} <span aria-hidden="true">→</span> {strategyLabel(comparison.currentStrategy)}</h5>
      <dl className={styles.differences}><div><dt>距离差</dt><dd>{signed(comparison.distanceDeltaMeters, "米")}<small>{comparison.previousDistanceMeters} → {comparison.currentDistanceMeters} 米</small></dd></div><div><dt>驾车耗时差</dt><dd>{signed(comparison.durationDeltaSeconds, "秒")}<small>{comparison.previousDurationSeconds} → {comparison.currentDurationSeconds} 秒</small></dd></div></dl>
      <p>{comparison.metricsIdentical ? "未舍入的距离与耗时指标相同。" : "以上差值为本次减上次，负值表示减少。"} 停靠顺序{comparison.stopOrderIdentical ? "一致" : "有变化"}。</p>
      <p>{comparison.geometry === "identical" ? "返回折线坐标一致；不代表已独立核实道路偏好。" : comparison.geometry === "coordinates_differ" ? "折线坐标有差异，不必然表示道路不同（采样也可能变化）。" : "折线坐标不完整，无法比较几何。"}</p>
      <p className={styles.note}>上次 {timeLabel(comparison.previousGeneratedAt)} / 本次 {timeLabel(comparison.currentGeneratedAt)}（北京时间）。仅比较 30 分钟内同输入的算路快照，不证明实时交通或现场通行条件。</p>
    </div> : <p className={styles.note}>{comparison?.status === "unavailable" ? reasons[comparison.reason] : "手动重算其他策略后对比；不会自动请求五种策略。"}</p>}
    <p className={styles.note}>策略表示本次请求偏好，不同策略可能返回相同路线；“不走高速”不等于已独立核实全程无高速。</p>
  </section>;
}
