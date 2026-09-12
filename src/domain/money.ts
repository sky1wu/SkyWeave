export const currencies = ["CNY", "HKD", "MOP", "USD", "JPY", "TWD", "EUR", "GBP", "KRW", "SGD"] as const;
export function minorDigits(currency: string): number {
  if (!(currencies as readonly string[]).includes(currency)) throw new Error("不支持的币种");
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}
export function safeInteger(n: bigint): number { const v = Number(n); if (!Number.isSafeInteger(v)) throw new Error("金额超出可安全计算范围"); return v; }
function decimal(value: string): { n: bigint; d: bigint } {
  if (!/^\d{1,15}(?:\.\d{1,12})?$/.test(value)) throw new Error("请输入有效的非负十进制数");
  const [whole, fraction = ""] = value.split(".");
  return { n: BigInt(whole + fraction), d: 10n ** BigInt(fraction.length) };
}
export function parseMoney(value: string, currency: string): number {
  const digits = minorDigits(currency);
  if (!new RegExp(`^\\d{1,15}${digits ? `(?:\\.\\d{1,${digits}})?` : ""}$`).test(value)) throw new Error(`此币种最多支持 ${digits} 位小数`);
  const v = decimal(value); return safeInteger(v.n * 10n ** BigInt(digits) / v.d);
}
export function moneyText(amount: number, currency: string): string { return (amount / 10 ** minorDigits(currency)).toFixed(minorDigits(currency)); }
export function formatMoney(amount: number, currency: string): string { return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(amount / 10 ** minorDigits(currency)); }
export function convertMoney(amount: number, currency: string, base: string, rate: string): number {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("金额必须为非负整数 minor units");
  const r = decimal(rate); if (r.n <= 0n) throw new Error("汇率必须大于零");
  if (currency === base && r.n !== r.d) throw new Error("同币种汇率必须为 1");
  const n = BigInt(amount) * r.n * 10n ** BigInt(minorDigits(base));
  const d = r.d * 10n ** BigInt(minorDigits(currency));
  return safeInteger((n * 2n + d) / (2n * d));
}
export function allocate(total: number, entries: { participantId: string; weight: bigint }[]): number[] {
  const sum = entries.reduce((s, e) => s + e.weight, 0n);
  if (sum <= 0n) { if (total === 0) return entries.map(() => 0); throw new Error("分摊比例总和必须大于零"); }
  const amounts = entries.map(e => BigInt(total) * e.weight / sum);
  let remainder = BigInt(total) - amounts.reduce((a, b) => a + b, 0n);
  const order = entries.map((e, i) => ({ i, rem: BigInt(total) * e.weight % sum, id: e.participantId })).sort((a, b) => a.rem === b.rem ? a.id.localeCompare(b.id) : a.rem > b.rem ? -1 : 1);
  for (const entry of order) { if (remainder-- <= 0n) break; amounts[entry.i]++; }
  return amounts.map(safeInteger);
}
export type SplitMethod = "equal" | "exact" | "percentage" | "shares";
export function splitExpense(amount: number, baseAmount: number, currency: string, method: SplitMethod, entries: { participantId: string; value: string }[]) {
  if (!entries.length || new Set(entries.map(e => e.participantId)).size !== entries.length) throw new Error("请选择不重复的分摊参与人");
  let amounts: number[];
  if (method === "exact") {
    amounts = entries.map(e => parseMoney(e.value, currency));
    if (amounts.reduce((s, v) => s + BigInt(v), 0n) !== BigInt(amount)) throw new Error("指定金额之和必须等于总金额");
  } else {
    const values = entries.map(e => method === "equal" ? { n: 1n, d: 1n } : decimal(e.value));
    const scale = values.reduce((m, v) => v.d > m ? v.d : m, 1n);
    const weights = values.map(v => v.n * (scale / v.d));
    if (method === "percentage" && weights.reduce((s, v) => s + v, 0n) !== 100n * scale) throw new Error("百分比之和必须为 100%");
    amounts = allocate(amount, entries.map((e, i) => ({ participantId: e.participantId, weight: weights[i] })));
  }
  const bases = allocate(baseAmount, entries.map((e, i) => ({ participantId: e.participantId, weight: BigInt(amounts[i]) })));
  return entries.map((e, i) => ({ participantId: e.participantId, amountMinor: amounts[i], baseAmountMinor: bases[i] }));
}
export interface Balance { participantId: string; paidBase: number; owedBase: number; sentBase: number; receivedBase: number; net: number }
export function calculateBalances(participantIds: string[], expenses: { payerParticipantId: string; baseAmountMinor: number; splits: { participantId: string; baseAmountMinor: number }[] }[], settlements: { fromParticipantId: string; toParticipantId: string; baseAmountMinor: number }[]) {
  const rows = new Map(participantIds.map(id => [id, { participantId: id, paidBase: 0n, owedBase: 0n, sentBase: 0n, receivedBase: 0n }]));
  const row = (id: string) => { const r = rows.get(id); if (!r) throw new Error("账目参与者不存在"); return r; };
  for (const expense of expenses) { row(expense.payerParticipantId).paidBase += BigInt(expense.baseAmountMinor); for (const split of expense.splits) row(split.participantId).owedBase += BigInt(split.baseAmountMinor); }
  for (const s of settlements) { row(s.fromParticipantId).sentBase += BigInt(s.baseAmountMinor); row(s.toParticipantId).receivedBase += BigInt(s.baseAmountMinor); }
  const balances: Balance[] = [...rows.values()].map(r => ({ participantId: r.participantId, paidBase: safeInteger(r.paidBase), owedBase: safeInteger(r.owedBase), sentBase: safeInteger(r.sentBase), receivedBase: safeInteger(r.receivedBase), net: safeInteger(r.paidBase - r.owedBase + r.sentBase - r.receivedBase) }));
  if (balances.reduce((s, r) => s + BigInt(r.net), 0n) !== 0n) throw new Error("账目余额不守恒");
  const sort = (a: { amount: number; id: string }, b: { amount: number; id: string }) => b.amount - a.amount || a.id.localeCompare(b.id);
  const creditors = balances.filter(b => b.net > 0).map(b => ({ id: b.participantId, amount: b.net })).sort(sort);
  const debtors = balances.filter(b => b.net < 0).map(b => ({ id: b.participantId, amount: -b.net })).sort(sort);
  const suggestions: { fromParticipantId: string; toParticipantId: string; amountMinor: number }[] = [];
  let c = 0, d = 0;
  while (c < creditors.length && d < debtors.length) { const amount = Math.min(creditors[c].amount, debtors[d].amount); suggestions.push({ fromParticipantId: debtors[d].id, toParticipantId: creditors[c].id, amountMinor: amount }); creditors[c].amount -= amount; debtors[d].amount -= amount; if (!creditors[c].amount) c++; if (!debtors[d].amount) d++; }
  return { balances, suggestions };
}
