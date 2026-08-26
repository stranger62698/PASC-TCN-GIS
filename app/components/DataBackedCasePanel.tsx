"use client";

import type { DataBackedQuickCase } from "../lib/point-comparison";

export function DataBackedCasePanel({ cases, activeId, onActivate }: { cases: DataBackedQuickCase[]; activeId: string | null; onActivate: (item: DataBackedQuickCase) => void }) {
  return (
    <section className="data-case-panel" aria-label="当前数据快捷案例">
      <header><div><small>DATA-BACKED CASES</small><h3>当前数据快捷案例</h3></div><span>{cases.length} 组</span></header>
      <p>案例由当前已加载监测点即时生成，不新增坐标、不代表区域风险或类别比例。</p>
      {cases.length ? <div className="data-case-list">{cases.map(item => (
        <article className={activeId === item.id ? "active" : ""} key={item.id}>
          <div><small>{item.kicker}</small><h4>{item.title}</h4><b>{item.metric}</b><p>{item.description}</p><span title={item.criterion}>依据：{item.criterion}</span></div>
          <button onClick={() => onActivate(item)}>定位并查看 {item.pointIds.length > 1 ? `${item.pointIds.length} 点对比` : "点位详情"} ↗</button>
        </article>
      ))}</div> : <div className="data-case-empty">当前数据没有可生成快捷案例的有效点。</div>}
    </section>
  );
}
