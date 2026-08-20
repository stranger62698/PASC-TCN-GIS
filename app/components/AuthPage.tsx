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

  useEffect(() => {
    getSession().then((user) => { if (user) window.location.href = "/datasets"; }).catch(() => null);
  }, []);

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
      } else if (mode === "forgot") {
        await authRequest("forgot", { email });
      }
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "login" ? "登录分析平台" : mode === "register" ? "注册新账户" : "找回密码";
  const intro = mode === "login" ? "使用邮箱和密码进入你的私有数据空间。" : mode === "register" ? "设置展示用户名并绑定邮箱，注册成功后自动登录。" : "输入注册邮箱；邮件服务配置完成后可自动发送重置链接。";

  return (
    <main className="new-login">
      <section className="login-scene grid-surface">
        <Link className="site-brand invert" href="/">
          <img src="/insar-satellite-v2.png" alt="InSAR 卫星" />
          <span><b>LANJIFYW</b><small>城市时序 InSAR</small></span>
        </Link>
        <div className="auth-orbit-visual" aria-hidden="true">
          <i className="auth-orbit-ring ring-a" /><i className="auth-orbit-ring ring-b" /><i className="auth-orbit-ring ring-c" />
          <span className="auth-orbit-core"><img src="/insar-satellite-v2.png" alt="" /></span>
          <b className="auth-orbit-point point-a" /><b className="auth-orbit-point point-b" /><b className="auth-orbit-point point-c" />
        </div>
        <div className="auth-scene-content">
          <span className="eyebrow">PRIVATE INSAR WORKSPACE</span>
          <h1>每个账户一套<br /><em>独立数据空间</em></h1>
          <p>从身份认证、CSV 归档到地图分析，所有数据均按照用户 ID 隔离保存，形成面向 InSAR 项目的个人工作空间。</p>
          <div className="auth-proof-grid">
            <article><b>01</b><strong>安全认证</strong><span>密码加盐哈希，服务端校验</span></article>
            <article><b>02</b><strong>空间隔离</strong><span>每个账户独立对象路径</span></article>
            <article><b>03</b><strong>分析延续</strong><span>登录后继续管理数据资产</span></article>
          </div>
          <div className="auth-scene-meta"><span><i /> VERCEL FUNCTION</span><span><i /> PRIVATE BLOB</span><span><i /> HTTPONLY SESSION</span></div>
        </div>
      </section>
      <section className="login-panel">
        <div className="auth-panel-shell">
          <div className="auth-panel-top"><Link className="back-link" href="/">← 返回首页</Link><span className="auth-service"><i /> 认证服务正常</span></div>
          <form onSubmit={submit}>
            <div className="auth-heading"><span className="eyebrow">ACCOUNT ACCESS</span><b>{mode === "login" ? "01" : mode === "register" ? "02" : "03"}</b></div>
            <h2>{title}</h2>
            <p>{intro}</p>
            <div className="auth-form-fields">
              {mode === "register" && <label>用户名 <small>用于平台内展示</small><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3–16 位展示用户名" autoComplete="username" minLength={3} maxLength={16} required /></label>}
              <label>邮箱 <small>作为唯一登录账号</small><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" required /></label>
              {(mode === "login" || mode === "register") && <label>密码 <small>6–16 位</small><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入账户密码" minLength={6} maxLength={16} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>}
            </div>
            {message && <div className="auth-message" role="status">{message}</div>}
            <button className="button primary login-button" type="submit" disabled={busy}>{busy ? "正在处理…" : mode === "login" ? "登录并进入平台  →" : mode === "register" ? "创建账户并进入  →" : "发送重置邮件  →"}</button>
            <div className="auth-secondary-actions">
              {mode === "login" && <button className="auth-switch" type="button" onClick={() => { setMode("forgot"); setMessage(""); }}>忘记密码？</button>}
              {mode === "login" && <button className="auth-switch strong" type="button" onClick={() => { setMode("register"); setMessage(""); }}>没有账号？立即注册</button>}
              {mode !== "login" && <button className="auth-switch strong" type="button" onClick={() => { setMode("login"); setMessage(""); }}>← 返回账户登录</button>}
            </div>
          </form>
          <div className="login-features"><span><i>✓</i> 密码哈希</span><span><i>✓</i> 用户隔离</span><span><i>✓</i> 私有存储</span></div>
          <p className="auth-privacy-note"><b>隐私说明</b> 平台不会在浏览器保存明文密码，登录状态通过安全会话 Cookie 维持。</p>
        </div>
      </section>
    </main>
  );
}
