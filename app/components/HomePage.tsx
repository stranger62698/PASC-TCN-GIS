"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLanguage } from "../lib/language-context";
import { PageShell } from "./SiteShell";
import { InfoHint } from "./InfoHint";

export function HomePage() {
  const { locale, text } = useLanguage();
  const homeCases = locale === "zh" ? [
    {
      key: "city", label: "城市建筑",
      title: "新埠岛建筑密集区时序形变", summary: "结合密集监测点的空间分布、累计形变与模式差异开展区域研判。点位结果不直接构成单栋建筑的安全结论。",
      image: "/home-case-city-displacement.webp", imageAlt: "新埠岛建筑密集区累计形变量监测点空间分布",
      href: "/map?demo=haikou&tour=portfolio", action: "打开建筑案例",
      metrics: [["9,069", "监测点"], ["210 期", "观测期数"], ["2017—2025", "观测时间"], ["6 类", "PASC 模式"]],
    },
    {
      key: "road", label: "道路网络",
      title: "江东新区主要道路时序形变", summary: "比较道路沿线的持续变化与局部差异。展示数据采用 25 m 网格保留确定性空间样本，与驾车规划所用路网相互独立。",
      image: "/home-case-road.png", imageAlt: "江东新区主要道路上的彩色 InSAR 形变点",
      href: "/map?demo=road", action: "打开道路案例",
      metrics: [["11,383", "网页监测点"], ["175 期", "观测期数"], ["2018—2024", "观测时间"], ["25 m", "空间保留网格"]],
    },
    {
      key: "landslide", label: "山地滑坡",
      title: "拉加镇滑坡时序形变", summary: "分析坡体与河谷场景中的持续变化及阶段性变化，以坐标与真实观测时序支撑遥感研判。",
      image: "/home-case-landslide.png", imageAlt: "拉加镇滑坡区域的彩色 InSAR 形变点",
      href: "/map?demo=landslide", action: "打开滑坡案例",
      metrics: [["11,354", "监测点"], ["58 期", "观测期数"], ["2021—2022", "观测时间"], ["真实时序", "证据类型"]],
    },
  ] : [
    {
      key: "city", label: "Urban buildings",
      title: "Dense building deformation on Xinbu Island", summary: "Explore spatial distribution, cumulative displacement and pattern differences without treating monitoring points as per-building conclusions.",
      image: "/home-case-city-displacement.webp", imageAlt: "Cumulative InSAR displacement across the dense building area of Xinbu Island",
      href: "/map?demo=haikou&tour=portfolio", action: "Open building case",
      metrics: [["9,069", "Monitoring points"], ["210", "Epochs"], ["2017—2025", "Period"], ["6", "PASC patterns"]],
    },
    {
      key: "road", label: "Road network",
      title: "Time-series deformation along Jiangdong roads", summary: "Compare persistent and local change along roads. Displayed points are deterministically sampled on a 25 m grid, independently of the road network used for driving directions.",
      image: "/home-case-road.png", imageAlt: "Coloured InSAR deformation points along major roads in Jiangdong",
      href: "/map?demo=road", action: "Open road case",
      metrics: [["11,383", "Web points"], ["175", "Epochs"], ["2018—2024", "Period"], ["25 m", "Sampling grid"]],
    },
    {
      key: "landslide", label: "Landslide",
      title: "Time-series deformation of the Lajia landslide", summary: "Locate persistent and stage-wise change across a slope and river-valley setting using only evidence supported by coordinates and real time series.",
      image: "/home-case-landslide.png", imageAlt: "Coloured InSAR deformation points across the Lajia landslide area",
      href: "/map?demo=landslide", action: "Open landslide case",
      metrics: [["11,354", "Monitoring points"], ["58", "Epochs"], ["2021—2022", "Period"], ["Real series", "Evidence type"]],
    },
  ];
  const platformHighlights = locale === "zh" ? [
    { key: "time", image: "/platform-time-map.webp", imageAlt: "时空形变地图与时间序列演化示意", title: "时空观测与区域分析", description: "联动地理位置、观测日期、累计形变与区域选择，分析监测对象的空间分布及变化过程。", href: "/map?demo=haikou", action: "打开时空地图" },
    { key: "pattern", image: "/platform-pattern-analysis.webp", imageAlt: "从监测时序识别不同形变模式的分析示意", title: "形变模式与证据研判", description: "识别稳定、线性、分段、加速与减速等时序模式，并结合原始曲线、数据质量和空间证据复核结果。", href: "/map?demo=haikou&panel=filters", action: "分析形变模式" },
    { key: "driving", image: "/home-case-road.png", imageAlt: "道路沿线形变监测点，用于外业考察的区域参考，非驾车路线结果", title: "外业行程与驾车规划", description: "在地图中指定起终点与途经点，调用滴图驾车服务生成道路路线，结合停留时长与工作时段编排小客车核查行程。", href: "/map?demo=road", action: "规划外业行程" },
    { key: "field", image: "/platform-field-evidence.webp", imageAlt: "桥梁考察照片与遥感形变监测点联动示意", title: "现场记录与关联核查", description: "依据照片坐标组织考察记录、附近 InSAR 候选点与人工确认时序，为现场观察和遥感研判提供可追溯的关联依据。", href: "/map?demo=haikou&panel=field", action: "查看现场记录" },
  ] : [
    { key: "time", image: "/platform-time-map.webp", imageAlt: "Spatiotemporal deformation map and timeline evolution", title: "Spatiotemporal observation", description: "Review spatial distribution and change over time through linked locations, acquisition dates, cumulative displacement and regional selections.", href: "/map?demo=haikou", action: "Open spatiotemporal map" },
    { key: "pattern", image: "/platform-pattern-analysis.webp", imageAlt: "Analysis workflow that identifies deformation patterns from monitoring series", title: "Patterns and supporting evidence", description: "Identify stable, linear, piecewise, accelerating and decelerating patterns, then review results against source curves, data quality and spatial evidence.", href: "/map?demo=haikou&panel=filters", action: "Analyze patterns" },
    { key: "driving", image: "/home-case-road.png", imageAlt: "Roadside deformation monitoring points as regional context for fieldwork, not a generated driving route", title: "Fieldwork and driving itineraries", description: "Select an origin, destination and waypoints on the map. Didi driving services provide road routes; stop durations and working hours support passenger-car inspection itineraries.", href: "/map?demo=road", action: "Plan fieldwork" },
    { key: "field", image: "/platform-field-evidence.webp", imageAlt: "Bridge inspection photos linked with remote-sensing deformation points", title: "Field records and evidence review", description: "Use photo coordinates to organize field records, nearby InSAR candidates and manually confirmed series, preserving traceable links between observations and remote-sensing analysis.", href: "/map?demo=haikou&panel=field", action: "Review field records" },
  ];
  const [activeCaseIndex, setActiveCaseIndex] = useState(0);
  const [caseCarouselPaused, setCaseCarouselPaused] = useState(false);
  const [caseHintOpen, setCaseHintOpen] = useState(false);
  const activeCase = homeCases[activeCaseIndex] ?? homeCases[0];
  const moveCase = (direction: number) => setActiveCaseIndex((current) => (current + direction + homeCases.length) % homeCases.length);
  const moveCaseTab = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? homeCases.length - 1 : (index + direction + homeCases.length) % homeCases.length;
    setActiveCaseIndex(nextIndex);
    window.requestAnimationFrame(() => document.getElementById(`home-case-tab-${homeCases[nextIndex].key}`)?.focus());
  };
  useEffect(() => {
    if (caseCarouselPaused || caseHintOpen) return;
    const timer = window.setInterval(() => setActiveCaseIndex((current) => (current + 1) % homeCases.length), 6500);
    return () => window.clearInterval(timer);
  }, [caseCarouselPaused, caseHintOpen, homeCases.length]);

  return <PageShell>
    <section className="home-hero phase-one-hero grid-surface">
      <div className="hero-scene" aria-hidden="true" />
      <div className="hero-copy">
        <span className="eyebrow">{text("InSAR 分析与外业工作平台","INSAR ANALYSIS & FIELDWORK")}</span>
        <h1>{text("时序形变研判","Time-series deformation")}<br/><em>{text("与外业核查协同","and field verification")}</em></h1>
        <p>{text("面向 InSAR / GIS 科研与技术分析，整合数据质量检验、形变模式识别、驾车行程规划与现场记录，支持遥感证据研判及外业核查组织。","A workspace for InSAR / GIS research and technical analysis, bringing together data quality checks, pattern recognition, driving itineraries and field records to support evidence review and inspection planning.")}</p>
        <div className="hero-actions">
          <Link className="button primary" href="/map?demo=haikou&tour=portfolio">{text("进入分析工作台","Open analysis workspace")} <span aria-hidden="true">↗</span></Link>
          <Link className="button ghost" href="/map?demo=road">{text("规划外业行程","Plan fieldwork")}</Link>
        </div>
        <div className="hero-promise">
          <span><b>{text("研判","ANALYSIS")}</b>{text("时序与空间证据","Time series and spatial evidence")}</span><i aria-hidden="true">·</i>
          <span><b>{text("规划","PLANNING")}</b>{text("驾车路线与核查行程","Driving routes and itineraries")}</span><i aria-hidden="true">·</i>
          <span><b>{text("核查","REVIEW")}</b>{text("现场记录与人工复核","Field records and human review")}</span>
        </div>
      </div>
      <p className="hero-scene-note">{text("背景为 InSAR 观测场景示意，非实测结果。","Illustrative InSAR observation scene, not measured results.")}</p>
    </section>

    <section className="section demo-section" aria-labelledby="demo-title">
      <div className="case-gallery-heading">
        <div><span className="eyebrow">{text("监测案例","MONITORING CASES")}</span><h2 id="demo-title">{text("建筑、道路与山地场景","Urban, road and landslide analysis")}</h2></div>
        <div className="home-browse-hint">
          <span>{text("浏览提示","Browsing tips")}</span>
          <InfoHint label={text("查看案例浏览提示","How to browse cases")} title={text("预览与进入案例","Preview and open a case")}>
            {text("悬停或点击案例可切换预览，也可用方向键切换。点击“打开案例”按钮进入交互地图。","Hover or select a case to preview it. Arrow keys also switch cases. Use the Open case button to enter the interactive map.")}
          </InfoHint>
        </div>
      </div>
      <div
        className="home-case-gallery"
        onPointerEnter={() => setCaseCarouselPaused(true)}
        onPointerLeave={() => setCaseCarouselPaused(false)}
        onFocusCapture={() => setCaseCarouselPaused(true)}
        onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setCaseCarouselPaused(false); }}
      >
        <div className="case-gallery-selector" role="tablist" aria-label={text("首页案例切换","Homepage case selector")}>
          {homeCases.map((item, index) => (
            <button
              key={item.key}
              id={`home-case-tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={index === activeCaseIndex}
              aria-controls="home-case-preview"
              tabIndex={index === activeCaseIndex ? 0 : -1}
              className={index === activeCaseIndex ? "active" : ""}
              onKeyDown={event => moveCaseTab(event, index)}
              onPointerEnter={() => setActiveCaseIndex(index)}
              onFocus={() => setActiveCaseIndex(index)}
              onClick={() => setActiveCaseIndex(index)}
            >
              <span><i aria-hidden="true"/>{item.label}</span>
              <strong>{item.title}</strong>
            </button>
          ))}
          <div className="case-gallery-actions">
            <Link className="button primary" href={activeCase.href}>{activeCase.action} <span>↗</span></Link>
            <Link className="text-link" href="/showcase">{text("全部案例","All cases")}</Link>
          </div>
        </div>
        <div id="home-case-preview" className={`case-gallery-media case-${activeCase.key}`} role="tabpanel" aria-labelledby={`home-case-tab-${activeCase.key}`}>
          <Image key={activeCase.image} fill priority sizes="(max-width: 760px) 100vw, 62vw" src={activeCase.image} alt={activeCase.imageAlt} />
          <button className="case-gallery-arrow previous" type="button" onClick={() => moveCase(-1)} aria-label={text("上一个案例","Previous case")}>‹</button>
          <button className="case-gallery-arrow next" type="button" onClick={() => moveCase(1)} aria-label={text("下一个案例","Next case")}>›</button>
          <div className="case-gallery-caption" aria-live="polite">
            <div className="case-caption-meta">
              <span className="case-caption-category">{activeCase.label}</span>
              <InfoHint key={activeCase.key} label={text("查看当前案例说明","About this case")} title={activeCase.label} onOpenChange={setCaseHintOpen}>
                <p>{activeCase.summary}</p>
                <p>{text("真实监测数据，仅用于产品分析演示。","Real monitoring data, shown for product analysis demonstration.")}</p>
              </InfoHint>
            </div>
            <strong>{activeCase.title}</strong>
          </div>
          <div className="case-gallery-progress" aria-label={text("案例分页","Case pagination")}>
            {homeCases.map((item, index) => <button key={item.key} type="button" className={index === activeCaseIndex ? "active" : ""} onClick={() => setActiveCaseIndex(index)} aria-label={item.label} aria-current={index === activeCaseIndex ? "true" : undefined}/>)}
          </div>
        </div>
      </div>
      <div className="metric-strip demo-metric-strip">
        {activeCase.metrics.map(([value,label]) => <article key={`${activeCase.key}-${label}`}><b>{value}</b><span>{label}</span></article>)}
      </div>
    </section>

    <section className="section analysis-journey platform-highlights" aria-labelledby="platform-highlights-title">
      <div className="section-heading">
        <div><span className="eyebrow">{text("核心能力","CORE CAPABILITIES")}</span><h2 id="platform-highlights-title">{text("形变分析与外业核查支持","Deformation analysis and fieldwork support")}</h2></div>
      </div>
      <div className="journey-grid platform-highlight-grid">
        {platformHighlights.map(item => <article key={item.key} className={`signature-${item.key}`}>
          <Image className="signature-image" fill sizes="(max-width: 620px) 100vw, 50vw" src={item.image} alt={item.imageAlt}/>
          <div className="signature-shade" aria-hidden="true"/>
          <div className="signature-content">
            <div className="signature-copy">
              <div className="signature-title">
                <h3>{item.title}</h3>
                <InfoHint label={text(`了解${item.title}`, `About ${item.title}`)} title={item.title}>{item.description}</InfoHint>
              </div>
              <Link href={item.href}>{item.action} <i aria-hidden="true">↗</i></Link>
            </div>
          </div>
        </article>)}
      </div>
      <p className="home-field-note">{text("外业规划基于人工指定的核查点，不自动将形变结果转为出行任务。驾车路线由滴图 Web 服务生成，与显示底图独立；不提供实时导航，停车、入口及最后一段进入条件仍需核验。","Fieldwork plans use manually selected inspection locations; deformation results are not automatically converted into travel tasks. Driving routes are generated by Didi Web services independently of the displayed basemap. This is not real-time navigation; parking, entrances and final access conditions require verification.")}</p>
    </section>

    <section className="cta-section compact-home-cta grid-surface">
      <span className="eyebrow">{text("工作空间","WORKSPACE")}</span>
      <h2>{text("开展数据研判","Analyze monitoring data")}<br/>{text("组织外业核查","and organize fieldwork")}</h2>
      <div><Link className="button light" href="/map?demo=haikou&tour=portfolio">{text("浏览公开案例","Explore public cases")}</Link><Link className="button line-light" href="/map?demo=road">{text("规划核查行程","Plan an inspection")}</Link><Link className="button line-light" href="/map?intent=upload">{text("导入分析数据","Import analysis data")}</Link></div>
    </section>
  </PageShell>;
}
