"use client";

import { useState } from "react";
import type { DataBackedQuickCase } from "../lib/point-comparison";

export function DataBackedCasePanel({ cases, activeId, onActivate }: { cases: DataBackedQuickCase[]; activeId: string | null; onActivate: (item: DataBackedQuickCase) => void }) {
  const [slideId, setSlideId] = useState<string | null>(null);
  const requestedSlide = cases.findIndex(item => item.id === slideId);
  const safeSlide = requestedSlide >= 0 ? requestedSlide : 0;
  const activeCase = cases[safeSlide];
  const move = (offset: number) => {
    if (!cases.length) return;
    const next = (safeSlide + offset + cases.length) % cases.length;
    setSlideId(cases[next].id);
  };

  return (
    <section className="data-case-panel" aria-label="当前数据快捷案例">
      <header><div><small>数据证据 · 自动生成</small><h3>当前数据快捷案例</h3></div><span>{cases.length ? `${safeSlide + 1} / ${cases.length}` : "暂无"}</span></header>
      <p>案例由当前已加载监测点即时生成，不新增坐标、不代表区域风险或类别比例。</p>
      {activeCase ? <>
        <div className="data-case-carousel">
          <button className="carousel-arrow previous" aria-label="上一个快捷案例" onClick={() => move(-1)}>‹</button>
          <article className={activeId === activeCase.id ? "active" : ""}>
            <div><small>{activeCase.kicker}</small><h4>{activeCase.title}</h4><b>{activeCase.metric}</b><p>{activeCase.description}</p><span title={activeCase.criterion}>依据：{activeCase.criterion}</span></div>
            <button onClick={() => onActivate(activeCase)}>定位并查看 {activeCase.pointIds.length > 1 ? `${activeCase.pointIds.length} 点对比` : "点位详情"} ↗</button>
          </article>
          <button className="carousel-arrow next" aria-label="下一个快捷案例" onClick={() => move(1)}>›</button>
        </div>
        <div className="data-case-dots" role="tablist" aria-label="快捷案例分页">
          {cases.map((item, index) => <button key={item.id} className={index === safeSlide ? "active" : ""} role="tab" aria-selected={index === safeSlide} aria-label={`查看案例：${item.title}`} onClick={() => setSlideId(item.id)} />)}
        </div>
      </> : <div className="data-case-empty">当前数据没有可生成快捷案例的有效点。</div>}
    </section>
  );
}
