import type { PascCapabilityLevel, PascClassName, PascPointResult, PascSpatialApplicability, PascTemporalApplicability, PascValueSource } from "../types/pasc";

export type CaseKey = "city" | "landslide" | "road";

export type CaseStudy = {
  key: CaseKey; label: string; title: string; kicker: string; description: string;
  metrics: [string, string][]; tags: string[]; accent: string; image:string;
  imageAlt: string;
  visualLegend: [string, string, string];
  visualAnnotations?: { label: string; left: string; top: string }[];
  workflow: [string, string][];
  demoNote: string;
  evidenceLevel: "interactive" | "scenario";
  evidenceLabel: string;
  researchArea: {
    title: string;
    overview: string;
    facts: [string, string][];
    boundary: string;
    sources: { label: string; href: string }[];
  };
};

export const cases: CaseStudy[] = [
  {
    key: "city", label: "城市", title: "海南新埠岛建筑时序形变监测", kicker: "URBAN BUILDING DEFORMATION · XINBU ISLAND",
    description: "基于海南新埠岛 9,069 个原始监测点和 210 期 InSAR 时序，分析建筑密集区的形变过程、速率与模式差异，形成可定位、可比较的建筑形变核查线索。",
    metrics: [["监测点", "9,069 点"], ["观测期数", "210 期"], ["观测时间", "2017—2025"]], tags: ["新埠岛建筑", "真实时序", "建筑核查"], accent: "#1677ff",
    image:"/case-city-insar.webp", imageAlt:"海南新埠岛建筑密集区的 InSAR 时序形变点位空间示例", visualLegend:["负向速率","接近稳定","正向速率"],
    workflow: [["业务问题","建筑密集区中，哪些点位、时序过程与形变模式值得优先比较和核查？"],["数据","原始文件 9,069 个点、210 期累计形变：坐标、速率、相干性、六类概率、置信度与空间可靠性，未做网页降采样。"],["产品分析流程","字段兼容检查 → 时序与质量分析 → 固定六分类 → 点位概率 → 区域统计。"],["发现","形成可追溯的点位时序和区域差异线索，不把密集点直接冒充单栋建筑结论。"],["产品价值","把原始密集时序预测结果转化为可定位、可比较、可解释的城市建筑形变证据。"]],
    demoNote:"该案例直接使用项目方更新后的 9,069 点、210 期原始密集时序，未再降采样；观测时间为 2017-03-22 至 2025-05-03。源文件仍未包含建筑物轮廓面，因此不能直接输出逐建筑聚合结论；原 3,094 点、248 期 Spatial Demo 仅保留为历史回归测试资产。",
    evidenceLevel:"interactive", evidenceLabel:"真实时序 · 可交互 Demo",
    researchArea: {
      title: "河口滨水建成区中的建筑密集监测",
      overview: "新埠岛位于海口市美兰区、南渡江入海口附近，岛内建成区与滨水空间交织。河口、海岸与城市建设共同构成了需要关注局部空间差异的监测环境。",
      facts: [["区域位置","海口市美兰区新埠岛，处于南渡江河口与琼州海峡相邻的滨水区域。"],["场景特征","建筑密集区与河网、岸线和堤防空间相邻，适合从连续点位观察局部差异与时序一致性。"],["监测意义","通过密集 InSAR 点比较长期速率、累计形变和模式，为后续叠加建筑轮廓开展逐栋分析提供点级底图。"]],
      boundary: "当前 9,069 个点覆盖约 110.3401—110.3749°E、20.0810—20.0914°N；这是研究区内的点级观测范围，不代表完整行政岛域，也尚未建立点位到单栋建筑的归属关系。",
      sources: [{label:"海口市公共资源交易中心：新埠岛堤防灾后修复工程",href:"https://ggzy.haikou.gov.cn/gonggao/86641"}]
    }
  },
  {
    key: "landslide", label: "滑坡", title: "拉加镇滑坡时序形变监测", kicker: "LANDSLIDE MOTION · LAJIA",
    description: "基于青海玛沁县拉加镇 11,354 个真实监测点和 58 期 InSAR 时序，分析坡体范围内的形变过程、速率与阶段变化，形成可定位、可比较的滑坡形变核查线索。",
    metrics: [["监测点", "11,354 点"], ["观测期数", "58 期"], ["观测时间", "2021—2022"]], tags: ["拉加镇滑坡", "真实时序", "坡体核查"], accent: "#ff8a34",
    image:"/case-landslide-insar.webp", imageAlt:"拉加镇滑坡案例封面，展示坡体监测对象和形变点位的组织方式", visualLegend:["较快变化","过渡变化","稳定参照"],
    workflow: [["业务问题","如何从坡体密集监测点中定位持续变化和阶段变化位置？"],["数据","WGS84 坐标、11,354 个监测点、58 期累计形变；形变值按 0.1 mm 精度进入网页。"],["产品分析流程","数据质检 → 速率与时序浏览 → 区域框选 → 多点对比 → 重点位置核查。"],["发现","形成可追溯的坡体形变候选线索；原始数据未提供类别或相干性，不虚构分类结果。"],["产品价值","把滑坡时序数据转化为可定位、可比较、可复核的监测案例。"]],
    demoNote:"该案例使用用户提供的拉加镇滑坡真实时序数据。当前文件未提供坡体分区、相干性和人工类别，页面只展示可由坐标与时序直接计算的证据，不作为活动性判定或预警。",
    evidenceLevel:"interactive", evidenceLabel:"真实时序 · 可交互 Demo",
    researchArea: {
      title: "黄河上游高原山地城镇的滑坡监测",
      overview: "拉加镇位于青海省果洛州玛沁县，地处三江源高原山地和黄河沿岸。当地地貌地质条件复杂，降雨与既有滑坡活动使房屋、道路和基础设施的持续观测具有现实意义。",
      facts: [["区域位置","青海省果洛藏族自治州玛沁县拉加镇，位于黄河上游的高原山地环境。"],["场景特征","坡体、河谷与城镇空间相邻，地形起伏和降雨过程会共同影响形变的空间与时间表现。"],["监测意义","连续 InSAR 时序可用于筛选持续变化和阶段变化位置，为地面调查提供优先核查线索。"]],
      boundary: "当前案例覆盖 11,354 个点和 2021—2022 年 58 期时序；数据未包含正式坡体分区、地质调查结论或预警阈值，因此页面只表达遥感形变证据。",
      sources: [{label:"青海省人大：关于加大拉加镇滑坡治理力度的建议",href:"https://www.qhrd.gov.cn/yajy/202305/t20230524_212432.html"}]
    }
  },
  {
    key: "road", label: "公路", title: "海口江东新区主要道路时序形变监测", kicker: "ROAD DEFORMATION · JIANGDONG",
    description: "基于海口江东新区主要道路 27,123 个原始监测点和 175 期 InSAR 时序，以 11,383 个确定性空间样本分析沿线形变过程、速率与质量差异，形成可定位、可比较的道路形变核查线索。",
    metrics: [["监测点", "11,383 点"], ["观测期数", "175 期"], ["观测时间", "2018—2024"]], tags: ["江东新区道路", "真实时序", "沿线核查"], accent: "#16836f",
    image:"/case-road-insar.webp", imageAlt:"海口江东新区主要道路时序 InSAR 形变监测案例", visualLegend:["较快沉降","轻微变化","稳定参照"],
    workflow: [["业务问题","主要道路范围内，哪些位置呈现持续变化并值得优先复核？"],["数据","27,123 个原始点、175 期累计形变、速率、相干性与高程；网页按 25 m 网格保留 11,383 点。"],["产品分析流程","质量筛选 → 沿线浏览 → 区域框选 → 多点对比 → 核查清单。"],["发现","形成可追溯的道路变化候选位置和时序依据，不直接判定道路安全。"],["产品价值","将密集监测结果转化为可定位、可比较、可继续现场核查的道路证据。"]],
    demoNote:"该案例使用用户提供的江东新区主要道路真实监测结果。CSV 未提供道路名称、里程桩、车道方向和现场路况，因此当前按点位证据展示，不虚构路段归属、通行状态或停车结论。",
    evidenceLevel:"interactive", evidenceLabel:"真实时序 · 可交互 Demo",
    researchArea: {
      title: "滨江滨海新区建设中的道路形变观察",
      overview: "海口江东新区位于海口东海岸，规划范围西起南渡江、东至东寨港，兼有滨江、滨海、湿地与建设片区。新区道路承担片区连接功能，也穿行于多样的自然与建设环境。",
      facts: [["区域位置","海口市东海岸新区，西临南渡江、东至东寨港、北临海岸，规划面积约 298 平方公里。"],["场景特征","临江、临海、临湖的生态本底与持续建设活动并存，道路沿线环境具有明显空间差异。"],["监测意义","沿线 InSAR 时序可先筛选持续变化位置，再结合道路名称、里程和现场资料完成工程核查。"]],
      boundary: "原始文件包含 27,123 个点，网页按 25 m 网格确定性保留 11,383 个样本；当前 CSV 没有道路名称、里程桩或现场路况，页面不能直接给出路段安全结论。",
      sources: [{label:"海口江东新区：总体规划解读",href:"https://jdxq.haikou.gov.cn/xinwen/2021/show-800.html"}]
    }
  },
];

export const navItems = [
  { label: "首页", href: "/" },
  { label: "案例展示", href: "/showcase", children: cases.map(item=>({label:item.label,href:`/showcase/${item.key}`})) },
  { label: "产品与应用", href: "/platform", children: [{label:"核心能力",href:"/platform"},{label:"应用场景概述",href:"/solutions"}] },
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
