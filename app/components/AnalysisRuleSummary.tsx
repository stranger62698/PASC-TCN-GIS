"use client";

import type { AnalysisRuleSummary as RuleSummary } from "../lib/analysis-exports";

export function AnalysisRuleSummary({ summary, onClose, onExport }: { summary: RuleSummary; onClose: () => void; onExport: () => void }) {
  return <div className="config-backdrop rule-summary-backdrop">
    <section className="config-dialog rule-summary-dialog" role="dialog" aria-modal="true" aria-labelledby="rule-summary-title">
      <button className="dialog-close" aria-label="关闭规则摘要" onClick={onClose}>×</button>
      <span className="eyebrow">REPRODUCIBLE ANALYSIS</span><h2 id="rule-summary-title">{summary.title}</h2>
      <p>记录当前地图真正使用的数据范围、筛选阈值与空间规则，便于复核和交接。</p>
      <div className="rule-summary-grid">{summary.items.map(item => <article key={item.label}><span>{item.label}</span><b>{item.value}</b><small>{item.detail}</small></article>)}</div>
      <p className="rule-summary-boundary"><b>边界说明</b>{summary.boundary}</p>
      <div className="dialog-actions"><button className="button ghost" onClick={onClose}>返回分析</button><button className="button primary" onClick={onExport}>导出规则摘要 TXT ↓</button></div>
    </section>
  </div>;
}
