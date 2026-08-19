import React from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import { HomePage } from "../app/components/HomePage";
import { MapWorkspace } from "../app/components/MapWorkspace";
import { ShowcasePage, CaseDetailPage } from "../app/components/CasePages";
import { ContentPage } from "../app/components/ContentPages";
import { DatasetPage } from "../app/components/DatasetPage";
import { AuthPage } from "../app/components/AuthPage";
import { cases } from "../app/data/site";

function App(){
  const authCallback=/(confirmation_token|recovery_token|invite_token|access_token|type=recovery)/.test(window.location.hash);
  if(authCallback)return <AuthPage/>;
  const base=(import.meta.env.BASE_URL||"/").replace(/\/$/,"");
  const hashMode=import.meta.env.VITE_HASH_ROUTING==="true";
  const rawPath=hashMode?window.location.hash.slice(1):window.location.pathname.slice(base.length);
  const path=rawPath.replace(/\/$/,"")||"/";
  if(path==="/map")return <MapWorkspace/>;
  if(path==="/showcase")return <ShowcasePage/>;
  if(path.startsWith("/showcase/")){const id=path.split("/").pop();const item=cases.find(x=>x.key===id);return item?<CaseDetailPage item={item}/>:<HomePage/>}
  if(path==="/statistics")return <ContentPage type="statistics"/>;
  if(path==="/solutions")return <ContentPage type="solutions"/>;
  if(path==="/platform")return <ContentPage type="platform"/>;
  if(path==="/about")return <ContentPage type="about"/>;
  if(path==="/datasets")return <DatasetPage/>;
  if(path==="/login")return <AuthPage/>;
  return <HomePage/>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
