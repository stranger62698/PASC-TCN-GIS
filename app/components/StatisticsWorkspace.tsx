"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AnalysisProvider, colorForMode, deformationModeOrder, useAnalysisContext, type SelectedRegionStats } from "../lib/analysis-context";
import { trackEvent } from "../lib/analytics";
import { PageHero, PageShell } from "./SiteShell";

const sourceLabel = (source?: "rectangle" | "filter" | "anomaly") => source === "anomaly" ? "异常点筛选" : source === "filter" ? "属性阈值筛选" : "地图矩形框选";
const velocityColor = (minimum: number, maximum: number) => {
  const midpoint = (minimum + maximum) / 2;
  return midpoint <= -3 ? "#e94b4b" : midpoint >= 3 ? "#1677ff" : "#24a685";
};

function VelocityHistogram({ stats }: { stats: SelectedRegionStats }) {
  const bins = stats.velocityHistogram || [];
  const maximumCount = Math.max(1, ...bins.map(bin => bin.count));
  if (!bins.length) return <div className="statistics-chart-empty">当前分析上下文没有速率分布摘要，请返回地图重新建立区域。</div>;
  return <div className="velocity-histogram" role="img" aria-label="当前区域监测点年均形变速率分布直方图">
    <div className="histogram-y-label">监测点数</div>
    <div className="histogram-plot">
      <i className="histogram-grid g1"/><i className="histogram-grid g2"/><i className="histogram-grid g3"/>
      {bins.map((bin, index) => <div className="histogram-bin" key={`${bin.min}-${bin.max}`} title={`${bin.min.toFixed(2)}—${bin.max.toFixed(2)} mm/yr：${bin.count} 点`}>
        <span>{bin.count.toLocaleString()}</span>
        <i style={{ height: `${Math.max(4, bin.count / maximumCount * 100)}%`, background: velocityColor(bin.min, bin.max) }}/>
        {(index === 0 || index === Math.floor(bins.length / 2) || index === bins.length - 1) && <small>{bin.min.toFixed(1)}</small>}
      </div>)}
    </div>
    <div className="histogram-x-label">年均形变速率（mm/yr）</div>
    <div className="histogram-legend"><span><i className="subsidence"/>沉降方向</span><span><i className="stable"/>缓慢变化</span><span><i className="uplift"/>抬升方向</span></div>
  </div>;
}

function StatisticsView() {
  const { analysis, isReady } = useAnalysisContext();
  const stats = analysis.selectedRegionStats;
  const region = analysis.selectedRegion;
  const modeTotal = stats ? Object.values(stats.modeCounts).reduce((sum, value) => sum + value, 0) : 0;
  const query = new URLSearchParams({ restore: "analysis" });
  if (analysis.datasetId && analysis.datasetId !== "demo-haikou") query.set("dataset", analysis.datasetId);
  const mapHref = `/map?${query.toString()}`;
  const primaryModes = stats ? deformationModeOrder.filter(mode => stats.modeCounts[mode]).sort((a, b) => stats.modeCounts[b] - stats.modeCounts[a]) : [];
  useEffect(() => { if (isReady) trackEvent("statistics_open", { has_region_context: Boolean(stats), point_count: stats?.pointCount ?? 0 }); }, [isReady, stats]);

  return <PageShell>
    <PageHero eyebrow="PHASE 7 · ANALYSIS CONTINUITY" title="区域形变统计" description="统计页沿用地图中的数据集、区域、时间范围与筛选条件，只保留能支持判断的核心图表。"/>
    <section className="section phase-seven-statistics">
      {!isReady ? <div className="analysis-context-empty"><b>正在恢复当前分析对象…</b></div> : <>
        <div className="analysis-object-header phase-seven-object-header">
          <div><span>当前分析对象</span><h2>{analysis.datasetName} · {region?.label || "尚未选择区域"}</h2><p>统计结果来自当前 Map 分析上下文，不建立第二套数据状态。</p></div>
          <Link className="button primary" href={mapHref}>返回地图并恢复状态 ↗</Link>
        </div>
        <div className="analysis-context-strip phase-seven-context-strip">
          <article><span>时间范围</span><b>{analysis.timeRange.startDate}—{analysis.timeRange.endDate}</b></article>
          <article><span>有效监测点</span><b>{stats?.pointCount.toLocaleString() || "—"}</b></article>
          <article><span>当前筛选</span><b>{analysis.filters.active === "none" ? "区域内全部点" : analysis.filters.description || "已启用"}</b></article>
          <article><span>区域来源</span><b>{region ? sourceLabel(region.source) : "尚未建立"}</b></article>
        </div>

        {!stats ? <div className="analysis-context-empty phase-seven-empty"><span>NO REGION CONTEXT</span><h2>尚未从地图建立区域分析</h2><p>返回地图使用矩形框选、属性筛选或“发现异常”，统计页会自动继承当前分析对象。</p><Link className="button primary" href="/map">前往地图建立分析对象</Link></div> : <>
          <div className="phase-seven-chart-grid">
            <article className="statistics-high-value-card velocity-card">
              <header><div><span className="eyebrow">VELOCITY DISTRIBUTION</span><h2>区域速率分布</h2><p>观察区域内形变速率的集中区间与两端分布，避免只依赖平均值。</p></div><div className="chart-key-metrics"><span>平均速率<b>{stats.averageVelocity.toFixed(2)} mm/yr</b></span><span>速率范围<b>{stats.minimumVelocity?.toFixed(2) ?? "—"}—{stats.maximumVelocity?.toFixed(2) ?? "—"}</b></span></div></header>
              <VelocityHistogram stats={stats}/>
            </article>
            <article className="statistics-high-value-card mode-card">
              <header><div><span className="eyebrow">MODE DISTRIBUTION</span><h2>形变模式构成</h2><p>模式来自已有 CSV 字段或既有分类结果，统计页不重新生成类别。</p></div></header>
              <div className="mode-stat-list phase-seven-mode-list">{primaryModes.map(mode => { const count = stats.modeCounts[mode], percent = modeTotal ? count / modeTotal * 100 : 0; return <div key={mode}><header><span><i style={{ background: colorForMode(mode) }}/>{mode}</span><b>{count.toLocaleString()} · {percent.toFixed(1)}%</b></header><em><i style={{ width: `${percent}%`, background: colorForMode(mode) }}/></em></div>; })}</div>
              {!primaryModes.length && <div className="statistics-chart-empty">当前数据没有可用的形变模式字段。</div>}
            </article>
          </div>
          <div className="statistics-evidence-strip">
            <article><span>最大累计形变量</span><b>{stats.maximumDisplacement.toFixed(2)} mm</b><small>当前时间范围内绝对值</small></article>
            <article><span>平均当前形变</span><b>{stats.averageDisplacement?.toFixed(2) ?? "—"} mm</b><small>{analysis.timeRange.endDate}</small></article>
            <article><span>平均相干性</span><b>{stats.averageCoherence == null ? "未提供" : stats.averageCoherence.toFixed(2)}</b><small>质量关注点 {stats.qualityCount.toLocaleString()}</small></article>
            <article><span>空间范围</span><b>{region ? `${region.bounds[0].toFixed(3)}, ${region.bounds[1].toFixed(3)}` : "—"}</b><small>{region ? `至 ${region.bounds[2].toFixed(3)}, ${region.bounds[3].toFixed(3)}` : "未提供"}</small></article>
          </div>
          <p className="analysis-boundary-note phase-seven-boundary">这里的数值由程序根据当前区域和筛选条件计算，仅描述数据分布，不代表工程安全结论、灾害预测或空间聚集区识别结果。</p>
        </>}
      </>}
    </section>
  </PageShell>;
}

export function StatisticsWorkspace() {
  return <AnalysisProvider><StatisticsView/></AnalysisProvider>;
}
