"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getUser, handleAuthCallback, logout } from "@netlify/identity";
import type { User } from "@netlify/identity";
import { PageHero, PageShell } from "./SiteShell";

type QualityReport={invalid:number;missingRate:number;lowCoherence:number;outlierVelocity:number;modeCounts:Record<string,number>;warnings:string[];timeColumns:string[];bbox:[number,number,number,number]};
type DatasetMeta={id:string;name:string;size:number;chunks:number;uploadedAt:string;updatedAt?:string;analysisReady:boolean;status?:"archived"|"ready";schemaStatus?:"pending"|"validated";version?:number;parentId?:string;mapping?:Record<string,unknown>;qualityReport?:QualityReport;processStatus?:"uploaded"|"mapped"|"validated"|"converted"};
type AccountInfo={userId:string;email:string;roles:string[];usedBytes:number;maxUserBytes:number;maxFileSize:number;isAdmin:boolean};

const CHUNK=4*1024*1024;
const lifecycle=[["01","上传归档","CSV 以 4 MB 分块进入私有对象存储。"],["02","字段映射","保存经纬度、速率、日期序列、模式和质量字段。"],["03","质量检查","记录无效坐标、缺测率、低相干点和异常速率。"],["04","地图分析","在 WebGIS 中进行点位、框选、多点和时间段分析。"],["05","报告导出","输出截图、单点曲线、区域统计和分析摘要。"]];

function formatBytes(value=0){if(value>=1024**3)return `${(value/1024**3).toFixed(2)} GB`;if(value>=1024**2)return `${(value/1024**2).toFixed(1)} MB`;return `${(value/1024).toFixed(1)} KB`}
function downloadTemplate(){const csv=["point_id,longitude,latitude,velocity,label,coherence,project_name,D20200101,D20200113,D20200125","P-001,110.3284,20.04539,-2.31,Stable,0.91,示例研究区,0,-0.8,-1.1","P-002,110.3385,20.05542,-8.24,Linear,0.89,示例研究区,0,-3.9,-5.1"].join("\n"),blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="lanjifyw-insar-template.csv";a.click();URL.revokeObjectURL(a.href)}

export function DatasetPage(){
  const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),[items,setItems]=useState<DatasetMeta[]>([]),[account,setAccount]=useState<AccountInfo|null>(null),[progress,setProgress]=useState(0),[phase,setPhase]=useState(""),[message,setMessage]=useState(""),[renaming,setRenaming]=useState<string|null>(null),[renameValue,setRenameValue]=useState(""),[replaceParent,setReplaceParent]=useState<DatasetMeta|null>(null),[report,setReport]=useState<DatasetMeta|null>(null);
  const fileRef=useRef<HTMLInputElement>(null);

  const refresh=async()=>{const response=await fetch("/api/private-datasets?op=list",{credentials:"include",cache:"no-store"});if(response.ok){const data=await response.json();setItems((data.items||[]).sort((a:DatasetMeta,b:DatasetMeta)=>b.uploadedAt.localeCompare(a.uploadedAt)));setAccount(data.account||null)}else if(response.status!==401)setMessage("私有数据服务暂时不可用，请稍后重试")};
  useEffect(()=>{handleAuthCallback().catch(()=>null).then(()=>getUser()).then(current=>{setUser(current);setLoading(false);if(current)refresh()}).catch(()=>setLoading(false))},[]);

  const upload=async(file?:File)=>{
    if(!file||!user)return;
    if(account&&file.size>account.maxFileSize){setMessage(`单个文件超过限制：${formatBytes(account.maxFileSize)}。2GB 以上请采用后台转换服务。`);return}
    if(account&&account.usedBytes+file.size>account.maxUserBytes){setMessage(`账户容量不足：当前剩余 ${formatBytes(account.maxUserBytes-account.usedBytes)}`);return}
    const id=crypto.randomUUID().replace(/-/g,""),chunks=Math.ceil(file.size/CHUNK),parentId=replaceParent?.id;
    setPhase("分片上传");setMessage(`正在上传 ${file.name}`);setProgress(0);
    localStorage.setItem("lanjifyw-upload-session",JSON.stringify({id,name:file.name,size:file.size,chunks,parentId,startedAt:new Date().toISOString()}));
    try{
      for(let i=0;i<chunks;i++){const body=await file.slice(i*CHUNK,Math.min(file.size,(i+1)*CHUNK)).arrayBuffer(),response=await fetch(`/api/private-datasets?op=chunk&id=${id}&index=${i}`,{method:"POST",body,credentials:"include",headers:{"Content-Type":"application/octet-stream"}});if(!response.ok)throw new Error((await response.json()).error||`第 ${i+1} 个分块上传失败`);setProgress(Math.round((i+1)/chunks*86))}
      setPhase("登记元数据");
      const done=await fetch(`/api/private-datasets?op=complete&id=${id}`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:file.name,size:file.size,chunks,parentId,analysisReady:file.size<=300*1024*1024})});
      if(!done.ok)throw new Error((await done.json()).error||"数据集登记失败");
      setProgress(100);setPhase("完成");setMessage(parentId?"重新导入完成：已生成新版本":"上传完成：文件已按当前账户私有保存");setReplaceParent(null);localStorage.removeItem("lanjifyw-upload-session");await refresh();
    }catch(e){setPhase("失败");setMessage(e instanceof Error?e.message:"上传失败，可重新选择文件继续导入")}finally{if(fileRef.current)fileRef.current.value=""}
  };

  const updateDataset=async(item:DatasetMeta,patch:Partial<DatasetMeta>)=>{const response=await fetch(`/api/private-datasets?id=${item.id}`,{method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch)});if(!response.ok){setMessage("更新失败");return}setMessage("数据集信息已更新");setRenaming(null);await refresh()};
  const remove=async(id:string)=>{if(!confirm("确认删除这个私有数据集及其全部分块？此操作不可恢复。"))return;const response=await fetch(`/api/private-datasets?id=${id}`,{method:"DELETE",credentials:"include"});if(response.ok){setMessage("数据集已删除");await refresh()}else setMessage("删除失败")};
  const signOut=async()=>{await logout();window.location.href="/login"};
  const accountName=String(user?.userMetadata?.username||user?.name||user?.email||"");

  if(loading)return <div className="auth-loading">正在检查账户…</div>;
  if(!user)return <PageShell><PageHero eyebrow="PRIVATE DATA WORKSPACE" title="登录后保存你的 InSAR 数据" description="公开地图可以直接本地导入；登录后 CSV 将按用户 ID 分块存储，其他用户无法访问。"/><section className="section"><div className="login-required"><h2>尚未登录</h2><p>注册时设置展示用户名并绑定邮箱；邮箱用于账户验证和密码找回。</p><Link className="button primary" href="/login">登录或注册</Link></div></section></PageShell>;

  const usage=account?Math.min(100,account.usedBytes/account.maxUserBytes*100):0;
  return <PageShell><PageHero eyebrow="PRIVATE DATA WORKSPACE" title="我的 InSAR 数据资产" description={`当前账户：${accountName}。平台按服务端确认的用户 ID 隔离数据，适合作为多用户产品原型展示。`}/>
    <section className="section dataset-layout">
      <aside><b>数据空间</b><Link className="active" href="/datasets">我的数据集 <span>{items.length}</span></Link><Link href="/map">地图工作台</Link><Link href="/statistics">区域统计</Link><Link href="/platform">存储架构</Link><button onClick={signOut}>退出登录</button></aside>
      <div>
        <div className="account-strip">
          <article><span>账户隔离</span><b>{account?.isAdmin?"管理员":"普通用户"}</b><small>{account?.email}</small></article>
          <article><span>容量使用</span><b>{formatBytes(account?.usedBytes||0)} / {formatBytes(account?.maxUserBytes||0)}</b><i><em style={{width:`${usage}%`}}/></i></article>
          <article><span>文件限制</span><b>{formatBytes(account?.maxFileSize||0)}</b><small>超过 300 MB 仅归档，生产版进入后台转换</small></article>
        </div>
        <div className="dataset-product-grid">
          <div className="upload-zone">
            <img src="/insar-satellite-v2.png" alt=""/><h2>{replaceParent?`重新导入：${replaceParent.name}`:"私有上传 InSAR CSV"}</h2>
            <p>小型 CSV 可在线分析；大体量文件先分片归档，正式产品由后台转换为 GeoParquet / PostGIS / PMTiles。</p>
            <button className="button primary" onClick={()=>fileRef.current?.click()}>{replaceParent?"选择新版本 CSV":"选择 CSV 并保存"}</button><button className="button ghost" onClick={downloadTemplate}>下载 CSV 模板</button>{replaceParent&&<button className="button ghost" onClick={()=>setReplaceParent(null)}>取消重新导入</button>}
            <input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={e=>upload(e.target.files?.[0])}/>
            <small>必须字段：经度、纬度、速率、两期以上累计形变；推荐字段：label、coherence、project_name。</small>
            {progress>0&&<div className="upload-progress"><i style={{width:`${progress}%`}}/><span>{phase} · {progress}%</span></div>}{message&&<div className="dataset-message">{message}</div>}
          </div>
          <div className="product-checklist"><span className="eyebrow">PRODUCT FLOW</span><h2>完整数据生命周期</h2>{lifecycle.map(([n,t,d])=><article key={n}><b>{n}</b><span>{t}</span><small>{d}</small></article>)}</div>
        </div>
        <div className="dataset-table private-table product-table">
          <div><b>数据集名称</b><b>流程状态</b><b>质检摘要</b><b>文件大小</b><b>操作</b></div>
          {items.length===0&&<div className="empty-dataset">当前账户还没有保存的数据集。可以先上传海口示例 CSV 或自己的 InSAR 点数据。</div>}
          {items.map(item=><div key={item.id}>
            <span>{renaming===item.id?<input className="rename-input" value={renameValue} onChange={e=>setRenameValue(e.target.value)} autoFocus/>:<strong>{item.name}</strong>}<small>v{item.version||1} · {new Date(item.uploadedAt).toLocaleString("zh-CN")} · {item.id.slice(0,8)}</small></span>
            <span><i className={item.analysisReady?"ready":"archived"}>{item.processStatus||"uploaded"}</i><small>{item.mapping?"字段映射已保存":"待字段映射"}</small></span>
            <span><b>{item.qualityReport?`${item.qualityReport.invalid} 无效行`:"待质检"}</b><small>{item.qualityReport?`缺测 ${(item.qualityReport.missingRate*100).toFixed(1)}% · 低相干 ${item.qualityReport.lowCoherence}`:"打开地图后生成报告"}</small></span>
            <span>{formatBytes(item.size)}<small>{item.chunks} 个分块 · {item.analysisReady?"可在线分析":"仅归档"}</small></span>
            <span className="dataset-actions">{item.analysisReady&&<Link href={`/map?dataset=${item.id}`}>打开</Link>}{renaming===item.id?<button onClick={()=>updateDataset(item,{name:renameValue})}>保存</button>:<button onClick={()=>{setRenaming(item.id);setRenameValue(item.name)}}>重命名</button>}<button onClick={()=>{setReplaceParent(item);fileRef.current?.click()}}>重新导入</button><button onClick={()=>setReport(item)}>质检</button><button onClick={()=>remove(item.id)}>删除</button></span>
          </div>)}
        </div>
        <div className="product-roadmap"><article><span>BIG DATA</span><h3>2GB CSV 的正式接入方式</h3><p>前端提交分片和任务；后台转换为列式数据、空间索引和瓦片，地图只读当前视野。</p></article><article><span>PRIVACY</span><h3>用户隔离</h3><p>对象键使用服务端身份生成的 users/userId/ 前缀，前端不能指定他人的存储路径。</p></article><article><span>ASSETS</span><h3>分析资产化</h3><p>字段映射、质检报告、色带方案、截图和报告都作为数据集资产保存。</p></article></div>
      </div>
    </section>
    {report&&<div className="config-backdrop" onMouseDown={()=>setReport(null)}><section className="config-dialog" onMouseDown={e=>e.stopPropagation()}><button className="dialog-close" onClick={()=>setReport(null)}>×</button><span className="eyebrow">QUALITY REPORT</span><h2>{report.name}</h2>{report.qualityReport?<><div className="report-metrics"><article><b>{report.qualityReport.invalid}</b><span>无效行</span></article><article><b>{(report.qualityReport.missingRate*100).toFixed(1)}%</b><span>缺测率</span></article><article><b>{report.qualityReport.lowCoherence}</b><span>低相干点</span></article><article><b>{report.qualityReport.outlierVelocity}</b><span>速率异常值</span></article></div><div className="quality-detail"><b>时间列识别</b><p>{report.qualityReport.timeColumns.slice(0,12).join("、")}{report.qualityReport.timeColumns.length>12?" …":""}</p><b>形变模式</b>{Object.entries(report.qualityReport.modeCounts).map(([k,v])=><span key={k}>{k} · {v}</span>)}</div></>:<p className="success-report">该数据集还没有生成质检报告。请先打开地图完成字段映射。</p>}</section></div>}
  </PageShell>;
}
