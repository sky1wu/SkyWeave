import { notFound } from "next/navigation";
import { TripShell } from "@/components/trip-shell";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; section: string }>;
}) {
  const { id, section } = await params;
  if (!["plan", "view", "expenses", "members", "activity"].includes(section))
    notFound();
  return <TripShell tripId={id} section={section} />;
}
