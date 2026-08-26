"use client";

import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { InsarPoint } from "../data/site";
import { colorForMode, deformationModeOrder, normalizedMode } from "../lib/analysis-context";
import { aggregateAoiSeries, type AoiAggregateMethod } from "../lib/aoi-analysis";

const axisDate = (value: string) => {
  const digits = (value || "").replace(/\D/g, "");
  return digits.length >= 6 ? `${digits.slice(0, 4)}.${digits.slice(4, 6)}` : value;
};

export function AoiTimeSeriesChart({ points, exportBusy = false, onExportData, onExportChart }: { points: InsarPoint[]; exportBusy?: boolean; onExportData?: (method: AoiAggregateMethod, enabledModes: string[]) => void; onExportChart?: (svg: SVGSVGElement) => void }) {
  const [method, setMethod] = useState<AoiAggregateMethod>("median");
  const [enabledModes, setEnabledModes] = useState<string[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const series = useMemo(() => aggregateAoiSeries(points, method, normalizedMode), [points, method]);
  const availableGroups = useMemo(
    () => [...series.groups].sort((a, b) => {
      const aIndex = deformationModeOrder.indexOf(a.mode);
      const bIndex = deformationModeOrder.indexOf(b.mode);
      return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex);
    }),
    [series.groups],
  );
  const visibleGroups = availableGroups.filter(group => enabledModes.includes(group.mode));
  const allValues = [...series.overall, ...visibleGroups.flatMap(group => group.values)]
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (!points.length || !series.dates.length || !allValues.length) return null;

  const width = 420, height = 238, left = 51, right = 18, top = 20, bottom = 42;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const minimum = Math.min(...allValues), maximum = Math.max(...allValues), range = maximum - minimum || 1;
  const x = (index: number) => left + index / Math.max(1, series.dates.length - 1) * plotWidth;
  const y = (value: number) => top + (maximum - value) / range * plotHeight;
  const linePoints = (values: Array<number | null>) => values
    .map((value, index) => value === null ? null : `${x(index)},${y(value)}`)
    .filter(Boolean)
    .join(" ");
  const yTicks = Array.from({ length: 5 }, (_, index) => maximum - range * index / 4);
  const xTicks = [...new Set(Array.from({ length: 5 }, (_, index) => Math.round((series.dates.length - 1) * index / 4)))];
  const handlePointer = (event: PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setHoverIndex(Math.round(ratio * (series.dates.length - 1)));
  };
  const toggleMode = (mode: string) => setEnabledModes(current => current.includes(mode) ? current.filter(item => item !== mode) : [...current, mode]);

  return (
    <section className="aoi-series-card">
      <header>
        <div><small>AOI AGGREGATE · {points.length.toLocaleString()} POINTS</small><h3>区域聚合形变时序</h3></div>
        <div className="aoi-aggregate-switch" role="group" aria-label="区域聚合方式">
          <button className={method === "median" ? "active" : ""} onClick={() => setMethod("median")}>中位数</button>
          <button className={method === "mean" ? "active" : ""} onClick={() => setMethod("mean")}>平均值</button>
        </div>
      </header>
      <p className="aoi-series-note">{method === "median" ? "默认使用中位数，降低离群形变点对区域趋势的影响。" : "平均值保留所有点的整体贡献，对离群点更敏感。"}</p>
      <div className="aoi-series-plot">
        <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`AOI ${method === "median" ? "中位数" : "平均值"}累计形变时序，单位毫米`} onPointerLeave={() => setHoverIndex(null)}>
          <g className="chart-grid">{yTicks.map((value, index) => <line key={index} x1={left} y1={y(value)} x2={width - right} y2={y(value)} />)}</g>
          <g className="chart-axes">
            <line x1={left} y1={top} x2={left} y2={height - bottom} />
            <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} />
            {yTicks.map((value, index) => <text key={index} x={left - 7} y={y(value) + 4} textAnchor="end">{value.toFixed(1)}</text>)}
            {xTicks.map(index => <text key={index} x={x(index)} y={height - bottom + 17} textAnchor="middle">{axisDate(series.dates[index])}</text>)}
            <text className="axis-title" transform={`translate(13 ${(top + height - bottom) / 2}) rotate(-90)`} textAnchor="middle">累计形变 (mm)</text>
          </g>
          {visibleGroups.map(group => <polyline key={group.mode} className="aoi-mode-line" style={{ stroke: colorForMode(group.mode) }} points={linePoints(group.values)} />)}
          <polyline className="aoi-overall-line" points={linePoints(series.overall)} />
          {hoverIndex !== null && <>
            <line className="aoi-hover-line" x1={x(hoverIndex)} y1={top} x2={x(hoverIndex)} y2={height - bottom} />
            {series.overall[hoverIndex] !== null && <circle className="aoi-hover-point" cx={x(hoverIndex)} cy={y(series.overall[hoverIndex] as number)} r="4" />}
          </>}
          <rect className="aoi-chart-hitbox" x={left} y={top} width={plotWidth} height={plotHeight} onPointerMove={handlePointer} />
        </svg>
        {hoverIndex !== null && <div className="aoi-chart-tooltip"><b>{series.dates[hoverIndex]}</b><span>区域{method === "median" ? "中位" : "平均"}：{series.overall[hoverIndex]?.toFixed(2) ?? "—"} mm</span>{visibleGroups.map(group => <span key={group.mode}><i style={{ background: colorForMode(group.mode) }} />{group.mode}：{group.values[hoverIndex]?.toFixed(2) ?? "—"} mm</span>)}</div>}
      </div>
      <div className="aoi-mode-curves">
        <span>按模式叠加曲线（可选）</span>
        <div>{availableGroups.map(group => <label key={group.mode}><input type="checkbox" checked={enabledModes.includes(group.mode)} onChange={() => toggleMode(group.mode)} /><i style={{ background: colorForMode(group.mode) }} /><b>{group.mode}</b><small>{group.pointCount} 点</small></label>)}</div>
      </div>
      <div className="chart-export-actions"><button disabled={exportBusy} onClick={() => onExportData?.(method, visibleGroups.map(group => group.mode))}>导出图表数据 CSV</button><button disabled={exportBusy} onClick={() => svgRef.current && onExportChart?.(svgRef.current)}>导出图表 PNG</button></div>
    </section>
  );
}
