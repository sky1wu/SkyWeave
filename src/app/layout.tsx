import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Amap Trip Planner",
  icons: { icon: "/icon.svg" },
  description: "旅行规划、多人协作与费用结算。",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
