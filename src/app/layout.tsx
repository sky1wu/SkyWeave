import type { Metadata } from "next";
import "./globals.css";
import { Manrope } from "next/font/google";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SkyWeave",
  icons: { icon: "/icon.svg" },
  description: "旅行规划、多人协作与费用结算。",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={cn("font-sans", manrope.variable)}>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
