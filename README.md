# PASC-TCN-GIS · LANJIFYW 澜迹 InSAR WebGIS

这是面向生产展示的 PASC-TCN 与 InSAR WebGIS 一体化项目，可在 Edge、Chrome 等现代浏览器中使用。公开仓库仅包含运行时代码、接口契约、测试与有界演示数据；基线模型、论文复现实验、大型研究数据和私有模型权重不属于用户端依赖。页面支持导入海口 InSAR CSV（`FID,xpos,ypos,DYYYYMMDD...,Pattern`）、自动剔除无效坐标、计算研究区外包范围、定位 OSM/Esri 底图，以及点选查看时间序列。

## 在线部署

- WebGIS 生产地址：https://pasc-tcn-gis.vercel.app
- 公开源码：https://github.com/stranger62698/PASC-TCN-GIS

Vercel 发布物提供静态 WebGIS、地图浏览、PASC-TCN 有界演示结果和前端兼容性检查。实时上传推理不包含在静态发布物中；启用该功能必须单独部署私有 Python/Torch 推理服务，通过仅服务端可见的 PASC_SERVICE_BASE_URL 与 PASC_SERVICE_API_KEY 接入，并在私有位置提供哈希校验的模型包。未配置时前端按既有契约失败关闭。
## 在另一台设备继续修改

复制整个项目文件夹（不要只复制单个网页文件），至少需要 `app/`、`public/`、`db/`、`.openai/hosting.json`、`package.json`、`pnpm-lock.yaml`、`vite.config.ts` 和 `tsconfig.json`。安装 Node.js 22.13 以上版本后运行：

```bash
pnpm install
pnpm dev
pnpm build
```

真实 CSV 属于用户数据，不必放进代码仓库；打开网页后从“导入 CSV”选择即可。天地图需要自行申请密钥并设置 `NEXT_PUBLIC_TIANDITU_KEY`；OSM 与 Esri World Imagery 不需要此密钥。

## 海口 CSV 接口约定

- 点号：`FID`
- 经度：`xpos`（WGS84 / EPSG:4326）
- 纬度：`ypos`（WGS84 / EPSG:4326）
- 时序：`DYYYYMMDD`，例如 `D20170322`
- 形变模式：正式契约固定为 `Stable`、`Linear`、`Piecewise`、`Decelerating`、`Accelerating`、`Undefined` 六类；旧 `Stepwise` 只标记为 legacy 并要求确认，不会静默映射
- 可选字段：`velocity/rate`、`coherence/coh`；缺少速率时按逐点有效值的真实日期做最小二乘斜率计算，并记录 `provided/calculated/not_available` 来源
- 日期列会真正解析、按日期排序并查重；同日重复列的逐行值冲突时拒绝导入
- 导入时必须确认形变/速率单位、正负号约定和 `raw/already_smoothed` 预处理状态

## PASC Phase A 离线展示

当前契约为 `pasc-contract-v1`，模型结果版本为 `pasc-tcn-haikou-v1`。Level 3 需要至少 20 个逐点有效日期值。服务保留每份 CSV 自己的全部原始日期，只在相邻日期间隔大于 12 天时，从左侧日期起按 12 天步长线性补入缺失观测；不会以 248 期为目标，也不会参考其他数据集的期数。非原生序列标记为 experimental；其中 20—39 个原始观测低于既有 40 期最低评估证据，仅供探索性判读。时间适用性与空间适用性分别显示。

- Spatial Demo：`public/data/haikou-insar.csv`，3,094 点、248 期、连续区域约 50m 网格抽稀，保持自然类别不平衡
- Showcase Demo：`public/data/haikou-pasc-showcase.csv`，3,000 点、248 期、每类 500 点，仅用于六类界面覆盖，不代表科学类别比例
- 拉加镇滑坡 Demo：`public/data/lajia-landslide-insar.csv`，11,354 点、58 期、2021—2022 年 WGS84 真实时序数据；形变值统一保留 0.1 mm，源数据未提供类别、相干性或坡体分区
- 各套 Demo 的来源、范围、点数、期数和类别状态见相邻 manifest
- Phase A 只展示正式离线结果，不执行 Adapter、SG、Python API、checkpoint 或在线推理

验证命令：

```bash
npm run build
npm test
npm run lint
npm run lint:phase-a
npm run demo:validate
```

## PASC Phase B 预处理服务

`pasc-tcn-service/` 实现 v4 Phase B 的权威预处理边界：服务端重新验证字段、
日期、单位、符号和平滑状态，执行逐点 Temporal Adapter、SG 决策、
row-wise Z-score、冻结 13 维物理特征和冻结训练 Scaler，并提供
`GET /v1/models`、`POST /v1/validate`、`POST /v1/preprocess`。

完整 248 期且相邻间隔均为 12 天时绕过补值；其他序列保留原始日期，只在大于 12 天的相邻日期缺口中按 12 天步长补值并标记为 experimental；少于 20 个原始观测返回
unsupported 原因。无法由 12 天步长整除的剩余间隔会保留原日期并返回时间域偏移 warning；可靠迁移需独立评估，必要时微调或重训模型。`validate` 与 `preprocess` 本身不加载 checkpoint；Phase D 推理支持鉴权的组合 `/v1/classify` 路由在服务内存中连续执行预处理和冻结推理，`/v1/infer` 仍只接受服务签名工件。
运行、请求契约、错误码和 native-248 黄金回归方法见
[`pasc-tcn-service/README.md`](pasc-tcn-service/README.md)。

## PASC Phase C 离线验证

`pasc-tcn-service/tools/run_phase_c_validation.py` 使用冻结模型和固定 523 条
测试样本，完成 248/160/120/80/60/40 期、五种固定种子采样模式的离线
评估。CSV、JSON、Markdown、PNG/PDF 和采样日期索引位于
`pasc-tcn-service/phase_c_results/`。该阶段未设置验收阈值或支持的最小
期数；这些 Phase C 产物本身不执行在线推理。

## PASC Phase D 冻结推理服务

`pasc-tcn-service/` 新增只接收服务签名预处理工件的 `POST /v1/infer`。
部署时从仓库外的私有模型包加载冻结 M4 checkpoint、Scaler、校准和固定
1,036 条冻结训练空间参考，启动与每项资产均做 SHA-256 fail-closed 校验。对新上传
研究区，服务会在每个推理批次内使用 500 m 内的无标签邻点构造空间上下文；不读取
邻点类别、不拟合用户数据，也不要求把数据拉伸到 248 期。返回
raw/校准六类概率、标签、置信度、空间可靠度、gate、适用性、质量、来源、
warnings 与完整版本/哈希溯源。仅在当前点既没有冻结参考、又没有同区邻点时返回
`limited_reference`，此时继续使用时间分支和物理特征。

Phase D 推理边界保持冻结；私有资产被 Git 忽略，推理源码没有
optimizer、backward、fit 或训练入口。配置、鉴权和验证命令见
[`pasc-tcn-service/README.md`](pasc-tcn-service/README.md)。

## PASC Phase E 小数据在线识别

地图的 PASC 工作区已接入同步小数据流程：本地 CSV 上传与字段映射后，必须
明确确认形变/速率单位、正负号以及 raw/already_smoothed 状态，再显示能力
等级并仅提交逐点有效期不少于 20 的候选点。少于 20 期的点不会提交推理，
但仍完整保留普通 WebGIS 浏览与分析能力。

浏览器只调用同源的 POST /api/pasc/infer。该路由要求登录，将规范化数据提交给 Python 的鉴权 `/v1/classify`，预处理与冻结推理在同一服务进程内完成，避免大型中间工件往返；服务地址和
密钥只从服务端环境变量读取：

    PASC_SERVICE_BASE_URL=http://127.0.0.1:8788
    PASC_SERVICE_API_KEY=<至少32字符的服务密钥>

单次 WebGIS 分块上限为 500 点和 8 MiB；较大的任务会继续在后台自动分批并持续更新进度。组合接口不再返回大型预处理工件，因此 21,610 点通常由 217 个 100 点分块减少为约 44 个 500 点分块。成功后地图切换到冻结的六类颜色，点详情
显示校准后的六类概率、置信度、时间/空间适用性和来源；可筛选低置信度与空间
适用性有限结果。代理或 Python 服务失败时，当前数据、地图和已有结果不会被
清空，可以直接重试。

更大的私有数据集由 Phase F 后台任务处理，关闭页面不会中断。

## PASC Phase F 大数据任务

登录后的“数据集管理”页面提供持久任务中心。已确认经纬度、至少 20 个日期列、
单位、正负号和预处理状态的数据集可提交至 `POST /v1/jobs`。任务状态、事件、
模型版本与摘要存入 D1；原始 CSV、分块预测、错误、审计和多级地图工件存入 R2，
完整时序与大矩阵不会写入 D1 或返回任务列表。

任务以 D1 租约/认领协议作为当前 Sites 部署兼容的 Queue 等价实现。Python 消费者
流式读取私有 CSV，按最多 500 点调用组合预处理/推理边界，在每个分块边界报告进度和
响应取消；租约过期可恢复，失败最多尝试 3 次，工件按 owner/job/attempt/chunk
隔离并幂等写回。浏览器只访问 owner-scoped 公共任务路由，内部消费者路由使用独立
的至少 32 字符 bearer key。

WebGIS 与消费者必须配置同一个仅服务端可见的密钥：

    PASC_CONSUMER_API_KEY=<至少32字符的随机密钥>

消费者还需配置固定 WebGIS 来源与 worker 标识：

    PASC_WEBGIS_BASE_URL=https://<已部署站点域名>
    PASC_CONSUMER_WORKER_ID=consumer-01
    PASC_CONSUMER_LEASE_SECONDS=300

安装 `pasc-tcn-service` 后运行 `pasc-tcn-consumer`。消费者只接受已配置来源返回的
`/v1/internal/jobs/` 同源路径，不跟随任意任务 URL。部署前应应用
依次应用 `drizzle/0001_dataset_storage.sql` 和 `drizzle/0002_pasc_jobs.sql`，并确认 `.openai/hosting.json` 中的 `DB` 与
`DATASETS` 绑定已建立。

完成任务可显式打开 `/map?job=<jobId>`。地图按缩放级别只加载 500、2,000 或
5,000 个确定性抽样点；失败或加载错误不会清空当前地图。Phase F 不包含 Phase G
外部区域泛化、训练、微调或阈值重定义。

专项验证命令：`pnpm run test:phase-f`、`pnpm run lint:phase-f`，以及
`python -m unittest discover -s pasc-tcn-service/tests -p test_phase_f.py -v`。

## Phase 5 一键 AI 区域解读

浏览器将当前区域构建为不超过 12 KB 的 `AnalysisSummary`；摘要仅含聚合统计，不包含
完整 CSV、点位 ID 或完整时序。用户点击“开始 AI 解读”后，只调用同源的
`POST /api/ai/interpret`，服务端再使用管理员配置的阿里云百炼或 DeepSeek API。
用户不需要申请 Key，也不会在浏览器中看到服务地址或密钥。模型响应必须通过固定 JSON
契约校验后才会显示；调用失败不会清空当前地图，仍可切换到 DeepSeek 免费网页备用流程。

默认使用百炼免费体验模型：

    AI_PROVIDER=bailian
    BAILIAN_API_KEY=<百炼控制台生成的服务端 Key>
    BAILIAN_MODEL=qwen3.8-flash

截图中带独立免费额度的 DeepSeek 模型也可以继续走百炼，只需把
`BAILIAN_MODEL` 改为 `deepseek-v4-flash-0731`。以后切换 DeepSeek 官方 API 时配置：

    AI_PROVIDER=deepseek
    DEEPSEEK_API_KEY=<DeepSeek 服务端 Key>
    DEEPSEEK_MODEL=deepseek-v4-flash

密钥只能存入本地 `.env.local` 或部署平台的服务端 Secrets，禁止使用 `NEXT_PUBLIC_`
前缀。生产环境默认要求登录；若确实要向未登录访客开放，可显式设置
`AI_ALLOW_ANONYMOUS=true`，同时应在部署平台增加持久限流或验证码。接口本身还包含
20 KB 请求上限、35 秒超时、每身份 10 分钟 20 次的进程内保护，以及 15 分钟同摘要缓存。

AI 面板同时提供可选的“使用我的 API Key”模式。普通用户仍默认使用站点额度；高级用户只选择百炼或 DeepSeek 并填写自己的 Key，不需要输入服务地址。供应商地址和默认模型由服务端固定，个人 Key 仅随单次请求临时经过后端，不写入 Blob、D1、浏览器持久存储或应用日志。关闭或刷新页面后需要重新填写。公开部署必须使用 HTTPS，并应在隐私说明中明确这一处理方式。匿名访客默认可以使用自己的 Key，但不能使用受登录保护的站点额度；管理员可设置 `AI_ALLOW_PERSONAL_ANONYMOUS=false` 关闭匿名个人 Key 模式。

## Phase 6 本地性能与发布验收

Local Worker 会记录 CSV 解析、预处理、模型加载、ONNX 推理、总耗时、平均 batch、
文件大小、时间步和 provider，并在结果面板展示。单次推荐不超过 21,610 点；约 28 MiB
起显示大型数据提醒。300 MiB 以内保留全量内存链路；300 MiB—1 GiB 仅在桌面版 Chrome / Edge
进入 8 MiB 分块模式，每批预处理后立即执行 ONNX，完整预测逐批写入浏览器本地 OPFS，
地图只接收最多 25,000 个确定性抽样点。该路径不调用 Blob、上传 API 或云端推理；300 MiB
以上模式需要登录，但登录只负责产品权限，不改变原始文件留在当前设备的边界。大文件批次内空间邻域是明确披露的降级证据，
不等同于全区邻域推理。超过 1 GiB 会失败关闭并要求拆分文件。

专项命令：`pnpm run test:local-phase6`、`pnpm run test:local-phase6:parity`、
`pnpm run test:local-phase6:browser`、`pnpm run lint:local-phase6`。正式验收结果见
`PHASE_6_FINAL_ACCEPTANCE_REPORT.md`。私有 ONNX/空间参考仍只存在于忽略的本地产物，
因此当前发布边界是本地浏览器运行，而不是包含私有模型的公开静态部署。
---

## Phase G 外区证据与产品适用性

Phase G 增加无外部标签的受控外区稳健性评估，不训练、不拟合，也不改变冻结模型权重、
13 维物理特征或校准。生产空间策略支持上传研究区自邻域：评估覆盖上海坐标平移控制、cm/mm 单位等价、
符号等价，以及 40/80/160 节点抽样差异；轨道方向因冻结契约没有对应字段而明确
标记为不可数值评估。

当结果为 `limited_reference` 时，分析面板固定显示：

> 探索性识别结果
> 当前数据超出模型主要验证区域，
> 建议结合人工判读使用。

此时空间可靠性和门控受限，结果主要依赖 TCN 时间分支与运动学物理特征。
同一上传批次在 500 m 内存在邻点时，Self-neighborhood 会进入产品预测，来源标记为
`uploaded_research_area`；该分支只使用邻点时序、物理特征、距离和相干性，不使用标签。
因此同一个模型可以执行多城市推理，但 Phase G 不提供外区精度结论，也不把“可运行”
表述成“各城市精度已经验证”。

运行与验证：

    python pasc-tcn-service/tools/run_phase_g_external_evaluation.py
    pnpm run test:phase-g
    pnpm run lint:phase-g

证据输出位于 `pasc-tcn-service/phase_g_results/`。

发布前配置、迁移顺序、验证与回滚说明见 RELEASE_NOTES_PASC_V4.md。

---
# 原始运行说明

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

-`npm run dev`: start local development
-`npm run build`: verify the vinext build output
-`npm test`: build、核心协议测试、旧 CSV 回归、服务端渲染回归和 Demo 校验
-`npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
