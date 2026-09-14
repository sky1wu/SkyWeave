"use client";
import { useConfirmation } from "./confirmation";
import { NativeSelect } from "./ui/native-select";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { useTripData } from "./trip-data";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  Settings2,
  Route,
  Wallet,
  Users,
  MessageCircle,
  BookOpen,
} from "lucide-react";
import { api } from "@/lib/client";
import type { Expense, Item, TripSection } from "@/domain/types";
import { currencies } from "@/domain/money";
import { Brand, ErrorText, Modal } from "./ui";
import { TripDateFields } from "./trip-date-fields";
import { SettingsLink } from "./settings-link";
import type { Mutate } from "./planner/types";
import type { CommentTarget } from "./activity";
const Planner = dynamic(() => import("./planner").then((m) => m.Planner));
const ItineraryView = dynamic(() =>
  import("./itinerary-view").then((m) => m.ItineraryView),
);
const Expenses = dynamic(() => import("./expenses").then((m) => m.Expenses));
const ExpenseEditor = dynamic(() =>
  import("./expenses").then((m) => m.ExpenseEditor),
);
const Members = dynamic(() => import("./members").then((m) => m.Members));
const ActivityPage = dynamic(() =>
  import("./activity").then((m) => m.ActivityPage),
);
const CommentModal = dynamic(() =>
  import("./activity").then((m) => m.CommentModal),
);
const tabs = [
  { key: "plan", label: "行程", icon: Route },
  { key: "view", label: "查看", icon: BookOpen },
  { key: "expenses", label: "费用", icon: Wallet },
  { key: "members", label: "成员", icon: Users },
  { key: "activity", label: "动态", icon: MessageCircle },
];
export function TripShell({
  tripId,
  section,
}: {
  tripId: string;
  section: TripSection;
}) {
  const { confirm, confirmation } = useConfirmation();
  const router = useRouter();
  const { data, error: loadError, refresh } = useTripData(section);
  const [actionError, setError] = useState(""),
    [settings, setSettings] = useState(false),
    [expense, setExpense] = useState<Expense | "new" | null>(null),
    [expenseItem, setExpenseItem] = useState<Item | undefined>(),
    [comment, setComment] = useState<CommentTarget | null>(null);
  const error = actionError || loadError;
  const mutate: Mutate = useCallback(
    async <T,>(path: string, method: string, value: unknown): Promise<T> => {
      const result = await api<T>(path, method, value);
      await refresh();
      return result;
    },
    [refresh],
  );
  if (!data)
    return (
      <>
        <header className="site-header">
          <Brand />
        </header>
        <main className="empty">
          <ErrorText error={error} />
          {!error ? (
            "加载行程中…"
          ) : (
            <Link className="btn mt-5" href="/">
              返回行程列表
            </Link>
          )}
        </main>
      </>
    );
  function openExpense(e?: Expense, item?: Item) {
    setExpense(e ?? "new");
    setExpenseItem(item);
  }
  return (
    <div
      className={`trip-workspace ${section === "plan" ? "planner-workspace" : ""}`}
    >
      <header className="site-header trip-header compact-trip-header">
        <Brand />
        <div className="compact-trip-heading">
          <div>
            <h1>{data.trip.title}</h1>
            {data.role === "owner" && section !== "view" && (
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                className="icon-btn"
                aria-label="行程设置"
                onClick={() => setSettings(true)}
              >
                <Settings2 size={15} />
              </Button>
            )}
          </div>
          <p>
            <CalendarDays size={11} />
            {data.trip.startDate ?? "日期待定"}
            {data.trip.endDate ? ` — ${data.trip.endDate}` : ""}
            <span>· {data.days.length} 天</span>
          </p>
        </div>
        <div className="collaborators">
          <div className="avatar-stack">
            {data.members
              .filter((m) => m.status === "active")
              .slice(0, 5)
              .map((m) => (
                <span className="avatar" key={m.userId} title={m.name}>
                  {m.name.slice(0, 1)}
                </span>
              ))}
          </div>
        </div>
        <Link href="/" className="workspace-back" aria-label="所有行程">
          <ChevronLeft size={14} />
          <span>所有行程</span>
        </Link>
        <SettingsLink />
      </header>
      <nav className="trip-nav" aria-label="行程导航">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/trips/${tripId}/${tab.key}`}
            className={section === tab.key ? "active" : ""}
            aria-current={section === tab.key ? "page" : undefined}
          >
            <tab.icon size={15} />
            {tab.label}
          </Link>
        ))}
        <span className="workspace-permission">
          {section === "view"
            ? "浏览模式"
            : data.role === "viewer"
              ? "只读，可评论"
              : "共同编辑"}
        </span>
      </nav>
      <div className="workspace-content">
        {error && (
          <div className="px-6 pt-3">
            <ErrorText error={error} />
          </div>
        )}
        {section === "view" && <ItineraryView snapshot={data} />}
        {section === "plan" && (
          <Planner
            snapshot={data}
            mutate={mutate}
            refresh={refresh}
            addExpense={(item) => openExpense(undefined, item)}
            editExpense={(expense) =>
              data.role === "viewer"
                ? router.push(`/trips/${tripId}/expenses#expense-${expense.id}`)
                : openExpense(expense)
            }
            addComment={(item) =>
              setComment({ type: "day_item", id: item.id, title: item.title })
            }
          />
        )}{" "}
        {section === "expenses" && (
          <Expenses
            snapshot={data}
            mutate={mutate}
            edit={openExpense}
            comment={(e) =>
              setComment({ type: "expense", id: e.id, title: e.title })
            }
          />
        )}{" "}
        {section === "members" && <Members snapshot={data} mutate={mutate} />}{" "}
        {section === "activity" && (
          <ActivityPage snapshot={data} mutate={mutate} />
        )}{" "}
      </div>
      {expense && (
        <ExpenseEditor
          snapshot={data}
          expense={expense === "new" ? undefined : expense}
          item={expenseItem}
          mutate={mutate}
          close={() => setExpense(null)}
        />
      )}{" "}
      {comment && (
        <CommentModal
          snapshot={data}
          target={comment}
          mutate={mutate}
          close={() => setComment(null)}
        />
      )}{" "}
      {settings && (
        <Modal title="行程设置" close={() => setSettings(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await mutate(`/trips/${tripId}`, "PATCH", {
                  expectedVersion: data.trip.version,
                  title: f.get("title"),
                  startDate: f.get("startDate") || null,
                  endDate: f.get("endDate") || null,
                  timezone: f.get("timezone"),
                  baseCurrency: f.get("baseCurrency") ?? data.trip.baseCurrency,
                });
                setSettings(false);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <ErrorText error={error} />
            <Label>
              行程名称
              <Input name="title" defaultValue={data.trip.title} required />
            </Label>
            <TripDateFields
              startDate={data.trip.startDate}
              endDate={data.trip.endDate}
            />
            <div className="field-grid">
              <Label>
                时区
                <NativeSelect name="timezone" defaultValue={data.trip.timezone}>
                  {[
                    "Asia/Shanghai",
                    "Asia/Hong_Kong",
                    "Asia/Macau",
                    "Asia/Taipei",
                  ].map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </NativeSelect>
              </Label>
              <Label>
                结算币种
                <NativeSelect
                  name="baseCurrency"
                  defaultValue={data.trip.baseCurrency}
                  disabled={!!data.trip.baseCurrencyLockedAt}
                >
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </NativeSelect>
              </Label>
            </div>
            {data.trip.baseCurrencyLockedAt && (
              <p className="text-xs muted">已有账目，结算币种已锁定。</p>
            )}
            <div className="actions">
              <Button
                variant="destructive"
                className="btn danger"
                type="button"
                onClick={async () => {
                  if (
                    !(await confirm(
                      `永久删除「${data.trip.title}」及全部行程、费用和结算？`,
                    ))
                  )
                    return;
                  try {
                    await api(`/trips/${tripId}`, "DELETE", {
                      expectedVersion: data.trip.version,
                    });
                    router.push("/");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                删除行程
              </Button>
              <Button variant="default" type="submit" className="btn primary">
                保存设置
              </Button>
            </div>
          </form>
          {confirmation}
        </Modal>
      )}
    </div>
  );
}
