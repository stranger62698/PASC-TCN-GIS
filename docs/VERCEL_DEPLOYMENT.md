# Vercel 发布

2026-10-22 当前正式版已移除左上角图标及配套文字，首页、工作台、登录页和页脚同步清理。部署 `dpl_EiSotG7JBq9W6wNRGVJe42PE1kiV` READY，固定版本 `https://pasc-tcn-228dnwohj-fyw.vercel.app`；版本 `2026-10-22-74810594c8d2`。正式域名 25 项资源/接口检查及 5 项标识删除检查通过，旧 PNG 地址返回 404。详见 [本次标识移除记录](BRAND_MARK_REMOVAL_2026-10-22.md)。


2026-10-20 前一正式版为本地与线上统一部署 `dpl_72aNPU2Y4p1EncWdP9A3UNCV619P`，固定版本 `https://pasc-tcn-of60eob2e-fyw.vercel.app`。版本 `2026-10-20-88047ed225a2`，正式域名 `/release.json` 与本机版本元数据逐字节一致；25 项资源及接口检查和 6 项 CSS/页面检查通过。详见 [本次统一发布记录](UNIFIED_RELEASE_2026-10-20.md)。

正式关联源码仓库为 `stranger62698/PASC-TCN-GIS`。发布采用本机完整预构建；`git.deploymentEnabled: false` 关闭 Git 自动部署，避免缺少本机模型的远端构建替换正式版。每次 build:static 自动生成版本指纹，发布前验证当前源码，发布后验证线上字节一致。


正式站点：https://pasc-tcn-gis.vercel.app

2026-10-19 前一正式版为工作台蓝色导航样式修复部署 `dpl_F86kZkHbGS7mMVuWwUdmnrhH4Hdt`，固定版本 `https://pasc-tcn-exn7v49ie-fyw.vercel.app`。沿用 10 月 17 日的入口 `/assets/index-cGgoynfl.js`、基础 CSS `/assets/index-B_-DfITt.css`，追加 `/assets/workspace-nav-e3db9104ef1e.css`；桌面工作台导航选中及悬停时显示蓝色文字、图标和底部横线。正式域名 24 项资源及接口检查、5 项导航样式发布检查通过。

10 月 19 日发布从已核对与线上相同的 `.vercel/output` 制作隔离发布包 `.work/workspace-nav-release`，只新增导航 CSS，并在 12 个 HTML 的原有 CSS 后追加样式链接；824 个原有文件逐项核对，脚本、函数、模型运行时与原有路由配置不变，64 个函数依赖链接保持有效。保留原 CSS 链接可避免现有动态加载脚本重新插入旧 CSS 后覆盖补丁。后续完整构建使用 `app/workspace-ui.css` 中的对应源码样式。证据位于 `artifacts/nav-selection/production-package.json` 和 `production-verification.json`。

账号策略沿用 10 月 17 日已验收版本；2026-10-16 的“无需登录”行为已更正，旧记录仅供历史对照。

项目使用静态前端及两个 Vercel 函数：`api/auth` 与 `api/roadops/driving`。账号权限和数据处理位置分别管理：默认 `/map`、`/datasets` 及 PASC 独立入口需要登录，指定的公开 demo 可免登录浏览；导入自己的 CSV 和分析仍需登录。CSV 的读取、字段映射、时序计算、PASC-TCN 推理和结果均在访问者自己的电脑完成，不上传云端、不创建后台任务。浏览器推理资源由 `build:static` 一并构建并复制到 `static-dist/__pasc-local/worker/`。

六类云数据、任务及 AI API 已关闭：`api/private-datasets`、`api/pasc-jobs`、`api/pasc-large-worker`、`api/pasc/infer`、`api/ai/interpret`、`api/roadops/review`。发布产物不包含这些函数；对应请求由静态路由直接返回 403，错误代码为 `USER_DATA_LOCAL_ONLY`。

所有大小的 CSV 都采用本机路径；超过 1 GiB 时先在本机分片，每个独立片最多 25,000 行、128 MiB，再逐片分析，不转交云端。本机文件、缓存及结果按浏览器和网站域名隔离，换域名、换浏览器或清理浏览器后需重新选文件，结果应及时下载。CSV 分析不占用站主的云存储、服务器推理或数据库额度；网站页面及模型资源下载、登录、用户手动触发的滴图规划仍需联网，并有相应带宽、服务或供应商用量。

账号邮箱、用户名、创建时间、密码哈希与盐，以及有限的登录计数和失败锁定状态保存在服务端；共享认证限流使用一个固定大小的小计数对象，不存明文密码或 CSV 审计。`session` GET 只验证签名会话，不访问 Blob。浏览器登录门控用于产品访问管理，不能保证用户无法篡改前端脚本或自行运行本机计算；登录、驾车等云端服务仍独立执行服务器鉴权。详见 [2026-10-17 账号与本机数据说明](ACCOUNT_REQUIRED_LOCAL_DATA_2026-10-17.md)。

## 本机预构建发布

执行前确认 CLI 已登录且项目链接为 `fyw/pasc-tcn-gis`。本机必须已有 `scripts/build-pasc-local-worker.mjs` 所需的 ONNX 导出资源；这些资源位于被 Git 忽略的 `artifacts/`，仅推送源代码不能保证远端构建具备它们。

```powershell
$env:NO_UPDATE_NOTIFIER='1'
$env:VERCEL_TELEMETRY_DISABLED='1'
node node_modules/vercel/dist/index.js pull --yes --environment=production
node node_modules/vercel/dist/index.js build --prod --standalone --yes
node scripts/enforce-local-data-deployment.mjs
node scripts/verify-vercel-output.mjs
node node_modules/vercel/dist/index.js deploy --prebuilt --prod --yes --archive=tgz
```

必须按“Vercel build → enforce → verify → deploy”的顺序执行；重新构建后必须重新 enforce。enforce 只删除本次生成输出中的六个已关闭函数，写入静态 403 政策响应，并检查仅保留登录与驾车两个函数；不删除源代码或云端用户数据。

Windows 上构建和验证步骤需要创建目录符号链接的权限。`verify-vercel-output.mjs` 会核对生产构建标识、全部当前静态文件哈希、九个浏览器运行时文件、两个保留函数及六个关闭 API 的静态 403 路由，并实际导入两个函数入口。任何一步失败都应停止发布。不要仅发布 `static-dist`，否则会遗漏登录与驾车 API。

验证脚本也会规范化静态路径分隔符并修复输出目录中的依赖链接。Windows standalone 构建可能把 pnpm 依赖写为指向本机仓库的绝对链接；脚本仅把这些链接重新连接到同一函数目录中已存在的依赖，并验证目标未越出函数目录。Vercel CLI 的 tgz 打包会将链接目标中的反斜杠转换为 `/`。

`pull` 会下载生产变量，包含机密，必须获得明确授权且确认 `.vercel/.env.production.local` 被 Git 忽略，不打印内容。本轮用户已明确允许仅用于本次构建。发布方式遵循 [Vercel 本机构建](https://vercel.com/docs/cli/build) 与 [prebuilt 部署](https://vercel.com/docs/cli/deploy) 文档；它不会自动完成外业阶段的业务/实地验收。

## 发布后核验

- `/` 和 `/map` 应返回 200，并引用当前构建的入口脚本。
- 入口脚本及 `/__pasc-local/worker/worker.js` 应与本机构建内容一致。
- WASM 文件应返回 200，类型为 `application/wasm`；配套 MJS 应以 JavaScript 类型返回。
- 未登录请求 `/api/auth?op=session` 应返回 200、`authenticated: false`。
- 六个已关闭云 API 均应返回静态 403 和 `error.code: USER_DATA_LOCAL_ONLY`，不执行服务端函数。
- `/data-processing-policy.json` 应返回 200 和 `localOnly: true`。
- GET `/api/roadops/driving` 应返回 405。
- 当前生产驾车POST未登录返回401，缺Origin返回403；即使Key存在也不得触发供应商。旧无Key部署的503验收仅是历史，不再用于当前登录保护版。
- 账号修正版发布后另验浏览器访问：访客打开默认 `/map`、`/datasets`、`/pasc-local` 时不得打开用户文件选择器；指定公开 demo 可浏览，但用户 CSV 导入与分析仍需先登录。
- 公开 demo 成功授权接纳个人文件后，应切为严格登录工作区；CSV、GIS、照片和 JSON 文件操作均适用。之后会话过期须隐藏整个工作台并显示登录门控，同账号续登保留 File，另一账号不得看到旧个人 File。
- 同一账号会话过期后，重新登录应保留原标签页中的 File、字段映射与已有地图结果；不得因此上传 CSV 或调用云端数据/推理 API。这里的浏览器流程需单独验证，下面的 HTTP 资源脚本不覆盖它。

```powershell
node scripts/verify-vercel-release.mjs https://pasc-tcn-gis.vercel.app --check-protected-roadops
```

本机如通过已配置的 HTTP(S) 代理访问外网，可在支持该选项的 Node 版本加 `--use-env-proxy`；不关闭 TLS 验证，也不另行更改网络配置。

这些检查验证资源发布、本机政策和登录/驾车接口保护，不替代真实 CSV 浏览器识别测试，也不证明真实滴图规划或外业通行已经恢复。云存储、外部 AI 和队列任务在当前版本均关闭。

## 2026-10-17 登录背景恢复（此前版本）

- 根据用户反馈，恢复原有 `/insar-satellite-v2.png` 卫星图片、轨道装饰和深蓝网格，修正左侧文字对比度。右侧表单、账号策略、数据本机处理和滴图保护保持不变。
- 部署 `dpl_8E15cL5jPxGFFLyFQf6QGC2tTx79` READY，正式域名 26 项检查通过，其中当前 CSS 与原图片字节完全匹配；没有新的 CSV 上传、账号写入或供应商请求。详见 `LOGIN_BACKGROUND_RESTORE_2026-10-17.md` 和 `artifacts/login-background-production-release.json`。

## 2026-10-17 账号访问与本机数据分离版（账号策略延续至当前版）

- 恢复登录/注册、用户名和退出入口，使用共享会话状态；默认工作台、数据页和 PASC 独立入口需登录。公开指定 demo 可免登录浏览，不能据此免登录导入或分析自己的 CSV。
- 注册保存邮箱、展示用户名及密码哈希/盐等账号元数据，成功登录更新 `lastLoginAt`、`loginCount`；失败窗口与锁定状态有界，共享认证计数为固定小对象。会话 GET 不读取或写入 Blob，不记录明文密码或 CSV 内容审计。
- 实际 CUA 浏览器以合成认证响应验证：访客文件选择器元素数量 0；模拟登录后导入 4 点、24 期混合日期 CSV；映射阶段和地图阶段会话过期后，同账号续登分别保留 File/日期和 4 点、24 期地图结果。该流程记录认证请求 9 次、云数据 API 0 次、CSV 上传 0 次，不等于真实账号云端注册/登录验收。
- 最后复核另验证 `/map?demo=road`：登录后从地图直接接纳个人 CSV，即将公开案例切为严格登录工作区；会话过期后整个地图不可见且显示登录门控，同账号续登保留 File，切换另一账号后旧个人 File 不可见。该独立流程记录认证请求 5 次、数据 API 0 次、CSV 上传 0 次。GIS、照片和 JSON 文件同样在成功授权个人文件操作后进入严格登录工作区。
- 截图：`artifacts/account-required-browser.jpg`、`artifacts/account-session-expired-browser.jpg`、`artifacts/account-local-map-resume-browser.jpg`；公开案例转个人工作区复核：`artifacts/account-public-workspace-guard-browser.jpg`（切换另一账号后的视图）。
- 2026-10-17 Blob 只读状态检查为 `billingState: active`、`status: available`、`usageQuotaExceeded: false`；证据 `artifacts/auth-blob-state-check.json`。这是存储状态证据，不是真实滴图规划成功证明，本轮未发起新的真实算路。
- 部署 `dpl_57tq2QBc4dJUpUb4PWySZaPUdvVN` 已 READY，正式域名当前入口 `/assets/index-C9CvJZuu.js`，固定版本 `https://pasc-tcn-okczcqqs1-fyw.vercel.app`。正式域名 24 项检查通过，保持两个函数及六个静态 403；真实正常 API 注册/退出/错误密码/登录/会话和账号元数据验收通过，新 QA 账号已核对 ID、注册时间、ETag 后条件清理，原账号元数据不变。证据 `artifacts/account-production-release.json`、`artifacts/account-production-auth-verification.json`。完整 TypeScript 仍有既有诊断，不宣称全仓类型全绿。

## 2026-10-16 用户 CSV 全本机版（历史发布，免登录策略于 17 日更正）

- 部署 `dpl_71ZeYTYa38h68UCsBkJM3Bech7Du` 已发布。[正式站点](https://pasc-tcn-gis.vercel.app)，[固定版本](https://pasc-tcn-ewtw3o8bl-fyw.vercel.app)。当前入口 `/assets/index-a0QCFLbZ.js`。
- 该版当时允许用户无需登录选择自己的 CSV；此免登录策略已于 2026-10-17 更正为需登录访问，CSV 继续本机处理。字段、日期自动识别、时序分析及模型计算留在访问者电脑。大文件不再转后台；超过 1 GiB 先在本机拆成最多 25,000 行、128 MiB 的独立片，再逐片分析。
- 生产只发布 `auth`、`roadops/driving` 两个函数；六个云数据/任务/AI API 的函数产物已移除，由静态 403 `USER_DATA_LOCAL_ONLY` 阻断。静态资源、登录和手动驾车请求仍有网络与用量，不能据此宣称全站离线或零费用。
- 正式域名 24 项线上检查通过，覆盖页面入口、Worker 哈希、八个 ORT 资源类型、匿名会话、六个静态 403、政策文件以及驾车未登录/缺 Origin 的拒绝行为。证据：`artifacts/local-only-production-release.json`。未发起新的真实滴图算路；接口保护通过不等于供应商服务已恢复。
- 经用户批准的 77 个 CSV 分块（合计 308 MiB）已删除；其余账户、共享账本和数据未变。Blob 官方封锁计划于北京时间 2026-10-16 19:45:40 结束；截至当次发布尚未恢复。后续 17 日只读检查已为 active/available，见上方记录；该检查仍不代表真实算路验收。
- 完整 TypeScript 仍有既有诊断，本次发布不宣称全仓类型检查全绿。

## 2026-10-12 地图按钮尺寸调整（此前版本）

- 按用户截图调整顶部「数据、图层、驾车、分析、核查、导出」和右上角地图工具的按钮尺寸、字号与图标。保留原有配色、边框、组件位置和已精简的驾车文案。
- 桌面主导航高 44px、字号 15px、图标 22px；地图下拉控件最小高 52px，工具按钮最小高 48px。窄窗口保留响应式尺寸，只收紧中等桌面窗口的顶部间距，兼容英文登录后的「My data」。
- 部署 `dpl_D5BwzFkGrhUc5ybRnZAFqVAqoP46` 已 READY。[正式工作台](https://pasc-tcn-gis.vercel.app/map?source=local)，[固定版本](https://pasc-tcn-ah771q6rf-fyw.vercel.app/map?source=local)。入口 `/assets/index-CiL-LiA3.js`，CSS `/assets/index-Bs3LvO9A.css`。
- 完整 CSS 声明与上一原样式版本比较，只变化 34 项指定控件的尺寸、字号和间距属性。此次 CSS 因按钮尺寸调整而变化，不再沿用上一轮全文件哈希相同的结论。
- 9 项组件回归、170 项实际 Edge 浏览器验收通过；覆盖 1920、1280、900、390px、9,069 点/210 期公共数据加载、六项导航、下拉鼠标与键盘操作、模拟登录后的「我的数据」以及 1280px 英文控件边界。验收阻断外部底图请求，没有真实登录或供应商调用。
- 完整生产输出 76 个静态文件、9 个浏览器运行时、8 个 API 以及凭据扫描通过。正式站点 26 项页面、当前资源哈希和未登录接口保护检查通过，包含本次尺寸 CSS 的完整字节核对。
- 证据 `artifacts/workspace-controls-deployment.json`、`artifacts/workspace-controls-release-combined.json`、`artifacts/workspace-control-css-scope.json`、`artifacts/workspace-control-size-browser.json` 及对应截图目录；前一正式版归档为 `artifacts/vercel-previous-driving-copy-deployment.json`。

## 2026-10-12 原样式文案精简版（此前版本）

- 按用户明确要求恢复原有按钮和排版，仅保留文案缩减、重复提示合并与现有说明的折叠展示；撤回上一轮新增的界面样式及顶部快捷按钮。
- 部署 `dpl_4SEqwDsEtjWYc6NDeXNR2C45oLLc` 已 READY。[正式工作台](https://pasc-tcn-gis.vercel.app/map?source=local)，[固定版本](https://pasc-tcn-6sr06vxw4-fyw.vercel.app/map?source=local)。入口 `/assets/index-yY1u6tSM.js`。
- 该轮完整 CSS `/assets/index-BVBdbVgr.css` 与文案修改前的部署逐字节一致，均为 499,412 字节；原有蓝色主按钮、字号、尺寸与底部位置已用实际浏览器验证。
- 本轮 25 项界面回归、73 项实际 Edge 浏览器验收通过，生产完整输出和凭据扫描通过。正式站点 26 项检查通过，包含原样式文件哈希和未登录接口保护；未请求地图供应商。
- [验收说明](ROADOPS_DRIVING_CLARITY_ACCEPTANCE.md)。证据 `artifacts/roadops-style-restore-deployment.json`、`artifacts/roadops-restored-css-baseline-check.json` 和当前组合发布检查。

## 2026-10-12 驾车行程新布局版（已撤回）

- 部署 `dpl_CZNLCQmUzF81SiEJYdeYiE4ZVbLg` 发布时已 READY，后按用户要求恢复原样式。[固定版本](https://pasc-tcn-ra49jplwe-fyw.vercel.app/map?source=local)。该版入口 `/assets/index-DmoOJSfD.js`。
- 将任务概况、主操作和行程摘要前置，简化逐站安排；备份、核验、证据和服务用量按需展开。总时长旁保留未核实转移时间的说明；折叠表单仍保留未保存输入和通行阻断。
- RoadOps 382 项、CSV 工作流 143 项回归通过；最终界面检查 25 项、实际 Edge 界面验收 66 项、CSV 浏览器完整流程 18 项通过。界面浏览器验收使用真实组件、样式与 IndexedDB，行程道路数据为明确标记的模拟夹具。
- 完整生产输出 76 个静态文件、9 个浏览器运行时、8 个 API 校验通过，产物凭据扫描通过。正式域名 25 项页面、资源哈希、运行时类型和未登录接口保护检查通过；未发起地图供应商调用。
- 该轮固定概要 `artifacts/roadops-driving-clarity-deployment.json`；撤回后的历史归档为 `artifacts/vercel-driving-ui-redesign-deployment.json` 与 `artifacts/vercel-driving-ui-redesign-release-combined.json`。当前界面验收按用户后续要求修正，见上方原样式版本。

## 2026-10-12 本机 CSV 完整流程版（此前版本）

- 用户授权发布当前工作区版本；采用既有 fyw/pasc-tcn-gis 的生产 prebuilt 流程，未做 Git 提交/推送。
- 部署 dpl_V8VXe3XCAqZvhZNkYoZnqf4NJBhe 已 READY，发布时正式域名指向该版。[本机 CSV 工作台](https://pasc-tcn-gis.vercel.app/map?source=local)，[固定版本](https://pasc-tcn-l0my0gkij-fyw.vercel.app/map?source=local)。该版入口 /assets/index-CHUrBQzU.js。
- 本版包含完整点层、异常/AOI Worker、CSV 模板、原始观测/缺测、三状态字段、分析来源校验及考察任务接续；保持既有八个 API 和生产鉴权/额度保护。
- 发布前：143/143 本地流程回归；RoadOps 两组 91/91 与 291/291（合计 382）通过。旧策略比较隔离 VM 夹具补入新增真实依赖后重跑，不跳过原行为断言，仅修改测试文件。
- 生产构建成功；76 个当前静态文件、9 个浏览器运行时、8 个 API 全部核验；2,816 个产物文本中的 5 个非公开凭据精确匹配为 0，没有环境文件入包。完整 TypeScript 仍有既有诊断，未宣称全仓类型通过。
- 正式域名共 25 项检查通过：13 项页面/入口与 Worker 哈希/ORT 类型，9 项登录及受保护 API，另 3 项新增异常 Worker、完整点层模块和 CSV 模板哈希；线上字节与本机包一致。
- Node 的本机代理连接中断后，使用保留 TLS 校验的原生 PowerShell 完成 9 项 API 检查；组合证据归档为 artifacts/vercel-csv-workflow-release-combined.json，未放宽 TLS 或更改全局代理。
- 本轮未登录、未提交真实驾车点集，也未发起地图商/AI 供应商请求；没有修改或重置共享账本。部署核验不替代实际 CSV、真实登录后路线接续和外业可达性验收。
- 上一正式版本 dpl_8BN1wVYYSQVxWaSRJarc7LtWZj4E / https://pasc-tcn-npttusk8l-fyw.vercel.app 仅作版本对照，未执行回滚。发布概要归档为 artifacts/vercel-csv-workflow-deployment.json。

## 2026-10-09 生产驾车保护版（历史版本）

- 后续用户明确授权接通线上驾车，完成签名会话登录保护、HTTPS同源POST及私有Blob持久共享账本，随后配置既有项目Production Sensitive服务端Key。密钥只经stdin，没有打印、Git提交或前端暴露；TypeSafe仍未配置。
- 当前部署 `dpl_8BN1wVYYSQVxWaSRJarc7LtWZj4E` READY；[正式工作台](https://pasc-tcn-gis.vercel.app/map?demo=road) 已指向该版本，[固定版本](https://pasc-tcn-npttusk8l-fyw.vercel.app)。入口 `/assets/index-Byrr14Td.js`。前一保护版 `dpl_Bdy4th8dTEyXBJXvjWB6E8Rj46ca` 仅作历史，非法JSON边界问题已在当前版修复。
- 生产硬上限100 HTTP尝试/上海日、每签名账号20、全局1QPS与单活动lease；无自动供应商重试。账本缺失/损坏/读写失败拒绝发送，不降级到进程计数，不自动重新建0账本。缓存不跨实例共享，仍须查共享余额；保护计数不等于官方账单。
- 62/62生产保护、277/277原RoadOps、25/25界面回归通过；定向lint/strict TS、74静态/9runtime/8API构建核验、829文件扫描及2299产物文本的凭据精确匹配通过（匹配0、环境文件入包0）。
- 正式别名22项资源/哈希/API/零调用保护检查通过；正常QA注册/登录/会话、非法schema/raw JSON422、媒体415通过。一项真实两点滴图规划200，本次HTTP2、packs1、无重试/假回退；真实道路折线/距离/耗时仅运行时验证，不落盘供应商数据。
- QA账号退出并条件删除、回读不存在；共享账本2026-10-09计数2、lease关闭，没有重置。管理员Blob代理辅助仅复用已有环境代理并保持TLS，不影响生产配置。
- [详细验收](ROADOPS_PRODUCTION_DRIVING_ACCEPTANCE.md)。本轮不宣称FP3B/FP4排程/FP5风险/完整FP6、实地可通行、地图适用性许可、完整公共注册防滥用或账号云同步完成。

## 2026-10-09 首次工作区发布（无Key，历史记录）

- 用户授权将当前本地最新代码发布到既有 `fyw/pasc-tcn-gis`；没有 Git 提交/推送，不使用 9 月旧部署包。
- 已构建并验证 74 个静态文件、9 个推理运行时、8 个 API。静态集合及哈希与本机一致；机密匹配及敏感文件路径检查为空。
- 部署前修复新增驾车 API 的 Node ESM 引用缺少 `.js`，重新构建后八个入口实际导入通过；没有带着首次校验失败上传。
- 276/276 RoadOps、25/25 工作台/文案/主题、66/66 PASC 离线回归通过；定向 lint 与密钥扫描通过。并非浏览器全部交互或完整账号功能验收。
- 生产未配置 DIDI_MAP_WEB_SERVICE_KEY/TYPESAFE_API_KEY，未上传本地密钥。公开实时驾车保持不可用；共享持久额度/鉴权完成前不得直接启用未保护付费 Key。
- 外业 FP0/FP1 工程通过，FP2/FP3A 部分完成，FP3B/FP4–FP6 未完成。旧 RoadOps Phase0–6 的公开 RC 也非全部通过。此次发布授权不关闭未完成的技术、数据许可和地图适用性台账。
- 本机 4193 的任务/核验/照片不会自动迁移至正式域名；任务备份可明确导入，核验历史备份导入与照片关联仍未实现。IDB 不等于账号云同步/隔离。
- 上传前旧正式部署：`dpl_gTRJe4GZk1ZA2HDAUHBHVivwxpsh`，固定地址 `https://pasc-tcn-ehaf6aeb6-fyw.vercel.app`；只记录作版本对照，未执行回滚。
- 最新部署 `dpl_JE6z7ALax3fhpcBsb6qZjGH19YR4` 已 READY，正式域名 [pasc-tcn-gis.vercel.app](https://pasc-tcn-gis.vercel.app) 已指向该版本；[固定版本地址](https://pasc-tcn-d25gluvjd-fyw.vercel.app)。当前入口为 `/assets/index-CoNAApt6.js`。
- 正式域名 22 项线上检查通过：三页 200 且入口匹配、入口与 worker 的 SHA-256 相同、八个 ORT 文件 200 且类型正确、七个 GET API 的鉴权/方法行为正确、两个合成 RoadOps POST 返回无 Key 的 503。驾车响应明确上游请求 0、无假路线回退；没有真实滴图或 TypeSafe 调用。
- 首次 Node 直连超时不是发布失败；PowerShell HTTPS 首页已 200，随后使用 Node `--use-env-proxy` 完整检查通过，未放宽 TLS 或修改网络配置。线上检查不等于浏览器交互、用户注册登录、云任务或实地核查验收通过。

## 2026-09-13 发布修复

修复 Windows 输出中的 208 个绝对依赖链接，消除线上 `Cannot find package '@vercel/blob'`。同时将 AI 摘要的模式名称转换直接引用纯函数 `pascDisplayName`，避免服务端运行时依赖浏览器 React context。名称转换行为保持一致；相关十项 AI 摘要与提供商测试通过。

正式部署 `dpl_2MN8ubASVYMayAcSxwm3vhMSQYeh` 已于北京时间 17:44 完成，状态为 READY，正式域名已指向本次版本。固定版本地址：https://pasc-tcn-dkmpdpdb0-fyw.vercel.app 。

发布后 17 项线上检查通过：两个页面、入口脚本与浏览器 Worker 的内容校验、八个 WASM/MJS 资源响应，以及上述五个 API 的预期响应。当前入口为 `/assets/index-DDahNb71.js`。线上记录保存在本机 `.work/vercel-production-check.json`；本轮未执行需要登录或调用外部付费服务的完整云端任务。
