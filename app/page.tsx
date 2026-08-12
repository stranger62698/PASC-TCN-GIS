"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css";

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

export default function Home() {
  const [selected, setSelected] = useState(points[0]);
  const [activeNav, setActiveNav] = useState("形变地图");
  const [satellite, setSatellite] = useState("Sentinel-1");
  const [visible, setVisible] = useState(["danger", "warning", "stable", "positive"]);
  const [statsOpen, setStatsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState("");

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const handleNav = (item: string) => {
    setActiveNav(item);
    setMobileOpen(false);
    if (item === "区域统计") setStatsOpen(true);
    if (item === "接口验证") notify("API 服务在线 · 延迟 86 ms");
  };

  const toggleClass = (item: string) => {
    setVisible((current) => current.includes(item) ? current.filter((v) => v !== item) : [...current, item]);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => notify("已回到项目总览")} aria-label="回到项目总览">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><strong>澜迹</strong><small>URBAN INSAR</small></span>
        </button>

        <nav className={mobileOpen ? "nav-menu open" : "nav-menu"} aria-label="主导航">
          {["数据总览", "形变地图", "区域统计", "接口验证"].map((item) => (
            <button key={item} className={activeNav === item ? "active" : ""} onClick={() => handleNav(item)}>{item}</button>
          ))}
        </nav>

        <div className="top-actions">
          <span className="sync-state"><i /> 数据已同步</span>
          <button className="icon-button" onClick={() => notify("当前数据说明已是最新版本")} aria-label="数据说明">?</button>
          <button className="avatar" onClick={() => notify("个人工作台 · 冯耀武")}>FY</button>
          <button className="menu-toggle" onClick={() => setMobileOpen(!mobileOpen)} aria-label="展开导航">☰</button>
        </div>
      </header>

      <section className="projectbar">
        <div>
          <span className="eyebrow">当前项目</span>
          <button className="project-select">北京城市地表形变监测 <span>⌄</span></button>
        </div>
        <div className="project-meta">
          <span><b>36</b> 景影像</span>
          <span><b>1.28M</b> 有效点</span>
          <span><b>2023.01—2026.07</b> 观测周期</span>
        </div>
        <button className="outline-button" onClick={() => notify("报告任务已创建，示例版暂不下载文件")}>生成报告</button>
      </section>

      <section className="workspace">
        <aside className="filter-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">数据控制</span><h2>地图筛选</h2></div>
            <button onClick={() => setVisible(["danger", "warning", "stable", "positive"])}>重置</button>
          </div>

          <label className="field-label" htmlFor="city">研究区域</label>
          <select id="city" className="select-field" defaultValue="beijing">
            <option value="beijing">北京市 · 核心城区</option>
            <option value="shanghai">上海市 · 示例数据</option>
            <option value="shenzhen">深圳市 · 示例数据</option>
          </select>

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

        <InsarMap points={points} selected={selected} visible={visible} onSelect={setSelected} onNotify={notify} />

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
          <button className="primary-button" onClick={() => notify(`已将 ${selected.id} 加入重点监测清单`)}>加入重点监测</button>
        </aside>
      </section>

      <section className={statsOpen ? "stats-drawer open" : "stats-drawer"}>
        <button className="drawer-handle" onClick={() => setStatsOpen(!statsOpen)}><span>范围统计</span><i>{statsOpen ? "⌄" : "⌃"}</i></button>
        <div className="stats-content">
          <article><span>覆盖面积</span><strong>1,264.8</strong><small>km²</small></article>
          <article><span>有效监测点</span><strong>1,284,620</strong><small>PS / DS</small></article>
          <article><span>平均速率</span><strong>−2.7</strong><small>mm / yr</small></article>
          <article><span>显著沉降区域</span><strong>12</strong><small>处 · 占比 3.8%</small></article>
          <article className="api-card"><span><i /> 接口状态</span><strong>运行正常</strong><small>GET /v1/points · 86 ms</small></article>
        </div>
      </section>

      {toast && <div className="toast" role="status"><i />{toast}</div>}
    </main>
  );
}
