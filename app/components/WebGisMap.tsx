"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InsarPoint } from "../data/site";
import { colorForMode, deformationModeOrder, normalizedMode, type AnalysisMapView } from "../lib/analysis-context";
import { geometryBounds, pointInPolygon, type AoiCoordinate, type AoiGeometry } from "../lib/aoi-analysis";
import { SpatialGridIndex } from "../lib/spatial-analysis";
import { FullPointLayer, pointDataBounds, queryNearestPoint, queryPointHits, type FullPointRendererStatus } from "../lib/full-point-layer";
import type { AnomalyRegion } from "../lib/anomaly-regions";
import type { GisLayer } from "../lib/gis-layer";
import type { FieldObservation } from "../lib/field-observation";
import type { RoadOpsRouteMapPlan } from "../lib/roadops-route";
import type { FieldTaskRouteMapStop } from "../lib/roadops-task-map";
import { fieldMarkerBadge, groupCoincidentFieldMarkers } from "../lib/roadops-task-markers";
import { sampleRouteDirectionArrows } from "../lib/roadops-map-guidance";
import { renderValue, type RenderStyle } from "../lib/insar-v2";
import { filterPointsForModes, filterPointsForPattern, formatFiniteValue, patternPointOpacity, type PatternVisibility } from "../lib/v2-map-analysis";

type Visible={points:boolean;boundary:boolean;risk:boolean;quality:boolean};
type SelectionMode="single"|"compare"|"compareBox"|"box"|"polygon";
type NavigationMapDetails = {
  navigationActiveLegId?: string | null;
  onNavigationLegSelect?: (id: string) => void;
  navigationTargetPoints?: { id: string; name: string; coordinate: [number, number]; vehicleCoordinate: [number, number] | null; visitId?: string; taskId?: string }[];
};
type NavigationMapPoint = {
  id: string; name: string; coordinate: [number, number]; role: "origin" | "destination" | "candidate"; index: number;
  visitId?: string; taskIds?: string[]; taskNames?: string[]; taskCount?: number;
};
type Props=NavigationMapDetails & {navigationActive?:boolean;navigationPicking?:boolean;navigationPoints?:{id:string;name:string;coordinate:[number,number];role:"origin"|"destination"|"candidate";index:number}[];onNavigationPick?:(coordinate:[number,number])=>void;points:InsarPoint[];livePascPoints:InsarPoint[];selected:InsarPoint|null;onSelect:(p:InsarPoint)=>void;onBoxSelect:(p:InsarPoint[],bounds:[number,number,number,number])=>void;onPolygonSelect:(p:InsarPoint[],bounds:[number,number,number,number],coordinates:AoiCoordinate[])=>void;onAnomalyRegionSelect:(region:AnomalyRegion)=>void;onViewChange:(view:AnalysisMapView)=>void;visible:Visible;base:string;tdtKey:string;customBasemap:string;baseOpacity:number;pointSize:number;onEditStyle:()=>void;swipeEnabled:boolean;coherenceThreshold:number;priorityPointIds:string[];priorityLimitedPointIds:string[];layoutToken:string;renderStyle:RenderStyle;patternVisibility:PatternVisibility;hiddenModes:string[];filteredPointIds:string[]|null;onToggleMode:(mode:string)=>void;onShowAllModes:()=>void;compareIds:string[];boxIds:string[];selectionMode:SelectionMode;highlightKind:"region"|"filter"|"anomaly";selectionGeometry:AoiGeometry|null;anomalyRegions:AnomalyRegion[];activeAnomalyRegionId:string|null;initialView:AnalysisMapView|null;focusBounds:[number,number,number,number]|null;focusToken:number;gisLayers:GisLayer[];activeGisFeatureId:string|null;onGisFeatureSelect:(layerId:string,featureId:string)=>void;roadOpsRoutePlan:RoadOpsRouteMapPlan|null;fieldObservations:FieldObservation[];activeFieldObservationId:string|null;onFieldObservationSelect:(observation:FieldObservation)=>void;onFieldPhotoOpen:(visitId:string,photoId:string)=>void};
const tdtUrl=(layer:string,key:string)=>`https://t{s}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${encodeURIComponent(key)}`;
const attributeLabel=(style:RenderStyle)=>style.attribute==="velocity"?"年均形变速率":style.attribute==="displacement"?"当前期累计形变量":style.attribute==="stageVelocity"?"时间区间阶段速率":style.attribute==="mode"?"形变模式":style.attribute==="coherence"?"相干性":"缺测率";


const osmRoadLabel=(properties:Record<string,unknown>)=>{const osmType=String(properties.osm_type??"way"),osmId=String(properties.osm_id??"—"),name=String(properties.name??properties.ref??"未命名道路"),highway=String(properties.highway??"road");return `OSM ${osmType}/${osmId} · ${name} · highway=${highway}`};
type SwipeRuntime={hostElement:HTMLDivElement};
function MapSwipeOverlay({hostElement,visible,available,enabled,onSwipeChange}:{hostElement:HTMLDivElement|null;visible:boolean;available:boolean;enabled:boolean;onSwipeChange:(active:boolean,position:number)=>void}){
  const [position,setPosition]=useState(50),active=enabled&&available&&visible;
  useEffect(()=>{onSwipeChange(active,position)},[active,position,onSwipeChange]);
  const updatePosition=(clientX:number)=>{const rect=hostElement?.getBoundingClientRect();if(!rect||!rect.width)return;setPosition(Math.max(4,Math.min(96,((clientX-rect.left)/rect.width)*100)))};
  const moveByKey=(key:string)=>{if(key==="ArrowLeft")setPosition(value=>Math.max(4,value-2));else if(key==="ArrowRight")setPosition(value=>Math.min(96,value+2));else if(key==="Home")setPosition(4);else if(key==="End")setPosition(96);else return false;return true};
  return <>{active&&<><span className="map-swipe-side-label is-velocity">左 · 年均速率</span><span className="map-swipe-side-label is-mode">右 · 形变模式</span><div className="map-swipe-divider" style={{left:`${position}%`}} role="slider" tabIndex={0} aria-label="速率与形变模式卷帘位置" aria-valuemin={4} aria-valuemax={96} aria-valuenow={Math.round(position)} aria-valuetext={`左侧速率 ${Math.round(position)}%，右侧形变模式 ${Math.round(100-position)}%`} onPointerDown={event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);updatePosition(event.clientX)}} onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))updatePosition(event.clientX)}} onPointerUp={event=>event.currentTarget.releasePointerCapture(event.pointerId)} onKeyDown={event=>{if(moveByKey(event.key))event.preventDefault()}}><span aria-hidden="true">↔</span></div></>}</>;
}
export default function WebGisMap({navigationActive=false,navigationPicking=false,navigationPoints=[],navigationActiveLegId=null,onNavigationLegSelect,navigationTargetPoints=[],onNavigationPick,points,livePascPoints,selected,onSelect,onBoxSelect,onPolygonSelect,onAnomalyRegionSelect,onViewChange,visible,base,tdtKey,customBasemap,baseOpacity,pointSize,onEditStyle,swipeEnabled,coherenceThreshold,priorityPointIds,priorityLimitedPointIds,layoutToken,renderStyle,patternVisibility,hiddenModes,filteredPointIds,onToggleMode,onShowAllModes,compareIds,boxIds,selectionMode,highlightKind,selectionGeometry,anomalyRegions,activeAnomalyRegionId,initialView,focusBounds,focusToken,gisLayers,activeGisFeatureId,onGisFeatureSelect,roadOpsRoutePlan,fieldObservations,activeFieldObservationId,onFieldObservationSelect,onFieldPhotoOpen}:Props){
  const host=useRef<HTMLDivElement>(null),map=useRef<any>(null),Lref=useRef<any>(null),baseLayers=useRef<any[]>([]),pointLayer=useRef<FullPointLayer|null>(null),anomalyRegionLayer=useRef<any>(null),gisLayerGroup=useRef<any>(null),roadRouteLayer=useRef<any>(null),navigationDraftLayer=useRef<import("leaflet").LayerGroup|null>(null),fieldObservationLayer=useRef<any>(null),boundary=useRef<any>(null),lastExtent=useRef<[number,number,number,number]|null>(null),boxRect=useRef<any>(null),savedBoxRect=useRef<any>(null),polygonDraft=useRef<any>(null),polygonVertices=useRef<AoiCoordinate[]>([]),cursorFrame=useRef(0),initialViewApplied=useRef(false),callbacks=useRef({points,index:null as SpatialGridIndex<InsarPoint>|null,liveIndex:null as SpatialGridIndex<InsarPoint>|null,onBoxSelect,onPolygonSelect,onSelect,onViewChange,selectionMode,navigationActive,navigationPicking,onNavigationPick,renderStyle,pointSize,hitVisible:(point:InsarPoint)=>Number.isFinite(point.lon)});const [cursor,setCursor]=useState("移动鼠标查看经纬度"),[ready,setReady]=useState(false),[swipeRuntime,setSwipeRuntime]=useState<SwipeRuntime|null>(null),[pointRendererStatus,setPointRendererStatus]=useState<FullPointRendererStatus>("webgl");
  const pointCandidatesPopup = useRef<import("leaflet").Popup | null>(null);
  const routeLegLayers = useRef(new Map<string, import("leaflet").Polyline>());
  const refreshRouteArrows = useRef<(() => void) | null>(null);
  const navigationDetails = useRef({ navigationActiveLegId, onNavigationLegSelect, navigationPicking });
  useEffect(() => {
    navigationDetails.current = { navigationActiveLegId, onNavigationLegSelect, navigationPicking };
  }, [navigationActiveLegId, onNavigationLegSelect, navigationPicking]);
  const legendPoints=useMemo(()=>{const allowed=filteredPointIds?new Set(filteredPointIds):null;const patterned=patternVisibility==="all"?points:filterPointsForPattern(points,patternVisibility);return allowed?patterned.filter(point=>allowed.has(point.id)):patterned},[points,patternVisibility,filteredPointIds]);
  const displayPoints=useMemo(()=>hiddenModes.length?filterPointsForModes(legendPoints,hiddenModes):legendPoints,[legendPoints,hiddenModes]);
  const spatialIndex=useMemo(()=>new SpatialGridIndex<InsarPoint>().load(displayPoints),[displayPoints]);
  const liveIndex=useMemo(()=>new SpatialGridIndex<InsarPoint>().load(livePascPoints),[livePascPoints]);
  const priorityPointIdSet=useMemo(()=>new Set(priorityPointIds),[priorityPointIds]);
  const priorityLimitedPointIdSet=useMemo(()=>new Set(priorityLimitedPointIds),[priorityLimitedPointIds]);
  const presentModes=useMemo(()=>{const found=new Set<string>(legendPoints.map(point=>normalizedMode(point.mode)));return [...deformationModeOrder,"Stepwise（旧版，待确认）","未分类"].filter(mode=>found.has(mode))},[legendPoints]);
  const modeCounts=useMemo(()=>{const counts:Record<string,number>={};for(const point of legendPoints){const mode=normalizedMode(point.mode);counts[mode]=(counts[mode]||0)+1}return counts},[legendPoints]);
  const hitVisible=useMemo(()=>(point:InsarPoint)=>visible.points||(visible.risk&&priorityPointIdSet.has(point.id))||(visible.quality&&((point.coherence>0&&point.coherence<coherenceThreshold)||point.missingRate>.2)),[visible,priorityPointIdSet,coherenceThreshold]);
  callbacks.current={points:displayPoints,index:spatialIndex,liveIndex,onBoxSelect,onPolygonSelect,onSelect,onViewChange,selectionMode,navigationActive,navigationPicking,onNavigationPick,renderStyle,pointSize,hitVisible};
  useEffect(()=>{let dead=false;import("leaflet").then(mod=>{
    if(dead||!host.current)return;
    const L=mod.default;Lref.current=L;
    const m=L.map(host.current,{center:[20.04,110.33],zoom:12,zoomControl:false,preferCanvas:true,boxZoom:false,doubleClickZoom:false,zoomSnap:.25,zoomDelta:.5,wheelPxPerZoomLevel:180});map.current=m;
    pointLayer.current=new FullPointLayer(m,setPointRendererStatus);
    L.control.zoom({position:"bottomright"}).addTo(m);
    const tooltip=L.tooltip({direction:"top",offset:[0,-8]});
    let hoveredId:string|null=null;let hoveredStyle:RenderStyle|null=null;let hoveredPoints:InsarPoint[]|null=null;
    const closeHover=()=>{hoveredId=null;if(m.hasLayer(tooltip))m.removeLayer(tooltip);pointLayer.current?.setHover(null)};
    const nearest=(latlng:import("leaflet").LatLng)=>{
      const pixel=m.latLngToContainerPoint(latlng),nw=m.containerPointToLatLng([pixel.x-18,pixel.y-18]),se=m.containerPointToLatLng([pixel.x+18,pixel.y+18]),bounds={west:Math.min(nw.lng,se.lng),east:Math.max(nw.lng,se.lng),south:Math.min(nw.lat,se.lat),north:Math.max(nw.lat,se.lat)},project=(point:InsarPoint)=>m.latLngToContainerPoint([point.lat,point.lon]);
      const live=callbacks.current.liveIndex?queryNearestPoint(callbacks.current.liveIndex,bounds,pixel,project):null;
      const base=callbacks.current.index?queryNearestPoint(callbacks.current.index,bounds,pixel,project,18,callbacks.current.hitVisible):null;
      if(!live)return base;if(!base)return live;
      return pixel.distanceTo(project(live))<=pixel.distanceTo(project(base))?live:base;
    };
    const queryHits=(latlng:import("leaflet").LatLng)=>{
      const pixel=m.latLngToContainerPoint(latlng),nw=m.containerPointToLatLng([pixel.x-18,pixel.y-18]),se=m.containerPointToLatLng([pixel.x+18,pixel.y+18]);
      const bounds={west:Math.min(nw.lng,se.lng),east:Math.max(nw.lng,se.lng),south:Math.min(nw.lat,se.lat),north:Math.max(nw.lat,se.lat)},project=(point:InsarPoint)=>m.latLngToContainerPoint([point.lat,point.lon]);
      const base=callbacks.current.index?queryPointHits(callbacks.current.index,bounds,pixel,project,18,callbacks.current.hitVisible):[],live=callbacks.current.liveIndex?queryPointHits(callbacks.current.liveIndex,bounds,pixel,project):[];
      const byId=new Map<string,InsarPoint>();for(const point of live)byId.set(point.id,point);for(const point of base)if(!byId.has(point.id))byId.set(point.id,point);
      return Array.from(byId.values()).map(point=>({point,distance:pixel.distanceTo(project(point))})).sort((a,b)=>a.distance-b.distance).map(hit=>hit.point);
    };
    const showCandidates=(latlng:import("leaflet").LatLng,hits:InsarPoint[])=>{
      pointCandidatesPopup.current?.remove();pointCandidatesPopup.current=null;
      if(hits.length<2)return;
      closeHover();
      const content=document.createElement("div"),heading=document.createElement("b"),list=document.createElement("div"),controls=document.createElement("div");
      content.className="map-point-candidates";content.style.cssText="min-width:230px;max-width:340px";
      heading.textContent=`此处命中 ${hits.length.toLocaleString()} 个点`;heading.style.display="block";
      const hint=document.createElement("p");hint.textContent="已默认选择最近点，可按真实 ID 切换。";hint.style.margin="6px 0";
      list.style.cssText="display:grid;gap:4px;max-height:290px;overflow:auto";
      controls.style.cssText="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px";
      const previous=document.createElement("button"),next=document.createElement("button"),pageLabel=document.createElement("span");
      previous.type="button";next.type="button";previous.textContent="上一页";next.textContent="下一页";
      controls.append(previous,pageLabel,next);content.append(heading,hint,list,controls);
      const sourceStyle=callbacks.current.renderStyle,pageCount=Math.ceil(hits.length/20);let page=0;
      const renderPage=()=>{
        list.replaceChildren();
        for(let i=page*20;i<Math.min(hits.length,(page+1)*20);i+=1){
          const point=hits[i],button=document.createElement("button");button.type="button";button.textContent=`ID: ${point.id}`;
          button.dataset.pointId=point.id;button.style.cssText="text-align:left;padding:5px 8px;overflow-wrap:anywhere";
          button.addEventListener("click",()=>{
            const bounds={west:point.lon,east:point.lon,south:point.lat,north:point.lat};
            const currentPoint=callbacks.current.liveIndex?.queryBounds(bounds).find(candidate=>candidate.id===point.id)??callbacks.current.index?.queryBounds(bounds).find(candidate=>candidate.id===point.id);
            if(currentPoint!==point||(!callbacks.current.hitVisible(point)&&!callbacks.current.liveIndex?.queryBounds(bounds).includes(point))||callbacks.current.renderStyle!==sourceStyle||callbacks.current.navigationActive||!["single","compare"].includes(callbacks.current.selectionMode)){
              pointCandidatesPopup.current?.remove();pointCandidatesPopup.current=null;return;
            }
            callbacks.current.onSelect(point);hint.textContent=`已选择 ID: ${point.id}`;
          });list.append(button);
        }
        previous.disabled=page===0;next.disabled=page===pageCount-1;pageLabel.textContent=`${page+1} / ${pageCount} 页`;
      };
      previous.addEventListener("click",()=>{if(page>0){page-=1;renderPage();}});next.addEventListener("click",()=>{if(page<pageCount-1){page+=1;renderPage();}});
      L.DomEvent.disableClickPropagation(content);L.DomEvent.disableScrollPropagation(content);renderPage();
      pointCandidatesPopup.current=L.popup({maxWidth:380,autoPan:false}).setLatLng(latlng).setContent(content).openOn(m);
    };
    const emitView=()=>{const center=m.getCenter(),bounds=m.getBounds();callbacks.current.onViewChange({center:[center.lat,center.lng],zoom:m.getZoom(),bounds:[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()]})};
    m.on("moveend",emitView);m.on("zoomend",emitView);
    m.on("mousemove",(e:import("leaflet").LeafletMouseEvent)=>{if(cursorFrame.current)return;cursorFrame.current=requestAnimationFrame(()=>{
      cursorFrame.current=0;setCursor(`${e.latlng.lng.toFixed(6)}° E · ${e.latlng.lat.toFixed(6)}° N`);
      if(callbacks.current.navigationActive||!["single","compare"].includes(callbacks.current.selectionMode)){closeHover();return}
      const point=nearest(e.latlng);if(!point){closeHover();return}
      pointLayer.current?.setHover(point,callbacks.current.pointSize+3);
      if(hoveredId!==point.id||hoveredStyle!==callbacks.current.renderStyle||hoveredPoints!==callbacks.current.points){
        const content=document.createElement("div"),title=document.createElement("b");title.textContent=`ID: ${point.id}`;content.append(title);
        const confidence=point.modeConfidence,style=callbacks.current.renderStyle,value=renderValue(point,style);
        for(const text of [`Vel: ${formatFiniteValue(point.velocity)} mm/yr`,`Mode: ${normalizedMode(point.mode)}`,`Confidence: ${confidence!==null&&confidence!==undefined&&Number.isFinite(confidence)?(confidence*100).toFixed(1)+"%":"--"}`,`${attributeLabel(style)}: ${style.attribute==="mode"?normalizedMode(point.mode):formatFiniteValue(value)}`]){content.append(document.createElement("br"),document.createTextNode(text))}
        tooltip.setContent(content);hoveredId=point.id;hoveredStyle=callbacks.current.renderStyle;hoveredPoints=callbacks.current.points;
      }
      tooltip.setLatLng([point.lat,point.lon]);if(!m.hasLayer(tooltip))tooltip.addTo(m);
    })});
    m.on("mouseout",()=>{setCursor("移动鼠标查看经纬度");closeHover()});m.on("movestart",closeHover);
    m.on("click",(e:import("leaflet").LeafletMouseEvent)=>{
      if(callbacks.current.navigationActive){if(callbacks.current.navigationPicking&&e.originalEvent?.detail!==2)callbacks.current.onNavigationPick?.([e.latlng.lng,e.latlng.lat]);return}
      if(["box","compareBox","polygon"].includes(callbacks.current.selectionMode))return;
      const hits=queryHits(e.latlng);if(hits[0])callbacks.current.onSelect(hits[0]);showCandidates(e.latlng,hits);
    });
    emitView();setSwipeRuntime({hostElement:host.current});setReady(true);
  });return()=>{dead=true;if(cursorFrame.current)cancelAnimationFrame(cursorFrame.current);pointLayer.current?.destroy();pointLayer.current=null;map.current?.remove();map.current=null}},[]);
  useEffect(()=>{pointCandidatesPopup.current?.remove();pointCandidatesPopup.current=null},[displayPoints,livePascPoints,selectionMode,navigationActive,renderStyle,hitVisible]);  useEffect(()=>{const L=Lref.current,m=map.current;if(!L||!m)return;baseLayers.current.forEach(layer=>m.removeLayer(layer));baseLayers.current=[];const add=(url:string,options:any)=>{const layer=L.tileLayer(url,{crossOrigin:true,opacity:baseOpacity,...options}).addTo(m);baseLayers.current.push(layer)};if(base==="custom"&&customBasemap) add(customBasemap,{attribution:"Custom XYZ / WMTS",maxZoom:20});else if(base==="esri")add("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{attribution:"Tiles © Esri",maxZoom:18});else if(base==="gray")add("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",{attribution:"Tiles © Esri",maxZoom:16});else if(base.startsWith("tdt")&&tdtKey){const imagery=base==="tdt_img";add(tdtUrl(imagery?"img":"vec",tdtKey),{subdomains:"01234567",attribution:"© 天地图",maxZoom:18});add(tdtUrl(imagery?"cia":"cva",tdtKey),{subdomains:"01234567",attribution:"© 天地图注记",maxZoom:18})}else add("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap contributors",maxZoom:19})},[base,tdtKey,customBasemap,baseOpacity,ready]);
  useEffect(()=>{
    if(!ready||!pointLayer.current)return;
    pointLayer.current.update({points:displayPoints,index:spatialIndex,livePoints:livePascPoints,renderStyle,pointSize,coherenceThreshold,visible,priorityIds:priorityPointIdSet,limitedIds:priorityLimitedPointIdSet,boxIds:new Set(boxIds),compareIds:new Set(compareIds),selectedId:selected?.id??null,highlightKind});
  },[displayPoints,spatialIndex,livePascPoints,renderStyle,pointSize,coherenceThreshold,visible,priorityPointIdSet,priorityLimitedPointIdSet,boxIds,compareIds,selected,highlightKind,ready]);
  useEffect(()=>{
    const L=Lref.current,m=map.current;if(!L||!m)return;
    if(boundary.current)m.removeLayer(boundary.current);boundary.current=null;
    const extent=pointDataBounds(points);if(!extent)return;
    const [west,south,east,north]=extent,bounds=L.latLngBounds([[south,west],[north,east]]);
    boundary.current=L.rectangle(bounds.pad(.04),{color:"#1677ff",weight:1.5,dashArray:"6 5",fill:false,interactive:false});
    if(visible.boundary)boundary.current.addTo(m);
    if(!lastExtent.current||extent.some((value,index)=>value!==lastExtent.current![index])){if(initialView)m.setView(initialView.center,initialView.zoom,{animate:false});else m.fitBounds(bounds.pad(.16),{maxZoom:14,animate:true});lastExtent.current=extent}
  },[points,visible.boundary,initialView,ready]);
  useEffect(()=>{const m=map.current;if(!ready||!m||!initialView||initialViewApplied.current)return;initialViewApplied.current=true;m.setView(initialView.center,initialView.zoom,{animate:false})},[initialView,ready]);
  useEffect(()=>{const L=Lref.current,m=map.current;if(!L||!m)return;if(anomalyRegionLayer.current)m.removeLayer(anomalyRegionLayer.current);anomalyRegionLayer.current=L.layerGroup();anomalyRegions.forEach(region=>{const active=region.id===activeAnomalyRegionId,latLngs=region.geometry.coordinates.map(([longitude,latitude])=>[latitude,longitude]),polygon=L.polygon(latLngs,{color:active?"#0b6fdc":"#6a9fd1",weight:active?2.8:1.5,dashArray:active?undefined:"6 5",fillColor:"#1677ff",fillOpacity:active?.12:.025,bubblingMouseEvents:true});const tooltip=document.createElement("div");const title=document.createElement("b"),detail=document.createElement("span");title.textContent=`自动空间分组 ${region.id} · ${region.pointCount} 点`;detail.textContent=`规则聚类 · 平均速率 ${region.meanVelocity.toFixed(1)} mm/yr · ${region.dominantMode}`;tooltip.append(title,document.createElement("br"),detail);polygon.bindTooltip(tooltip);polygon.on("click",()=>onAnomalyRegionSelect(region));polygon.addTo(anomalyRegionLayer.current)});if(anomalyRegions.length)anomalyRegionLayer.current.addTo(m);return()=>{if(anomalyRegionLayer.current)m.removeLayer(anomalyRegionLayer.current)}},[anomalyRegions,activeAnomalyRegionId,onAnomalyRegionSelect,ready]);
  useEffect(()=>{const L=Lref.current,m=map.current,region=anomalyRegions.find(item=>item.id===activeAnomalyRegionId);if(!L||!m||!region)return;const [west,south,east,north]=region.bounds;m.fitBounds([[south,west],[north,east]],{padding:[48,48],maxZoom:17,animate:true})},[activeAnomalyRegionId,anomalyRegions,ready]);
  useEffect(()=>{const L=Lref.current,m=map.current;if(!L||!m)return;if(gisLayerGroup.current)m.removeLayer(gisLayerGroup.current);gisLayerGroup.current=L.layerGroup();const renderer=L.canvas({padding:.5,tolerance:8}),colors={generic:"#6d5bd0",road:"#ef7d00",landslide:"#c83245"};gisLayers.filter(layer=>layer.visible).forEach(layer=>{const color=layer.provenance?.kind==="osm"?"#087e8b":colors[layer.role];const vector=L.geoJSON({type:"FeatureCollection",features:layer.features} as any,{style:(feature:any)=>({renderer,color,weight:feature?.id===activeGisFeatureId?5:layer.provenance?.kind==="osm"?2.6:layer.role==="road"?3:2,opacity:layer.opacity,fillColor:color,fillOpacity:layer.role==="landslide"?layer.opacity*.28:layer.opacity*.12,bubblingMouseEvents:false}),pointToLayer:(_:any,latlng:any)=>L.circleMarker(latlng,{renderer,radius:6,color,weight:2,fillColor:color,fillOpacity:layer.opacity,bubblingMouseEvents:false}),onEachFeature:(feature:any,shape:any)=>{const content=document.createElement("div"),title=document.createElement("b"),detail=document.createElement("span"),properties=feature.properties??{};title.textContent=layer.name;detail.textContent=layer.provenance?.kind==="osm"?osmRoadLabel(properties):Object.entries(properties).slice(0,3).map(([key,value])=>key+": "+String(value)).join(" · ")||feature.geometry?.type||"GIS 要素";content.append(title,document.createElement("br"),detail);shape.bindTooltip(content);shape.on("click",()=>onGisFeatureSelect(layer.id,String(feature.id)))}});vector.addTo(gisLayerGroup.current)});if(gisLayers.some(layer=>layer.visible))gisLayerGroup.current.addTo(m);return()=>{if(gisLayerGroup.current)m.removeLayer(gisLayerGroup.current)}},[gisLayers,activeGisFeatureId,onGisFeatureSelect,ready]);
  useEffect(() => {
    const L = Lref.current as typeof import("leaflet") | null, m = map.current as import("leaflet").Map | null;
    if (!L || !m) return;
    if (roadRouteLayer.current) m.removeLayer(roadRouteLayer.current);
    roadRouteLayer.current = null;
    routeLegLayers.current.clear();
    if (!roadOpsRoutePlan || !roadOpsRoutePlan.features.length) return;
    const group = L.layerGroup(), arrows = L.layerGroup().addTo(group);
    const stopNames = new Map(roadOpsRoutePlan.stops.map(stop => [stop.id, stop.name]));
    roadOpsRoutePlan.features.forEach((feature, index) => {
      const coordinates = feature.geometry.coordinates.map(([longitude, latitude]) => L.latLng(latitude, longitude));
      L.polyline(coordinates, { color: "#ffffff", weight: 9, opacity: .95, interactive: false }).addTo(group);
      const line = L.polyline(coordinates, {
        color: "#0756c9", weight: 5, opacity: .96, lineCap: "round", lineJoin: "round",
        interactive: navigationActive, bubblingMouseEvents: true,
        dashArray: roadOpsRoutePlan.mode === "didi_live" || (feature.properties.legIndex ?? 0) % 2 === 0 ? undefined : "12 5",
      }).addTo(group);
      const tooltip = document.createElement("div"), heading = document.createElement("b"), detail = document.createElement("span");
      const legIndex = feature.properties.legIndex ?? index + 1;
      heading.textContent = `第 ${legIndex} 段 · ${stopNames.get(feature.properties.from) ?? feature.properties.from} → ${stopNames.get(feature.properties.to) ?? feature.properties.to}`;
      detail.textContent = `${(feature.properties.distanceMeters / 1000).toFixed(1)} km · ${Math.ceil(feature.properties.durationSeconds / 60)} 分钟 · 点击查看此段`;
      tooltip.append(heading, document.createElement("br"), detail);
      line.bindTooltip(tooltip, { sticky: true });
      line.on("click", () => {
        if (!navigationDetails.current.navigationPicking) navigationDetails.current.onNavigationLegSelect?.(feature.id);
      });
      routeLegLayers.current.set(feature.id, line);
    });
    const drawArrows = () => {
      arrows.clearLayers();
      if (!navigationActive || roadOpsRoutePlan.mode !== "didi_live") return;
      const size = m.getSize(), requestedId = navigationDetails.current.navigationActiveLegId;
      const activeId = requestedId && routeLegLayers.current.has(requestedId) ? requestedId : null;
      let remaining = 60;
      roadOpsRoutePlan.features.forEach(feature => {
        if (remaining <= 0 || (activeId && feature.id !== activeId)) return;
        const screenPoints = feature.geometry.coordinates.map(([longitude, latitude]) => m.latLngToContainerPoint([latitude, longitude]));
        const samples = sampleRouteDirectionArrows(screenPoints, { width: size.x, height: size.y }, 110, remaining);
        remaining -= samples.length;
        samples.forEach(sample => {
          const chevron = document.createElement("span");
          chevron.setAttribute("aria-hidden", "true");
          chevron.style.cssText = `display:block;width:9px;height:9px;margin:4px;border-top:2.5px solid white;border-right:2.5px solid white;filter:drop-shadow(0 0 1px #0756c9);transform:rotate(${sample.angleDegrees + 45}deg)`;
          const icon = L.divIcon({ className: "road-direction-arrow", html: chevron, iconSize: [18, 18], iconAnchor: [9, 9] });
          L.marker(m.containerPointToLatLng([sample.x, sample.y]), { icon, interactive: false, keyboard: false, zIndexOffset: -100 }).addTo(arrows);
        });
      });
    };
    refreshRouteArrows.current = drawArrows;
    m.on("moveend zoomend resize", drawArrows);
    groupCoincidentFieldMarkers(roadOpsRoutePlan.stops).forEach(({ coordinate, members }) => {
      const { kind, label } = fieldMarkerBadge(members);
      const pin = document.createElement("span");
      pin.className = `road-route-pin route-${kind}${members.some(stop => stop.required) ? " is-required" : ""}`;
      pin.textContent = label;
      if (label === "起/返") pin.style.fontSize = "11px";
      if (navigationActive && kind === "start") pin.style.background = "#176bd8";
      const icon = L.divIcon({ className: "road-route-leaflet-icon", html: pin, iconSize: [34, 40], iconAnchor: [17, 35] });
      const names = members.map(stop => stop.name).join("；");
      const marker = L.marker([coordinate[1], coordinate[0]], { icon, interactive: true, bubblingMouseEvents: true, riseOnHover: true, title: names, alt: `${label} · ${names}` });
      const tooltip = document.createElement("div");
      tooltip.style.cssText = "max-width:360px;white-space:normal;overflow-wrap:anywhere";
      members.forEach((rawStop, index) => {
        const stop = rawStop as typeof rawStop & Partial<FieldTaskRouteMapStop>;
        const title = document.createElement("b"), detail = document.createElement("span"), roadName = document.createElement("span");
        if (index) tooltip.append(document.createElement("hr"));
        title.textContent = stop.name;
        detail.textContent = stop.markerRole === "waypoint" ? `第 ${stop.visitIndex} 次停靠${stop.required ? " · 必访" : ""}` : stop.markerRole === "start" ? "出发到访" : "最终到访";
        roadName.textContent = stop.sourceRoadName;
        tooltip.append(title, document.createElement("br"), detail, document.createElement("br"), roadName);
        if (stop.visitId) {
          const identity = document.createElement("small"); identity.textContent = `到访 ${stop.visitId}`;
          tooltip.append(document.createElement("br"), identity);
          stop.taskIds?.forEach((id, taskIndex) => {
            const task = document.createElement("span"); task.textContent = `${stop.taskNames?.[taskIndex] ?? "核查任务"} · ${id}`;
            tooltip.append(document.createElement("br"), task);
          });
        }
      });
      marker.bindTooltip(tooltip);
      marker.addTo(group);
    });
    group.addTo(m);
    roadRouteLayer.current = group;
    drawArrows();
    if (roadOpsRoutePlan.bounds) {
      const [west, south, east, north] = roadOpsRoutePlan.bounds;
      m.fitBounds([[south, west], [north, east]], { ...(navigationActive ? { paddingTopLeft: [60, Math.min(130, m.getSize().y / 4)], paddingBottomRight: [60, 65] } : { padding: [72, 72] }), maxZoom: 15, animate: true });
    }
    return () => {
      m.off("moveend zoomend resize", drawArrows);
      if (refreshRouteArrows.current === drawArrows) refreshRouteArrows.current = null;
      m.removeLayer(group);
    };
  }, [roadOpsRoutePlan, navigationActive, ready]);
  useEffect(() => {
    routeLegLayers.current.forEach((line, id) => {
      const activeId = navigationActiveLegId && routeLegLayers.current.has(navigationActiveLegId) ? navigationActiveLegId : null;
      const selected = navigationActive && id === activeId;
      const muted = navigationActive && Boolean(activeId) && !selected;
      line.setStyle({ color: muted ? "#8bafdb" : "#0756c9", weight: selected ? 7 : 5, opacity: muted ? .48 : .98 });
      if (selected) line.bringToFront();
    });
    refreshRouteArrows.current?.();
  }, [navigationActiveLegId, navigationActive, roadOpsRoutePlan, ready]);
  useEffect(() => {
    const L = Lref.current as typeof import("leaflet") | null, m = map.current as import("leaflet").Map | null;
    if (!L || !m || !navigationActive || !navigationTargetPoints.length) return;
    const group = L.layerGroup().addTo(m);
    groupCoincidentFieldMarkers(navigationTargetPoints).forEach(({ coordinate, members }) => {
      const target = L.latLng(coordinate[1], coordinate[0]), tooltip = document.createElement("div");
      tooltip.style.cssText = "max-width:360px;white-space:normal;overflow-wrap:anywhere";
      members.forEach((point, index) => {
        const title = document.createElement("b"), detail = document.createElement("span");
        if (index) tooltip.append(document.createElement("hr"));
        title.textContent = `${point.name} · 核查目标`;
        detail.textContent = point.vehicleCoordinate
          ? `与车辆位置直线间距 ${Math.round(m.distance(L.latLng(point.vehicleCoordinate[1], point.vehicleCoordinate[0]), target))} m；最后一段路径与进入条件待核验`
          : "车辆停靠位置尚未选择；最后一段路径与进入条件待核验";
        tooltip.append(title, document.createElement("br"), detail);
        if (point.taskId || point.visitId) {
          const identity = document.createElement("small"); identity.textContent = `到访 ${point.visitId ?? "—"} · 任务 ${point.taskId ?? point.id}`;
          tooltip.append(document.createElement("br"), identity);
        }
      });
      L.circleMarker(target, {
        radius: 6, color: "#176bd8", fillColor: "#edf4ff", fillOpacity: 1, weight: 2.5,
        interactive: !navigationPicking, bubblingMouseEvents: true,
      }).bindTooltip(tooltip).addTo(group);
    });
    return () => { m.removeLayer(group); };
  }, [navigationActive, navigationPicking, navigationTargetPoints, ready]);
  useEffect(() => {
    const L = Lref.current, m = map.current;
    if (!L || !m) return;
    if (navigationDraftLayer.current) m.removeLayer(navigationDraftLayer.current);
    navigationDraftLayer.current = null;
    if (!navigationActive || roadOpsRoutePlan || !navigationPoints.length) return;
    const group = L.layerGroup();
    groupCoincidentFieldMarkers(navigationPoints as NavigationMapPoint[]).forEach(({ coordinate, members }) => {
      const { kind, label } = fieldMarkerBadge(members);
      const pin = document.createElement("span");
      pin.className = `road-route-pin route-${kind}`;
      pin.textContent = label;
      if (label === "起/返") pin.style.fontSize = "11px";
      if (kind === "start") pin.style.background = "#176bd8";
      const icon = L.divIcon({ className: "road-route-leaflet-icon", html: pin, iconSize: [34, 40], iconAnchor: [17, 35] });
      const names = members.map(point => point.name).join("；");
      const marker = L.marker([coordinate[1], coordinate[0]], { icon, interactive: true, riseOnHover: true, title: names, alt: `${label} · ${names}` });
      const tooltip = document.createElement("div"); tooltip.style.cssText = "max-width:360px;white-space:normal;overflow-wrap:anywhere";
      members.forEach((point, index) => {
        const title = document.createElement("b"), coordinates = document.createElement("span");
        if (index) tooltip.append(document.createElement("hr"));
        title.textContent = point.name;
        coordinates.textContent = `${coordinate[0].toFixed(6)}, ${coordinate[1].toFixed(6)} · 尚无道路核验`;
        tooltip.append(title, document.createElement("br"), coordinates);
        if (point.visitId) {
          const identity = document.createElement("small"); identity.textContent = `到访 ${point.visitId}`;
          tooltip.append(document.createElement("br"), identity);
          point.taskIds?.forEach((id, taskIndex) => {
            const task = document.createElement("span"); task.textContent = `${point.taskNames?.[taskIndex] ?? "核查任务"} · ${id}`;
            tooltip.append(document.createElement("br"), task);
          });
        }
      });
      marker.bindTooltip(tooltip);
      marker.addTo(group);
    });
    group.addTo(m);
    navigationDraftLayer.current = group;
    return () => { m.removeLayer(group); };
  }, [navigationActive, navigationPoints, roadOpsRoutePlan, ready]);
  useEffect(()=>{const L=Lref.current,m=map.current;if(!L||!m)return;if(fieldObservationLayer.current)m.removeLayer(fieldObservationLayer.current);fieldObservationLayer.current=L.layerGroup();const zoomHandlers:(()=>void)[]=[];fieldObservations.forEach(observation=>{const active=observation.id===activeFieldObservationId,cover=observation.photos[0],primary=observation.links.find(link=>link.status==="confirmed-primary");const buildIcon=()=>{const zoom=m.getZoom(),baseSize=zoom<=7?20:zoom<=10?24:zoom<=13?28:32,size=baseSize+(active?4:0),content=document.createElement("span"),camera=document.createElement("b"),badge=document.createElement("i");content.className=`field-camera-pin${active?" active":""}${zoom<=10?" compact":""}`;content.style.setProperty("--field-camera-size",`${size}px`);camera.textContent="📷";camera.setAttribute("aria-hidden","true");badge.textContent=String(observation.photos.length);content.append(camera,badge);return L.divIcon({className:"field-photo-leaflet-icon",html:content,iconSize:[size,size+8],iconAnchor:[size/2,size+5],popupAnchor:[0,-size]})};const marker=L.marker([observation.latitude,observation.longitude],{icon:buildIcon(),riseOnHover:true}),card=document.createElement("article"),coverButton=document.createElement("button"),copy=document.createElement("div"),eyebrow=document.createElement("small"),title=document.createElement("b"),meta=document.createElement("span"),coordinates=document.createElement("em"),status=document.createElement("strong");card.className="field-map-photo-card";coverButton.type="button";coverButton.className="field-map-photo-cover";coverButton.title="点击放大现场照片";if(cover){const image=document.createElement("img");image.src=cover.photoUrl;image.alt=observation.name;coverButton.append(image);coverButton.addEventListener("click",event=>{event.stopPropagation();onFieldPhotoOpen(observation.id,cover.id)})}else{coverButton.disabled=true;coverButton.textContent="📷"}copy.className="field-map-photo-copy";eyebrow.textContent=`现场考察 · ${observation.photos.length} 张`;title.textContent=observation.name;meta.textContent=observation.capturedAt||"拍摄时间未提供";coordinates.textContent=`${observation.longitude.toFixed(6)}° E · ${observation.latitude.toFixed(6)}° N`;status.textContent=primary?`已关联 ${primary.insarPointId}`:"待确认 InSAR 监测点";copy.append(eyebrow,title,meta,coordinates,status);card.append(coverButton,copy);marker.bindPopup(card,{className:"field-map-photo-popup",closeButton:false,autoPan:false,offset:[0,-5],minWidth:278,maxWidth:310});marker.on("mouseover",()=>marker.openPopup());marker.on("click",()=>{onFieldObservationSelect(observation);marker.openPopup()});const handleZoom=()=>marker.setIcon(buildIcon());zoomHandlers.push(handleZoom);m.on("zoomend",handleZoom);marker.addTo(fieldObservationLayer.current)});if(fieldObservations.length)fieldObservationLayer.current.addTo(m);return()=>{zoomHandlers.forEach(handler=>m.off("zoomend",handler));if(fieldObservationLayer.current)m.removeLayer(fieldObservationLayer.current)}},[fieldObservations,activeFieldObservationId,onFieldObservationSelect,onFieldPhotoOpen,ready]);
  useEffect(()=>{const m=map.current;if(!ready||!m||!focusBounds||!focusToken)return;const [west,south,east,north]=focusBounds,center:[number,number]=[(south+north)/2,(west+east)/2];if(Math.abs(east-west)<1e-7&&Math.abs(north-south)<1e-7)m.setView(center,17,{animate:true});else m.fitBounds([[south,west],[north,east]],{...(navigationActive?{paddingTopLeft:[60,Math.min(130,m.getSize().y/4)],paddingBottomRight:[60,65]}:{padding:[58,58]}),maxZoom:17,animate:true})},[focusBounds,focusToken,ready,navigationActive]);
  useEffect(()=>{const L=Lref.current,m=map.current;if(!L||!m)return;let start:any=null,startPoint:any=null;const canDraw=()=>!navigationActive&&(selectionMode==="box"||selectionMode==="compareBox");const down=(e:any)=>{if(!canDraw()||e.originalEvent?.button)return;start=e.latlng;startPoint=m.latLngToContainerPoint(e.latlng);m.dragging.disable();if(boxRect.current)m.removeLayer(boxRect.current);boxRect.current=L.rectangle(L.latLngBounds(start,start),{color:"#1677ff",weight:1.5,dashArray:"5 4",fillColor:"#1677ff",fillOpacity:.08,interactive:false}).addTo(m)};const move=(e:any)=>{if(start&&boxRect.current)boxRect.current.setBounds(L.latLngBounds(start,e.latlng))};const up=(e:any)=>{if(!start||!startPoint)return;const bounds=L.latLngBounds(start,e.latlng),chosen=callbacks.current.index?.queryBounds({west:bounds.getWest(),south:bounds.getSouth(),east:bounds.getEast(),north:bounds.getNorth()})??[];callbacks.current.onBoxSelect(chosen,[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()]);if(savedBoxRect.current)m.removeLayer(savedBoxRect.current);savedBoxRect.current=L.rectangle(bounds,{color:"#1677ff",weight:2,dashArray:"6 5",fillColor:"#1677ff",fillOpacity:.06,interactive:false}).addTo(m);if(boxRect.current)m.removeLayer(boxRect.current);boxRect.current=null;start=null;startPoint=null;m.dragging.enable()};m.on("mousedown",down);m.on("mousemove",move);m.on("mouseup",up);return()=>{m.off("mousedown",down);m.off("mousemove",move);m.off("mouseup",up);if(boxRect.current)m.removeLayer(boxRect.current);m.dragging.enable()}},[selectionMode,navigationActive,ready]);
  useEffect(()=>{const L=Lref.current,m=map.current;if(!L||!m)return;const clearDraft=()=>{polygonVertices.current=[];if(polygonDraft.current){m.removeLayer(polygonDraft.current);polygonDraft.current=null}};if(navigationActive||selectionMode!=="polygon"){clearDraft();return}const drawPreview=(cursor?:AoiCoordinate)=>{if(polygonDraft.current)m.removeLayer(polygonDraft.current);const coordinates=cursor?[...polygonVertices.current,cursor]:polygonVertices.current;if(!coordinates.length)return;const latLngs=coordinates.map(([longitude,latitude])=>[latitude,longitude]);polygonDraft.current=(coordinates.length>=3?L.polygon(latLngs,{color:"#1677ff",weight:2,dashArray:"5 4",fillColor:"#1677ff",fillOpacity:.08,interactive:false}):L.polyline(latLngs,{color:"#1677ff",weight:2,dashArray:"5 4",interactive:false})).addTo(m)};const click=(event:any)=>{if(event.originalEvent?.detail>1)return;polygonVertices.current.push([event.latlng.lng,event.latlng.lat]);drawPreview()};const move=(event:any)=>{if(polygonVertices.current.length)drawPreview([event.latlng.lng,event.latlng.lat])};const finish=(event:any)=>{event.originalEvent?.preventDefault?.();if(polygonVertices.current.length<3)return;const coordinates=[...polygonVertices.current],bounds=geometryBounds({type:"polygon",coordinates}),chosen=(callbacks.current.index?.queryBounds({west:bounds[0],south:bounds[1],east:bounds[2],north:bounds[3]})??[]).filter(point=>pointInPolygon(point.lon,point.lat,coordinates));callbacks.current.onPolygonSelect(chosen,bounds,coordinates);clearDraft()};const cancel=(event?:any)=>{event?.originalEvent?.preventDefault?.();clearDraft()};const keydown=(event:KeyboardEvent)=>{if(event.key==="Escape")cancel()};m.on("click",click);m.on("mousemove",move);m.on("dblclick",finish);m.on("contextmenu",cancel);window.addEventListener("keydown",keydown);return()=>{m.off("click",click);m.off("mousemove",move);m.off("dblclick",finish);m.off("contextmenu",cancel);window.removeEventListener("keydown",keydown);clearDraft()}},[selectionMode,navigationActive,ready]);
  useEffect(()=>{const L=Lref.current,m=map.current;if(!L||!m)return;if(savedBoxRect.current){m.removeLayer(savedBoxRect.current);savedBoxRect.current=null}if(selectionGeometry){const latLngs=selectionGeometry.coordinates.map(([longitude,latitude])=>[latitude,longitude]);savedBoxRect.current=L.polygon(latLngs,{color:"#1677ff",weight:2,dashArray:"6 5",fillColor:"#1677ff",fillOpacity:.06,interactive:false}).addTo(m)}},[selectionGeometry,ready]);
  useEffect(()=>{const timer=window.setTimeout(()=>map.current?.invalidateSize({pan:false}),220);return()=>window.clearTimeout(timer)},[layoutToken]);
  useEffect(()=>{
    const node=host.current,instance=map.current;
    if(!node||!instance)return;
    let frame=0;
    const observer=new ResizeObserver(()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{if(node.clientWidth&&node.clientHeight)instance.invalidateSize({pan:false})});
    });
    observer.observe(node);
    return()=>{observer.disconnect();cancelAnimationFrame(frame)};
  },[ready]);
  const unit=renderStyle.attribute==="displacement"?"mm":renderStyle.attribute==="coherence"?"":renderStyle.attribute==="missing"?"%":"mm/yr",classified=renderStyle.attribute==="velocity"||renderStyle.attribute==="displacement"||renderStyle.attribute==="stageVelocity";
  return <section className={`gis-map selection-${selectionMode}`}><div ref={host} className="leaflet-host" style={{cursor:navigationActive&&navigationPicking?"crosshair":undefined}}/><MapSwipeOverlay onSwipeChange={(active,position)=>pointLayer.current?.setSwipe(active,position)} hostElement={swipeRuntime?.hostElement??null} visible={visible.points} available={!navigationActive&&(selectionMode==="single"||selectionMode==="compare")} enabled={swipeEnabled}/>{pointRendererStatus!=="webgl"&&<div role="status" style={{position:"absolute",left:12,bottom:46,zIndex:700,background:"#fff",padding:"5px 9px",borderRadius:6,fontSize:12}}>{pointRendererStatus==="canvas"?"Canvas 全量点绘制":"当前浏览器无法创建点绘制上下文，请重新打开地图或启用硬件加速"}</div>}<div className={`map-badge ${renderStyle.attribute==="mode"?"mode-map-badge":""}`}><span>{attributeLabel(renderStyle)}</span>{renderStyle.attribute==="mode"?<><small className="mode-visible-count">当前显示 {displayPoints.length.toLocaleString()} / {legendPoints.length.toLocaleString()} 点 · 点击类别开关</small><div className="mode-map-legend">{presentModes.map(mode=>{const hidden=hiddenModes.includes(mode);return <button type="button" aria-pressed={!hidden} className={hidden?"is-hidden":""} onClick={()=>onToggleMode(mode)} key={mode} title={`${hidden?"显示":"隐藏"}${mode}`}><i style={{background:colorForMode(mode),opacity:patternPointOpacity(mode)}}/><span>{mode}</span><em>{modeCounts[mode]?.toLocaleString()}</em></button>})}</div>{hiddenModes.length>0&&<button type="button" className="mode-show-all" onClick={onShowAllModes}>全部显示</button>}</>:<><i style={{background:`linear-gradient(90deg,${renderStyle.colors.join(",")})`}}/><small>{classified?`分级色带 · < ${renderStyle.min} · 每 ${renderStyle.interval} 分级 · > ${renderStyle.max} ${unit}`:`${renderStyle.min}　间距 ${renderStyle.interval}　${renderStyle.max} ${unit}`}</small></>}<button className="workspace-legend-edit" onClick={onEditStyle}>编辑样式</button></div>{livePascPoints.length>0&&<div className="map-live-classification" role="status"><i/><span>实时分类上图</span><b>{livePascPoints.length.toLocaleString()} 点</b></div>}{gisLayers.some(layer=>layer.visible&&layer.provenance?.kind==="osm")&&<div className="roadops-osm-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a><span>ODbL · 开源基线 / 非权威路网</span></div>}<div className="map-coordinates"><b>{cursor}</b><span>EPSG:4326 · WGS84</span></div>{!navigationActive&&selectionMode==="box"&&<div className="box-hint">在地图上拖动矩形进行区域统计</div>}{!navigationActive&&selectionMode==="polygon"&&<div className="box-hint">单击添加顶点 · 双击完成 · Esc 或右键取消</div>}{!navigationActive&&selectionMode==="compareBox"&&<div className="box-hint">矩形框选仅用于区域统计，点选多点用于曲线对比</div>}</section>
}
