import Link from "next/link";
import { PageHero, PageShell } from "./SiteShell";

const contents={
  statistics:{eyebrow:"SPATIAL STATISTICS",title:"区域形变统计",description:"从单点观测上升到区域认知，比较速度分布、质量控制、模式占比和重点区域。"},
  solutions:{eyebrow:"INSAR SOLUTIONS",title:"从数据处理到 WebGIS 交付",description:"以标准化产品链连接时序反演、质量控制、模式识别、数据转换和在线发布。"},
  platform:{eyebrow:"PLATFORM ARCHITECTURE",title:"为大规模 InSAR 数据设计",description:"面对几十万点和数百期属性，采用分层存储、空间索引与按需加载，保持地图交互流畅。"},
  about:{eyebrow:"ABOUT THE PROJECT",title:"一个面向科研展示的 InSAR WebGIS",description:"LANJIFYW 将遥感处理、GIS 分析、数据工程与前端表达组合为可持续迭代的个人项目。"},
};

const capability={
  statistics:[
    ["框选统计","拖拽矩形选择区域，计算平均速率、最大累计形变、质量关注点和样本量。"],
    ["多点对比","将多个监测点加入同一时间序列视图，比较沉降趋势和阶段差异。"],
    ["阶段速率","选择任意时间区间，按线性拟合计算阶段形变速率。"],
    ["质量图层","基于相干性和缺测率识别低可靠观测点，避免误判。"],
  ],
  solutions:[
    ["CSV 接入","导入原始点表，使用字段映射向导识别坐标、速率、日期和形变模式。"],
    ["数据质检","输出无效坐标、速率缺失、时间序列不足和字段识别警告。"],
    ["符号化制图","支持速率、累计形变、阶段速率、形变模式和质量字段切换渲染。"],
    ["成果导出","地图截图、单点 CSV、报告打印和案例页面形成展示闭环。"],
  ],
  platform:[
    ["浏览器层","小数据直接解析，适合面试演示、科研成果预览和快速验证。"],
    ["对象存储层","用户 CSV 分块保存在私有 Blobs 路径，按登录身份隔离。"],
    ["计算转换层","生产版将 2GB CSV 异步转换为 GeoParquet、PostGIS 或 PMTiles。"],
    ["地图服务层","前端按视域和缩放级别加载聚合或点瓦片，避免一次性加载全量字段。"],
  ],
  about:[
    ["遥感算法理解","理解 InSAR 结果字段、时间序列、形变模式和质量指标。"],
    ["GIS 产品思维","以 QGIS 图层、底图、色带、框选和统计逻辑组织 WebGIS。"],
    ["前端工程能力","React、TypeScript、Leaflet、组件化页面和响应式交互。"],
    ["数据工程意识","考虑用户隐私、大文件存储、接口分层和后续 API 替换。"],
  ],
};

const cards={
  statistics:[["−1.7 mm/yr","区域平均速率"],["3.8%","重点形变点占比"],["12","重点监测区"],["0.86","平均相干性"]],
  solutions:[["数据准备","SAR、轨道与 DEM"],["时序反演","速度与累计形变"],["质量控制","相干性、缺测与坐标检查"],["成果发布","地图、曲线和接口"]],
  platform:[["对象存储","原始 CSV / Parquet"],["空间数据库","PostGIS 与索引"],["地图服务","矢量瓦片 / COG"],["前端查询","视域与点位按需加载"]],
  about:[["遥感处理","InSAR 数据产品"],["GIS 分析","空间统计与制图"],["数据工程","大文件与接口设计"],["前端表达","React WebGIS"]],
};

export function ContentPage({type}:{type:keyof typeof contents}){
  const c=contents[type];
  return <PageShell><PageHero {...c}/>
    <section className="section">
      <div className="info-grid">{cards[type].map(([a,b],i)=><article key={a}><span>0{i+1}</span><h2>{a}</h2><p>{b}</p></article>)}</div>

      <div className="product-capability">
        <div>
          <span className="eyebrow">PRODUCT MODULES</span>
          <h2>{type==="statistics"?"把地图结果变成可解释指标":type==="solutions"?"从算法成果到产品工作流":type==="platform"?"面向大数据的分层架构":"作品集中的能力表达"}</h2>
          <p>{type==="platform"?"正式产品不应让浏览器直接吞 2GB CSV，而是把 CSV 作为导入格式，转换为适合地图查询和时间序列读取的服务格式。":"这些模块让平台从展示型 Demo 变成可以解释、可复用、可交付的应用产品雏形。"}</p>
        </div>
        <div>{capability[type].map(([title,desc],i)=><article key={title}><b>{String(i+1).padStart(2,"0")}</b><span>{title}</span><small>{desc}</small></article>)}</div>
      </div>

      {type==="statistics"&&<div className="statistics-layout"><article><span className="eyebrow">VELOCITY DISTRIBUTION</span><h2>速度频数分布</h2><div className="histogram-modern">{[12,18,30,48,72,94,82,58,39,25,13,7].map((v,i)=><i style={{height:`${v}%`}} key={i}/>)}</div><div className="hist-axis"><span>−30</span><span>−15</span><span>0</span><span>+15</span><span>+30 mm/yr</span></div></article><article><span className="eyebrow">QUALITY CONTROL</span><h2>质量控制摘要</h2>{[["低相干点","4.6%",62],["高缺测点","2.1%",34],["坐标无效","0.3%",12],["字段警告","3 项",45]].map(([n,v,w])=><div className="rank-row" key={String(n)}><span>{n}</span><i><b style={{width:`${w}%`}}/></i><strong>{v}</strong></div>)}</article></div>}
      {type==="platform"&&<div className="architecture-flow"><span>2GB CSV</span><i>→</i><span>分片上传</span><i>→</i><span>Parquet / PostGIS</span><i>→</i><span>矢量瓦片</span><i>→</i><span>WebGIS 按需加载</span></div>}
      <div className="story-action"><h2>{type==="about"?"继续了解项目能力":"进入平台体验完整交互"}</h2><Link className="button primary" href={type==="about"?"/showcase":type==="platform"?"/datasets":"/map"}>{type==="about"?"浏览案例":type==="platform"?"查看数据管理":"打开地图"} ↗</Link></div>
    </section>
  </PageShell>;
}
