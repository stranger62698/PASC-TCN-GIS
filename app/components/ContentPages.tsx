import Link from "next/link";
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
  return <PageShell><PageHero eyebrow="PRODUCT CAPABILITIES" title="从看见形变量，到理解形变过程" description="产品围绕数据理解、时空分析、形变模式识别和 AI 辅助解读组织核心能力。" />
    <section className="section phase-eight-content">
      <div className="section-heading"><div><span className="eyebrow">FOUR CORE CAPABILITIES</span><h2>产品有什么核心能力？</h2></div><p>能力围绕用户完成一次分析所需的判断组织，不重复堆叠技术架构名词。</p></div>
      <div className="platform-capability-grid">{capabilities.map(([title, description], index) => <article className="platform-capability-card" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
      <div className="product-path"><header><span className="eyebrow">PRODUCT PATH</span><h2>一次完整的产品使用路径</h2></header><div>{["导入数据或打开示例", "发现异常线索", "点位 / 区域分析", "AI 辅助解释", "保存或输出结果"].map((label, index) => <span key={label}><b>0{index + 1}</b>{label}</span>)}</div></div>
      <p className="product-boundary"><b>能力边界</b>平台展示的是监测结果组织、分析与辅助解读能力，不代替现场调查、工程检测或风险判定。</p>
      <div className="story-action"><div><span className="eyebrow">PUBLIC DEMO</span><h2>无需登录即可体验核心流程</h2></div><Link className="button primary" href="/map?demo=haikou">体验公开示例 ↗</Link></div>
    </section>
  </PageShell>;
}

function SolutionsPage() {
  return <PageShell><PageHero eyebrow="APPLICATION SCENARIOS" title="应用场景概述" description="用三个场景说明 InSAR 监测对象与业务关注点；详细分析过程在案例页展开。" />
    <section className="section phase-eight-content">
      <div className="section-heading"><div><span className="eyebrow">SCENE OVERVIEW</span><h2>场景入口，而不是功能重复</h2></div><p>本页只帮助用户判断产品适合观察什么，不再重复产品能力和技术流程。</p></div>
      <div className="scenario-overview-grid">{scenarios.map(([title, object, description, href], index) => <Link className="scenario-overview-card" href={href} key={title}><span>0{index + 1}</span><small>分析对象 · {object}</small><h2>{title}</h2><p>{description}</p><b>查看场景流程 →</b></Link>)}</div>
      <p className="product-boundary"><b>使用说明</b>不同场景共享同一套数据理解与时空分析能力，但阈值、质量要求和工程解释必须结合具体项目设置。</p>
      <div className="story-action"><div><span className="eyebrow">CASE DECK</span><h2>查看场景中的完整使用过程</h2></div><Link className="button primary" href="/showcase">进入案例展示 ↗</Link></div>
    </section>
  </PageShell>;
}

function AboutPage() {
  const decisions = [
    ["产品定义与需求拆解", "从“展示 InSAR 图”转向“导入—质检—分析—解释—输出”的完整产品流程。"],
    ["InSAR 数据与 GIS 设计", "围绕点位时序、区域统计、质量字段、色带与图层控制设计交互。"],
    ["前端体验与信息架构", "使用 React、TypeScript 和 WebGIS 组件组织可演示、可继续扩展的页面。"],
    ["数据与身份边界", "公开示例无需登录；私人数据、分析记录和跨设备延续才需要账户。"],
  ] as const;
  const evidence = [["形变地图", "点位、区域与 AI 辅助分析", "/map?demo=haikou"], ["数据集管理", "字段映射与数据质检", "/datasets"], ["区域统计", "保持分析对象上下文", "/statistics"], ["案例展示", "按真实场景讲产品价值", "/showcase"]] as const;
  return <PageShell><PageHero eyebrow="PERSONAL PRODUCT PRACTICE" title="把遥感成果做成可使用、可解释的产品" description="澜迹 InSAR 是我的个人产品实践：将时序 InSAR、GIS 分析、数据接入与产品交互连接成一条可演示的工作流。" />
    <section className="section phase-eight-content">
      <div className="practice-intro"><div><span className="eyebrow">WHY I BUILT IT</span><h2>为什么做这个项目</h2></div><p>科研成果常停留在 CSV、静态图和单次脚本中。这个项目尝试把它们转换成普通用户也能进入、理解和继续操作的产品流程，并在界面中明确数据来源、分析证据和能力边界。</p></div>
      <div className="practice-decision-grid">{decisions.map(([title, description], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
      <section className="practice-evidence"><header><span className="eyebrow">PRODUCT EVIDENCE</span><h2>可直接验证的产品实践</h2></header><div className="practice-evidence-list">{evidence.map(([title, description, href]) => <Link href={href} key={href}><div><b>{title}</b><span>{description}</span></div><i>↗</i></Link>)}</div></section>
      <p className="practice-boundary"><b>当前边界</b>这是个人作品集中的产品原型。AI 解读以可核查的结构化统计为输入；2GB 级数据的异步转换、生产级空间服务和真实工程风险判定仍需要后端基础设施与专业项目验证。</p>
      <div className="story-action"><div><span className="eyebrow">EXPLORE THE WORK</span><h2>从公开示例开始验证</h2></div><div><Link className="button primary" href="/map?demo=haikou">体验地图 ↗</Link><Link className="button ghost" href="/showcase">浏览案例</Link></div></div>
    </section>
  </PageShell>;
}

export function ContentPage({ type }: { type: ContentType }) {
  if (type === "platform") return <PlatformPage />;
  if (type === "solutions") return <SolutionsPage />;
  return <AboutPage />;
}
