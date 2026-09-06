"use client";

import Image from "next/image";
import type { InsarPoint } from "../data/site";
import type { FieldObservation, InsarCandidate } from "../lib/field-observation";

const sourceLabel = (source: FieldObservation["coordinateSource"]) => source === "exif" ? "照片 EXIF" : source === "watermark" ? "图片水印识别" : source === "map-center" ? "地图中心" : source === "csv" ? "坐标 CSV" : "用户填写";
const linkLabel = (status: InsarCandidate["status"]) => status === "confirmed-primary" ? "主关联" : status === "confirmed-secondary" ? "次关联" : status === "rejected" ? "已排除" : status === "stale" ? "需重核" : "候选";

export function FieldObservationEvidence({ observation, candidates, primaryPointId, activePhotoId, onSelectPhoto, onOpenPhoto, onRemovePhoto, onRadiusChange, onInspectCandidate, onConfirmCandidate, onRejectCandidate }: {
  observation: FieldObservation;
  candidates: InsarCandidate<InsarPoint>[];
  primaryPointId: string | null;
  activePhotoId: string | null;
  onSelectPhoto: (photoId: string) => void;
  onOpenPhoto: (photoId: string) => void;
  onRemovePhoto: (photoId: string) => void;
  onRadiusChange: (radius: number) => void;
  onInspectCandidate: (point: InsarPoint) => void;
  onConfirmCandidate: (point: InsarPoint) => void;
  onRejectCandidate: (point: InsarPoint) => void;
}) {
  const activePhoto = observation.photos.find(photo => photo.id === activePhotoId) ?? observation.photos[0] ?? null;
  const visibleCandidates = candidates.filter(candidate => candidate.status !== "rejected").slice(0, 8);
  const primary = candidates.find(candidate => candidate.point.id === primaryPointId) ?? null;

  return <section className="field-observation-evidence field-visit-evidence" aria-label="考察点、现场照片与 InSAR 点关联证据">
    <header>
      <div><small>FIELD VISIT · 本地证据</small><h3>{observation.name}</h3><p>{observation.note || "未填写现场记录"}</p></div>
      <span>{observation.photos.length} 张照片</span>
    </header>

    <div className="field-visit-coordinate-band">
      <article><span>考察点坐标</span><b>{observation.longitude.toFixed(6)}° E</b><b>{observation.latitude.toFixed(6)}° N</b></article>
      <article><span>坐标来源</span><b>{sourceLabel(observation.coordinateSource)}</b><small>{observation.capturedAt || "考察时间未提供"}</small></article>
      <article className={primary ? "is-linked" : ""}><span>曲线来源</span><b>{primary ? primary.point.id : "尚未确认"}</b><small>{primary ? `相距 ${Math.round(primary.distanceMeters)} m` : "确认监测点后显示曲线"}</small></article>
    </div>

    <div className="field-visit-photo-stage compact">
      {activePhoto ? <button type="button" className="field-visit-photo-preview" onClick={() => onOpenPhoto(activePhoto.id)}>
        <Image unoptimized width={164} height={108} src={activePhoto.photoUrl} alt={activePhoto.note || activePhoto.name} />
        <span><small>现场照片 · 点击查看原图</small><b>{activePhoto.name}</b><em>{activePhoto.capturedAt || "拍摄时间未提供"}</em>{activePhoto.coordinateConflict && <strong>照片坐标与考察点相差超过 50 m</strong>}</span>
      </button> : <div className="field-visit-no-photo">该考察点暂无照片，仍可保留位置与监测点关联。</div>}
      {observation.photos.length > 0 && <div className="field-visit-photo-rail">{observation.photos.map((photo, index) => <article key={photo.id} className={photo.id === activePhoto?.id ? "active" : ""}>
        <button type="button" onClick={() => { onSelectPhoto(photo.id); onOpenPhoto(photo.id); }}><Image unoptimized width={112} height={84} src={photo.photoUrl} alt={photo.name} /><span>{String(index + 1).padStart(2, "0")}</span></button>
        <button type="button" aria-label={`删除照片 ${photo.name}`} onClick={() => onRemovePhoto(photo.id)}>×</button>
      </article>)}</div>}
    </div>

    <div className="field-candidate-head">
      <div><small>SPATIAL MATCH</small><h4>附近 InSAR 候选</h4><p>最近点只置顶，不会自动成为曲线来源。</p></div>
      <div className="field-radius-switch" aria-label="候选关联半径">{[100, 250, 500].map(radius => <button type="button" key={radius} className={observation.associationRadiusMeters === radius ? "active" : ""} onClick={() => onRadiusChange(radius)}>{radius} m</button>)}</div>
    </div>

    {visibleCandidates.length ? <div className="field-candidate-list">{visibleCandidates.map((candidate, index) => {
      const point = candidate.point;
      const isPrimary = point.id === primaryPointId;
      return <article key={point.id} className={isPrimary ? "primary" : ""}>
        <div className="field-candidate-rank">{String(index + 1).padStart(2, "0")}</div>
        <div className="field-candidate-copy"><div><b>{point.id}</b><em data-status={candidate.status}>{linkLabel(candidate.status)}</em></div><span>{Math.round(candidate.distanceMeters)} m · {point.velocity.toFixed(1)} mm/yr · 相干性 {point.coherence ? point.coherence.toFixed(2) : "未提供"}</span><small>{point.series.length >= 2 ? `${point.series.length} 期真实时序` : "无逐期时序，确认后也不会生成曲线"}</small></div>
        <div className="field-candidate-actions"><button type="button" onClick={() => onInspectCandidate(point)}>查看点位</button><button type="button" disabled={isPrimary} onClick={() => onConfirmCandidate(point)}>{isPrimary ? "当前主关联" : "设为主关联"}</button><button type="button" onClick={() => onRejectCandidate(point)}>排除</button></div>
      </article>;
    })}</div> : <div className="field-candidate-empty"><b>当前半径内没有真实监测点</b><span>可扩大候选半径或核对考察点坐标；系统不会补造形变数据。</span></div>}

    <p className="field-association-boundary">{primary ? `下方点位曲线来自用户确认的 ${primary.point.id}，考察点与监测点相距 ${Math.round(primary.distanceMeters)} m。空间对应不表示照片对象就是形变来源。` : "尚未确认主关联监测点；右侧不会因“最近”而自动显示形变曲线。"}</p>
  </section>;
}
