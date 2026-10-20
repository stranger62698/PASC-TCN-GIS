# RoadOps 数据与服务合规台账

> 状态日期：2026-09-22（Phase 6 公开前复核）  
> 项目用途：非商业作品集、产品能力迁移与本地技术验证。  
> 固定声明：本平台仅用于非商业作品集演示和现场辅助核查，不提供导航服务，不代表权威路网，也不构成工程安全判断。

## 1. 发布边界

- Phase 0—6 仅在本地实施，不上传 Vercel。
- Phase 7 必须在用户明确确认后才允许公开发布。
- “非商业”不代表可以忽略数据许可、服务条款、地图署名、密钥安全或适用监管要求。
- 本台账属于产品与工程风险控制，不构成法律意见。
- 用户已授权继续 Phase 6 本地工程验证；这不消除 Phase 0/5 的外部证据缺口，也不是公开发布授权。

## 2. 数据与服务登记

| 对象 | 来源/权利状态 | 本项目用途 | 本地保存 | 公开条件 | 当前状态 |
|---|---|---|---|---|---|
| OSM 标准栅格瓦片 | OpenStreetMap contributors；受 OSMF Tile Usage Policy 约束 | 交互式背景地图 | 不预抓、不离线打包 | 持续显示署名；遵守缓存、Referer/User-Agent 和禁止批量下载要求 | 已使用，需持续复核 |
| OSM 道路矢量 | OpenStreetMap contributors；ODbL 1.0 | 路网基线、拓扑质检、问题工单 | 江东 AOI 原始 Overpass 快照、1,134 个精简 GeoJSON 要素与 manifest | 提供 attribution、来源/时间/AOI manifest；公开派生数据库前复核 share-alike | 已接入；Phase 1 原始证据缺口见回溯索引 |
| 江东道路 InSAR | 用户提供的项目数据；仓库中未发现独立许可文件 | 道路附近形变证据与演示 AOI | 现有精简 CSV/manifest | 不扩张为权威道路、安全或通行结论；对外再分发授权需用户确认 | 既有演示，授权证据待补 |
| PASC-TCN ONNX | 项目内部模型产物 | 本地形变模式识别 | `artifacts/`，受 Git 忽略规则保护 | 不公开私有权重；公开构建只使用既定浏览器资产边界 | 已冻结 |
| 滴图驾车路径规划 | 滴图开放平台 Web Service；以账号控制台实际协议和配额为准 | Phase 5 获取驾车距离、时长和最终折线 | Key 只允许进入被忽略的 `.env.local`；结果在服务进程内短期缓存 | 核实账号授权、缓存/展示条件及调用计数；不写入 OSM 派生数据库 | 服务端和 mock 契约已验证；真实请求为 0，Key 轮换与实际协议待确认 |
| Phase 4 固定路线数据 | 仓库内 OSM 基线生成的道路几何与固定成本矩阵 | 无 Key 路线优化演示 | `jiangdong-route-demo.json` 及来源 manifest | 标注 OSM 来源和固定速度/方向假设，按 ODbL 复核派生数据分发 | 已生成；不含实时交通 |
| Phase 5 固定契约回放 | 从 Phase 4 OSM 演示路线构造的接口夹具 | 验证路径响应与页面交互 | `jiangdong-didi-contract-replay.json` 及 manifest | 沿用 OSM 来源说明；不得标为真实滴图响应或实测驾车结果 | 已生成，`containsDidiResponse=false`、`upstreamRequests=0` |
| TypeSafe System One / Jev | TypeSafe 官方 API；以账户实际条款和限额为准 | 对确定性规则候选做可选的结构化语义复核 | 默认不缓存原始响应；只保存必要的派生建议 | Key 仅服务器端；不得上传个人信息或原始时序；公开前复核条款、额度和数据保留政策 | Phase 2 已完成接口边界，未发起在线请求 |
| 现场照片/EXIF | 用户导入 | 外业证据关联 | 默认浏览器本地 | 未经授权不得公开真实人员、车牌、住址或精确私人位置 | 既有能力，RoadOps 不新增采集 |

## 3. Phase 0 冻结范围

- 演示区域：海口江东新区现有道路 InSAR 数据边界。
- CRS：WGS 84 / EPSG:4326。
- AOI：`[110.37301, 19.95289, 110.52347, 20.07055]`。
- 单调查组；最多 10 个候选点；成本矩阵最多 8 个点。
- 仅驾车路线；步行、骑行、公交不在当前范围。
- 不提供 turn-by-turn 导航，不采集实时位置，不自动回写 OSM。
- 不声称支持车规级、物流生产级或无人车级路网。

## 4. 密钥与额度控制

- [x] 仓库和现有静态产物完成不输出原文的凭据扫描。
- [x] `.env.local` 已被 Git 忽略；Phase 5 未发现非空的新滴图 Web Service Key，未发出真实调用。
- [x] `.env.example` 只记录空的 `DIDI_MAP_WEB_SERVICE_KEY` 占位符和非敏感额度默认值。
- [ ] 用户在滴图控制台作废截图中暴露过的旧 Key。
- [ ] 用户新建仅用于 Web Service 的 Key，并确认驾车路径权限、日配额和并发限制。
- [ ] 新 Key 仅写入本地 `.env.local`；不得发到聊天、截图、Git、浏览器 bundle 或测试日志。
- [ ] Phase 5 前留存账号实际同意的服务协议名称、版本/日期和控制台配额截图。
- [x] TypeSafe Key 只允许服务器端读取；本地静态预览无 Key 时安全降级，规则功能不受影响。
- [ ] 若启用 TypeSafe 在线复核，先确认账户额度、数据保留政策和可发送字段，并继续禁止上传原始时序或个人信息。

服务端已实现同源、方法、正文大小、点数、坐标、超时校验；点击实时规划才调用，缓存命中不请求上游，失败保留固定路线。默认日预算 50、单身份 20、QPS 1、缓存有效期 1,800 秒、自动重试 0。证据见 [Phase 5 验收](./roadops-evidence/phase-5/acceptance.md)。

这些是当前单服务进程的工程护栏：缓存和计数存于内存，进程重启会重置，日切采用 Asia/Shanghai 午夜；本实例闭环已串行化以避免并发计数和重复缓存请求竞态，但不是滴图账户的权威账单，也不能保证多实例公开服务的总额度。矩阵 `packs` 的平台计费口径尚未核对，不能把最多 3 次 HTTP 请求等同于仅消耗 3 个平台配额单位。公开启用前须确认账号时区/计费单位，并完成持久化共享计数及控制台核对。

## 5. 公开发布前门禁

- [ ] 复核 OSM attribution 在桌面和窄屏均可见。
- [ ] 复核 OSM 道路矢量 manifest 和 ODbL 说明。
- [ ] 复核底图来源、内容表示、边界、审图号/资质等适用要求。
- [ ] 复核无滴图 Key、私有模型权重、真实个人位置和敏感原始数据。
- [ ] 复核滴图结果缓存与公开展示符合账号实际协议。
- [ ] 处理服务端进程内预算在重启、多实例及并发场景下的限制，核实平台计费单位。
- [ ] 确认江东 InSAR、风险样例、模型展示产物及照片的对外展示/再分发授权范围。
- [ ] 复核地图服务适用范围及服务器部署地域；Vercel 方案不能仅凭构建通过即视为可发布。
- [ ] 由用户明确批准 Phase 7 后才执行一次性部署。

## 6. Phase 6 官方依据复核记录

本轮于 2026-09-22 直接查阅以下官方资料。公开 API 文档不能替代账号实际签署的协议，也不能证明项目已取得地图相关资质或审核批准。

| 官方资料 | 已核实要点及项目处理 | 仍待完成 |
|---|---|---|
| [OSM Copyright and License](https://www.openstreetmap.org/copyright)、[署名指南](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) | OSM 数据适用 ODbL，需署名和许可告知；已有来源 manifest、地图署名和许可入口 | 公开下载包的许可、数据库/作品分类及相同许可义务需按最终分发范围确认；署名窄屏可见性以 Phase 6 浏览器证据为准 |
| [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) | 标准瓦片服务有独立使用规则；规范 HTTPS 地址、可见署名、正常缓存/Referer，不支持批量抓取或离线打包 | 全部地图入口与实际请求头复核；不得以断网演示为由预下载瓦片 |
| [滴图 Web Service 鉴权](https://lbs.xiaojukeji.com/docs/web/authsdk/webapi-auth.html)、[驾车接口](https://lbs.xiaojukeji.com/docs/web/guide/%E8%B7%AF%E5%BE%84%E8%A7%84%E5%88%92.html) | Web Service Key 随上游 URL query 发送；本项目放在服务端边界，日志不记录完整上游 URL；接口返回距离、耗时和几何 | 新 Key 权限、账号协议、`packs` 计费、配额及缓存/展示条件未取得控制台证明 |
| [滴图 SDK 合规指南](https://lbs.xiaojukeji.com/docs/privacy/compliance-instructions.html) | 页面明确针对 SDK 隐私接入；本项目当前未接入 JS/移动端 SDK | 不把 SDK 指南当作 Web Service 缓存或再分发授权 |
| [《地图管理条例》官方全文](https://www.mee.gov.cn/zcwj/gwywj/202001/t20200114_759322.shtml) | 第 15 条涉及公开地图审核；第 33、34、38 条分别涉及相关服务资质、地图数据服务器境内设置、经审地图及新增内容核查；第 35 条涉及个人信息 | 发布前按实际功能和受众咨询主管部门或有资质专业机构，确认适用性、底图/叠加内容、审图号与部署地域；非商业说明不替代核验 |

工程措施的当前证据不构成“合法合规已通过”的结论。已知缺口已纳入 [Phase 6 发布复核](./roadops-evidence/phase-6/release-review.md)，保持公开发布阻塞，同时继续本地验证。

## 7. 补充参考

- OpenStreetMap Copyright/ODbL：https://www.openstreetmap.org/copyright
- OSMF Tile Usage Policy：https://operations.osmfoundation.org/policies/tiles/
- OSMF API Usage Policy：https://operations.osmfoundation.org/policies/api/
- 滴图驾车路径规划：https://lbs.xiaojukeji.com/docs/web/guide/%E8%B7%AF%E5%BE%84%E8%A7%84%E5%88%92.html
- 滴图坐标转换：https://lbs.xiaojukeji.com/docs/web/guide/%E5%9D%90%E6%A0%87%E8%BD%AC%E6%8D%A2.html
- 滴图 Web Service 鉴权：https://lbs.xiaojukeji.com/docs/web/authsdk/webapi-auth.html
- TypeSafe JavaScript SDK：https://github.com/typesafe-ai/typesafe-sdk-js
- 国务院《地图管理条例》：https://www.gov.cn/zhengce/zhengceku/2015-12/14/content_10403.htm
