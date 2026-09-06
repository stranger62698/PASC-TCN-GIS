import type { AnomalyRegion } from "../lib/anomaly-regions";
import type { GisLayer } from "../lib/gis-layer";
import { buildInspectionCandidates } from "../lib/inspection-action";

const layerRoleLabel = (role: GisLayer["role"]) => role === "road" ? "道路对象" : role === "landslide" ? "滑坡范围" : "通用业务对象";

export function InspectionActionPanel({
  regions,
  activeRegionId,
  datasetTitle,
  observationDate,
  layers,
  clusterRadiusMeters,
  clusterMinimumPoints,
  onDiscover,
  onFocus,
  onClearFocus,
  onOpenLayers,
  onOpenAi,
  onExport,
}: {
  regions: AnomalyRegion[];
  activeRegionId: string | null;
  datasetTitle: string;
  observationDate: string;
  layers: GisLayer[];
  clusterRadiusMeters: number;
  clusterMinimumPoints: number;
  onDiscover: () => void;
  onFocus: (region: AnomalyRegion) => void;
  onClearFocus: () => void;
  onOpenLayers: () => void;
  onOpenAi: () => void;
  onExport: () => void;
}) {
  const candidates = buildInspectionCandidates(regions);
  const activeCandidate = candidates.find(candidate => candidate.region.id === activeRegionId) ?? null;
  const supportingPointCount = candidates.reduce((sum, candidate) => sum + candidate.region.pointCount, 0);
  const layerFeatureCount = layers.reduce((sum, layer) => sum + layer.featureCount, 0);
  const buildingCase = /新埠岛|建筑|城市/.test(datasetTitle);
  const supportingData = buildingCase
    ? ["建筑轮廓与建筑编号", "结构类型、层数与建成年代", "水准、裂缝或现场核查记录"]
    : ["对象边界与业务编号", "地形、道路或近期影像", "现场监测或人工核查记录"];
  return (
    <section className="inspection-action-panel" aria-label="空间研判与分析交付">
      <header className="inspection-brief-header inspection-delivery-header">
        <div><small>研判流程</small><h3>空间研判交付</h3></div>
        <span>{candidates.length ? candidates.length + " 个候选区域" : "等待发现线索"}</span>
        <p>把异常发现、时序模式、空间范围和质量边界收束成可定位、可解释、可交接的复核证据。</p>
      </header>

      <div className="inspection-readiness inspection-delivery-steps" aria-label="分析交付进度">
        <article className="ready"><i>01</i><span><b>数据可用</b><small>{observationDate}</small></span></article>
        <article className={candidates.length ? "ready" : "pending"}><i>02</i><span><b>发现线索</b><small>{candidates.length ? candidates.length + " 个空间区域" : "等待运行"}</small></span></article>
        <article className={activeCandidate ? "ready" : "pending"}><i>03</i><span><b>核对证据</b><small>{activeCandidate ? activeCandidate.region.id : "尚未选择"}</small></span></article>
        <article className={candidates.length ? "ready" : "pending"}><i>04</i><span><b>分析交付</b><small>{candidates.length ? "可导出复核简报" : "等待证据"}</small></span></article>
      </div>

      {!candidates.length ? (
        <div className="inspection-empty inspection-delivery-empty">
          <span>从真实分析链路开始</span>
          <b>生成可复核的空间异常线索</b>
          <p>系统先执行质量门控，再依据速率、时序模式与空间邻域形成候选区域；结果仍需结合业务对象和人工证据。</p>
          <button onClick={onDiscover}>发现异常区域</button>
        </div>
      ) : (
        <>
          <section className="inspection-scope-overview" aria-label="当前分析交付概览">
            <article><span>自动分组</span><b>{candidates.length}</b><small>邻域连通规则生成</small></article>
            <article><span>已分组点位</span><b>{supportingPointCount.toLocaleString()}</b><small>不等于人工选区</small></article>
            <article><span>业务图层</span><b>{layers.length}</b><small>{layers.length ? layerFeatureCount.toLocaleString() + " 个要素" : "待导入对象边界"}</small></article>
          </section>

          <section className="inspection-cluster-note" aria-label="自动空间分组说明">
            <b>这些范围由系统自动分组，并不是你手动画出的区域</b>
            <p>异常点按 {clusterRadiusMeters} 米邻域、至少 {clusterMinimumPoints} 个邻近点进行连通分组；边界只是点集包络，用来组织复核顺序，不代表建筑、地块或风险边界。</p>
          </section>

          <div className="inspection-candidates">
            <div className="inspection-section-title"><span>自动空间分组</span><small>请主动选择一个分组后再查看证据</small></div>
            {candidates.map(candidate => (
              <article key={candidate.region.id} className={"inspection-candidate " + candidate.priority + (activeRegionId === candidate.region.id ? " active" : "")}>
                <div className="inspection-rank"><small>复核顺序</small><strong>{String(candidate.rank).padStart(2, "0")}</strong><span>规则排序</span></div>
                <div className="inspection-candidate-copy">
                  <header><b>{candidate.region.id}</b><span>自动分组</span></header>
                  <p>{candidate.evidence.join(" · ")}</p>
                  <small>{candidate.region.centroid[0].toFixed(6)}° E · {candidate.region.centroid[1].toFixed(6)}° N</small>
                </div>
                <button onClick={() => activeRegionId === candidate.region.id ? onClearFocus() : onFocus(candidate.region)}>{activeRegionId === candidate.region.id ? "取消查看" : "查看分组"}</button>
              </article>
            ))}
          </div>

          {!activeCandidate && <section className="inspection-selection-prompt"><b>尚未选择空间分组</b><p>地图上的淡蓝虚线仅表示自动聚类结果。选择某一分组后，系统才会缩放地图并展开该组证据。</p></section>}

          {activeCandidate && <section className="inspection-evidence-workspace">
            <header><div><small>当前查看</small><h4>{activeCandidate.region.id} · 自动空间分组</h4></div><span>已主动选择</span></header>
            <div className="inspection-evidence-metrics">
              <article><span>中位速率</span><b>{activeCandidate.region.medianVelocity.toFixed(1)}</b><small>mm / yr</small></article>
              <article><span>最大累计量</span><b>{activeCandidate.region.maximumAbsoluteDisplacement.toFixed(1)}</b><small>mm · 绝对值</small></article>
              <article><span>空间支持点</span><b>{activeCandidate.region.pointCount}</b><small>个候选点</small></article>
              <article><span>主导模式</span><b>{activeCandidate.region.dominantMode}</b><small>来自现有模式字段</small></article>
            </div>
            <div className="inspection-evidence-trace">
              <span><i>01</i><b>观测证据</b><small>速率、累计形变与时序结果来自当前数据集。</small></span>
              <span><i>02</i><b>空间证据</b><small>候选区域由邻域连通规则生成，边界不是业务对象边界。</small></span>
              <span><i>03</i><b>质量边界</b><small>候选发现已排除低相干或高缺测点，仍需查看原始质量字段。</small></span>
            </div>
            <div className="inspection-evidence-actions"><button onClick={onClearFocus}>取消当前分组</button><button onClick={onOpenAi}>进入证据解读</button></div>
          </section>}

          <section className={"inspection-layer-bridge" + (layers.length ? " has-layers" : "")}>
            <header><div><small>空间关联</small><h4>业务对象关联</h4></div><span>{layers.length ? "已导入 " + layers.length + " 个图层" : "对象边界待补充"}</span></header>
            {layers.length ? <div className="inspection-linked-layers">{layers.slice(0, 4).map(layer => <article key={layer.id}><i/><span><b>{layer.name}</b><small>{layerRoleLabel(layer.role)} · {layer.featureCount.toLocaleString()} 个要素 · {layer.geometryTypes.join(" / ")}</small></span><em>{layer.visible ? "地图可见" : "已隐藏"}</em></article>)}</div> : <p>当前结果只证明监测点之间形成空间线索。导入建筑、道路或项目边界后，才适合继续做点面关联、邻近检索或相交分析；系统不会自动把点位归因给某栋建筑。</p>}
            <button onClick={onOpenLayers}>{layers.length ? "管理 GIS 图层" : "导入业务对象图层"}</button>
          </section>
        </>
      )}

      <section className="inspection-approach-note">
        <span>研究结论边界</span>
        <h4>{buildingCase ? "先证明空间关联，再讨论对象级解释" : "先核对候选范围，再结合业务资料完成复核"}</h4>
        <p>{buildingCase ? "InSAR 点、异常区域与建筑轮廓属于不同证据层；点落在建筑面内也不等同于建筑结构发生损伤。" : "候选排序用于缩小分析范围，不替代现场调查、工程检测或专业安全判断。"}</p>
      </section>

      <details className="inspection-data-gates">
        <summary><span>形成对象级结论仍需</span><small>1 项已具备 · {supportingData.length} 项待补充</small></summary>
        <ul>
          <li className="ready"><i />InSAR 时序、速率、模式与空间候选区域<b>已具备</b></li>
          {supportingData.map(item => <li key={item}><i />{item}<b>待补充</b></li>)}
        </ul>
      </details>

      <footer className="inspection-actions">
        <div><b>{datasetTitle}</b><span>导出包含候选位置、排序依据、证据来源与研究边界。</span></div>
        <button disabled={!candidates.length} onClick={onExport}>导出复核简报</button>
      </footer>
    </section>
  );
}
