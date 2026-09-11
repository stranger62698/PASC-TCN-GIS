"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 340;
const maxPanelWidth = (available: number) => Math.max(MIN_WIDTH, Math.min(960, available - 300));

export function ResizableAnalysisPanel({ children, className, collapsed, label }: { children: ReactNode; className: string; collapsed: boolean; label: string }) {
  const id = useId();
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; handle: HTMLDivElement } | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [maximum, setMaximum] = useState(960);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const shell = panelRef.current?.parentElement;
    if (!shell) return;
    const measure = () => {
      const nextMaximum = maxPanelWidth(shell.clientWidth);
      setMaximum(nextMaximum);
      setWidth(current => Math.min(current, nextMaximum));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    panelRef.current?.parentElement?.style.setProperty("--analysis-panel-width", `${width}px`);
  }, [width]);

  useEffect(() => {
    if (!dragging) return;
    const root = document.documentElement;
    const previousCursor = root.style.cursor, previousSelect = root.style.userSelect;
    root.style.cursor = "col-resize";
    root.style.userSelect = "none";
    return () => { root.style.cursor = previousCursor; root.style.userSelect = previousSelect; };
  }, [dragging]);

  const finishDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    setDragging(false);
  };
  useEffect(() => { if (collapsed) finishDrag(); }, [collapsed]);

  const changeWidth = (next: number) => setWidth(Math.round(Math.max(MIN_WIDTH, Math.min(maximum, next))));
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    changeWidth(drag.startWidth + drag.startX - event.clientX);
  };

  return <>
    {!collapsed && <div
      className={`analysis-panel-resizer${dragging ? " is-dragging" : ""}`}
      role="separator"
      tabIndex={0}
      aria-label="调整分析面板宽度"
      aria-orientation="vertical"
      aria-controls={id}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maximum}
      aria-valuenow={width}
      aria-valuetext={`${width} 像素`}
      title="向左拖动以展开曲线；双击恢复宽度。也可用左右方向键调整。"
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, handle: event.currentTarget };
        setDragging(true);
      }}
      onPointerMove={moveDrag}
      onPointerUp={event => { moveDrag(event); finishDrag(); }}
      onPointerCancel={() => { if (dragRef.current) changeWidth(dragRef.current.startWidth); finishDrag(); }}
      onLostPointerCapture={finishDrag}
      onDoubleClick={() => changeWidth(DEFAULT_WIDTH)}
      onKeyDown={event => {
        if (event.key === "Escape" && dragRef.current) {
          event.preventDefault(); event.stopPropagation();
          changeWidth(dragRef.current.startWidth); finishDrag(); return;
        }
        const next = event.key === "ArrowLeft" ? width + (event.shiftKey ? 80 : 20) : event.key === "ArrowRight" ? width - (event.shiftKey ? 80 : 20) : event.key === "Home" ? MIN_WIDTH : event.key === "End" ? maximum : null;
        if (next !== null) { event.preventDefault(); event.stopPropagation(); changeWidth(next); }
      }}
    ><span aria-hidden="true" /></div>}
    <aside ref={panelRef} id={id} className={className} aria-label={label}>{children}</aside>
  </>;
}
