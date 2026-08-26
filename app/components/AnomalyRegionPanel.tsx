"use client";

import { useMemo, useState } from "react";
import { colorForMode } from "../lib/analysis-context";
import type { AnomalyRegion, AnomalyRegionResult } from "../lib/anomaly-regions";

type SortKey = "pointCount" | "meanVelocity" | "areaKm2";

export function AnomalyRegionPanel({
  result,
  activeRegionId,
  onSelect,
  onShowAll,
  onParametersChange,
}: {
  result: AnomalyRegionResult;
  activeRegionId: string | null;
  onSelect: (region: AnomalyRegion) => void;
  onShowAll: () => void;
  onParametersChange: (radiusMeters: number, minimumPoints: number) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("pointCount");
  const sortedRegions = useMemo(() => [...result.regions].sort((a, b) => {
    if (sortKey === "meanVelocity") return a.meanVelocity - b.meanVelocity || b.pointCount - a.pointCount;
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
      <p>先按既有规则筛出异常点，再用明确的距离和点数条件寻找密度连通区域。区域边界是监测点分析包络，不是危险区或工程边界。</p>
      <div className="anomaly-region-controls">
        <label>邻域半径<input type="number" min="25" max="5000" step="25" value={result.parameters.radiusMeters} onChange={event => onParametersChange(+event.target.value, result.parameters.minimumPoints)} /><small>m</small></label>
        <label>最少点数<input type="number" min="2" max="50" step="1" value={result.parameters.minimumPoints} onChange={event => onParametersChange(result.parameters.radiusMeters, +event.target.value)} /><small>点</small></label>
        <label>列表排序<select value={sortKey} onChange={event => setSortKey(event.target.value as SortKey)}><option value="pointCount">点数从多到少</option><option value="meanVelocity">平均速率从低到高</option><option value="areaKm2">包络面积从大到小</option></select></label>
      </div>
      <div className="anomaly-region-evidence">
        <span>候选点<b>{result.candidateCount.toLocaleString()}</b></span>
        <span>进入区域<b>{result.assignedPointCount.toLocaleString()}</b></span>
        <span>离散点<b>{result.noisePointCount.toLocaleString()}</b></span>
        <button onClick={onShowAll}>显示全部候选点</button>
      </div>
      <small className="anomaly-region-method">{result.method}</small>

      {result.status === "too_large" ? (
        <div className="anomaly-region-empty"><b>候选点超过本地聚类上限</b><span>当前保留异常点筛选，不在浏览器中运行大规模聚类。请缩小数据范围或使用后端任务。</span></div>
      ) : sortedRegions.length ? (
        <div className="anomaly-region-list">
          {sortedRegions.slice(0, 80).map(region => <article className={region.id === activeRegionId ? "active" : ""} key={region.id}>
            <button onClick={() => onSelect(region)} aria-pressed={region.id === activeRegionId}>
              <span><i style={{ background: colorForMode(region.dominantMode) }} />{region.id}<small>{region.dominantMode}</small></span>
              <strong>{region.pointCount.toLocaleString()} 点</strong>
              <em>{region.meanVelocity.toFixed(2)} mm/yr</em>
              <small>{region.areaKm2 < .01 ? region.areaKm2.toFixed(4) : region.areaKm2.toFixed(3)} km²</small>
            </button>
          </article>)}
          {sortedRegions.length > 80 && <small className="anomaly-region-limit">列表仅显示排序后的前 80 个区域；地图最多绘制点数较多的 500 个区域，并始终保留当前选择。</small>}
        </div>
      ) : (
        <div className="anomaly-region-empty"><b>当前参数下没有空间支持区域</b><span>候选点仍保留。可适当增大邻域半径、降低最少点数，或检查当前质量阈值。</span></div>
      )}

      {activeRegion && <div className="anomaly-region-detail">
        <header><span>REGION DETAIL</span><b>{activeRegion.id}</b></header>
        <div>
          <article><span>监测点</span><b>{activeRegion.pointCount}</b><small>区域内候选点</small></article>
          <article><span>平均 / 中位速率</span><b>{activeRegion.meanVelocity.toFixed(2)} / {activeRegion.medianVelocity.toFixed(2)}</b><small>mm/yr</small></article>
          <article><span>主要模式</span><b>{activeRegion.dominantMode}</b><small>按点数最多</small></article>
          <article><span>规则证据</span><b>{activeRegion.clearSubsidenceCount} / {activeRegion.acceleratingCount} / {activeRegion.piecewiseCount}</b><small>明显沉降 / 加速 / 分段</small></article>
          <article><span>最大累计量</span><b>{activeRegion.maximumAbsoluteDisplacement.toFixed(2)}</b><small>mm · 绝对值</small></article>
          <article><span>分析包络</span><b>{activeRegion.areaKm2 < .01 ? activeRegion.areaKm2.toFixed(4) : activeRegion.areaKm2.toFixed(3)}</b><small>km² · 凸包/退化矩形</small></article>
        </div>
        <p>点击区域会定位地图，并把该区域的真实监测点交给现有 AOI 统计与聚合时序。所有结果只描述数据与空间邻近关系。</p>
      </div>}
    </section>
  );
}
