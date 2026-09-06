import type { Metadata } from "next";
import { AnalyticsTracker } from "./components/AnalyticsTracker";
import { LanguageProvider } from "./lib/language-context";
import "./globals.css";

import "./pasc.css";
import "./pasc-local.css";
import "./pasc-job-progress.css";
export const metadata: Metadata = {
  title: "澜迹 InSAR（LANJIFYW）｜InSAR 形变模式识别工作台",
  description: "面向 InSAR 与 GIS 分析人员，从时序数据中识别形变模式，让静态指标呈现可解释的变化过程。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  metadataBase: new URL("https://pasc-tcn-gis.vercel.app"),
  openGraph: {
    title: "澜迹 InSAR｜InSAR 形变模式识别工作台",
    description: "不只看形变量，更识别形变模式。",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "澜迹 InSAR 形变模式识别工作台" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><LanguageProvider><AnalyticsTracker/>{children}</LanguageProvider></body></html>;
}
