"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Brand, ErrorText } from "./ui";
import { Users } from "lucide-react";
export function InvitePage({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="max-w-lg mx-auto px-6 py-16">
      <Brand />
      <div className="panel p-9 mt-12 text-center">
        <Users size={44} className="mx-auto text-emerald-700 mb-6" />
        <h1 className="text-2xl font-semibold mb-4">这段旅程，就差你了</h1>
        <p className="muted mb-7 text-sm">
          登录后接受邀请，一起查看行程、讨论安排和分摊费用。专属邀请会保留你已有的账目。
        </p>
        <ErrorText error={error} />
        <button
          className="btn primary mt-4"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await api<{ id: string }>(
                `/invites/${token}/join`,
                "POST",
                {},
              );
              router.push(`/trips/${result.id}/plan`);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? "正在加入…" : "接受邀请"}
        </button>
      </div>
    </main>
  );
}
