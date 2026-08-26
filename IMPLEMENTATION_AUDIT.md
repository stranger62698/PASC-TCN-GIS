# 澜迹 InSAR V2.0 实施审计（Phase 0）

审计日期：2026-08-26
需求来源：`LANJIFYW_InSAR_V2_Codex_需求与实施规划.md`
代码基线：`codex/pasc-phase-g` / `4aa90249ca717d6852472bf6d570cb1fc64f0b8c`
阶段边界：只审计与规划，不修改业务代码、不更换技术栈、不新增依赖。

## 1. 结论

当前项目已经具备 InSAR CSV 接入、PASC-TCN 在线/后台分类、地图专题渲染、单点时序、矩形区域统计、异常点发现、私有数据集、统计页连续性和规则化区域解读。V2 不应重写网站，而应把这些分散能力收束为文档要求的地图分析闭环。

Phase 1 的真实缺口集中在五项：

1. 顶部主模式只有“形变量 / 形变模式”，缺少“平均形变速率”。
2. 形变模式下稳定点与异常点透明度相同，异常视觉层级不够清楚。
3. 缺少独立、非破坏性的“仅看异常模式”开关及真实可见点计数。
4. 品牌文字尚未全部统一为“澜迹 InSAR / 城市地表形变智能分析平台”。
5. 地图交互测试尚未覆盖主模式切换、状态保持、图例同步和异常筛选。

现有 `AUDIT_V2.md` 是 2026-08-21 的早期审计，其中关于 AnalysisContext、真实 Statistics、AI 解读、埋点和 Demo 口径的部分已被后续代码改变。本文件以当前代码为准，替代其作为本轮 Phase 0 验收依据。

## 2. 技术栈与运行结构

| 层级 | 当前实现 | 审计判断 |
| --- | --- | --- |
| 前端 | React 19、TypeScript 5.9、Vinext/Vite | 保留，不换框架 |
| 地图 | Leaflet 1.9，Canvas renderer | 保留；Phase 1 仅局部改造 |
| 图表 | React 内联 SVG | 继续复用，不引入新图表库 |
| 样式 | `app/globals.css` + `app/pasc.css` | 增量调整，避免全站重写 |
| 公开生产 | Vite 静态构建 + Vercel Functions | 当前主生产路径 |
| 小数据分类 | `/api/pasc/infer` → 私有 Python/Torch 服务 | 已可用，密钥不进浏览器 |
| 大数据分类 | Vercel Blob + Queue + worker，500 点/批 | 已可恢复，关闭网页不终止 |
| Sites 路径 | Vinext + `.openai/hosting.json` + D1/R2 | 保留并继续构建验证 |
| 认证/私有数据 | Vercel Functions + HttpOnly Cookie + Vercel Blob | 已投入当前生产使用 |

当前存在静态 Vercel 与 Vinext/Sites 两套入口，但共享 `app/components` 和 `app/lib`。Phase 1 不清理运行方案，只修改共享产品代码并分别验证两种构建。

## 3. 路由与页面

| 路由 | 入口 | 当前能力 | V2 处理 |
| --- | --- | --- | --- |
| `/` | `HomePage` | 公开 Demo、上传入口、真实 Demo 指标 | 统一品牌与核心价值文案 |
| `/map` | `MapWorkspace` | 完整分析工作台 | Phase 1 主改造面 |
| `/statistics` | `StatisticsWorkspace` | 继承当前数据集、区域、筛选和地图状态 | Phase 3 扩展 AOI 时序 |
| `/datasets` | `DatasetPage` | 四步导入、质检、私有保存、大任务控制 | 保持，不并入 Phase 1 |
| `/showcase`、`/showcase/:id` | `CasePages` | 城市真实示例 + 滑坡/道路流程示意 | Phase 5 使用真实数据校核 |
| `/platform`、`/solutions`、`/about` | `ContentPages` | 产品说明 | 后续收束，不阻塞核心闭环 |
| `/login` | `AuthPage` | 登录/注册 | 本轮不新增账户或权限功能 |

`static-src/main.tsx` 维护同一组静态路由；新增路由或页面时必须同步检查该入口。Phase 1 不需要新增路由。

## 4. 关键代码位置

| 能力 | 代码位置 | 当前状态 |
| --- | --- | --- |
| 地图工作台总状态与布局 | `app/components/MapWorkspace.tsx` | 活跃，1,040 行，维护热点 |
| Leaflet 点图层、图例、框选 | `app/components/WebGisMap.tsx` | 活跃，唯一当前地图实现 |
| 旧地图实现 | `app/components/InsarMap.tsx` | 无引用，暂不删除 |
| 分析上下文与恢复 | `app/lib/analysis-context.tsx` | 已持久化数据集、时间、筛选、选点/区域、地图视图 |
| 点位统一数据 | `app/data/site.ts` 的 `InsarPoint` | 可继续扩展兼容字段 |
| CSV 识别与解析 | `app/lib/insar-v2.ts` | 已支持 ENVI/STAMPS、质量与 PASC 兼容性 |
| 日期列规范化 | `app/lib/pasc-schema.ts` | 支持 `D_YYYYMMDD` 等格式 |
| 六类契约与颜色 | `app/lib/pasc.ts`、`app/types/pasc.ts` | 冻结并已有测试 |
| 单点 PASC 与概率 | `PascAnalysisPanel.tsx`、`PascProbabilityBars.tsx` | 已显示完整六类概率 |
| 图例与区域分布 | `PascPatternLegend.tsx`、`PascRegionStats.tsx` | 可复用 |
| 区域规则解读 | `app/lib/ai-analysis.ts` | 本地透明规则，不是 LLM |
| 区域统计页 | `StatisticsWorkspace.tsx` | 已读取 AnalysisContext |
| 四步数据导入 | `DatasetPage.tsx` | 上传、识别、检查、确认已完成 |
| 大任务 UI/API | `PascJobPanel.tsx`、`api/pasc-jobs.ts` | 分批、进度、取消、重试、结果加载已完成 |
| 产品埋点 | `app/lib/analytics.ts` | 已覆盖核心任务链 |
| 生产静态入口 | `vite.static.config.ts`、`vercel.json` | 当前 Vercel 路径 |
| Sites 入口 | `vite.config.ts`、`.openai/hosting.json`、`worker/index.ts` | D1/R2 能力路径 |

## 5. 当前数据字段

### 5.1 点位字段

`InsarPoint` 已包含：

- 基础：`id`、`name`、`lon`、`lat`、`updated`；
- 形变：`velocity`、`velocitySource`、`displacement`、`series`、`dates`；
- 质量：`coherence`、`coherenceSource`、`missingRate`、`warnings`；
- 模式：`mode`、`modeCanonical`、`legacyMode`、`modeSource`、`modeConfidence`；
- PASC：能力等级、有效期数、时间/空间适用性和完整 `pasc` 结果；
- PASC 结果内含六类概率、置信度、低置信度、校准变化、空间可靠性、门控均值、质量与来源审计。

缺少但只应在真实结果存在时增加的可选字段：`changePoint`、`slopeBefore`、`slopeAfter`、预处理/平滑序列。不得在 Phase 1 编造这些值。

### 5.2 CSV 与质量字段

当前映射含经纬度、速率、点号、模式、模式来源、置信度、相干性、研究区、日期列、形变/速率单位、正负号和预处理状态。

质量报告含无效行、缺测率、低相干、速率异常值、模式分布、日期列、bbox、能力等级、兼容性、总行数、有效点、重复坐标、未解析时间列和相干性是否提供。

日期解析支持 `D20110101`、`D_20110101`、`YYYYMMDD` 和分隔日期，并统一为 `YYYY-MM-DD`。

### 5.3 公开 Demo 真实口径

- Spatial Demo：3,094 点、248 期、2017-03-22—2025-05-03；保持自然类别不平衡。
- Showcase Demo：3,000 点、248 期、六类各 500 点；只用于界面覆盖，不代表总体比例。
- 两份 Demo 均有来源哈希与验证 manifest。

## 6. 需求—现状映射

| 文档能力 | 当前状态 | 复用/新增判断 |
| --- | --- | --- |
| 三种主分析模式 | 六种渲染属性存在；顶部只有两种 | 复用 `RenderAttribute`，补三段主切换 |
| 模式对比 | 已能一键在形变量与模式间切换 | Phase 1 保留即时切换；Swipe 后置 |
| PASC 模式、置信度、Top-2 | 模式/置信度在点位页；六类概率在 PASC 页 | Phase 2 将 Top-2 摘要合入统一点位区 |
| 模式解释 | 点位规则解释和空间适用性说明已存在 | Phase 2 统一六类固定文案 |
| 模式与数据质量分离 | 数据字段已分离，UI 基本分区 | Phase 2 强化标题与层级 |
| 稳定点降权 | 未实现，模式点透明度均为 0.92 | Phase 1 修改 marker 样式 |
| 仅看异常模式 | 无独立开关 | Phase 1 新增非破坏性视图过滤 |
| 统一单点详情 | 基础/模式/质量/时序/导出已有 | Phase 2 补 Top-2 与真实可选特征 |
| AOI 绘制 | 仅矩形 | Phase 3 复用框选，新增多边形；圆形可后置 |
| AOI 基础统计 | 点数、速率、累计量、质量、模式已有 | Phase 3 补面积、中位数和清晰口径 |
| AOI 平均/中位时序 | 未实现 | Phase 3 新增纯计算模块与图表 |
| 模式分组曲线 | 未实现 | Phase 3 新增可选模式曲线 |
| 异常区域 | 只有透明规则的异常点筛选 | Phase 4 新增局部/后端聚类，不宣称现有点为区域 |
| 多点对比 | 已支持 30 点 | Phase 5 收敛为最多 5 点 |
| 统一筛选 | 速率、低相干、PASC质量分散 | Phase 1 先补模式快捷筛选；完整统一后续迭代 |
| 典型案例 | 三类案例存在，城市案例有真实 Demo | Phase 5 只添加有真实数据依据的区域 |
| 单点导出 | CSV 已有 | Phase 6 补 JSON |
| AOI 导出 | 未实现 | Phase 6 新增 CSV/GeoJSON |
| 图表 PNG | 地图 PNG 已有，图表 PNG 无独立入口 | Phase 6 新增指定图表导出 |
| 规则摘要 | 区域 TXT 摘要已实现 | Phase 6 调整为文档口径 |
| Loading/Error/Empty | 主要流程已有 | Phase 6 系统化补齐 |

## 7. 当前性能风险

1. `WebGisMap` 虽使用 Canvas renderer，仍为每点创建 Leaflet `circleMarker`；几十万点不适合一次性展示。
2. 点集、专题样式、质量阈值或可见图层变化时会删除并重建所有点图层。
3. 点选最近点与矩形框选均为 O(n) 全数组扫描。
4. `MapWorkspace` 多处全量 `filter/map` 和参数展开；大点集会增加主线程风险。
5. 小型 CSV 使用 `file.text()` 全量读取，点对象保留完整时序；300 MB 只是产品边界，不代表所有浏览器都能流畅解析。
6. 私有数据重新打开时会下载、拼接全部分块再解析，不适合任意 2 GB 文件。
7. 大任务地图已使用 500/2,000/5,000 点多级预览，这是大数据结果展示应继续沿用的方向。
8. `MapWorkspace.tsx` 和分阶段堆叠的 `globals.css` 是维护风险；本轮应抽小组件/纯函数，不重写地图。

Phase 1 不解决十万点全量 WebGL 化；它必须保证新增筛选不会重复解析 CSV、不会修改原始点数组、不会让地图自动重新定位。

## 8. Phase 1 文件级实施计划

### 8.1 建议新增

1. `app/lib/v2-map-analysis.ts`
   - 定义三种主模式顺序和文案；
   - 提供异常模式、可见点计数和稳定点透明度等纯函数；
   - 便于不启动 Leaflet 的单元测试。
2. `app/components/AnalysisModeSwitch.tsx`
   - 显示“平均形变速率 / 累计形变量 / PASC-TCN 形变模式”；
   - 提供“变了多少 / 正在怎样变化”的简短帮助；
   - 只控制现有 `RenderAttribute`，不建立第二套地图状态。
3. `tests/v2-phase1.test.ts`
   - 覆盖三模式顺序、异常模式集合、稳定透明度、未定义处理、真实计数和状态契约。

### 8.2 建议修改

1. `app/components/MapWorkspace.tsx`
   - 接入三模式主切换；
   - 增加“仅看异常模式”和“是否保留未定义”；
   - 显示 `当前可见 / 总有效`；
   - 保持筛选、选点、详情栏、时间范围和地图范围；
   - 不改变分类、导入或后台任务逻辑。
2. `app/components/WebGisMap.tsx`
   - 接受模式可见性/数据集身份参数；
   - 模式视图中稳定点约 0.2 透明度，异常模式保持 0.85—1.0；
   - 过滤切换只重绘点，不 `fitBounds`；
   - 空数值安全显示 `--`。
3. `app/lib/analysis-context.tsx`
   - 持久化主模式和异常模式可见性；
   - 使用兼容默认值读取旧 sessionStorage。
4. `app/components/SiteShell.tsx`
   - 可见品牌统一为“澜迹 InSAR”，副标题统一为产品定位。
5. `app/components/HomePage.tsx`
   - 收束首屏文案到“从形变量到形变演化”；保留真实 Demo 与两个主动作。
6. `app/layout.tsx`
   - 元数据基地址更新到真实生产域名；保留现有 `og.png`。
7. `app/globals.css`
   - 补三段切换、异常开关、稳定点说明和响应式样式；不覆盖现有 GIS 布局。
8. `scripts/build-pasc-tests.mjs`、`package.json`
   - 将 Phase 1 纯逻辑测试纳入现有命令。

### 8.3 Phase 1 明确不修改

- PASC-TCN 模型、权重、阈值、20→248 适配与私有服务；
- CSV 单位/符号/平滑确认和 ENVI 日期兼容；
- Vercel Queue、大任务 500 点分批和私有存储；
- AOI 聚类、异常区 Polygon、多边形绘制、导出格式；
- 登录、权限、数据库和部署架构；
- `InsarMap.tsx` 等历史代码清理。

## 9. Phase 1 验收与回归

### 功能验收

- 三种主模式无需刷新稳定切换；
- 地图实例、中心、缩放、已选点、右侧详情和当前筛选不丢失；
- 图例与当前模式一致；
- 形变模式下稳定点明显降权，加速型最突出；
- “仅看异常模式”不修改原始数据，关闭后完整恢复；
- 未定义型是否保留有明确开关；
- 当前可见点数来自真实数据；
- 空字段显示 `--` 或隐藏可选模块，不编造数值。

### 自动验证

- Phase 1 新增纯逻辑测试；
- 现有 PASC/WebGIS 测试全部通过；
- ESLint 无新增错误；
- `pnpm run build:static` 通过；
- `pnpm run build`（Vinext/Sites）通过；
- `git diff --check` 通过；
- Vercel 生产等价构建通过后才进入 Phase 2。

### 人工回归

- 首页、地图、缩放、拖动、点位、Tooltip、时序曲线、图例、筛选、重置、数据数量和刷新默认状态；
- 宽屏桌面、约 1200 px 和窄屏折叠行为；
- Spatial Demo、Showcase Demo、普通 CSV、ENVI `D_YYYYMMDD` CSV；
- 小数据同步分类和大数据后台任务入口保持可用。

## 10. Phase 0 验收

- 已完整读取 1,382 行 V2 文档。
- 已审计技术栈、路由、地图、图表、数据、PASC 字段、筛选、图层、导出、弹窗、上传、后台任务、部署和测试。
- 已区分可复用、需要新增和后续阶段功能。
- 已给出 Phase 1 文件级计划、边界、性能风险和验收标准。
- 产品业务代码修改：0。
- 新增交付物：`IMPLEMENTATION_AUDIT.md`。

Phase 0 完成后，应先验收本审计，再进入 Phase 1。
