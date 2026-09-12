import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { UserSettings } from "@/components/user-settings";
import { auth } from "@/server/auth";
import { listTrips } from "@/server/service";
import { listMcpTokens } from "@/server/mcp-tokens";

export const metadata: Metadata = { title: "用户设置 · SkyWeave" };

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?next=%2Fsettings");

  return (
    <UserSettings
      user={{ name: session.user.name, email: session.user.email }}
      mcp={{
        endpoint: new URL(
          "/api/mcp",
          process.env.BETTER_AUTH_URL || "http://localhost:3000",
        ).href,
        tokens: listMcpTokens(session.user),
        trips: listTrips(session.user).map(({ id, title }) => ({ id, title })),
      }}
    />
  );
}
