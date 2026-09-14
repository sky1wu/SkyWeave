import { TripDataProvider } from "@/components/trip-data";

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <TripDataProvider key={id} tripId={id}>
      {children}
    </TripDataProvider>
  );
}
