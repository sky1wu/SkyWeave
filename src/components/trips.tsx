"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Plus,
  ArrowUpRight,
  CalendarDays,
  Users,
  Navigation2,
  LogOut,
} from "lucide-react";
import { api, authClient } from "@/lib/client";
import type { Trip } from "@/domain/types";
import { currencies } from "@/domain/money";
import { Brand, ErrorText, Modal } from "./ui";
import { TripDateFields } from "./trip-date-fields";
export function Trips() {
  const router = useRouter();
  const [trips, setTrips] = useState<
      (Trip & { memberCount: number; dayCount: number })[] | null
    >(null),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<(Trip & { memberCount: number; dayCount: number })[]>("/trips")
      .then(setTrips)
      .catch((e) => setError(e.message));
  }, []);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const result = await api<{ id: string }>("/trips", "POST", {
        title: form.get("title"),
        startDate: form.get("startDate") || null,
        endDate: form.get("endDate") || null,
        baseCurrency: form.get("baseCurrency"),
        timezone: form.get("timezone"),
      });
      router.push(`/trips/${result.id}/plan`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <header className="site-header">
        <Brand />
        <div className="flex items-center gap-5">
          <button
            className="btn"
            aria-label="退出登录"
            onClick={() =>
              authClient.signOut().then(() => router.push("/login"))
            }
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <main className="trips-main">
        <div className="trips-hero">
          <div>
            <h1>
              我的行程{" "}
              <span className="trip-count">{trips?.length ?? "—"}</span>
            </h1>
            <p className="page-description">
              管理每日安排、同行成员和共同费用。
            </p>
          </div>
          <button className="btn primary" onClick={() => setOpen(true)}>
            <Plus size={18} /> 创建行程
          </button>
        </div>
        <ErrorText error={error} />
        <div className="trip-list-heading" aria-hidden="true">
          <span>序号</span>
          <span>行程</span>
          <span>协作成员</span>
          <span>天数</span>
          <span />
        </div>
        <div className="trip-list">
          {trips?.map((trip, index) => (
            <a
              className="trip-row"
              key={trip.id}
              href={`/trips/${trip.id}/plan`}
            >
              <span className="trip-order">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="trip-summary">
                <h2>{trip.title}</h2>
                <p>
                  <CalendarDays size={14} />
                  {trip.startDate
                    ? `${trip.startDate}${trip.endDate ? ` — ${trip.endDate}` : ""}`
                    : "日期待定"}
                </p>
                <p className="trip-mobile-meta">
                  {trip.memberCount} 人协作 · {trip.dayCount} 天 ·{" "}
                  {trip.baseCurrency}
                </p>
              </div>
              <div className="trip-people">
                <Users size={17} />
                <span>{trip.memberCount} 人协作</span>
              </div>
              <div className="trip-days">
                {trip.dayCount}
                <small>天</small>
              </div>
              <ArrowUpRight size={22} className="trip-open" />
            </a>
          ))}
          {trips?.length === 0 && (
            <div className="trip-empty">
              <Navigation2 size={36} strokeWidth={1.4} />
              <h2>暂无行程</h2>
              <p>创建行程后可查看和编辑。</p>
            </div>
          )}
          {trips && (
            <button className="new-trip-action" onClick={() => setOpen(true)}>
              <Plus size={17} />
              添加行程
            </button>
          )}
        </div>
        {!trips && !error && <div className="empty">正在加载行程…</div>}
      </main>
      {open && (
        <Modal title="创建新行程" close={() => setOpen(false)}>
          <form onSubmit={create}>
            <ErrorText error={error} />
            <label>
              行程名称
              <input
                name="title"
                required
                maxLength={200}
                placeholder="例如：香港 Girls Band Cry"
                autoFocus
              />
            </label>
            <TripDateFields />
            <div className="field-grid">
              <label>
                统一结算币种
                <select name="baseCurrency">
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                行程时区
                <select name="timezone">
                  <option>Asia/Shanghai</option>
                  <option>Asia/Hong_Kong</option>
                  <option>Asia/Macau</option>
                  <option>Asia/Taipei</option>
                </select>
              </label>
            </div>
            <p className="text-xs muted">
              记账后结算币种将锁定；每笔费用仍可使用不同币种。
            </p>
            <button className="btn primary" disabled={busy}>
              {busy ? "创建中…" : "创建行程"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
