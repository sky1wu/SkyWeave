"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Plus,
  ArrowUpRight,
  CalendarDays,
  Users,
  MapPin,
  LogOut,
} from "lucide-react";
import { api, authClient } from "@/lib/client";
import type { Trip } from "@/domain/types";
import { currencies } from "@/domain/money";
import { Brand, ErrorText, Modal } from "./ui";
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
          <span className="hidden sm:block text-sm muted">
            一起计划，尽兴出发。
          </span>
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
            <span className="eyebrow">YOUR NEXT CHAPTER</span>
            <h1>下一站，去哪里？</h1>
            <p className="muted">收集期待，安排路线，和同行的人一起出发。</p>
          </div>
          <button className="btn primary" onClick={() => setOpen(true)}>
            <Plus size={17} /> 创建行程
          </button>
        </div>
        <ErrorText error={error} />
        <div className="flex items-center justify-between mt-12 mb-5">
          <h2 className="text-lg font-semibold">
            我的行程{" "}
            <span className="muted text-sm ml-2">{trips?.length ?? ""}</span>
          </h2>
          <span className="text-xs muted">每一次出发，都值得好好安排</span>
        </div>
        <div className="trip-grid">
          {trips?.map((trip, index) => (
            <a
              className="trip-card panel"
              key={trip.id}
              href={`/trips/${trip.id}/plan`}
            >
              <div className={`trip-cover cover-${index % 3}`}>
                <div className="cover-route">
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <MapPin size={46} strokeWidth={1.3} />
                <span className="cover-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="cover-tag">即将出发</span>
              </div>
              <div className="p-6">
                <div className="flex justify-between items-center">
                  <h3 className="text-xl font-semibold truncate">
                    {trip.title}
                  </h3>
                  <ArrowUpRight size={19} />
                </div>
                <p className="flex gap-2 items-center text-sm muted mt-4">
                  <CalendarDays size={15} />
                  {trip.startDate
                    ? `${trip.startDate}${trip.endDate ? ` — ${trip.endDate}` : ""}`
                    : "日期待定"}
                </p>
                <div className="flex justify-between text-xs muted mt-6 pt-4 border-t border-stone-100">
                  <span className="flex items-center gap-2">
                    <Users size={14} />
                    {trip.memberCount} 位协作成员
                  </span>
                  <span>
                    {trip.dayCount} 天 · {trip.baseCurrency}
                  </span>
                </div>
              </div>
            </a>
          ))}
          <button className="new-trip-card" onClick={() => setOpen(true)}>
            <span className="rounded-full bg-white p-4">
              <Plus size={25} />
            </span>
            <span className="font-medium">开启一段新旅程</span>
            <span className="text-xs muted">从一个想去的地方开始</span>
          </button>
        </div>
        {!trips && !error && <div className="empty">正在整理你的行程…</div>}
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
            <div className="field-grid">
              <label>
                开始日期
                <input name="startDate" type="date" />
              </label>
              <label>
                结束日期
                <input name="endDate" type="date" />
              </label>
            </div>
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
