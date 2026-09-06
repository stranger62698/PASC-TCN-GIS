"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandMark } from "./SiteShell";
import { LanguageSwitch, useLanguage } from "../lib/language-context";
import { getSession, type AuthUser } from "../lib/auth-client";

export type WorkspaceSection = "data" | "layers" | "analysis" | "inspection" | "export";
const sections: { id: WorkspaceSection; label: string; english: string; symbol: string }[] = [
  { id: "data", label: "数据", english: "Data", symbol: "▤" },
  { id: "layers", label: "图层", english: "Layers", symbol: "▱" },
  { id: "analysis", label: "分析", english: "Analysis", symbol: "⌁" },
  { id: "inspection", label: "核查", english: "Inspection", symbol: "◎" },
  { id: "export", label: "导出", english: "Export", symbol: "↗" },
];

export function WorkspaceHeader({ active, onChange, onHelp }: {
  active: WorkspaceSection | null;
  onChange: (section: WorkspaceSection) => void;
  onHelp: () => void;
}) {
  const { text } = useLanguage();
  const [account, setAccount] = useState<AuthUser | null>(null);
  useEffect(() => { let cancelled = false; getSession().then(user => { if (!cancelled) setAccount(user); }).catch(() => {}); return () => { cancelled = true; }; }, []);
  return <header className="workspace-header">
    <BrandMark />
    <nav className="workspace-primary-nav" aria-label={text("工作台主导航", "Workspace navigation")}>
      {sections.map(section => <button key={section.id} type="button" className={active === section.id ? "active" : ""} aria-expanded={active === section.id} onClick={() => onChange(section.id)}>
        <span aria-hidden="true">{section.symbol}</span>{text(section.label, section.english)}
      </button>)}
    </nav>
    <div className="workspace-header-utilities">
      <button onClick={onHelp}>{text("帮助", "Help")}</button>
      <LanguageSwitch compact />
      <Link href={account ? "/datasets" : "/login"}>{account ? text("我的数据", "My data") : text("登录", "Sign in")}</Link>
    </div>
  </header>;
}

