import type { Metadata } from "next";
import { AnalyticsTracker } from "./components/AnalyticsTracker";
import "./globals.css";

import "./pasc.css";
export const metadata: Metadata = {
  title: "澜迹 InSAR（LANJIFYW）｜城市地表形变智能分析平台",
  description: "面向时序 InSAR 监测成果，快速完成数据理解、异常发现、形变过程分析与辅助解读。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  metadataBase: new URL("https://pasc-tcn-gis.vercel.app"),
  openGraph: {
    title: "澜迹 InSAR｜城市地表形变智能分析平台",
    description: "从看见形变量，到理解形变过程。",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "澜迹 Urban InSAR 城市形变监测" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><AnalyticsTracker/>{children}</body></html>;
}
