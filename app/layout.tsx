import type { Metadata } from "next";
import { AnalyticsTracker } from "./components/AnalyticsTracker";
import { LanguageProvider } from "./lib/language-context";
import "./globals.css";

import "./pasc.css";
import "./pasc-local.css";
import "./pasc-job-progress.css";
export const metadata: Metadata = {
  title: "澜迹 InSAR（LANJIFYW）｜形变分析与外业核查工作台",
  description: "面向 InSAR 与 GIS 分析人员，提供时序形变分析、模式识别、驾车行程规划与现场证据管理，支持从遥感线索到外业核查的工作流程。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  metadataBase: new URL("https://pasc-tcn-gis.vercel.app"),
  openGraph: {
    title: "澜迹 InSAR｜形变分析与外业核查工作台",
    description: "时序形变分析、模式识别与外业核查规划，形成可追溯的空间证据。",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "澜迹 InSAR 形变分析与外业核查工作台" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><LanguageProvider><AnalyticsTracker/>{children}</LanguageProvider></body></html>;
}
