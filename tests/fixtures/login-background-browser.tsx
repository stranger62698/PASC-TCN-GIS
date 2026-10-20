import React from "react";
import { createRoot } from "react-dom/client";
import { AuthPage } from "../../app/components/AuthPage";
import { LanguageProvider } from "../../app/lib/language-context";
import "../../app/globals.css";
// Visual fixture only. No credentials, account writes, supplier calls or real API traffic.
window.fetch = async (_input, init) => init?.method === "POST"
  ? Response.json({ error: "视觉验收页面不提交账户，请使用正式站点登录。" }, { status: 503 })
  : Response.json({ authenticated: false, user: null });
createRoot(document.getElementById("root")!).render(<LanguageProvider><AuthPage /></LanguageProvider>);
