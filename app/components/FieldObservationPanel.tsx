"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseFieldVisitCsv, readPhotoExif, type FieldObservation, type NewFieldObservationInput, type NewObservationPhoto } from "../lib/field-observation";
import { readWatermarkCoordinates } from "../lib/photo-watermark";

type DraftPhoto = NewObservationPhoto & { previewUrl: string };

export function FieldObservationPanel({ observations, activeId, mapCenter, storageState, onAdd, onSelect, onRemove }: {
  observations: FieldObservation[];
  activeId: string | null;
  mapCenter: [number, number];
  storageState: "loading" | "ready" | "session" | "saving";
  onAdd: (input: NewFieldObservationInput) => void;
  onSelect: (observation: FieldObservation) => void;
  onRemove: (id: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [visitName, setVisitName] = useState("");
  const [longitude, setLongitude] = useState("");
  const [latitude, setLatitude] = useState("");
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [coordinateSource, setCoordinateSource] = useState<FieldObservation["coordinateSource"]>("manual");
  const [message, setMessage] = useState("先建立考察点，再把同一次考察的照片归入该点。");
  const photoCount = useMemo(() => observations.reduce((sum, item) => sum + item.photos.length, 0), [observations]);
  const coordinatesValid = useMemo(() => {
    const lon = Number(longitude), lat = Number(latitude);
    return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
  }, [longitude, latitude]);

  useEffect(() => () => photos.forEach(photo => URL.revokeObjectURL(photo.previewUrl)), [photos]);

  const choosePhotos = async (files: FileList | null) => {
    const chosen = Array.from(files ?? []).slice(0, 50);
    if (!chosen.length) return;
    setMessage(`正在读取 ${chosen.length} 张照片的 EXIF 信息…`);
    const next = await Promise.all(chosen.map(async file => {
      const metadata = await readPhotoExif(file);
      const hasExifGps = metadata.longitude !== null && metadata.latitude !== null;
      return { file, previewUrl: URL.createObjectURL(file), capturedAt: metadata.capturedAt, exifLongitude: metadata.longitude, exifLatitude: metadata.latitude, coordinateSource: hasExifGps ? "exif" as const : null, coordinateConfidence: hasExifGps ? 1 : null };
    }));
    photos.forEach(photo => URL.revokeObjectURL(photo.previewUrl));
    setPhotos(next);
    let located = next.find(photo => photo.exifLongitude !== null && photo.exifLatitude !== null);
    let watermarkAttempted = false;
    if (!located) {
      for (let index = 0; index < next.length; index += 1) {
        watermarkAttempted = true;
        setMessage(`照片没有 EXIF GPS，正在本地识别第 ${index + 1}/${next.length} 张照片底部的经纬度水印…`);
        try {
          const watermark = await readWatermarkCoordinates(next[index].file, progress => setMessage(`正在本地识别经纬度水印 · ${Math.round(progress * 100)}%`));
          if (watermark.longitude !== null && watermark.latitude !== null) {
            next[index] = { ...next[index], exifLongitude: watermark.longitude, exifLatitude: watermark.latitude, coordinateSource: "watermark", coordinateConfidence: watermark.confidence };
            located = next[index];
            setPhotos([...next]);
            break;
          }
        } catch { /* Continue with the remaining photos, then show one stable fallback message. */ }
      }
    }
    if (located && located.exifLongitude !== null && located.exifLatitude !== null) {
      setLongitude(located.exifLongitude.toFixed(7));
      setLatitude(located.exifLatitude.toFixed(7));
      setCoordinateSource(located.coordinateSource === "watermark" ? "watermark" : "exif");
      setCapturedAt(located.capturedAt);
      setMessage(located.coordinateSource === "watermark" ? "已从照片水印识别经纬度并生成待确认考察点。请核对数值后再保存。" : "已用第一张含 GPS 的照片生成待确认考察点；其他照片仍保留各自 EXIF 供校核。");
    } else {
      setCoordinateSource("manual");
      setCapturedAt(next.find(photo => photo.capturedAt)?.capturedAt ?? null);
      setMessage(watermarkAttempted ? "照片没有 EXIF GPS，水印坐标也未能自动识别。请手工填写或应用坐标 CSV；照片仍可正常保存。" : "照片未提供可用 GPS，请填写考察点坐标或使用地图中心。");
    }
    if (!visitName) setVisitName(`现场考察 · ${new Date().toLocaleDateString("zh-CN")}`);
  };

  const clearDraft = () => {
    photos.forEach(photo => URL.revokeObjectURL(photo.previewUrl));
    setPhotos([]);
    setVisitName("");
    setLongitude("");
    setLatitude("");
    setCapturedAt(null);
    setNote("");
    setCoordinateSource("manual");
    if (fileInput.current) fileInput.current.value = "";
    if (csvInput.current) csvInput.current.value = "";
  };

  const applyCoordinateCsv = async (file: File | undefined) => {
    if (!file) return;
    try {
      const rows = parseFieldVisitCsv(await file.text());
      const selectedNames = new Set(photos.map(photo => photo.file.name));
      const matched = rows.filter(row => selectedNames.has(row.fileName));
      if (!matched.length) throw new Error("CSV 中没有与当前照片同名的 file_name。请确认文件名后重试。");
      const visitIds = new Set(matched.map(row => row.visitId));
      if (visitIds.size !== 1) throw new Error("当前照片对应多个 visit_id，请按一次考察拆分后导入。");
      const base = matched[0];
      if (matched.some(row => Math.abs(row.longitude - base.longitude) > 1e-7 || Math.abs(row.latitude - base.latitude) > 1e-7)) throw new Error("同一 visit_id 出现多个考察点坐标，请先在 CSV 中校正。");
      setVisitName(base.visitName || base.visitId);
      setLongitude(base.longitude.toFixed(7));
      setLatitude(base.latitude.toFixed(7));
      setCapturedAt(base.capturedAt ?? capturedAt);
      if (base.note) setNote(base.note);
      setCoordinateSource("csv");
      setMessage(`CSV 已匹配 ${matched.length}/${photos.length} 张照片；请确认坐标后保存。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "CSV 读取失败。");
    } finally {
      if (csvInput.current) csvInput.current.value = "";
    }
  };

  const exportCsv = () => {
    const quote = (value: string | number | null | undefined) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const lines = [["visit_id", "visit_name", "file_name", "longitude", "latitude", "captured_at", "coordinate_source", "primary_insar_id", "note"].join(",")];
    observations.forEach(observation => {
      const primary = observation.links.find(link => link.status === "confirmed-primary");
      observation.photos.forEach(photo => lines.push([observation.id, observation.name, photo.name, observation.longitude, observation.latitude, photo.capturedAt ?? observation.capturedAt, observation.coordinateSource, primary?.insarPointId, photo.note || observation.note].map(quote).join(",")));
    });
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `field-visits-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const submit = () => {
    if (!photos.length || !coordinatesValid || !visitName.trim()) return;
    onAdd({
      name: visitName.trim(),
      longitude: Number(longitude),
      latitude: Number(latitude),
      capturedAt,
      note: note.trim(),
      coordinateSource,
      photos: photos.map(photo => ({ file: photo.file, capturedAt: photo.capturedAt, note: "", exifLongitude: photo.exifLongitude, exifLatitude: photo.exifLatitude, coordinateSource: photo.coordinateSource, coordinateConfidence: photo.coordinateConfidence })),
    });
    clearDraft();
    setMessage("考察点已保存。请选择附近 InSAR 候选并手动设为主关联，之后才会显示曲线。");
  };

  const storageLabel = storageState === "loading" ? "正在读取" : storageState === "saving" ? "正在保存" : storageState === "ready" ? "本地已保存" : "仅当前会话";

  return <section className="field-observation-panel">
    <header>
      <div><small>FIELD NOTEBOOK</small><b>考察点与现场照片</b></div>
      <span>{observations.length} 点 · {photoCount} 张</span>
    </header>
    <p>照片先归属考察点，再由考察点关联真实 InSAR 监测点。空间邻近只用于寻找候选，不自动生成曲线。</p>

    <div className="field-storage-state" data-state={storageState}><i />{storageLabel}</div>
    <input ref={fileInput} hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void choosePhotos(event.target.files)} />
    <input ref={csvInput} hidden type="file" accept=".csv,text/csv" onChange={event => void applyCoordinateCsv(event.target.files?.[0])} />

    {!photos.length ? <button className="field-photo-add" type="button" onClick={() => fileInput.current?.click()}>
      <i>＋</i><span><b>新建考察点</b><small>一次可选择多张照片 · JPEG 自动读取 EXIF</small></span>
    </button> : <div className="field-photo-draft">
      <div className="field-draft-heading"><span>01</span><div><b>确认考察点</b><small>{photos.length} 张照片等待归档</small></div></div>
      <label className="field-note">考察点名称<input value={visitName} onChange={event => setVisitName(event.target.value)} placeholder="例如：世纪大桥桥头考察点" /></label>
      <div className="field-photo-strip">{photos.map(photo => <figure key={photo.previewUrl}>
        <Image unoptimized width={120} height={90} src={photo.previewUrl} alt={photo.file.name} />
        <figcaption><b>{photo.file.name}</b><small>{photo.coordinateSource === "watermark" ? "已识别水印坐标" : photo.coordinateSource === "exif" ? "含 EXIF GPS" : "无可用坐标"}</small></figcaption>
      </figure>)}</div>
      <div className="field-coordinate-grid"><label>经度<input value={longitude} inputMode="decimal" onChange={event => { setLongitude(event.target.value); setCoordinateSource("manual"); }} placeholder="110.3500000" /></label><label>纬度<input value={latitude} inputMode="decimal" onChange={event => { setLatitude(event.target.value); setCoordinateSource("manual"); }} placeholder="20.0900000" /></label></div>
      {(coordinateSource === "exif" || coordinateSource === "watermark") && <div className={`field-coordinate-origin ${coordinateSource}`}><b>{coordinateSource === "watermark" ? "图片水印识别" : "照片 EXIF GPS"}</b><span>{coordinateSource === "watermark" ? "坐标由照片像素文字在本地识别，请保存前核对。" : "坐标来自照片原始元数据。"}</span></div>}
      <div className="field-coordinate-tools"><button type="button" className="field-map-center" onClick={() => { setLongitude(mapCenter[1].toFixed(7)); setLatitude(mapCenter[0].toFixed(7)); setCoordinateSource("map-center"); }}>使用当前地图中心</button><button type="button" className="field-map-center" onClick={() => csvInput.current?.click()}>应用坐标 CSV</button></div>
      <label className="field-note">现场记录<textarea value={note} onChange={event => setNote(event.target.value)} placeholder="记录考察对象、现场环境和需要复核的问题" /></label>
      <div className="field-draft-actions"><button type="button" onClick={clearDraft}>取消</button><button type="button" disabled={!coordinatesValid || !visitName.trim()} onClick={submit}>保存考察点</button></div>
    </div>}

    <div className="field-observation-message">{message}</div>
    {observations.length > 0 && <><div className="field-observation-list">{observations.map(observation => {
      const cover = observation.photos[0];
      const primary = observation.links.find(link => link.status === "confirmed-primary");
      return <article key={observation.id} className={observation.id === activeId ? "active" : ""}>
        <button type="button" onClick={() => onSelect(observation)}>
          {cover ? <Image unoptimized width={96} height={76} src={cover.photoUrl} alt={observation.name} /> : <span className="field-visit-empty-cover">察</span>}
          <span><b>{observation.name}</b><small>{observation.longitude.toFixed(6)}° E · {observation.latitude.toFixed(6)}° N</small><em>{observation.photos.length} 张照片 · {primary ? `已关联 ${primary.insarPointId}` : "待确认监测点"}</em></span>
        </button>
        <button type="button" className="field-photo-remove" aria-label={`删除考察点 ${observation.name}`} onClick={() => onRemove(observation.id)}>×</button>
      </article>;
    })}</div><button className="field-export-button" type="button" onClick={exportCsv}>导出考察点与照片清单 CSV</button></>}
  </section>;
}
