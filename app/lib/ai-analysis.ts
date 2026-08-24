export type RegionalAnalysisInput = {
  datasetName: string;
  regionLabel: string;
  selectionSource: "rectangle" | "filter" | "anomaly" | "unknown";
  pointCount: number;
  timeRange: { startDate: string; endDate: string };
  filterDescription: string;
  meanVelocity: number;
  averageDisplacement: number | null;
  maximumDisplacement: number;
  averageCoherence: number | null;
  qualityCount: number;
  patternDistribution: Record<string, number>;
  modeSource: string | null;
};

export type RegionalInterpretation = {
  engine: "structured-local-demo";
  engineLabel: string;
  overview: string;
  findings: string[];
  attention: string;
  nextStep: string;
  createdAt: string;
};

const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;

export async function interpretRegionalAnalysis(input: RegionalAnalysisInput): Promise<RegionalInterpretation> {
  if (!input.pointCount) throw new Error("当前没有可用于区域解读的有效监测点，请先框选区域或执行异常发现。");
  if (!Number.isFinite(input.meanVelocity) || !Number.isFinite(input.maximumDisplacement)) throw new Error("区域统计结果不完整，暂时无法生成可靠解读。");

  await new Promise(resolve => globalThis.setTimeout(resolve, 650));

  const modes = Object.entries(input.patternDistribution).sort((a, b) => b[1] - a[1]);
  const dominant = modes[0];
  const trend = input.meanVelocity < -1 ? "整体平均表现为沉降方向" : input.meanVelocity > 1 ? "整体平均表现为抬升方向" : "整体平均变化幅度较缓";
  const overview = `${input.regionLabel}包含 ${input.pointCount.toLocaleString()} 个有效监测点，分析时段为 ${input.timeRange.startDate}—${input.timeRange.endDate}。区域平均速率为 ${signed(input.meanVelocity)} mm/yr，${trend}。`;
  const findings = [
    `当前区域绝对累计形变量最大值为 ${input.maximumDisplacement.toFixed(2)} mm${input.averageDisplacement == null ? "" : `，当前期平均形变量为 ${signed(input.averageDisplacement)} mm`}。`,
    dominant ? `占比最高的已有形变模式为“${dominant[0]}”，占当前分析点的 ${dominant[1].toFixed(1)}%。` : "当前数据没有提供可汇总的形变模式结果。",
  ];
  const qualityRate = input.qualityCount / input.pointCount * 100;
  const attention = input.qualityCount ? `当前结果中有 ${input.qualityCount.toLocaleString()} 个质量关注点（${qualityRate.toFixed(1)}%），解释区域趋势时应结合相干性和缺测情况。` : input.averageCoherence == null ? "当前数据未提供相干性，无法从该指标判断观测质量。" : "当前选区未发现达到既定阈值的质量关注点。";
  const nextStep = input.selectionSource === "anomaly" ? "建议查看主要形变模式，并选取代表性点位核对完整时间序列。" : "建议运行异常发现，随后查看重点点位是否具有一致的时间变化特征。";

  return { engine: "structured-local-demo", engineLabel: "本地结构化解释 · 演示模式", overview, findings, attention, nextStep, createdAt: new Date().toISOString() };
}
