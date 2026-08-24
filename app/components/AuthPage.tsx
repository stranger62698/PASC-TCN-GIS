"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authRequest, getSession } from "../lib/auth-client";

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

  useEffect(() => { getSession().then((user) => { if (user) window.location.href = "/datasets"; }).catch(() => null); }, []);

  const switchMode = (next: AuthMode) => { setMode(next); setMessage(""); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "login") {
        await authRequest("login", { email, password });
        window.location.href = "/datasets";
      } else if (mode === "register") {
        if (username.trim().length < 3 || username.trim().length > 16) throw new Error("用户名长度需为 3–16 位");
        await authRequest("register", { email, password, username: username.trim() });
        window.location.href = "/datasets";
      } else {
        await authRequest("forgot", { email });
        setMessage("如果该邮箱已注册，重置说明将发送到对应邮箱。");
      }
    } catch (error) { setMessage(errorText(error)); } finally { setBusy(false); }
  };

  const title = mode === "login" ? "登录分析平台" : mode === "register" ? "注册新账户" : "找回密码";
  const intro = mode === "login" ? "登录后可保存私人数据集和分析记录。" : mode === "register" ? "创建账户，用于保存私人数据与跨设备继续分析。" : "输入注册邮箱，我们会发送密码重置说明。";

  return (
    <main className="new-login phase-eight-login">
      <section className="login-scene grid-surface">
        <Link className="site-brand invert" href="/"><img src="/insar-satellite-v2.png" alt="InSAR 卫星" /><span><b>LANJIFYW</b><small>城市时序 InSAR</small></span></Link>
        <div className="auth-scene-content">
          <span className="eyebrow">OPEN DEMO · PRIVATE WORKSPACE</span>
          <h1>先体验，<br /><em>再决定是否登录</em></h1>
          <p>公开示例、点位分析、区域统计和 AI 辅助解读均可直接体验；只有保存私人数据和分析记录时才需要账户。</p>
          <div className="auth-public-actions"><Link className="button primary" href="/map?demo=haikou">体验公开示例 ↗</Link><Link className="button line-light" href="/datasets">检查我的 CSV</Link></div>
          <div className="auth-access-list">
            <article><b>无需登录</b><span>示例地图、点位、区域与 AI 演示</span></article>
            <article><b>登录后</b><span>保存私人数据集、任务和分析记录</span></article>
            <article><b>数据隐私</b><span>私人数据按用户身份隔离</span></article>
          </div>
        </div>
      </section>
      <section className="login-panel">
        <div className="auth-panel-shell">
          <div className="auth-panel-top"><Link className="back-link" href="/">← 返回首页</Link><Link className="auth-demo-link" href="/map?demo=haikou">无需登录，直接体验</Link></div>
          <form onSubmit={submit}>
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
          </form>
          <p className="auth-privacy-note"><b>为什么需要登录？</b> 仅用于将私人数据集和分析记录关联到你的账户；浏览公开内容不受限制。</p>
        </div>
      </section>
    </main>
  );
}
