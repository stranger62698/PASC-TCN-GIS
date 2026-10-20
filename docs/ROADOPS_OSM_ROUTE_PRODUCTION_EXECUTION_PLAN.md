# 澜迹 RoadOps：OSM 路网数据生产与外业驾车规划执行方案

> 文档状态：可执行方案 v1.0  
> 日期：2026-09-21  
> 实施基础：现有澜迹 InSAR WebGIS（React/Vinext + Leaflet）  
> 目标岗位：地图路网数据产品经理  
> 本文档中的“已实现”以当前仓库代码为准；“本期实施”和“后续扩展”均不得在作品集中写成已上线能力。

## 1. 执行结论

需要引入 OSM，但必须区分两种完全不同的 OSM 能力：

1. **OSM 底图瓦片**：当前平台已经在使用，只负责地图背景展示，不能用于道路拓扑检查、路网数据生产或路线优化。
2. **OSM 道路矢量数据**：本项目需要新增，用于建立道路数据模型、拓扑质量检查、多源证据关联和道路工单。

整体方案不更换现有 Leaflet，也不引入滴图 JS API。推荐架构为：

```text
OSM 道路矢量基线 ─┐
InSAR 形变点/区域 ─┼─> RoadOps 道路数据生产与质量治理
滑坡/业务面       ─┤             │
现场照片/轨迹     ─┘             ├─> 道路问题候选与审核工单
                                  └─> 外业核查候选点
                                             │
                                  本地任务选择与顺序优化
                                             │
                                  滴图 Web Service 驾车算路
                                             │
                                  Leaflet 路线与结果可视化
```

核心原则：

- OSM 提供开源基线路网和道路属性。
- 现有 InSAR、滑坡、现场照片提供风险与证据。
- 本地算法负责候选点选择和访问顺序优化。
- 滴图只负责真实道路距离、ETA 和最终路线几何。
- 路线规划是地图生产闭环的下游验证与外业调度，不替代路网数据生产。

## 2. 为什么不能只用当前 OSM 底图

当前 `WebGisMap` 加载的是 `tile.openstreetmap.org` 栅格瓦片。瓦片本质上是已经渲染好的地图图片：

- 可以看见道路；
- 不能读取某条道路的 `oneway`、`maxspeed`、`access` 等属性；
- 不能判断道路是否断裂、重复、悬挂或相交未打断；
- 不能建立节点—路段拓扑图；
- 不能直接用于 TSP、OD 成本矩阵或自定义路由。

因此需要额外导入 OSM 道路矢量数据，并在项目内转换成统一的 `RoadSegment` 数据模型。

## 3. 建议使用的数据图层

### 3.1 MVP 必需图层

| 图层 | 来源 | 作用 | 是否已有 |
|---|---|---|---|
| OSM 背景瓦片 | OSM 标准瓦片 | 地图浏览背景 | 已有 |
| OSM 道路中心线 | Overpass/区域 PBF | 道路模型、拓扑与属性质量检查 | 待新增 |
| InSAR 监测点 | 当前 CSV 数据 | 道路邻域形变证据 | 已有 |
| 异常区域 | 当前规则与空间聚类 | 形成核查候选范围 | 已有 |
| 现场照片点 | EXIF/OCR/人工坐标 | 外业证据与人工复核 | 已有 |

### 3.2 推荐但非首期必需

| 图层 | 推荐来源 | 用途 | 阶段 |
|---|---|---|---|
| 行政区边界 | OSM relation 或合规公开数据 | 数据裁剪、统计范围 | P1/P2 |
| 建筑轮廓 | OSM building | 道路周边场景解释 | P6 |
| 土地利用 | OSM landuse | 道路环境与场景分类 | P6 |
| GPS 轨迹 | 脱敏样例或自采 | 轨迹匹配、疑似新路/断路发现 | P6 |
| DEM/坡度 | 合规公开 DEM | 山区道路坡度与可达性解释 | P6 |

首期不要同时堆叠大量图层。对目标 JD 最有价值的最小组合是：

> OSM 道路矢量 + InSAR + 现场照片 + 驾车路线结果

## 4. OSM 数据获取与许可边界

### 4.1 小范围演示数据

优先使用 Overpass API 获取一个明确边界内的道路：

- 只查询 `way[highway]` 及完整节点；
- 只选择海口江东新区或一个更小的演示区域；
- 将原始响应保存在开发资产目录，不在页面运行时重复查询；
- 预处理后输出精简 GeoJSON 供演示使用；
- 记录查询时间、边界、查询语句和 OSM 许可信息。

公共 Overpass 适合小项目和小范围查询，不应作为高频生产接口或大范围批量下载服务。

### 4.2 较大范围数据

城市/省域方案使用区域 `.osm.pbf`，再通过 `osmium extract` 按边界裁剪：

```powershell
osmium extract -b <west>,<south>,<east>,<north> china-latest.osm.pbf -o area.osm.pbf
```

注意：

- 不把中国全量 PBF 放入 Git 仓库或前端发布物；
- 只提交裁剪、过滤和脱敏后的演示 GeoJSON；
- 大文件放到外部数据目录，并在 manifest 中记录 SHA-256、来源和提取日期；
- 中国区域的 OSM 覆盖度和属性完整度可能不均衡，作品中必须标注“开源路网基线，不代表权威道路数据”。

### 4.3 OSM 许可要求

OSM 数据采用 ODbL：

- 页面必须显示 `© OpenStreetMap contributors`；
- 来源说明需链接到 OSM Copyright/ODbL；
- 公开分发基于 OSM 改造的数据库前，需评估 ODbL 的相同许可义务；
- 不得把其他地图服务商的受限数据混入 OSM 并声称为可公开 OSM 派生数据；
- 每个路网资产都保存 `source`、`license`、`extractedAt`、`bounds` 和处理脚本版本。

OSM 社区标准瓦片只用于正常交互浏览：不得批量预抓、离线打包或用无头浏览器扫描大量区域。需要离线地图时使用允许离线的供应商或自建瓦片服务。

## 5. 产品定位

产品名称：

> 澜迹 RoadOps：多源融合驱动的道路风险发现与外业核查生产平台

核心用户：

- 地图数据产品经理；
- 道路数据生产与质检人员； 
- 城市基础设施巡查人员；
- GIS 分析人员；
- 外业调查组负责人。

核心问题：

1. 哪些道路数据存在拓扑、属性或新鲜度问题？
2. 哪些道路附近出现了值得复核的 InSAR/滑坡/现场证据？
3. 自动发现的候选如何进入人工审核和版本发布流程？
4. 有限工作时间内应该核查哪些点，按什么顺序访问？
5. 如何用质量和生产效率指标持续优化流程？

## 6. 当前平台可复用能力

### 已实现

- Leaflet WebGIS、OSM/Esri/天地图/自定义底图切换；
- GeoJSON 与 Shapefile ZIP 导入；
- CRS 识别与 WGS84 转换；
- 点、线、面业务图层渲染；
- 道路图层自动识别；
- InSAR 点与道路缓冲区空间关联；
- 道路与滑坡面相交分析；
- 道路风险评分；
- InSAR 异常区域与核查价值排序；
- 现场照片 EXIF/OCR 坐标提取；
- 现场照片与 InSAR 点候选关联及人工确认；
- 静态 Vercel 发布与根目录 Serverless Function 模式。

### 本期必须新增

- OSM 道路矢量演示资产；
- 正式 `RoadSegment`/`RoadNode` 数据模型；
- 道路拓扑和属性质量规则；
- 道路问题候选、审核状态和证据链；
- 质量与生产效能指标；
- 滴图驾车路线安全代理；
- 小规模 OD 成本矩阵和访问顺序优化；
- 路线图层、序号点和计划汇总界面；
- API 配额、缓存、限流和降级逻辑。

## 7. MVP 范围与非目标

### MVP 包含

- 一个小范围 OSM 道路样例；
- 道路规范化和数据血缘；
- 10 类道路质量检查；
- 道路风险/质量问题候选列表；
- 人工接受、驳回、待核查状态；
- 6—10 个候选点的驾车外业规划；
- 优化前后距离、时间和核查价值对比；
- 质量和生产效率看板；
- 作品集案例说明与演示数据。

### MVP 不包含

- 完整导航 App；
- 实时车辆跟踪；
- 全国路网或车道级路网；
- 车规级导航拓扑和全部转向限制；
- 多车、多仓、多班次复杂 VRP；
- 自动修改或回写 OSM；
- 未经许可的商业地图数据下载；
- 将演示结果描述为真实物流/无人车生产成绩。

## 8. 目标架构

```text
┌──────────────────────── 浏览器 ────────────────────────┐
│ MapWorkspace / RoadOpsWorkspace                       │
│  ├─ OSM道路、InSAR、现场证据图层                       │
│  ├─ 道路质量与审核工作区                               │
│  ├─ 外业规划工作区                                     │
│  └─ 指标看板                                           │
│                                                        │
│ 本地计算                                               │
│  ├─ RoadSegment规范化                                  │
│  ├─ 拓扑/属性质量规则                                  │
│  ├─ 候选点初筛                                         │
│  └─ 最近邻 + 2-opt / Orienteering                      │
└──────────────────────────┬─────────────────────────────┘
                           │ 同源 POST
┌──────────────────────────▼─────────────────────────────┐
│ Vercel Function: /api/roadops/*                        │
│  ├─ 请求验证与坐标检查                                 │
│  ├─ 滴图 Key 隔离                                      │
│  ├─ 缓存、去重、限流、日预算                           │
│  └─ 滴图响应裁剪和错误标准化                           │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTPS
                    滴图 Web Service
```

### 部署约束

当前生产使用 `build:static`。因此：

- 浏览器组件继续进入静态发布物；
- 滴图代理放在根目录 `api/roadops/*.ts`；
- 不能把滴图 Key 放在浏览器或 `NEXT_PUBLIC_*` 环境变量；
- `app/api` 可以保留用于非静态运行，但正式 Vercel 静态发布必须有根目录函数对应实现；
- 新 Key 命名为 `DIDI_MAP_WEB_SERVICE_KEY`；已出现在截图中的旧 Key 必须停用。

## 9. 数据模型

### 9.1 道路节点

```ts
export type RoadNode = {
  id: string;
  longitude: number;
  latitude: number;
  source: "osm" | "user" | "derived";
  sourceId: string | null;
  connectedSegmentIds: string[];
};
```

### 9.2 道路路段

```ts
export type RoadSegment = {
  id: string;
  source: "osm" | "user" | "derived";
  sourceId: string;
  sourceVersion: string | null;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  startNodeId: string;
  endNodeId: string;
  name: string | null;
  reference: string | null;
  roadClass: string;
  direction: "both" | "forward" | "reverse" | "unknown";
  maxSpeedKph: number | null;
  access: string | null;
  surface: string | null;
  bridge: boolean;
  tunnel: boolean;
  status: "active" | "suspected_change" | "under_review" | "accepted" | "rejected" | "published";
  confidence: number | null;
  sourceUpdatedAt: string | null;
  importedAt: string;
  rawTags: Record<string, string>;
};
```

### 9.3 多源证据

```ts
export type RoadEvidence = {
  id: string;
  roadSegmentId: string;
  type: "insar" | "landslide" | "field_photo" | "gps_trace" | "manual" | "topology_rule";
  sourceId: string;
  capturedAt: string | null;
  distanceMeters: number | null;
  confidence: number | null;
  summary: string;
  status: "candidate" | "confirmed" | "rejected" | "stale";
};
```

### 9.4 道路问题工单

```ts
export type RoadIssue = {
  id: string;
  roadSegmentIds: string[];
  ruleCode: string;
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  evidenceIds: string[];
  status: "candidate" | "needs_field_check" | "accepted" | "rejected" | "published";
  assignee: string | null;
  createdAt: string;
  reviewedAt: string | null;
  decisionNote: string | null;
};
```

### 9.5 外业任务与路线

```ts
export type InspectionStop = {
  id: string;
  roadIssueId: string;
  longitude: number;
  latitude: number;
  inspectionValue: number;
  serviceMinutes: number;
  required: boolean;
};

export type FieldRoutePlan = {
  id: string;
  origin: [number, number];
  destination: [number, number];
  returnToOrigin: boolean;
  orderedStops: InspectionStop[];
  drivingDistanceMeters: number;
  drivingDurationSeconds: number;
  serviceDurationSeconds: number;
  totalValue: number;
  geometry: [number, number][];
  strategy: "time" | "distance" | "default";
  provider: "didi" | "demo";
  cached: boolean;
  generatedAt: string;
};
```

## 10. OSM 字段规范化

| OSM 标签 | RoadSegment 字段 | 规则 |
|---|---|---|
| `osm_id` | `sourceId` | 字符串保存，禁止转成可能溢出的普通整数 |
| `highway` | `roadClass` | 保留原值，同时映射产品分组 |
| `name` | `name` | 空值允许，但计入属性完整率 |
| `ref` | `reference` | 原样保存 |
| `oneway` | `direction` | 解析 `yes/1/-1/no`，其余为 unknown |
| `maxspeed` | `maxSpeedKph` | 解析数值及 mph；无法解析则为空并保留 rawTags |
| `access`/`motor_vehicle` | `access` | 不擅自补充法律通行结论 |
| `surface` | `surface` | 原样保留并做分类统计 |
| `bridge` | `bridge` | `yes` 或已知桥梁类型为 true |
| `tunnel` | `tunnel` | `yes` 或已知隧道类型为 true |
| `timestamp/version` | `sourceUpdatedAt/sourceVersion` | 若提取工具保留则写入 |

产品级道路分类建议：

```text
expressway: motorway / trunk
arterial: primary / secondary
collector: tertiary / unclassified
local: residential / living_street
service: service
non_motor: pedestrian / footway / cycleway / path
unknown: road / 其他无法识别值
```

`highway=road` 应作为“分类未知”质量问题，而不是默认可驾车道路。

## 11. 道路质量规则

第一版至少实现以下规则：

| 代码 | 规则 | 输出 |
|---|---|---|
| R001 | 坐标非法、空几何或少于2个点 | 高优先级错误 |
| R002 | 零长度或极短异常路段 | 中优先级候选 |
| R003 | 重复几何或高度重叠道路 | 中优先级候选 |
| R004 | 悬挂端点且不在合理道路终点 | 中优先级候选 |
| R005 | 几何相交但没有共享拓扑节点 | 高优先级候选 |
| R006 | 自相交或异常折返 | 中优先级候选 |
| R007 | `highway=road` 或未知分类 | 低/中优先级候选 |
| R008 | 名称、方向、限速等关键属性缺失 | 属性质量候选 |
| R009 | 单行方向与几何/相邻路段明显冲突 | 高优先级候选 |
| R010 | 道路邻域存在高价值 InSAR/滑坡证据 | 外业核查候选 |

规则结果必须包含：规则版本、参数、输入数量、命中数量、样例、运行时间和错误数。

## 12. 数据生产流程

```text
1. 数据接入
   OSM/用户道路/InSAR/滑坡/照片/轨迹
          ↓
2. 标准化
   CRS、字段、几何、数据血缘
          ↓
3. 自动检查
   拓扑规则、属性规则、空间风险规则
          ↓
4. 候选合并
   同一路段同类问题去重，聚合证据
          ↓
5. 人工审核
   接受 / 驳回 / 需要外业核查
          ↓
6. 外业规划
   候选点选择、访问顺序、滴图驾车路线
          ↓
7. 现场回传
   照片、位置、备注、核查状态
          ↓
8. 版本发布
   变更集、质量报告、审计记录
          ↓
9. 下游验证
   路径、ETA、可达性与业务影响对比
```

MVP 中“版本发布”只发布到项目内部演示版本，不自动回写 OSM 或第三方地图。

## 13. 驾车路径规划与访问顺序优化

### 13.1 两层职责

**本地优化器：**

- 根据风险/质量问题计算核查价值；
- 在工作时长内选择哪些点；
- 根据道路成本矩阵安排访问顺序；
- 输出纳入和未纳入原因。

**滴图 Web Service：**

- 计算真实驾车距离和 ETA；
- 返回最终道路折线；
- 支持时间优先、距离更短、高速优先和不走高速；
- 不承担本项目的业务价值计算。

### 13.2 规划步骤

1. 从全部道路问题中按严重度、证据置信度、数据新鲜度筛到最多20个。
2. 用直线距离和空间聚类预筛到6—10个。
3. 请求6—10个点之间的有向道路成本矩阵。
4. 最近邻生成初始顺序。
5. 2-opt 改善绕路。
6. 加入现场服务时长和工作结束时间。
7. 按“新增核查价值/新增总时间”插入或移除点。
8. 将最终顺序作为途经点请求一次完整滴图路线。
9. 在地图显示编号、道路折线、时间、里程和推荐原因。

### 13.3 目标函数

```text
maximize:
  Σ inspectionValue(selectedStop)
  - λ1 × drivingMinutes
  - λ2 × overtimeMinutes
  - λ3 × lowConfidencePenalty
```

第一版参数由产品配置固定并展示，不进行黑箱自动学习。

### 13.4 约束

- 最多10个优化候选点；
- 最终滴图途经点不超过官方支持上限；
- 单调查组、单车辆；
- 支持返回起点或指定终点；
- 支持强制核查点；
- 支持每点预计核查时长；
- 总时长不得超过工作结束时间；
- 坐标转换失败的点不得进入路线计算。

## 14. 滴图 API 与额度保护

### 14.1 安全要求

- 立即停用已经在截图中暴露的旧 Key；
- 新 Key 只保存在 `DIDI_MAP_WEB_SERVICE_KEY`；
- 前端只访问本站 `/api/roadops/*`；
- 服务端只调用固定滴图域名和固定路径；
- 不允许用户传入上游 URL；
- 日志不得记录 Key、完整 Cookie 或精确用户身份信息。

### 14.2 服务端预算

建议默认配置：

```text
DIDI_ROUTE_DAILY_BUDGET=300
DIDI_ROUTE_PER_USER_DAILY_LIMIT=20
DIDI_ROUTE_QPS_LIMIT=1
DIDI_ROUTE_CACHE_TTL_SECONDS=1800
DIDI_ROUTE_MAX_MATRIX_POINTS=8
```

即使账户显示5,000次/日，演示站也只开放300次内部预算，避免公开访问耗尽账户配额。

### 14.3 调用治理

- 页面加载、地图缩放、拖动和点选不得自动算路；
- 只有点击“生成路线”才发起请求；
- 相同点集、顺序、策略和时间桶命中缓存；
- 相同并发请求合并；
- 前端按钮执行期间禁用，防止重复提交；
- 70%预算时显示内部告警；
- 90%时只允许登录用户；
- 100%时返回演示路线或缓存结果；
- 保存每日调用量、缓存命中率、失败率和平均延迟；
- 用受控实验确认滴图 `packs` 的额度计数方式，确认前按每个 pack 都可能计数估算。

### 14.4 坐标转换

InSAR 数据为 WGS84。滴图转换结果应：

- 数据集导入时一次性批量转换；
- 以原始坐标哈希作为缓存键；
- 保存原始 WGS84 和转换后服务坐标；
- 不在每次地图重绘时重复转换；
- 转换失败时明确报错，不静默使用可能偏移的坐标。

## 15. API 合约

### 15.1 最终路线

`POST /api/roadops/driving`

```json
{
  "origin": [110.35, 20.03],
  "destination": [110.35, 20.03],
  "waypoints": [[110.36, 20.04], [110.37, 20.02]],
  "departureTime": "2026-09-21T09:00:00+08:00",
  "strategy": "time"
}
```

服务端响应：

```json
{
  "route": {
    "distanceMeters": 12800,
    "durationSeconds": 1860,
    "geometry": [[110.35, 20.03], [110.351, 20.031]],
    "tag": "平台推荐",
    "provider": "didi",
    "cached": false
  },
  "quota": {
    "budgetState": "normal"
  }
}
```

不得把上游原始错误对象和 Key 返回给浏览器。

### 15.2 道路成本矩阵

`POST /api/roadops/cost-matrix`

```json
{
  "points": [
    { "id": "origin", "coordinate": [110.35, 20.03] },
    { "id": "stop-1", "coordinate": [110.36, 20.04] }
  ],
  "departureTime": "2026-09-21T09:00:00+08:00",
  "strategy": "time"
}
```

约束：

- MVP 最多8个点；
- 服务端生成有向 OD 对并分批调用；
- 失败单元返回 `null` 和原因，不能用0代替；
- 矩阵必须记录生成时间、服务商和策略；
- 优化器发现关键边为空时应停止，而不是生成虚假路线。

## 16. 前端工作区

### 16.1 道路数据工作区

- 图层选择与来源说明；
- 道路属性表；
- 按等级、方向、状态、质量问题筛选；
- 点击道路查看原始 OSM 标签、规范化字段和数据血缘；
- 显示拓扑节点和问题位置。

### 16.2 生产审核工作区

- 候选问题队列；
- 严重度、规则、证据数、更新时间；
- 接受、驳回、需要外业核查；
- 审核备注；
- 修改前后字段对比；
- 可追踪的状态时间线。

### 16.3 外业规划工作区

- 出发地：地图选点、当前位置或保存坐标；
- 终点：返回起点或指定位置；
- 开始/结束时间；
- 单点核查时长；
- 候选点选择与强制点；
- 路线策略；
- 生成路线按钮；
- 地图编号点、真实道路折线；
- 总里程、驾车时间、现场时间、总价值；
- 纳入/未纳入解释；
- 优化前后对比。

### 16.4 指标中心

质量指标：

- 几何合法率；
- 拓扑通过率；
- 属性完整率；
- 未知道路分类率；
- 多源证据一致率；
- 候选接受率/驳回率；
- 数据新鲜度。

生产效率指标：

- 每次检查路段数；
- 规则运行耗时；
- 自动候选数量；
- 单工单平均审核时长；
- 自动化覆盖率；
- 外业核查点数；
- 路线优化节省里程/时间；
- API 调用量和缓存命中率。

## 17. 推荐文件结构

```text
app/
  components/
    RoadOpsWorkspace.tsx
    RoadLayerPanel.tsx
    RoadIssuePanel.tsx
    FieldRoutePlanner.tsx
    RoadOpsMetrics.tsx
  lib/
    roadops/
      osm-normalize.ts
      road-topology.ts
      road-quality.ts
      road-evidence.ts
      inspection-value.ts
      route-optimizer.ts
      route-contract.ts
  types/
    roadops.ts

api/
  roadops/
    driving.ts
    cost-matrix.ts

scripts/
  prepare-osm-road-demo.mjs
  validate-roadops-demo.mjs

public/data/roadops/
  jiangdong-roads.geojson
  jiangdong-roads.manifest.json
  demo-route.json

docs/
  ROADOPS_OSM_ROUTE_PRODUCTION_EXECUTION_PLAN.md
  ROADOPS_ROAD_DATA_SPEC.md
  ROADOPS_QUALITY_RULES.md

tests/
  roadops-osm-normalize.test.ts
  roadops-topology.test.ts
  roadops-quality.test.ts
  roadops-route-optimizer.test.ts
  roadops-api-contract.test.ts
  roadops-ui.test.ts
```

## 18. 分阶段实施计划

本节保留详细功能拆解；实际逐阶段执行、验收门、证据目录、本地优先和最终一次性发布规则，以 [`ROADOPS_PHASED_LOCAL_EXECUTION.md`](./ROADOPS_PHASED_LOCAL_EXECUTION.md) 为准。Phase 0—6 只在本地实施，Phase 7 在用户明确确认前保持暂停。

### P0：安全与范围冻结

任务：

- [ ] 删除/重置截图中暴露的滴图 Key；
- [ ] 创建服务端新 Key；
- [ ] 明确 MVP 演示区域；
- [ ] 冻结最多8个矩阵点、10个候选点、单调查组范围；
- [ ] 建立 RoadOps 功能开关，未配置 Key 时隐藏实时按钮并展示演示结果。

验收：

- 仓库、浏览器源码和网络响应中不存在 Key；
- 未配置 Key 时页面仍可完整演示；
- 文案不声称支持真实生产规模。

### P1：OSM 道路演示数据

任务：

- [ ] 确认江东新区小范围边界；
- [ ] 保存 Overpass 查询或 PBF 裁剪配置；
- [ ] 只提取需要的道路及标签；
- [ ] 输出精简 GeoJSON；
- [ ] 生成 manifest：来源、许可、边界、提取时间、数量、SHA-256；
- [ ] 在地图中作为独立道路矢量图层加载。

验收：

- GeoJSON 可由当前 GIS 导入器读取；
- 所有几何均为有效 WGS84；
- 页面显示 OSM attribution；
- 数据文件体积适合公开演示；
- 重复构建得到相同结果或明确记录上游版本变化。

### P2：道路模型与质量规则

任务：

- [ ] 新增 `RoadNode`、`RoadSegment`、`RoadEvidence`、`RoadIssue`；
- [ ] 实现 OSM 字段规范化；
- [ ] 建立端点节点和相邻路段索引；
- [ ] 实现 R001—R010；
- [ ] 规则结果可导出 JSON/CSV；
- [ ] 单元测试覆盖正常、异常和边界输入。

验收：

- 相同输入产生确定性结果；
- 每条问题能定位到道路和规则；
- 未知字段不丢失，保存在 `rawTags`；
- 规则失败不破坏现有地图和 InSAR 数据；
- 10类规则都有最少一个测试样例。

### P3：生产审核闭环

任务：

- [ ] 增加候选问题队列；
- [ ] 支持接受、驳回、需要外业；
- [ ] 关联 InSAR、滑坡和照片证据；
- [ ] 记录审核备注和状态时间；
- [ ] 增加版本差异预览；
- [ ] 导出审核清单。

验收：

- 每次状态变化可追踪；
- 驳回不删除原始候选；
- 证据与道路关系可人工确认；
- 刷新后演示状态可恢复（本地存储或现有持久化机制）。

### P4：滴图驾车与路线优化

任务：

- [ ] 新增根目录 Vercel Function；
- [ ] 定义并测试请求/响应合约；
- [ ] 加入同源检查、正文上限、坐标校验、限流和超时；
- [ ] 执行小规模有向成本矩阵；
- [ ] 实现最近邻、2-opt 和时间预算插入；
- [ ] 请求最终真实道路折线；
- [ ] Leaflet 增加路线图层和数字序号；
- [ ] 保存演示路线用于无 Key/额度耗尽降级。

验收：

- Key 不进入前端；
- 页面加载不产生路线请求；
- 相同输入命中缓存；
- 不可达/超时/上游失败有明确状态；
- 路线折线、距离和时长能够显示；
- 优化顺序在固定测试矩阵上优于初始顺序；
- 额度达到内部上限时不会继续调用滴图。

### P5：指标中心与作品集证据

任务：

- [ ] 汇总道路质量指标；
- [ ] 汇总审核漏斗；
- [ ] 汇总路线优化收益；
- [ ] 汇总 API 使用与缓存；
- [ ] 增加方法说明、限制和数据来源；
- [ ] 生成一套固定演示数据和截图；
- [ ] 更新产品案例文档和简历表述。

验收：

- 指标都有定义、分母和时间范围；
- 不使用无法追溯的虚构数字；
- 演示在无滴图 Key 状态下仍可复现；
- 能完整讲述“发现—生产—核查—发布—验证”闭环。

### P6：后续扩展（不阻塞 MVP）

- [ ] GPS 轨迹导入与道路匹配；
- [ ] 路网外轨迹聚集与疑似新路；
- [ ] 现场照片道路事件识别；
- [ ] 多团队、多日任务；
- [ ] OR-Tools Orienteering/Prize-Collecting VRP；
- [ ] 路网版本对比和影响分析；
- [ ] 持久化审核工单和角色权限。

## 19. 测试矩阵

### 数据测试

- OSM 字段映射；
- 经纬度范围和 CRS；
- `oneway=-1`、mph 限速、空 name；
- 重复道路、悬挂端点、相交未打断；
- manifest 数量、边界和哈希。

### 算法测试

- 对称与非对称成本矩阵；
- 不可达边；
- 必选点；
- 返回起点；
- 工作时间不足；
- 2-opt 不得产生更差路线；
- 相同输入输出确定。

### API 测试

- 非 POST 请求；
- 非同源请求；
- 坐标越界；
- 点数超限；
- Key 未配置；
- 上游超时/错误；
- 限流和日预算；
- 缓存命中；
- 响应中无 Key。

### UI 测试

- 路线工作区键盘可用；
- 路线生成期间有忙碌状态；
- 失败不清空当前地图和候选；
- 路线、序号和候选状态一致；
- 手机窄屏可以查看路线摘要；
- OSM attribution 不被抽屉遮挡。

## 20. 完成定义（Definition of Done）

MVP 只有同时满足以下条件才算完成：

- [ ] 页面能加载一份带来源和许可说明的 OSM 道路矢量数据；
- [ ] 道路已经转换成统一数据模型；
- [ ] 至少10类质量/风险规则可运行并生成候选；
- [ ] 候选可以接受、驳回或转外业核查；
- [ ] 外业模块支持起点、终点、6—10个候选点和工作时长；
- [ ] 本地优化器能给出选择和顺序；
- [ ] 滴图能返回真实驾车折线、距离和时间；
- [ ] Leaflet 能绘制路线和编号；
- [ ] Key、配额、缓存和失败降级通过测试；
- [ ] 指标中心能展示质量、效率和路线收益；
- [ ] 无 Key 时仍能使用固定演示结果；
- [ ] 文档明确区分演示能力和真实生产边界。

## 21. 面试展示路径

建议用8分钟讲完整闭环：

1. **业务问题**：遥感能发现道路附近异常，但没有道路数据生产和现场复核闭环。
2. **数据设计**：把 OSM 道路、InSAR、滑坡、照片统一成道路—证据—问题模型。
3. **生产流程**：规则自动发现、人工审核、外业核查、版本发布。
4. **质量体系**：展示拓扑、属性、证据一致性和生产效率指标。
5. **路线优化**：根据核查价值和道路时间选择点位与访问顺序。
6. **成本治理**：滴图 Key 隔离、缓存、预算和演示降级。
7. **业务价值**：减少无效外业、提高数据问题闭环效率，并为物流/无人车下游提供可验证的道路数据。

简历表述应使用“设计/实现演示闭环”，不得写成“已支撑京东物流或无人车生产”。

## 22. 首个可执行迭代

第一迭代只做 P0—P2，避免路线与数据生产同时失控：

1. 重置滴图 Key；
2. 确定江东新区演示边界；
3. 获取并裁剪 OSM 道路；
4. 建立 RoadSegment/RoadNode；
5. 实现前5类拓扑规则和后5类属性/风险规则；
6. 在现有 Leaflet 地图增加“道路质量”图层和问题列表；
7. 完成测试和数据 manifest。

第一迭代验收后再开始滴图路线规划。这样既符合“基于现有平台增量开发”，也能先补齐目标 JD 最看重的路网数据生产能力。

## 23. 官方参考

- OpenStreetMap Copyright/ODbL：https://www.openstreetmap.org/copyright
- OSM Tile Usage Policy：https://operations.osmfoundation.org/policies/tiles/
- Overpass API：https://wiki.openstreetmap.org/wiki/Overpass_API
- Geofabrik China Extract：https://download.geofabrik.de/asia/china.html
- OSM `highway` 标签：https://wiki.openstreetmap.org/wiki/Key:highway
- OSM routing tags：https://wiki.openstreetmap.org/wiki/OSM_tags_for_routing
- Osmium extract：https://docs.osmcode.org/osmium/latest/osmium-extract.html
- 滴图驾车路径规划：https://lbs.xiaojukeji.com/docs/web/guide/%E8%B7%AF%E5%BE%84%E8%A7%84%E5%88%92.html
- 滴图数据模型：https://lbs.xiaojukeji.com/docs/web/guide/%E5%93%8D%E5%BA%94%E6%A8%A1%E5%9E%8B.html
- 滴图坐标转换：https://lbs.xiaojukeji.com/docs/web/guide/%E5%9D%90%E6%A0%87%E8%BD%AC%E6%8D%A2.html
- 滴图 JS API 安全密钥说明：https://lbs.xiaojukeji.com/docs/jsapi/authsdk/jsapi-auth.html
- OSM API Usage Policy：https://operations.osmfoundation.org/policies/api/
- 国务院《地图管理条例》：https://www.gov.cn/zhengce/zhengceku/2015-12/14/content_10403.htm
