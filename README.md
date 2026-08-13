# LANJIFYW 澜迹 · 海口时序 InSAR WebGIS

这是可在 Edge、Chrome 等现代浏览器中使用的完整网站项目。页面支持导入海口 InSAR CSV（`FID,xpos,ypos,DYYYYMMDD...,Pattern`）、自动剔除无效坐标、计算研究区外包范围、定位 OSM/Esri 底图，以及点选查看时间序列。

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
- 形变模式：`Pattern`，支持 `Stable`、`Linear`、`Piecewise`、`Stepwise`、`Undefined`
- 可选字段：`velocity/rate`、`coherence/coh`；缺少速率时由首末期累计形变与时间跨度自动估算

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

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
