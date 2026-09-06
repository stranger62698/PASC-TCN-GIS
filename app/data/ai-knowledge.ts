export type KnowledgeChunk = { id: string; title: string; tags: string[]; content: string; source: string };

export const AI_KNOWLEDGE: KnowledgeChunk[] = [
  { id: "insar-velocity", title: "InSAR 形变速率解释", tags: ["InSAR", "速率", "沉降"], content: "形变速率用于描述视线向位移随时间的变化。负值常对应远离卫星方向的运动，但不能脱离轨道、观测几何与现场条件直接等同于垂直沉降。", source: "LANJIFYW 内置方法说明" },
  { id: "insar-quality", title: "相干性与缺测率", tags: ["相干性", "缺测", "质量"], content: "相干性越高通常代表干涉测量越稳定；缺测率高会降低时序模式与统计结果的可信度。候选点应同时检查 coherence 与 missing rate。", source: "LANJIFYW 数据质量说明" },
  { id: "pasc-purpose", title: "PASC-TCN 的用途", tags: ["PASC-TCN", "模式识别", "时序"], content: "PASC-TCN 对 InSAR 位移时序进行模式识别，输出稳定型、线性型、分段型、减速型、加速型和未定义型六类结果及置信度。模式结果用于候选筛查，不替代人工判读。", source: "LANJIFYW PASC-TCN 方法说明" },
  { id: "pasc-accelerating", title: "加速模式", tags: ["Accelerating", "加速", "风险"], content: "加速模式表示近期形变变化幅度可能增大。它适合进入优先核查队列，但应结合相干性、缺测率、邻域一致性和外部地质信息复核。", source: "LANJIFYW 模式解释" },
  { id: "pasc-undefined", title: "Undefined 模式", tags: ["Undefined", "未定义", "质量"], content: "Undefined 表示序列未满足现有模式判别条件，可能来自噪声、缺测、模型置信不足或真实的复杂行为。不能直接视为安全或异常。", source: "LANJIFYW 模式解释" },
  { id: "road-buffer", title: "道路缓冲区分析", tags: ["道路", "buffer", "缓冲区"], content: "道路风险筛查可在道路中心线周边建立缓冲距离，统计落入缓冲区的 InSAR 点、异常点比例、最不利速率和与滑坡面的空间关系。缓冲距离需要按道路等级和数据分辨率调整。", source: "LANJIFYW GIS 分析说明" },
  { id: "landslide-intersection", title: "滑坡面相交证据", tags: ["滑坡", "intersection", "相交"], content: "道路与滑坡面相交属于空间关联证据，只说明几何上存在重叠或穿越，不自动证明灾害因果。应结合时间、地形、调查记录与现场核查。", source: "LANJIFYW GIS 分析说明" },
  { id: "evidence", title: "分析依据与人工确认", tags: ["Evidence", "证据", "人工确认"], content: "分析结果应列出数据范围、关键统计值与方法来源，并允许在地图定位相关点或要素。最终候选任务需要由人工确认。", source: "LANJIFYW 分析设计原则" },
  { id: "scope", title: "地图范围约束", tags: ["范围", "Scope", "地图"], content: "统计和 AI 结论必须明确作用范围，例如当前地图视野、框选区域或整个数据集。没有明确范围时不应把局部结果泛化为全域结论。", source: "LANJIFYW 分析范围说明" },
];
