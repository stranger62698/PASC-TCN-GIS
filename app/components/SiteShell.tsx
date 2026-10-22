"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navItems } from "../data/site";
import { useAccountSession } from "../lib/account-session";
import { LanguageSwitch, useLanguage } from "../lib/language-context";

const navigationEnglish: Record<string, string> = {
  "/": "Home",
  "/map": "Workspace",
  "/datasets": "Datasets",
  "/statistics": "Regional statistics",
  "/showcase": "Case studies",
  "/showcase/city": "Urban",
  "/showcase/landslide": "Landslide",
  "/showcase/road": "Road",
  "/platform": "Capabilities",
  "/solutions": "Use cases",
  "/about": "Project overview",
};

export function SiteHeader(){
  const path=usePathname(); const { locale, text }=useLanguage(); const [scrolled,setScrolled]=useState(false); const [open,setOpen]=useState(false);
  const { status, user, logout } = useAccountSession();
  const account = status === "authenticated" ? user : null;
  const [signingOut, setSigningOut] = useState(false), [logoutError, setLogoutError] = useState("");
  const handleLogout = async () => { setSigningOut(true); setLogoutError(""); try { await logout(); } catch (error) { setLogoutError(error instanceof Error ? error.message : text("退出失败，请重试", "Sign-out failed; retry")); } finally { setSigningOut(false); } };
  useEffect(()=>{const fn=()=>setScrolled(window.scrollY>24);fn();window.addEventListener("scroll",fn);return()=>window.removeEventListener("scroll",fn)},[]);
  return <header className={`site-header ${scrolled?"is-scrolled":""}`}>
    <button className="nav-toggle" aria-label={text("打开导航","Open navigation")} aria-expanded={open} onClick={()=>setOpen(!open)}>☰</button>
    <nav className={open?"site-nav is-open":"site-nav"} aria-label={text("主导航","Primary navigation")}>{navItems.map(item=><div className="nav-entry" key={item.href}>
      <Link className={path===item.href||path.startsWith(item.href+"/")?"active":""} href={item.href} onClick={()=>setOpen(false)}>{locale==="zh"?item.label:navigationEnglish[item.href]}{item.children&&<span>⌄</span>}</Link>
      {item.children&&<div className="nav-popover">{item.children.map(child=><Link href={child.href} key={child.href} onClick={()=>setOpen(false)}><b>{locale==="zh"?child.label:navigationEnglish[child.href]}</b><small>{text("查看相关内容与分析功能","View related content and analysis tools")}</small></Link>)}</div>}
    </div>)}</nav>
    <LanguageSwitch compact />
    <Link className="header-ai-config" href="/map">{text("进入工作台","Open workspace")}</Link>
    <Link className="header-login" href={account?"/datasets":"/login"} title={account?.email}>{account?`${account.name || account.email} · ${text("我的数据","My data")}`:text("登录 / 注册","Sign in / Register")} <span>↗</span></Link>
    {account && <button className="header-login" type="button" disabled={signingOut} title={logoutError || undefined} onClick={() => void handleLogout()}>{signingOut ? text("正在退出…", "Signing out…") : logoutError ? text("退出失败，重试", "Retry sign out") : text("退出", "Sign out")}</button>}
  </header>
}

export function SiteFooter() {
  const { text } = useLanguage();
  return <footer className="site-footer">
    <div>
      <p>{text("面向时序 InSAR 的形变研判与外业核查支持平台，整合模式识别、驾车行程及现场证据。","A time-series InSAR workspace for deformation analysis and field verification, combining pattern recognition, driving itineraries and field evidence.")}</p>
      <small className="site-footer-boundary">{text("科研与非商业化产品实践。分析及规划结果需结合专业判断与现场条件复核。","A research and non-commercial product project. Analysis and planning outputs require professional review and verification of site conditions.")}</small>
    </div>
    <div>
      <b>{text("工作空间","Workspace")}</b>
      <Link href="/map?demo=haikou&tour=portfolio">{text("公开数据分析","Public data analysis")}</Link>
      <Link href="/map?demo=road">{text("外业行程规划","Fieldwork planning")}</Link>
      <Link href="/map?intent=upload">{text("导入分析数据","Import analysis data")}</Link>
      <Link href="/datasets">{text("本机数据导入 · 需登录","Local import · Sign in required")}</Link>
    </div>
    <div>
      <b>{text("项目与应用","Project & applications")}</b>
      <Link href="/showcase">{text("案例展示","Case studies")}</Link>
      <Link href="/platform">{text("产品能力","Capabilities")}</Link>
      <Link href="/solutions">{text("应用场景","Use cases")}</Link>
      <Link href="/about">{text("项目实践","Project overview")}</Link>
    </div>
    <div>
      <b>{text("地图与路线服务","Maps & routing")}</b>
      <span>© OpenStreetMap contributors</span>
      <span>Tiles © Esri</span>
      <span>{text("天地图 · 需配置 API Key","Tianditu · API key required")}</span>
      <span>{text("滴图 Web 服务 · 驾车路线","Didi Web services · Driving routes")}</span>
      <small className="site-footer-boundary">{text("路线服务与底图独立，非实时导航。","Routing is independent of the basemap; not real-time navigation.")}</small>
    </div>
  </footer>;
}

function MotionEnhancer(){useEffect(()=>{if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;const targets=Array.from(document.querySelectorAll<HTMLElement>(".section-heading,.industry-card,.platform-preview,.case-feature,.workflow article,.case-list>a,.info-grid article,.detail-grid article,.statistics-layout>article,.metric-strip article,.scenario-flow article,.platform-capability-card,.scenario-overview-card,.practice-decision-grid article,.practice-evidence-list a"));targets.forEach((element,index)=>{element.classList.add("reveal-ready");element.style.setProperty("--reveal-delay",`${Math.min(index%5,4)*55}ms`)});const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add("is-revealed");observer.unobserve(entry.target)}}),{threshold:.12,rootMargin:"0px 0px -5%"});targets.forEach(element=>observer.observe(element));const hoverCards=Array.from(document.querySelectorAll<HTMLElement>(".industry-card,.case-list>a,.info-grid article,.metric-strip article,.product-capability article,.case-metrics span,.architecture-flow span,.schema-grid article,.report-metrics article,.selection-summary>div,.platform-capability-card,.scenario-overview-card,.practice-decision-grid article,.practice-evidence-list a"));const cleanups=hoverCards.map(card=>{card.classList.add("spotlight-card");const move=(event:PointerEvent)=>{const rect=card.getBoundingClientRect();card.style.setProperty("--pointer-x",`${((event.clientX-rect.left)/rect.width)*100}%`);card.style.setProperty("--pointer-y",`${((event.clientY-rect.top)/rect.height)*100}%`)};card.addEventListener("pointermove",move);return()=>card.removeEventListener("pointermove",move)});return()=>{observer.disconnect();cleanups.forEach(fn=>fn())}},[]);return null}

export function PageShell({children}: {children:React.ReactNode}){return <div className="site-surface"><MotionEnhancer/><SiteHeader/><main className="page-enter">{children}</main><SiteFooter/></div>}

export function PageHero({eyebrow,title,description}: {eyebrow:string;title:string;description:string}){return <section className="page-hero grid-surface"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p><i className="orbit orbit-a"/><i className="orbit orbit-b"/></section>}
