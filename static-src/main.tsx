import React from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import { HomePage } from "../app/components/HomePage";
import { MapWorkspace } from "../app/components/MapWorkspace";
import { ShowcasePage, CaseDetailPage } from "../app/components/CasePages";
import { ContentPage } from "../app/components/ContentPages";
import { DatasetPage } from "../app/components/DatasetPage";
import { cases } from "../app/data/site";

function App(){
  const path=window.location.pathname.replace(/\/$/,"")||"/";
  if(path==="/map")return <MapWorkspace/>;
  if(path==="/showcase")return <ShowcasePage/>;
  if(path.startsWith("/showcase/")){const id=path.split("/").pop();const item=cases.find(x=>x.key===id);return item?<CaseDetailPage item={item}/>:<HomePage/>}
  if(path==="/statistics")return <ContentPage type="statistics"/>;
  if(path==="/solutions")return <ContentPage type="solutions"/>;
  if(path==="/platform")return <ContentPage type="platform"/>;
  if(path==="/about")return <ContentPage type="about"/>;
  if(path==="/datasets")return <DatasetPage/>;
  if(path==="/login")return <main className="new-login"><section className="login-scene grid-surface"><a className="site-brand invert" href="/"><img src="/insar-satellite-v2.png" alt="InSAR 卫星"/><span><b>LANJIFYW</b><small>城市时序 InSAR</small></span></a><div><span className="eyebrow">TIME-SERIES INSAR · WEBGIS</span><h1>让城市形变数据<br/>更容易被看见</h1><p>纯前端展示版不会把账号、密码或 CSV 数据上传到服务器。</p></div></section><section className="login-panel"><div><a className="back-link" href="/">← 返回首页</a><span className="eyebrow">LOCAL DEMO ACCESS</span><h2>进入展示平台</h2><p>登录页仅用于作品展示。点击按钮可直接进入本地数据工作台。</p><label>账号<input placeholder="演示账号" readOnly/></label><label>密码<input type="password" value="12345678" readOnly/></label><a className="button primary login-button" href="/map">进入纯前端平台</a><small>所有 CSV 解析与点位分析均在浏览器内完成。</small></div></section></main>;
  return <HomePage/>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
