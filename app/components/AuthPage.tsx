"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authRequest, getSession } from "../lib/auth-client";
import { safeReturnTo } from "../lib/local-analysis-session";

type AuthMode = "login" | "register" | "forgot";

const errorText = (error: unknown) => {
  const message = error instanceof Error ? error.message : "操作失败，请稍后重试";
  if (/invalid login|invalid email or password/i.test(message)) return "邮箱或密码错误";
  if (/already registered/i.test(message)) return "该邮箱已经注册，请直接登录";
  if (/password/i.test(message) && /short|length|least/i.test(message)) return "密码长度需为 6–16 位";
  return message;
};

export function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [continuedLogin, setContinuedLogin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSession().then(user => {
      if (!user || cancelled) return;
      const query = new URLSearchParams(window.location.search);
      if (query.get("resume") === "1") setContinuedLogin(true);
      else window.location.href = safeReturnTo(query.get("returnTo"), window.location.origin);
    }).catch(() => null);
    return () => { cancelled = true; };
  }, []);

  const finishLogin = () => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("resume") === "1") {
      setContinuedLogin(true);
      setMessage("登录成功。请回到原来的分析标签页，再手动重试；文件和分析结果仍留在原页。");
    } else window.location.href = safeReturnTo(query.get("returnTo"), window.location.origin);
  };

  const switchMode = (next: AuthMode) => { setMode(next); setMessage(""); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "login") {
        await authRequest("login", { email, password });
        finishLogin();
      } else if (mode === "register") {
        if (username.trim().length < 3 || username.trim().length > 16) throw new Error("用户名长度需为 3–16 位");
        await authRequest("register", { email, password, username: username.trim() });
        finishLogin();
      } else {
        await authRequest("forgot", { email });
        setMessage("如果该邮箱已注册，重置说明将发送到对应邮箱。");
      }
    } catch (error) { setMessage(errorText(error)); } finally { setBusy(false); }
  };

  const title = mode === "login" ? "登录工作台" : mode === "register" ? "注册新账户" : "找回密码";
  const intro = mode === "login" ? "登录后可导入自己的 CSV 并使用本机分析。账号用于访问管理，文件与计算保留在当前电脑。" : mode === "register" ? "注册会保存邮箱和展示用户名，用于登录与访问管理。CSV 与计算仍在当前电脑。" : "输入注册邮箱，我们会发送密码重置说明。";

  return (
    <main className="new-login phase-eight-login">
      <section className="login-scene grid-surface">
        <div className="auth-orbit-visual" aria-hidden="true">
          <i className="auth-orbit-ring ring-a" /><i className="auth-orbit-ring ring-b" /><i className="auth-orbit-ring ring-c" />
          {/* Existing decorative asset from the original account page. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <span className="auth-orbit-core"><img src="/insar-satellite-v2.png" alt="" /></span>
          <b className="auth-orbit-point point-a" /><b className="auth-orbit-point point-b" /><b className="auth-orbit-point point-c" />
        </div>
        <div className="auth-scene-content">
          <span className="eyebrow">OPEN DEMO · PRIVATE WORKSPACE</span>
          <h1>形变分析与<br /><em>外业核查工作台</em></h1>
          <p>公开案例可直接浏览；导入自己的 CSV 与分析功能需先登录。账号用于访问管理，本机文件可在原分析标签页继续处理。驾车规划需调用已配置的滴图服务，账户操作可在此完成。</p>
          <div className="auth-public-actions"><Link className="button primary" href="/map?demo=haikou&tour=portfolio">浏览公开案例 ↗</Link><Link className="button line-light" href="/datasets">登录后导入本机数据</Link></div>
          <div className="auth-access-list">
            <article><b>公开访问</b><span>示例地图、形变分析与外业核查流程</span></article>
            <article><b>登录后分析</b><span>CSV 在本机处理；超过 1 GiB 先本机分片，再逐片分析</span></article>
            <article><b>数据隐私</b><span>账号管理访问权限，原始 CSV 与分析结果保留本机</span></article>
          </div>
        </div>
      </section>
      <section className="login-panel">
        <div className="auth-panel-shell">
          <div className="auth-panel-top"><Link className="back-link" href="/">← 返回首页</Link><Link className="auth-demo-link" href="/map?demo=haikou">浏览公开案例</Link></div>
          {continuedLogin ? <section className="auth-continuation" role="status"><h2>登录已完成</h2><p>请回到原来的分析标签页，继续当前文件与分析结果，然后手动重试需要登录的操作。</p><p>可以关闭此登录标签页。</p></section> : <form onSubmit={submit}>
            <div className="auth-heading"><span className="eyebrow">ACCOUNT ACCESS</span><b>{mode === "login" ? "01" : mode === "register" ? "02" : "03"}</b></div>
            <h2>{title}</h2><p>{intro}</p>
            <div className="auth-form-fields">
              {mode === "register" && <label>用户名 <small>用于平台内展示</small><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3–16 位展示用户名" autoComplete="username" minLength={3} maxLength={16} required /></label>}
              <label>邮箱 <small>作为唯一登录账号</small><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" required /></label>
              {mode !== "forgot" && <label>密码 <small>6–16 位</small><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入账户密码" minLength={6} maxLength={16} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>}
            </div>
            {message && <div className="auth-message" role="status">{message}</div>}
            <button className="button primary login-button" type="submit" disabled={busy}>{busy ? "正在处理…" : mode === "login" ? "登录并进入平台  →" : mode === "register" ? "创建账户并进入  →" : "发送重置说明  →"}</button>
            <div className="auth-secondary-actions">
              {mode === "login" && <button className="auth-switch" type="button" onClick={() => switchMode("forgot")}>忘记密码？</button>}
              {mode === "login" && <button className="auth-switch strong" type="button" onClick={() => switchMode("register")}>没有账号？立即注册</button>}
              {mode !== "login" && <button className="auth-switch strong" type="button" onClick={() => switchMode("login")}>← 返回账户登录</button>}
            </div>
          </form>}
          <p className="auth-privacy-note"><b>账户与隐私</b> 注册会保存邮箱和展示用户名，用于访问管理；公开案例无需登录。CSV 与分析结果按当前浏览器、网站域名保留在本机，不会自动上传或跨设备同步，请及时下载结果。</p>
        </div>
      </section>
    </main>
  );
}
