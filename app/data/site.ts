import type { PascCapabilityLevel, PascClassName, PascPointResult, PascSpatialApplicability, PascTemporalApplicability, PascValueSource } from "../types/pasc";

export type CaseKey = "city" | "landslide" | "road";

export type CaseStudy = {
  key: CaseKey; label: string; title: string; kicker: string; description: string;
  metrics: [string, string][]; tags: string[]; accent: string; image:string;
  workflow: [string, string][];
  demoNote: string;
};

export const cases: CaseStudy[] = [
  { key: "city", label: "城市", title: "海口 PASC-TCN 248 期公开示例", kicker: "URBAN DEFORMATION · HAIKOU", description: "以时序 InSAR 组织城市尺度形变结果，通过固定六分类、六类概率、适用性与可靠性发现值得进一步核查的位置。", metrics: [["Spatial Demo", "3,094 点"], ["观测期数", "248 期"], ["观测时间", "2017—2025"]], tags: ["Sentinel-1", "PASC-TCN", "248 期"], accent: "#1677ff", image:"/case-city-insar.png", workflow: [["业务问题","海量监测点中，哪些位置和变化过程值得优先核查？"],["数据","正式全量结果连续区域约 50m 网格抽稀：坐标、速率、248 期形变、相干性、六类概率与可靠性。"],["产品分析流程","兼容性检查 → 固定六分类 → 点位概率 → 区域统计。"],["发现","形成可追溯的点位和区域分析线索，不直接输出工程风险结论。"],["产品价值","把正式离线结果转化为可探索、可解释的城市形变分析过程。"]], demoNote:"该案例使用 3,094 点 Spatial Demo，保持自然类别不平衡；另有 3,000 点 Showcase Demo 专用于六类界面覆盖，不代表科学类别比例。" },
  { key: "landslide", label: "滑坡", title: "滑坡体活动性与形变演化监测", kicker: "LANDSLIDE MOTION", description: "沿坡体边界组织监测点，结合速率分区与累积形变时间序列，识别持续活动区和需要现场核查的变化线索。", metrics: [["关注对象", "坡体与坡脚"], ["时间更新", "按新增影像"], ["核查方式", "时序 + 现场"]], tags: ["滑坡", "坡体活动", "趋势分析"], accent: "#ff8a34", image:"/case-landslide-insar.png", workflow: [["业务问题","如何持续观察坡体不同部位的缓慢形变和阶段变化？"],["数据","坡体范围、InSAR 监测点、时间序列与质量字段。"],["产品分析流程","坡体分区 → 质量筛选 → 趋势对比 → 重点点位核查。"],["发现","识别持续变化或近期变化加快的候选位置，交由专业人员复核。"],["产品价值","为现场巡查提供空间范围更广、时间连续的辅助线索。"]], demoNote:"该页面为滑坡应用流程示意，不包含真实工程判定或预警结果。" },
  { key: "road", label: "公路", title: "高边坡与路基沉降监测", kicker: "ROAD & SLOPE", description: "面向高边坡、填方路基和桥隧连接段，追踪形变速率变化和演化趋势。", metrics: [["关注对象", "边坡 / 路基"], ["空间组织", "沿线分段"], ["核查方式", "趋势 + 巡检"]], tags: ["公路", "边坡", "沉降"], accent: "#0a9c93", image:"/case-road-insar.png", workflow: [["业务问题","长距离线路中，如何定位需要优先复核的持续变化路段？"],["数据","线路分段、InSAR 点位、形变速率、时间序列与质量信息。"],["产品分析流程","沿线筛查 → 区段统计 → 多点对比 → 巡检清单。"],["发现","形成候选变化区段和对应时序依据，不替代现场检测。"],["产品价值","减少无差别浏览，把巡检注意力集中到有数据依据的区段。"]], demoNote:"该页面为道路应用流程示意，所有结果仍需结合工程资料和现场核查。" },
];

export const navItems = [
  { label: "首页", href: "/" },
  { label: "形变地图", href: "/map", children: [{label:"点位分析",href:"/map"},{label:"数据集管理",href:"/datasets"}] },
  { label: "区域统计", href: "/statistics" },
  { label: "案例展示", href: "/showcase", children: cases.map(item=>({label:item.label,href:`/showcase/${item.key}`})) },
  { label: "产品能力", href: "/platform", children: [{label:"核心能力",href:"/platform"},{label:"应用场景概述",href:"/solutions"}] },
  { label: "项目实践", href: "/about" },
];

export const demoDates = ["2017.03","2017.10","2018.05","2019.01","2019.09","2020.05","2021.01","2021.09","2022.05","2023.01","2023.09","2024.05","2025.01","2025.05"];

export type InsarPoint = {
  id: string;
  name: string;
  lon: number;
  lat: number;
  velocity: number;
  velocitySource?: PascValueSource;
  displacement: number;
  coherence: number;
  coherenceSource?: PascValueSource;
  missingRate: number;
  mode: string;
  modeCanonical?: PascClassName;
  legacyMode?: boolean;
  modeSource?: string;
  modeConfidence?: number | null;
  updated: string;
  series: number[];
  dates?: string[];
  capabilityLevel?: PascCapabilityLevel;
  effectiveEpochCount?: number;
  temporalApplicability?: PascTemporalApplicability;
  spatialApplicability?: PascSpatialApplicability;
  pasc?: PascPointResult;
  changePoint?: string | null;
  slopeBefore?: number | null;
  slopeAfter?: number | null;
  warnings?: string[];
};
export const demoPoints: InsarPoint[] = [
  {id:"HK-102846",name:"海口监测点 102846",lon:110.3284,lat:20.04539,velocity:-0.73,displacement:-5.91,coherence:.91,missingRate:0,mode:"稳定",updated:"2025-05-03",series:[0,-2.55,-1.72,-.14,-.09,-2.55,-10.48,-5.23,-3.59,-1.57,.59,-4.8,-4.6,-5.91]},
  {id:"HK-102863",name:"海口监测点 102863",lon:110.3385,lat:20.05542,velocity:-8.24,displacement:-38.04,coherence:.89,missingRate:0,mode:"线性沉降",updated:"2025-05-03",series:[0,-3.9,-5.12,-7.81,-10.33,-13.54,-18.53,-21,-24.82,-28.62,-31.12,-34.28,-36.94,-38.04]},
  {id:"HK-102881",name:"海口监测点 102881",lon:110.3187,lat:20.03545,velocity:-4.22,displacement:-25.92,coherence:.88,missingRate:0,mode:"加速沉降",updated:"2025-05-03",series:[0,-2.54,-4.27,-6.15,-8.21,-10.32,-12.08,-14.98,-16.99,-19.27,-21.5,-23.45,-24.75,-25.92]},
  {id:"HK-103241",name:"海口监测点 103241",lon:110.348,lat:20.02519,velocity:4.1,displacement:18.95,coherence:.93,missingRate:0,mode:"局部抬升",updated:"2025-05-03",series:[0,.75,1.79,4.17,3.95,7.61,8.71,10.56,12.91,14.01,14.78,16.56,17.3,18.95]},
  {id:"HK-103260",name:"海口监测点 103260",lon:110.3082,lat:20.06522,velocity:.36,displacement:2.89,coherence:.90,missingRate:0,mode:"稳定",updated:"2025-05-03",series:[0,.44,1.34,-.41,-.31,.69,-3.19,3.62,5.02,7.71,4.57,2.66,1.99,2.89]},
];
