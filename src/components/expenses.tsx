"use client";
import { Checkbox } from "./ui/checkbox";
import { useConfirmation } from "./confirmation";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useState } from "react";
import { DateTime } from "luxon";
import {
  Plus,
  Wallet,
  ArrowRight,
  ReceiptText,
  Check,
  Trash2,
  Pencil,
  MessageSquare,
} from "lucide-react";
import type { Expense, Item, TripSnapshot } from "@/domain/types";
import { categoryLabels } from "@/domain/types";
import {
  calculateBalances,
  convertMoney,
  currencies,
  formatMoney,
  moneyText,
  parseMoney,
  splitExpense,
  type SplitMethod,
} from "@/domain/money";
import { ErrorText, Modal } from "./ui";
import type { Mutate } from "./planner";

export function ExpenseEditor({
  snapshot,
  expense,
  item,
  mutate,
  close,
}: {
  snapshot: TripSnapshot;
  expense?: Expense;
  item?: Item;
  mutate: Mutate;
  close: () => void;
}) {
  const [openedAt] = useState(() => Date.now());
  const trip = snapshot.trip,
    people = snapshot.participants.filter(
      (p) =>
        p.status === "active" ||
        expense?.splitMeta.some((s) => s.participantId === p.id) ||
        expense?.payerParticipantId === p.id,
    );
  const [currency, setCurrency] = useState(
      expense?.currency ?? trip.baseCurrency,
    ),
    [amount, setAmount] = useState(
      expense ? moneyText(expense.amountMinor, expense.currency) : "",
    ),
    [rate, setRate] = useState(expense?.exchangeRateToBase ?? "1"),
    [method, setMethod] = useState<SplitMethod>(
      expense?.splitMethod ?? "equal",
    ),
    [selected, setSelected] = useState(
      expense?.splitMeta.map((s) => s.participantId) ?? people.map((p) => p.id),
    ),
    [values, setValues] = useState<Record<string, string>>(
      Object.fromEntries(
        people.map((p) => [
          p.id,
          expense?.splitMeta.find((s) => s.participantId === p.id)?.value ??
            "1",
        ]),
      ),
    ),
    [dayId, setDayId] = useState(item?.dayId ?? expense?.dayId ?? ""),
    [itemId, setItemId] = useState(item?.id ?? expense?.dayItemId ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const splits = selected.map((participantId) => ({
    participantId,
    value: values[participantId] ?? "1",
  }));
  let preview: ReturnType<typeof splitExpense> | null = null,
    base = 0;
  try {
    const minor = parseMoney(amount, currency);
    base = convertMoney(
      minor,
      currency,
      trip.baseCurrency,
      currency === trip.baseCurrency ? "1" : rate,
    );
    preview = splitExpense(minor, base, currency, method, splits);
  } catch {
    /* Incomplete drafts are validated on submit. */
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await mutate(
        expense ? `/expenses/${expense.id}` : `/trips/${trip.id}/expenses`,
        expense ? "PATCH" : "POST",
        {
          title: f.get("title"),
          category: f.get("category"),
          amountMinor: parseMoney(amount, currency),
          currency,
          exchangeRateToBase: currency === trip.baseCurrency ? "1" : rate,
          payerParticipantId: f.get("payer"),
          splitMethod: method,
          splitMeta: splits,
          dayId: dayId || null,
          dayItemId: itemId || null,
          incurredAt: DateTime.fromISO(String(f.get("incurredAt")), {
            zone: trip.timezone,
          }).toMillis(),
          notes: f.get("notes") || null,
          ...(expense ? { expectedVersion: expense.version } : {}),
        },
      );
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={expense ? "编辑费用" : "添加费用"} close={close}>
      <form onSubmit={submit}>
        <ErrorText error={error} />
        <Label>
          费用名称
          <Input
            name="title"
            required
            maxLength={200}
            defaultValue={expense?.title ?? ""}
            placeholder={item ? `${item.title} · 午餐 / 门票…` : "例如：晚餐"}
          />
        </Label>
        <div className="field-grid">
          <Label>
            金额
            <Input
              aria-label="费用金额"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </Label>
          <Label>
            币种
            <NativeSelect
              aria-label="币种"
              value={currency}
              onChange={(e) => {
                const c = e.target.value;
                setCurrency(c);
                setRate(
                  c === trip.baseCurrency
                    ? "1"
                    : ([...snapshot.expenses]
                        .sort((a, b) => b.createdAt - a.createdAt)
                        .find((e) => e.currency === c)?.exchangeRateToBase ??
                        ""),
                );
              }}
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </NativeSelect>
          </Label>
        </div>
        {currency !== trip.baseCurrency && (
          <Label>
            汇率：1 {currency} = 多少 {trip.baseCurrency}
            <Input
              aria-label="汇率"
              required
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="输入本笔费用使用的汇率"
            />
          </Label>
        )}
        <div className="field-grid">
          <Label>
            付款人
            <NativeSelect
              name="payer"
              defaultValue={
                expense?.payerParticipantId ??
                people.find((p) => p.userId === snapshot.currentUserId)?.id ??
                people[0]?.id
              }
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label>
            分类
            <NativeSelect
              name="category"
              defaultValue={expense?.category ?? "food"}
            >
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Label>
        </div>
        <Label>
          分摊方式
          <NativeSelect
            aria-label="分摊方式"
            value={method}
            onChange={(e) => setMethod(e.target.value as SplitMethod)}
          >
            <option value="equal">平均分摊</option>
            <option value="exact">按金额分摊</option>
            <option value="percentage">按比例分摊</option>
            <option value="shares">按份数分摊</option>
          </NativeSelect>
        </Label>
        <div className="split-people">
          {people.map((p) => (
            <div key={p.id} className="split-row">
              <Label className="flex items-center gap-2">
                <Checkbox
                  checked={selected.includes(p.id)}
                  onCheckedChange={(checked) =>
                    setSelected(
                      checked
                        ? [...selected, p.id]
                        : selected.filter((id) => id !== p.id),
                    )
                  }
                />
                {p.name}
              </Label>
              {method !== "equal" && selected.includes(p.id) && (
                <Input
                  aria-label={`${p.name} 分摊值`}
                  className="max-w-24"
                  inputMode="decimal"
                  value={values[p.id] ?? "1"}
                  onChange={(e) =>
                    setValues({ ...values, [p.id]: e.target.value })
                  }
                  placeholder={
                    method === "exact"
                      ? currency
                      : method === "percentage"
                        ? "%"
                        : "份"
                  }
                />
              )}
              <span className="text-xs muted">
                {preview?.find((s) => s.participantId === p.id)
                  ? formatMoney(
                      preview.find((s) => s.participantId === p.id)!
                        .amountMinor,
                      currency,
                    )
                  : "—"}
              </span>
            </div>
          ))}
        </div>
        {preview && (
          <p className="text-sm accent-link">
            折合 {formatMoney(base, trip.baseCurrency)} · 汇率将在保存时锁定
          </p>
        )}
        <div className="field-grid">
          <Label>
            关联日期
            <NativeSelect
              value={dayId}
              onChange={(e) => {
                setDayId(e.target.value);
                setItemId("");
              }}
            >
              <option value="">不关联</option>
              {snapshot.days.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label>
            关联事项
            <NativeSelect
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
            >
              <option value="">不关联</option>
              {snapshot.days
                .find((d) => d.id === dayId)
                ?.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title}
                  </option>
                ))}
            </NativeSelect>
          </Label>
        </div>
        <Label>
          发生时间（{trip.timezone}）
          <Input
            name="incurredAt"
            type="datetime-local"
            required
            defaultValue={DateTime.fromMillis(expense?.incurredAt ?? openedAt)
              .setZone(trip.timezone)
              .toFormat("yyyy-MM-dd'T'HH:mm")}
          />
        </Label>
        <Label>
          备注
          <Textarea name="notes" rows={2} defaultValue={expense?.notes ?? ""} />
        </Label>
        <Button
          variant="default"
          type="submit"
          className="btn primary"
          disabled={busy}
        >
          {busy ? "保存中…" : "保存费用"}
        </Button>
      </form>
    </Modal>
  );
}

export function SettlementEditor({
  snapshot,
  initial,
  mutate,
  close,
}: {
  snapshot: TripSnapshot;
  initial?: {
    fromParticipantId: string;
    toParticipantId: string;
    amountMinor: number;
  };
  mutate: Mutate;
  close: () => void;
}) {
  const [currency, setCurrency] = useState(snapshot.trip.baseCurrency),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="登记实际转账" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f = new FormData(e.currentTarget);
          try {
            await mutate(`/trips/${snapshot.trip.id}/settlements`, "POST", {
              fromParticipantId: f.get("from"),
              toParticipantId: f.get("to"),
              amountMinor: parseMoney(String(f.get("amount")), currency),
              currency,
              exchangeRateToBase:
                currency === snapshot.trip.baseCurrency ? "1" : f.get("rate"),
              settledAt: DateTime.fromISO(String(f.get("settledAt")), {
                zone: snapshot.trip.timezone,
              }).toMillis(),
              note: f.get("note") || null,
            });
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm muted">登记已完成的转账，更新双方余额。</p>
        <ErrorText error={error} />
        <div className="field-grid">
          <Label>
            转出人
            <NativeSelect
              name="from"
              defaultValue={
                initial?.fromParticipantId ?? snapshot.participants[0]?.id
              }
            >
              {snapshot.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label>
            收款人
            <NativeSelect
              name="to"
              defaultValue={
                initial?.toParticipantId ?? snapshot.participants[1]?.id
              }
            >
              {snapshot.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Label>
        </div>
        <div className="field-grid">
          <Label>
            转账金额
            <Input
              name="amount"
              required
              inputMode="decimal"
              defaultValue={
                initial
                  ? moneyText(initial.amountMinor, snapshot.trip.baseCurrency)
                  : ""
              }
            />
          </Label>
          <Label>
            转账币种
            <NativeSelect
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </NativeSelect>
          </Label>
        </div>
        {currency !== snapshot.trip.baseCurrency && (
          <Label>
            汇率：1 {currency} = 多少 {snapshot.trip.baseCurrency}
            <Input name="rate" required inputMode="decimal" />
          </Label>
        )}
        <Label>
          转账时间
          <Input
            name="settledAt"
            type="datetime-local"
            required
            defaultValue={DateTime.now()
              .setZone(snapshot.trip.timezone)
              .toFormat("yyyy-MM-dd'T'HH:mm")}
          />
        </Label>
        <Label>
          备注
          <Input name="note" placeholder="例如：微信已转账" />
        </Label>
        <Button
          variant="default"
          type="submit"
          className="btn primary"
          disabled={busy}
        >
          {busy ? "登记中…" : "确认已转账"}
        </Button>
      </form>
    </Modal>
  );
}
export function Expenses({
  snapshot,
  mutate,
  edit,
  comment,
}: {
  snapshot: TripSnapshot;
  mutate: Mutate;
  edit: (expense?: Expense) => void;
  comment: (expense: Expense) => void;
}) {
  const { confirm, confirmation } = useConfirmation();
  const editable = snapshot.role !== "viewer",
    base = snapshot.trip.baseCurrency;
  const { balances, suggestions } = calculateBalances(
    snapshot.participants.map((p) => p.id),
    snapshot.expenses,
    snapshot.settlements,
  );
  const name = (id: string) =>
    snapshot.participants.find((p) => p.id === id)?.name ?? "同行者";
  const total = snapshot.expenses.reduce((s, e) => s + e.baseAmountMinor, 0);
  const categories = Object.entries(categoryLabels)
    .map(([key, label]) => ({
      key,
      label,
      amount: snapshot.expenses
        .filter((e) => e.category === key)
        .reduce((s, e) => s + e.baseAmountMinor, 0),
    }))
    .filter((c) => c.amount);
  const currencyTotals = currencies
    .map((c) => ({
      currency: c,
      amount: snapshot.expenses
        .filter((e) => e.currency === c)
        .reduce((s, e) => s + e.amountMinor, 0),
    }))
    .filter((c) => c.amount);
  const [settle, setSettle] = useState<
      (typeof suggestions)[number] | "new" | null
    >(null),
    [error, setError] = useState("");
  async function remove(path: string, version: number) {
    if (!(await confirm("删除这条记录？余额将重新计算。"))) return;
    try {
      await mutate(path, "DELETE", { expectedVersion: version });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="content-page">
      <div className="page-heading">
        <div>
          <h2 className="section-title">费用与结算</h2>
          <p className="page-description">查看支出、每人余额和转账记录。</p>
        </div>
        {editable && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              type="button"
              className="btn"
              onClick={() => setSettle("new")}
            >
              登记转账
            </Button>
            <Button
              variant="default"
              type="button"
              className="btn primary"
              onClick={() => edit()}
            >
              <Plus size={15} />
              记一笔
            </Button>
          </div>
        )}
      </div>
      <ErrorText error={error} />
      <div className="expense-overview">
        <section className="total-card">
          <p className="total-label">
            <Wallet size={18} />
            总支出
          </p>
          <strong>{formatMoney(total, base)}</strong>
          <p className="total-description">
            {snapshot.expenses.length} 笔费用 · 统一以 {base} 结算
          </p>
          <div className="currency-totals">
            {currencyTotals.map((c) => (
              <span key={c.currency} className="text-xs">
                {c.currency} {formatMoney(c.amount, c.currency)}
              </span>
            ))}
          </div>
        </section>
        <section className="panel category-summary">
          <h3 className="font-semibold mb-5">分类支出</h3>
          {categories.length ? (
            categories.map((c) => (
              <div className="mb-4" key={c.key}>
                <div className="flex justify-between text-xs mb-2">
                  <span>{c.label}</span>
                  <span>{formatMoney(c.amount, base)}</span>
                </div>
                <div className="category-bar">
                  <i
                    style={{
                      width: `${total ? (c.amount / total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="muted text-sm">暂无分类数据</p>
          )}
        </section>
      </div>
      <section className="panel mt-6 p-6">
        <h3 className="font-semibold mb-5">成员账单</h3>
        <div className="table-scroll">
          <table className="money-table">
            <thead>
              <tr>
                <th>同行者</th>
                <th>已付费用</th>
                <th>应承担</th>
                <th>当前余额</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.participantId}>
                  <td>{name(b.participantId)}</td>
                  <td>{formatMoney(b.paidBase, base)}</td>
                  <td>{formatMoney(b.owedBase, base)}</td>
                  <td
                    className={
                      b.net > 0
                        ? "text-emerald-700"
                        : b.net < 0
                          ? "text-amber-700"
                          : "muted"
                    }
                  >
                    {b.net > 0 ? "应收 " : b.net < 0 ? "应付 " : "已结清 "}
                    {formatMoney(Math.abs(b.net), base)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel mt-6 p-6">
        <h3 className="font-semibold mb-4">建议结算</h3>
        {suggestions.length ? (
          suggestions.map((s, i) => (
            <div className="settlement-row" key={i}>
              <span>{name(s.fromParticipantId)}</span>
              <ArrowRight size={15} className="muted" />
              <span>{name(s.toParticipantId)}</span>
              <b className="ml-auto">{formatMoney(s.amountMinor, base)}</b>
              {editable && (
                <Button
                  variant="outline"
                  type="button"
                  className="btn"
                  onClick={() => setSettle(s)}
                >
                  登记转账
                </Button>
              )}
            </div>
          ))
        ) : (
          <p className="text-sm muted flex items-center gap-2">
            <Check size={16} />
            当前没有待结算金额
          </p>
        )}
      </section>
      <div className="mt-9 mb-4 flex justify-between items-center">
        <h3 className="font-semibold">费用明细</h3>
        <span className="text-xs muted">按发生时间排列</span>
      </div>
      <section className="panel overflow-hidden">
        {snapshot.expenses.length ? (
          snapshot.expenses.map((e) => (
            <div className="expense-row" key={e.id} id={`expense-${e.id}`}>
              <div className="expense-icon">
                <ReceiptText size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold truncate">{e.title}</h4>
                <p className="text-xs muted mt-1">
                  {name(e.payerParticipantId)} 付款 ·{" "}
                  {categoryLabels[e.category]} ·{" "}
                  {DateTime.fromMillis(e.incurredAt)
                    .setZone(snapshot.trip.timezone)
                    .toFormat("MM-dd HH:mm")}
                </p>
                {e.notes && <p className="text-xs muted mt-2">{e.notes}</p>}
              </div>
              <div className="text-right shrink-0">
                <b>{formatMoney(e.amountMinor, e.currency)}</b>
                {e.currency !== base && (
                  <p className="text-xs muted">
                    ≈ {formatMoney(e.baseAmountMinor, base)}
                  </p>
                )}
                <div className="flex justify-end gap-3 mt-2">
                  {editable && (
                    <>
                      {confirmation}
                      <button
                        aria-label={`编辑费用 ${e.title}`}
                        onClick={() => edit(e)}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        aria-label={`删除费用 ${e.title}`}
                        onClick={() => remove(`/expenses/${e.id}`, e.version)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                  <button
                    aria-label={`评论费用 ${e.title}`}
                    onClick={() => comment(e)}
                  >
                    <MessageSquare size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="empty">暂无费用记录</div>
        )}
      </section>
      <h3 className="font-semibold mt-9 mb-4">实际转账记录</h3>
      <section className="panel">
        {snapshot.settlements.length ? (
          snapshot.settlements.map((s) => (
            <div className="settlement-row px-6" key={s.id}>
              <span>
                {name(s.fromParticipantId)} → {name(s.toParticipantId)}
              </span>
              <span className="text-xs muted">{s.note}</span>
              <b className="ml-auto">
                {formatMoney(s.amountMinor, s.currency)}
              </b>
              {editable && (
                <button
                  aria-label="删除转账记录"
                  onClick={() => remove(`/settlements/${s.id}`, s.version)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))
        ) : (
          <p className="p-6 text-sm muted">暂无转账记录</p>
        )}
      </section>
      {settle && (
        <SettlementEditor
          snapshot={snapshot}
          initial={settle === "new" ? undefined : settle}
          mutate={mutate}
          close={() => setSettle(null)}
        />
      )}
    </main>
  );
}
