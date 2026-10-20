"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GisLayer, GisLayerRole } from "../lib/gis-layer";
import type { RoadRiskEvidenceInput } from "../lib/roadops-quality";
import type { RoadOpsRouteMapPlan } from "../lib/roadops-route";
import { RoadQualityPanel } from "./RoadQualityPanel";
import { requireAccountSession, useAccountSession } from "../lib/account-session";
import { buildLoginContinuationHref } from "../lib/local-analysis-session";

type Props = {
  layers: GisLayer[];
  activeFeatureId: string | null;
  busy: boolean;
  message: string;
  onImport: (file: File) => void;
  onUpdate: (id: string, patch: Partial<Pick<GisLayer, "visible" | "opacity" | "role">>) => void;
  onRemove: (id: string) => void;
  onFocus: (layer: GisLayer) => void;
  riskInputs: RoadRiskEvidenceInput[];
  onFocusFeature: (layer: GisLayer, featureId: string) => void;
  onRoutePlanChange: (plan: RoadOpsRouteMapPlan | null) => void;
};

export function GisLayerPanel({ layers, activeFeatureId, busy, message, onImport, onUpdate, onRemove, onFocus, riskInputs, onFocusFeature, onRoutePlanChange }: Props) {
  const account = useAccountSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const importRun = useRef(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [authMessage, setAuthMessage] = useState("");
  useEffect(() => () => { importRun.current += 1; }, []);
  const importFile = async (file?: File) => {
    if (!file || busy) return;
    const run = ++importRun.current;
    setPendingFile(file); setAuthMessage("");
    const user = await requireAccountSession();
    if (run !== importRun.current) return;
    if (!user) { setAuthMessage("登录状态需要重新确认；已选择的 GIS 文件保留，尚未读取。请登录后重试导入。"); return; }
    setPendingFile(null);
    onImport(file);
  };
  const activeFeature = useMemo(() => layers.flatMap((layer) => layer.features.map((feature) => ({ layer, feature }))).find((item) => item.feature.id === activeFeatureId), [layers, activeFeatureId]);
  const osmLayer = layers.find((layer) => layer.provenance?.kind === "osm");
  const activeOsmId = activeFeature?.layer.provenance?.kind === "osm" ? String(activeFeature.feature.properties.osm_id ?? "") : "";
  const activeOsmType = activeFeature?.layer.provenance?.kind === "osm" ? String(activeFeature.feature.properties.osm_type ?? "way") : "";
  return <section className="gis-layer-manager">
    <header><div><small>可追溯空间数据</small><b>GIS / OSM 数据图层</b></div><button type="button" disabled={busy || account.status !== "authenticated"} onClick={() => inputRef.current?.click()}>{busy ? "解析中…" : "＋ 导入"}</button></header>
    <input ref={inputRef} hidden type="file" disabled={busy || account.status !== "authenticated"} accept=".geojson,.json,.zip,application/geo+json,application/zip" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; void importFile(file); }} />
    {(account.status !== "authenticated" || pendingFile) && <div className="gis-import-message" role="status">
      <p>{authMessage || (account.status === "error" ? account.error : "导入个人 GIS 文件需先登录；公开图层仍可浏览，文件仅在本机解析。")}</p>
      <a href="/login?returnTo=%2Fmap&resume=1" target="_blank" rel="noopener noreferrer" onClick={event => { event.currentTarget.href = buildLoginContinuationHref(window.location.pathname + window.location.search + window.location.hash, window.location.origin); }}>在新标签页登录 / 注册</a>{" "}
      <button type="button" onClick={() => void account.refresh()}>重新验证登录</button>
      {pendingFile && <button type="button" disabled={busy || account.status !== "authenticated"} onClick={() => void importFile(pendingFile)}>登录后重试导入</button>}
    </div>}
    <p>GeoJSON 或 Shapefile ZIP · 浏览器本地解析 · WGS84 显示</p>
    {message && <div className="gis-import-message" role="status">{message}</div>}
    {layers.length === 0 ? <div className="gis-layer-empty">尚未导入道路线、滑坡面或其他 GIS 图层。</div> : <div className="gis-layer-list">{layers.map((layer) => <article className={layer.provenance?.kind === "osm" ? "is-osm-baseline" : undefined} key={layer.id}>
      <div className="gis-layer-row"><label><input type="checkbox" checked={layer.visible} onChange={(event) => onUpdate(layer.id, { visible: event.target.checked })}/><span>{layer.name}</span></label><b>{layer.featureCount.toLocaleString()}</b></div>
      <small>{layer.geometryTypes.join(" / ")} · {layer.sourceType === "shapefile" ? "Shapefile" : "GeoJSON"}{layer.provenance?.kind === "osm" ? " · 内置开源基线" : ""}</small>
      <label className="gis-role-field"><span>分析角色</span><select disabled={layer.provenance?.builtIn} value={layer.role} onChange={(event) => onUpdate(layer.id, { role: event.target.value as GisLayerRole })}><option value="generic">通用图层</option><option value="road">道路</option><option value="landslide">滑坡面</option></select></label>
      <label className="gis-opacity-field"><span>透明度</span><input type="range" min="0.15" max="1" step="0.05" value={layer.opacity} onChange={(event) => onUpdate(layer.id, { opacity: Number(event.target.value) })}/></label>
      <div><button type="button" disabled={!layer.bounds} onClick={() => onFocus(layer)}>定位</button>{layer.provenance?.builtIn ? <span className="gis-layer-locked">固定基线</span> : <button type="button" onClick={() => onRemove(layer.id)}>移除</button>}</div>
    </article>)}</div>}
    {osmLayer && <aside className="osm-baseline-notice"><small>ROADOPS · OSM VECTOR</small><b>OSM 开源基线，不代表权威道路数据</b><span>{osmLayer.provenance?.attribution} · {osmLayer.provenance?.license}</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">查看版权与 ODbL 许可 ↗</a></aside>}
    {osmLayer && <RoadQualityPanel layer={osmLayer} riskInputs={riskInputs} activeFeatureId={activeFeatureId} onFocusFeature={featureId => onFocusFeature(osmLayer, featureId)} onRoutePlanChange={onRoutePlanChange} />}
    {activeFeature && <div className="gis-feature-properties"><small>选中 GIS 要素</small><b>{activeFeature.layer.name}</b>{activeOsmId && <a className="gis-osm-identity" href={`https://www.openstreetmap.org/${activeOsmType}/${activeOsmId}`} target="_blank" rel="noreferrer"><i>OSM ID</i><em>{activeOsmType}/{activeOsmId} ↗</em></a>}{Object.entries(activeFeature.feature.properties).filter(([key]) => key !== "osm_id" && key !== "osm_type").slice(0, 9).map(([key, value]) => <span key={key}><i>{key}</i><em>{String(value ?? "—")}</em></span>)}{Object.keys(activeFeature.feature.properties).length === 0 && <span>该要素没有属性字段。</span>}</div>}
  </section>;
}
