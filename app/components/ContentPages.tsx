"use client";

import Link from "next/link";
import { useLanguage } from "../lib/language-context";
import { PageHero, PageShell } from "./SiteShell";

type ContentType = "platform" | "solutions" | "about";

const capabilities = [
  ["数据理解", "识别 CSV 中的坐标、速率、时间序列、质量和模式字段，并把缺失与识别结果明确反馈给用户。"],
  ["时空分析", "把地图位置、观测日期、单点曲线与区域统计放在同一分析上下文中，减少页面之间的信息断裂。"],
  ["形变模式识别", "优先读取数据已有的模式或类别字段；没有可靠字段时只给出候选识别，不把推断伪装成事实。"],
  ["AI 辅助解读", "依据结构化统计与当前分析对象生成摘要、证据和下一步建议，不直接编造原始监测结果。"],
] as const;

const scenarios = [
  ["城市地表形变", "城市建成区与重点设施", "从海量点位中发现持续变化位置，结合时序和区域统计形成核查线索。", "/showcase/city"],
  ["滑坡活动监测", "坡体、坡脚与周边区域", "比较坡体不同部位的趋势与阶段变化，为现场巡查提供辅助范围。", "/showcase/landslide"],
  ["公路沿线监测", "路基、高边坡和桥隧连接段", "沿线路组织监测点，筛查需要优先关注和复核的变化区段。", "/showcase/road"],
] as const;

function PlatformPage() {
  const { locale, text } = useLanguage();
  const capabilityItems = locale === "zh" ? capabilities : [
    ["Data understanding", "Detect coordinates, velocity, time-series, quality and pattern fields in CSV files, and surface missing or ambiguous fields."],
    ["Spatiotemporal analysis", "Keep map locations, observation dates, point curves and regional statistics in one analysis context."],
    ["Pattern recognition", "Identify stable, linear, piecewise, accelerating and decelerating processes without presenting uncertain inference as fact."],
    ["AI-assisted interpretation", "Generate summaries, evidence and next steps from structured statistics and the current analysis scope."],
  ];
  const path = locale === "zh" ? ["导入数据或打开示例", "发现异常线索", "点位 / 区域分析", "AI 辅助解释", "保存或输出结果"] : ["Import data or open a demo", "Find candidates", "Point / area analysis", "AI-assisted interpretation", "Save or export"];
  return <PageShell><PageHero eyebrow={text("产品能力","PRODUCT CAPABILITIES")} title={text("从看见形变量，到识别形变模式","From measuring displacement to recognizing deformation patterns")} description={text("产品围绕数据理解、时空分析、形变模式识别和 AI 辅助解读组织核心能力。","Core capabilities connect data understanding, spatiotemporal analysis, deformation pattern recognition and AI-assisted interpretation.")} />
    <section className="section phase-eight-content">
      <div className="section-heading"><div><span className="eyebrow">{text("四项核心能力","FOUR CORE CAPABILITIES")}</span><h2>{text("产品有什么核心能力？","What can the product do?")}</h2></div><p>{text("能力围绕用户完成一次分析所需的判断组织，不重复堆叠技术架构名词。","Capabilities are organised around the decisions required to complete an analysis—not a list of technical components.")}</p></div>
      <div className="platform-capability-grid">{capabilityItems.map(([title, description], index) => <article className="platform-capability-card" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
      <div className="product-path"><header><span className="eyebrow">{text("产品路径","PRODUCT PATH")}</span><h2>{text("一次完整的产品使用路径","A complete product journey")}</h2></header><div>{path.map((label, index) => <span key={label}><b>0{index + 1}</b>{label}</span>)}</div></div>
      <p className="product-boundary"><b>{text("能力边界","BOUNDARY")}</b>{text("平台展示的是监测结果组织、分析与辅助解读能力，不代替现场调查、工程检测或风险判定。","The platform organises, analyses and helps interpret monitoring results. It does not replace field surveys, engineering inspection or risk determination.")}</p>
      <div className="story-action"><div><span className="eyebrow">{text("公开示例","PUBLIC DEMO")}</span><h2>{text("无需登录即可体验核心流程","Try the core journey without signing in")}</h2></div><Link className="button primary" href="/map?demo=haikou&tour=portfolio">{text("开始 90 秒体验","Start 90-second demo")} ↗</Link></div>
    </section>
  </PageShell>;
}

function SolutionsPage() {
  const { locale, text } = useLanguage();
  const scenarioItems = locale === "zh" ? scenarios : [
    ["Urban deformation", "Built-up areas and key facilities", "Find persistent change among dense point sets and combine time series with regional statistics.", "/showcase/city"],
    ["Landslide monitoring", "Slope body, toe and surroundings", "Compare trends and stage changes across the slope to support field inspection planning.", "/showcase/landslide"],
    ["Road corridor monitoring", "Subgrades, cut slopes, bridges and tunnels", "Organise points along a corridor and screen segments that require priority review.", "/showcase/road"],
  ];
  return <PageShell><PageHero eyebrow={text("应用场景","APPLICATION SCENARIOS")} title={text("应用场景概述","Where the product can help")} description={text("用三个场景说明 InSAR 监测对象与业务关注点；详细分析过程在案例页展开。","Three scenarios connect InSAR monitoring objects with practical questions; each case page shows the detailed workflow.")} />
    <section className="section phase-eight-content">
      <div className="section-heading"><div><span className="eyebrow">{text("场景概览","SCENARIO OVERVIEW")}</span><h2>{text("场景入口，而不是功能重复","Use cases, not repeated features")}</h2></div><p>{text("本页帮助用户判断产品适合观察什么，详细能力与技术流程在对应页面展开。","Use this page to decide what the product can observe; detailed capabilities and workflows live in their own pages.")}</p></div>
      <div className="scenario-overview-grid">{scenarioItems.map(([title, object, description, href], index) => <Link className="scenario-overview-card" href={href} key={title}><span>0{index + 1}</span><small>{text("分析对象","ANALYSIS OBJECT")} · {object}</small><h2>{title}</h2><p>{description}</p><b>{text("查看场景流程","View workflow")} →</b></Link>)}</div>
      <p className="product-boundary"><b>{text("使用说明","NOTE")}</b>{text("不同场景共享同一套数据理解与时空分析能力，但阈值、质量要求和工程解释必须结合具体项目设置。","The scenarios share data and spatiotemporal analysis capabilities, but thresholds, quality requirements and engineering interpretation remain project-specific.")}</p>
      <div className="story-action"><div><span className="eyebrow">{text("案例集","CASE STUDIES")}</span><h2>{text("查看场景中的完整使用过程","See the complete journey in context")}</h2></div><Link className="button primary" href="/showcase">{text("进入案例展示","Explore case studies")} ↗</Link></div>
    </section>
  </PageShell>;
}

function AboutPage() {
  const { locale, text } = useLanguage();
  const decisions = [
    ["把模型限制做成产品机制", "没有把分类结果包装成风险分数，而是把质量、置信度、时空适用性和人工复核拆成可见证据。"],
    ["让敏感数据留在用户设备", "把 PASC-TCN 转成浏览器 ONNX 推理；AI 只接收小于 12 KB 的聚合摘要，不上传原始 CSV 和完整时序。"],
    ["给专业工作台增加渐进入口", "保留完整 GIS 能力，同时用公开示例和 90 秒引导降低第一次使用的认知负担。"],
    ["用真实数据证明场景能力", "城市、滑坡与公路案例均可交互复现，并明确原始字段、抽样规则与结论边界。"],
  ] as const;
  const evidence = [["90 秒产品体验", "公开数据完成异常发现、证据查看与 AI 解读", "/map?demo=haikou&tour=portfolio"], ["数据接入与质检", "字段映射、时间兼容性和质量门控", "/datasets"], ["区域统计与导出", "保持分析对象上下文并输出可核查结果", "/statistics"], ["案例证据分级", "真实 Demo 与待验证场景明确分开", "/showcase"]] as const;
  const currentEvidence = [
    ["模型效果", "248 期基线评估 Accuracy 0.927、Macro-F1 0.926"],
    ["运行一致性", "固定样本 PyTorch / ONNX 类别一致率 100%，概率差异在浮点容差内"],
    ["性能与隐私", "21,610 点 × 248 期可在浏览器完成推理，原始 CSV 零上传"],
  ] as const;
  const nextEvidence = [
    "访谈 5 位 InSAR / GIS 目标用户并验证核心任务排序",
    "记录首次洞察用时、关键任务完成率和 AI 结果采纳率",
    "为滑坡与道路案例补充分区、道路名称、里程桩和现场核查证据",
  ] as const;
  const decisionItems = locale === "zh" ? decisions : [
    ["Turn model limits into product mechanisms", "Expose quality, confidence, spatial-temporal applicability and human review instead of packaging classes as a risk score."],
    ["Keep sensitive data on the user’s device", "Run PASC-TCN as browser ONNX inference; AI receives only a structured summary under 12 KB, never the raw CSV or full series."],
    ["Create a progressive entry to a professional workspace", "Keep the full GIS toolset while using public demos and a 90-second walkthrough to reduce first-use complexity."],
    ["Prove scenario value with real data", "Urban, landslide and road cases are reproducible and disclose source fields, sampling rules and conclusion boundaries."],
  ];
  const evidenceItems = locale === "zh" ? evidence : [["90-second product demo", "Find candidates, inspect evidence and request AI interpretation with public data", "/map?demo=haikou&tour=portfolio"], ["Data onboarding and QA", "Field mapping, temporal compatibility and quality gates", "/datasets"], ["Regional statistics and export", "Preserve context and export reviewable results", "/statistics"], ["Case evidence levels", "Separate reproducible demos from scenarios awaiting validation", "/showcase"]];
  const currentEvidenceItems = locale === "zh" ? currentEvidence : [["Model performance", "248-epoch baseline: Accuracy 0.927 and Macro-F1 0.926"], ["Runtime parity", "100% class agreement between PyTorch and ONNX on fixed samples"], ["Performance and privacy", "21,610 points × 248 epochs run in-browser with zero raw CSV upload"]];
  const nextEvidenceItems = locale === "zh" ? nextEvidence : ["Interview five target InSAR / GIS users and validate core-task ranking", "Measure time to first insight, task completion and AI result adoption", "Add zones, road names, chainage and field evidence to landslide and road cases"];
  const journey = locale === "zh" ? ["导入与字段识别", "时间 / 质量兼容性检查", "本地 PASC-TCN 识别", "地图与区域证据", "AI 辅助解释", "CSV / 图表 / 规则导出"] : ["Import and field detection", "Temporal / quality compatibility", "Local PASC-TCN inference", "Map and regional evidence", "AI-assisted interpretation", "CSV / chart / rule export"];
  return <PageShell><PageHero eyebrow={text("产品经理案例","PRODUCT MANAGER CASE STUDY")} title={text("把遥感模型变成可使用、可解释的分析产品","Turning a remote-sensing model into a usable, interpretable product")} description={text("澜迹 InSAR 是一项持续迭代的个人产品实践：从研究模型、数据边界到 WebGIS 工作流，独立完成需求拆解、产品设计、实现与验证。","LANJIFYW InSAR is an evolving independent product case—from research model and data boundaries to WebGIS workflow, product design, implementation and validation.")} />
    <section className="section phase-eight-content">
      <div className="practice-meta-grid">
        <article><small>{text("项目角色","ROLE")}</small><b>{text("独立产品实践","Independent product case")}</b><span>{text("产品 / 数据 / 模型边界 / 前端实现","Product / data / model boundaries / frontend")}</span></article>
        <article><small>{text("第一目标用户","PRIMARY USER")}</small><b>{text("InSAR / GIS 分析人员","InSAR / GIS analysts")}</b><span>{text("已有时序数据，需要更快形成核查证据","Have time-series data and need reviewable evidence faster")}</span></article>
        <article><small>{text("核心任务","CORE JOB")}</small><b>{text("从时序数据识别形变模式","Identify deformation patterns from time series")}</b><span>{text("质检 → 发现 → 识别 → 解释 → 输出","QA → Find → Recognize → Interpret → Export")}</span></article>
        <article><small>{text("当前阶段","STAGE")}</small><b>{text("可交互原型 · 持续验证","Interactive prototype · ongoing validation")}</b><span>{text("城市、滑坡与公路均已接入真实示例","Real urban, landslide and road demos connected")}</span></article>
      </div>
      <div className="practice-intro"><div><span className="eyebrow">{text("问题与用户任务","PROBLEM & JTBD")}</span><h2>{text("为什么做这个项目","Why this product")}</h2></div><div><p>{text("时序 InSAR 成果常停留在大体量 CSV、静态图和一次性脚本中。专业人员需要在大量点位、长时序、质量字段和模型结果之间反复切换，才能形成一条可以复核的结论链。","Time-series InSAR outputs often remain in large CSV files, static figures and one-off scripts. Analysts must move between dense points, long series, quality fields and model outputs to build a reviewable chain of evidence.")}</p><blockquote>{text("当我拿到一份时序 InSAR 数据时，帮助我先判断数据是否可用，再找到值得关注的位置、识别形变模式，并导出可复核证据；敏感原始数据不应被默认上传。","When I receive time-series InSAR data, help me assess its usability, find locations worth attention, recognize deformation patterns and export reviewable evidence—without uploading sensitive source data by default.")}</blockquote></div></div>
      <section className="case-study-journey"><header><span className="eyebrow">{text("产品路径","PRODUCT JOURNEY")}</span><h2>{text("一条主任务，而不是功能列表","One core job, not a feature list")}</h2></header><div>{journey.map((item, index) => <span key={item}><b>{String(index + 1).padStart(2, "0")}</b>{item}</span>)}</div></section>
      <div className="section-heading practice-decision-heading"><div><span className="eyebrow">{text("关键产品决策","KEY PRODUCT DECISIONS")}</span><h2>{text("四个关键取舍","Four key trade-offs")}</h2></div><p>{text("作品重点不是“做了多少功能”，而是为什么这样定义边界、如何把科研限制转化成用户可理解的机制。","The case focuses on why boundaries were defined this way and how research constraints became understandable product mechanisms.")}</p></div>
      <div className="practice-decision-grid">{decisionItems.map(([title, description], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
      <section className="practice-validation"><header><span className="eyebrow">{text("证据与验证","EVIDENCE & VALIDATION")}</span><h2>{text("已经证实什么，还要验证什么","What is proven—and what remains to validate")}</h2></header><div className="practice-validation-grid"><article><small>{text("当前已有技术证据","CURRENT TECHNICAL EVIDENCE")}</small>{currentEvidenceItems.map(([title, value]) => <p key={title}><b>{title}</b><span>{value}</span></p>)}</article><article className="pending"><small>{text("下一阶段用户证据","NEXT USER EVIDENCE")}</small>{nextEvidenceItems.map((value, index) => <p key={value}><b>0{index + 1}</b><span>{value}</span></p>)}</article></div></section>
      <section className="practice-evidence"><header><span className="eyebrow">{text("产品证据","PRODUCT EVIDENCE")}</span><h2>{text("可直接验证的产品实践","Product decisions you can inspect")}</h2></header><div className="practice-evidence-list">{evidenceItems.map(([title, description, href]) => <Link href={href} key={href}><div><b>{title}</b><span>{description}</span></div><i>↗</i></Link>)}</div></section>
      <p className="practice-boundary"><b>{text("科学与产品边界","SCIENTIFIC AND PRODUCT BOUNDARY")}</b>{text("这是个人作品集中的分析产品原型，不替代现场调查、工程检测或风险判定。外区域目前缺少带标签精度证据；AI 只解释结构化摘要；2 GB 级异步处理与生产级空间服务仍需后端基础设施验证。","This portfolio prototype does not replace field surveys, engineering inspection or risk determination. Labelled accuracy evidence outside the training region is still limited; AI interprets structured summaries only; 2 GB asynchronous processing and production spatial services still require backend validation.")}</p>
      <div className="story-action"><div><span className="eyebrow">{text("探索项目","EXPLORE THE WORK")}</span><h2>{text("用公开数据复现核心决策","Reproduce the core decisions with public data")}</h2></div><div><Link className="button primary" href="/map?demo=haikou&tour=portfolio">{text("开始 90 秒体验","Start 90-second demo")} ↗</Link><Link className="button ghost" href="/showcase">{text("查看证据分级","View evidence levels")}</Link></div></div>
    </section>
  </PageShell>;
}

export function ContentPage({ type }: { type: ContentType }) {
  if (type === "platform") return <PlatformPage />;
  if (type === "solutions") return <SolutionsPage />;
  return <AboutPage />;
}
