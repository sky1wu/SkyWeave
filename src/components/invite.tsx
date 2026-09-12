"use client";
import { Button } from "./ui/button";
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
    <main className="invite-page">
      <Brand />
      <div className="invite-card">
        <Users size={44} className="mx-auto text-primary mb-6" />
        <h1 className="text-2xl font-semibold mb-4">加入行程</h1>
        <p className="muted mb-7 text-sm">
          登录后可接受邀请。专属邀请会关联你已有的账目。
        </p>
        <ErrorText error={error} />
        <Button
          variant="default"
          type="button"
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
        </Button>
      </div>
    </main>
  );
}
