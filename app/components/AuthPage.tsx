"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getUser,
  handleAuthCallback,
  login,
  requestPasswordRecovery,
  signup,
  updateUser,
} from "@netlify/identity";

type AuthMode = "login" | "register" | "forgot" | "reset";

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
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    handleAuthCallback()
      .then(async (result) => {
        if (result?.type === "recovery") {
          setMode("reset");
          setMessage("身份验证成功，请设置新密码");
          return;
        }
        if (result?.type === "confirmation" || result?.type === "oauth") {
          setMessage("邮箱验证完成，正在进入数据空间…");
          window.location.href = "/datasets";
          return;
        }
        if (!result && await getUser()) window.location.href = "/datasets";
      })
      .catch((error) => setMessage(errorText(error)));
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "login") {
        await login(email, password);
        window.location.href = "/datasets";
      } else if (mode === "register") {
        if (username.trim().length < 3 || username.trim().length > 16) throw new Error("用户名长度需为 3–16 位");
        const user = await signup(email, password, { full_name: username.trim(), username: username.trim() });
        if (user.emailVerified) window.location.href = "/datasets";
        else {
          setMode("login");
          setPassword("");
          setMessage("注册成功，确认邮件已发送；请点击邮件中的链接后登录");
        }
      } else if (mode === "forgot") {
        await requestPasswordRecovery(email);
        setMessage("密码重置邮件已发送，请检查收件箱和垃圾邮件");
      } else {
        if (password !== confirmPassword) throw new Error("两次输入的密码不一致");
        await updateUser({ password });
        setMessage("密码已更新，正在进入数据空间…");
        window.location.href = "/datasets";
      }
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "login" ? "登录分析平台" : mode === "register" ? "注册新账户" : mode === "forgot" ? "找回密码" : "设置新密码";
  const intro = mode === "login" ? "使用邮箱和密码进入你的私有数据空间。" : mode === "register" ? "设置展示用户名，并绑定用于验证与找回密码的邮箱。" : mode === "forgot" ? "输入注册邮箱，我们会向该邮箱发送密码重置链接。" : "请输入 6–16 位新密码，完成后将自动登录。";

  return (
    <main className="new-login">
      <section className="login-scene grid-surface">
        <Link className="site-brand invert" href="/">
          <img src="/insar-satellite-v2.png" alt="InSAR 卫星" />
          <span><b>LANJIFYW</b><small>城市时序 InSAR</small></span>
        </Link>
        <div>
          <span className="eyebrow">PRIVATE INSAR WORKSPACE</span>
          <h1>每个账户一套<br />独立数据空间</h1>
          <p>邮箱用于账户验证和密码找回；CSV 按认证用户 ID 私有存储，其他普通用户无法列出或读取。</p>
        </div>
        <i className="orbit orbit-a" /><i className="orbit orbit-b" />
      </section>
      <section className="login-panel">
        <form onSubmit={submit}>
          <Link className="back-link" href="/">← 返回首页</Link>
          <span className="eyebrow">ACCOUNT ACCESS</span>
          <h2>{title}</h2>
          <p>{intro}</p>
          {mode === "register" && <label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3–16 位展示用户名" autoComplete="username" minLength={3} maxLength={16} required /></label>}
          {mode !== "reset" && <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" required /></label>}
          {(mode === "login" || mode === "register" || mode === "reset") && <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="6–16 位密码" minLength={6} maxLength={16} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>}
          {mode === "reset" && <label>确认新密码<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入新密码" minLength={6} maxLength={16} autoComplete="new-password" required /></label>}
          {message && <div className="auth-message" role="status">{message}</div>}
          <button className="button primary login-button" type="submit" disabled={busy}>{busy ? "正在处理…" : mode === "login" ? "登录并进入平台" : mode === "register" ? "创建账户" : mode === "forgot" ? "发送重置邮件" : "保存新密码"}</button>
          {mode === "login" && <button className="auth-switch" type="button" onClick={() => { setMode("forgot"); setMessage(""); }}>忘记密码？</button>}
          {mode === "login" && <button className="auth-switch" type="button" onClick={() => { setMode("register"); setMessage(""); }}>没有账号？立即注册</button>}
          {mode !== "login" && mode !== "reset" && <button className="auth-switch" type="button" onClick={() => { setMode("login"); setMessage(""); }}>返回登录</button>}
          <div className="login-features"><span>邮箱找回</span><span>用户隔离</span><span>私有存储</span></div>
        </form>
      </section>
    </main>
  );
}
