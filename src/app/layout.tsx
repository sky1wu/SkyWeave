import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "同行 · Amap Trip Planner", description: "一起规划去哪、怎么去、什么时候到，以及谁该付多少钱。" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN"><body>{children}</body></html>; }
