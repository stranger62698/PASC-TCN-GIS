import type { AnomalyRegion } from "./anomaly-regions.js";

export type InspectionPriority = "priority" | "planned" | "observe";

export type InspectionCandidate = {
  region: AnomalyRegion;
  rank: number;
  score: number;
  priority: InspectionPriority;
  priorityLabel: string;
  evidence: string[];
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function inspectionPriorityLabel(score: number): Pick<InspectionCandidate, "priority" | "priorityLabel"> {
  if (score >= 60) return { priority: "priority", priorityLabel: "优先核查" };
  if (score >= 35) return { priority: "planned", priorityLabel: "计划核查" };
  return { priority: "observe", priorityLabel: "持续跟踪" };
}

export function inspectionScore(region: AnomalyRegion) {
  const velocityEvidence = clamp01(Math.abs(region.medianVelocity) / 10);
  const displacementEvidence = clamp01(region.maximumAbsoluteDisplacement / 50);
  const patternEvidence = clamp01((region.acceleratingCount + region.piecewiseCount) / Math.max(1, region.pointCount));
  const minimumSpatialSupport = clamp01(region.pointCount / 20);
  return Math.round(velocityEvidence * 40 + displacementEvidence * 35 + patternEvidence * 15 + minimumSpatialSupport * 10);
}

export function buildInspectionCandidates(regions: AnomalyRegion[], limit = 3): InspectionCandidate[] {
  return regions
    .map(region => {
      const score = inspectionScore(region);
      return {
        region,
        score,
        ...inspectionPriorityLabel(score),
        evidence: [
          `中位速率 ${region.medianVelocity.toFixed(1)} mm/yr`,
          `最大累计量 ${region.maximumAbsoluteDisplacement.toFixed(1)} mm`,
          `${region.pointCount.toLocaleString("zh-CN")} 个空间支持点`,
          `主导模式 ${region.dominantMode}`,
        ],
      };
    })
    .sort((first, second) => second.score - first.score || second.region.pointCount - first.region.pointCount || first.region.id.localeCompare(second.region.id))
    .slice(0, Math.max(0, limit))
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

export function buildInspectionBrief(datasetTitle: string, observationDate: string, candidates: InspectionCandidate[]) {
  const buildingCase = /新埠岛|建筑|城市/.test(datasetTitle);
  const lines = [
    "澜迹 InSAR · 空间研判复核简报",
    "",
    `数据集：${datasetTitle}`,
    `最近观测：${observationDate}`,
    `候选区域：${candidates.length} 个`,
    "",
    "当前结论边界：候选次序仅依据 InSAR 形变幅度、时序模式与空间支持度，不等同于风险等级或工程安全结论。",
    buildingCase ? "形成单栋建筑结论前需补充：建筑轮廓与编号、结构类型、层数与建成年代、现场巡检或水准资料。" : "形成对象级结论前需补充：业务对象边界、基础属性、现场监测与人工复核记录。",
    "",
  ];
  candidates.forEach(candidate => {
    lines.push(
      `${candidate.rank}. ${candidate.region.id} · ${candidate.priorityLabel} · 证据分 ${candidate.score}/100`,
      `   中心：${candidate.region.centroid[0].toFixed(6)}° E, ${candidate.region.centroid[1].toFixed(6)}° N`,
      `   依据：${candidate.evidence.join("；")}`,
      buildingCase ? "   建议：关联建筑轮廓后，比较建筑内部、边界与周边点位的时序一致性。" : "   建议：核对候选边界和业务对象属性，再完成对象级解释。",
      "",
    );
  });
  lines.push(buildingCase ? "人工确认项：建筑编号、结构与基础信息、可见裂缝或不均匀沉降迹象、既有核查记录。" : "人工确认项：对象编号、现场状态、变化迹象、既有监测与处置记录。", "", "本简报用于空间研判与证据交接，不替代现场调查、工程检测或安全决策。");
  return lines.join("\r\n");
}
