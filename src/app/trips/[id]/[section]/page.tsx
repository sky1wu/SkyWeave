import { notFound } from "next/navigation";
import { tripSections, type TripSection } from "@/domain/types";
import { TripShell } from "@/components/trip-shell";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; section: string }>;
}) {
  const { id, section } = await params;
  if (!tripSections.includes(section as TripSection)) notFound();
  return <TripShell tripId={id} section={section as TripSection} />;
}
