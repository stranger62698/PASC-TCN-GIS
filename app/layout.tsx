import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "澜迹 Urban InSAR｜城市地表形变监测",
  description: "面向城市地表形变分析的时序 InSAR 可视化工作台。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
