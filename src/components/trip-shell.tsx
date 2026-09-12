"use client";
import { useConfirmation } from "./confirmation";
import { NativeSelect } from "./ui/native-select";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  Settings2,
  Route,
  Wallet,
  Users,
  MessageCircle,
} from "lucide-react";
import { api, ApiFailure } from "@/lib/client";
import type { Expense, Item, TripSnapshot } from "@/domain/types";
import { currencies } from "@/domain/money";
import { Brand, ErrorText, Modal } from "./ui";
import { TripDateFields } from "./trip-date-fields";
import { Planner, type Mutate } from "./planner";
import { ExpenseEditor, Expenses } from "./expenses";
import { Members } from "./members";
import { ActivityPage, CommentModal, type CommentTarget } from "./activity";
const tabs = [
  { key: "plan", label: "行程", icon: Route },
  { key: "expenses", label: "费用", icon: Wallet },
  { key: "members", label: "成员", icon: Users },
  { key: "activity", label: "动态", icon: MessageCircle },
];
export function TripShell({
  tripId,
  section,
}: {
  tripId: string;
  section: string;
}) {
  const { confirm, confirmation } = useConfirmation();
  const router = useRouter();
  const [data, setData] = useState<TripSnapshot | null>(null),
    [error, setError] = useState(""),
    [settings, setSettings] = useState(false),
    [expense, setExpense] = useState<Expense | "new" | null>(null),
    [expenseItem, setExpenseItem] = useState<Item | undefined>(),
    [comment, setComment] = useState<CommentTarget | null>(null);
  const fetchSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++fetchSequence.current;
    const result = await api<TripSnapshot>(`/trips/${tripId}`);
    if (sequence === fetchSequence.current) setData(result);
  }, [tripId]);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    const events = new EventSource(`/api/trips/${tripId}/events`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          refresh().catch((e) => {
            setError(e.message);
            if (e instanceof ApiFailure && [401, 403, 404].includes(e.status)) {
              events.close();
              setData(null);
            }
          }),
        180,
      );
    };
    events.addEventListener("sync", sync);
    events.addEventListener("change", sync);
    events.addEventListener("revoked", () => {
      events.close();
      fetchSequence.current++;
      setData(null);
      setError("你已没有访问此行程的权限");
    });
    const focus = () => sync();
    window.addEventListener("focus", focus);
    return () => {
      clearTimeout(timer);
      events.close();
      window.removeEventListener("focus", focus);
    };
  }, [tripId, refresh]);
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
            {data.role === "owner" && (
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
      </header>
      <nav className="trip-nav" aria-label="行程导航">
        {tabs.map((tab) => (
          <a
            key={tab.key}
            href={`/trips/${tripId}/${tab.key}`}
            className={section === tab.key ? "active" : ""}
            aria-current={section === tab.key ? "page" : undefined}
          >
            <tab.icon size={15} />
            {tab.label}
          </a>
        ))}
        <span className="workspace-permission">
          {data.role === "viewer" ? "只读，可评论" : "共同编辑"}
        </span>
      </nav>
      <div className="workspace-content">
        {error && (
          <div className="px-6 pt-3">
            <ErrorText error={error} />
          </div>
        )}
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
