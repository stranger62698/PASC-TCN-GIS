"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type SiteLocale = "zh" | "en";

type LanguageContextValue = {
  locale: SiteLocale;
  setLocale: (locale: SiteLocale) => void;
  text: (zh: string, en: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);
const STORAGE_KEY = "lanjifyw-site-language";

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<SiteLocale>("zh");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== "en" && saved !== "zh") return;
    const timer = window.setTimeout(() => setLocale(saved), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const value = useMemo<LanguageContextValue>(() => ({
    locale,
    setLocale,
    text: (zh, en) => locale === "zh" ? zh : en,
  }), [locale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}

export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLanguage();
  return (
    <nav className={`language-switch${compact ? " compact" : ""}`} aria-label={locale === "zh" ? "切换网站语言" : "Switch site language"}>
      <button type="button" lang="zh-CN" aria-current={locale === "zh" ? "true" : undefined} onClick={() => setLocale("zh")}>中文</button>
      <span aria-hidden="true" />
      <button type="button" lang="en" aria-current={locale === "en" ? "true" : undefined} onClick={() => setLocale("en")}>EN</button>
    </nav>
  );
}
