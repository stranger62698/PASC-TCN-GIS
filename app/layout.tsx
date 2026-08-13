import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LANJIFYW｜城市地表形变时序监测平台",
  description: "融合时序 InSAR、WebGIS、区域统计与点位分析的城市地表形变可视化平台。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  metadataBase: new URL("https://lanje-urban-insar.fengyaowu78.chatgpt.site"),
  openGraph: {
    title: "LANJIFYW 城市时序 InSAR",
    description: "看见城市地表毫米级形变",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "澜迹 Urban InSAR 城市形变监测" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
