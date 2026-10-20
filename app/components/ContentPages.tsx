"use client";

import Link from "next/link";
import { useLanguage } from "../lib/language-context";
import { PageHero, PageShell } from "./SiteShell";

type ContentType = "platform" | "solutions" | "about";

const capabilities = [
  ["数据接入与质检", "识别 CSV 的坐标、速率、时序、质量及模式字段，检查字段完整性与时间兼容性，明确后续分析的适用范围。"],
  ["时空证据分析", "联动地图位置、观测日期、点位曲线与区域统计，支持变化线索筛选与多维证据复核。"],
  ["形变模式识别", "读取已有类别字段，或在兼容性与质量检查后执行本地 PASC-TCN 推理；结合置信度审阅结果，不将类别等同于风险等级。"],
  ["AI 辅助解读", "基于结构化统计和当前分析范围生成摘要与复核建议；辅助解释不替代原始观测、模型验证或专业判断。"],
  ["外业行程规划", "在地图上设置起终点与途经点，调用滴图驾车路线，并结合顺序优化、点位停留与工时安排核查行程。"],
  ["成果与任务输出", "按各模块的输出范围导出统计、图表、规则或外业任务单，保留分析依据、行程安排与待核验事项。"],
] as const;

const scenarios = [
  ["城市地表形变", "城市建成区与重点设施", "从海量点位中发现持续变化位置，结合时序和区域统计形成核查线索。", "/showcase/city"],
  ["滑坡活动监测", "坡体、坡脚与周边区域", "比较坡体不同部位的趋势与阶段变化，为现场巡查提供辅助范围。", "/showcase/landslide"],
  ["公路沿线监测", "路基、高边坡和桥隧连接段", "沿线路组织监测点，筛查需要优先关注和复核的变化区段。", "/showcase/road"],
  ["外业核查筹备", "小客车核查行程与现场到达点", "人工选择核查位置与车辆到达点，规划驾车顺序与时间，记录停车、入口和末段通行的待核验条件。", "/map?demo=road"],
] as const;

function PlatformPage() {
  const { locale, text } = useLanguage();
  const capabilityItems = locale === "zh" ? capabilities : [
    ["Data onboarding and quality", "Detect coordinate, velocity, time-series, quality and pattern fields in CSV files. Check completeness and temporal compatibility before analysis."],
    ["Spatiotemporal evidence", "Link map locations, observation dates, point curves and regional statistics to screen changes and review supporting evidence."],
    ["Deformation pattern recognition", "Read existing classes or run local PASC-TCN inference after compatibility and quality checks. Review confidence without treating classes as risk levels."],
    ["AI-assisted interpretation", "Generate summaries and review suggestions from structured statistics and the current scope. Interpretation does not replace observations, validation or professional judgement."],
    ["Field itinerary planning", "Set origins, destinations and waypoints on the map. Use Didi driving routes with optional waypoint ordering, stop durations and working-time checks."],
    ["Analysis and task outputs", "Export statistics, charts, rules or field task sheets within each module’s scope, retaining analysis context, itinerary details and unresolved checks."],
  ];
  const path = locale === "zh" ? ["数据接入与质检", "形变识别与复核", "点位与区域分析", "辅助解释与输出", "人工选点与行程规划", "外业任务单输出"] : ["Data onboarding and QA", "Pattern recognition and review", "Point and regional analysis", "Interpretation and export", "Manual selection and route planning", "Field task sheet export"];
  return <PageShell><PageHero eyebrow={text("产品能力","PRODUCT CAPABILITIES")} title={text("时序形变分析与外业核查规划","Deformation analysis and field inspection planning")} description={text("围绕数据质检、模式识别、证据复核与行程筹备，组织从遥感分析到外业准备的专业工作流程。","A professional workflow spanning data quality, pattern recognition, evidence review and itinerary preparation—from remote-sensing analysis to field planning.")} />
    <section className="section phase-eight-content">
      <div className="section-heading"><div><span className="eyebrow">{text("能力体系","CAPABILITIES")}</span><h2>{text("分析、复核与行程筹备","Analysis, review and field preparation")}</h2></div><p>{text("保留原始观测、模型推断与现场条件之间的证据边界，为分析人员和外业组织者提供可审阅的决策依据。","Keep observations, model inference and site conditions distinct, providing reviewable evidence for analysts and field coordinators.")}</p></div>
      <div className="platform-capability-grid">{capabilityItems.map(([title, description], index) => <article className="platform-capability-card" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
      <div className="product-path"><header><span className="eyebrow">{text("工作流程","WORKFLOW")}</span><h2>{text("从监测证据到核查准备","From monitoring evidence to field preparation")}</h2></header><div>{path.map((label, index) => <span key={label}><b>0{index + 1}</b>{label}</span>)}</div></div>
      <p className="product-journey-note">{text("分析与规划目前通过人工衔接：核查点需在地图中另行选择，监测异常不会自动生成外业路线。","Analysis and planning are currently linked by the user: inspection locations must be selected separately on the map; monitoring anomalies do not automatically become routes.")}</p>
      <p className="product-boundary"><b>{text("使用边界","SCOPE & LIMITS")}</b>{text("滴图驾车路线用于小客车行程筹备，不提供实时转向导航，也不构成车辆可达性保证。停车、入口及末段通行仍需核验；平台不替代现场调查、工程检测或风险判定。","Didi driving routes support passenger-car itinerary preparation, not live turn-by-turn navigation or a guarantee of vehicle access. Parking, entrances and the final approach require verification. The platform does not replace field surveys, engineering inspection or risk determination.")}</p>
      <div className="story-action"><div><span className="eyebrow">{text("工作台","WORKSPACE")}</span><h2>{text("进入分析与规划工作台","Open the analysis and planning workspace")}</h2></div><div><Link className="button primary" href="/map?demo=haikou&tour=portfolio">{text("查看分析示例","Explore analysis")} ↗</Link><Link className="button ghost" href="/map?demo=road">{text("规划核查行程","Plan a field itinerary")}</Link></div></div>
    </section>
  </PageShell>;
}

function SolutionsPage() {
  const { locale, text } = useLanguage();
  const scenarioItems = locale === "zh" ? scenarios : [
    ["Urban deformation", "Built-up areas and key facilities", "Find persistent change among dense point sets and combine time series with regional statistics.", "/showcase/city"],
    ["Landslide monitoring", "Slope body, toe and surroundings", "Compare trends and stage changes across the slope to support field inspection planning.", "/showcase/landslide"],
    ["Road corridor monitoring", "Subgrades, cut slopes, bridges and tunnels", "Organise points along a corridor and screen segments that require priority review.", "/showcase/road"],
    ["Field inspection preparation", "Passenger-car itineraries and arrival points", "Manually select inspection locations and vehicle arrival points, plan driving order and timing, and record parking, entrance and final-approach checks.", "/map?demo=road"],
  ];
  return <PageShell><PageHero eyebrow={text("应用场景","APPLICATION SCENARIOS")} title={text("形变监测与外业核查场景","Deformation monitoring and field inspection")} description={text("面向城市、坡体与公路沿线组织监测证据，并提供独立的外业行程规划工具，支持现场核查筹备。","Organise monitoring evidence for urban areas, slopes and road corridors, with a separate itinerary tool for field inspection preparation.")} />
    <section className="section phase-eight-content">
      <div className="section-heading"><div><span className="eyebrow">{text("场景概览","SCENARIO OVERVIEW")}</span><h2>{text("监测对象与核查任务","Monitoring contexts and inspection tasks")}</h2></div><p>{text("依据监测对象选择分析路径；依据现场任务设置核查位置、车辆到达点与行程约束。","Choose an analysis workflow for the monitoring context, then define inspection locations, vehicle arrival points and itinerary constraints for the field task.")}</p></div>
      <div className="scenario-overview-grid">{scenarioItems.map(([title, object, description, href], index) => <Link className="scenario-overview-card" href={href} key={title}><span>0{index + 1}</span><small>{text("适用对象","CONTEXT")} · {object}</small><h2>{title}</h2><p>{description}</p><b>{href === "/map?demo=road" ? text("进入外业规划", "Open field planning") : text("查看场景流程","View workflow")} →</b></Link>)}</div>
      <p className="product-boundary"><b>{text("场景适用性","APPLICABILITY")}</b>{text("监测阈值、质量要求和工程解释须结合具体项目设置。外业规划采用人工选点，不自动接入监测异常；路线生成不代表停车、入口或末段通行条件已经确认。","Monitoring thresholds, quality requirements and engineering interpretation are project-specific. Field planning uses manually selected points rather than automatic anomaly transfer; a generated route does not confirm parking, entrance access or final-approach conditions.")}</p>
      <div className="story-action"><div><span className="eyebrow">{text("案例与工具","CASES & TOOLS")}</span><h2>{text("查阅案例证据，组织核查行程","Review case evidence and prepare field itineraries")}</h2></div><div><Link className="button primary" href="/showcase">{text("查阅案例","Explore case studies")} ↗</Link><Link className="button ghost" href="/map?demo=road">{text("进入外业规划","Open field planning")}</Link></div></div>
    </section>
  </PageShell>;
}

function AboutPage() {
  const { locale, text } = useLanguage();
  const decisions = [
    ["以证据约束模型解释", "区分模式类别与风险等级，将质量、置信度、时空适用性和人工复核作为独立依据呈现。"],
    ["按任务限定数据流向", "PASC-TCN 在浏览器执行 ONNX 推理；AI 接收小于 12 KB 的聚合摘要，不接收原始 CSV 与完整时序。驾车规划按需向地图服务发送路线坐标。"],
    ["以渐进流程组织专业能力", "保留 GIS 分析深度，通过公开示例、操作引导和分层信息建立可理解的工作入口。"],
    ["区分路线结果与现场可达性", "以滴图驾车路线安排小客车行程，结合停留时长与工时约束；停车、入口和末段通行保留为独立待核验项，不以路线存在替代现场确认。"],
  ] as const;
  const evidence = [["公开数据分析", "基于示例查阅形变线索、时序证据与辅助解释", "/map?demo=haikou&tour=portfolio"], ["数据接入与质检", "字段映射、时间兼容性与质量门控", "/datasets"], ["区域统计与导出", "保留分析对象上下文，输出可复核成果", "/statistics"], ["外业行程规划", "地图选点、滴图驾车路线、顺序优化与核查任务单", "/map?demo=road"], ["案例证据分级", "区分可复现示例与待验证场景", "/showcase"]] as const;
  const currentEvidence = [
    ["模型效果", "248 期基线评估 Accuracy 0.927、Macro-F1 0.926"],
    ["运行一致性", "固定样本 PyTorch / ONNX 类别一致率 100%，概率差异在浮点容差内"],
    ["本地推理", "21,610 点 × 248 期可在浏览器完成模型推理，该流程不上传原始 CSV"],
  ] as const;
  const nextEvidence = [
    "访谈 5 位 InSAR / GIS 目标用户并验证核心任务排序",
    "记录首次洞察用时、任务完成率与行程编制用时，评估分析和规划的实际效用",
    "补充实地验证：车辆到达点、停车与入口、末段通行及计划与实际耗时差异",
  ] as const;
  const decisionItems = locale === "zh" ? decisions : [
    ["Constrain interpretation with evidence", "Separate pattern classes from risk levels and present quality, confidence, spatiotemporal applicability and human review as distinct evidence."],
    ["Limit data sharing by task", "Run PASC-TCN as browser ONNX inference. AI receives a summary under 12 KB, not raw CSV files or complete time series. Driving requests send route coordinates to the map service as needed."],
    ["Structure professional tools progressively", "Retain GIS analytical depth while using public examples, guided steps and layered information to provide an accessible entry point."],
    ["Separate route availability from site access", "Use Didi driving routes, stop durations and working-time constraints to plan passenger-car itineraries. Parking, entrances and final approaches remain separate checks requiring site confirmation."],
  ];
  const evidenceItems = locale === "zh" ? evidence : [["Public-data analysis", "Review deformation candidates, time-series evidence and assisted interpretation", "/map?demo=haikou&tour=portfolio"], ["Data onboarding and QA", "Field mapping, temporal compatibility and quality gates", "/datasets"], ["Regional statistics and export", "Preserve analysis context and export reviewable results", "/statistics"], ["Field itinerary planning", "Map selection, Didi driving routes, waypoint ordering and field task sheets", "/map?demo=road"], ["Case evidence levels", "Separate reproducible examples from scenarios awaiting validation", "/showcase"]];
  const currentEvidenceItems = locale === "zh" ? currentEvidence : [["Model performance", "248-observation baseline: Accuracy 0.927 and Macro-F1 0.926"], ["Runtime parity", "100% class agreement between PyTorch and ONNX on fixed samples"], ["Local inference", "21,610 points × 248 observations run in-browser; this inference workflow does not upload raw CSV files"]];
  const nextEvidenceItems = locale === "zh" ? nextEvidence : ["Interview five target InSAR / GIS users and validate core-task priorities", "Measure time to first insight, task completion and itinerary preparation to assess practical utility", "Validate vehicle arrival points, parking, entrances, final approaches and planned versus actual travel time in the field"];
  const journey = locale === "zh" ? ["数据接入与质检", "本地模式识别", "时空证据复核", "辅助解释与成果输出", "人工选点与行程规划", "外业任务单与待核验项"] : ["Data onboarding and QA", "Local pattern recognition", "Spatiotemporal evidence review", "Interpretation and analysis outputs", "Manual selection and itinerary planning", "Field task sheet and pending checks"];
  return <PageShell><PageHero eyebrow={text("产品实践","PRODUCT CASE STUDY")} title={text("从形变分析延伸至外业核查筹备","Extending deformation analysis to field preparation")} description={text("澜迹 InSAR 是一项持续迭代的个人产品实践，围绕遥感分析与现场核查的协作需求，开展需求定义、数据边界设计、WebGIS 实现与功能验证。","LANJIFYW InSAR is an evolving independent product case addressing remote-sensing analysis and field preparation through requirements definition, data-boundary design, WebGIS implementation and functional validation.")} />
    <section className="section phase-eight-content">
      <div className="practice-meta-grid">
        <article><small>{text("项目角色","ROLE")}</small><b>{text("独立产品实践","Independent product case")}</b><span>{text("需求定义 / 数据边界 / 交互实现 / 验证","Requirements / data boundaries / implementation / validation")}</span></article>
        <article><small>{text("目标用户","TARGET USERS")}</small><b>{text("InSAR / GIS 分析与外业人员","InSAR / GIS analysts and field teams")}</b><span>{text("分析监测线索，组织核查证据与行程","Review monitoring evidence and prepare inspection itineraries")}</span></article>
        <article><small>{text("核心任务","CORE JOB")}</small><b>{text("形变识别与核查准备","Pattern analysis and inspection preparation")}</b><span>{text("质检 → 识别 → 复核 → 规划 → 输出","QA → Recognize → Review → Plan → Export")}</span></article>
        <article><small>{text("当前阶段","STAGE")}</small><b>{text("可交互原型 · 持续验证","Interactive prototype · ongoing validation")}</b><span>{text("分析示例与驾车规划可用，实地效果待验证","Analysis examples and route planning available; field outcomes pending validation")}</span></article>
      </div>
      <div className="practice-intro"><div><span className="eyebrow">{text("需求背景","PRODUCT CONTEXT")}</span><h2>{text("监测分析与现场核查的协作需求","Connecting analysis with field preparation")}</h2></div><div><p>{text("时序 InSAR 分析涉及大量点位、长期观测、质量字段与模型结果。形成可复核的监测线索后，仍需选择现场核查位置、确认车辆到达条件并安排工时。分散的数据和工具增加了证据整理与行程筹备的成本。","Time-series InSAR analysis spans dense point sets, long observation records, quality fields and model outputs. Reviewable findings must then be translated into inspection locations, arrival checks and working-time plans. Fragmented data and tools add effort to evidence review and field preparation.")}</p><blockquote>{text("产品目标：以可追溯的监测证据支持形变识别，并提供地图选点与小客车行程规划工具，辅助组织外业核查；模型结论、路线结果与现场通行条件保持独立核验。","Product objective: support deformation recognition with traceable monitoring evidence and provide map-based selection and passenger-car itinerary tools for field preparation, while keeping model conclusions, route results and site-access conditions independently verifiable.")}</blockquote></div></div>
      <section className="case-study-journey"><header><span className="eyebrow">{text("核心任务流程","CORE WORKFLOW")}</span><h2>{text("监测证据、行程规划与任务交付","Monitoring evidence, itinerary planning and task outputs")}</h2></header><div>{journey.map((item, index) => <span key={item}><b>{String(index + 1).padStart(2, "0")}</b>{item}</span>)}</div></section>
      <p className="product-journey-note">{text("当前分析与规划模块通过人工衔接：核查点在地图中独立选择，监测点和识别结果尚未自动转换为路线任务。","Analysis and planning currently require manual coordination: inspection locations are selected separately on the map; monitoring points and recognition results are not automatically converted into route tasks.")}</p>
      <div className="section-heading practice-decision-heading"><div><span className="eyebrow">{text("关键产品决策","KEY PRODUCT DECISIONS")}</span><h2>{text("证据约束与工作流程设计","Evidence boundaries and workflow design")}</h2></div><p>{text("围绕解释可信度、数据流向、使用门槛与现场不确定性，明确各环节的能力边界和人工确认责任。","Define capabilities and human review responsibilities around interpretability, data sharing, usability and uncertainty in field conditions.")}</p></div>
      <div className="practice-decision-grid">{decisionItems.map(([title, description], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
      <section className="practice-validation"><header><span className="eyebrow">{text("证据与验证","EVIDENCE & VALIDATION")}</span><h2>{text("技术验证与实地验证计划","Technical evidence and field validation plan")}</h2></header><div className="practice-validation-grid"><article><small>{text("现有技术评估 · 限对应数据与测试条件","EXISTING EVALUATION · DATASET AND TEST CONDITIONS APPLY")}</small>{currentEvidenceItems.map(([title, value]) => <p key={title}><b>{title}</b><span>{value}</span></p>)}</article><article className="pending"><small>{text("待开展的用户与现场验证","PLANNED USER AND FIELD VALIDATION")}</small>{nextEvidenceItems.map((value, index) => <p key={value}><b>0{index + 1}</b><span>{value}</span></p>)}</article></div></section>
      <section className="practice-evidence"><header><span className="eyebrow">{text("产品证据","PRODUCT EVIDENCE")}</span><h2>{text("可交互的功能与案例入口","Interactive workflows and case evidence")}</h2></header><div className="practice-evidence-list">{evidenceItems.map(([title, description, href]) => <Link href={href} key={href}><div><b>{title}</b><span>{description}</span></div><i aria-hidden="true">↗</i></Link>)}</div></section>
      <p className="practice-boundary"><b>{text("科学与产品边界","SCIENTIFIC & PRODUCT LIMITS")}</b>{text("这是个人作品集中的产品原型，不替代现场调查、工程检测或风险判定。模型指标仅对应已有评估条件，外区域仍缺少带标签精度证据；AI 仅解释结构化摘要。滴图驾车结果用于行程筹备，不提供实时转向导航或现场可达性保证；停车、入口与末段通行须另行核验。2 GB 级异步处理与生产级空间服务仍需后端基础设施验证。","This portfolio prototype does not replace field surveys, engineering inspection or risk determination. Model metrics apply only to existing evaluation conditions, with limited labelled evidence beyond the training region; AI interprets structured summaries only. Didi driving results support itinerary preparation, not live turn-by-turn navigation or guaranteed site access. Parking, entrances and final approaches require separate verification. 2 GB asynchronous processing and production spatial services still require backend validation.")}</p>
      <div className="story-action"><div><span className="eyebrow">{text("探索项目","EXPLORE THE PROJECT")}</span><h2>{text("查阅分析证据与外业规划流程","Explore analytical evidence and field planning")}</h2></div><div><Link className="button primary" href="/map?demo=haikou&tour=portfolio">{text("查看分析示例","Explore analysis")} ↗</Link><Link className="button ghost" href="/map?demo=road">{text("进入外业规划","Open field planning")}</Link></div></div>
    </section>
  </PageShell>;
}

export function ContentPage({ type }: { type: ContentType }) {
  if (type === "platform") return <PlatformPage />;
  if (type === "solutions") return <SolutionsPage />;
  return <AboutPage />;
}
