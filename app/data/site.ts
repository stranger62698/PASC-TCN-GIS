export type CaseKey = "city" | "power" | "road" | "mining" | "railway" | "emergency";

export type CaseStudy = {
  key: CaseKey; label: string; title: string; kicker: string; description: string;
  metrics: [string, string][]; tags: string[]; accent: string;
};

export const cases: CaseStudy[] = [
  { key: "city", label: "城市", title: "海口城市地表形变健康体检", kicker: "URBAN HEALTH · HAIKOU", description: "以时序 InSAR 建立城市尺度毫米级形变底图，识别沉降集聚区，并为重点设施筛查提供连续证据。", metrics: [["有效点", "407,200"], ["观测周期", "2017—2025"], ["空间分辨率", "20 m"]], tags: ["Sentinel-1", "PS-InSAR", "城市安全"], accent: "#1677ff" },
  { key: "power", label: "电力", title: "输电走廊与塔基稳定性巡查", kicker: "POWER CORRIDOR", description: "将塔位、廊道与形变热点叠加分析，快速定位需要现场复核的持续沉降和坡体异常。", metrics: [["走廊长度", "286 km"], ["重点塔基", "34"], ["复访周期", "12 d"]], tags: ["塔基", "廊道", "风险筛查"], accent: "#2c6cff" },
  { key: "road", label: "公路", title: "高边坡与路基沉降监测", kicker: "ROAD & SLOPE", description: "面向高边坡、填方路基和桥隧连接段，追踪形变速率变化和异常演化趋势。", metrics: [["监测里程", "164 km"], ["异常区", "17"], ["更新频率", "月度"]], tags: ["公路", "边坡", "沉降"], accent: "#0a9c93" },
  { key: "mining", label: "矿山", title: "露天矿边坡与采动沉降识别", kicker: "MINING SAFETY", description: "结合多期形变结果识别沉降中心、采动边界与局部加速区，为生产调度和安全管理提供空间依据。", metrics: [["覆盖面积", "92 km²"], ["监测期", "210"], ["预警区", "9"]], tags: ["露天矿", "采动", "边坡"], accent: "#ff8a34" },
  { key: "railway", label: "铁路", title: "铁路沿线基础设施形变筛查", kicker: "RAILWAY ASSET", description: "按线路里程组织监测点，联动查看路基、站场和桥隧周边的空间形变及单点时间序列。", metrics: [["线路", "318 km"], ["资产点", "1,840"], ["高风险", "21"]], tags: ["铁路", "线性工程", "资产管理"], accent: "#6954d9" },
  { key: "emergency", label: "应急响应", title: "地质灾害应急形变回溯", kicker: "24 / 7 RESPONSE", description: "快速调取历史 SAR 影像，回溯灾前变化并生成重点区域形变分布、趋势曲线和现场核查建议。", metrics: [["响应", "24 h"], ["历史回溯", "8 yr"], ["成果", "WebGIS"]], tags: ["应急", "历史回溯", "快速制图"], accent: "#e94b4b" },
];

export const navItems = [
  { label: "首页", href: "/" },
  { label: "形变地图", href: "/map", children: [{label:"点位分析",href:"/map"},{label:"数据集管理",href:"/datasets"}] },
  { label: "区域统计", href: "/statistics" },
  { label: "案例展示", href: "/showcase", children: cases.slice(0,5).map(item=>({label:item.label,href:`/showcase/${item.key}`})) },
  { label: "技术方案", href: "/solutions" },
  { label: "平台介绍", href: "/platform" },
  { label: "关于我们", href: "/about" },
];

export const demoDates = ["2017.03","2017.10","2018.05","2019.01","2019.09","2020.05","2021.01","2021.09","2022.05","2023.01","2023.09","2024.05","2025.01","2025.05"];

export type InsarPoint = { id:string; name:string; lon:number; lat:number; velocity:number; displacement:number; coherence:number; mode:string; updated:string; series:number[]; dates?:string[] };
export const demoPoints: InsarPoint[] = [
  {id:"HK-102846",name:"海口监测点 102846",lon:110.3284,lat:20.04539,velocity:-0.73,displacement:-5.91,coherence:.91,mode:"稳定",updated:"2025-05-03",series:[0,-2.55,-1.72,-.14,-.09,-2.55,-10.48,-5.23,-3.59,-1.57,.59,-4.8,-4.6,-5.91]},
  {id:"HK-102863",name:"海口监测点 102863",lon:110.3385,lat:20.05542,velocity:-8.24,displacement:-38.04,coherence:.89,mode:"线性沉降",updated:"2025-05-03",series:[0,-3.9,-5.12,-7.81,-10.33,-13.54,-18.53,-21,-24.82,-28.62,-31.12,-34.28,-36.94,-38.04]},
  {id:"HK-102881",name:"海口监测点 102881",lon:110.3187,lat:20.03545,velocity:-4.22,displacement:-25.92,coherence:.88,mode:"加速沉降",updated:"2025-05-03",series:[0,-2.54,-4.27,-6.15,-8.21,-10.32,-12.08,-14.98,-16.99,-19.27,-21.5,-23.45,-24.75,-25.92]},
  {id:"HK-103241",name:"海口监测点 103241",lon:110.348,lat:20.02519,velocity:4.1,displacement:18.95,coherence:.93,mode:"局部抬升",updated:"2025-05-03",series:[0,.75,1.79,4.17,3.95,7.61,8.71,10.56,12.91,14.01,14.78,16.56,17.3,18.95]},
  {id:"HK-103260",name:"海口监测点 103260",lon:110.3082,lat:20.06522,velocity:.36,displacement:2.89,coherence:.90,mode:"稳定",updated:"2025-05-03",series:[0,.44,1.34,-.41,-.31,.69,-3.19,3.62,5.02,7.71,4.57,2.66,1.99,2.89]},
];
