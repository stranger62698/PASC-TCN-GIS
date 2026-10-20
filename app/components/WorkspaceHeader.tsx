"use client";
import Link from "next/link";
import { useState } from "react";
import { BrandMark } from "./SiteShell";
import { LanguageSwitch, useLanguage } from "../lib/language-context";
import { buildLoginContinuationHref } from "../lib/local-analysis-session";
import { useAccountSession } from "../lib/account-session";

export type WorkspaceSection = "data" | "layers" | "route" | "analysis" | "inspection" | "export";
const sections: { id: WorkspaceSection; label: string; english: string }[] = [
  { id: "data", label: "数据", english: "Data" },
  { id: "layers", label: "图层", english: "Layers" },
  { id: "route", label: "驾车", english: "Driving" },
  { id: "analysis", label: "分析", english: "Analysis" },
  { id: "inspection", label: "核查", english: "Inspection" },
  { id: "export", label: "导出", english: "Export" },
];

function WorkspaceNavIcon({ section }: { section: WorkspaceSection }) {
  return <svg className="workspace-nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {section === "data" && <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
    </>}
    {section === "layers" && <>
      <path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" />
    </>}
    {section === "route" && <>
      <path d="m5 9 1.5-4h11L19 9M3 11.5 5 9h14l2 2.5V18H3v-6.5ZM5 18v2M19 18v2M7 13h1M16 13h1M10 16h4" />
    </>}
    {section === "analysis" && <>
      <path d="M4 3v17h17M8 16v-5M13 16V7M18 16V4" />
    </>}
    {section === "inspection" && <>
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3m-7 9 3 3 5-6" />
    </>}
    {section === "export" && <>
      <path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6" />
    </>}
  </svg>;
}

export function WorkspaceHeader({ active, onChange, onHelp, onReturnToImport }: {
  active: WorkspaceSection | null;
  onChange: (section: WorkspaceSection) => void;
  onHelp: () => void;
  onReturnToImport?: () => void;
}) {
  const { text } = useLanguage();
  const { status, user, logout } = useAccountSession();
  const account = status === "authenticated" ? user : null;
  const [signingOut, setSigningOut] = useState(false), [logoutError, setLogoutError] = useState("");
  const handleLogout = async () => { setSigningOut(true); setLogoutError(""); try { await logout(); } catch (error) { setLogoutError(error instanceof Error ? error.message : text("退出失败，请重试", "Sign-out failed; retry")); } finally { setSigningOut(false); } };
  return <header className="workspace-header">
    <BrandMark />
    <nav className="workspace-primary-nav" aria-label={text("工作台主导航", "Workspace navigation")}>
      {sections.map(section => <button key={section.id} type="button" className={active === section.id ? "active" : ""} aria-expanded={active === section.id} onClick={() => onChange(section.id)}>
        <WorkspaceNavIcon section={section.id} />
        <span className="workspace-nav-label">{text(section.label, section.english)}</span>
      </button>)}
    </nav>
    <div className="workspace-header-utilities">
      {onReturnToImport ? <button type="button" className="workspace-home-link" onClick={onReturnToImport} aria-label={text("返回导入", "Back to import")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14" /></svg>
        <span>{text("返回导入", "Back to import")}</span>
      </button> : <Link className="workspace-home-link" href="/" aria-label={text("返回首页", "Back to home")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9" /></svg>
        <span>{text("返回首页", "Home")}</span>
      </Link>}
      <button onClick={onHelp}>{text("帮助", "Help")}</button>
      <LanguageSwitch compact />
      {account ? <><Link href="/datasets" title={account.email}>{account.name || account.email} · {text("我的数据", "My data")}</Link><button type="button" disabled={signingOut} title={logoutError || undefined} onClick={() => void handleLogout()}>{signingOut ? text("正在退出…", "Signing out…") : logoutError ? text("退出失败，重试", "Retry sign out") : text("退出", "Sign out")}</button></> : <a href="/login?returnTo=%2Fmap&resume=1" target="_blank" rel="noopener noreferrer" onClick={event => { event.currentTarget.href = buildLoginContinuationHref(window.location.pathname + window.location.search, window.location.origin); }}>{text("登录 / 注册", "Sign in / Register")}</a>}
    </div>
  </header>;
}

