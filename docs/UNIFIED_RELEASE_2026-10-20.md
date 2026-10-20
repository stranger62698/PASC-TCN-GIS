# 2026-10-20 本地与线上统一发布

本次以当前本地工作目录为发布源，保留 10 月 19 日已上线的蓝色导航修复，完整构建并发布到原正式域名。发布前，线上为 10 月 19 日的样式补丁版，GitHub main 为 9 月 11 日的源码快照；当前本地源码更新。

- 正式站点：https://pasc-tcn-gis.vercel.app
- 固定版本：https://pasc-tcn-of60eob2e-fyw.vercel.app
- 部署：`dpl_72aNPU2Y4p1EncWdP9A3UNCV619P`，`READY`。
- 版本：`2026-10-20-88047ed225a2`。
- 源码 SHA-256：`88047ed225a2c3996f11302402813a672db2543cb42f710da5f40b9ca863cf82`。
- 版本核对：https://pasc-tcn-gis.vercel.app/release.json
- 前端入口：`/assets/index-P5WkXFZ5.js`；CSS：`/assets/index-Oppp-NTY.css`。

## 验证

- 生产静态/Vinext 构建通过；199 项站点回归、173 项本机 CSV 工作流、41 项认证及页面政策、91 项 RoadOps 生产保护、297 项 RoadOps 回归通过。分组存在交叉，不合并为去重总数。
- 77 个静态文件、9 个浏览器运行时与两个服务函数通过当前源码及文件哈希校验。修复两个 Windows 目录依赖链接，两个函数的 Blob 依赖实际解析和导入通过。
- 完整发布包 825 个文件、64 个依赖链接通过检查；环境/认证配置文件入包为 0，三个生产秘密精确匹配为 0。
- 正式域名 25 项版本、页面、入口、Worker、ORT、认证、接口保护和本机数据政策检查通过；另有 6 项 CSS 完整字节及既有页面/公开 demo 资源检查通过。
- 保留登录与驾车两个函数；六个云数据/任务/AI API 维持静态 403。未创建或删除用户账号，未上传用户 CSV，未调用真实驾车或外部 AI 供应商。
- 本轮 HTTP 检查不替代登录后的完整浏览器交互或真实供应商算路验收；完整 TypeScript 仍有既有诊断，不宣称全仓类型全绿。

## 源码与发布规则

正式站点关联的源码仓库为 `stranger62698/PASC-TCN-GIS`。统一快照仅以该仓库原 main 为父提交，保留当前本地工作区和索引，不公开本地另一个分支中的私人文档历史。模型和参考资源继续保留在忽略的本机 artifacts 中；Git 仓库不保存生产环境变量、用户数据或本次生成的发布包。

由于构建依赖本机模型，本项目统一采用“本机完整构建 → enforce → verify → prebuilt 正式发布”。`vercel.json` 设置 `git.deploymentEnabled: false`，同步源码不会触发缺少模型的 Git 自动发布；参见 [Vercel 官方 Git 配置](https://vercel.com/docs/project-configuration/git-configuration#turning-off-all-automatic-deployments)。具体命令见 [部署说明](VERCEL_DEPLOYMENT.md)。

每次构建自动生成 `release.json`。源码指纹覆盖生产源码、公开资源、构建配置及两项模型输入，排除环境机密。发布前检查当前源码指纹，发布后逐字节核对线上版本文件。

本机验收证据保存在 `.work/unified-release-20261020/`；其中只向源码仓库提交本说明，不提交私有项目响应、生产配置或生成产物。
