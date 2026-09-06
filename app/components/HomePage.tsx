"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLanguage } from "../lib/language-context";
import { PageShell } from "./SiteShell";

export function HomePage() {
  const { locale, text } = useLanguage();
  const homeCases = locale === "zh" ? [
    {
      key: "city", label: "城市建筑", kicker: "URBAN BUILDING · XINBU ISLAND",
      title: "新埠岛建筑密集区时序形变", summary: "以完整密集点观察建筑区的空间分布、累计形变与模式差异，不把点位直接等同于单栋建筑结论。",
      image: "/home-case-city-displacement.webp", imageAlt: "新埠岛建筑密集区累计形变量监测点空间分布",
      href: "/map?demo=haikou&tour=portfolio", action: "打开建筑案例",
      metrics: [["9,069", "监测点"], ["210 期", "观测期数"], ["2017—2025", "观测时间"], ["6 类", "PASC 模式"]],
    },
    {
      key: "road", label: "道路网络", kicker: "ROAD NETWORK · JIANGDONG",
      title: "江东新区主要道路时序形变", summary: "让道路点位沿真实网络展开，比较沿线持续变化与局部差异；网页采用 25 m 网格保留确定性空间样本。",
      image: "/home-case-road.png", imageAlt: "江东新区主要道路上的彩色 InSAR 形变点",
      href: "/map?demo=road", action: "打开道路案例",
      metrics: [["11,383", "网页监测点"], ["175 期", "观测期数"], ["2018—2024", "观测时间"], ["25 m", "空间保留网格"]],
    },
    {
      key: "landslide", label: "山地滑坡", kicker: "LANDSLIDE MOTION · LAJIA",
      title: "拉加镇滑坡时序形变", summary: "在坡体与河谷场景中查看持续变化和阶段变化位置，仅呈现可由坐标与真实时序直接支持的遥感证据。",
      image: "/home-case-landslide.png", imageAlt: "拉加镇滑坡区域的彩色 InSAR 形变点",
      href: "/map?demo=landslide", action: "打开滑坡案例",
      metrics: [["11,354", "监测点"], ["58 期", "观测期数"], ["2021—2022", "观测时间"], ["真实时序", "证据类型"]],
    },
  ] : [
    {
      key: "city", label: "Urban buildings", kicker: "URBAN BUILDING · XINBU ISLAND",
      title: "Dense building deformation on Xinbu Island", summary: "Explore spatial distribution, cumulative displacement and pattern differences without treating monitoring points as per-building conclusions.",
      image: "/home-case-city-displacement.webp", imageAlt: "Cumulative InSAR displacement across the dense building area of Xinbu Island",
      href: "/map?demo=haikou&tour=portfolio", action: "Open building case",
      metrics: [["9,069", "Monitoring points"], ["210", "Epochs"], ["2017—2025", "Period"], ["6", "PASC patterns"]],
    },
    {
      key: "road", label: "Road network", kicker: "ROAD NETWORK · JIANGDONG",
      title: "Time-series deformation along Jiangdong roads", summary: "Follow real road geometry to compare persistent and local change; the web dataset retains deterministic samples on a 25 m grid.",
      image: "/home-case-road.png", imageAlt: "Coloured InSAR deformation points along major roads in Jiangdong",
      href: "/map?demo=road", action: "Open road case",
      metrics: [["11,383", "Web points"], ["175", "Epochs"], ["2018—2024", "Period"], ["25 m", "Sampling grid"]],
    },
    {
      key: "landslide", label: "Landslide", kicker: "LANDSLIDE MOTION · LAJIA",
      title: "Time-series deformation of the Lajia landslide", summary: "Locate persistent and stage-wise change across a slope and river-valley setting using only evidence supported by coordinates and real time series.",
      image: "/home-case-landslide.png", imageAlt: "Coloured InSAR deformation points across the Lajia landslide area",
      href: "/map?demo=landslide", action: "Open landslide case",
      metrics: [["11,354", "Monitoring points"], ["58", "Epochs"], ["2021—2022", "Period"], ["Real series", "Evidence type"]],
    },
  ];
  const platformHighlights = locale === "zh" ? [
    { key: "time", image: "/platform-time-map.webp", imageAlt: "时空形变地图与时间序列演化示意", title: "时空地图，不只是静态图层", description: "把地理位置、观测日期、累计形变和区域选择放进同一地图语境；拖动时间轴即可理解同一地点怎样随时间变化。", href: "/map?demo=haikou", action: "打开时空地图" },
    { key: "pattern", image: "/platform-pattern-analysis.webp", imageAlt: "从监测时序识别不同形变模式的分析示意", title: "从形变量进入形变模式", description: "在速率之外识别稳定、线性、分段、加速与减速等过程，并回到真实时序、质量和空间支持证据。", href: "/map?demo=haikou&panel=filters", action: "分析形变模式" },
    { key: "field", image: "/platform-field-evidence.webp", imageAlt: "桥梁考察照片与遥感形变监测点联动示意", title: "现场照片与遥感坐标对应", description: "通过照片坐标组织考察点、附近 InSAR 候选与人工确认时序，将现场观察和遥感证据放在同一位置核查。", href: "/map?demo=haikou&panel=field", action: "进入现场观测" },
  ] : [
    { key: "time", image: "/platform-time-map.webp", imageAlt: "Spatiotemporal deformation map and timeline evolution", title: "A map where time is first-class", description: "Explore location, acquisition date, displacement and selected regions in one map context to understand how the same place changes over time.", href: "/map?demo=haikou", action: "Open spatiotemporal map" },
    { key: "pattern", image: "/platform-pattern-analysis.webp", imageAlt: "Analysis workflow that identifies deformation patterns from monitoring series", title: "Move from values to patterns", description: "Go beyond velocity to stable, linear, piecewise, accelerating and decelerating processes tied to real time-series and quality evidence.", href: "/map?demo=haikou&panel=filters", action: "Analyze patterns" },
    { key: "field", image: "/platform-field-evidence.webp", imageAlt: "Bridge inspection photos linked with remote-sensing deformation points", title: "Match field photos to remote-sensing coordinates", description: "Photo coordinates connect inspection points, nearby InSAR candidates and manually confirmed time series so field observations and remote-sensing evidence can be reviewed together.", href: "/map?demo=haikou&panel=field", action: "Open field observations" },
  ];
  const [activeCaseIndex, setActiveCaseIndex] = useState(0);
  const [caseCarouselPaused, setCaseCarouselPaused] = useState(false);
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
    if (caseCarouselPaused) return;
    const timer = window.setInterval(() => setActiveCaseIndex((current) => (current + 1) % homeCases.length), 6500);
    return () => window.clearInterval(timer);
  }, [caseCarouselPaused, homeCases.length]);

  return <PageShell>
    <section className="home-hero phase-one-hero grid-surface">
      <div className="hero-copy">
        <span className="eyebrow">{text("时序 InSAR · 形变模式识别","TIME-SERIES INSAR · DEFORMATION PATTERN RECOGNITION")}</span>
        <h1>{text("不只看形变量，","Beyond displacement,")}<br/><em>{text("更识别形变模式","recognize deformation patterns")}</em></h1>
        <p>{text("面向 InSAR / GIS 科研与技术分析人员，以完整时序为基础，把速率和累计形变量扩展为稳定、线性、分段、加速、减速等形变模式，并串联数据质检、地图探索、区域证据与 AI 辅助解读。","Built for InSAR and GIS analysts, the workspace turns full time-series observations into stable, linear, piecewise, accelerating and decelerating deformation patterns—then connects quality checks, map exploration, regional evidence and AI-assisted interpretation.")}</p>
        <div className="hero-actions">
          <Link className="button primary" href="/map?demo=haikou&tour=portfolio">{text("90 秒体验一次分析","Try a 90-second analysis")} <span>↗</span></Link>
          <Link className="button ghost" href="/about">{text("查看产品案例","View product case")}</Link>
        </div>
        <div className="hero-promise">
          <span><b>{text("时空","TIME")}</b>{text("地图联动观测过程","Map-linked observations")}</span><i>·</i>
          <span><b>{text("模式","PATTERN")}</b>{text("识别结果回到证据","Recognition tied to evidence")}</span><i>·</i>
          <span><b>{text("现场","FIELD")}</b>{text("照片坐标对应遥感点","Photos matched to InSAR")}</span>
        </div>
      </div>
      <div className="hero-visual">
        <div className="map-art meaningful-hero-art">
          <div
            className="hero-science-image"
            role="img"
            aria-label={text("雷达卫星波束覆盖沿海城市，地面监测点和形变色带展示 InSAR 从观测到形变模式的过程","Radar observations over a coastal city, with monitoring points and deformation patterns")}
          />
          <div className="hero-deformation-field" aria-hidden="true" />
          <div className="hero-visual-label"><i aria-hidden="true"/><span><small>{text("观测场景","OBSERVATION SCENE")}</small><b>{text("SAR 卫星形变观测","SAR deformation observation")}</b></span></div>
          <div className="hero-observation-flow" aria-label={text("InSAR 产品分析链路","InSAR analysis flow")}>
            <span><i>轨</i><small>{text("数据获取","ACQUISITION")}</small><b>{text("卫星雷达观测","SAR observations")}</b></span>
            <span><i>序</i><small>{text("时序解算","INVERSION")}</small><b>{text("时序形变反演","Time-series inversion")}</b></span>
            <span><i>模</i><small>{text("模式分析","INTERPRETATION")}</small><b>{text("形变模式识别","Pattern recognition")}</b></span>
          </div>
        </div>
        <div className="hero-method-badge"><i aria-hidden="true">ST·MAP</i><span><b>{text("从观测到可核查证据","From observation to reviewable evidence")}</b><small>{text("此处仅展示分析链路，不代表真实监测点、数值或工程结论","Conceptual workflow only; no real monitoring point, value, or engineering conclusion is shown")}</small></span></div>
      </div>
    </section>

    <section className="section demo-section" aria-labelledby="demo-title">
      <div className="case-gallery-heading">
        <div><span className="eyebrow">{text("真实案例展廊","LIVE CASE GALLERY")}</span><h2 id="demo-title">{text("三个平行场景，同一套时空分析语言","Three equal scenarios, one spatiotemporal analysis language")}</h2></div>
        <p>{text("将鼠标移到左侧案例，右侧会同步切换真实成果图；选择案例只负责预览，点击明确入口后才进入交互地图。","Hover or focus a case on the left to change the real result image on the right. Selecting previews the case; only the explicit action opens the interactive map.")}</p>
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
              <small>{item.summary}</small>
              <b>{item.kicker}</b>
            </button>
          ))}
          <div className="case-gallery-actions">
            <Link className="button primary" href={activeCase.href}>{activeCase.action} <span>↗</span></Link>
            <Link className="text-link" href="/showcase">{text("查看全部案例说明","View all case notes")}</Link>
          </div>
        </div>
        <div id="home-case-preview" className={`case-gallery-media case-${activeCase.key}`} role="tabpanel" aria-labelledby={`home-case-tab-${activeCase.key}`}>
          <Image key={activeCase.image} fill priority sizes="(max-width: 760px) 100vw, 62vw" src={activeCase.image} alt={activeCase.imageAlt} />
          <button className="case-gallery-arrow previous" type="button" onClick={() => moveCase(-1)} aria-label={text("上一个案例","Previous case")}>‹</button>
          <button className="case-gallery-arrow next" type="button" onClick={() => moveCase(1)} aria-label={text("下一个案例","Next case")}>›</button>
          <div className="case-gallery-caption" aria-live="polite">
            <span>{activeCase.label}</span><strong>{activeCase.title}</strong><small>{text("真实监测结果 · 仅用于产品分析演示","Real monitoring result · product analysis demonstration only")}</small>
          </div>
          <div className="case-gallery-progress" aria-label={text("案例分页","Case pagination")}>
            {homeCases.map((item, index) => <button key={item.key} type="button" className={index === activeCaseIndex ? "active" : ""} onClick={() => setActiveCaseIndex(index)} aria-label={item.label} aria-current={index === activeCaseIndex ? "true" : undefined}/>)}
          </div>
        </div>
      </div>
      <div className="metric-strip demo-metric-strip">
        {activeCase.metrics.map(([value,label]) => <article key={`${activeCase.key}-${label}`}><b>{value}</b><span>{label}</span><small>{activeCase.label}</small></article>)}
      </div>
    </section>

    <section className="section analysis-journey platform-highlights" aria-labelledby="platform-highlights-title">
      <div className="section-heading">
        <div><span className="eyebrow">{text("平台特色","PLATFORM SIGNATURES")}</span><h2 id="platform-highlights-title">{text("位置、时间、模式与现场证据","Location, time, patterns and field evidence")}</h2></div>
        <p>{text("首页负责解释每项能力为什么重要；进入子页面后，界面只保留完成任务所需的专业功能。","The homepage explains why each capability matters; destination pages stay focused on the tools needed to complete the task.")}</p>
      </div>
      <div className="journey-grid platform-highlight-grid">
        {platformHighlights.map(item => <article key={item.key} className={`signature-${item.key}`}>
          <Image className="signature-image" fill sizes="(max-width: 1000px) 100vw, 33vw" src={item.image} alt={item.imageAlt}/>
          <div className="signature-shade" aria-hidden="true"/>
          <div className="signature-content">
            <div className="signature-copy"><h3>{item.title}</h3><p>{item.description}</p><Link href={item.href}>{item.action} <i aria-hidden="true">↗</i></Link></div>
          </div>
        </article>)}
      </div>
    </section>

    <section className="cta-section compact-home-cta grid-surface">
      <span className="eyebrow">{text("开始分析","START ANALYSIS")}</span>
      <h2>{text("先用公开数据完成一次","Complete one traceable analysis")}<br/>{text("可追溯分析","with public data")}</h2>
      <p>{text("引导只保留关键动作，专业工作台的全部能力仍可随时使用。","The walkthrough keeps only the essential actions; the full professional workspace remains available.")}</p>
      <div><Link className="button light" href="/map?demo=haikou&tour=portfolio">{text("开始 90 秒引导","Start 90-second guide")}</Link><Link className="button line-light" href="/map?intent=upload">{text("使用我的数据","Use my data")}</Link></div>
    </section>
  </PageShell>;
}
