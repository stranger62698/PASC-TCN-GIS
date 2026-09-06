"use client";
import { useMemo, useRef } from "react";
import type { GisLayer, GisLayerRole } from "../lib/gis-layer";

type Props = {
  layers: GisLayer[];
  activeFeatureId: string | null;
  busy: boolean;
  message: string;
  onImport: (file: File) => void;
  onUpdate: (id: string, patch: Partial<Pick<GisLayer, "visible" | "opacity" | "role">>) => void;
  onRemove: (id: string) => void;
  onFocus: (layer: GisLayer) => void;
};

export function GisLayerPanel({ layers, activeFeatureId, busy, message, onImport, onUpdate, onRemove, onFocus }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeFeature = useMemo(() => layers.flatMap((layer) => layer.features.map((feature) => ({ layer, feature }))).find((item) => item.feature.id === activeFeatureId), [layers, activeFeatureId]);
  return <section className="gis-layer-manager">
    <header><div><small>本地空间数据</small><b>GIS 数据图层</b></div><button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "解析中…" : "＋ 导入"}</button></header>
    <input ref={inputRef} hidden type="file" accept=".geojson,.json,.zip,application/geo+json,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.currentTarget.value = ""; }} />
    <p>GeoJSON 或 Shapefile ZIP · 浏览器本地解析 · WGS84 显示</p>
    {message && <div className="gis-import-message" role="status">{message}</div>}
    {layers.length === 0 ? <div className="gis-layer-empty">尚未导入道路线、滑坡面或其他 GIS 图层。</div> : <div className="gis-layer-list">{layers.map((layer) => <article key={layer.id}>
      <div className="gis-layer-row"><label><input type="checkbox" checked={layer.visible} onChange={(event) => onUpdate(layer.id, { visible: event.target.checked })}/><span>{layer.name}</span></label><b>{layer.featureCount.toLocaleString()}</b></div>
      <small>{layer.geometryTypes.join(" / ")} · {layer.sourceType === "shapefile" ? "Shapefile" : "GeoJSON"}</small>
      <label className="gis-role-field"><span>分析角色</span><select value={layer.role} onChange={(event) => onUpdate(layer.id, { role: event.target.value as GisLayerRole })}><option value="generic">通用图层</option><option value="road">道路</option><option value="landslide">滑坡面</option></select></label>
      <label className="gis-opacity-field"><span>透明度</span><input type="range" min="0.15" max="1" step="0.05" value={layer.opacity} onChange={(event) => onUpdate(layer.id, { opacity: Number(event.target.value) })}/></label>
      <div><button type="button" disabled={!layer.bounds} onClick={() => onFocus(layer)}>定位</button><button type="button" onClick={() => onRemove(layer.id)}>移除</button></div>
    </article>)}</div>}
    {activeFeature && <div className="gis-feature-properties"><small>选中 GIS 要素</small><b>{activeFeature.layer.name}</b>{Object.entries(activeFeature.feature.properties).slice(0, 8).map(([key, value]) => <span key={key}><i>{key}</i><em>{String(value ?? "—")}</em></span>)}{Object.keys(activeFeature.feature.properties).length === 0 && <span>该要素没有属性字段。</span>}</div>}
  </section>;
}
