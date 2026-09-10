"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./InfoHint.module.css";

type HintMode = "closed" | "transient" | "pinned";
type HintPosition = { left: number; top: number; arrow: number; placement: "top" | "bottom" };

/** Short, non-interactive context that stays out of the main reading flow. */
export function InfoHint({ label, title, children, onOpenChange }: { label: string; title?: string; children: ReactNode; onOpenChange?: (open: boolean) => void }) {
  const id = useId();
  const onOpenChangeRef = useRef(onOpenChange);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverRef = useRef({ trigger: false, popup: false });
  const focusedRef = useRef(false);
  const dismissedRef = useRef(false);
  const [mode, setMode] = useState<HintMode>("closed");
  const [position, setPosition] = useState<HintPosition | null>(null);
  const open = mode !== "closed";

  useLayoutEffect(() => { onOpenChangeRef.current = onOpenChange; }, [onOpenChange]);

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  useEffect(() => () => { onOpenChangeRef.current?.(false); }, []);

  function cancelClose() {
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function scheduleClose() {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      setMode(current => current === "pinned" || focusedRef.current || hoverRef.current.trigger || hoverRef.current.popup ? current : "closed");
    }, 140);
  }

  useEffect(() => () => {
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => {
      dismissedRef.current = true;
      hoverRef.current.popup = false;
      setMode("closed");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !triggerRef.current?.contains(target) && !popupRef.current?.contains(target)) dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const measure = () => {
      const trigger = triggerRef.current;
      const popup = popupRef.current;
      if (!trigger || !popup) return;
      const anchor = trigger.getBoundingClientRect();
      const box = popup.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const margin = 12;
      const gap = 10;
      const roomBelow = viewportTop + height - anchor.bottom;
      const roomAbove = anchor.top - viewportTop;
      const placement = roomBelow >= box.height + gap + margin || roomBelow >= roomAbove ? "bottom" : "top";
      const left = Math.max(viewportLeft + margin, Math.min(anchor.left + anchor.width / 2 - box.width / 2, viewportLeft + width - box.width - margin));
      const desiredTop = placement === "bottom" ? anchor.bottom + gap : anchor.top - box.height - gap;
      const top = Math.max(viewportTop + margin, Math.min(desiredTop, viewportTop + height - box.height - margin));
      const arrow = Math.max(16, Math.min(anchor.left + anchor.width / 2 - left, box.width - 16));
      setPosition({ left, top, arrow, placement });
    };
    const queueMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    queueMeasure();
    window.addEventListener("resize", queueMeasure);
    window.addEventListener("scroll", queueMeasure, true);
    window.visualViewport?.addEventListener("resize", queueMeasure);
    window.visualViewport?.addEventListener("scroll", queueMeasure);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(queueMeasure) : null;
    if (popupRef.current) observer?.observe(popupRef.current);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", queueMeasure);
      window.removeEventListener("scroll", queueMeasure, true);
      window.visualViewport?.removeEventListener("resize", queueMeasure);
      window.visualViewport?.removeEventListener("scroll", queueMeasure);
      observer?.disconnect();
    };
  }, [open, children, title]);

  return <span className={styles.root}>
    <button
      ref={triggerRef}
      type="button"
      className={styles.trigger}
      aria-label={label}
      aria-describedby={open ? id : undefined}
      aria-expanded={open}
      data-open={open || undefined}
      onPointerEnter={event => {
        if (event.pointerType === "touch") return;
        if (mode === "closed") setPosition(null);
        hoverRef.current.trigger = true;
        dismissedRef.current = false;
        cancelClose();
        setMode(current => current === "pinned" ? current : "transient");
      }}
      onPointerLeave={() => {
        hoverRef.current.trigger = false;
        scheduleClose();
      }}
      onFocus={() => {
        focusedRef.current = true;
        cancelClose();
        if (!dismissedRef.current) {
          if (mode === "closed") setPosition(null);
          setMode(current => current === "pinned" ? current : "transient");
        }
      }}
      onBlur={() => {
        focusedRef.current = false;
        dismissedRef.current = false;
        scheduleClose();
      }}
      onClick={() => {
        cancelClose();
        if (mode === "closed") setPosition(null);
        dismissedRef.current = mode === "pinned";
        setMode(current => current === "pinned" ? "closed" : "pinned");
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 10.5v6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <circle cx="12" cy="7.7" r="1.1" fill="currentColor" />
      </svg>
    </button>
    {open && typeof document !== "undefined" && createPortal(<div
      ref={popupRef}
      id={id}
      role="tooltip"
      className={styles.popup}
      data-placement={position?.placement ?? "bottom"}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
        "--hint-arrow-x": `${position?.arrow ?? 20}px`,
      } as CSSProperties}
      onPointerEnter={() => {
        hoverRef.current.popup = true;
        cancelClose();
      }}
      onPointerLeave={() => {
        hoverRef.current.popup = false;
        scheduleClose();
      }}
    >
      {title && <strong className={styles.title}>{title}</strong>}
      <div className={styles.content}>{children}</div>
    </div>, document.body)}
  </span>;
}
