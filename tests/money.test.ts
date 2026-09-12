import { describe, it, expect } from "vitest";
import {
  convertMoney,
  splitExpense,
  calculateBalances,
  parseMoney,
} from "@/domain/money";
describe("money", () => {
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
    expect(after.suggestions.reduce((s, x) => s + x.amountMinor, 0)).toBe(
      20000,
    );
  });
});
