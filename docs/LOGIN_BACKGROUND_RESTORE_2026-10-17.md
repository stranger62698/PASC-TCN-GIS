# 登录页左侧卫星背景恢复

原因：公共主题的 `.new-login.phase-eight-login .login-scene` 将左侧覆盖为 `#f2f4f5`，历史 `auth-orbit-visual` 卫星装饰也已从 JSX 移除。

已按提交 `3df6b8f` 的已知素材恢复深蓝网格、轨道圈及 `/insar-satellite-v2.png`。该原图与历史版本字节一致，SHA-256 为 `6ee9f780ae95ac22b9cd9f9640f940d472d856f02722c007b0c0fbafd8b29e18`。没有使用首页地貌图替代登录原图。

仅恢复左侧视觉和相应文字对比度；右侧表单、账号门控、账号记录、本机 CSV 路径、滴图鉴权和限额保持不变。

本机真实浏览器已确认原图加载成功、背景为 `rgb(6,26,56)`、表单可见、页面无横向溢出。匿名视觉夹具不向真实认证接口发送凭据。截图：`artifacts/login-background-restored-browser.jpg`。

既有文案/样式回归 16/16、账号界面 SSR 与文案组合 10/10 通过（有交叉覆盖），AuthPage 定向 ESLint 通过。生产输出仍为 76 个静态文件、9 个运行时文件及两个服务端函数；凭据匹配与环境文件入包均为 0。

已发布生产部署 `dpl_8E15cL5jPxGFFLyFQf6QGC2tTx79`，固定版本 `https://pasc-tcn-8vkw37aef-fyw.vercel.app`。正式域名入口 `/assets/index-cGgoynfl.js`，CSS `/assets/index-B_-DfITt.css`。

正式域名 26 项检查通过，包括既有 24 项资源/接口保护，以及当前 CSS、原卫星 PNG 的完整字节哈希与 MIME 核对。证据：`artifacts/login-background-production-release.json`。此次没有真实账号注册/登录、CSV 上传或供应商调用；最近账号 API 验收继续参考 `ACCOUNT_REQUIRED_LOCAL_DATA_2026-10-17.md`。
