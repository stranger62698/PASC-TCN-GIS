"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navItems } from "../data/site";

export function SiteHeader(){
  const path=usePathname(); const [scrolled,setScrolled]=useState(false); const [open,setOpen]=useState(false);
  useEffect(()=>{const fn=()=>setScrolled(window.scrollY>24);fn();window.addEventListener("scroll",fn);return()=>window.removeEventListener("scroll",fn)},[]);
  return <header className={`site-header ${scrolled?"is-scrolled":""}`}>
    <Link className="site-brand" href="/"><img src="/insar-satellite-v2.png" alt="InSAR 卫星标志"/><span><b>LANJIFYW</b><small>城市时序 InSAR</small></span></Link>
    <button className="nav-toggle" aria-label="打开导航" aria-expanded={open} onClick={()=>setOpen(!open)}>☰</button>
    <nav className={open?"site-nav is-open":"site-nav"} aria-label="主导航">{navItems.map(item=><div className="nav-entry" key={item.href}>
      <Link className={path===item.href||path.startsWith(item.href+"/")?"active":""} href={item.href} onClick={()=>setOpen(false)}>{item.label}{item.children&&<span>⌄</span>}</Link>
      {item.children&&<div className="nav-popover">{item.children.map(child=><Link href={child.href} key={child.href} onClick={()=>setOpen(false)}><b>{child.label}</b><small>查看相关内容与分析功能</small></Link>)}</div>}
    </div>)}</nav>
    <Link className="header-login" href="/login">登录平台 <span>↗</span></Link>
  </header>
}

export function SiteFooter(){return <footer className="site-footer"><div><Link className="site-brand invert" href="/"><img src="/insar-satellite-v2.png" alt=""/><span><b>LANJIFYW</b><small>城市时序 InSAR</small></span></Link><p>用可解释的地图、曲线和统计，让毫米级城市形变更容易被看见。</p></div><div><b>平台</b><Link href="/map">形变地图</Link><Link href="/statistics">区域统计</Link><Link href="/datasets">数据集管理</Link></div><div><b>内容</b><Link href="/showcase">案例展示</Link><Link href="/solutions">技术方案</Link><Link href="/about">关于项目</Link></div><div><b>地图数据</b><span>© OpenStreetMap contributors</span><span>Tiles © Esri</span><span>天地图 · 需配置 API Key</span></div></footer>}

function MotionEnhancer(){useEffect(()=>{if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;const targets=Array.from(document.querySelectorAll<HTMLElement>(".section-heading,.industry-card,.platform-preview,.case-feature,.workflow article,.case-list>a,.info-grid article,.detail-grid article,.statistics-layout>article"));targets.forEach((element,index)=>{element.classList.add("reveal-ready");element.style.setProperty("--reveal-delay",`${Math.min(index%5,4)*55}ms`)});const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add("is-revealed");observer.unobserve(entry.target)}}),{threshold:.12,rootMargin:"0px 0px -5%"});targets.forEach(element=>observer.observe(element));const hoverCards=Array.from(document.querySelectorAll<HTMLElement>(".industry-card,.case-list>a,.info-grid article"));const cleanups=hoverCards.map(card=>{const move=(event:PointerEvent)=>{const rect=card.getBoundingClientRect();card.style.setProperty("--pointer-x",`${((event.clientX-rect.left)/rect.width)*100}%`);card.style.setProperty("--pointer-y",`${((event.clientY-rect.top)/rect.height)*100}%`)};card.addEventListener("pointermove",move);return()=>card.removeEventListener("pointermove",move)});return()=>{observer.disconnect();cleanups.forEach(fn=>fn())}},[]);return null}

export function PageShell({children}: {children:React.ReactNode}){return <><MotionEnhancer/><SiteHeader/><main className="page-enter">{children}</main><SiteFooter/></>}

export function PageHero({eyebrow,title,description}: {eyebrow:string;title:string;description:string}){return <section className="page-hero grid-surface"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p><i className="orbit orbit-a"/><i className="orbit orbit-b"/></section>}
