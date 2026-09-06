"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { FieldObservation } from "../lib/field-observation";

export function FieldPhotoLightbox({ observation, photoId, onClose, onChange }: {
  observation: FieldObservation | null;
  photoId: string | null;
  onClose: () => void;
  onChange: (photoId: string) => void;
}) {
  const photos = useMemo(() => observation?.photos ?? [], [observation]);
  const index = photoId ? photos.findIndex(photo => photo.id === photoId) : -1;
  const photo = index >= 0 ? photos[index] : null;
  const dialogRef = useRef<HTMLDivElement>(null);
  const lightboxState = useRef({ index, photos, onChange, onClose });
  const open = photo !== null;

  useEffect(() => {
    lightboxState.current = { index, photos, onChange, onClose };
  }, [index, photos, onChange, onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(".field-lightbox-close")?.focus());
    const handleKey = (event: KeyboardEvent) => {
      const state = lightboxState.current;
      if (event.key === "Escape") state.onClose();
      if (event.key === "ArrowLeft" && state.photos.length > 1) state.onChange(state.photos[(state.index - 1 + state.photos.length) % state.photos.length].id);
      if (event.key === "ArrowRight" && state.photos.length > 1) state.onChange(state.photos[(state.index + 1) % state.photos.length].id);
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.body.classList.add("field-lightbox-open");
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.classList.remove("field-lightbox-open");
      window.removeEventListener("keydown", handleKey);
      window.cancelAnimationFrame(focusFrame);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!observation || !photo) return null;
  const previous = photos[(index - 1 + photos.length) % photos.length];
  const next = photos[(index + 1) % photos.length];

  const closeFromPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  const lightbox = <div ref={dialogRef} className="field-photo-lightbox" role="dialog" aria-modal="true" aria-label={`${observation.name} 现场照片`}>
    <button className="field-lightbox-backdrop" type="button" onPointerDown={closeFromPointer} onClick={onClose} aria-label="关闭照片预览" />
    <button className="field-lightbox-close" type="button" onPointerDown={closeFromPointer} onClick={onClose} aria-label="关闭照片">×</button>
    {photos.length > 1 && <button className="field-lightbox-nav previous" type="button" onClick={() => onChange(previous.id)} aria-label="上一张照片">‹</button>}
    <figure>
      <div className="field-lightbox-image"><Image unoptimized priority width={1800} height={1300} src={photo.photoUrl} alt={photo.note || photo.name} /></div>
      <figcaption>
        <div><small>FIELD PHOTO · {String(index + 1).padStart(2, "0")}/{String(photos.length).padStart(2, "0")}</small><h2>{observation.name}</h2><p>{photo.note || observation.note || photo.name}</p></div>
        <dl><div><dt>经度</dt><dd>{observation.longitude.toFixed(6)}° E</dd></div><div><dt>纬度</dt><dd>{observation.latitude.toFixed(6)}° N</dd></div><div><dt>拍摄时间</dt><dd>{photo.capturedAt || observation.capturedAt || "未提供"}</dd></div></dl>
      </figcaption>
    </figure>
    {photos.length > 1 && <button className="field-lightbox-nav next" type="button" onClick={() => onChange(next.id)} aria-label="下一张照片">›</button>}
  </div>;
  return typeof document === "undefined" ? null : createPortal(lightbox, document.body);
}
