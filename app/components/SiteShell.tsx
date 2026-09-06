"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navItems } from "../data/site";
import { getSession } from "../lib/auth-client";
import type { AuthUser } from "../lib/auth-client";
import { LanguageSwitch, useLanguage } from "../lib/language-context";

const navigationEnglish: Record<string, string> = {
  "/": "Home",
  "/map": "Deformation map",
  "/datasets": "Datasets",
  "/statistics": "Regional statistics",
  "/showcase": "Case studies",
  "/showcase/city": "Urban",
  "/showcase/landslide": "Landslide",
  "/showcase/road": "Road",
  "/platform": "Capabilities",
  "/solutions": "Use cases",
  "/about": "Project story",
};

export function BrandMark({ invert = false }: { invert?: boolean }) {
  const { text } = useLanguage();
  return <Link className={`site-brand brand-system${invert ? " invert" : ""}`} href="/">
    {/* Static 86 KB transparent mark; keeping it as a direct asset avoids runtime image-optimisation usage. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="brand-symbol" src="/lanjifyw-brand-satellite.png" alt="" aria-hidden="true" />
    <span><b>LANJIFYW</b><small>{text("InSAR 形变模式识别","InSAR pattern recognition")}</small></span>
  </Link>;
}

export function SiteHeader(){
  const path=usePathname(); const { locale, text }=useLanguage(); const [scrolled,setScrolled]=useState(false); const [open,setOpen]=useState(false); const [account,setAccount]=useState<AuthUser|null>(null);
  useEffect(()=>{const fn=()=>setScrolled(window.scrollY>24);fn();window.addEventListener("scroll",fn);return()=>window.removeEventListener("scroll",fn)},[]);
  useEffect(()=>{getSession().then(setAccount).catch(()=>setAccount(null))},[path]);
  return <header className={`site-header ${scrolled?"is-scrolled":""}`}>
    <BrandMark />
    <button className="nav-toggle" aria-label={text("打开导航","Open navigation")} aria-expanded={open} onClick={()=>setOpen(!open)}>☰</button>
    <nav className={open?"site-nav is-open":"site-nav"} aria-label={text("主导航","Primary navigation")}>{navItems.map(item=><div className="nav-entry" key={item.href}>
      <Link className={path===item.href||path.startsWith(item.href+"/")?"active":""} href={item.href} onClick={()=>setOpen(false)}>{locale==="zh"?item.label:navigationEnglish[item.href]}{item.children&&<span>⌄</span>}</Link>
      {item.children&&<div className="nav-popover">{item.children.map(child=><Link href={child.href} key={child.href} onClick={()=>setOpen(false)}><b>{locale==="zh"?child.label:navigationEnglish[child.href]}</b><small>{text("查看相关内容与分析功能","View related content and analysis tools")}</small></Link>)}</div>}
    </div>)}</nav>
    <LanguageSwitch compact />
    <Link className="header-ai-config" href="/map">{text("进入工作台","Open workspace")}</Link>
    <Link className="header-login" href={account?"/datasets":"/login"}>{account?`${account.name} · ${text("我的数据","My data")}`:text("登录 / 注册","Sign in")} <span>↗</span></Link>
  </header>
}

export function SiteFooter(){const {text}=useLanguage();return <footer className="site-footer"><div><BrandMark invert/><p>{text("从时序观测中识别形变模式，让静态指标呈现可解释的变化过程。","Identify deformation patterns from time-series observations and reveal how change evolves beyond static indicators.")}</p></div><div><b>{text("开始分析","Start")}</b><Link href="/map?demo=haikou&tour=portfolio">{text("90 秒公开体验","90-second public demo")}</Link><Link href="/map?intent=upload">{text("使用我的数据","Use my data")}</Link><Link href="/datasets">{text("管理私人数据","Manage private data")}</Link></div><div><b>{text("了解项目","Explore")}</b><Link href="/showcase">{text("案例展示","Case studies")}</Link><Link href="/platform">{text("产品能力","Capabilities")}</Link><Link href="/solutions">{text("应用场景","Use cases")}</Link><Link href="/about">{text("项目实践","Project story")}</Link></div><div><b>{text("地图数据","Map data")}</b><span>© OpenStreetMap contributors</span><span>Tiles © Esri</span><span>{text("天地图 · 需配置 API Key","Tianditu · API key required")}</span></div></footer>}

function MotionEnhancer(){useEffect(()=>{if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;const targets=Array.from(document.querySelectorAll<HTMLElement>(".section-heading,.industry-card,.platform-preview,.case-feature,.workflow article,.case-list>a,.info-grid article,.detail-grid article,.statistics-layout>article,.metric-strip article,.scenario-flow article,.platform-capability-card,.scenario-overview-card,.practice-decision-grid article,.practice-evidence-list a"));targets.forEach((element,index)=>{element.classList.add("reveal-ready");element.style.setProperty("--reveal-delay",`${Math.min(index%5,4)*55}ms`)});const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add("is-revealed");observer.unobserve(entry.target)}}),{threshold:.12,rootMargin:"0px 0px -5%"});targets.forEach(element=>observer.observe(element));const hoverCards=Array.from(document.querySelectorAll<HTMLElement>(".industry-card,.case-list>a,.info-grid article,.metric-strip article,.product-capability article,.case-metrics span,.architecture-flow span,.schema-grid article,.report-metrics article,.selection-summary>div,.platform-capability-card,.scenario-overview-card,.practice-decision-grid article,.practice-evidence-list a"));const cleanups=hoverCards.map(card=>{card.classList.add("spotlight-card");const move=(event:PointerEvent)=>{const rect=card.getBoundingClientRect();card.style.setProperty("--pointer-x",`${((event.clientX-rect.left)/rect.width)*100}%`);card.style.setProperty("--pointer-y",`${((event.clientY-rect.top)/rect.height)*100}%`)};card.addEventListener("pointermove",move);return()=>card.removeEventListener("pointermove",move)});return()=>{observer.disconnect();cleanups.forEach(fn=>fn())}},[]);return null}

export function PageShell({children}: {children:React.ReactNode}){return <><MotionEnhancer/><SiteHeader/><main className="page-enter">{children}</main><SiteFooter/></>}

export function PageHero({eyebrow,title,description}: {eyebrow:string;title:string;description:string}){return <section className="page-hero grid-surface"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p><i className="orbit orbit-a"/><i className="orbit orbit-b"/></section>}
