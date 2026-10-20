"use client";

import Link from "next/link";
import { useState } from "react";
import type { CaseKey, CaseStudy } from "../data/site";
import { cases } from "../data/site";
import { useLanguage } from "../lib/language-context";
import { PageHero, PageShell } from "./SiteShell";

const englishCaseCopy: Record<CaseKey, Partial<CaseStudy>> = {
  city: {
    label: "Urban",
    title: "Xinbu Island building time-series deformation monitoring",
    description: "Based on 9,069 original monitoring points and 210 InSAR epochs from Xinbu Island, the case compares deformation process, velocity and pattern differences across a dense building area to support evidence review and field target selection.",
    metrics: [["Monitoring points", "9,069"], ["Epochs", "210"], ["Period", "2017—2025"]],
    imageAlt: "Dense InSAR deformation points across the building area of Xinbu Island, Hainan",
    visualLegend: ["Negative velocity", "Near stable", "Positive velocity"],
    workflow: [["Question", "Which locations, temporal processes and deformation patterns in the dense building area deserve comparison and review?"], ["Data", "All 9,069 supplied points and 210 displacement epochs from 2017-03-22 to 2025-05-03, plus velocity, coherence, six-class probabilities, confidence and spatial reliability; no web downsampling."], ["Workflow", "Compatibility check → time-series and quality review → six-class review → point probabilities → regional statistics."], ["Finding", "Traceable point time series and regional differences, without treating dense points as per-building conclusions."], ["Value", "Transforms original dense time-series predictions into locatable, comparable and explainable urban deformation evidence."]],
    demoNote: "The published case uses the complete updated 9,069-point, 210-epoch source file. Building footprints are still absent, so the product supports point and regional analysis without fabricating per-building aggregation.",
    evidenceLabel: "Real time series · interactive demo",
    researchArea: {
      title: "Dense-building monitoring in an estuary waterfront setting",
      overview: "Xinbu Island sits in Meilan District, Haikou, near the Nandu River estuary. Built-up areas and waterfront space meet here, creating an observation setting where local spatial differences matter.",
      facts: [["Location","Xinbu Island, Meilan District, Haikou, next to the Nandu River estuary and the Qiongzhou Strait."],["Setting","Dense buildings sit close to waterways, shoreline and flood-control space, supporting continuous point-based comparison."],["Why monitor","Dense InSAR points compare long-term velocity, displacement and patterns, providing a point layer for future building-footprint aggregation."]],
      boundary: "The 9,069 points cover approximately 110.3401—110.3749°E and 20.0810—20.0914°N. This is a point-observation extent, not the full administrative island, and points are not yet assigned to individual buildings.",
      sources: [{label:"Haikou Public Resources: Xinbu Island flood-control repair project",href:"https://ggzy.haikou.gov.cn/gonggao/86641"}]
    },
  },
  landslide: {
    label: "Landslide",
    title: "Lajia landslide time-series deformation monitoring",
    description: "Based on 11,354 real monitoring points and 58 InSAR epochs from Lajia, Maqin County, the case compares deformation process, velocity and stage-wise change across the slope to support evidence review and field target selection.",
    metrics: [["Monitoring points", "11,354"], ["Epochs", "58"], ["Period", "2021—2022"]],
    imageAlt: "Lajia landslide monitoring object and deformation point organisation",
    visualLegend: ["Faster change", "Transition", "Stable reference"],
    workflow: [["Question", "How can persistent and stage-wise change be located among dense points on a slope?"], ["Data", "WGS84 coordinates, 11,354 points and 58 cumulative-displacement epochs, displayed at 0.1 mm precision."], ["Workflow", "Data QA → velocity and series review → area selection → multi-point comparison → priority inspection."], ["Finding", "Traceable deformation candidates; no class or coherence is fabricated where the source file does not provide it."], ["Value", "Turns landslide time series into monitoring evidence that can be located, compared and reviewed."]],
    demoNote: "This case uses the real Lajia landslide time series supplied by the project owner. It contains no slope zoning, coherence or manual class labels, so the page shows only evidence derived directly from coordinates and time series.",
    evidenceLabel: "Real time series · interactive demo",
    researchArea: {
      title: "Landslide monitoring in a high-altitude Yellow River town",
      overview: "Lajia lies in Maqin County, Golog, within the mountainous Sanjiangyuan and upper Yellow River setting. Complex terrain, geology, rainfall and past slope activity make continued observation relevant to buildings, roads and infrastructure.",
      facts: [["Location","Lajia, Maqin County, Golog Tibetan Autonomous Prefecture, in the upper Yellow River highlands."],["Setting","Slopes, river valleys and settlement space meet, while terrain and rainfall shape the spatial and temporal deformation signal."],["Why monitor","Continuous InSAR series screen persistent and stage-wise change so field teams can prioritise follow-up locations."]],
      boundary: "The case contains 11,354 points and 58 epochs from 2021—2022. It has no formal slope zoning, geological investigation conclusion or alert threshold, so the page presents remote-sensing deformation evidence only.",
      sources: [{label:"Qinghai People's Congress: proposal on Lajia landslide mitigation",href:"https://www.qhrd.gov.cn/yajy/202305/t20230524_212432.html"}]
    },
  },
  road: {
    label: "Road",
    title: "Haikou Jiangdong major-road time-series deformation monitoring",
    description: "Based on 27,123 original monitoring points and 175 InSAR epochs from major roads in Jiangdong, the case uses 11,383 deterministic spatial samples to compare deformation process, velocity and quality differences for evidence review and field target selection.",
    metrics: [["Monitoring points", "11,383"], ["Epochs", "175"], ["Period", "2018—2024"]],
    imageAlt: "Time-series InSAR monitoring along major roads in Jiangdong, Haikou",
    visualLegend: ["Faster subsidence", "Minor change", "Stable reference"],
    workflow: [["Question", "Which locations along major roads show persistent change and deserve priority review?"], ["Data", "27,123 original points with 175 epochs, velocity, coherence and elevation; 11,383 points retained on a 25 m grid for the web."], ["Workflow", "Quality filtering → corridor review → area selection → multi-point comparison → inspection list."], ["Finding", "Traceable candidate locations and time-series evidence without directly determining road safety."], ["Value", "Turns dense monitoring results into road evidence that can be located, compared and followed up in the field."]],
    demoNote: "The source CSV does not provide road names, chainage, lane direction or current field conditions. The case therefore presents point evidence without inventing segment ownership, traffic status or parking conclusions.",
    evidenceLabel: "Real time series · interactive demo",
    researchArea: {
      title: "Road deformation in a riverfront and coastal new district",
      overview: "Haikou Jiangdong New Area extends along Haikou's east coast from the Nandu River to Dongzhai Port, combining riverfront, coastline, wetlands and construction districts. Its roads connect areas with different natural and development conditions.",
      facts: [["Location","Haikou's east-coast new district, from the Nandu River to Dongzhai Port, with a planned area of about 298 km²."],["Setting","River, coast and lake environments coexist with continued construction, creating marked spatial variation along road corridors."],["Why monitor","Roadside InSAR series can screen persistent change before road name, chainage and field information are used for engineering review."]],
      boundary: "The source contains 27,123 points; the web retains 11,383 deterministic samples on a 25 m grid. With no road name, chainage or field-condition fields, the page cannot issue segment-level safety conclusions.",
      sources: [{label:"Haikou Jiangdong New Area: master-plan overview",href:"https://jdxq.haikou.gov.cn/xinwen/2021/show-800.html"}]
    },
  },
};

function localiseCase(item: CaseStudy, locale: "zh" | "en"): CaseStudy {
  return locale === "zh" ? item : { ...item, ...englishCaseCopy[item.key] };
}

function CaseVisual({ item, full = false }: { item: CaseStudy; full?: boolean }) {
  return (
    <div className={`case-visual${full ? " full" : ""}`} style={{ "--case-accent": item.accent } as React.CSSProperties}>
      <div className={`case-map case-map-${item.key}`} role="img" aria-label={item.imageAlt} style={{ backgroundImage: `linear-gradient(rgba(7,26,56,.08),rgba(7,26,56,.14)),url(${item.image})` }}>
        {item.visualAnnotations?.map((annotation) => <span className="case-object-label" key={annotation.label} style={{ left: annotation.left, top: annotation.top }}>{annotation.label}</span>)}
      </div>
      <div className={`case-scale case-scale-${item.key}`} aria-label="示例颜色含义">
        <i aria-hidden="true" />
        <div>{item.visualLegend.map((label) => <span key={label}>{label}</span>)}</div>
      </div>
      <div className="case-metrics">{item.metrics.map(([label, value]) => <span key={label}><small>{label}</small><b>{value}</b></span>)}</div>
    </div>
  );
}

function ScenarioFlow({ item }: { item: CaseStudy }) {
  const { text } = useLanguage();
  return (
    <section className="scenario-flow">
      <header><span className="eyebrow">{text("场景分析流程","SCENARIO WORKFLOW")}</span><h2>{text("监测问题、分析方法与核查依据","Monitoring context, methods and inspection evidence")}</h2><p>{text("明确数据来源、分析过程与适用边界，为后续外业核查保留可追溯依据。","Document data sources, methods and limitations to preserve traceable evidence for field inspection.")}</p></header>
      <div className="scenario-flow-grid">
        {item.workflow.map(([title, description], index) => <article key={title}><b>{String(index + 1).padStart(2, "0")}</b><h3>{title}</h3><p>{description}</p></article>)}
      </div>
      <p className="scenario-boundary"><b>{text("案例边界","CASE BOUNDARY")}</b>{item.demoNote}</p>
    </section>
  );
}

function ResearchAreaBackground({ item }: { item: CaseStudy }) {
  const { text } = useLanguage();
  return (
    <section className="research-area-background" style={{ "--case-accent": item.accent } as React.CSSProperties}>
      <header>
        <div>
          <span className={`case-evidence-status ${item.evidenceLevel}`}>{item.evidenceLabel}</span>
          <span className="eyebrow">{text("研究区背景","STUDY AREA")}</span>
          <h2>{item.researchArea.title}</h2>
        </div>
        <p>{item.researchArea.overview}</p>
      </header>
      <div className="research-area-facts">
        {item.researchArea.facts.map(([label, description], index) => <article key={label}><b>{String(index + 1).padStart(2, "0")}</b><h3>{label}</h3><p>{description}</p></article>)}
      </div>
      <footer>
        <p><b>{text("本案例范围","CASE EXTENT")}</b>{item.researchArea.boundary}</p>
        <div><span>{text("背景资料","BACKGROUND SOURCE")}</span>{item.researchArea.sources.map((source) => <a key={source.href} href={source.href} target="_blank" rel="noreferrer">{source.label} ↗</a>)}</div>
      </footer>
    </section>
  );
}

function FieldInspectionWorkflow({ caseKey }: { caseKey: CaseKey }) {
  const { text } = useLanguage();
  return (
    <section className="insar-action-concept">
      <header>
        <div><span className="eyebrow">{text("外业核查流程","FIELD INSPECTION WORKFLOW")}</span><h2>{text("遥感线索与外业行程组织","Remote-sensing evidence and field trip planning")}</h2></div>
        <p>{text("分析结果用于筛选核查目标；用户在驾车面板手动选点，分别管理道路行程、现场进入条件与核查记录。","Analysis supports target selection. Users manually select points in the driving panel and manage road travel, site access and inspection records separately.")}</p>
      </header>
      <div className="insar-action-flow">
        <article><b>01</b><span>{text("目标筛选","TARGET SELECTION")}</span><h3>{text("确定核查范围","Define inspection scope")}</h3><p>{text("结合形变幅度、时序变化与观测质量，筛选需进一步核查的位置。","Review deformation, temporal change and observation quality to select locations for follow-up.")}</p><small>{text("依据当前数据","CURRENT DATA")}</small></article>
        <article><b>02</b><span>{text("驾车规划","DRIVING PLAN")}</span><h3>{text("编排外业行程","Organise the field trip")}</h3><p>{text("手动设置起终点和途经点，通过滴图 Web 服务计算小客车路线，并评估访问顺序与工时。","Set start, destination and waypoints manually. Didi Web Service provides car routes for visit-order and work-time assessment.")}</p><small>{text("需配置路线服务","SERVICE REQUIRED")}</small></article>
        <article><b>03</b><span>{text("进入核验","ACCESS REVIEW")}</span><h3>{text("核实现场进入条件","Verify site access")}</h3><p>{text("路线生成不等于入口已核验；停车、禁入、封路与最后一段接近方式仍需人工确认。","A generated route does not verify an entrance. Parking, restrictions, closures and final access still require human confirmation.")}</p><small>{text("人工核验","HUMAN REVIEW")}</small></article>
        <article><b>04</b><span>{text("现场记录","FIELD RECORDS")}</span><h3>{text("保留核查证据","Retain inspection evidence")}</h3><p>{text("记录现场位置、照片与说明，按空间关系关联监测点，并复核关联结果。","Record locations, photos and notes, associate observations with monitoring points spatially, and review the associations.")}</p><small>{text("本地记录","LOCAL RECORDS")}</small></article>
      </div>
      <div className="insar-resolution-note">
        <div><b>{text("路线与底图","ROUTES & BASEMAP")}</b><span>{text("滴图路线服务与 OSM 等底图独立","Didi routes are independent of OSM or other basemaps")}</span></div>
        <div><b>{text("使用边界","USE LIMITS")}</b><span>{text("辅助外业规划，非实时导航或通行保证","Planning support, not real-time navigation or an access guarantee")}</span></div>
        <Link className="button primary" href={`/map?demo=${caseKey}&panel=route`}>{text("打开外业驾车规划","Open field driving planner")} ↗</Link>
      </div>
    </section>
  );
}

export function ShowcasePage() {
  const { locale, text } = useLanguage();
  const [activeKey, setActiveKey] = useState(cases[0].key);
  const localisedCases = cases.map((item) => localiseCase(item, locale));
  const active = localisedCases.find((item) => item.key === activeKey) ?? localisedCases[0];
  return (
    <PageShell>
      <PageHero eyebrow={text("案例展示","CASE STUDIES")} title={text("典型场景与核查实践","Monitoring scenarios and inspection workflows")} description={text("以城市、滑坡与公路监测为例，呈现时序分析、证据复核与外业规划的方法、数据依据及适用边界。","Urban, landslide and road cases present the methods, data and limitations of time-series analysis, evidence review and field planning.")} />
      <section className="section showcase-section phase-eight-showcase">
        <p className="case-evidence-guide"><b>{text("证据状态","EVIDENCE STATUS")}</b>{text("三个案例均使用真实监测结果，可直接进入交互地图复现；页面会明确区分原始字段、程序计算结果和仍需现场确认的结论。","All three cases use real monitoring results and can be reproduced in the interactive map. Source fields, computed results and conclusions requiring field confirmation are clearly separated.")}</p>
        <div className="case-tabs" role="tablist" aria-label={text("应用场景","Use cases")}>
          {localisedCases.map((item) => <button key={item.key} role="tab" aria-selected={item.key === active.key} className={item.key === active.key ? "active" : ""} onClick={() => setActiveKey(item.key)}>{item.label}</button>)}
        </div>
        <article className="case-feature" style={{ "--case-accent": active.accent } as React.CSSProperties}>
          <div className="case-feature-copy"><span className={`case-evidence-status ${active.evidenceLevel}`}>{active.evidenceLabel}</span><span className="eyebrow">{text(`真实场景 · ${active.label}`,active.kicker)}</span><h2 className="case-feature-title">{active.title}</h2><p>{active.description}</p><div className="tag-list">{active.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="case-entry-actions"><Link className="button primary" href={`/map?demo=${active.key}`}>{text("快速示例","Quick demo")} ↗</Link><Link className="button ghost" href={`/map?demo=${active.key}&scope=full`}>{text("完整数据","Full dataset")}</Link></div><Link className="case-story-link" href={`/showcase/${active.key}`}>{text("查看案例方法与边界","View method and boundary")}</Link></div>
          <CaseVisual item={active} />
        </article>
        <ScenarioFlow item={active} />
      </section>
    </PageShell>
  );
}

export function CaseDetailPage({ item }: { item: CaseStudy }) {
  const { locale, text } = useLanguage();
  const active = localiseCase(item, locale);
  return (
    <PageShell>
      <PageHero eyebrow={text(`真实场景 · ${active.label}`,active.kicker)} title={active.title} description={active.description} />
      <section className="section phase-eight-showcase">
        <ResearchAreaBackground item={active} />
        <CaseVisual item={active} full />
        <ScenarioFlow item={active} />
        <FieldInspectionWorkflow caseKey={active.key} />
        <div className="story-action"><div><span className="eyebrow">{text("体验产品","TRY THE PRODUCT")}</span><h2>{active.key === "city" ? text("在海口公开数据中复现这条流程","Reproduce the workflow with public Haikou data") : active.key === "landslide" ? text("打开拉加镇滑坡真实数据","Open the real Lajia landslide data") : text("查看江东新区道路真实结果","Explore the real Jiangdong road results")}</h2><p>{text("先用轻量样本熟悉流程，或选择本机完整数据进行全量分析。","Start with a lightweight sample, or choose the complete local dataset for full analysis.")}</p></div><div className="case-entry-actions"><Link className="button primary" href={active.key === "city" ? "/map?demo=haikou&tour=portfolio" : `/map?demo=${active.key}`}>{text("快速示例","Quick demo")} ↗</Link><Link className="button ghost" href={`/map?demo=${active.key}&scope=full`}>{text("完整数据","Full dataset")}</Link></div></div>
      </section>
    </PageShell>
  );
}
