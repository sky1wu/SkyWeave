"use client";
import { NativeSelect } from "./ui/native-select";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Plus,
  ChevronRight,
  Search,
  MapPinned,
  CalendarDays,
  Users,
  Navigation2,
  LogOut,
} from "lucide-react";
import { api, authClient } from "@/lib/client";
import type { Trip } from "@/domain/types";
import { currencies } from "@/domain/money";
import { Brand, ErrorText, Modal } from "./ui";
import { JourneyArt } from "./journey-art";
import { TripDateFields } from "./trip-date-fields";
import { SettingsLink } from "./settings-link";
export function Trips() {
  const router = useRouter();
  const [trips, setTrips] = useState<
      (Trip & { memberCount: number; dayCount: number })[] | null
    >(null),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
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
  const visibleTrips = trips?.filter((trip) =>
    trip.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <header className="site-header">
        <Brand />
        <div className="flex items-center gap-3">
          <SettingsLink />
          <Button
            variant="outline"
            type="button"
            className="btn"
            aria-label="退出登录"
            onClick={() =>
              authClient.signOut().then(() => router.push("/login"))
            }
          >
            <LogOut size={16} />
          </Button>
        </div>
      </header>
      <main className="trips-main">
        <section className="trips-hero">
          <div className="trips-hero-copy">
            <h1>
              下一段旅程，
              <br />
              从这里开始。
            </h1>
            <p className="page-description">
              收藏想去的地方，安排每一天，和朋友一起出发。
            </p>
            <Button
              variant="default"
              type="button"
              className="btn primary"
              onClick={() => setOpen(true)}
            >
              <Plus size={18} /> 创建行程
            </Button>
          </div>
          <JourneyArt />
        </section>
        <ErrorText error={error} />
        <div className="trips-library-heading">
          <h2>
            我的行程 <span className="trip-count">{trips?.length ?? "—"}</span>
          </h2>
          <div className="trip-search">
            <Search size={17} aria-hidden="true" />
            <Input
              className="bg-white pl-10"
              aria-label="搜索行程"
              placeholder="搜索行程名称"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="trip-list">
          {visibleTrips?.map((trip) => (
            <a
              className="trip-row"
              key={trip.id}
              href={`/trips/${trip.id}/plan`}
            >
              <div className="trip-ticket-top">
                <span className="trip-ticket-symbol">
                  <MapPinned size={23} strokeWidth={1.5} />
                </span>
                <span className="trip-ticket-duration">
                  {trip.dayCount} 天的旅程
                </span>
              </div>
              <div className="trip-summary">
                <h3>{trip.title}</h3>
                <p>
                  <CalendarDays size={14} />
                  {trip.startDate
                    ? `${trip.startDate}${trip.endDate ? ` 至 ${trip.endDate}` : ""}`
                    : "日期待定，先收藏想去的地方"}
                </p>
              </div>
              <div className="trip-ticket-bottom">
                <span>
                  <Users size={15} /> {trip.memberCount} 人协作
                </span>
                <span>
                  打开行程 <ChevronRight size={14} />
                </span>
              </div>
            </a>
          ))}
          {trips && trips.length > 0 && visibleTrips?.length === 0 && (
            <div className="trip-empty">
              <Search size={30} strokeWidth={1.5} />
              <h2>没有找到这个行程</h2>
              <p>试试其他名称，或查看全部行程。</p>
              <Button
                variant="outline"
                className="mt-5"
                onClick={() => setQuery("")}
              >
                清空搜索
              </Button>
            </div>
          )}
          {trips?.length === 0 && (
            <div className="trip-empty">
              <Navigation2 size={36} strokeWidth={1.4} />
              <h2>第一段旅程，等你来安排</h2>
              <p>点击「创建行程」，日期没定也可以先开始。</p>
            </div>
          )}
          {trips && !query.trim() && (
            <button className="new-trip-action" onClick={() => setOpen(true)}>
              <Plus size={17} />
              规划另一段旅程
            </button>
          )}
        </div>
        {!trips && !error && <div className="empty">正在加载行程…</div>}
      </main>
      {open && (
        <Modal title="创建新行程" close={() => setOpen(false)}>
          <form onSubmit={create}>
            <ErrorText error={error} />
            <Label>
              行程名称
              <Input
                name="title"
                required
                maxLength={200}
                placeholder="例如：香港周末漫游"
                autoFocus
              />
            </Label>
            <TripDateFields />
            <div className="field-grid">
              <Label>
                统一结算币种
                <NativeSelect name="baseCurrency">
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </NativeSelect>
              </Label>
              <Label>
                行程时区
                <NativeSelect name="timezone">
                  <option>Asia/Shanghai</option>
                  <option>Asia/Hong_Kong</option>
                  <option>Asia/Macau</option>
                  <option>Asia/Taipei</option>
                </NativeSelect>
              </Label>
            </div>
            <p className="text-xs muted">
              记账后结算币种将锁定；每笔费用仍可使用不同币种。
            </p>
            <Button
              variant="default"
              type="submit"
              className="btn primary"
              disabled={busy}
            >
              {busy ? "创建中…" : "创建行程"}
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
