import { describe, it, expect } from "vitest";
import {
  convertMoney,
  splitExpense,
  calculateBalances,
  parseMoney,
  moneyText,
  formatMoney,
  type SettlementMode,
} from "@/domain/money";
describe("money", () => {
  it("round trips large monetary values without losing a minor unit in the editor", () => {
    const amount = Number.MAX_SAFE_INTEGER;
    expect(moneyText(amount, "CNY")).toBe("90071992547409.91");
    expect(parseMoney(moneyText(amount, "CNY"), "CNY")).toBe(amount);
    expect(parseMoney(moneyText(amount, "JPY"), "JPY")).toBe(amount);
    expect(formatMoney(amount, "CNY")).toContain("90,071,992,547,409.91");
    expect(formatMoney(-1, "CNY")).toContain("-¥0.01");
  });
  it("converts decimal rates using the currencies' minor units", () => {
    expect(convertMoney(24000, "HKD", "CNY", "0.9182")).toBe(22037);
    expect(convertMoney(1000, "JPY", "CNY", "0.05")).toBe(5000);
    expect(parseMoney("123.45", "HKD")).toBe(12345);
    expect(() => parseMoney("1.2", "JPY")).toThrow();
    expect(() => convertMoney(100, "CNY", "CNY", "2")).toThrow();
  });
  it("normalizes all four methods and rejects invalid totals", () => {
    const entries = ["a", "b", "c"].map((participantId) => ({
      participantId,
      value: "1",
    }));
    expect(
      splitExpense(60000, 60000, "HKD", "equal", entries).map(
        (s) => s.amountMinor,
      ),
    ).toEqual([20000, 20000, 20000]);
    expect(
      splitExpense(24000, 22037, "HKD", "shares", [
        ...entries.slice(0, 2),
        { participantId: "c", value: "2" },
      ]).map((s) => s.amountMinor),
    ).toEqual([6000, 6000, 12000]);
    expect(
      splitExpense(100, 100, "CNY", "percentage", [
        { participantId: "a", value: "30" },
        { participantId: "b", value: "70" },
      ]).map((s) => s.amountMinor),
    ).toEqual([30, 70]);
    expect(
      splitExpense(100, 100, "CNY", "exact", [
        { participantId: "a", value: "0.23" },
        { participantId: "b", value: "0.77" },
      ]).map((s) => s.amountMinor),
    ).toEqual([23, 77]);
    expect(() =>
      splitExpense(100, 100, "CNY", "percentage", entries),
    ).toThrow();
    expect(() => splitExpense(100, 100, "CNY", "exact", entries)).toThrow();
    expect(() =>
      splitExpense(100, 100, "CNY", "equal", [entries[0], entries[0]]),
    ).toThrow();
  });
  it("conserves every cent with deterministic remainder allocation", () => {
    for (let total = 1; total < 200; total++) {
      const entries = ["c", "a", "b"].map((participantId) => ({
        participantId,
        value: "1",
      }));
      const base = convertMoney(total, "HKD", "CNY", "0.9182");
      const split = splitExpense(total, base, "HKD", "equal", entries);
      expect(split.reduce((s, v) => s + v.amountMinor, 0)).toBe(total);
      expect(split.reduce((s, v) => s + v.baseAmountMinor, 0)).toBe(base);
      const reordered = splitExpense(
        total,
        base,
        "HKD",
        "equal",
        [...entries].reverse(),
      );
      for (const s of split)
        expect(
          reordered.find((x) => x.participantId === s.participantId),
        ).toEqual(s);
    }
  });
  it("settlements reduce balances and overpayments reverse the remaining debt", () => {
    const expenses = [
      {
        payerParticipantId: "a",
        baseAmountMinor: 60000,
        splits: ["a", "b", "c"].map((participantId) => ({
          participantId,
          baseAmountMinor: 20000,
        })),
      },
    ];
    const before = calculateBalances(["a", "b", "c"], expenses, []);
    expect(before.balances.map((b) => b.net)).toEqual([40000, -20000, -20000]);
    expect(before.suggestions).toHaveLength(2);
    const after = calculateBalances(["a", "b", "c"], expenses, [
      { fromParticipantId: "b", toParticipantId: "a", baseAmountMinor: 25000 },
    ]);
    expect(after.balances.map((b) => b.net)).toEqual([15000, 5000, -20000]);
    expect(after.suggestions).toEqual([
      { fromParticipantId: "c", toParticipantId: "a", amountMinor: 20000 },
      { fromParticipantId: "a", toParticipantId: "b", amountMinor: 5000 },
    ]);
  });
});

describe("settlement suggestions", () => {
  type Expense = Parameters<typeof calculateBalances>[1][number];
  type Settlement = Parameters<typeof calculateBalances>[2][number];
  function expense(payer: string, shares: Record<string, number>): Expense {
    return {
      payerParticipantId: payer,
      baseAmountMinor: Object.values(shares).reduce((sum, v) => sum + v, 0),
      splits: Object.entries(shares).map(
        ([participantId, baseAmountMinor]) => ({
          participantId,
          baseAmountMinor,
        }),
      ),
    };
  }
  function expectSettled(
    participants: string[],
    expenses: Expense[],
    settlements: Settlement[] = [],
    mode: SettlementMode = "direct",
  ) {
    const { suggestions } = calculateBalances(
      participants,
      expenses,
      settlements,
      mode,
    );
    const after = calculateBalances(
      participants,
      expenses,
      [
        ...settlements,
        ...suggestions.map((s) => ({ ...s, baseAmountMinor: s.amountMinor })),
      ],
      mode,
    );
    expect(after.balances.every((b) => b.net === 0)).toBe(true);
    expect(after.suggestions).toEqual([]);
  }

  it("keeps separate groups' repayments with their original payers", () => {
    const people = ["a", "b", "c", "d", "e"];
    const expenses = [
      expense("a", { a: 6000, b: 6000, c: 6000 }),
      expense("d", { d: 10000, e: 10000 }),
    ];
    const result = calculateBalances(people, expenses, []);
    expect(result.suggestions).toEqual([
      { fromParticipantId: "e", toParticipantId: "d", amountMinor: 10000 },
      { fromParticipantId: "b", toParticipantId: "a", amountMinor: 6000 },
      { fromParticipantId: "c", toParticipantId: "a", amountMinor: 6000 },
    ]);
    expectSettled(people, expenses);
  });

  it("does not redirect debts through another participant in the same group", () => {
    const expenses = [expense("a", { b: 100 }), expense("b", { c: 100 })];
    const result = calculateBalances(["a", "b", "c"], expenses, []);
    expect(result.balances.map((b) => b.net)).toEqual([100, 0, -100]);
    expect(result.suggestions).toEqual([
      { fromParticipantId: "b", toParticipantId: "a", amountMinor: 100 },
      { fromParticipantId: "c", toParticipantId: "b", amountMinor: 100 },
    ]);
    expectSettled(["a", "b", "c"], expenses);
  });

  it("offers a simplified scheme with fewer transfers and identical personal balances", () => {
    const people = ["a", "b", "c"];
    const expenses = [expense("a", { b: 100 }), expense("b", { c: 100 })];
    const direct = calculateBalances(people, expenses, []);
    const simplified = calculateBalances(people, expenses, [], "simplified");
    expect(simplified.balances).toEqual(direct.balances);
    expect(direct.suggestions).toHaveLength(2);
    expect(simplified.suggestions).toEqual([
      { fromParticipantId: "c", toParticipantId: "a", amountMinor: 100 },
    ]);
    expect(calculateBalances(people, expenses, [], "direct")).toEqual(direct);
    expectSettled(people, expenses, [], "simplified");
  });

  it("allows deterministic cross-group matching only in the simplified scheme", () => {
    const people = ["a", "b", "c", "d", "e"];
    const expenses = [
      expense("a", { a: 6000, b: 6000, c: 6000 }),
      expense("d", { d: 10000, e: 10000 }),
    ];
    const simplified = calculateBalances(people, expenses, [], "simplified");
    expect(simplified.suggestions).toEqual([
      { fromParticipantId: "e", toParticipantId: "a", amountMinor: 10000 },
      { fromParticipantId: "b", toParticipantId: "a", amountMinor: 2000 },
      { fromParticipantId: "b", toParticipantId: "d", amountMinor: 4000 },
      { fromParticipantId: "c", toParticipantId: "d", amountMinor: 6000 },
    ]);
    expect(
      calculateBalances(
        [...people].reverse(),
        [...expenses].reverse(),
        [],
        "simplified",
      ).suggestions,
    ).toEqual(simplified.suggestions);
    expectSettled(people, expenses, [], "simplified");
  });

  it("simplifies partial repayments and overpayments using the remaining net balances", () => {
    const people = ["a", "b", "c"];
    const expenses = [expense("a", { a: 20000, b: 20000, c: 20000 })];
    const settlements = [
      { fromParticipantId: "b", toParticipantId: "a", baseAmountMinor: 25000 },
      { fromParticipantId: "c", toParticipantId: "a", baseAmountMinor: 10000 },
    ];
    const simplified = calculateBalances(
      people,
      expenses,
      settlements,
      "simplified",
    );
    expect(simplified.suggestions).toEqual([
      { fromParticipantId: "c", toParticipantId: "a", amountMinor: 5000 },
      { fromParticipantId: "c", toParticipantId: "b", amountMinor: 5000 },
    ]);
    expect(simplified.balances).toEqual(
      calculateBalances(people, expenses, settlements).balances,
    );
    expectSettled(people, expenses, settlements, "simplified");
  });

  it("offsets cycles in the simplified scheme, including ones from cross-person repayments", () => {
    const people = ["a", "b", "c"];
    const expenses = [expense("a", { b: 100 }), expense("b", { c: 100 })];
    const settlements = [
      { fromParticipantId: "c", toParticipantId: "a", baseAmountMinor: 100 },
    ];
    const simplified = calculateBalances(
      people,
      expenses,
      settlements,
      "simplified",
    );
    const direct = calculateBalances(people, expenses, settlements);
    expect(simplified.balances.every((b) => b.net === 0)).toBe(true);
    expect(simplified.suggestions).toEqual([]);
    expect(direct.balances).toEqual(simplified.balances);
    expect(direct.suggestions).toHaveLength(3);
    expect(calculateBalances(people, [], [], "simplified").suggestions).toEqual(
      [],
    );
  });

  it("offsets reciprocal expenses and partial transfers only within each pair", () => {
    const expenses = [
      expense("a", { a: 300, b: 300, c: 300 }),
      expense("b", { a: 240 }),
    ];
    const settlements = [
      { fromParticipantId: "b", toParticipantId: "a", baseAmountMinor: 20 },
    ];
    expect(
      calculateBalances(["a", "b", "c"], expenses, settlements).suggestions,
    ).toEqual([
      { fromParticipantId: "c", toParticipantId: "a", amountMinor: 300 },
      { fromParticipantId: "b", toParticipantId: "a", amountMinor: 40 },
    ]);
    expectSettled(["a", "b", "c"], expenses, settlements);
  });

  it("accounts for historical transfers without a shared expense", () => {
    const settlements = [
      { fromParticipantId: "a", toParticipantId: "b", baseAmountMinor: 125 },
    ];
    expect(calculateBalances(["a", "b"], [], settlements).suggestions).toEqual([
      { fromParticipantId: "b", toParticipantId: "a", amountMinor: 125 },
    ]);
    expectSettled(["a", "b"], [], settlements);
  });

  it("preserves each pair's debt in a cycle even when personal net balances are zero", () => {
    const expenses = [
      expense("a", { b: 100 }),
      expense("b", { c: 100 }),
      expense("c", { a: 100 }),
    ];
    const result = calculateBalances(["a", "b", "c"], expenses, []);
    expect(result.balances.every((b) => b.net === 0)).toBe(true);
    expect(result.suggestions).toEqual([
      { fromParticipantId: "a", toParticipantId: "c", amountMinor: 100 },
      { fromParticipantId: "b", toParticipantId: "a", amountMinor: 100 },
      { fromParticipantId: "c", toParticipantId: "b", amountMinor: 100 },
    ]);
    expectSettled(["a", "b", "c"], expenses);
    expectSettled(["a", "b", "c"], expenses, [], "simplified");
  });

  it("keeps converted minor units exact and suggestions stable when input order changes", () => {
    const splits = splitExpense(100, 86, "HKD", "equal", [
      { participantId: "a", value: "1" },
      { participantId: "b", value: "1" },
      { participantId: "c", value: "1" },
    ]);
    const expenses = [
      { payerParticipantId: "a", baseAmountMinor: 86, splits },
      expense("b", { a: 20, b: 0 }),
      expense("c", { c: 15 }),
    ];
    const result = calculateBalances(["a", "b", "c"], expenses, []);
    expect(result.suggestions).toEqual([
      { fromParticipantId: "c", toParticipantId: "a", amountMinor: 28 },
      { fromParticipantId: "b", toParticipantId: "a", amountMinor: 9 },
    ]);
    expect(
      calculateBalances(
        ["c", "b", "a"],
        [...expenses]
          .reverse()
          .map((e) => ({ ...e, splits: [...e.splits].reverse() })),
        [],
      ).suggestions,
    ).toEqual(result.suggestions);
    expectSettled(["a", "b", "c"], expenses);
    expectSettled(["a", "b", "c"], expenses, [], "simplified");
  });

  it("retains a one-cent debt after a large repayment", () => {
    const expenses = [expense("a", { b: Number.MAX_SAFE_INTEGER })];
    const settlements = [
      {
        fromParticipantId: "b",
        toParticipantId: "a",
        baseAmountMinor: Number.MAX_SAFE_INTEGER - 1,
      },
    ];
    expect(
      calculateBalances(["a", "b"], expenses, settlements).suggestions,
    ).toEqual([
      { fromParticipantId: "b", toParticipantId: "a", amountMinor: 1 },
    ]);
    expectSettled(["a", "b"], expenses, settlements);
    expect(
      calculateBalances(["a", "b"], expenses, settlements, "simplified")
        .suggestions,
    ).toEqual([
      { fromParticipantId: "b", toParticipantId: "a", amountMinor: 1 },
    ]);
    expectSettled(["a", "b"], expenses, settlements, "simplified");
  });
});
