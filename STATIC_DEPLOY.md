# LANJIFYW 纯前端部署

## 构建

运行 `pnpm run build:static`，产物位于 `static-dist/`。

## 数据

- 内置文件：`static-dist/data/haikou-insar.csv`
- 4,072 个有效点，210 期时序字段
- 浏览器识别 `FID`、`xpos`、`ypos`、`DYYYYMMDD` 和 `Pattern`
- 无效的 `0,0` 坐标会被过滤
- 年均速率由全部时序观测执行线性回归计算

## 托管要求

将 `static-dist/` 整个文件夹上传到任意静态托管即可。站点不需要 Node.js、数据库、登录服务或后端 API。

由于底图来自公开网络，访问地图时仍需联网。OSM 和 Esri 无需本站密钥；天地图需在页面运行前设置 `window.__TIANDITU_KEY__`。
