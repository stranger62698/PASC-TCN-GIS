"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

type Option<T extends string> = { value: T; label: string; description?: string; disabled?: boolean };

/** A compact map control with a keyboard-accessible radio menu. */
export function WorkspaceSelect<T extends string>({ label, value, options, onChange, icon }: {
  label: string; value: T; options: Option<T>[]; onChange: (value: T) => void; icon: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const current = options.find(option => option.value === value);
  const items = () => Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') ?? []);
  useEffect(() => {
    if (!open) return;
    const selected = root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)');
    (selected ?? root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)'))?.focus();
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const navigate = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    const buttons = items();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault(); buttons[next]?.focus();
  };
  return <div className="workspace-select" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button className="workspace-select-trigger" type="button" ref={trigger}
      aria-label={`${label}：${current?.label ?? ""}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(!open)} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
      }}>
      <span className="workspace-control-icon" aria-hidden="true">{icon}</span>
      <span className="workspace-control-copy"><small>{label}</small><b>{current?.label}</b></span>
      <svg className="workspace-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && <div className="workspace-select-menu" id={menuId} role="menu" tabIndex={-1} aria-label={label} onKeyDown={navigate}>
      <div className="workspace-menu-caption" role="presentation">{label}</div>
      {options.map(option => <button type="button" key={option.value} role="menuitemradio" aria-checked={value === option.value}
        disabled={option.disabled} tabIndex={-1} onClick={() => { onChange(option.value); close(); }}>
        <span><b>{option.label}</b>{option.description && <small>{option.description}</small>}{option.disabled && <small>当前数据不支持</small>}</span>
        <span className="workspace-option-check" aria-hidden="true">{value === option.value ? "✓" : ""}</span>
      </button>)}
    </div>}
  </div>;
}
