import Link from "next/link";
import { UserRound } from "lucide-react";

export function SettingsLink() {
  return (
    <Link href="/settings" className="user-settings-link" aria-label="用户设置">
      <UserRound size={17} aria-hidden="true" />
      <span>用户设置</span>
    </Link>
  );
}
