"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navItems } from "../data/site";
import { getSession } from "../lib/auth-client";
import type { AuthUser } from "../lib/auth-client";

export function SiteHeader(){
  const path=usePathname(); const [scrolled,setScrolled]=useState(false); const [open,setOpen]=useState(false); const [account,setAccount]=useState<AuthUser|null>(null);
  useEffect(()=>{const fn=()=>setScrolled(window.scrollY>24);fn();window.addEventListener("scroll",fn);return()=>window.removeEventListener("scroll",fn)},[]);
  useEffect(()=>{getSession().then(setAccount).catch(()=>setAccount(null))},[path]);
  return <header className={`site-header ${scrolled?"is-scrolled":""}`}>
    <Link className="site-brand" href="/"><img src="/insar-satellite-v2.png" alt="InSAR 卫星标志"/><span><b>LANJIFYW</b><small>城市时序 InSAR</small></span></Link>
    <button className="nav-toggle" aria-label="打开导航" aria-expanded={open} onClick={()=>setOpen(!open)}>☰</button>
    <nav className={open?"site-nav is-open":"site-nav"} aria-label="主导航">{navItems.map(item=><div className="nav-entry" key={item.href}>
      <Link className={path===item.href||path.startsWith(item.href+"/")?"active":""} href={item.href} onClick={()=>setOpen(false)}>{item.label}{item.children&&<span>⌄</span>}</Link>
      {item.children&&<div className="nav-popover">{item.children.map(child=><Link href={child.href} key={child.href} onClick={()=>setOpen(false)}><b>{child.label}</b><small>查看相关内容与分析功能</small></Link>)}</div>}
    </div>)}</nav>
    <Link className="header-login" href={account?"/datasets":"/login"}>{account?`${account.name} · 我的数据`:"登录 / 注册"} <span>↗</span></Link>
  </header>
}

export function SiteFooter(){return <footer className="site-footer"><div><Link className="site-brand invert" href="/"><img src="/insar-satellite-v2.png" alt=""/><span><b>LANJIFYW</b><small>城市形变智能分析</small></span></Link><p>从看见形变量，到理解形变过程，再到形成可追溯的辅助解读。</p></div><div><b>开始分析</b><Link href="/map?demo=haikou">体验公开示例</Link><Link href="/map?intent=upload">上传我的数据</Link><Link href="/datasets">管理私人数据</Link></div><div><b>了解项目</b><Link href="/showcase">案例展示</Link><Link href="/platform">产品能力</Link><Link href="/solutions">应用场景概述</Link><Link href="/about">项目实践</Link></div><div><b>地图数据</b><span>© OpenStreetMap contributors</span><span>Tiles © Esri</span><span>天地图 · 需配置 API Key</span></div></footer>}

function MotionEnhancer(){useEffect(()=>{if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;const targets=Array.from(document.querySelectorAll<HTMLElement>(".section-heading,.industry-card,.platform-preview,.case-feature,.workflow article,.case-list>a,.info-grid article,.detail-grid article,.statistics-layout>article,.metric-strip article,.scenario-flow article,.platform-capability-card,.scenario-overview-card,.practice-decision-grid article,.practice-evidence-list a"));targets.forEach((element,index)=>{element.classList.add("reveal-ready");element.style.setProperty("--reveal-delay",`${Math.min(index%5,4)*55}ms`)});const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add("is-revealed");observer.unobserve(entry.target)}}),{threshold:.12,rootMargin:"0px 0px -5%"});targets.forEach(element=>observer.observe(element));const hoverCards=Array.from(document.querySelectorAll<HTMLElement>(".industry-card,.case-list>a,.info-grid article,.metric-strip article,.product-capability article,.case-metrics span,.architecture-flow span,.schema-grid article,.report-metrics article,.selection-summary>div,.platform-capability-card,.scenario-overview-card,.practice-decision-grid article,.practice-evidence-list a"));const cleanups=hoverCards.map(card=>{card.classList.add("spotlight-card");const move=(event:PointerEvent)=>{const rect=card.getBoundingClientRect();card.style.setProperty("--pointer-x",`${((event.clientX-rect.left)/rect.width)*100}%`);card.style.setProperty("--pointer-y",`${((event.clientY-rect.top)/rect.height)*100}%`)};card.addEventListener("pointermove",move);return()=>card.removeEventListener("pointermove",move)});return()=>{observer.disconnect();cleanups.forEach(fn=>fn())}},[]);return null}

export function PageShell({children}: {children:React.ReactNode}){return <><MotionEnhancer/><SiteHeader/><main className="page-enter">{children}</main><SiteFooter/></>}

export function PageHero({eyebrow,title,description}: {eyebrow:string;title:string;description:string}){return <section className="page-hero grid-surface"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p><i className="orbit orbit-a"/><i className="orbit orbit-b"/></section>}
