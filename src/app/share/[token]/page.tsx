import type { Metadata } from "next";
import { SharedItinerary } from "@/components/shared-itinerary";

export const metadata: Metadata = {
  title: "分享行程 · SkyWeave",
  description: "查看分享的行程手册。",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharedItinerary key={token} token={token} />;
}
