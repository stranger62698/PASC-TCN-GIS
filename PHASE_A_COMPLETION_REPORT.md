# PASC-TCN 产品化集成 Phase A 完成报告

日期：2026-08-23
分支：`codex/pasc-phase-a`
范围：仅完成 v4 规划的 Phase A，并在此停止。

## 1. 完成结论

Phase A 的 WebGIS 协议、兼容性检查、固定六分类展示、离线 248 期 Demo、旧 CSV 回归和上传 API 路径统一已完成。未实现或引入 Temporal Adapter 执行、SG 处理、Python API、checkpoint、模型在线推理或 Phase B 服务。

## 2. 协议与解析

- 新增 `pasc-contract-v1` 与 `pasc-tcn-haikou-v1` 类型契约。
- 固定六分类 ID、英文 canonical name、中文显示名与颜色。
- 旧 `Stepwise` 保留为 legacy 并要求确认，不静默映射为 `Piecewise`。
- 日期支持 `DYYYYMMDD` 与常见年月日分隔格式，按真实日期排序并按 canonical date 查重。
- 同日重复列逐行冲突时以 `PASC_DUPLICATE_DATE_CONFLICT` 拒绝。
- velocity 可选；缺失且至少两个逐点有效日期值时，按真实日期做最小二乘年斜率。
- coherence 缺失记录为`not_available`，不静默填写模型默认值。
- 实现能力 Level 0—3、39/40/248 边界、TemporalApplicability 与 SpatialApplicability。
- 导入界面要求用户确认形变/速率单位、正负号和 `raw/already_smoothed` 状态。

## 3. WebGIS 展示

新增并接入：

- `PascCompatibilityCheck`
- `PascAnalysisPanel`
- `PascProbabilityBars`
- `PascPatternLegend`
- `PascRegionStats`

地图固定使用六分类颜色，点位面板展示六类概率、置信度、低置信、空间可靠性、门控、来源与适用性；区域面板展示类别数量、比例、平均置信度和低置信数量。数据集质检页显示兼容性卡片。

## 4. 离线 Demo

| Demo | 点数 | 期数 | 选择方法 | 类别口径 | SHA-256 |
|---|---:|---:|---|---|---|
| Spatial | 3,094 | 248 | 连续 bbox 后约 50m 网格确定性抽稀 | 保持自然不平衡 | `98c4a718d8c5062c89a0eb45ecc9e584c315c24a6026ffe19ade2823005ad020` |
| Showcase | 3,000 | 248 | 全域按类确定性分层，每类 500 | 仅界面覆盖，不代表科学比例 | `16d9a453afd05ba7f3c25246d7d652f9e3e6345206f563dc8808443fc40abc6f` |

Spatial 类别统计：Stable 1,611；Linear 121；Piecewise 394；Decelerating 200；Accelerating 30；Undefined 738。

正式来源 SHA-256：

- 全量预测：`06e7925f2adb8c9604558295f4d80f15ac7d32216ed453683876cbfa667f37f4`
- 248 期时序：`2163d28f1db058c4a3d10895e0e03a2ddffc38c235d3529a982cb7444fed519e`

两套 Demo 均有独立 manifest；Showcase 入口在地图数据面板中明确显示免责声明。

## 5. API 路径统一

- 列表：`GET /api/datasets`
- 元数据更新：`PATCH /api/datasets/:id`
- 删除：`DELETE /api/datasets/:id`
- 原始源文件：`GET /api/datasets/:id/source`
- 开始分片：`POST /api/uploads/start`
- 上传分片：`PUT /api/uploads/part`
- 完成分片：`POST /api/uploads/complete`

前端不再调用 `/api/private-datasets`。上传完成时把映射、质量报告、用户选择和契约版本写入 `schema_json`。

## 6. 验收结果

| 验收项 | 结果 |
|---|---|
|`npm run build` 等价命令 | PASS |
|`npm test` 等价命令 | PASS，9/9 |
| PASC 核心单元测试 | PASS，8/8 |
| 原服务端渲染回归 | PASS，1/1 |
| 旧 CSV 回归 | PASS |
| Demo 校验 | PASS |
|`npm run lint` 等价命令 | PASS，0 errors |
|`npm run lint:phase-a` | PASS，0 warnings |
| `git diff --check` | PASS |
| 分支 | `codex/pasc-phase-a` |

完整 lint 仍显示 71 个存量 warning，来自原有七个 legacy 文件及既有图片提示；这些规则债务被显式保留为 warning。Phase A 新增文件由 `lint:phase-a --max-warnings 0` 严格校验。

## 7. 测试覆盖

核心测试覆盖：

- 六分类 ID/名称/中文/颜色冻结；
- Stepwise legacy 行为；
- 日期格式、排序与 canonical 重复；
- 39、40、248 期状态；
- 概率归一约束与最大概率类别；
- velocity 缺失时真实日期最小二乘；
- coherence 来源；
- 重复日期冲突拒绝；
- 旧 CSV 普通 WebGIS 回归；
- 248 列 native Level 3；
- 原服务端渲染回归；
- Demo 点数、248 期、唯一 FID、概率范围/和、argmax、类别统计、bbox、输出与来源哈希。

## 8. 文件清单

详见 `PHASE_A_FILE_MANIFEST.csv`。Demo 级来源信息详见：

- `public/data/haikou-pasc-spatial.manifest.json`
- `public/data/haikou-pasc-showcase.manifest.json`

## 9. 停止声明

Phase A 已完成。本次工作到此停止；Phase B 未开始。
