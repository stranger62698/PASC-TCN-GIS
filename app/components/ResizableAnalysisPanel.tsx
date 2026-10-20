"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type PointerEvent, type ReactNode, type SetStateAction } from "react";
import { clampPanelWidth, DEFAULT_PANEL_WIDTH, MAX_PANEL_WIDTH, MIN_PANEL_WIDTH, maxPanelWidth } from "../lib/workspace-panel-width";

export function ResizableAnalysisPanel({ children, className, collapsed, label, width, onWidthChange: setWidth, resizable = true }: {
  children: ReactNode;
  className: string;
  collapsed: boolean;
  label: string;
  width: number;
  onWidthChange: Dispatch<SetStateAction<number>>;
  resizable?: boolean;
}) {
  const id = useId();
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; handle: HTMLDivElement } | null>(null);
  const [maximum, setMaximum] = useState(MAX_PANEL_WIDTH);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const shell = panelRef.current?.parentElement;
    if (!shell) return;
    const measure = () => {
      // The mobile bottom sheet must not overwrite the remembered desktop width.
      if (shell.clientWidth < 768) return;
      const nextMaximum = maxPanelWidth(shell.clientWidth);
      setMaximum(nextMaximum);
      setWidth(current => Math.min(current, nextMaximum));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [setWidth]);

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
  useEffect(() => {
    if (!collapsed) return;
    const frame = requestAnimationFrame(finishDrag);
    return () => cancelAnimationFrame(frame);
  }, [collapsed]);

  const changeWidth = (next: number) => setWidth(clampPanelWidth(next, maximum));
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    changeWidth(drag.startWidth + drag.startX - event.clientX);
  };

  return <>
    {/* A focusable ARIA window splitter is an interactive separator with keyboard/value semantics. */}
    {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA window splitter pattern. */}
    {!collapsed && resizable && <div
      className={`analysis-panel-resizer${dragging ? " is-dragging" : ""}`}
      role="separator"
      tabIndex={0}
      aria-label={`调整${label}面板宽度`}
      aria-orientation="vertical"
      aria-controls={id}
      aria-valuemin={MIN_PANEL_WIDTH}
      aria-valuemax={maximum}
      aria-valuenow={width}
      aria-valuetext={`${width} 像素`}
      title="向左拖动展开面板，向右拖动缩窄；双击恢复默认宽度。也可用左右方向键调整。"
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
      onDoubleClick={() => changeWidth(DEFAULT_PANEL_WIDTH)}
      onKeyDown={event => {
        if (event.key === "Escape" && dragRef.current) {
          event.preventDefault(); event.stopPropagation();
          changeWidth(dragRef.current.startWidth); finishDrag(); return;
        }
        const next = event.key === "ArrowLeft" ? width + (event.shiftKey ? 80 : 20) : event.key === "ArrowRight" ? width - (event.shiftKey ? 80 : 20) : event.key === "Home" ? MIN_PANEL_WIDTH : event.key === "End" ? maximum : null;
        if (next !== null) { event.preventDefault(); event.stopPropagation(); changeWidth(next); }
      }}
    ><span aria-hidden="true" /></div>}
    {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
    <aside ref={panelRef} id={id} className={className} aria-label={label}>{children}</aside>
  </>;
}
