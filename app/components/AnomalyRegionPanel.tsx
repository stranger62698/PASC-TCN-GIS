"use client";

import { useMemo, useState } from "react";
import { colorForMode } from "../lib/analysis-context";
import type { PriorityDeformationSelection } from "../lib/priority-deformation";
import type { AnomalyRegion, AnomalyRegionResult } from "../lib/anomaly-regions";

type SortKey = "pointCount" | "meanVelocity" | "areaKm2";

export function AnomalyRegionPanel({
  result,
  activeRegionId,
  onSelect,
  onShowAll, onShowIsolated, onShowExcluded, selection, view, evaluationDate, dataNote,
  onParametersChange,
}: {
  result: AnomalyRegionResult;
  activeRegionId: string | null;
  onSelect: (region: AnomalyRegion) => void;
  onShowAll: () => void;
  onShowIsolated: () => void;
  onShowExcluded: () => void;
  selection: PriorityDeformationSelection;
  view: "clustered" | "isolated" | "excluded";
  evaluationDate: string;
  dataNote?: string;
  onParametersChange: (radiusMeters: number, minimumPoints: number) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("pointCount");
  const sortedRegions = useMemo(() => [...result.regions].sort((a, b) => {
    if (sortKey === "meanVelocity") return Math.abs(b.meanVelocity) - Math.abs(a.meanVelocity) || b.pointCount - a.pointCount;
    if (sortKey === "areaKm2") return b.areaKm2 - a.areaKm2 || b.pointCount - a.pointCount;
    return b.pointCount - a.pointCount || a.id.localeCompare(b.id);
  }), [result.regions, sortKey]);
  const activeRegion = result.regions.find(region => region.id === activeRegionId) ?? null;

  return (
    <section className="anomaly-region-panel">
      <header>
        <div><small>EXPLAINABLE SPATIAL GROUPING</small><h3>异常区域</h3></div>
        <span>{result.regions.length.toLocaleString()} 个空间支持区域</span>
      </header>
      <p>仅把速率与累计量同时达标、同向且集中分布的点列入异常。模式用于解释；未提供相干性的点用琥珀色虚线标记，仍需核实质量。点内颜色保持速率色带。</p>
      {dataNote && <p className="pasc-local-webgis-warning">{dataNote}</p>}
      <div className="anomaly-region-controls">
        <label>邻域半径<input type="number" min="25" max="5000" step="25" value={result.parameters.radiusMeters} onChange={event => onParametersChange(+event.target.value, result.parameters.minimumPoints)} /><small>m</small></label>
        <label>最少点数<input type="number" min="3" max="50" step="1" value={result.parameters.minimumPoints} onChange={event => onParametersChange(result.parameters.radiusMeters, +event.target.value)} /><small>点</small></label>
        <label>列表排序<select value={sortKey} onChange={event => setSortKey(event.target.value as SortKey)}><option value="pointCount">点数从多到少</option><option value="meanVelocity">平均速率幅值从大到小</option><option value="areaKm2">包络面积从大到小</option></select></label>
      </div>
      <div className="anomaly-region-evidence" aria-label="异常结果分层">
        <span>双指标达标<b>{selection.amplitudeCandidates.length.toLocaleString()}</b></span>
        <span>聚集异常<b>{result.assignedPointCount.toLocaleString()}</b></span>
        <span>其中质量待核实<b>{selection.limited.length.toLocaleString()}</b></span>
        <span>离散待查<b>{selection.isolated.length.toLocaleString()}</b></span>
        <span>质量排除<b>{selection.excludedLowQuality.length.toLocaleString()}</b></span>
        <span>观测不足 / 无效<b>{selection.invalid.length.toLocaleString()}</b></span>
      </div>
      <div className="anomaly-view-switch" role="group" aria-label="异常结果视图">
        <button aria-pressed={view === "clustered" && !activeRegionId} onClick={onShowAll}>聚集异常</button>
        <button aria-pressed={view === "isolated"} onClick={onShowIsolated} disabled={!selection.isolated.length}>离散待查</button>
        <button aria-pressed={view === "excluded"} onClick={onShowExcluded} disabled={!selection.excludedLowQuality.length}>质量排除</button>
      </div>
      <p>发现时点：{evaluationDate || "数据末期"}；初始阈值可在“异常发现”中调整。区域包络不是危险区或工程边界。</p>
      <small className="anomaly-region-method">{result.method}</small>

      {result.status === "too_large" ? (
        <div className="anomaly-region-empty"><b>候选点超过本地聚类上限</b><span>当前仅完成幅值与质量筛选，候选点尚未获得空间判定，不计为异常或离散点。请缩小数据范围。</span></div>
      ) : sortedRegions.length ? (
        <div className="anomaly-region-list">
          {sortedRegions.slice(0, 80).map(region => <article className={region.id === activeRegionId ? "active" : ""} key={region.id}>
            <button onClick={() => onSelect(region)} aria-pressed={region.id === activeRegionId}>
              <span><i style={{ background: colorForMode(region.dominantMode) }} />{region.id}<small>{region.direction === "positive" ? "正向" : region.direction === "negative" ? "负向" : region.dominantMode}</small></span>
              <strong>{region.pointCount.toLocaleString()} 点</strong>
              <em>{region.meanVelocity.toFixed(1)} mm/yr</em>
              <small>{region.areaKm2 < .01 ? region.areaKm2.toFixed(4) : region.areaKm2.toFixed(3)} km²</small>
            </button>
          </article>)}
          {sortedRegions.length > 80 && <small className="anomaly-region-limit">列表仅显示排序后的前 80 个区域；地图最多绘制点数较多的 500 个区域，并始终保留当前选择。</small>}
        </div>
      ) : (
        <div className="anomaly-region-empty"><b>当前参数下没有空间支持区域</b><span>请查看离散待查和质量排除点，结合点间距与观测精度复核参数。零个聚集区不代表没有形变。</span></div>
      )}

      {activeRegion && <div className="anomaly-region-detail">
        <header><span>REGION DETAIL</span><b>{activeRegion.id}</b></header>
        <div>
          <article><span>监测点</span><b>{activeRegion.pointCount}</b><small>区域内聚集异常点</small></article>
          <article><span>平均 / 中位速率</span><b>{activeRegion.meanVelocity.toFixed(1)} / {activeRegion.medianVelocity.toFixed(1)}</b><small>mm/yr</small></article>
          <article><span>主要模式</span><b>{activeRegion.dominantMode}</b><small>按点数最多</small></article>
          <article><span>准入证据</span><b>双指标 + 同向聚集</b><small>|v| ≥ {selection.thresholds.velocityMmPerYear} · |d| ≥ {selection.thresholds.displacementMm}</small></article>
          <article><span>最大累计量</span><b>{activeRegion.maximumAbsoluteDisplacement.toFixed(1)}</b><small>mm · 绝对值</small></article>
          <article><span>分析包络</span><b>{activeRegion.areaKm2 < .01 ? activeRegion.areaKm2.toFixed(4) : activeRegion.areaKm2.toFixed(3)}</b><small>km² · 凸包/退化矩形</small></article>
        </div>
        <p>点击区域会定位地图，并把该区域的真实监测点交给现有 AOI 统计与聚合时序。所有结果只描述数据与空间邻近关系。</p>
      </div>}
    </section>
  );
}
