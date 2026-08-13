"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css";
import Link from "next/link";

export type Point = {
  id: string;
  name: string;
  x: number;
  y: number;
  lon: number;
  lat: number;
  velocity: number;
  displacement: number;
  coherence: number;
  updated: string;
  series: number[];
  mode?: string;
};

const points: Point[] = [
  { id: "BJ-CBD-0231", name: "国贸中心区", x: 63, y: 44, lon: 116.4582, lat: 39.9096, velocity: -8.6, displacement: -34.2, coherence: 0.91, updated: "2026-07-28", series: [-2, -4, -6, -9, -8, -13, -16, -18, -17, -22, -25, -26, -31, -34] },
  { id: "BJ-CY-0108", name: "朝阳公园东", x: 73, y: 34, lon: 116.4933, lat: 39.9388, velocity: -3.2, displacement: -12.8, coherence: 0.88, updated: "2026-07-28", series: [-1, -2, -2, -4, -3, -5, -7, -8, -8, -9, -11, -10, -12, -13] },
  { id: "BJ-FT-0784", name: "丰台科技园", x: 34, y: 67, lon: 116.2987, lat: 39.8241, velocity: 2.4, displacement: 9.7, coherence: 0.86, updated: "2026-07-16", series: [0, 1, 2, 2, 1, 3, 4, 4, 6, 5, 7, 8, 9, 10] },
  { id: "BJ-HD-0316", name: "中关村南", x: 37, y: 29, lon: 116.3168, lat: 39.9674, velocity: -12.4, displacement: -49.6, coherence: 0.94, updated: "2026-07-28", series: [-3, -5, -9, -11, -14, -18, -19, -24, -27, -30, -35, -39, -43, -50] },
  { id: "BJ-DX-0422", name: "大兴新城北", x: 55, y: 78, lon: 116.3419, lat: 39.7526, velocity: -5.1, displacement: -20.4, coherence: 0.82, updated: "2026-07-16", series: [-1, -2, -4, -5, -7, -6, -9, -11, -12, -13, -15, -17, -18, -20] },
  { id: "BJ-TZ-0645", name: "运河商务区", x: 85, y: 58, lon: 116.7012, lat: 39.9018, velocity: 5.8, displacement: 23.1, coherence: 0.89, updated: "2026-07-28", series: [1, 2, 4, 3, 6, 7, 9, 10, 11, 14, 15, 18, 20, 23] },
  { id: "BJ-SY-0169", name: "首都机场西", x: 79, y: 19, lon: 116.5903, lat: 40.0475, velocity: -1.8, displacement: -7.3, coherence: 0.84, updated: "2026-07-16", series: [0, -1, -2, -1, -3, -2, -4, -4, -5, -4, -6, -6, -7, -7] },
];

const InsarMap = dynamic(() => import("./components/InsarMap"), { ssr: false, loading: () => <section className="map-stage map-loading"><span>正在初始化 WebGIS 地图…</span></section> });

const HOVER_MENUS: Record<string, string[]> = {
  "数据总览": ["项目概览", "处理流程", "成果说明"],
  "形变地图": ["点位图层", "形变模式", "点位分析"],
  "区域统计": ["速率分布", "重点区域", "范围对比"],
  "接口验证": ["接口目录", "GeoJSON", "大数据架构"],
};

function velocityClass(value: number) {
  if (value <= -8) return "danger";
  if (value < -2) return "warning";
  if (value > 3) return "positive";
  return "stable";
}

function TrendChart({ point }: { point: Point }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, height);

    const pad = { left: 36, right: 8, top: 12, bottom: 22 };
    const min = Math.min(...point.series, -10) - 4;
    const max = Math.max(...point.series, 10) + 4;
    const px = (i: number) => pad.left + (i / (point.series.length - 1)) * (width - pad.left - pad.right);
    const py = (v: number) => pad.top + ((max - v) / (max - min)) * (height - pad.top - pad.bottom);

    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#7e8b92";
    ctx.strokeStyle = "rgba(24, 46, 55, .09)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const v = max - ((max - min) / 3) * i;
      const y = py(v);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillText(`${Math.round(v)}`, 4, y + 3);
    }

    const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
    gradient.addColorStop(0, "rgba(15, 128, 117, .22)");
    gradient.addColorStop(1, "rgba(15, 128, 117, 0)");
    ctx.beginPath();
    point.series.forEach((value, i) => i === 0 ? ctx.moveTo(px(i), py(value)) : ctx.lineTo(px(i), py(value)));
    ctx.lineTo(px(point.series.length - 1), height - pad.bottom);
    ctx.lineTo(px(0), height - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    point.series.forEach((value, i) => i === 0 ? ctx.moveTo(px(i), py(value)) : ctx.lineTo(px(i), py(value)));
    ctx.strokeStyle = "#087f75";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();
    const last = point.series.length - 1;
    ctx.beginPath();
    ctx.arc(px(last), py(point.series[last]), 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#087f75";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#7e8b92";
    ctx.fillText("2023.01", pad.left, height - 4);
    ctx.fillText("2026.07", width - 52, height - 4);
  }, [point]);

  return <canvas ref={canvasRef} className="trend-canvas" aria-label={`${point.name}累计形变时序曲线`} />;
}

function OverviewPanel({ onOpenMap }: { onOpenMap: () => void }) {
  return <section className="content-stage overview-stage">
    <div className="content-head">
      <div><span className="eyebrow">PROJECT NARRATIVE · 演示项目</span><h1>从雷达影像到城市形变线索</h1><p>以北京核心城区为示例，展示时序 InSAR 数据如何经过处理、质量控制与空间分析，转化为可检索、可解释、可交互的 WebGIS 成果。</p></div>
      <button className="primary-button compact" onClick={onOpenMap}>进入形变地图 →</button>
    </div>

    <div className="overview-metrics">
      <article><span>Sentinel-1 IW</span><strong>36</strong><small>景升轨 SLC 影像</small></article>
      <article><span>观测周期</span><strong>42</strong><small>个月 · 2023.01—2026.07</small></article>
      <article><span>有效监测点</span><strong>1.28M</strong><small>PS / DS 点目标</small></article>
      <article><span>平均相干性</span><strong>0.86</strong><small>阈值 ≥ 0.75</small></article>
    </div>

    <div className="narrative-grid">
      <article className="pipeline-card">
        <div className="card-title"><span>01</span><div><small>PROCESSING</small><h2>时序处理链</h2></div></div>
        <div className="pipeline">
          <div><i className="satellite-glyph">◫</i><b>SLC 影像</b><small>轨道 / DEM</small></div><em>→</em>
          <div><i className="stack-glyph" /><b>干涉网络</b><small>配准 / 解缠</small></div><em>→</em>
          <div><i className="filter-glyph" /><b>误差改正</b><small>大气 / 地形</small></div><em>→</em>
          <div><i className="trend-glyph">⌁</i><b>时序反演</b><small>速率 / 累积量</small></div>
        </div>
        <p className="method-note">演示采用 PS / SBAS 思路组织数据产品。网页负责成果表达与交互，不在浏览器内执行 SAR 成像和解缠计算。</p>
      </article>

      <article className="result-card">
        <div className="card-title"><span>02</span><div><small>DEFORMATION MODES</small><h2>典型形变模式</h2></div></div>
        <div className="mode-visual">
          <div className="mode-map"><i className="mode-zone z1"/><i className="mode-zone z2"/><i className="mode-zone z3"/><b>城市形变空间分区</b></div>
          <ul><li><i className="danger"/>持续沉降<small>线性负趋势</small></li><li><i className="warning"/>季节波动<small>周期性变化</small></li><li><i className="positive"/>局部抬升<small>正向位移</small></li></ul>
        </div>
      </article>

      <article className="product-card">
        <div className="card-title"><span>03</span><div><small>DATA PRODUCTS</small><h2>成果图层</h2></div></div>
        <div className="product-stack"><div><i>V</i><span><b>年均 LOS 速率</b><small>mm / yr · 分级渲染</small></span></div><div><i>Σ</i><span><b>累计形变量</b><small>逐期时序 · mm</small></span></div><div><i>γ</i><span><b>时序相干性</b><small>质量控制 · 0—1</small></span></div><div><i>▧</i><span><b>范围统计</b><small>行政区 / 自定义区域</small></span></div></div>
      </article>

      <article className="architecture-card">
        <div className="card-title"><span>04</span><div><small>WEBGIS ARCHITECTURE</small><h2>网页架构</h2></div></div>
        <div className="architecture"><div><b>GIS 数据层</b><span>GeoJSON · COG · WMTS</span></div><i>⇄</i><div><b>服务接口</b><span>REST API · 缓存</span></div><i>⇄</i><div><b>交互表达</b><span>地图 · 图表 · 报告</span></div></div>
      </article>
    </div>
    <p className="demo-disclaimer">本页指标和点位为界面演示数据；接入你的真实 CSV / GeoJSON / COG 后，可原位替换且不改变交互结构。</p>
  </section>;
}

function StatisticsPanel() {
  const districts = [["海淀区", -5.8, 82], ["朝阳区", -4.3, 66], ["丰台区", -3.6, 54], ["通州区", 2.1, 39], ["东城区", -1.2, 28]];
  return <section className="content-stage statistics-stage">
    <div className="content-head"><div><span className="eyebrow">SPATIAL STATISTICS · 演示统计</span><h1>范围形变统计</h1><p>按行政区或自定义多边形聚合监测点，快速比较速度分布、异常面积与重点点位。</p></div><button className="outline-button">自定义范围 ⌖</button></div>
    <div className="stats-kpis"><article><span>覆盖面积</span><strong>1,264.8</strong><small>km²</small></article><article><span>平均速率</span><strong>−2.7</strong><small>mm / yr</small></article><article><span>异常点占比</span><strong>3.8%</strong><small>|V| ≥ 8 mm/yr</small></article><article><span>重点区域</span><strong>12</strong><small>处</small></article></div>
    <div className="stats-panels">
      <article className="district-ranking"><div className="card-title"><span>01</span><div><small>RANKING</small><h2>行政区平均速率</h2></div></div>{districts.map(([name,value,width])=><div className="district-row" key={String(name)}><span>{name}</span><div><i style={{width:`${width}%`}} /></div><b>{Number(value)>0?"+":""}{value}</b><small>mm/yr</small></div>)}</article>
      <article className="histogram-card"><div className="card-title"><span>02</span><div><small>DISTRIBUTION</small><h2>速度频数分布</h2></div></div><div className="histogram">{[12,19,33,51,73,96,84,60,41,28,17,9].map((value,index)=><i key={index} style={{height:`${value}%`}} />)}<em className="zero-line" /></div><div className="hist-axis"><span>−30</span><span>−15</span><span>0</span><span>+15</span><span>+30</span></div><p>主要点位集中在 −5 至 +3 mm/yr，左尾显示局部持续沉降异常。</p></article>
      <article className="risk-table"><div className="card-title"><span>03</span><div><small>FOCUS AREAS</small><h2>重点监测区</h2></div></div><table><thead><tr><th>区域</th><th>速率</th><th>趋势</th><th>等级</th></tr></thead><tbody><tr><td>中关村南</td><td>−12.4</td><td>↘</td><td><i className="risk high">高</i></td></tr><tr><td>国贸中心区</td><td>−8.6</td><td>↘</td><td><i className="risk high">高</i></td></tr><tr><td>大兴新城北</td><td>−5.1</td><td>→</td><td><i className="risk medium">中</i></td></tr><tr><td>运河商务区</td><td>+5.8</td><td>↗</td><td><i className="risk watch">关注</i></td></tr></tbody></table></article>
    </div>
  </section>;
}

function ApiPanel() {
  const [endpoint, setEndpoint] = useState("/api/health");
  const [result, setResult] = useState("选择接口并点击“发起请求”进行现场验证。");
  const [testing, setTesting] = useState(false);
  const runTest = async () => {
    setTesting(true);
    const start = performance.now();
    try {
      const response = await fetch(endpoint);
      const json = await response.json();
      const elapsed = Math.round(performance.now() - start);
      setResult(`HTTP ${response.status} · ${elapsed} ms\n\n${JSON.stringify(json, null, 2)}`);
    } catch (error) { setResult(`请求失败\n${String(error)}`); }
    finally { setTesting(false); }
  };
  return <section className="content-stage api-stage">
    <div className="content-head"><div><span className="eyebrow">LIVE API CONSOLE</span><h1>接口验证台</h1><p>网页中的点图层与后端服务使用 GeoJSON 交换数据。这里可现场验证线上接口、响应时间和数据结构。</p></div><span className="api-online"><i /> 服务在线</span></div>
    <div className="api-workbench">
      <aside><h2>接口目录</h2><button className={endpoint==="/api/health"?"active":""} onClick={()=>setEndpoint("/api/health")}><b>GET</b><span>/api/health<small>服务健康状态</small></span></button><button className={endpoint==="/api/points"?"active":""} onClick={()=>setEndpoint("/api/points")}><b>GET</b><span>/api/points<small>GeoJSON 形变点</small></span></button><div className="schema-note"><span>数据规范</span><strong>OGC GeoJSON</strong><small>CRS84 · WGS84 经纬度</small></div></aside>
      <div className="api-console"><div className="request-line"><b>GET</b><code>{endpoint}</code><button onClick={runTest} disabled={testing}>{testing?"请求中…":"发起请求 →"}</button></div><div className="response-meta"><span>RESPONSE</span><i>application/json</i></div><pre>{result}</pre></div>
    </div>
    <div className="integration-notes"><article><b>前端地图</b><span>Leaflet 读取 GeoJSON，按 velocity 属性进行分级渲染。</span></article><article><b>真实数据替换</b><span>保持字段名或增加转换层，即可替换当前演示数据。</span></article><article><b>大数据量方案</b><span>点数达到百万级时，使用矢量瓦片或服务端聚合，不一次加载全部点。</span></article></div>
  </section>;
}

export default function Home() {
  const [authReady, setAuthReady] = useState(false);
  const [selected, setSelected] = useState(points[0]);
  const [dataset, setDataset] = useState<Point[]>(points);
  const [datasetName, setDatasetName] = useState("北京城市地表形变监测");
  const [importStatus, setImportStatus] = useState("");
  const [activeNav, setActiveNav] = useState("形变地图");
  const [satellite, setSatellite] = useState("Sentinel-1");
  const [visible, setVisible] = useState(["danger", "warning", "stable", "positive"]);
  const [statsOpen, setStatsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (["localhost", "127.0.0.1"].includes(window.location.hostname)) { setAuthReady(true); return; }
    fetch("/api/session", { credentials: "include" }).then((response) => response.json()).then((session) => {
      if (!session.authenticated) window.location.replace("/login"); else setAuthReady(true);
    }).catch(() => window.location.replace("/login"));
  }, []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const handleNav = (item: string) => {
    setActiveNav(item);
    setMobileOpen(false);
    setStatsOpen(false);
  };

  const parseCsvPreview = async (file: File) => {
    setImportStatus("正在流式读取 CSV 并计算空间范围…");
    const maxPreview = 50000;
    const sample: Point[] = [];
    let headers: string[] = [], remainder = "", rowIndex = 0;
    const decoder = new TextDecoder("utf-8");
    const chunkSize = 4 * 1024 * 1024;
    const splitRow = (line: string) => line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map((value) => value.replace(/^\"|\"$/g, "").trim());
    const aliases = { lon: ["lon","lng","longitude","经度","x"], lat: ["lat","latitude","纬度","y"], velocity: ["velocity","vel","rate","mean_velocity","速率","年均速率"], coherence: ["coherence","coh","相干性","相干系数"], id: ["id","point_id","pid","点号","点位编号"], mode: ["mode","pattern","形变模式","类别"] };
    const findIndex = (keys: string[]) => headers.findIndex((header) => keys.includes(header.toLowerCase()));
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const text = decoder.decode(await file.slice(offset, Math.min(file.size, offset + chunkSize)).arrayBuffer(), { stream: offset + chunkSize < file.size });
      const lines = (remainder + text).split(/\r?\n/); remainder = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        if (!headers.length) { headers = splitRow(line).map((value) => value.toLowerCase()); continue; }
        const values = splitRow(line); const lon = Number(values[findIndex(aliases.lon)]), lat = Number(values[findIndex(aliases.lat)]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        rowIndex++; const velocity = Number(values[findIndex(aliases.velocity)]) || 0; const coherence = Number(values[findIndex(aliases.coherence)]) || 0;
        const id = values[findIndex(aliases.id)] || `IMPORT-${rowIndex}`; const mode = values[findIndex(aliases.mode)] || (velocity <= -8 ? "持续沉降" : velocity > 3 ? "抬升趋势" : "相对稳定");
        const timeIndexes = headers.map((header, index) => /^(d|t|date|disp|20\d{2})/.test(header) ? index : -1).filter((index) => index >= 0).slice(0, 240);
        const series = timeIndexes.length ? timeIndexes.map((index) => Number(values[index]) || 0) : [0, velocity / 4, velocity / 2, velocity];
        const point: Point = { id, name: id, x: 0, y: 0, lon, lat, velocity, displacement: series.at(-1) || 0, coherence, updated: "导入数据", series, mode };
        if (sample.length < maxPreview) sample.push(point); else { const replace = Math.floor(Math.random() * rowIndex); if (replace < maxPreview) sample[replace] = point; }
      }
      setImportStatus(`已扫描 ${(Math.min(file.size, offset + chunkSize) / 1048576).toFixed(0)} / ${(file.size / 1048576).toFixed(0)} MB · ${rowIndex.toLocaleString()} 点`);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    if (!sample.length) { setImportStatus("未识别到经纬度字段，请确认 CSV 含 lon/lat 或 经度/纬度"); return; }
    setDataset(sample); setSelected(sample[0]); setDatasetName(file.name.replace(/\.csv$/i, ""));
    setImportStatus(`导入完成 · 扫描 ${rowIndex.toLocaleString()} 点 · 抽样显示 ${sample.length.toLocaleString()} 点`); notify("已根据点数据最大外包范围自动定位");
  };

  const toggleClass = (item: string) => {
    setVisible((current) => current.includes(item) ? current.filter((v) => v !== item) : [...current, item]);
  };

  if (!authReady) return <main className="auth-loading"><img src="/insar-satellite.png" alt="" /><span>正在验证账户…</span></main>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => notify("已回到项目总览")} aria-label="回到项目总览">
          <span className="brand-mark satellite-mark"><img src="/insar-satellite.png" alt="InSAR 卫星监测图标" /></span>
          <span><strong>澜迹</strong><small>URBAN INSAR</small></span>
        </button>

        <nav className={mobileOpen ? "nav-menu open" : "nav-menu"} aria-label="主导航">
          {["数据总览", "形变地图", "区域统计", "接口验证"].map((item) => (
            <div className="nav-item" key={item}><button className={activeNav === item ? "active" : ""} onClick={() => handleNav(item)}>{item}<i>⌄</i></button><div className="hover-menu">{HOVER_MENUS[item].map((sub) => <button key={sub} onClick={() => { handleNav(item); notify(`已进入：${sub}`); }}>{sub}</button>)}</div></div>
          ))}
        </nav>

        <div className="top-actions">
          <span className="sync-state"><i /> 数据已同步</span>
          <button className="icon-button" onClick={() => notify("当前数据说明已是最新版本")} aria-label="数据说明">?</button>
          <Link className="avatar" href="/login" aria-label="账户中心">FY</Link>
          <button className="menu-toggle" onClick={() => setMobileOpen(!mobileOpen)} aria-label="展开导航">☰</button>
        </div>
      </header>

      <section className="projectbar">
        <div>
          <span className="eyebrow">当前项目</span>
          <button className="project-select">{datasetName} <span>⌄</span></button>
        </div>
        <div className="project-meta">
          <span><b>36</b> 景影像</span>
          <span><b>1.28M</b> 有效点</span>
          <span><b>2023.01—2026.07</b> 观测周期</span>
        </div>
        <button className="outline-button" onClick={() => fileRef.current?.click()}>导入 CSV</button><input ref={fileRef} className="hidden-input" type="file" accept=".csv,text/csv" onChange={(event) => event.target.files?.[0] && parseCsvPreview(event.target.files[0])} />
      </section>

      <section className={activeNav === "形变地图" ? "workspace" : "workspace view-panel"}>
        <aside className="filter-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">数据控制</span><h2>地图筛选</h2></div>
            <button onClick={() => setVisible(["danger", "warning", "stable", "positive"])}>重置</button>
          </div>

          <label className="field-label" htmlFor="city">研究区域</label>
          <button id="city" className="select-field import-region" onClick={() => fileRef.current?.click()}><span>{datasetName}</span><b>导入 / 替换</b></button>{importStatus && <p className="import-status">{importStatus}</p>}

          <span className="field-label">数据源</span>
          <div className="segmented">
            {["Sentinel-1", "ALOS-2"].map((item) => <button key={item} className={satellite === item ? "active" : ""} onClick={() => setSatellite(item)}>{item}</button>)}
          </div>

          <span className="field-label">轨道方向</span>
          <div className="track-row">
            <button className="track active"><span>↗</span> 升轨<br /><small>Path 128</small></button>
            <button className="track"><span>↘</span> 降轨<br /><small>Path 033</small></button>
          </div>

          <div className="filter-title"><span>年均速率</span><small>mm / yr</small></div>
          <div className="range-readout"><span>−30</span><span>+30</span></div>
          <div className="range-track"><i /><b /><em /></div>

          <span className="field-label">形变类型</span>
          <div className="class-list">
            {[
              ["danger", "显著沉降", "≤ −8"], ["warning", "轻微沉降", "−8 ~ −2"],
              ["stable", "相对稳定", "−2 ~ +3"], ["positive", "抬升趋势", "> +3"],
            ].map(([key, label, value]) => (
              <label key={key} className="class-item"><input type="checkbox" checked={visible.includes(key)} onChange={() => toggleClass(key)} /><i className={key} /><span>{label}</span><small>{value}</small></label>
            ))}
          </div>

          <label className="coherence-row"><span>相干性阈值 <b>≥ 0.75</b></span><input type="range" min="0" max="100" defaultValue="75" /></label>
        </aside>

        {activeNav === "形变地图" && <InsarMap points={dataset} selected={selected} visible={visible} onSelect={setSelected} onNotify={notify} />}
        {activeNav === "数据总览" && <OverviewPanel onOpenMap={() => setActiveNav("形变地图")} />}
        {activeNav === "区域统计" && <StatisticsPanel />}
        {activeNav === "接口验证" && <ApiPanel />}

        <aside className="detail-panel">
          <div className="detail-top">
            <div><span className="status-chip">已选点位</span><h2>{selected.name}</h2><p>{selected.id}</p></div>
            <button className="more-button" aria-label="更多操作" onClick={() => notify("点位菜单将在下一版开放")}>•••</button>
          </div>

          <div className="metric-grid">
            <article className="metric-primary"><span>年均形变速率</span><strong className={velocityClass(selected.velocity)}>{selected.velocity > 0 ? "+" : ""}{selected.velocity}</strong><small>mm / yr</small></article>
            <article><span>累计形变</span><strong>{selected.displacement > 0 ? "+" : ""}{selected.displacement}</strong><small>mm</small></article>
            <article><span>相干系数</span><strong>{selected.coherence}</strong><small>质量良好</small></article>
          </div>

          <div className="chart-section">
            <div className="section-title"><div><span className="eyebrow">时间序列</span><h3>累计形变趋势</h3></div><button onClick={() => notify("CSV 导出功能将在真实接口接入后启用")}>导出 CSV</button></div>
            <TrendChart point={selected} />
            <div className="chart-note"><i /><span>线性趋势</span><b>{selected.velocity > 0 ? "+" : ""}{selected.velocity} mm/yr</b></div>
          </div>

          <div className="point-info">
            <div className="section-title"><h3>点位信息</h3><span>最后更新 {selected.updated}</span></div>
            <dl><div><dt>经度</dt><dd>{selected.lon.toFixed(6)}°</dd></div><div><dt>纬度</dt><dd>{selected.lat.toFixed(6)}°</dd></div><div><dt>高程</dt><dd>48.6 m</dd></div><div><dt>数据源</dt><dd>{satellite} IW</dd></div></dl>
          </div>
          <div className="analysis-box"><span className="eyebrow">POINT ANALYSIS</span><div><span>形变模式</span><strong>{selected.mode || (selected.velocity <= -8 ? "持续沉降" : selected.velocity > 3 ? "抬升趋势" : "相对稳定")}</strong></div><div><span>趋势置信度</span><strong>{Math.min(99, Math.round(selected.coherence * 100))}%</strong></div><p>综合速率方向、时序斜率与相干性生成快速判读；接入原始分类字段后优先使用真实结果。</p></div>
          <button className="primary-button" onClick={() => notify(`已将 ${selected.id} 加入重点监测清单`)}>加入重点监测</button>
        </aside>
      </section>

      {activeNav === "形变地图" && <section className={statsOpen ? "stats-drawer open" : "stats-drawer"}>
        <button className="drawer-handle" onClick={() => setStatsOpen(!statsOpen)}><span>范围统计</span><i>{statsOpen ? "⌄" : "⌃"}</i></button>
        <div className="stats-content">
          <article><span>覆盖面积</span><strong>1,264.8</strong><small>km²</small></article>
          <article><span>有效监测点</span><strong>1,284,620</strong><small>PS / DS</small></article>
          <article><span>平均速率</span><strong>−2.7</strong><small>mm / yr</small></article>
          <article><span>显著沉降区域</span><strong>12</strong><small>处 · 占比 3.8%</small></article>
          <article className="api-card"><span><i /> 接口状态</span><strong>运行正常</strong><small>GET /v1/points · 86 ms</small></article>
        </div>
      </section>}

      {toast && <div className="toast" role="status"><i />{toast}</div>}
    </main>
  );
}
