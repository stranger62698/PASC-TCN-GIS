export type CaseKey = "city" | "landslide" | "road";

export type CaseStudy = {
  key: CaseKey; label: string; title: string; kicker: string; description: string;
  metrics: [string, string][]; tags: string[]; accent: string; image:string;
};

export const cases: CaseStudy[] = [
  { key: "city", label: "城市", title: "海口城市地表形变公开示例", kicker: "URBAN DEFORMATION · HAIKOU", description: "以时序 InSAR 组织城市尺度形变结果，通过速率、累计形变与时间序列发现值得进一步核查的位置。", metrics: [["网页示例点", "4,073"], ["观测期数", "210 期"], ["观测时间", "2017—2025"]], tags: ["Sentinel-1", "时序 InSAR", "城市形变"], accent: "#1677ff", image:"/case-city-insar.png" },
  { key: "landslide", label: "滑坡", title: "滑坡体活动性与形变演化监测", kicker: "LANDSLIDE MOTION", description: "沿坡体边界组织监测点，结合速率分区与累积形变时间序列，识别持续活动区和需要现场核查的加速区。", metrics: [["监测坡体", "12 处"], ["重点区域", "34"], ["复访周期", "12 d"]], tags: ["滑坡", "坡体活动", "趋势分析"], accent: "#ff8a34", image:"/case-landslide-insar.png" },
  { key: "road", label: "公路", title: "高边坡与路基沉降监测", kicker: "ROAD & SLOPE", description: "面向高边坡、填方路基和桥隧连接段，追踪形变速率变化和异常演化趋势。", metrics: [["监测里程", "164 km"], ["异常区", "17"], ["更新频率", "月度"]], tags: ["公路", "边坡", "沉降"], accent: "#0a9c93", image:"/case-road-insar.png" },
];

export const navItems = [
  { label: "首页", href: "/" },
  { label: "形变地图", href: "/map", children: [{label:"点位分析",href:"/map"},{label:"数据集管理",href:"/datasets"}] },
  { label: "区域统计", href: "/statistics" },
  { label: "案例展示", href: "/showcase", children: cases.map(item=>({label:item.label,href:`/showcase/${item.key}`})) },
  { label: "技术方案", href: "/solutions" },
  { label: "平台介绍", href: "/platform" },
  { label: "关于我们", href: "/about" },
];

export const demoDates = ["2017.03","2017.10","2018.05","2019.01","2019.09","2020.05","2021.01","2021.09","2022.05","2023.01","2023.09","2024.05","2025.01","2025.05"];

export type InsarPoint = { id:string; name:string; lon:number; lat:number; velocity:number; displacement:number; coherence:number; missingRate:number; mode:string; updated:string; series:number[]; dates?:string[] };
export const demoPoints: InsarPoint[] = [
  {id:"HK-102846",name:"海口监测点 102846",lon:110.3284,lat:20.04539,velocity:-0.73,displacement:-5.91,coherence:.91,missingRate:0,mode:"稳定",updated:"2025-05-03",series:[0,-2.55,-1.72,-.14,-.09,-2.55,-10.48,-5.23,-3.59,-1.57,.59,-4.8,-4.6,-5.91]},
  {id:"HK-102863",name:"海口监测点 102863",lon:110.3385,lat:20.05542,velocity:-8.24,displacement:-38.04,coherence:.89,missingRate:0,mode:"线性沉降",updated:"2025-05-03",series:[0,-3.9,-5.12,-7.81,-10.33,-13.54,-18.53,-21,-24.82,-28.62,-31.12,-34.28,-36.94,-38.04]},
  {id:"HK-102881",name:"海口监测点 102881",lon:110.3187,lat:20.03545,velocity:-4.22,displacement:-25.92,coherence:.88,missingRate:0,mode:"加速沉降",updated:"2025-05-03",series:[0,-2.54,-4.27,-6.15,-8.21,-10.32,-12.08,-14.98,-16.99,-19.27,-21.5,-23.45,-24.75,-25.92]},
  {id:"HK-103241",name:"海口监测点 103241",lon:110.348,lat:20.02519,velocity:4.1,displacement:18.95,coherence:.93,missingRate:0,mode:"局部抬升",updated:"2025-05-03",series:[0,.75,1.79,4.17,3.95,7.61,8.71,10.56,12.91,14.01,14.78,16.56,17.3,18.95]},
  {id:"HK-103260",name:"海口监测点 103260",lon:110.3082,lat:20.06522,velocity:.36,displacement:2.89,coherence:.90,missingRate:0,mode:"稳定",updated:"2025-05-03",series:[0,.44,1.34,-.41,-.31,.69,-3.19,3.62,5.02,7.71,4.57,2.66,1.99,2.89]},
];
