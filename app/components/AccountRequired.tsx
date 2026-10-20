"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useAccountSession } from "../lib/account-session";
import { buildLoginContinuationHref } from "../lib/local-analysis-session";

/** Keeps an authorized tab's local File/results mounted while re-authentication is needed. */
export function AccountRequired({ children, publicAccess = false }: { children: ReactNode; publicAccess?: boolean }) {
  const account = useAccountSession();
  const [owner, setOwner] = useState<string | null>(null);
  if (account.status === "authenticated" && account.user && owner !== account.user.id) setOwner(account.user.id);
  const allowed = publicAccess || account.status === "authenticated";
  const mounted = publicAccess || owner !== null;
  return <>
    {!allowed && <section className="account-access-gate" aria-label="账户访问验证">
      <div className="account-access-card">
        <span className="eyebrow">ACCOUNT ACCESS · LOCAL DATA</span>
        <h1>{account.status === "checking" ? "正在验证登录状态…" : "登录后导入与分析"}</h1>
        <p>请登录或注册账户后使用个人数据导入和分析。账户用于访问管理与防滥用，CSV、分片与计算仍留在您自己的电脑，不会上传云端。</p>
        {account.status === "error" && <p role="alert">{account.error}</p>}
        {owner && <p role="status">登录状态需要重新确认。当前标签页的文件和分析结果已保留，请在新标签页登录后回来验证。</p>}
        <div className="account-access-actions">
          <a className="button primary" href="/login?returnTo=%2Fdatasets" target={owner ? "_blank" : undefined} rel={owner ? "noopener noreferrer" : undefined} onClick={event => {
            const returnTo = window.location.pathname + window.location.search + window.location.hash;
            event.currentTarget.href = owner ? buildLoginContinuationHref(returnTo, window.location.origin) : `/login?${new URLSearchParams({ returnTo })}`;
          }}>登录 / 注册</a>
          <button className="button ghost" type="button" onClick={() => void account.refresh()}>重新验证登录</button>
          <Link className="button ghost" href="/">返回首页</Link>
        </div>
        <small>平台记录注册邮箱、用户名及必要登录记录。原始数据不作为账户信息上传。</small>
      </div>
    </section>}
    {mounted && <div key={owner ?? "public"} className="account-access-content" hidden={!allowed} inert={!allowed}>{children}</div>}
  </>;
}
