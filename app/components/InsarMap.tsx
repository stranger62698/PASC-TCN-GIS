"use client";

import { useEffect, useRef, useState } from "react";
import type { Point } from "../page";

export type ImportedPoint = Point & { imported?: boolean };

type Props = {
  points: Point[];
  selected: Point;
  visible: string[];
  onSelect: (point: Point) => void;
  onNotify: (message: string) => void;
};

type BaseKey = "osm" | "tianditu" | "imagery";

const BASES: Record<BaseKey, { label: string; sub: string }> = {
  osm: { label: "OSM", sub: "开放街道" },
  tianditu: { label: "天地图", sub: "矢量中文" },
  imagery: { label: "Esri 影像", sub: "World Imagery" },
};

function velocityClass(value: number) {
  if (value <= -8) return "danger";
  if (value < -2) return "warning";
  if (value > 3) return "positive";
  return "stable";
}

export default function InsarMap({ points, selected, visible, onSelect, onNotify }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const baseLayerRef = useRef<any>(null);
  const labelsLayerRef = useRef<any>(null);
  const resultLayerRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const markersRef = useRef(new Map<string, any>());
  const [base, setBase] = useState<BaseKey>("osm");
  const [layerOpen, setLayerOpen] = useState(true);
  const [resultMode, setResultMode] = useState<"points" | "heat">("points");
  const [opacity, setOpacity] = useState(86);
  const [zoom, setZoom] = useState(10);
  const [cursor, setCursor] = useState({ lat: 39.9042, lng: 116.4074 });
  const [tileError, setTileError] = useState("");
  const [baseVisible, setBaseVisible] = useState(true);
  const [resultVisible, setResultVisible] = useState(true);
  const [boundaryVisible, setBoundaryVisible] = useState(true);
  const boundaryRef = useRef<any>(null);

  const makeBase = (L: any, key: BaseKey) => {
    const options = { maxZoom: 19, crossOrigin: true, updateWhenIdle: true };
    if (key === "osm") {
      return { base: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { ...options, attribution: "© OpenStreetMap contributors" }) };
    }
    if (key === "imagery") {
      return { base: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { ...options, maxZoom: 18, attribution: "Tiles © Esri — Earthstar Geographics" }) };
    }
    const keyValue = process.env.NEXT_PUBLIC_TIANDITU_KEY;
    if (!keyValue) return null;
    return {
      base: L.tileLayer(`https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${keyValue}`, { ...options, subdomains: [0,1,2,3,4,5,6,7], attribution: "© 天地图" }),
      labels: L.tileLayer(`https://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${keyValue}`, { ...options, subdomains: [0,1,2,3,4,5,6,7] }),
    };
  };

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    let disposed = false;
    import("leaflet").then((module) => {
      if (disposed || !hostRef.current) return;
      const L = module.default;
      leafletRef.current = L;
      const map = L.map(hostRef.current, { center: [39.9042, 116.4074], zoom: 10, zoomControl: false, attributionControl: true, preferCanvas: true });
      mapRef.current = map;
      L.control.zoom({ position: "topleft" }).addTo(map);
      const initial = makeBase(L, "osm");
      if (initial) {
        baseLayerRef.current = initial.base.addTo(map);
        initial.base.on("tileerror", () => setTileError("底图瓦片暂时不可用，请切换另一底图"));
      }
      map.on("zoomend", () => setZoom(map.getZoom()));
      map.on("mousemove", (event: any) => setCursor(event.latlng));
    });
    return () => { disposed = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
    if (labelsLayerRef.current) map.removeLayer(labelsLayerRef.current);
    setTileError("");
    const next = makeBase(L, base);
    if (!next) {
      setBase("osm");
      onNotify("天地图需要配置 NEXT_PUBLIC_TIANDITU_KEY，已保留接入口");
      return;
    }
    baseLayerRef.current = next.base.addTo(map);
    labelsLayerRef.current = next.labels ? next.labels.addTo(map) : null;
    next.base.on("tileerror", () => setTileError("底图瓦片暂时不可用，请切换另一底图"));
  }, [base]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !baseLayerRef.current) return;
    if (baseVisible) {
      if (!map.hasLayer(baseLayerRef.current)) baseLayerRef.current.addTo(map);
      if (labelsLayerRef.current && !map.hasLayer(labelsLayerRef.current)) labelsLayerRef.current.addTo(map);
    } else {
      if (map.hasLayer(baseLayerRef.current)) map.removeLayer(baseLayerRef.current);
      if (labelsLayerRef.current && map.hasLayer(labelsLayerRef.current)) map.removeLayer(labelsLayerRef.current);
    }
  }, [baseVisible, base]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !resultLayerRef.current) return;
    if (resultVisible && !map.hasLayer(resultLayerRef.current)) resultLayerRef.current.addTo(map);
    if (!resultVisible && map.hasLayer(resultLayerRef.current)) map.removeLayer(resultLayerRef.current);
  }, [resultVisible, points, visible, resultMode]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !points.length) return;
    if (boundaryRef.current) map.removeLayer(boundaryRef.current);
    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lon]));
    boundaryRef.current = L.rectangle(bounds.pad(.04), { color: "#087f75", weight: 1.5, dashArray: "6 5", fill: false, interactive: false });
    if (boundaryVisible) boundaryRef.current.addTo(map);
    map.fitBounds(bounds.pad(.12), { maxZoom: 13, animate: true });
  }, [points, boundaryVisible]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (resultLayerRef.current) map.removeLayer(resultLayerRef.current);
    markersRef.current.clear();
    const renderer = L.canvas({ padding: 0.4 });
    const group = L.layerGroup().addTo(map);
    resultLayerRef.current = group;
    if (!resultVisible) map.removeLayer(group);
    points.forEach((point) => {
      const status = velocityClass(point.velocity);
      if (!visible.includes(status)) return;
      const selectedPoint = selected.id === point.id;
      const color = status === "danger" ? "#d34f45" : status === "warning" ? "#dd8a42" : status === "positive" ? "#268aa0" : "#087f75";
      const marker = L.circleMarker([point.lat, point.lon], {
        renderer, radius: resultMode === "heat" ? Math.max(12, Math.abs(point.velocity) * 2.2) : selectedPoint ? 9 : 6,
        color: selectedPoint ? "#132e36" : "#ffffff", weight: selectedPoint ? 3 : 2,
        fillColor: color, fillOpacity: resultMode === "heat" ? 0.38 : 0.9, opacity: opacity / 100,
      }).addTo(group);
      marker.bindTooltip(`<b>${point.name}</b><br>${point.velocity > 0 ? "+" : ""}${point.velocity} mm/yr`, { direction: "top", offset: [0, -7] });
      marker.on("click", () => onSelect(point));
      markersRef.current.set(point.id, marker);
    });
    if (labelsLayerRef.current) labelsLayerRef.current.bringToFront?.();
  }, [points, selected, visible, resultMode, opacity]);

  useEffect(() => {
    const marker = markersRef.current.get(selected.id);
    if (marker && mapRef.current) mapRef.current.panTo(marker.getLatLng(), { animate: true, duration: 0.35 });
  }, [selected]);

  return (
    <section className="map-stage" aria-label="北京市形变速率 WebGIS 地图">
      <div ref={hostRef} className="leaflet-map" />
      <div className="basemap-switcher">
        {(Object.keys(BASES) as BaseKey[]).map((key) => <button key={key} className={base === key ? "active" : ""} onClick={() => setBase(key)}><i className={`base-thumb ${key}`} /><span>{BASES[key].label}<small>{BASES[key].sub}</small></span></button>)}
      </div>
      <div className={layerOpen ? "layer-manager open" : "layer-manager"}>
        <button className="layer-heading" onClick={() => setLayerOpen(!layerOpen)}><span>图层</span><i>▦</i></button>
        <div className="layer-body">
          <label><input type="checkbox" checked={baseVisible} onChange={(event) => setBaseVisible(event.target.checked)} /><i className="layer-symbol basemap" /><span>{base === "imagery" ? "Esri World Imagery" : BASES[base].label + " 底图"}</span></label>
          <label><input type="checkbox" checked={resultVisible} onChange={(event) => setResultVisible(event.target.checked)} /><i className="layer-symbol result" /><span>年均形变速率</span><b>{points.length}</b></label>
          <label><input type="checkbox" checked={boundaryVisible} onChange={(event) => setBoundaryVisible(event.target.checked)} /><i className="layer-symbol boundary" /><span>数据外包范围</span></label>
          <div className="layer-opacity"><span>结果透明度</span><b>{opacity}%</b><input type="range" min="20" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></div>
        </div>
      </div>
      <div className="result-mode"><button className={resultMode === "points" ? "active" : ""} onClick={() => setResultMode("points")}>PS 点</button><button className={resultMode === "heat" ? "active" : ""} onClick={() => setResultMode("heat")}>形变模式</button></div>
      <div className="map-legend"><strong>LOS 年均形变速率</strong><i /><div><span>−30</span><span>−15</span><span>0</span><span>+15</span><span>+30</span></div><small>mm / yr</small></div>
      <div className="coordinate">EPSG:3857　{cursor.lng.toFixed(5)}° E · {cursor.lat.toFixed(5)}° N　|　Z {zoom}</div>
      {tileError && <div className="tile-error">{tileError}</div>}
    </section>
  );
}
