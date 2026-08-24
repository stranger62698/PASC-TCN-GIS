"use client";

import Link from "next/link";
import { PageShell } from "./SiteShell";

const demoMetrics = [
  ["3,094", "Spatial Demo 监测点"],
  ["248 期", "原生时序观测"],
  ["2017.03—2025.05", "观测时间"],
  ["5 类", "已标注形变模式"],
];

const analysisSteps = [
  ["01", "发现值得关注的位置", "使用速率、累计形变、形变模式和质量条件，让用户先看到需要进一步分析的监测点。"],
  ["02", "理解形变过程", "点击点位或框选区域，查看时序曲线、阶段速率、模式分布与区域统计。"],
  ["03", "形成可追溯的解释", "所有数值由程序计算，形变类别读取已有字段，为后续 AI 辅助解读保留清晰依据。"],
];

export function HomePage() {
  return <PageShell>
    <section className="home-hero grid-surface">
      <div className="hero-copy">
        <span className="eyebrow">TIME-SERIES INSAR · URBAN WEBGIS</span>
        <h1>看见城市地表<br/><em>毫米级形变</em></h1>
        <p>融合卫星遥感、时序分析与 WebGIS 交互，把海量监测点转化为可探索、可解释、可展示的城市安全信息。</p>
        <div className="hero-actions">
          <Link className="button primary" href="/map">进入形变地图 <span>↗</span></Link>
          <Link className="button ghost" href="/showcase">查看典型案例</Link>
        </div>
        <div className="hero-facts">
          <span><b>2017—2025</b>连续观测</span>
          <span><b>毫米级</b>形变洞察</span>
          <span><b>WebGIS</b>交互分析</span>
        </div>
      </div>
      <div className="hero-visual">
        <div className="map-art">
          <span className="map-city">HAIKOU · 20.04°N</span>
          <i className="heat h1"/><i className="heat h2"/><i className="heat h3"/>
          {[1,2,3,4,5,6,7].map(number => <b key={number} className={`point p${number}`}/>) }
          <div className="floating-panel">
            <small>SELECTED POINT</small>
            <strong>−8.24 <em>mm/yr</em></strong>
            <span>持续沉降 · Coherence 0.89</span>
            <svg viewBox="0 0 180 50" aria-hidden="true"><polyline points="0,8 22,12 45,17 68,16 91,26 114,25 136,37 158,40 180,47"/></svg>
          </div>
        </div>
        <div className="satellite-badge"><img src="/insar-satellite-v2.png" alt="Sentinel-1 InSAR 卫星"/><span><b>SENTINEL-1</b><small>时序雷达观测</small></span></div>
      </div>
    </section>

    <section className="section demo-section" aria-labelledby="demo-title">
      <div className="demo-intro">
        <div>
          <span className="eyebrow">LIVE PRODUCT DEMO</span>
          <h2 id="demo-title">海口城市地表形变公开示例</h2>
          <p>这是一套可以直接操作的轻量数据：无需注册即可切换观测日期、点击监测点、查看完整时序并框选区域统计。</p>
          <div className="demo-actions">
            <Link className="button primary" href="/map?demo=haikou">立即体验完整分析 <span>↗</span></Link>
            <Link className="text-link" href="/map?intent=upload">使用自己的 CSV →</Link>
          </div>
        </div>
        <div className="demo-visual" style={{backgroundImage:"linear-gradient(110deg,rgba(5,20,43,.12),rgba(5,20,43,.7)),url(/case-city-insar.png)"}}>
          <span>PUBLIC SAMPLE</span>
          <strong>空间分布与时间序列<br/>在同一视图联动</strong>
          <small>数据仅用于网页功能演示，不代表工程安全结论。</small>
        </div>
      </div>
      <div className="metric-strip demo-metric-strip">
        {demoMetrics.map(([value,label]) => <article key={label}><b>{value}</b><span>{label}</span><small>网页公开示例</small></article>)}
      </div>
    </section>

    <section className="section analysis-journey">
      <div className="section-heading">
        <div><span className="eyebrow">ONE ANALYSIS JOURNEY</span><h2>先找到问题，再理解变化</h2></div>
        <p>产品围绕一条分析主线组织，不要求用户先理解复杂的 GIS 工具和 InSAR 字段。</p>
      </div>
      <div className="journey-grid">
        {analysisSteps.map(([number,title,description]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{description}</p></article>)}
      </div>
    </section>

    <section className="cta-section compact-home-cta grid-surface">
      <span className="eyebrow">START ANALYSIS</span>
      <h2>用一分钟完成第一次<br/>形变分析体验</h2>
      <p>先体验公开数据，或直接导入包含经纬度、速率和时间序列的 CSV。</p>
      <div><Link className="button light" href="/map?demo=haikou">体验示例数据</Link><Link className="button line-light" href="/map?intent=upload">上传我的数据</Link></div>
    </section>
  </PageShell>;
}
