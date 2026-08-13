import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LANJIFYW 澜迹｜海口时序 InSAR WebGIS",
  description: "面向海口地表形变分析的时序 InSAR 数据导入、地图定位与点位时序可视化工作台。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  metadataBase: new URL("https://lanje-urban-insar.fengyaowu78.chatgpt.site"),
  openGraph: {
    title: "澜迹 Urban InSAR",
    description: "城市地表形变时序 InSAR WebGIS 可视化工作台",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "澜迹 Urban InSAR 城市形变监测" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
