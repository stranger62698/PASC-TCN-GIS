"use client";

import Link from "next/link";
import { useState } from "react";
import type { CaseStudy } from "../data/site";
import { cases } from "../data/site";
import { PageHero, PageShell } from "./SiteShell";

function CaseVisual({ item, full = false }: { item: CaseStudy; full?: boolean }) {
  return (
    <div className={`case-visual${full ? " full" : ""}`} style={{ "--case-accent": item.accent } as React.CSSProperties}>
      <div className="case-map" style={{ backgroundImage: `linear-gradient(rgba(7,26,56,.08),rgba(7,26,56,.14)),url(${item.image})` }}>
        <span className="point p1" /><span className="point p2" /><span className="point p3" />
        <span className="point p4" /><span className="point p5" /><span className="point p6" />
      </div>
      <div className="case-scale"><span>沉降</span><i /><span>稳定</span><i /><span>抬升</span></div>
      <div className="case-metrics">{item.metrics.map(([label, value]) => <span key={label}><small>{label}</small><b>{value}</b></span>)}</div>
    </div>
  );
}

function ScenarioFlow({ item }: { item: CaseStudy }) {
  return (
    <section className="scenario-flow">
      <header><span className="eyebrow">SCENARIO WORKFLOW</span><h2>从业务问题到可核查结果</h2><p>案例按实际使用流程组织，不重复罗列产品功能。</p></header>
      <div className="scenario-flow-grid">
        {item.workflow.map(([title, description], index) => <article key={title}><b>{String(index + 1).padStart(2, "0")}</b><h3>{title}</h3><p>{description}</p></article>)}
      </div>
      <p className="scenario-boundary"><b>案例边界</b>{item.demoNote}</p>
    </section>
  );
}

export function ShowcasePage() {
  const [activeKey, setActiveKey] = useState(cases[0].key);
  const active = cases.find((item) => item.key === activeKey) ?? cases[0];
  return (
    <PageShell>
      <PageHero eyebrow="CASE DECK" title="InSAR 在真实场景中怎么用" description="围绕城市、滑坡与公路三个场景，展示数据如何进入产品、如何完成分析，以及结果能支持什么判断。" />
      <section className="section showcase-section phase-eight-showcase">
        <div className="case-tabs" role="tablist" aria-label="应用场景">
          {cases.map((item) => <button key={item.key} role="tab" aria-selected={item.key === active.key} className={item.key === active.key ? "active" : ""} onClick={() => setActiveKey(item.key)}>{item.label}</button>)}
        </div>
        <article className="case-feature" style={{ "--case-accent": active.accent } as React.CSSProperties}>
          <div><span className="eyebrow">{active.kicker}</span><h2>{active.title}</h2><p>{active.description}</p><div className="tag-list">{active.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><Link className="button primary" href={`/showcase/${active.key}`}>查看完整案例流程 ↗</Link></div>
          <CaseVisual item={active} />
        </article>
        <ScenarioFlow item={active} />
      </section>
    </PageShell>
  );
}

export function CaseDetailPage({ item }: { item: CaseStudy }) {
  return (
    <PageShell>
      <PageHero eyebrow={item.kicker} title={item.title} description={item.description} />
      <section className="section phase-eight-showcase">
        <div className="story-intro"><div><span className="eyebrow">APPLICATION CONTEXT</span><h2>以场景问题组织分析</h2></div><p>这里呈现的重点不是算法名词，而是监测数据如何经过质量筛选、时空分析和证据整理，形成可以继续核查的业务线索。</p></div>
        <CaseVisual item={item} full />
        <ScenarioFlow item={item} />
        <div className="story-action"><div><span className="eyebrow">TRY THE PRODUCT</span><h2>{item.key === "city" ? "在公开数据中复现这条流程" : "继续查看可交互的产品能力"}</h2></div><Link className="button primary" href={item.key === "city" ? "/map?demo=haikou" : "/map"}>{item.key === "city" ? "体验公开示例" : "进入形变地图"} ↗</Link></div>
      </section>
    </PageShell>
  );
}
